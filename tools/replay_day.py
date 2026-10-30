#!/usr/bin/env python3
"""Replay a past service day with today's collector code: rebuild the arrivals.csv and predictions.csv rows the live
collector would have written that day, from what it archived (owner 2026-10-16: "Update all data collected if
needed"). Read-only on GitHub: it downloads, never uploads, and never writes the data branch.

  python tools/replay_day.py --day 2026-10-15 --out DIR             # DIR/arrivals-<day>.csv, predictions-<day>.csv
  python tools/replay_day.py --day 2026-10-15 --out DIR --compare   # + diff against origin/data's rows of that day
  python tools/replay_day.py --day 2026-10-12 --out DIR --source release   # one pass over the day's release assets

How (the live process, .github/workflows/collect.yml): the CI collector is a chain of 70-min runs, one started about
every 40 min. Each run built web/data from Passio's GTFS, seeded its own Tracker from the data branch's arrivals.csv
as it was at the run's start (no prediction seed), polled tripUpdates then vehiclePositions every 10 s, and at its end
merged its rows into the shared CSVs (merge_arrivals.py / merge_predictions.py: duplicates within 300 s, richer row /
fresher prediction kept). Every run also kept its vehiclePositions polls (artifact raw-polls-<run>) and every
prediction update it saw (pred-updates-<run>: [veh, trip, stop, made, predicted, seq, seen, last], re-logged about once
a minute while on display). The replay re-runs each run over its own polls through truth_logger.poll (the same
reports(), Tracker.update, drain and Writer), adding each prediction update the run saw just before the poll that first
showed it, seeds it from the replayed rows merged before it started, and merges the runs in the order they ended with
the same merge code. So a day is rebuilt the way today's collector would have logged it, run edges included.

Inputs, best first: (1) the run artifacts (90-day retention on GitHub); (2) for runs without a pred-updates artifact
(before 2026-10-12 19:08Z) the day's release asset pred-updates-<day> (all runs merged; each update kept once, from its
first sighting, so an update shown, replaced and shown again is one stretch); (3) with --source release, or when no run
artifact is left, one pass over the day's release assets (raw-polls-<day>: the runs' polls merged; denser polls than one
run had during overlaps). A run with no prediction updates at all (2026-10-10 / 11, and 2026-10-12 before 12:18 local:
predictions were not logged yet) gets no predictions rows, and its arrivals keep the live row's passio_pred_* columns
(matched by vehicle + stop + arrival within 60 s) unless --no-live-pred.
Static data: the day's release asset gtfs-<day>.zip built by tools/build_gtfs.py --zip into the cache (never web/data);
stop addresses from web/data/stop_addresses.json. Tests: tools/test_replay.py. Docs: docs/DATA.md "Replaying a day".
"""
import argparse, bisect, csv, io, json, shutil, subprocess, sys, tempfile, zipfile
from collections import Counter, OrderedDict, defaultdict
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import arrivals_lib as L
import build_eta_dataset as B
import merge_arrivals as MA
import merge_predictions as MP
import truth_logger as TL
import bus_changes as BC
from arrival_detector import Tracker

REPO = "blobberus/straight-bussing"
CACHE = Path(tempfile.gettempdir()) / "sb-replay"
MERGE_LAG_S = 120      # a run merges its rows about this long after its last poll (collect.yml's merge step)
SEED_LAG_S = 60        # and the next run fetched its seed CSV about this long before its first poll
LEAD_IN_S = 3 * 3600   # runs this long before the day are replayed too, so the day's first runs get replayed seeds
MATCH_S = 60           # --compare: the same arrival = same vehicle + stop, epochs within this
LAST_EXT_S = 44        # estimate_last: a logged last sighting can be up to 59 s early; adding 44 s matched 2026-10-15
                       # best (prediction rows only in live / only in the replay: +0 s 224 / 2, +29 s 72 / 37,
                       # +44 s 19 / 58, +59 s 0 / 95, of 20,504)
