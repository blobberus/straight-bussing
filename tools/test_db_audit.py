#!/usr/bin/env python3
"""Asserts on tools/db_audit.py (the whole-database audit, DC-026). Hermetic: a synthetic data branch in a temp folder
(and a temp git repo for the git mode), synthetic release assets and a synthetic public copy.
  python tools/test_db_audit.py        -> prints 'ok N/N tests', exits 1 on failure"""
import csv, io, json, shutil, subprocess, sys, tempfile, traceback
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import arrivals_lib as L
import alerts_lib as AL
import bus_changes as BC
import db_audit as A
import gtfs_versions as GV
import service_gate as G
from build_eta_dataset import SUMMARY_COLUMNS

TESTS = []
FIRST, LAST = date(2026, 10, 26), date(2026, 11, 10)       # service days of the synthetic data
ROUTES = (("1077", "East"), ("1078", "Central"))


def test(fn):
    TESTS.append(fn)
    return fn


def at(d, hh, mm=0):
    return int(datetime(d.year, d.month, d.day, hh, mm, tzinfo=G.CT).timestamp())


NOW = at(date(2026, 11, 11), 4, 30)                        # Wed 4:30 AM: Nov 10 finished, not archived yet


def arrival(e, rid, name, veh, stop, idx, source="transition", pred=True):
    t = L.chicago(e)
    r = {c: "" for c in L.COLUMNS}
    r.update(epoch=str(e), ts_utc=datetime.fromtimestamp(e, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
             local_time=t.strftime("%Y-%m-%d %H:%M:%S"), dow=str(t.weekday()), hour=str(t.hour),
             minute_of_day=str(t.hour * 60 + t.minute), route_id=rid, route_name=name, trip_id="T" + veh,
             vehicle_id=veh, stop_id=stop, stop_name="Stop " + stop, stop_lat="41.79", stop_lon="-87.60",
             stop_index=str(idx), dwell_s="0", source=source)
    if pred and source != "gps":
        r.update(passio_pred_epoch=str(e + 30), passio_pred_lead_s="300")
    return r


def prediction(r, lead=300):
    e = int(r["epoch"])
    p = {c: r.get(c, "") for c in L.PRED_COLUMNS}
    p.update(lead_target_s=str(lead), pred_epoch=str(e + 30), pred_made_epoch=str(e - lead - 20),
             pred_lead_s=str(lead + 20), pred_minus_actual_s="30", pred_seen_epoch=str(e - lead - 10))
    return p


def day_arrivals(d, every=15, skip_route=None):
    """Each route every `every` min from 6 AM to 10 PM; stops S0..S5 in turn (same bus and stop 90 min apart)."""
    out = []
    for i, (rid, name) in enumerate(ROUTES):
        if name == skip_route:
            continue
        t, n = at(d, 6), 0
        while t < at(d, 22):
            out.append(arrival(t + 7 * i, rid, name, f"V{i}", f"{name[0]}{n % 6}", n % 6))
            t += every * 60
            n += 1
    return sorted(out, key=lambda r: int(r["epoch"]))


def to_csv(cols, rows):
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=list(cols), lineterminator="\n", extrasaction="ignore")
    w.writeheader()
    w.writerows(rows)
    return buf.getvalue()


def days(a=FIRST, b=LAST):
    d = a
    while d <= b:
        yield d
        d += timedelta(days=1)


