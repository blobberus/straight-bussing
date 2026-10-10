#!/usr/bin/env python3
"""Asserts on the ground-truth arrival detector (tools/arrivals_lib.py) using synthetic bus positions.
  python tools/test_truth.py        -> prints 'ok N tests', exits 1 on failure"""
import json, math, random, sys, tempfile, traceback
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import arrivals_lib as L
from arrival_detector import Tracker

SPEC_HEADER = ("epoch,ts_utc,local_time,dow,hour,minute_of_day,route_id,route_name,trip_id,vehicle_id,stop_id,"
               "stop_name,stop_address,stop_lat,stop_lon,stop_index,prev_stop_id,dist_prev_m,prev_arrival_epoch,"
               "segment_s,speed_mps,dwell_s,passio_pred_epoch,passio_pred_lead_s,source")
LAT, LON0, STEP = 41.79, -87.600, 0.003            # stops ~249 m apart on an east-west line
T0 = 1791400000


def fake_static():
    st = L.Static(web_data=Path(tempfile.gettempdir()) / "sb-no-such-dir")
    st.stops = {s: {"name": "Stop " + s, "lat": LAT, "lon": LON0 + STEP * i} for i, s in enumerate("ABCD")}
    st.stops["X"] = {"name": "Off-route", "lat": LAT + 0.01, "lon": LON0}
    st.route_stops = {"R": ["A", "B", "C", "D", "A"], "S": ["A", "B", "X", "D", "A"]}
    st.routes = {"R": {"short": "R", "long": "Test Loop"}, "S": {"short": "S", "long": "Skip Loop"}}
    return st


def simulate(st, path, t0=T0, speed=8.0, dwell=20, poll=10, trip="T1", veh="V1", route="R",
             no_stop=(), noise_m=0.0, seed=1, lead_m=150.0, flip_m=None):
    """Bus drives in from `lead_m` m west of the first stop, then along `path` (stop ids, route
    order), dwelling at each stop except `no_stop`. stop_id = the stop being approached; it switches
    to the next stop on departure, or (Passio-like, `flip_m`) once the bus is within flip_m of it.
    -> (reports, truth {path index: arrival epoch})"""
    rnd = random.Random(seed)
    pts = [(st.stops[s]["lat"], st.stops[s]["lon"]) for s in path]
    start = (pts[0][0], pts[0][1] - lead_m / (111320 * math.cos(math.radians(LAT))))
    tl, t = [], float(t0)                          # (arrive, depart) per path index
    for i in range(len(path)):
        t += L.hav_m(*(pts[i - 1] if i else start), *pts[i]) / speed
        dw = 0 if path[i] in no_stop else dwell
        if i == 0 and not lead_m:
            dw = max(dw, 15)                       # already waiting at its first stop
        tl.append((t, t + dw))
        t += dw
    reps, now = [], t0 + 3
    while now < tl[-1][1] + 25:
        i = next((k for k, (a, d) in enumerate(tl) if now <= d), len(tl) - 1)
        a, d = tl[i]
        if now >= a:
            lat, lon, sp = pts[i][0], pts[i][1], 0.0
        else:
            p0, ts = (pts[i - 1], tl[i - 1][1]) if i else (start, t0)
            f = (now - ts) / (a - ts)
            lat, lon, sp = p0[0] + f * (pts[i][0] - p0[0]), p0[1] + f * (pts[i][1] - p0[1]), speed
        si = i + 1 if flip_m and i + 1 < len(path) and L.hav_m(lat, lon, *pts[i]) <= flip_m else i
        if noise_m:
            lat += rnd.gauss(0, noise_m) / 111320
            lon += rnd.gauss(0, noise_m) / (111320 * math.cos(math.radians(LAT)))
        reps.append({"veh": veh, "trip": trip, "route": route, "lat": lat, "lon": lon, "speed": sp,
                     "q": None, "stop_id": path[si], "vt": int(now)})
        now += poll
    return reps, {i: a for i, (a, _) in enumerate(tl)}