I_EP, I_VEH, I_STOP = (L.COLUMNS.index(c) for c in ("epoch", "vehicle_id", "stop_id"))
I_PE, I_PL = L.COLUMNS.index("passio_pred_epoch"), L.COLUMNS.index("passio_pred_lead_s")
P_EP, P_VEH, P_STOP, P_LEAD = (L.PRED_COLUMNS.index(c) for c in ("epoch", "vehicle_id", "stop_id", "lead_target_s"))


# ---------------------------------------------------------------- inputs
def gh(*args, binary=False, check=True):
    r = subprocess.run(["gh", *args], capture_output=True, timeout=900)
    if check and r.returncode:
        raise RuntimeError(f"gh {' '.join(args[:3])}: {r.stderr.decode('utf-8', 'replace').strip()[:300]}")
    return r.stdout if binary else r.stdout.decode("utf-8")


def release_asset(cache, name, repo=REPO):
    """A data-archive release asset (cached) -> path or None if the release does not have it."""
    p = Path(cache) / "assets" / name
    if p.exists():
        return p
    p.parent.mkdir(parents=True, exist_ok=True)
    day = name.split("-", 2)[-1][:10] if name[:4] != "gtfs" else name[5:15]
    tag = "data-archive-" + day[:7]
    gh("release", "download", tag, "-R", repo, "-p", name, "-D", str(p.parent), check=False)
    return p if p.exists() else None


def artifact_index(cache, repo=REPO):
    """[(id, name, created epoch)] of the repo's unexpired run artifacts (one API listing per call)."""
    out = gh("api", "--paginate", f"repos/{repo}/actions/artifacts?per_page=100", "--jq",
             '.artifacts[] | select(.expired | not) | [.id, .name, .created_at] | @json')
    rows = []
    for x in out.splitlines():
        if x.strip():
            aid, name, created = json.loads(x)
            rows.append((aid, name, datetime.fromisoformat(created.replace("Z", "+00:00")).timestamp()))
    return rows


def artifact_lines(cache, aid, name, repo=REPO):
    p = Path(cache) / "artifacts" / f"{name}.jsonl"
    if not p.exists():
        p.parent.mkdir(parents=True, exist_ok=True)
        z = zipfile.ZipFile(io.BytesIO(gh("api", f"repos/{repo}/actions/artifacts/{aid}/zip", binary=True)))
        p.write_text("".join(z.read(m).decode("utf-8", "replace") for m in z.namelist()), encoding="utf-8")
    return p.read_text(encoding="utf-8").splitlines()


def parse_polls(lines):
    out = []
    for ln in lines:
        try:
            p = json.loads(ln) if isinstance(ln, str) else ln
            if isinstance(p, dict) and "t" in p:
                out.append(p)
        except ValueError:
            continue
    out.sort(key=lambda p: p["t"])                # stable: a run writes its polls in order
    return out


def episodes(lines):
    """PredLog lines -> the updates in the order first seen: [veh, trip, stop, made, predicted, seq, seen, last], one
    per (veh, trip, stop, made, predicted, seq, seen) with its latest 'last' (re-logged about once a minute). Keyed
    with seen: an update shown, replaced and shown again is two entries, as in the live Tracker."""
    best = OrderedDict()
    for ln in lines:
        try:
            x = json.loads(ln) if isinstance(ln, str) else ln
            veh, trip, stop, made, pred, seq = x[:6]
            seen = int(x[6]) if len(x) > 6 else int(made)
            last = int(x[7]) if len(x) > 7 else seen
            k = (veh, trip, stop, int(made), int(pred), seq, seen)
        except (ValueError, TypeError, IndexError):
            continue
        best[k] = max(best.get(k, last), last)
    out = [[*k, last] for k, last in best.items()]
    out.sort(key=lambda x: x[6])                  # stable: same-poll updates keep the feed's order
    return out