class World:
    """A clean synthetic database: data branch folder, release assets, public copy."""

    def __init__(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="dbaudit-"))
        self.arr = [r for d in days() for r in day_arrivals(d)]
        self.pred = [prediction(r) for r in self.arr[::5]]
        self.archived_pred = []
        alert_t = at(date(2026, 10, 27), 9)
        self.alerts = [{"alert_id": "1", "version": "abc123def456", "first_seen": str(alert_t),
                        "last_seen": str(alert_t + 3600), "first_seen_local": A.local(alert_t),
                        "last_seen_local": A.local(alert_t + 3600), "header": "Route help", "description": "Call"}]
        ch = at(date(2026, 11, 2), 12)
        self.changes = [{"route_id": "1077", "route_name": "East", "epoch": str(ch), "local_time": A.local(ch),
                         "kind": "drop", "buses_before": "2", "buses_after": "1", "vehicle_id": "V9", "lasting": "1"}]
        self.versions = [{"version": "abc", "first_seen": str(at(FIRST, 4)), "last_seen": str(NOW - 3 * 3600),
                          "file": "gtfs/gtfs-abc.zip"}]
        self.summary_days = [d for d in days(FIRST, LAST - timedelta(days=1))]
        self.assets = {}
        for d in days(FIRST, LAST - timedelta(days=1)):
            for k in A.H.archive_kinds(d):
                self.assets[f"{d:%Y-%m}/{k}-{d}{A.EXT[k]}"] = 50000

    def write(self):
        root = self.tmp / "branch"
        if root.exists():
            shutil.rmtree(root)
        gt = root / "data" / "ground_truth"
        (gt / "gtfs").mkdir(parents=True)
        (gt / "archive").mkdir()
        (root / "data" / "eta").mkdir()
        (gt / "arrivals.csv").write_text(to_csv(L.COLUMNS, self.arr), encoding="utf-8")
        (gt / "predictions.csv").write_text(to_csv(L.PRED_COLUMNS, self.pred), encoding="utf-8")
        if self.archived_pred:
            (gt / "archive" / "predictions-20261101-0000.csv").write_text(to_csv(L.PRED_COLUMNS, self.archived_pred),
                                                                         encoding="utf-8")
        (gt / "alerts.csv").write_text(to_csv(AL.COLUMNS, self.alerts), encoding="utf-8")
        (gt / "bus_changes.csv").write_text(to_csv(BC.COLUMNS, self.changes), encoding="utf-8")
        (gt / "gtfs_versions.csv").write_text(to_csv(GV.COLUMNS, self.versions), encoding="utf-8")
        (gt / "gtfs" / "gtfs-abc.zip").write_bytes(b"zip")
        rows = [{"service_day": str(d), "source": "passio", "lead_bin": "0-10", "route": "all", "segment": "all"}
                for d in self.summary_days]
        (root / "data" / "eta" / "summary.csv").write_text(to_csv(SUMMARY_COLUMNS, rows), encoding="utf-8")
        return root

    def mirror(self, header=None, drop=None, extra_row=None):
        """The public copy as the data repo's sync.py writes it (header= another header, drop= a (day, route) left out)."""
        m = self.tmp / "mirror"
        if m.exists():
            shutil.rmtree(m)
        h = list(L.COLUMNS)
        counts = A.mirror_counts(h, [[r[c] for c in h] for r in self.arr])
        groups = {}
        for r in self.arr:
            t = datetime.strptime(r["local_time"], "%Y-%m-%d %H:%M:%S")
            day = (t - timedelta(days=1)).strftime("%Y-%m-%d") if t.hour < 4 else t.strftime("%Y-%m-%d")
            groups.setdefault((day, r["route_name"]), []).append(r)
        idx = {"synced": datetime.fromtimestamp(NOW, timezone.utc).strftime("%Y-%m-%d %H:%M"), "rows": len(self.arr),
               "days": []}
        for day in sorted({k[0] for k in groups}):
            entry = {"day": day, "rows": 0, "routes": {}}
            for (d, route), rs in sorted(groups.items()):
                if d != day or (d, route) == drop:
                    continue
                rs = rs + ([extra_row] if extra_row and (d, route) == (extra_row["_day"], extra_row["route_name"]) else [])
                f = f"data/arrivals/{day}/{route.lower()}.csv"
                (m / f).parent.mkdir(parents=True, exist_ok=True)
                (m / f).write_text(to_csv(header or L.COLUMNS, rs), encoding="utf-8")
                entry["routes"][route] = {"file": f, "rows": len(rs), "route_id": rs[0]["route_id"]}
                entry["rows"] += len(rs)
            idx["days"].append(entry)
        assert sum(counts.values()) == len(self.arr)
        (m / "data" / "index.json").write_text(json.dumps(idx), encoding="utf-8")
        (m / "methodology").mkdir()
        (m / "methodology" / "RouteKnower.md").write_text("plan\n", encoding="utf-8")
        return m

    def run(self, mirror=None, main_text=None):
        return A.audit(A.Branch(folder=self.write()), NOW, self.assets, mirror, main_text, calendar={})

    def close(self):
        shutil.rmtree(self.tmp, ignore_errors=True)


