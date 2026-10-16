#!/usr/bin/env python3
"""Asserts on the service alert collection: tools/alerts_lib.py (feed -> alert versions), truth_logger.AlertLog
(polling thread, isolation from the arrival loop), tools/merge_alerts.py (dedupe, last_seen extension),
archive_day.alerts_of_day, monitor.py's local publish of alerts, and collect.yml's wiring.
Hermetic: no network (fetch is replaced), temp dirs, a local bare git repo for the monitor test.
  python tools/test_alerts.py        -> prints 'ok N tests', exits 1 on failure (~10 s)"""
import contextlib, csv, gzip, io, json, os, shutil, subprocess, sys, tempfile, threading, time, traceback
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS))
import alerts_lib as AL
import merge_alerts as M
import truth_logger as TL

T = 1792011000
TESTS = []


def test(fn):
    TESTS.append(fn)
    return fn


_TMPS = []


def tmp():
    """A fresh temp dir, removed when the tests end (they used to pile up in %TEMP%)."""
    d = Path(tempfile.mkdtemp(prefix="sb-alerts-"))
    _TMPS.append(d)
    return d


def tr(text, lang=None):
    t = {"text": text}
    if lang is not None:
        t["language"] = lang
    return {"translation": [t]}


def sample_feed():
    """The live feed of 2026-10-14 ~5:40 PM (three alerts; Passio adds startDatetime / endDatetime strings)."""
    return {"header": {"gtfs_realtime_version": "2.0", "incrementality": 0, "timestamp": T + 6699}, "entity": [
        {"id": "1", "alert": {"informed_entity": [{"agency_id": "1068"}],
                              "header_text": tr("Central & East Night Ride route modified"),
                              "description_text": tr("The Central East Night Ride route will run every 30 minutes "
                                                     "until 6:30 pm, before returning to15 minute intervals."),
                              "active_period": [{"start": 1792011134, "startDatetime": "2026-10-14 15:52:14",
                                                 "end": 1792020600, "endDatetime": "2026-10-14 18:30:00"}]}},
        {"id": "2", "alert": {"informed_entity": [{"route_id": "38734"}], "header_text": tr("North Route"),
                              "description_text": tr("The North route will run every 30 minutes throughout the evening."),
                              "active_period": [{"start": 1792011300, "end": 1792040400}]}},
        {"id": "3", "alert": {"informed_entity": [{"agency_id": "1068"}], "header_text": tr("UGo Bus Route Assistance"),
                              "description_text": tr("If you do not see buses, please contact (773) 573-7201."),
                              "active_period": [{"start": 1792011625, "end": 1801378225}]}}]}


def alert_entity(aid="9", text="Detour on 55th", end=T + 3600, route="1075", cause=None, effect=None):
    al = {"header_text": tr(text), "description_text": tr("Use Kimbark, \"stop 2\" closed,\nback at 6 PM"),
          "active_period": [{"start": T, "end": end}], "informed_entity": [{"route_id": route}, {"stop_id": "140014"}]}
    if cause is not None:
        al["cause"] = cause
    if effect is not None:
        al["effect"] = effect
    return {"id": aid, "alert": al}


# ---------------------------------------------------------------- parsing
@test
def a_sample_feed_gives_one_row_per_alert():
    names = {"1075": "North"}
    rows = AL.versions(sample_feed(), T + 100, lambda r: names.get(r, ""))
    assert [r["alert_id"] for r in rows] == ["1", "2", "3"], rows
    r1, r2 = rows[0], rows[1]
    assert r1["first_seen"] == r1["last_seen"] == T + 100 and r1["first_seen_local"] == "2026-10-14 15:51:40", r1
    assert (r1["active_start"], r1["active_end"]) == (1792011134, 1792020600), r1
    assert r1["active_start_local"] == "2026-10-14 15:52:14" and r1["active_end_local"] == "2026-10-14 18:30:00"
    assert r1["active_periods"] == "1792011134/1792020600" and r1["agency_ids"] == "1068" and r1["route_ids"] == ""
    assert r1["header"] == "Central & East Night Ride route modified" and r1["description"].startswith("The Central")
    assert r1["cause"] == r1["effect"] == "" and r1["stop_ids"] == ""
    # Passio's own route id (not GTFS): the id is kept, the name stays blank
    assert r2["route_ids"] == "38734" and r2["route_names"] == "" and r2["agency_ids"] == ""
    assert all(len(r["version"]) == 12 for r in rows) and len({r["version"] for r in rows}) == 3
    assert set(rows[0]) == set(AL.COLUMNS)