def estimate_last(eps, t_end, ext=LAST_EXT_S):
    """A run's PredLog writes an update again only once 'last' has moved on 60 s since it was last written
    (Tracker.add_prediction), so up to the final minute an update was on display is not in the log: its true last
    sighting is in [logged last, logged last + 60 s), before the next update of the same (veh, trip, stop) appeared
    (the Tracker only moves the newest entry's last) and by the run's last poll. Taken as logged, a moment still on
    display looks withdrawn (2026-10-15: 224 of 20,504 live prediction rows lost); the upper bound makes some withdrawn
    ones look shown (95 extra). -> the same list with last moved ext s on (LAST_EXT_S), within those bounds. Only for
    one run's own log (artifact), not merged ones."""
    nxt = {}
    out = [list(x) for x in eps]
    for x in reversed(out):
        k = (x[0], x[1], x[2])
        x[7] = max(x[7], min(x[7] + ext, t_end, nxt.get(k, t_end + 1) - 1))
        nxt[k] = x[6]
    return out


def clip_episodes(eps, t_first, t_last):
    """Merged (release) updates as one run could have seen them: on display some time in [t_first, t_last], first
    seen no earlier than the run's first poll."""
    out = [[*x[:6], max(x[6], t_first), x[7]] for x in eps if x[7] >= t_first and x[6] <= t_last]
    out.sort(key=lambda x: x[6])
    return out


class Run:
    def __init__(self, rid, polls, preds, pred_src):
        self.rid, self.polls, self.preds, self.pred_src = rid, polls, preds, pred_src
        self.t_first, self.t_last = int(polls[0]["t"]), int(polls[-1]["t"])
        self.arr = self.pred = None               # its output files once replayed
        self.changes = None                       # its bus count changes file once replayed
        self.seed_t = self.t_first - SEED_LAG_S   # when it read the shared CSV, when its rows were merged
        self.merge_t = self.t_last + MERGE_LAG_S  # (run_times: the job's own step times, when GitHub has them)


def run_times(cache, runs, repo=REPO, log=print):
    """Seed and merge moments of CI runs from their job steps ("Seed from the shared CSV" ended, "Merge into the data
    branch and push" ended), cached; a run GitHub has no steps for keeps the lag estimates."""
    p = Path(cache) / "run_times.json"
    known = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
    iso = lambda s: datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp() if s else None
    got = 0
    for r in runs:
        if not r.rid.isdigit():
            continue
        if r.rid not in known:
            try:
                jobs = json.loads(gh("api", f"repos/{repo}/actions/runs/{r.rid}/jobs"))["jobs"]
                steps = {s["name"]: s for j in jobs for s in j.get("steps", [])}
                seed = next((s for n, s in steps.items() if n.startswith("Seed from")), None)
                merge = next((s for n, s in steps.items() if n.startswith("Merge into the data branch")), None)
                known[r.rid] = [iso(seed and seed.get("completed_at")), iso(merge and merge.get("completed_at"))]
            except Exception:
                known[r.rid] = [None, None]
        s, m = known[r.rid]
        if s and abs(s - r.t_first) < 600:
            r.seed_t = s
        if m and 0 <= m - r.t_last < 3600:
            r.merge_t = m
            got += 1
    p.write_text(json.dumps(known), encoding="utf-8")
    log(f"  seed / merge times from the job steps for {got} of {len(runs)} runs")


def day_str(epoch):
    return str(B.service_day_of(epoch))


def release_preds(cache, days):
    """The release pred-updates of these days, as merged updates (no run structure)."""
    eps = []
    for d in sorted(set(days)):
        p = release_asset(cache, f"pred-updates-{d}.jsonl.gz")
        if p:
            with B._open(p) as f:
                eps += [json.loads(x) for x in f if x.strip()]
    eps = [[*x[:6], int(x[6]) if len(x) > 6 else int(x[3]), int(x[7]) if len(x) > 7 else int(x[3])] for x in eps]
    eps.sort(key=lambda x: x[6])
    return eps