def checks(res, level=None):
    return sorted({f["check"] for f in res.found if level is None or f["level"] == level})


def world():
    return World()


@test
def test_clean_database_has_no_errors_or_warnings():
    w = world()
    try:
        res = w.run()
        assert checks(res, "error") == [] and checks(res, "warn") == [], res.found
        assert res.facts["arrivals"] == len(w.arr) and res.facts["predictions"] == len(w.pred)
        assert res.facts["days"]["2026-11-03"]["rows"] == len(day_arrivals(date(2026, 11, 3)))
        assert checks(res, "note") == ["archive:waiting"], res.found      # yesterday (Nov 10) is not archived yet
    finally:
        w.close()


@test
def test_arrival_field_errors_are_caught():
    w = world()
    try:
        w.arr[10]["local_time"] = "2026-10-26 99:00:00"                      # disagrees with epoch
        w.arr[11]["source"] = "guess"
        w.arr[12]["stop_lat"] = "48.85"                                      # Paris
        w.arr[13]["passio_pred_lead_s"] = ""                                 # only one of the pair
        w.arr[14].update(prev_arrival_epoch=str(int(w.arr[14]["epoch"]) - 100), segment_s="99")
        w.arr[15]["vehicle_id"] = ""
        dup = dict(w.arr[20])
        dup["epoch"] = str(int(dup["epoch"]) + 120)                          # same bus and stop 2 min later
        dup.update(arrival(int(dup["epoch"]), dup["route_id"], dup["route_name"], dup["vehicle_id"], dup["stop_id"],
                           int(dup["stop_index"])))
        w.arr.append(dup)
        res = w.run()
        got = checks(res, "error")
        for c in ("arrivals:time", "arrivals:source", "arrivals:coords", "arrivals:pred_pair", "arrivals:segment",
                  "arrivals:ids", "arrivals:dups"):
            assert c in got, (c, got)
        dups = next(f for f in res.found if f["check"] == "arrivals:dups")
        assert dups["text"].startswith("1 duplicate") and "2026-10-26 1" in dups["text"], dups
    finally:
        w.close()


@test
def test_missing_day_line_drop_and_late_block():
    w = world()
    try:
        w.arr = [r for r in w.arr if not r["local_time"].startswith("2026-11-04")]
        w.arr = [r for r in w.arr if not (r["local_time"].startswith("2026-11-02") and r["route_name"] == "East")]
        old = day_arrivals(FIRST)[0]
        moved = arrival(int(old["epoch"]) + 60, old["route_id"], old["route_name"], "V7", "X1", 1)
        w.arr.append(moved)                                                  # a replayed row appended at the end
        res = w.run()
        assert "days:missing" in checks(res, "error"), res.found
        holiday = {"regimes": [{"start": "2026-11-04", "end": "2026-11-04", "regime": "holiday"}]}
        res2 = A.audit(A.Branch(folder=w.tmp / "branch"), NOW, w.assets, calendar=holiday)
        assert "days:missing" not in checks(res2) and "days:quiet" in checks(res2, "note"), res2.found
        assert any(f["check"] == "days:line:2026-11-02:East" and f["level"] == "warn" for f in res.found), res.found
        assert not any(f["check"].startswith("days:line:2026-11-02:Central") for f in res.found)
        order = next(f for f in res.found if f["check"] == "arrivals:order")
        assert order["level"] == "note" and "after 2026-11-10: 1 rows of 2026-10-26" in order["text"], order
    finally:
        w.close()