@test
def empty_junk_and_non_feeds():
    assert AL.versions({"entity": []}, T) == [] and AL.versions({}, T) == [] and AL.versions({"entity": None}, T) == []
    junk = [None, "x", 7, {"id": "a"}, {"id": "b", "alert": "text"}, {"id": "c", "is_deleted": True, "alert": {}},
            alert_entity("d"), alert_entity("d")]                 # the same alert twice in one feed: one row
    rows = AL.versions({"entity": junk}, T)
    assert [r["alert_id"] for r in rows] == ["d"], rows
    for bad in (None, [], "feed", 42):
        try:
            AL.versions(bad, T)
            raise AssertionError(f"no error for {bad!r}")
        except ValueError:
            pass


@test
def missing_fields_open_periods_and_translations():
    r = AL.versions({"entity": [{"alert": {}}]}, T)[0]          # nothing but an empty alert
    assert r["alert_id"] == "" and r["header"] == r["description"] == "" and r["active_periods"] == ""
    assert r["active_start"] == r["active_end"] == "" and r["active_start_local"] == ""
    al = {"header_text": {"translation": [{"text": "Desvio", "language": "es"}, {"text": "Detour", "language": "en"}]},
          "description_text": {"translation": [{"text": "Sin ingles", "language": "es"}, {"language": "fr"}, "junk"]},
          "active_period": [{"start": str(T + 600), "end": T + 900}, {"start": T}, "junk", {"end": None}],
          "informed_entity": [{"trip": {"trip_id": "t1", "route_id": "5701"}}, {"route_id": 1075}, "junk",
                              {"agency_id": "1068", "route_id": "1075", "stop_id": "140014"}],
          "cause": "CONSTRUCTION", "effect": 3}
    r = AL.versions({"entity": [{"id": 5, "alert": al}]}, T, lambda rid: {"1075": "North"}.get(rid, ""))[0]
    assert r["alert_id"] == "5" and r["header"] == "Detour" and r["description"] == "Sin ingles", r
    assert r["active_periods"] == "/;" + f"{T}/;{T + 600}/{T + 900}", r["active_periods"]   # sorted, blanks = open
    assert r["active_start"] == "" and r["active_end"] == ""     # one period has no start / end: open
    assert r["route_ids"] == "1075;5701" and r["route_names"] == "North;" and r["stop_ids"] == "140014"
    assert r["cause"] == "CONSTRUCTION" and r["effect"] == "3" and r["agency_ids"] == "1068"
    assert AL.text_of("plain") == "plain" and AL.text_of({"translation": "x"}) == "" and AL.text_of(None) == ""
    assert AL.text_of({"translation": [{"text": "Hola", "language": "es"}]}) == "Hola"
    assert AL.text_of({"translation": [{"text": "Hi", "language": "en-US"}, {"text": "x"}]}) == "Hi"
    bad_period = {"active_period": [{"start": "soon", "end": [1]}]}
    assert AL.versions({"entity": [{"id": "z", "alert": bad_period}]}, T)[0]["active_periods"] == "/"


@test
def versions_change_with_content_not_with_order():
    base = alert_entity()["alert"]
    v = AL.version_of(base)
    same = json.loads(json.dumps(base))
    same["informed_entity"].reverse()
    same["active_period"][0]["startDatetime"] = "2026-10-14 15:50:00"      # Passio's extra strings do not count
    same["header_text"]["translation"][0] = {"language": None, "text": "Detour on 55th"}
    assert AL.version_of(same) == v
    for change in ({"header_text": tr("Detour on 57th")}, {"description_text": tr("other")}, {"cause": "WEATHER"},
                   {"effect": "DETOUR"}, {"active_period": [{"start": T, "end": T + 7200}]},
                   {"informed_entity": [{"route_id": "1076"}]}, {"active_period": []}):
        assert AL.version_of({**base, **change}) != v, change
    assert AL.version_of({**base, "url": tr("https://x")}) == v            # only the six documented fields