def run(tr, reps, final=True):
    out = []
    for r in reps:
        out += tr.update(r, r["vt"] + 2)
        out += tr.drain(r["vt"] + 2)
    if final:
        out += tr.drain(reps[-1]["vt"] + 5, final=True)
    return sorted(out, key=lambda e: e["epoch"])


TESTS = []


def test(fn):
    TESTS.append(fn)
    return fn


@test
def header_matches_spec():
    assert ",".join(L.COLUMNS) == SPEC_HEADER and len(L.COLUMNS) == 25


@test
def basic_loop_every_stop_once_within_10s():
    st = fake_static()
    reps, truth = simulate(st, ["A", "B", "C", "D", "A"])
    ev = run(Tracker(st), reps)
    assert [e["idx"] for e in ev] == [0, 1, 2, 3, 4], [e["idx"] for e in ev]
    for e in ev:
        assert abs(e["epoch"] - truth[e["idx"]]) <= 10, (e["idx"], e["epoch"] - truth[e["idx"]])
    for e in ev[:-1]:
        assert e["dwell"] is not None and 10 <= e["dwell"] <= 30, e["dwell"]
    rows = [dict(zip(L.COLUMNS, L.fmt_row(st, e))) for e in ev]
    for r in rows[1:]:
        assert r["prev_stop_id"] and float(r["dist_prev_m"]) > 0, r
        assert 0 < float(r["speed_mps"]) <= 20, r["speed_mps"]
    assert rows[0]["prev_stop_id"] == "" and rows[4]["stop_index"] == 4 and rows[4]["stop_id"] == "A"


@test
def pass_through_without_stopping_is_a_transition():
    st = fake_static()
    reps, truth = simulate(st, ["A", "B", "C", "D"], no_stop={"C"}, seed=3)
    ev = run(Tracker(st), reps)
    c = [e for e in ev if e["idx"] == 2]
    assert len(c) == 1 and c[0]["source"] == "transition", ev
    assert abs(c[0]["epoch"] - truth[2]) <= 10, c[0]["epoch"] - truth[2]


@test
def gps_jitter_and_stop_id_flapping_do_not_duplicate():
    st = fake_static()
    reps, _ = simulate(st, ["A", "B", "C", "D"], noise_m=8.0, seed=5)
    flap = []
    for r in reps:                                  # stop_id bounces back for one report after each switch
        if flap and flap[-1]["stop_id"] != r["stop_id"]:
            flap.append(dict(r))
            flap.append(dict(r, stop_id=flap[-2]["stop_id"], vt=r["vt"] + 3))
            flap.append(dict(r, vt=r["vt"] + 6))
        else:
            flap.append(r)
    ev = run(Tracker(st), flap)
    idx = [e["idx"] for e in ev]
    assert sorted(idx) == [0, 1, 2, 3] and len(set(idx)) == len(idx), idx


@test
def skipped_stop_links_previous_seen_stop():
    st = fake_static()
    reps, _ = simulate(st, ["A", "B", "D"], route="S")     # X is never approached
    ev = run(Tracker(st), reps)
    assert [e["idx"] for e in ev] == [0, 1, 3], [e["idx"] for e in ev]
    r = dict(zip(L.COLUMNS, L.fmt_row(st, ev[2])))
    assert r["prev_stop_id"] == "B" and float(r["dist_prev_m"]) > 400, r