def runs_from_artifacts(cache, day, arts, lead_in=LEAD_IN_S, log=print, logged_last=False):
    """The CI runs whose polls touch [day start - lead_in, day end), from their artifacts."""
    t0, t1 = B.day_bounds(day)
    raw = {n[len("raw-polls-"):]: (aid, n, c) for aid, n, c in arts if n.startswith("raw-polls-")}
    pred = {n[len("pred-updates-"):]: (aid, n, c) for aid, n, c in arts if n.startswith("pred-updates-")}
    runs, need_rel = [], []
    for rid, (aid, name, created) in sorted(raw.items(), key=lambda kv: kv[1][2]):
        if not t0 - lead_in - 600 <= created <= t1 + 2 * 3600:       # the artifact is uploaded at the run's end
            continue
        polls = parse_polls(artifact_lines(cache, aid, name))
        if not polls or polls[-1]["t"] < t0 - lead_in or polls[0]["t"] >= t1:
            continue
        if rid in pred:
            eps = episodes(artifact_lines(cache, *pred[rid][:2]))
            eps, src = (eps if logged_last else estimate_last(eps, int(polls[-1]["t"]))), "artifact"
        else:
            eps, src = None, None
        runs.append(Run(rid, polls, eps, src))
        if eps is None:
            need_rel.append(runs[-1])
    if need_rel:                                  # older runs: the day's merged prediction updates, if any
        rel = release_preds(cache, [day_str(r.t_first) for r in need_rel] + [day_str(r.t_last) for r in need_rel])
        for r in need_rel:
            r.preds = clip_episodes(rel, r.t_first, r.t_last)
            r.pred_src = "release" if r.preds else None
    log(f"{day}: {len(runs)} runs from artifacts ({sum(1 for r in runs if r.pred_src == 'artifact')} with their own "
        f"prediction log, {sum(1 for r in runs if r.pred_src == 'release')} with the release's, "
        f"{sum(1 for r in runs if r.pred_src is None)} with none)")
    return runs


def run_from_release(cache, day, log=print):
    """--source release: one pass over the merged polls of the day (plus the previous day's last hours)."""
    t0, t1 = B.day_bounds(day)
    prev = str(B.service_day_of(t0 - 1))
    polls = []
    for d in (prev, day):
        p = release_asset(cache, f"raw-polls-{d}.jsonl.gz")
        if p:
            with B._open(p) as f:
                polls += [x for x in parse_polls(f.read().splitlines()) if x["t"] >= t0 - LEAD_IN_S]
    if not polls:
        return []
    polls.sort(key=lambda p: p["t"])
    eps = clip_episodes(release_preds(cache, [prev, day]), int(polls[0]["t"]), int(polls[-1]["t"]))
    log(f"{day}: one pass over the release's merged polls ({len(polls)} polls, {len(eps)} prediction updates)")
    return [Run("release-" + day, polls, eps, "release" if eps else None)]


# ---------------------------------------------------------------- static data
def static_for(cache, day, web_data=L.WEB_DATA, log=print):
    """L.Static built from the release's gtfs-<day>.zip (else the nearest later day's) in the cache."""
    d = datetime.fromisoformat(day).date()
    for k in range(0, 4):
        dd = str(d + timedelta(days=k))
        z = release_asset(cache, f"gtfs-{dd}.zip")
        if z:
            break
    else:
        log(f"{day}: no archived GTFS near the day: using web/data")
        return L.Static()
    out = Path(cache) / "static" / dd
    if not (out / "route_stops.json").exists():
        import build_gtfs
        out.mkdir(parents=True, exist_ok=True)
        old = sys.stdout
        sys.stdout = io.StringIO()                # build_gtfs prints a size table
        try:
            build_gtfs.main(["--zip", str(z), "--out", str(out), "--patterns", str(out / "route_patterns.json")])
        finally:
            sys.stdout = old
        if (Path(web_data) / "stop_addresses.json").exists():
            shutil.copy(Path(web_data) / "stop_addresses.json", out / "stop_addresses.json")
    return L.Static(out, out / "route_patterns.json")


# ---------------------------------------------------------------- replaying one run
def entity(v):
    """A RawPolls row back to a vehiclePositions entity (what truth_logger.reports reads)."""
    veh, trip, route, lat, lon, bearing, speed, q, sid, status, vt = (list(v) + [None] * 11)[:11]
    pos = {"longitude": lon, "bearing": bearing, "speed": speed}
    if lat is not None:
        pos["latitude"] = lat
    return {"vehicle": {"vehicle": {"id": veh}, "trip": {"trip_id": trip, "route_id": route}, "position": pos,
                        "current_stop_sequence": q, "stop_id": sid, "current_status": status, "timestamp": vt}}