# ---------------------------------------------------------------- AlertLog (collector side)
def feeds(seq):
    """A fake fetch that returns (or raises) the next item each call."""
    it = iter(seq)

    def get():
        x = next(it)
        if isinstance(x, Exception):
            raise x
        return x
    return get


@test
def alert_log_writes_versions_and_moves_last_seen():
    d = tmp()
    a, a2 = {"entity": [alert_entity()]}, {"entity": [alert_entity(text="Detour on 55th, extended", end=T + 9000)]}
    log = TL.AlertLog(d / "run_alerts.csv", feeds([a, a, a2, {"entity": []}, a]), out=io.StringIO())
    assert (d / "run_alerts.csv").read_text(encoding="utf-8") == AL.HEADER       # header only before any poll
    for k in range(5):
        assert log.poll(now=T + 300 * k)
    rows, bad = AL.read_csv(d / "run_alerts.csv")
    assert not bad and len(rows) == 2, rows
    v1, v2 = rows
    assert (int(v1["first_seen"]), int(v1["last_seen"])) == (T, T + 1200), v1    # seen at 0, 300 and again at 1200
    assert (int(v2["first_seen"]), int(v2["last_seen"])) == (T + 600, T + 600), v2
    assert v1["alert_id"] == v2["alert_id"] == "9" and v1["version"] != v2["version"]
    assert v1["description"] == "Use Kimbark, \"stop 2\" closed,\nback at 6 PM"           # verbatim through CSV
    assert v1["last_seen_local"] == AL.local(T + 1200)
    s = log.status()
    assert s["alert_polls"] == s["alert_ok"] == 5 and s["alert_versions"] == 2 and s["alert_in_feed"] == 1, s
    assert not list(d.glob("*.tmp"))


@test
def alert_log_failures_are_counted_never_raised():
    d = tmp()
    out = io.StringIO()
    log = TL.AlertLog(d / "a.csv", feeds([OSError("timed out"), ValueError("bad json"), ["not", "a", "feed"], 42,
                                          {"entity": [alert_entity()]}]), out=out)
    results = [log.poll(now=T + k) for k in range(5)]
    assert results == [False, False, False, False, True], results
    s = log.status()
    assert s["alert_fetch_errors"] == 2 and s["alert_errors"] == 2 and s["alert_ok"] == 1, s
    assert "not a feed object" in s["alert_last_error"] and "alerts fetch: OSError: timed out" in out.getvalue()
    real = AL.write_csv                                       # the run file cannot be written: counted, no raise

    def locked(*a):
        raise PermissionError("locked")

    AL.write_csv = locked
    try:
        log.get = lambda: {"entity": [alert_entity()]}
        assert log.poll(now=T + 9) is False and log.errors == 3 and "PermissionError" in log.last_error
    finally:
        AL.write_csv = real
    assert log.poll(now=T + 10) and int(AL.read_csv(d / "a.csv")[0][0]["last_seen"]) == T + 10


@test
def a_hanging_alerts_feed_never_delays_the_arrival_poll():
    """The alerts thread blocks in its fetch; the 10 s position / prediction poll runs at full speed, the main
    error counters stay at zero, and stop() returns after its short wait (daemon thread)."""
    d = tmp()
    release = threading.Event()

    def hang():
        release.wait(5)
        raise OSError("timed out")

    log = TL.AlertLog(d / "a.csv", hang, every=0.05, out=io.StringIO()).start()
    import arrivals_lib as L
    from arrival_detector import Tracker
    st = L.Static()
    trk, w, err = Tracker(st), TL.Writer(d / "run.csv", st), TL.Errors(out=io.StringIO())
    t0 = time.time()
    for k in range(20):
        TL.poll(trk, w, T + 10 * k, err, get=lambda name: {"header": {"timestamp": T}, "entity": []})
    took = time.time() - t0
    assert took < 1.0, took
    t1 = time.time()
    log.stop(wait=0.2)
    assert time.time() - t1 < 1.0 and log.thread.is_alive()    # still stuck in its fetch; exit does not wait for it
    release.set()
    log.thread.join(5)
    assert not log.thread.is_alive() and log.fetch_errors >= 1 and err.proc == err.fetch == 0