@test
def trip_flip_at_terminal_is_one_visit():
    st = fake_static()
    r1, t1 = simulate(st, ["A", "B", "C", "D", "A"], trip="T1", dwell=20)
    end = r1[-1]["vt"]
    r2, t2 = simulate(st, ["A", "B", "C"], t0=end + 7, trip="T2", dwell=120, lead_m=0)
    tr = Tracker(st)
    ev = run(tr, r1 + r2)
    keys = [(e["trip"], e["idx"]) for e in ev]
    assert ("T1", 4) in keys and ("T2", 0) not in keys and ("T2", 1) in keys, keys
    term = next(e for e in ev if e["trip"] == "T1" and e["idx"] == 4)
    assert term["dwell"] and term["dwell"] > 100, term["dwell"]       # layover measured on old trip
    r = dict(zip(L.COLUMNS, L.fmt_row(st, next(e for e in ev if e["trip"] == "T2" and e["idx"] == 1))))
    assert r["prev_stop_id"] == "A" and int(r["prev_arrival_epoch"]) == term["epoch"], r
    assert r["speed_mps"] and 3 < float(r["speed_mps"]) <= 20, r["speed_mps"]


@test
def trip_id_flips_on_arrival_at_terminal():
    """Old trip only ever seen heading to the terminal; the new trip id appears as the bus gets there."""
    st = fake_static()
    r1, t1 = simulate(st, ["A"], dwell=0, trip="T1", lead_m=200)
    r1 = [r for r in r1 if r["vt"] < t1[0]]
    r2, _ = simulate(st, ["A", "B", "C"], t0=int(t1[0]), trip="T2", lead_m=0, flip_m=45, dwell=30)
    ev = run(Tracker(st), r1 + r2)
    keys = [(e["trip"], e["idx"]) for e in ev]
    assert keys[0] == ("T1", 4) and ("T2", 0) not in keys and ("T2", 1) in keys, keys
    assert abs(ev[0]["epoch"] - t1[0]) <= 10, ev[0]["epoch"] - t1[0]
    r = dict(zip(L.COLUMNS, L.fmt_row(st, next(e for e in ev if e["trip"] == "T2" and e["idx"] == 1))))
    assert r["prev_stop_id"] == "A" and int(r["prev_arrival_epoch"]) == ev[0]["epoch"], r


@test
def same_trip_second_lap_is_logged():
    st = fake_static()
    reps, _ = simulate(st, ["A", "B", "C", "D", "A", "B", "C"])
    ev = run(Tracker(st), reps)
    assert [e["idx"] for e in ev] == [0, 1, 2, 3, 4, 1, 2], [e["idx"] for e in ev]


@test
def restart_resumes_from_csv_tail_without_duplicates():
    st = fake_static()
    reps, _ = simulate(st, ["A", "B", "C", "D", "A"])
    half = len(reps) // 2
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "a.csv"
        p.write_text(SPEC_HEADER + "\n", encoding="utf-8")
        ev1 = run(Tracker(st), reps[:half])
        with open(p, "a", encoding="utf-8", newline="") as f:
            for e in ev1:
                f.write(L.row_text(L.fmt_row(st, e)))
        tail = L.read_tail(p)
        assert len(tail) == len(ev1) and tail[0]["stop_id"] == "A"
        tr = Tracker(st)
        tr.seed(tail, reps[half]["vt"])
        ev2 = run(tr, reps[half - 3:])                 # overlap: re-sent reports must not duplicate
    idx = [e["idx"] for e in ev1] + [e["idx"] for e in ev2]
    assert sorted(idx) == [0, 1, 2, 3, 4], idx


@test
def bus_already_at_stop_when_logging_starts_gets_no_row():
    st = fake_static()
    reps, truth = simulate(st, ["A", "B", "C"], lead_m=0, dwell=60)
    ev = run(Tracker(st), reps)
    assert [e["idx"] for e in ev] == [1, 2], [e["idx"] for e in ev]      # A's arrival was never seen
    assert abs(ev[0]["epoch"] - truth[1]) <= 10


@test
def passio_early_stop_id_switch_is_deferred():
    st = fake_static()
    reps, truth = simulate(st, ["A", "B", "C", "D"], speed=4.0, flip_m=45)
    ev = run(Tracker(st), reps)
    assert [e["idx"] for e in ev] == [0, 1, 2, 3], [e["idx"] for e in ev]
    for e in ev:
        assert abs(e["epoch"] - truth[e["idx"]]) <= 6, (e["idx"], e["source"], e["epoch"] - truth[e["idx"]])
    assert all(10 <= e["dwell"] <= 30 for e in ev[:-1]), [e["dwell"] for e in ev]