def replay_run(run, st, seed_rows, work):
    """One run through truth_logger.poll -> (arrivals CSV path, predictions CSV path, processing errors)."""
    work = Path(work)
    work.mkdir(parents=True, exist_ok=True)
    arr, pred, chg = work / f"run-{run.rid}.csv", work / f"run-{run.rid}_pred.csv", work / f"run-{run.rid}_changes.csv"
    for p in (arr, pred, chg):
        if p.exists():
            p.unlink()
    tr, w, err = Tracker(st), TL.Writer(arr, st, pred), TL.Errors(out=io.StringIO())
    changes = BC.BusChanges(st, run.t_first, out=chg)   # bus count changes, as the live run's --changes-out
    run.changes = chg
    tr.seed(seed_rows, run.t_first)
    eps, k, empty = run.preds or [], 0, {"entity": []}
    for p in run.polls:
        t = int(p["t"])
        while k < len(eps) and eps[k][6] <= t:     # the poll's tripUpdates come first (truth_logger.poll)
            veh, trip, stop, made, pr, seq, seen, last = eps[k]
            tr.add_prediction(trip, stop, made, pr, seq, veh, seen=seen, last=last)
            k += 1
        feed = {"header": {"timestamp": p.get("h")}, "entity": [entity(v) for v in p.get("v") or []]}
        TL.poll(tr, w, t, err, get=lambda name, f=feed: empty if name == "tripUpdates" else f, changes=changes)
    w.write(tr.drain(run.t_last, final=True))
    return arr, pred, err.proc


def replay(runs, st_for, seed_rows, work, log=print):
    """Replay the runs in the live order: each one seeded at its start from the rows merged so far, merged at its
    end. -> (arrivals store path, predictions store path)."""
    work = Path(work)
    work.mkdir(parents=True, exist_ok=True)
    store_a, store_p = work / "store_arrivals.csv", work / "store_predictions.csv"
    store_a.write_text(",".join(L.COLUMNS) + "\n" + "".join(L.row_text([r.get(c, "") for c in L.COLUMNS])
                                                            for r in seed_rows), encoding="utf-8", newline="")
    store_p.write_text(",".join(L.PRED_COLUMNS) + "\n", encoding="utf-8", newline="")
    events = sorted([(r.seed_t, 1, i) for i, r in enumerate(runs)] + [(r.merge_t, 0, i) for i, r in enumerate(runs)])
    errors = 0
    for _, kind, i in events:                     # at one moment: merges (0) before seeds (1)
        r = runs[i]
        if kind == 1:
            r.arr, r.pred, e = replay_run(r, st_for(r), L.read_tail(store_a), work / "runs")
            errors += e
        else:
            MA.merge(store_a, r.arr)
            MP.merge(store_p, r.pred)
            if getattr(r, "changes", None):          # bus count changes (work/store_changes.csv; copies dropped)
                BC.merge(work / "store_changes.csv", r.changes)
    if errors:
        log(f"  {errors} processing errors were skipped (as live)")
    return store_a, store_p


# ---------------------------------------------------------------- the day's rows
def read_rows(text, ncol, i_ep):
    out = []
    for r in csv.reader(io.StringIO(text)):
        if r and r[0] != "epoch":
            if ncol == len(L.PRED_COLUMNS) and len(r) == ncol - 1:
                r.append("")
            if len(r) == ncol:
                try:
                    int(r[i_ep])
                except ValueError:
                    continue
                out.append(r)
    return out