@test
def the_thread_polls_at_start_and_then_on_its_interval():
    d = tmp()
    calls = []

    def get():
        calls.append(time.time())
        return {"entity": [alert_entity()]}

    log = TL.AlertLog(d / "a.csv", get, every=0.1, out=io.StringIO()).start()
    time.sleep(0.35)
    log.stop(wait=2)
    assert 2 <= len(calls) <= 6, len(calls)
    assert not log.thread.is_alive() and log.ok == len(calls) and AL.read_csv(d / "a.csv")[0]


class Resp:
    def __init__(self, obj):
        self.body, self.headers = json.dumps(obj).encode("utf-8"), {}

    def read(self):
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def run_logger(d, argv, fetch):
    """truth_logger.main() in-process; every feed request goes to fetch(name, timeout) (no network). urlopen is
    replaced, not TL.fetch: poll() holds the real fetch as a default argument."""
    real_open, real_argv = TL.urllib.request.urlopen, sys.argv

    def fake_urlopen(req, timeout=None):
        name = req.full_url.rsplit("/", 1)[-1].split(".json")[0]
        return Resp(fetch(name, timeout))

    TL.urllib.request.urlopen = fake_urlopen
    sys.argv = ["truth_logger.py", *argv]
    out = io.StringIO()
    try:
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
            TL.main()
    finally:
        TL.urllib.request.urlopen, sys.argv = real_open, real_argv
    return out.getvalue(), json.loads((d / "s.json").read_text(encoding="utf-8"))


@test
def logger_main_keeps_alert_failures_out_of_the_arrival_counters():
    d = tmp()
    asked = []

    def fetch(name, timeout=15):
        asked.append((name, timeout))
        if name == "serviceAlerts":
            raise OSError("alerts down")
        return {"header": {"timestamp": int(time.time())}, "entity": []}

    out, s = run_logger(d, ["--once", "--out", str(d / "run.csv"), "--status-file", str(d / "s.json"),
                            "--alerts-out", str(d / "a.csv"), "--alerts-timeout", "1.5"], fetch)
    assert sorted(asked) == [("serviceAlerts", 1.5), ("tripUpdates", 15), ("vehiclePositions", 15)], asked
    assert s["polls"] == 1 and s["errors"] == 0 and s["fetch_errors"] == 0, s
    assert s["alert_polls"] == 1 and s["alert_fetch_errors"] == 1 and "alerts down" in s["alert_last_error"], s
    assert "0 of 1 polls ok" in out and "alerts down" in out, out
    assert (d / "a.csv").read_text(encoding="utf-8") == AL.HEADER

    def fetch_ok(name, timeout=15):
        if name == "serviceAlerts":
            return sample_feed()
        return {"header": {"timestamp": int(time.time())}, "entity": []}

    d2 = tmp()
    out, s = run_logger(d2, ["--once", "--out", str(d2 / "run.csv"), "--status-file", str(d2 / "s.json"),
                             "--alerts-out", str(d2 / "a.csv")], fetch_ok)
    assert s["alert_versions"] == 3 and s["alert_ok"] == 1 and s["errors"] == 0, s
    rows = AL.read_csv(d2 / "a.csv")[0]
    assert [r["alert_id"] for r in rows] == ["1", "2", "3"], rows
    # 38734 is Passio's own id for North (its trips' shape, routes.json alias_ids; DC-009): named, the id kept verbatim
    assert rows[1]["route_ids"] == "38734" and rows[1]["route_names"] == "North", rows[1]
    out, s = run_logger(d2, ["--once", "--out", str(d2 / "run2.csv"), "--status-file", str(d2 / "s.json")], fetch_ok)
    assert "alert_polls" not in s and "alerts:" not in out, s                 # no --alerts-out: no alert polling