@test
def test_prediction_consistency_and_orphans():
    w = world()
    try:
        w.pred[0]["pred_lead_s"] = "100"                                     # below its 300 s target
        w.pred[1]["pred_minus_actual_s"] = "999"
        w.pred[2]["pred_seen_epoch"] = str(int(w.pred[2]["epoch"]) - 10)     # seen after epoch - lead
        w.pred[3]["lead_target_s"] = "301"
        orphan = dict(w.pred[4])
        orphan["vehicle_id"] = "V99"
        w.pred.append(orphan)
        w.pred.append(dict(w.pred[5]))                                       # an exact duplicate
        w.archived_pred = [prediction(r, 60) for r in w.arr[1:40:5]]         # a rotated file is read as well
        res = w.run()
        got = checks(res, "error")
        for c in ("predictions:pred_lead", "predictions:pma", "predictions:seen", "predictions:lead", "predictions:dups"):
            assert c in got, (c, got)
        assert "predictions:orphan" in checks(res, "warn"), res.found
        assert res.facts["predictions"] == len(w.pred) + len(w.archived_pred)
    finally:
        w.close()


@test
def test_small_files_keys_and_times():
    w = world()
    try:
        w.changes.append(dict(w.changes[0], epoch=str(int(w.changes[0]["epoch"]) + 60),
                              local_time=A.local(int(w.changes[0]["epoch"]) + 60)))     # the same drop twice
        w.changes.append(dict(w.changes[0], kind="drop", buses_after="2"))              # count does not step
        w.alerts.append(dict(w.alerts[0]))
        w.versions[0]["file"] = "gtfs/gtfs-missing.zip"
        w.summary_days.append(w.summary_days[0])
        res = w.run()
        got = checks(res, "error")
        for c in ("bus_changes:dups", "bus_changes:kind", "alerts:dups", "gtfs_versions:file", "summary:dups"):
            assert c in got, (c, got)
        w.versions[0].update(file="gtfs/gtfs-abc.zip", last_seen=str(NOW - 5 * 86400))
        assert "gtfs_versions:stale" in checks(world_run(w), "warn")
    finally:
        w.close()


def world_run(w):
    w.changes, w.alerts, w.summary_days = w.changes[:1], w.alerts[:1], w.summary_days[:-1]
    return w.run()


@test
def test_archive_kinds_by_era_waiting_and_summary():
    w = world()
    try:
        del w.assets["2026-10/bus-changes-2026-10-30.csv.gz"]               # bus-changes exist from Oct 30
        del w.assets["2026-11/alerts-2026-11-03.csv.gz"]
        for k in list(w.assets):                                            # Nov 9 (day before yesterday): nothing
            if "2026-11-09" in k:
                del w.assets[k]
        w.assets["2026-11/eta-2026-11-02.csv.gz"] = 40                       # a near-empty table on a day with service
        w.assets["2026-10/raw-polls-2026-11-01.jsonl.gz"] = 50000           # on the wrong month's release
        w.summary_days.remove(date(2026, 11, 5))
        res = w.run()
        missing = next(f for f in res.found if f["check"] == "archive:missing")
        assert missing["level"] == "error"
        for part in ("2026-10-30 (bus-changes)", "2026-11-03 (alerts)", "2026-11-09 (raw-polls, pred-updates, eta, gtfs"):
            assert part in missing["text"], (part, missing)
        assert "2026-10-29" not in missing["text"] and "2026-11-10" not in missing["text"], missing
        assert "archive:waiting" in checks(res, "note")
        assert "archive:tiny" in checks(res, "warn") and "archive:month" in checks(res, "warn")
        assert "summary:missing" in checks(res, "error")
        assert "2026-11-09" in next(f["text"] for f in res.found if f["check"] == "summary:extra")
    finally:
        w.close()