def live_rows(path, ncol, i_ep, t0, t1):
    """Rows of the data branch (origin/data, plus its rotated archive/ files) with t0 <= epoch < t1."""
    def show(spec):
        r = subprocess.run(["git", "show", spec], capture_output=True, cwd=L.ROOT)
        return r.stdout.decode("utf-8", "replace") if r.returncode == 0 else ""
    names = subprocess.run(["git", "ls-tree", "--name-only", "origin/data", "data/ground_truth/archive/"],
                           capture_output=True, cwd=L.ROOT).stdout.decode().split()
    stem = Path(path).stem
    text = "".join(show(f"origin/data:{n}") for n in sorted(names) if Path(n).name.startswith(stem + "-"))
    text += show(f"origin/data:{path}")
    return [r for r in read_rows(text, ncol, i_ep) if t0 <= int(r[i_ep]) < t1]


def pair(a_rows, b_rows, key, i_ep, tol=MATCH_S):
    """One-to-one match by key and the nearest epoch within tol -> (pairs, only a, only b)."""
    idx = defaultdict(list)
    for j, r in enumerate(b_rows):
        idx[key(r)].append((int(r[i_ep]), j))
    for v in idx.values():
        v.sort()
    used, pairs, only_a = set(), [], []
    for r in sorted(a_rows, key=lambda r: int(r[i_ep])):
        ep, best = int(r[i_ep]), None
        for e, j in idx.get(key(r), ()):
            if j not in used and abs(e - ep) <= tol and (best is None or abs(e - ep) < abs(best[0] - ep)):
                best = (e, j)
        if best is None:
            only_a.append(r)
        else:
            used.add(best[1])
            pairs.append((r, b_rows[best[1]]))
    return pairs, only_a, [r for j, r in enumerate(b_rows) if j not in used]


def fill_live_pred(rows, live, pred_spans):
    """Rows logged where no prediction updates exist (pred_spans: [(t_first, t_last)] of runs that had them) keep
    the live row's passio_pred_* columns (never a GPS-sweep row: DC-003 attaches no Passio prediction to those).
    -> how many rows were filled."""
    spans = sorted(pred_spans)
    covered = lambda ep: any(a <= ep <= b for a, b in spans)
    i_src = L.COLUMNS.index("source")
    need = [r for r in rows if r[I_PE] == "" and r[i_src] != "gps" and not covered(int(r[I_EP]))]
    pairs, _, _ = pair(need, [r for r in live if r[I_PE] != ""], lambda r: (r[I_VEH], r[I_STOP]), I_EP)
    for mine, theirs in pairs:
        mine[I_PE], mine[I_PL] = theirs[I_PE], theirs[I_PL]
    return len(pairs)


def coverage(arr_rows, pred_rows, lead=600):
    have = {(r[P_VEH], r[P_STOP], r[P_EP]) for r in pred_rows if r[P_LEAD] == str(lead)}
    return sum(1 for r in arr_rows if (r[I_VEH], r[I_STOP], r[I_EP]) in have) / len(arr_rows) if arr_rows else 0.0


CMP_FIELDS = ("route_id", "trip_id", "stop_index", "source", "dwell_s", "prev_stop_id", "prev_arrival_epoch",
              "passio_pred_epoch", "passio_pred_lead_s")
CMP_PRED = ("pred_epoch", "pred_made_epoch", "pred_seen_epoch")