@test
def a_broken_alerts_module_only_turns_alerts_off():
    d = tmp()
    real = TL.AL, TL.AL_ERROR
    TL.AL, TL.AL_ERROR = None, "SyntaxError: boom"
    try:
        out, s = run_logger(d, ["--once", "--out", str(d / "run.csv"), "--status-file", str(d / "s.json"),
                                "--alerts-out", str(d / "a.csv")],
                            lambda name, timeout=15: {"header": {"timestamp": int(time.time())}, "entity": []})
    finally:
        TL.AL, TL.AL_ERROR = real
    assert s["polls"] == 1 and s["errors"] == 0 and s["alert_polls"] == 0 and "boom" in s["alert_last_error"], s
    assert "alerts off for this run" in out and (d / "run.csv").exists()


# ---------------------------------------------------------------- merge_alerts.py
def run_file(path, polls):
    """polls: [(now, feed)] -> the CSV an AlertLog would write."""
    log = TL.AlertLog(path, feeds([f for _, f in polls]), out=io.StringIO())
    for now, _ in polls:
        log.poll(now=now)
    return path


@test
def merge_dedupes_extends_last_seen_and_is_idempotent():
    d = tmp()
    a, a2 = {"entity": [alert_entity()]}, {"entity": [alert_entity(text="Detour on 55th, extended", end=T + 9000)]}
    run_file(d / "r1.csv", [(T, a), (T + 300, a)])
    run_file(d / "r2.csv", [(T + 240, a), (T + 540, a), (T + 840, a2)])      # overlapping run, later
    run_file(d / "r0.csv", [(T - 300, a)])                                     # a run that saw it earlier
    into = d / "gt" / "alerts.csv"
    s = M.merge(into, [d / "r1.csv"])
    assert s == dict(added=1, extended=0, same=0, bad=0, total=1), s
    s = M.merge(into, [d / "r2.csv"])
    assert s["added"] == 1 and s["extended"] == 1 and s["total"] == 2, s
    s = M.merge(into, [d / "r0.csv"])
    assert s["extended"] == 1 and s["added"] == 0, s
    rows = AL.read_csv(into)[0]
    assert [(int(r["first_seen"]), int(r["last_seen"])) for r in rows] == [(T - 300, T + 540), (T + 840, T + 840)]
    assert rows[0]["first_seen_local"] == AL.local(T - 300) and rows[0]["last_seen_local"] == AL.local(T + 540)
    before = into.read_bytes()
    s = M.merge(into, [d / "r1.csv", d / "r2.csv", d / "r0.csv"])
    assert s["added"] == s["extended"] == 0 and s["same"] == 4 and into.read_bytes() == before, s
    assert rows[0]["description"] == "Use Kimbark, \"stop 2\" closed,\nback at 6 PM"
    assert not list((d / "gt").glob("*.tmp"))


@test
def an_alert_keeps_one_row_when_passio_renumbers_it():
    # DC-012 (2026-10-16): Passio's entity id is the alert's place in the feed; "UGo Bus Route Assistance" was 2 while
    # the North alert was listed first, then 1. One version = one row, every id it had.
    d = tmp()
    ugo = lambda aid: alert_entity(aid=aid, text="UGo Bus Route Assistance", end=T + 86400, route="")
    run_file(d / "r1.csv", [(T, {"entity": [alert_entity(aid="1"), ugo("2")]}), (T + 300, {"entity": [ugo("1")]})])
    rows = AL.read_csv(d / "r1.csv")[0]
    u = [r for r in rows if r["header"] == "UGo Bus Route Assistance"]
    assert len(u) == 1 and u[0]["alert_id"] == "1;2" and (int(u[0]["first_seen"]), int(u[0]["last_seen"])) == (T, T + 300), u
    # the same alert under two ids in one feed (a duplicate entity): still one row
    assert [r["alert_id"] for r in AL.versions({"entity": [ugo("4"), ugo("3")]}, T)] == ["3;4"]
    # rows an older merge split by id collapse at the next merge (the shared file migrates itself)
    into = d / "gt" / "alerts.csv"
    old = [dict(r, alert_id=i, first_seen=f, last_seen=l) for r in u for i, f, l in (("2", T - 600, T), ("1", T + 300, T + 900))]
    AL.write_csv(into, old)
    assert len(AL.read_csv(into)[0]) == 2
    s = M.merge(into, [d / "r1.csv"])
    rows = [r for r in AL.read_csv(into)[0] if r["header"] == "UGo Bus Route Assistance"]
    assert len(rows) == 1 and rows[0]["alert_id"] == "1;2" and s["total"] == 2, (s, rows)
    assert (int(rows[0]["first_seen"]), int(rows[0]["last_seen"])) == (T - 600, T + 900), rows
    assert AL.join_ids("10;2", "2", "", "x") == "2;10;x"