@test
def stale_and_repeated_reports_are_ignored():
    st = fake_static()
    reps, _ = simulate(st, ["A", "B", "C"])
    tr = Tracker(st)
    assert tr.update(dict(reps[0]), reps[0]["vt"] + 500) == [] and not tr.v       # 500 s old
    out = []
    for r in reps:
        out += tr.update(r, r["vt"] + 2) + tr.update(dict(r), r["vt"] + 4)        # duplicate vt
    out += tr.drain(reps[-1]["vt"] + 9, final=True)
    assert sorted(e["idx"] for e in out) == [0, 1, 2]


@test
def prediction_must_be_at_least_120s_old():
    tr = Tracker(fake_static())
    arr = T0 + 1000
    tr.add_prediction("T1", "B", arr - 400, arr - 30)
    tr.add_prediction("T1", "B", arr - 300, arr + 12)
    tr.add_prediction("T1", "B", arr - 60, arr + 2)
    assert tr.pred_for("T1", "B", arr) == (arr + 12, 300)
    assert tr.pred_for("T1", "C", arr) is None


@test
def chicago_dst_rule():
    cases = {datetime(2026, 7, 1, 12, tzinfo=timezone.utc): "2026-07-01 07:00",
             datetime(2026, 1, 15, 12, tzinfo=timezone.utc): "2026-01-15 06:00",
             datetime(2026, 3, 8, 7, 59, tzinfo=timezone.utc): "2026-03-08 01:59",
             datetime(2026, 3, 8, 8, 0, tzinfo=timezone.utc): "2026-03-08 03:00",
             datetime(2026, 11, 1, 6, 59, tzinfo=timezone.utc): "2026-11-01 01:59",
             datetime(2026, 11, 1, 7, 0, tzinfo=timezone.utc): "2026-11-01 01:00"}
    for d, want in cases.items():
        for force in (True, False):
            got = L.chicago(d.timestamp(), force_rule=force).strftime("%Y-%m-%d %H:%M")
            assert got == want, (d, force, got)
    assert L.chicago(datetime(2026, 10, 5, 15, tzinfo=timezone.utc).timestamp()).weekday() == 0   # Monday


@test
def randomized_runs_error_bound():
    """Many random speeds / dwells / poll phases / GPS noise: every stop once, |error| <= 10 s."""
    st, errs = fake_static(), []
    for seed in range(40):
        rnd = random.Random(seed)
        reps, truth = simulate(st, ["A", "B", "C", "D", "A"], t0=T0 + rnd.randint(0, 9), speed=rnd.uniform(3, 13),
                               dwell=rnd.choice((0, 5, 15, 30, 60)), noise_m=rnd.uniform(0, 6), seed=seed,
                               no_stop={"C"} if seed % 3 == 0 else (), flip_m=(None, 25, 45)[seed % 3 - 1])
        ev = run(Tracker(st), reps)
        assert sorted(e["idx"] for e in ev) == [0, 1, 2, 3, 4], (seed, [e["idx"] for e in ev])
        errs += [e["epoch"] - truth[e["idx"]] for e in ev]
    worst = max(map(abs, errs))
    assert worst <= 10, worst
    print(f"    detection error over {len(errs)} arrivals: mean {sum(errs) / len(errs):+.1f} s, "
          f"mean |e| {sum(map(abs, errs)) / len(errs):.1f} s, max |e| {worst:.1f} s")


@test
def real_network_distances_positive():
    st = L.Static()
    if not st.route_stops:
        return
    for rid, order in st.route_stops.items():
        for i in range(1, len(order)):
            d, how = st.dist_between(rid, i - 1, i)
            assert d and d > 0 and how in ("shape", "haversine"), (rid, i, d)


