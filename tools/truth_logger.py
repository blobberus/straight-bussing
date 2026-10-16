#!/usr/bin/env python3
"""Ground-truth arrival logger: polls Passio vehiclePositions + tripUpdates and appends one CSV row
per true bus arrival at a stop (schema in arrivals_lib.COLUMNS, docs in docs/DATA.md).

  python tools/truth_logger.py --once
  python tools/truth_logger.py --duration 180
  python tools/truth_logger.py --out some.csv --interval 10
  python tools/truth_logger.py --seed arrivals.csv --out run.csv   # new rows only (CI; merge_arrivals.py)
  python tools/truth_logger.py ... --status-file s.json            # polls/rows/error counts at exit (CI)
  python tools/truth_logger.py ... --raw-out raw.jsonl              # also keep every position poll (E03)
  python tools/truth_logger.py ... --pred-out run_pred.csv          # Passio's prediction 1-30 min ahead per arrival
  python tools/truth_logger.py ... --pred-log p.jsonl --pred-seed old.jsonl   # keep / reload prediction updates
  python tools/truth_logger.py ... --alerts-out run_alerts.csv     # Passio's service alerts, one row per version
A failed fetch, bad JSON or a malformed feed entry only skips that feed or entry for one poll; it is
counted (status line, final 'done:' line, --status-file) and the run keeps going. Service alerts are polled
in their own thread (AlertLog) with their own counters, so they can never delay or stop the arrival loop.
No rider data exists in these feeds; nothing personal is collected.
"""
import argparse, gzip, json, sys, threading, time, traceback, urllib.request, zlib
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import arrivals_lib as L
from arrival_detector import Tracker
try:
    import alerts_lib as AL
    AL_ERROR = ""
except Exception as _ex:                         # alerts are optional: a broken module never stops arrival logging
    AL, AL_ERROR = None, f"{type(_ex).__name__}: {_ex}"

BASE = "https://passio3.com/chicago/passioTransit/gtfs/realtime/"
UA = "StraightBussing-collector (student project)"


def decode_body(body, encoding=None):
    """Feed bytes -> JSON. gzip (header or magic bytes) and deflate are unpacked; plain bytes pass through."""
    enc = (encoding or "").strip().lower()
    if "gzip" in enc or body[:2] == b"\x1f\x8b":
        body = gzip.decompress(body)
    elif "deflate" in enc:
        try:
            body = zlib.decompress(body)
        except zlib.error:                       # raw deflate without the zlib header
            body = zlib.decompress(body, -zlib.MAX_WBITS)
    return json.loads(body.decode("utf-8"))