@test
def an_alert_route_id_maps_like_the_app():
    # DC-009: Passio's own route id = the route's GTFS shape id (routes.json alias_ids); the same rule as the app
    from types import SimpleNamespace
    import arrivals_lib
    st = SimpleNamespace(routes={"1075": {"long": "North", "alias_ids": ["38734"]}, "5703": {"alias_ids": ["38731", "38809"]},
                                 "9": {"alias_ids": ["777"]}, "8": {"alias_ids": ["777"]}})
    f = lambda rid: arrivals_lib.Static.alert_route(st, rid)
    assert f("1075") == "1075" and f("38734") == "1075" and f("38809") == "5703"
    assert f("777") is None, "two routes claim it: no route"
    assert f("12345") is None and f("") is None


@test
def merge_skips_bad_run_rows_and_keeps_odd_shared_rows():
    d = tmp()
    run_file(d / "r1.csv", [(T, {"entity": [alert_entity()]})])
    good = (d / "r1.csv").read_text(encoding="utf-8")
    bad = good + "9,abc,not-a-number,5" + "," * (len(AL.COLUMNS) - 4) + "\n" + "x,,1,2" + "," * (len(AL.COLUMNS) - 4) + "\n"
    (d / "bad.csv").write_text(bad, encoding="utf-8", newline="")
    into = d / "alerts.csv"
    s = M.merge(into, [d / "bad.csv"])
    assert s["added"] == 1 and s["bad"] == 2, s
    odd = ",".join(["hand", "edit"] + [""] * (len(AL.COLUMNS) - 3) + ["note"]) + "\n"   # a hand edit, no epochs
    into.write_text(into.read_text(encoding="utf-8") + odd, encoding="utf-8", newline="")
    s = M.merge(into, [d / "r1.csv"])
    assert s.get("kept_unreadable") == 1 and s["same"] == 1 and "hand,edit" in into.read_text(encoding="utf-8"), s
    assert M.merge(d / "new.csv", [d / "empty.csv"])["total"] == 0                # missing run file: header only
    assert (d / "new.csv").read_text(encoding="utf-8") == AL.HEADER


@test
def merge_cli():
    d = tmp()
    run_file(d / "r1.csv", [(T, {"entity": [alert_entity()]})])
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        assert M.main(["--into", str(d / "gt" / "alerts.csv"), "--add", str(d / "missing.csv")]) == 0
        assert M.main(["--into", str(d / "gt" / "alerts.csv"), "--add", str(d / "r1.csv"), str(d / "missing.csv")]) == 0
    assert "nothing to add" in out.getvalue() and "added=1" in out.getvalue(), out.getvalue()
    r = subprocess.run([sys.executable, str(TOOLS / "merge_alerts.py"), "--into", str(d / "gt" / "alerts.csv"),
                        "--add", str(d / "r1.csv")], capture_output=True, text=True)
    assert r.returncode == 0 and "same=1" in r.stdout, r.stdout + r.stderr


# ---------------------------------------------------------------- archive_day.py
@test
def archive_keeps_the_alert_versions_of_each_service_day():
    import archive_day as A
    import build_eta_dataset as B
    d = tmp()
    t0, t1 = B.day_bounds("2026-10-14")
    a = {"entity": [alert_entity(aid="1")]}
    b = {"entity": [alert_entity(aid="2", text="Snow")]}
    run_file(d / "r.csv", [(t0 - 600, a), (t0 + 600, a), (t1 + 60, b)])
    M.merge(d / "alerts.csv", [d / "r.csv"])
    assert [r["alert_id"] for r in A.alerts_of_day(d / "alerts.csv", "2026-10-14")] == ["1"]
    assert [r["alert_id"] for r in A.alerts_of_day(d / "alerts.csv", "2026-10-15")] == ["2"]
    assert A.alerts_of_day(d / "alerts.csv", "2026-10-12") is None              # before collection began
    assert A.alerts_of_day(d / "missing.csv", "2026-10-14") is None and A.alerts_of_day(None, "2026-10-14") is None
    A.write_alerts(A.alerts_of_day(d / "alerts.csv", "2026-10-14"), d / "x.csv.gz")
    with gzip.open(d / "x.csv.gz", "rt", encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))
    assert len(rows) == 1 and rows[0]["description"] == "Use Kimbark, \"stop 2\" closed,\nback at 6 PM"