def vp_feed(reps, junk=()):
    """vehiclePositions JSON for reports from simulate(), plus optional junk entities."""
    ents = [{"vehicle": {"position": {"latitude": r["lat"], "longitude": r["lon"], "speed": r["speed"]},
                         "trip": {"trip_id": r["trip"], "route_id": r["route"]}, "vehicle": {"id": r["veh"]},
                         "stop_id": r["stop_id"], "timestamp": r["vt"]}} for r in reps]
    return {"header": {"timestamp": max([r["vt"] for r in reps] or [0])}, "entity": list(junk) + ents}


@test
def gzip_deflate_and_plain_feeds_decode():
    import gzip, zlib
    import truth_logger as TL
    raw = b'{"entity": [], "header": {"timestamp": 1}}'
    want = {"entity": [], "header": {"timestamp": 1}}
    assert TL.decode_body(raw, None) == want
    assert TL.decode_body(raw, "identity") == want
    assert TL.decode_body(gzip.compress(raw), "gzip") == want
    assert TL.decode_body(gzip.compress(raw), None) == want            # gzip without the header: magic bytes
    assert TL.decode_body(zlib.compress(raw), "deflate") == want
    co = zlib.compressobj(wbits=-zlib.MAX_WBITS)
    assert TL.decode_body(co.compress(raw) + co.flush(), "deflate") == want   # raw deflate


@test
def fetch_asks_for_gzip_and_accepts_either_reply():
    import gzip
    import truth_logger as TL
    raw, seen = b'{"entity": [{"id": "1"}]}', []

    class Resp:
        def __init__(self, body, enc):
            self.body, self.headers = body, {"Content-Encoding": enc} if enc else {}

        def read(self):
            return self.body

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    replies = [Resp(gzip.compress(raw), "gzip"), Resp(raw, None)]   # 2nd: server ignores Accept-Encoding

    def fake_urlopen(req, timeout=None):
        seen.append((req.get_header("Accept-encoding"), timeout))
        return replies.pop(0)

    real = TL.urllib.request.urlopen
    TL.urllib.request.urlopen = fake_urlopen
    try:
        assert TL.fetch("tripUpdates") == {"entity": [{"id": "1"}]}
        assert TL.fetch("vehiclePositions") == {"entity": [{"id": "1"}]}
    finally:
        TL.urllib.request.urlopen = real
    assert seen == [("gzip", 15), ("gzip", 15)], seen


@test
def malformed_feeds_and_entries_never_stop_the_run():
    """Junk entities, bad types, non-dict feeds, fetch failures and a detector exception are counted and
    skipped; the good vehicle still yields every arrival exactly once."""
    import io
    import truth_logger as TL
    st = fake_static()
    reps, truth = simulate(st, ["A", "B", "C", "D", "A"])
    tr = Tracker(st)
    real_update = tr.update

    def update(rep, now):
        if rep["veh"] == "BOOM":
            raise ValueError("detector bug")
        return real_update(rep, now)

    tr.update = update
    out = Path(tempfile.mkdtemp(prefix="sb-truth-")) / "run.csv"
    w, log = TL.Writer(out, st), io.StringIO()
    err = TL.Errors(out=log)
    good_tu = {"trip_update": {"trip": {"trip_id": "T1"}, "timestamp": T0, "stop_time_update": [
        {"stop_id": "B", "arrival": {"time": T0 + 60}}, "junk-stop"]}}
    bad_tu = [7, "junk", {"trip_update": {"trip": {"trip_id": "T1"}, "timestamp": "bad",
                                          "stop_time_update": [{"stop_id": "B", "arrival": {"time": T0}}]}}]
    boom = dict(reps[0], veh="BOOM")
    for k, r in enumerate(reps):
        def get(name, k=k, r=r):
            if k % 7 == 3:
                raise OSError("timed out")
            if name == "tripUpdates":
                return ["not", "a", "feed"] if k % 5 == 1 else {"entity": bad_tu + [good_tu]}
            junk = [None, "x", {"vehicle": {"position": {"latitude": 1}, "trip": "not-a-dict"}}]
            return vp_feed([r, dict(boom, vt=r["vt"])], junk=junk)
        TL.poll(tr, w, r["vt"] + 2, err, get=get)
    TL.poll(tr, w, reps[-1]["vt"] + 3, err, get=lambda name: 42)    # a feed that is not even a dict
    w.write(tr.drain(reps[-1]["vt"] + 5, final=True))
    rows = [ln.split(",") for ln in out.read_text(encoding="utf-8").splitlines()[1:]]
    idx = [int(r[L.COLUMNS.index("stop_index")]) for r in rows]
    assert w.n == len(rows) and idx == [0, 1, 2, 3, 4], idx
    assert err.proc > 0 and err.fetch > 0 and err.first, (err.proc, err.fetch, err.first)
    assert "detector bug" in log.getvalue() and "ERROR" in log.getvalue()
    assert err.proc > 100 and log.getvalue().count("\n") <= 40 + err.proc // 100 + err.fetch // 100, "log not sampled"