def fetch(name, timeout=15):
    """One realtime feed. Asks for gzip (tripUpdates ~84 kB -> ~5 kB); an uncompressed reply still works."""
    req = urllib.request.Request(BASE + name + ".json", headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return decode_body(r.read(), r.headers.get("Content-Encoding"))


class Errors:
    """Counts failed fetches and processing errors and logs them to stderr, sampled (first 20, then every
    100th) so a feed that is malformed on every poll cannot flood the log."""
    def __init__(self, out=None):
        self.fetch = self.proc = 0
        self.first = ""
        self.out = out

    def __call__(self, where, ex, fetch=False):
        if fetch:
            self.fetch += 1
            n, kind, loc = self.fetch, "fetch", ""
        else:
            self.proc += 1
            n, kind, loc = self.proc, "ERROR", ""
            tb = traceback.extract_tb(ex.__traceback__) if ex.__traceback__ else None
            if tb:
                loc = f" at {Path(tb[-1].filename).name}:{tb[-1].lineno}"
            if not self.first:
                self.first = f"{where}: {type(ex).__name__}: {ex}{loc}"[:300]
        if n <= 20 or n % 100 == 0:
            more = " (from now on only every 100th is logged)" if n == 20 else ""
            print(f"{datetime.now():%H:%M:%S} {kind} {where}: {type(ex).__name__}: {ex}{loc}{more}",
                  file=self.out or sys.stderr, flush=True)


def reports(feed, err=None):
    for e in feed.get("entity", []):
        try:
            v = e.get("vehicle") or {}
            pos, trip, veh = v.get("position") or {}, v.get("trip") or {}, v.get("vehicle") or {}
            if "latitude" not in pos or not trip.get("trip_id"):
                continue
            rep = {"veh": veh.get("id"), "trip": trip.get("trip_id"), "route": trip.get("route_id"),
                   "lat": pos.get("latitude"), "lon": pos.get("longitude"), "speed": pos.get("speed"),
                   "q": v.get("current_stop_sequence"), "stop_id": v.get("stop_id"), "vt": v.get("timestamp")}
        except Exception as ex:
            if err is None:
                raise
            err("vehiclePositions entity", ex)
            continue
        yield rep


def feed_summary(feed):
    """Vehicles in a vehiclePositions feed: with a position, on a trip, reported in the last 5 min (feed clock).
    Logged with each status line so a quiet night can be told apart from a detector problem."""
    ents = [e.get("vehicle") or {} for e in feed.get("entity", [])]
    pos = [v for v in ents if "latitude" in (v.get("position") or {})]
    head = (feed.get("header") or {}).get("timestamp") or 0
    try:
        head = int(head)
    except (TypeError, ValueError):
        head = 0
    fresh = [v for v in pos if head and head - int(v.get("timestamp") or 0) <= 300]
    return {"veh": len(pos), "trip": sum(1 for v in pos if (v.get("trip") or {}).get("trip_id")), "fresh": len(fresh)}


def store_predictions(tr, feed, now, err=None):
    for e in feed.get("entity", []):
        try:
            u = e.get("trip_update") or {}
            trip = (u.get("trip") or {}).get("trip_id")
            v = u.get("vehicle")                 # buses can share a trip id: keep predictions per bus
            veh = v.get("id") if isinstance(v, dict) else None
            made = u.get("timestamp") or now
            made = min(made, now)
            for st in u.get("stop_time_update") or []:
                t = (st.get("arrival") or st.get("departure") or {}).get("time")
                if trip and t is not None and st.get("stop_id"):
                    tr.add_prediction(trip, st["stop_id"], made, t, st.get("stop_sequence"), veh, seen=now, last=now)
        except Exception as ex:
            if err is None:
                raise
            err("tripUpdates entity", ex)


class RawPolls:
    """Every vehiclePositions poll as one JSON line (RouteKnower E03: real positions for the Kalman model M8):
      {"t": poll epoch, "h": feed header timestamp, "v": [[RAW_FIELDS...], ...]}
    Kept as a 90-day CI artifact, not on the data branch. Overlapping runs repeat polls: dedupe on
    (vehicle, vt). A line is written for an empty feed too, so a quiet poll differs from a missed one."""
    FIELDS = ("veh", "trip", "route", "lat", "lon", "bearing", "speed", "q", "stop_id", "status", "vt")

    def __init__(self, path):
        self.path, self.n = Path(path), 0
        self.path.parent.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def rows(feed):
        out = []
        for e in feed.get("entity", []):
            v = (e or {}).get("vehicle") if isinstance(e, dict) else None
            if not isinstance(v, dict) or not isinstance(v.get("position"), dict):
                continue
            pos, trip, veh = v["position"], v.get("trip") or {}, v.get("vehicle") or {}
            trip, veh = (trip if isinstance(trip, dict) else {}), (veh if isinstance(veh, dict) else {})
            out.append([veh.get("id"), trip.get("trip_id"), trip.get("route_id"), pos.get("latitude"),
                        pos.get("longitude"), pos.get("bearing"), pos.get("speed"), v.get("current_stop_sequence"),
                        v.get("stop_id"), v.get("current_status"), v.get("timestamp")])
        return out

    def write(self, now, feed):
        line = {"t": now, "h": (feed.get("header") or {}).get("timestamp"), "v": self.rows(feed)}
        with open(self.path, "a", encoding="utf-8", newline="\n") as f:
            f.write(json.dumps(line, separators=(",", ":")) + "\n")
        self.n += 1


def poll(tr, w, now, err, get=fetch, raw=None):
    """One poll of both feeds. Any failure (network, bad JSON, a malformed entry, a detector bug, the raw
    poll file) goes to err() and only skips that feed or entry for this poll, never the run.
    -> feed_summary or None."""
    try:
        feed = get("tripUpdates")
    except Exception as ex:
        err("tripUpdates", ex, fetch=True)
    else:
        try:
            store_predictions(tr, feed, now, err)
        except Exception as ex:                  # not a feed object at all
            err("tripUpdates", ex)
    try:
        feed = get("vehiclePositions")
    except Exception as ex:
        err("vehiclePositions", ex, fetch=True)
        return None
    if raw is not None:
        try:
            raw.write(now, feed)
        except Exception as ex:
            err("raw polls", ex)
    summary, ev = None, []
    try:
        summary = feed_summary(feed)
    except Exception as ex:
        err("vehiclePositions summary", ex)
    try:
        for rep in reports(feed, err):
            try:
                ev += tr.update(rep, now)
            except Exception as ex:
                err(f"detector update (vehicle {rep.get('veh')})", ex)
    except Exception as ex:
        err("vehiclePositions", ex)
    try:
        ev += tr.drain(now)
    except Exception as ex:
        err("detector drain", ex)
    try:
        w.write(ev)
    except Exception as ex:
        err("write rows", ex)
    return summary


def _open_csv(path, columns):
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists() or path.stat().st_size == 0:
        path.write_text(",".join(columns) + "\n", encoding="utf-8", newline="\n")
    else:                                        # a crash mid-write may leave a partial last line
        with open(path, "rb+") as f:
            f.seek(-1, 2)
            if f.read(1) != b"\n":
                f.write(b"\n")


class Writer:
    """arrivals.csv rows; with pred_path also predictions.csv rows (L.PRED_COLUMNS) for the same arrivals."""
    def __init__(self, path, st, pred_path=None):
        self.path, self.st, self.n, self.np = Path(path), st, 0, 0
        self.pred_path = Path(pred_path) if pred_path else None
        _open_csv(self.path, L.COLUMNS)
        if self.pred_path:
            _open_csv(self.pred_path, L.PRED_COLUMNS)

    def write(self, events):
        if not events:
            return
        events.sort(key=lambda e: e.get("epoch") or 0)
        done = []
        with open(self.path, "a", encoding="utf-8", newline="") as f:
            for e in events:
                try:
                    f.write(L.row_text(L.fmt_row(self.st, e)))
                    self.n += 1
                    done.append(e)
                except (KeyError, IndexError, TypeError, ValueError) as ex:   # stop missing from static data
                    print(f"skip row {e.get('route')}/{e.get('idx')}: {ex!r}", file=sys.stderr)
            f.flush()
        if self.pred_path and done:
            with open(self.pred_path, "a", encoding="utf-8", newline="") as f:
                for e in done:
                    try:
                        for row in L.fmt_pred_rows(self.st, e):
                            f.write(L.row_text(row))
                            self.np += 1
                    except (KeyError, IndexError, TypeError, ValueError) as ex:
                        print(f"skip predictions {e.get('route')}/{e.get('idx')}: {ex!r}", file=sys.stderr)
                f.flush()


class PredLog:
    """Every new Passio prediction update as one JSON line [veh, trip, stop_id, made, predicted, seq, seen, last]
    (again about once a minute while it stays on display, with a newer last): lets the
    next run start with the last hour of predictions (--pred-seed), so 30-min-ahead rows exist from its first
    minute, and keeps what Passio said for re-analysis (CI artifact)."""
    def __init__(self, path):
        self.path, self.n, self.buf = Path(path), 0, []
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def __call__(self, veh, trip, stop_id, made, predicted, seq, seen=None, last=None):
        seen = made if seen is None else seen
        self.buf.append([veh, trip, stop_id, made, predicted, seq, seen, seen if last is None else last])

    def flush(self):
        if not self.buf:
            return
        with open(self.path, "a", encoding="utf-8", newline="\n") as f:
            f.write("".join(json.dumps(x, separators=(",", ":")) + "\n" for x in self.buf))
        self.n += len(self.buf)
        self.buf = []


class AlertLog:
    """Passio serviceAlerts as alert versions (alerts_lib): polled at start and then every `every` s in a daemon
    thread; after each good poll the whole run file is rewritten (one row per version this run saw, last_seen
    moved on). merge_alerts.py merges it into data/ground_truth/alerts.csv.
    Isolation from the 10 s arrival loop: own thread, own timeout (in `get`), own counters (fetch_errors, errors,
    last_error); poll() never raises. Why a thread and not an inline fetch every 30th poll: urllib's timeout bounds
    each socket read, not the whole request, and the DNS lookup has none, so an inline fetch could still hold the
    arrival loop far past its timeout. The thread shares nothing with the detector."""

    def __init__(self, path, get, every=300.0, route_name=None, out=None):
        self.path, self.get, self.every, self.route_name, self.out = Path(path), get, float(every), route_name, out
        self.rows, self.lock, self.halt, self.thread = {}, threading.Lock(), threading.Event(), None
        self.polls = self.ok = self.fetch_errors = self.errors = self.in_feed = 0
        self.last_error = ""
        AL.write_csv(self.path, [])                  # header only: this run is collecting alerts

    def _note(self, kind, ex):
        self.last_error = f"{kind}: {type(ex).__name__}: {ex}"[:300]
        n = self.fetch_errors + self.errors
        if n <= 20 or n % 100 == 0:
            print(f"{datetime.now():%H:%M:%S} alerts {kind}: {type(ex).__name__}: {ex}",
                  file=self.out or sys.stderr, flush=True)

    def poll(self, now=None):
        """One fetch + record. Never raises. -> True if the feed was read and the file written."""
        self.polls += 1
        t = int(time.time() if now is None else now)
        try:
            feed = self.get()
        except Exception as ex:
            self.fetch_errors += 1
            self._note("fetch", ex)
            return False
        try:
            rows = AL.versions(feed, t, self.route_name)
            with self.lock:
                for r in rows:
                    AL.absorb(self.rows, r)
                self.in_feed = len(rows)
                AL.write_csv(self.path, list(self.rows.values()))
            self.ok += 1
            return True
        except Exception as ex:
            self.errors += 1
            self._note("error", ex)
            return False

    def _loop(self):
        while True:
            try:
                self.poll()
            except Exception as ex:                  # poll() never raises; belt and braces for the thread
                self.errors += 1
                self._note("error", ex)
            if self.halt.wait(self.every):
                return

    def start(self):
        self.thread = threading.Thread(target=self._loop, name="serviceAlerts", daemon=True)
        self.thread.start()
        return self

    def stop(self, wait=10.0):
        """Ends the thread, waiting up to `wait` s for a fetch in flight (daemon: a hung one never blocks exit)."""
        self.halt.set()
        if self.thread is not None:
            self.thread.join(wait)

    def status(self):
        return {"alert_polls": self.polls, "alert_ok": self.ok, "alert_fetch_errors": self.fetch_errors,
                "alert_errors": self.errors, "alert_last_error": self.last_error, "alert_versions": len(self.rows),
                "alert_in_feed": self.in_feed}


def seed_predictions(tr, paths, now, max_age=L.PRED_SEED_S):
    """Reload prediction updates made in the last max_age s from PredLog files -> how many were added."""
    n = 0
    for p in paths:
        try:
            lines = Path(p).read_text(encoding="utf-8").splitlines()
        except OSError:
            continue
        for ln in lines:
            try:
                x = json.loads(ln)
                veh, trip, stop_id, made, pred, seq = x[:6]
                seen = x[6] if len(x) > 6 else made          # logs written before 'seen' existed
                last = x[7] if len(x) > 7 else seen
                if now - max_age <= made <= now:
                    tr.add_prediction(trip, stop_id, made, pred, seq, veh, seen=seen, last=last)
                    n += 1
            except (ValueError, TypeError):
                continue
    for k in list(tr.preds):                     # several logs, out of order: keep each deque time-sorted
        d = tr.preds[k]
        best = {}                                # one entry per update: its earliest and latest sighting
        for x in d:
            b = best.get(x[:3])
            best[x[:3]] = x if b is None else x[:3] + (min(b[3], x[3]), max(b[4], x[4]))
        tr.preds[k] = type(d)(sorted(best.values(), key=lambda x: (x[3], x[0], x[1])), maxlen=d.maxlen)
    return n


def rotate(path, max_mb):
    """Keep the live CSV small (GitHub rejects files > 100 MB): archive it once it passes max_mb."""
    if max_mb <= 0 or not path.exists() or path.stat().st_size < max_mb * 1e6:
        return
    dest = path.parent / "archive" / f"{path.stem}-{datetime.now(timezone.utc):%Y%m%d-%H%M}.csv"
    dest.parent.mkdir(parents=True, exist_ok=True)
    path.replace(dest)
    print(f"rotated {path} -> {dest}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true", help="single poll then exit")
    ap.add_argument("--duration", type=float, help="seconds to run")
    ap.add_argument("--interval", type=float, default=10, help="seconds between polls (min 5)")
    ap.add_argument("--out", default=str(L.DEFAULT_OUT))
    ap.add_argument("--rotate-mb", type=float, default=0,
                    help="at start, move --out to archive/<name>-<UTC date>.csv if larger than this (0 = never)")
    ap.add_argument("--seed", help="CSV whose tail seeds the detector (default --out); lets a run write only its own rows")
    ap.add_argument("--status-file", help="write {polls, rows, errors, fetch_errors, ...} as JSON here at exit")
    ap.add_argument("--raw-out", help="append every vehiclePositions poll here as JSON lines (RawPolls)")
    ap.add_argument("--pred-out", help="also write predictions.csv rows here (Passio's prediction 1-30 min ahead)")
    ap.add_argument("--pred-log", help="append every new Passio prediction update here as JSON lines (PredLog)")
    ap.add_argument("--pred-seed", nargs="*", default=[], help="PredLog files to reload the last hour from")
    ap.add_argument("--alerts-out", help="Passio's service alerts as version rows (CSV, alerts_lib.COLUMNS), "
                                         "rewritten after each alerts poll (AlertLog)")
    ap.add_argument("--alerts-every", type=float, default=300, help="seconds between serviceAlerts polls (min 30; "
                                                                     "the first is at start)")
    ap.add_argument("--alerts-timeout", type=float, default=8, help="serviceAlerts request timeout, seconds")
    a = ap.parse_args()
    a.interval = max(5.0, a.interval)
    st = L.Static()
    if not st.route_stops:
        sys.exit("web/data/route_stops.json missing (run tools/build_gtfs.py)")
    rotate(Path(a.out), a.rotate_mb)
    tr, w, err = Tracker(st), Writer(a.out, st, a.pred_out), Errors()
    plog = None
    try:
        n = seed_predictions(tr, a.pred_seed, int(time.time())) if a.pred_seed else 0
        if a.pred_seed:
            print(f"pred seed: {n} prediction updates from {len(a.pred_seed)} file(s)")
    except Exception as ex:                      # only costs the long leads for the first half hour
        err("pred seed", ex)
    if a.pred_log:
        try:
            plog = PredLog(a.pred_log)
            tr.on_pred = plog
        except OSError as ex:
            err("pred log", ex)
    raw = None
    if a.raw_out:
        try:
            raw = RawPolls(a.raw_out)
        except OSError as ex:                    # raw polls are optional: never stop arrival logging
            err("raw polls", ex)
    try:
        tr.seed(L.read_tail(a.seed or a.out), int(time.time()))
    except Exception as ex:                      # a bad seed only costs duplicate protection (merge dedupes too)
        err("seed", ex)
    alerts, alerts_setup = None, ""
    if a.alerts_out:                             # own thread + counters: never part of err / the arrival loop
        try:
            if AL is None:
                raise ImportError(AL_ERROR)
            # route_names: Passio's alerts can name its own id (North = 38734, GTFS 1075): Static.alert_route maps it
            # the way the app does (DC-009); route_ids stay verbatim; no match = blank
            alerts = AlertLog(a.alerts_out, lambda: fetch("serviceAlerts", timeout=a.alerts_timeout),
                              every=max(30.0, a.alerts_every),
                              route_name=lambda rid: st.route_name(g) if (g := st.alert_route(rid)) else "").start()
        except Exception as ex:
            alerts, alerts_setup = None, f"setup: {type(ex).__name__}: {ex}"[:300]
            print(f"alerts off for this run ({alerts_setup})", file=sys.stderr, flush=True)
    end = time.time() + a.duration if a.duration else None
    started, polls, summary = time.time(), 0, {}
    try:
        while True:
            t0 = time.time()
            s = poll(tr, w, int(t0), err, raw=raw)
            if plog is not None:
                try:
                    plog.flush()
                except OSError as ex:
                    err("pred log", ex)
            if s is not None:
                summary = s
            polls += 1
            if polls % 6 == 0:
                feed_txt = " ".join(f"{k}={v}" for k, v in summary.items())
                bad = (f" errors={err.proc}" if err.proc else "") + (f" fetch_errors={err.fetch}" if err.fetch else "")
                if alerts is not None:
                    bad += f" alerts={alerts.in_feed}" + (f" alert_fails={alerts.fetch_errors + alerts.errors}"
                                                          if alerts.fetch_errors + alerts.errors else "")
                print(f"{datetime.now():%H:%M:%S} polls={polls} rows={w.n} {feed_txt}{bad}".rstrip(), flush=True)
            if a.once or (end and time.time() + a.interval > end):
                break
            time.sleep(max(0.5, a.interval - (time.time() - t0)))
    except KeyboardInterrupt:
        pass
    finally:
        try:
            w.write(tr.drain(int(time.time()), final=True))
        except Exception as ex:
            err("final drain", ex)
        al = None
        if alerts is not None:
            try:
                alerts.stop(wait=a.alerts_timeout + 2)
                al = alerts.status()
            except Exception as ex:
                al = {"alert_polls": alerts.polls, "alert_last_error": f"stop: {type(ex).__name__}: {ex}"[:300]}
        elif alerts_setup:
            al = {"alert_polls": 0, "alert_last_error": alerts_setup}
        if a.status_file:
            try:
                Path(a.status_file).write_text(json.dumps(
                    {"started": int(started), "ended": int(time.time()), "duration": a.duration, "polls": polls,
                     "rows": w.n, "errors": err.proc, "fetch_errors": err.fetch, "first_error": err.first,
                     "raw_polls": raw.n if raw else None, "pred_rows": w.np if a.pred_out else None,
                     "pred_updates": plog.n if plog else None, **(al or {})}),
                    encoding="utf-8")
            except OSError as ex:
                print(f"could not write {a.status_file}: {ex}", file=sys.stderr)
    al_txt = ""
    if al is not None:
        al_txt = (f"; alerts: {al.get('alert_versions', 0)} versions to {a.alerts_out}, {al.get('alert_ok', 0)} of "
                  f"{al.get('alert_polls', 0)} polls ok" + (f" (last error {al['alert_last_error']})"
                                                            if al.get("alert_last_error") else ""))
    print(f"done: {w.n} rows appended to {a.out}; polls={polls} errors={err.proc} fetch_errors={err.fetch}"
          + (f"; {w.np} prediction rows to {a.pred_out}" if a.pred_out else "") + al_txt)


if __name__ == "__main__":
    main()