# ---------------------------------------------------------------- monitor.py local publish
def sh(*args, cwd=None):
    r = subprocess.run(list(args), cwd=cwd, capture_output=True, text=True)
    assert r.returncode == 0, f"{args}: {r.stderr}"
    return r.stdout


@test
def monitor_publishes_alerts_and_a_broken_alerts_merge_never_blocks_arrivals():
    d = tmp()
    bare, repo = d / "origin.git", d / "repo"
    sh("git", "init", "-q", "--bare", "-b", "main", str(bare))
    sh("git", "init", "-q", "-b", "main", str(repo))
    (repo / "tools").mkdir()
    for f in ("monitor.py", "merge_arrivals.py", "arrivals_lib.py", "merge_alerts.py", "alerts_lib.py"):
        shutil.copy(TOOLS / f, repo / "tools" / f)
    (repo / ".gitignore").write_text("data/monitor/\n__pycache__/\n", encoding="utf-8")
    for k, v in (("user.name", "t"), ("user.email", "t@t"), ("core.autocrlf", "false")):
        sh("git", "config", k, v, cwd=repo)
    sh("git", "add", "-A", cwd=repo)
    sh("git", "commit", "-qm", "init", cwd=repo)
    sh("git", "remote", "add", "origin", str(bare), cwd=repo)
    sh("git", "push", "-q", "origin", "main", cwd=repo)
    import importlib.util
    spec = importlib.util.spec_from_file_location("monitor_alerts_test", repo / "tools" / "monitor.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    ctx = m.Ctx(root=repo)
    for x in (ctx.dir, ctx.runs, ctx.merged):
        x.mkdir(parents=True, exist_ok=True)
    import arrivals_lib as L
    hdr = ",".join(L.COLUMNS) + "\n"
    # 1) a night chunk: no arrivals, one alert version -> still published
    night = ctx.runs / "run-1.csv"
    night.write_text(hdr, encoding="utf-8")
    run_file(ctx.runs / "alerts-1.csv", [(T, {"entity": [alert_entity()]})])
    assert m.alerts_partner(night).name == "alerts-1.csv" and m.has_alerts(night) and not m.has_rows(night)
    ok, added, msg = m.publish(ctx, [night], model=False)
    assert ok and added == 0, msg
    shared = sh("git", "--git-dir", str(bare), "show", "data:data/ground_truth/alerts.csv")
    assert len(list(csv.DictReader(io.StringIO(shared)))) == 1, shared
    # 2) merge_alerts.py broken: the arrival rows are still pushed, alerts.csv unchanged
    (repo / "tools" / "merge_alerts.py").write_text("raise SystemExit('broken on purpose')\n", encoding="utf-8")
    day = ctx.runs / "run-2.csv"
    r = {c: "" for c in L.COLUMNS}
    r.update(epoch=str(T), vehicle_id="V1", trip_id="T1", stop_id="A", stop_index="0", source="transition")
    day.write_text(hdr + ",".join(r[c] for c in L.COLUMNS) + "\n", encoding="utf-8")
    run_file(ctx.runs / "alerts-2.csv", [(T + 600, {"entity": [alert_entity(text="changed")]})])
    ok, added, msg = m.publish(ctx, [day], model=False)
    assert ok and added == 1, msg
    assert sh("git", "--git-dir", str(bare), "show", "data:data/ground_truth/alerts.csv") == shared
    assert "alerts merge failed" in ctx.log.read_text(encoding="utf-8")
    trips = [x["trip_id"] for x in csv.DictReader(io.StringIO(
        sh("git", "--git-dir", str(bare), "show", "data:data/ground_truth/arrivals.csv")))]
    assert trips == ["T1"], trips
    # 3) publish_pending moves the alert partners to merged/ with their run files
    st = {}
    m.publish_pending(ctx, st, [], model=False)
    assert not list(ctx.runs.glob("*.csv")) and {p.name for p in ctx.merged.glob("alerts-*.csv")} == {"alerts-1.csv", "alerts-2.csv"}


# ---------------------------------------------------------------- collect.yml wiring
def step(yml, name):
    """The `run: |` body of the collect.yml step whose name starts with `name`, dedented."""
    lines = yml.splitlines()
    i = next(k for k, ln in enumerate(lines) if ln.strip().startswith(f"- name: {name}"))
    j = next(k for k in range(i + 1, len(lines)) if lines[k].strip().startswith("run: |"))
    body, ind = [], None
    for ln in lines[j + 1:]:
        if ln.strip() and ind is None:
            ind = len(ln) - len(ln.lstrip())
        if ln.strip() and len(ln) - len(ln.lstrip()) < ind:
            break
        body.append(ln[ind:] if ln.strip() else "")
    return "\n".join(body) + "\n"


@test
def collect_yml_collects_and_merges_alerts_without_risking_arrivals():
    yml = (TOOLS.parent / ".github" / "workflows" / "collect.yml").read_text(encoding="utf-8")
    log = step(yml, "Log arrivals")
    assert '--alerts-out "$RUNNER_TEMP/run_alerts.csv"' in log
    merge = step(yml, "Merge into the data branch")
    start = merge.index("for i in 1 2 3 4 5")
    loop = merge[start:merge.index("\ndone", start)]
    call = loop[loop.index("tools/merge_alerts.py"):]
    assert "databranch/data/ground_truth/alerts.csv" in call and "|| echo" in call.split("\n")[1], call
    assert loop.index("merge_alerts.py") < loop.index("git -C databranch add -A data")
    assert "sparse-checkout set --cone data/ground_truth web/data" in loop       # alerts.csv is inside the cone
    # the run-summary script (Python inside the YAML) reports alerts and warns only when they failed
    check = step(yml, "Check the logging run")
    py = check[check.index("<<'EOF'\n") + len("<<'EOF'\n"):check.rindex("EOF")]
    d = tmp()
    (d / "log.t0").write_text(str(int(time.time()) - 70 * 60), encoding="utf-8")
    base = {"polls": 420, "rows": 300, "errors": 0, "fetch_errors": 0, "first_error": ""}
    for status, want_warn in (({**base, "alert_polls": 15, "alert_ok": 15, "alert_fetch_errors": 0, "alert_errors": 0,
                                "alert_versions": 3, "alert_last_error": ""}, False),
                              ({**base, "alert_polls": 15, "alert_ok": 2, "alert_fetch_errors": 13, "alert_errors": 0,
                                "alert_versions": 3, "alert_last_error": "fetch: URLError: down"}, True),
                              ({**base, "alert_polls": 0, "alert_last_error": "setup: ImportError: x"}, True),
                              (base, False)):
        (d / "logger.json").write_text(json.dumps(status), encoding="utf-8")
        summ = d / "summary.md"
        summ.write_text("", encoding="utf-8")
        r = subprocess.run([sys.executable, "-", str(d)], input=py, capture_output=True, text=True,
                           env={**os.environ, "OUTCOME": "success", "GITHUB_STEP_SUMMARY": str(summ)})
        assert r.returncode == 0, r.stderr
        assert ("Service alerts not collected" in r.stdout) == want_warn, (status, r.stdout)
        assert "Collector run degraded" not in r.stdout, r.stdout                 # alerts never degrade the run
        assert ("alerts:" in r.stdout) == ("alert_polls" in status), r.stdout


def main():
    fails = 0
    for fn in TESTS:
        t0 = time.time()
        try:
            fn()
            print(f"pass {fn.__name__} ({time.time() - t0:.1f}s)")
        except Exception:
            fails += 1
            print("FAIL", fn.__name__)
            traceback.print_exc()
    print(f"{'ok' if not fails else 'FAILED'} {len(TESTS) - fails}/{len(TESTS)} tests")
    for d in _TMPS:   # git's object files are read-only on Windows: make them writable, then retry
        shutil.rmtree(d, onerror=lambda f, p, e: (os.chmod(p, 0o700), f(p)) if os.path.exists(p) else None)
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