@test
def raw_polls_keep_every_position_poll_and_never_stop_the_run():
    """--raw-out: one JSON line per vehiclePositions poll (empty feeds too), junk entities skipped; a raw
    file that cannot be written is counted as an error while arrival rows keep coming."""
    import io
    import truth_logger as TL
    st = fake_static()
    reps, _ = simulate(st, ["A", "B", "C"])
    d = Path(tempfile.mkdtemp(prefix="sb-raw-"))
    log = io.StringIO()
    tr, w, err = Tracker(st), TL.Writer(d / "run.csv", st), TL.Errors(out=log)
    raw = TL.RawPolls(d / "raw" / "raw.jsonl")
    junk = [None, "x", {"vehicle": {"position": "nope"}}, {"vehicle": {"position": {"latitude": 1}, "trip": "bad"}}]
    for r in reps:
        TL.poll(tr, w, r["vt"] + 2, err, get=lambda name, r=r: vp_feed([r], junk=junk) if name == "vehiclePositions"
                else {"entity": []}, raw=raw)
    TL.poll(tr, w, reps[-1]["vt"] + 12, err, get=lambda name: {"header": {"timestamp": 5}, "entity": []}, raw=raw)
    lines = [json.loads(ln) for ln in (d / "raw" / "raw.jsonl").read_text(encoding="utf-8").splitlines()]
    assert raw.n == len(lines) == len(reps) + 1, (raw.n, len(lines))
    first = lines[0]["v"]
    assert len(first) == 2 and dict(zip(TL.RawPolls.FIELDS, first[1]))["veh"] == reps[0]["veh"], first
    assert dict(zip(TL.RawPolls.FIELDS, first[1]))["lat"] == reps[0]["lat"]
    assert lines[-1] == {"t": reps[-1]["vt"] + 12, "h": 5, "v": []}
    assert "raw polls" not in log.getvalue(), log.getvalue()     # (the junk entities are the detector's errors)
    rows_before, log = w.n, io.StringIO()
    err = TL.Errors(out=log)                     # fresh counts (the first error log is already sampled)
    (d / "raw" / "raw.jsonl").unlink()
    (d / "raw" / "raw.jsonl").mkdir()            # now unwritable: errors are counted, the detector keeps going
    reps2, _ = simulate(st, ["A", "B", "C"], t0=reps[-1]["vt"] + 600, trip="T2")
    for r in reps2:
        TL.poll(tr, w, r["vt"] + 2, err, get=lambda name, r=r: vp_feed([r]) if name == "vehiclePositions"
                else {"entity": []}, raw=raw)
    w.write(tr.drain(reps2[-1]["vt"] + 5, final=True))
    assert err.proc == len(reps2) == log.getvalue().count("raw polls") and "raw polls" in err.first, err.first
    assert w.n > rows_before, (w.n, rows_before)


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