@test
def test_mirror_header_counts_and_methodology():
    w = world()
    try:
        res = w.run(w.mirror(), main_text=lambda rel: "plan\n" if rel == "RouteKnower.md" else None)
        assert not [f for f in res.found if f["check"].startswith("mirror")], res.found
        assert res.facts["mirror"]["files"] == 2 * len(list(days()))
        # the bug of 2026-10-29: a rotated predictions file read as arrivals gave every file the predictions header
        res = w.run(w.mirror(header=L.PRED_COLUMNS), main_text=lambda rel: "a newer plan\n")
        assert "mirror:header" in checks(res, "error") and "mirror:methodology" in checks(res, "warn"), res.found
        extra = dict(w.arr[0], epoch=str(int(w.arr[0]["epoch"]) + 1), _day="2026-10-26")
        res = w.run(w.mirror(drop=("2026-11-02", "East"), extra_row=extra))
        got = checks(res, "error")
        assert "mirror:missing" in got and "mirror:counts" in got, res.found
        text = next(f["text"] for f in res.found if f["check"] == "mirror:counts")
        assert "2026-10-26 Central" in text or "2026-10-26 East" in text, text
        # the newest hours may lag the sync: rows after (sync - 2 h) are not compared
        late = arrival(NOW - 1800, "1077", "East", "V5", "E9", 9)
        w.arr.append(late)
        m = w.mirror()
        w.arr.remove(late)
        res = w.run(m)
        assert not [f for f in res.found if f["check"].startswith("mirror")], res.found
    finally:
        w.close()


@test
def test_known_findings_are_notes():
    a = A.Audit()
    a.add("error", "days:gap:2026-10-28", "No arrival on any route 7:40 PM to 8:10 PM")
    a.add("error", "days:gap:2026-10-29", "No arrival on any route")
    assert [f["level"] for f in a.found] == ["note", "error"] and "DC-021" in a.found[0]["text"]
    assert a.errors() == 1


@test
def test_git_mode_reads_the_branch():
    w = world()
    repo = w.tmp / "repo"
    try:
        root = w.write()
        shutil.copytree(root, repo)
        g = lambda *x: subprocess.run(["git", "-C", str(repo), "-c", "user.name=t", "-c", "user.email=t@example.invalid",
                                       "-c", "core.autocrlf=false", *x], capture_output=True, text=True, check=True)
        g("init", "-q")
        g("checkout", "-q", "-b", "data")
        g("add", "-A")
        g("commit", "-q", "-m", "data")
        b = A.Branch(ref="data", repo=repo)
        assert "data/ground_truth/arrivals.csv" in b.names() and b.text("data/nope.csv") is None
        res = A.audit(b, NOW, w.assets, calendar={})
        assert checks(res, "error") == [] and res.facts["arrivals"] == len(w.arr), res.found
    finally:
        w.close()


@test
def test_cli_exit_codes():
    w = world()
    try:
        root = w.write()
        (w.tmp / "assets.json").write_text(json.dumps(w.assets), encoding="utf-8")
        base = ["--dir", str(root), "--assets", str(w.tmp / "assets.json"), "--now", str(NOW), "--json",
                str(w.tmp / "out.json")]
        assert A.main(base) == 0
        assert json.loads((w.tmp / "out.json").read_text(encoding="utf-8"))["facts"]["arrivals"] == len(w.arr)
        w.arr.append(dict(w.arr[0]))                                         # an exact duplicate row
        w.write()
        assert A.main(base + ["--days"]) == 1
    finally:
        w.close()


def main():
    fails = 0
    for fn in TESTS:
        try:
            fn()
            print("pass", fn.__name__)
        except Exception:
            fails += 1
            print("FAIL", fn.__name__)
            traceback.print_exc()
    print(f"{'ok' if not fails else 'FAILED'} {len(TESTS) - fails}/{len(TESTS)} tests")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