def compare(rep_a, rep_p, live_a, live_p):
    """-> dict of counts (+ examples) comparing replayed and live rows of a day."""
    col = {c: i for i, c in enumerate(L.COLUMNS)}
    pairs, only_rep, only_live = pair(rep_a, live_a, lambda r: (r[I_VEH], r[I_STOP]), I_EP)
    changed, why = 0, Counter()
    exact = sum(1 for a, b in pairs if a[I_EP] == b[I_EP])
    for a, b in pairs:
        diff = [c for c in CMP_FIELDS if a[col[c]] != b[col[c]]] + (["epoch"] if a[I_EP] != b[I_EP] else [])
        if diff:
            changed += 1
            why.update(diff)
    by = lambda rows, c: dict(Counter(r[col[c]] for r in rows).most_common())
    pcol = {c: i for i, c in enumerate(L.PRED_COLUMNS)}
    ppairs, p_only_rep, p_only_live = pair(rep_p, live_p, lambda r: (r[P_VEH], r[P_STOP], r[P_LEAD]), P_EP)
    p_changed = Counter()
    for a, b in ppairs:
        for c in CMP_PRED:
            if a[pcol[c]] != b[pcol[c]]:
                p_changed[c] += 1
    lead = lambda rows: dict(sorted(Counter(int(r[P_LEAD]) // 60 for r in rows).items()))
    return {
        "arrivals": {"live": len(live_a), "replay": len(rep_a), "matched": len(pairs), "exact_epoch": exact,
                     "matched_changed": changed, "changed_fields": dict(why.most_common()),
                     "only_live": len(only_live), "only_replay": len(only_rep),
                     "only_live_by_source": by(only_live, "source"), "only_replay_by_source": by(only_rep, "source"),
                     "only_live_by_route": by(only_live, "route_name"), "only_replay_by_route": by(only_rep, "route_name"),
                     "examples_only_live": [r[:1] + r[6:12] + r[-1:] for r in only_live[:5]],
                     "examples_only_replay": [r[:1] + r[6:12] + r[-1:] for r in only_rep[:5]]},
        "predictions": {"live": len(live_p), "replay": len(rep_p), "matched": len(ppairs),
                        "matched_changed": dict(p_changed), "only_live": len(p_only_live), "only_replay": len(p_only_rep),
                        "only_live_by_lead_min": lead(p_only_live), "only_replay_by_lead_min": lead(p_only_rep)},
        "coverage_10min": {"live": round(coverage(live_a, live_p), 4), "replay": round(coverage(rep_a, rep_p), 4)},
    }


# ---------------------------------------------------------------- main
def replay_day(day, out, cache=CACHE, source="auto", compare_live=False, live_pred=True, log=print, logged_last=False,
               job_times=True):
    cache, out = Path(cache), Path(out)
    out.mkdir(parents=True, exist_ok=True)
    t0, t1 = B.day_bounds(day)
    runs = []
    if source in ("auto", "artifacts"):
        runs = runs_from_artifacts(cache, day, artifact_index(cache), log=log, logged_last=logged_last)
        if runs and job_times:
            run_times(cache, runs, log=log)
        if runs and runs[0].t_first > t0 and source == "auto":
            log(f"{day}: the run artifacts start {(runs[0].t_first - t0) / 60:.0f} min into the day")
    if not runs and source in ("auto", "release"):
        runs = run_from_release(cache, day, log=log)
    if not runs:
        raise SystemExit(f"{day}: nothing to replay (no run artifacts, no release raw-polls)")
    statics = {}

    def st_for(r):
        d = day_str(r.t_first)
        if d not in statics:
            statics[d] = static_for(cache, d, log=log)
        return statics[d]

    first = min(r.t_first for r in runs)
    live_a_all = live_rows("data/ground_truth/arrivals.csv", len(L.COLUMNS), I_EP, first - 2 * L.STATE_TTL, t1)
    first_seed = min(r.seed_t for r in runs)
    seed = [dict(zip(L.COLUMNS, r)) for r in live_a_all if int(r[I_EP]) < first_seed - MERGE_LAG_S]
    work = cache / "work" / day
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)
    store_a, store_p = replay(runs, st_for, seed, work, log=log)
    rep_a = [r for r in read_rows(store_a.read_text(encoding="utf-8"), len(L.COLUMNS), I_EP) if t0 <= int(r[I_EP]) < t1]
    rep_p = [r for r in read_rows(store_p.read_text(encoding="utf-8"), len(L.PRED_COLUMNS), P_EP) if t0 <= int(r[P_EP]) < t1]
    live_a = [r for r in live_a_all if t0 <= int(r[I_EP]) < t1]
    filled = 0
    if live_pred:
        filled = fill_live_pred(rep_a, live_a, [(r.t_first, r.t_last) for r in runs if r.pred_src])
    rep_a.sort(key=lambda r: (int(r[I_EP]), r[I_VEH], r[I_STOP]))
    rep_p.sort(key=lambda r: (int(r[P_EP]), r[P_VEH], r[P_STOP], int(r[P_LEAD])))
    fa, fp = out / f"arrivals-{day}.csv", out / f"predictions-{day}.csv"
    fa.write_text(",".join(L.COLUMNS) + "\n" + "".join(L.row_text(r) for r in rep_a), encoding="utf-8", newline="")
    fp.write_text(",".join(L.PRED_COLUMNS) + "\n" + "".join(L.row_text(r) for r in rep_p), encoding="utf-8", newline="")
    rep_c = [r for r in BC.read_rows(work / "store_changes.csv") if t0 <= int(float(r["epoch"])) < t1]
    with open(out / f"bus_changes-{day}.csv", "w", encoding="utf-8", newline="") as f:
        cw = csv.DictWriter(f, fieldnames=list(BC.COLUMNS), lineterminator="\n", extrasaction="ignore")
        cw.writeheader()
        cw.writerows(rep_c)
    stats = {"day": day, "runs": len(runs), "pred_sources": dict(Counter(str(r.pred_src) for r in runs)),
             "arrivals": len(rep_a), "predictions": len(rep_p), "by_source": dict(Counter(r[-1] for r in rep_a)),
             "live_pred_filled": filled, "first_poll": first, "day_start": t0, "day_end": t1,
             "bus_changes": len(rep_c), "bus_drops": sum(1 for r in rep_c if r["kind"] == "drop")}
    log(f"{day}: replayed {len(rep_a)} arrivals ({stats['by_source']}), {len(rep_p)} prediction rows"
        + (f"; {filled} rows kept the live passio_pred columns (no prediction log then)" if filled else ""))
    if compare_live:
        live_p = live_rows("data/ground_truth/predictions.csv", len(L.PRED_COLUMNS), P_EP, t0, t1)
        stats["compare"] = compare(rep_a, rep_p, live_a, live_p)
        c = stats["compare"]
        a, p = c["arrivals"], c["predictions"]
        log(f"  arrivals: live {a['live']}, replay {a['replay']}, matched {a['matched']} "
            f"({100 * a['matched'] / max(1, a['live']):.2f}% of live; {a['exact_epoch']} same epoch, {a['matched_changed']} "
            f"with a changed field {a['changed_fields']}), only live {a['only_live']} {a['only_live_by_source']}, "
            f"only replay {a['only_replay']} {a['only_replay_by_source']}")
        log(f"  predictions: live {p['live']}, replay {p['replay']}, matched {p['matched']} "
            f"(changed {p['matched_changed']}), only live {p['only_live']} {p['only_live_by_lead_min']}, "
            f"only replay {p['only_replay']} {p['only_replay_by_lead_min']}")
        log(f"  10-min coverage: live {100 * c['coverage_10min']['live']:.1f}%, replay {100 * c['coverage_10min']['replay']:.1f}%")
    (out / f"replay-{day}.json").write_text(json.dumps(stats, indent=1), encoding="utf-8")
    return stats


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--day", nargs="+", required=True, help="service day(s) YYYY-MM-DD (04:00 to 04:00 Chicago)")
    ap.add_argument("--out", required=True, help="folder for arrivals-<day>.csv, predictions-<day>.csv, replay-<day>.json")
    ap.add_argument("--cache", default=str(CACHE), help=f"downloaded inputs and work files (default {CACHE})")
    ap.add_argument("--source", choices=("auto", "artifacts", "release"), default="auto")
    ap.add_argument("--compare", action="store_true", help="diff against origin/data's rows of the day (git fetch first)")
    ap.add_argument("--logged-last", action="store_true",
                    help="take each prediction update's logged last sighting as is (default: LAST_EXT_S s later, "
                         "estimate_last)")
    ap.add_argument("--no-job-times", action="store_true", help="seed / merge moments from fixed lags, not the job steps")
    ap.add_argument("--no-live-pred", action="store_true",
                    help="leave passio_pred_* empty where no prediction log exists (default: keep the live values)")
    a = ap.parse_args(argv)
    for d in a.day:
        replay_day(d, a.out, a.cache, a.source, a.compare, not a.no_live_pred, logged_last=a.logged_last,
                   job_times=not a.no_job_times)
    return 0


if __name__ == "__main__":
    sys.exit(main())
