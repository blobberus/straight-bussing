#!/usr/bin/env python3
"""Assertion tests for the model code (stdlib only; also runs under pytest).

  python tools/test_models.py        # prints one line per test, exits 1 on any failure
Synthetic data here proves the CODE recovers structure planted in a simulator, not real accuracy."""
import contextlib, io, json, math, random, sys, tempfile, time, traceback
from datetime import datetime, timezone
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import model_core as C
import model_kalman as K
import model_quantile as Q
import model_segments as S
import model_synth as Y

TMP = Path(tempfile.gettempdir()) / "sb_test_models"
TMP.mkdir(exist_ok=True)
_SYN = {}


def synth(days=14, max_routes=2):
    """Cached model_synth rows (AR(1) trip delay, rush hours, non-oracle Passio)."""
    key = (days, max_routes)
    if key not in _SYN:
        _SYN[key] = Y.synthetic_rows(days=days, max_routes=max_routes)
    return _SYN[key]


def approx(a, b, tol):
    assert abs(a - b) <= tol, f"{a} != {b} (tol {tol})"


# ---------- time ----------
def test_parse_local_and_how():
    assert C.parse_local("2026-10-05 08:30:00") == (0, 8, 30)        # Monday
    assert C.parse_local("2026-10-11T23:59:59-05:00") == (6, 23, 59)  # Sunday
    assert C.parse_local("garbage") is None
    assert C.how_bucket(0, 0) == 0 and C.how_bucket(6, 23) == 167
    assert C.daypart(0, 8) == 1 and C.daypart(5, 8) == 6 and C.daypart(2, 3) == 0


def test_dst_safe_chicago():
    # 2026 DST: starts Sun Mar 8 08:00 UTC, ends Sun Nov 1 07:00 UTC
    t = datetime(2026, 3, 8, 8, 30, tzinfo=timezone.utc).timestamp()
    assert C.chicago(t).hour == 3                                      # 03:30 CDT (02:xx skipped)
    t = datetime(2026, 3, 8, 7, 30, tzinfo=timezone.utc).timestamp()
    assert C.chicago(t).hour == 1                                      # 01:30 CST
    t = datetime(2026, 11, 1, 6, 30, tzinfo=timezone.utc).timestamp()
    assert C.chicago(t).hour == 1 and C.how_of_epoch(t) == 6 * 24 + 1  # first 01:30 (CDT)
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc).timestamp()
    for i in range(0, 366 * 4):                                        # manual rule == tz database
        u = datetime.fromtimestamp(t0 + i * 6 * 3600 + 1800, timezone.utc)
        assert C._us_central_offset_h(u) * 3600 == C.chicago(u.timestamp()).utcoffset().total_seconds(), u


# ---------- rows and speed ----------
def test_row_semantics_prev_dwell():
    d0 = {"epoch": "1000", "trip_id": "T", "stop_id": "A", "dwell_s": "19", "route_id": "R",
          "local_time": "2026-10-05 08:00:00", "prev_stop_id": ""}
    d1 = {"epoch": "1055", "trip_id": "T", "stop_id": "B", "prev_stop_id": "A", "prev_arrival_epoch": "1000",
          "segment_s": "55", "dist_prev_m": "133.6", "dwell_s": "15", "route_id": "R", "stop_index": "1",
          "local_time": "2026-10-05 08:00:55"}
    rows = C.rows_from_dicts([d0, d1])
    assert len(rows) == 1
    r = rows[0]
    assert r.dwell == 19 and r.run == 36 and r.dwell_here == 15         # dwell belongs to the PREVIOUS stop
    approx(r.speed, 133.6 / 36, 1e-9)
    d1b = dict(d1, speed_mps="3.711")                                   # no prev row: recover from speed
    approx(C.rows_from_dicts([d1b])[0].dwell, 55 - 133.6 / 3.711, 0.01)
    assert C.make_row(dict(d1, segment_s="2000")) is None               # layover, not a travel time
    assert C.make_row(dict(d1, dist_prev_m="5000", segment_s="20")) is None   # 250 m/s glitch


def _arr(ep, veh, trip, stop, idx, prev=None, dist=300.0, lead=None, err=0, source="transition"):
    """One real-looking arrivals.csv dict (prev = (stop, epoch) of the previous detected stop)."""
    d = {"epoch": str(ep), "vehicle_id": veh, "trip_id": trip, "stop_id": stop, "stop_index": str(idx),
         "route_id": "R", "local_time": "2026-10-09 08:%02d:00" % (ep // 60 % 60), "dwell_s": "0",
         "prev_stop_id": "", "prev_arrival_epoch": "", "segment_s": "", "dist_prev_m": "",
         "passio_pred_epoch": "", "passio_pred_lead_s": "", "source": source}
    if prev:
        d.update(prev_stop_id=prev[0], prev_arrival_epoch=str(prev[1]), segment_s=str(ep - prev[1]), dist_prev_m=str(dist))
    if lead is not None:
        d.update(passio_pred_epoch=str(ep + err), passio_pred_lead_s=str(lead))
    return d


def test_e01_cleaning_rules():
    """RouteKnower E01 (experiments/routeknower/E01-data-quality-2026-10-10.md): duplicate visits, stale
    links, untrustworthy Passio predictions, impossible city speeds, one bus per Row.trip."""
    ds = [_arr(1000, "V1", "T", "A", 0, lead=150),                                  # trip start: Passio dropped
          _arr(1100, "V1", "T", "B", 1, ("A", 1000), lead=150, err=20),             # clean
          _arr(1250, "V1", "T2", "B", 1, ("A", 1000)),                              # same visit, other collector
          _arr(1300, "V1", "T", "C", 2, ("B", 1100), lead=400, err=-390),           # Passio froze: lead >= 300
          _arr(1600, "V1", "T9", "X", 4),                                           # trip-id flap logged elsewhere
          _arr(2000, "V1", "T", "D", 3, ("C", 1300)),                               # stale link over X
          _arr(9000, "V2", "S", "A", 1, lead=150), _arr(9200, "V3", "S", "B", 2, ("A", 9000), lead=150),
          _arr(9400, "V3", "S", "C", 3, ("B", 9200), lead=150),                     # S shared by V2 + V3
          _arr(9405, "V3", "S", "D", 4, ("C", 9400), dist=150),                     # 30 m/s on 150 m: mistimed
          _arr(9600, "V3", "S", "E", 5, ("D", 9405), dist=4000)]                    # 20.5 m/s on Lake Shore Dr: ok
    kept, stale, nop = C.clean_dicts(ds)
    assert ds[2] not in kept and len(kept) == len(ds) - 1
    assert {id(ds[5])} == stale
    assert {id(ds[0]), id(ds[3]), id(ds[6]), id(ds[7]), id(ds[8])} == nop
    rows = {r.stop + r.vehicle: r for r in C.rows_from_dicts(ds)}
    assert sorted(rows) == ["BV1", "BV3", "CV1", "CV3", "EV3"]
    assert rows["BV1"].passio == 1120 and rows["CV1"].passio is None and rows["CV3"].passio is None
    assert rows["BV1"].trip == "T|V1|2026-10-09" and rows["BV3"].trip != rows["BV1"].trip
    old = C.rows_from_dicts(ds, clean=False)                                    # the pre-E01 behaviour
    assert len(old) == 8 and all(r.trip in ("T", "T2", "S") for r in old)
    syn = [dict(d, source="synthetic") for d in ds]                             # synthetic rows: untouched
    assert len(C.rows_from_dicts(syn)) == len(old)


def test_harmonic_speed():
    assert C.harmonic_speed([100, 100], [10, 40]) == 4.0                # 200 m in 50 s
    assert (10 + 2.5) / 2 > 4.0                                         # arithmetic mean of speeds overstates


def test_robust_stats_and_metrics():
    v = [1, 2, 3, 4, 100]
    assert C.median(v) == 3 and C.quantile(v, 0.5) == 3 and C.quantile([0, 10], 0.25) == 2.5
    approx(C.mad_sigma(v), 1.4826, 1e-9)
    e, y = [10, -10, 20], [100, 100, 100]
    approx(C.mae(e), 40 / 3, 1e-9); approx(C.rmse(e), math.sqrt(200), 1e-9); approx(C.mape(e, y), 40 / 3, 1e-9)
    approx(C.pinball(10, 8, 0.9), 1.8, 1e-9); approx(C.pinball(10, 12, 0.9), 0.2, 1e-9)
    assert C.coverage([1, 5, 9], [0, 0, 0], [6, 6, 6]) == 2 / 3
    assert C.solve([[2, 1], [1, 3]], [3, 5]) == [0.8, 1.4]


def test_time_split_no_leak():
    rows = synth()
    tr, te = C.time_split(rows)
    assert len(tr) == int(0.7 * len(rows)) and max(r.epoch for r in tr) <= min(r.epoch for r in te)
    for lo, hi in C.rolling_origins(len(rows)):
        assert 0 < lo < hi <= len(rows)


# ---------- distributions ----------
def test_lognormal_and_sum():
    mu, s = math.log(60), 0.3
    approx(Q.lognormal_q(mu, s, 0.5), 60, 1e-9)
    lo, md, hi = Q.interval(mu, s, dwell=10)
    approx(md, 70, 1e-9); assert hi - md > md - lo                               # right skew
    m1, s1 = Q.sum_lognormals([(mu, s)] * 4, rho=1.0)                    # comonotone: same log-sd
    approx(s1, s, 1e-9); approx(math.exp(m1 + s1 * s1 / 2), 4 * math.exp(mu + s * s / 2), 1e-6)
    m0, s0 = Q.sum_lognormals([(mu, s)] * 4, rho=0.0)
    assert s0 < s1 / 1.5                                                # independent errors average out


def test_calibrate_scale():
    rnd = random.Random(1)
    preds, ys = [], []
    for _ in range(4000):
        mu = math.log(rnd.uniform(30, 300))
        preds.append((mu, 0.2, 0.0)); ys.append(math.exp(mu + rnd.gauss(0, 0.3)))
    approx(Q.calibrate_scale(preds, ys), 1.5, 0.1)                      # true sd 0.3 / claimed 0.2


# ---------- segment model ----------
def test_shrinkage_weights():
    rows = synth()
    m = S.SegmentModel(k=5).fit(rows)
    r = rows[-1]
    p = m.predict_row(r)
    for name, n, w in p["path"][1:]:
        approx(w, n / (n + 5), 1e-12)
    assert p["p10"] < p["run"] < p["p90"] and p["seg"] == p["run"] + p["dwell"]
    # unseen segment, unknown route: falls back to distance / global harmonic speed
    q = m.predict("nope", "x", "y", 10, dist=600)
    approx(q["run"], 600 / m.v_g, 1e-9); assert q["level"].startswith("global")


def test_recovers_rush_hour_and_speed():
    rows = synth()
    m = S.SegmentModel(k=5).fit(rows)
    r = rows[0]                                                          # any segment
    rush = m.predict(r.route, r.prev, r.stop, 0 * 24 + 8)["run"]         # Mon 08:00 (factor 1.35)
    mid = m.predict(r.route, r.prev, r.stop, 0 * 24 + 12)["run"]         # Mon 12:00 (factor 0.95)
    approx(math.log(rush / mid), math.log(1.35 / 0.95), 0.12)
    v_true = C.harmonic_speed([x.dist for x in rows], [x.run for x in rows])
    approx(m.v_g, v_true, 1e-9)


def test_tune_k_and_raw_baseline():
    rows = synth(days=10)
    k, tab = S.tune_k(rows, ks=(1, 5, 50), folds=2)
    assert k in (1, 5, 50) and len(tab) == 3 and all(v > 0 for _, v in tab)
    raw = S.RawBucketModel().fit(rows[:5000])
    assert raw.run(rows[-1]) > 0


def test_corrector_learns_carry_over():
    rows = synth()
    tr, te = C.time_split(rows)
    m = S.SegmentModel(5).fit(tr)
    corr = S.Corrector().fit(m, tr)
    assert corr.g[1] > 0.05 and 0.05 < corr.phi < 0.95, (corr.g, corr.phi)  # AR(1) delay was planted
    feats = corr.replay(m, tr + te)
    base = [abs(math.exp(feats[id(r)][1]) - r.run) for r in te]
    fix = [abs(math.exp(corr.corrected_mu(*feats[id(r)])) - r.run) for r in te]
    assert C.mae(fix) < C.mae(base), (C.mae(fix), C.mae(base))


def test_export_matches_predict_js_contract():
    rows = synth()
    rs = json.loads((C.WEB_DATA / "route_stops.json").read_text(encoding="utf-8"))
    m = S.SegmentModel(5).fit(rows)
    out = S.export_learned(m, rs, TMP / "learned.json", corr=S.Corrector().fit(m, rows),
                           kind="synthetic", bias=S.fit_bias(rows, min_n=10))
    disk = json.loads((TMP / "learned.json").read_text(encoding="utf-8"))
    assert disk["v"] == 2 and disk["k"] == 5 and disk["kind"] == "synthetic" and disk["routes"]
    for rid, rt in disk["routes"].items():
        assert rt["dw"] >= 0
        for i, e in rt["s"].items():
            order = rs[rid]
            assert 0 <= int(i) < len(order) - 1
            a = e["a"]
            assert len(a) == 5 and a[2] <= a[0] <= a[3] and a[1] > 0
            for h, (sec, n) in e.get("h", {}).items():
                assert 0 <= int(h) <= 167 and sec > 0 and n >= 5
    assert out["bias"] and all(0.5 <= b["m"] <= 2 for b in out["bias"].values())


# ---------- Kalman ----------
def test_kalman():
    kf = K.Kalman2(s0=0, v0=0)
    for i in range(1, 60):
        kf.step(5, 6.0 * 5 * i)
    approx(kf.v, 6.0, 0.2)
    eta, sd = kf.eta(kf.s + 600)
    approx(eta, 100, 5); assert sd > 0
    assert kf.step(5, kf.s + 5000) is False                              # GPS jump rejected by the gate
    res = K.demo(seeds=range(5), quiet=True)
    assert res["pos_filtered"] < res["pos_raw"] and res["kalman_learned"] < res["kalman_cv"]


# ---------- CLIs ----------
def _quiet(fn, *a):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc = fn(*a)
    return rc, buf.getvalue()


def test_refresh_model_guards_and_idempotent():
    import refresh_model as R
    before = R.LEARNED.read_bytes() if R.LEARNED.exists() else None
    rc, out = _quiet(R.main, ["--min-rows", str(10 ** 9)])
    assert rc == 0 and "not enough data yet" in out
    if C.SYNTH_CSV.exists():
        rc, out = _quiet(R.main, ["--synthetic", "--out", str(R.LEARNED), "--k", "5"])
        assert rc == 2 and "refusing" in out
        tgt = TMP / "learned_synth.json"
        if tgt.exists():
            tgt.unlink()
        rc, out = _quiet(R.main, ["--synthetic", "--out", str(tgt), "--k", "5"])
        assert rc == 0 and "wrote" in out and tgt.exists()
        rc, out = _quiet(R.main, ["--synthetic", "--out", str(tgt), "--k", "5"])
        assert rc == 0 and "unchanged" in out
    after = R.LEARNED.read_bytes() if R.LEARNED.exists() else None
    assert before == after                                              # never touched by tests


def test_estimate_speed_cli():
    import estimate_speed as E
    now = C.chicago(datetime(2026, 10, 7, 15, 0, tzinfo=timezone.utc).timestamp())
    assert E.parse_when("mon 08:30", now)[:3] == (0, 8, 30)
    assert E.parse_when("2026-10-11 13:05", now)[:3] == (6, 13, 5)
    assert E.parse_when("17:45", now)[:3] == (2, 17, 45)
    try:
        E.parse_when("someday", now)
        assert False
    except ValueError:
        pass
    rs = json.loads((C.WEB_DATA / "route_stops.json").read_text(encoding="utf-8"))
    rid = next(r for r in sorted(rs) if len(rs[r]) > 3)
    rc, out = _quiet(E.main, ["--route", rid, "--stop", rs[rid][2], "--when", "tue 09:00"])
    assert rc == 0 and "m/s" in out and "km/h" in out and "mph" in out and "hierarchy level" in out


def test_backtest_runs_and_beats_baselines():
    import backtest as B
    rows = synth(days=10)
    tr, te = C.time_split(rows)
    F = B.fit_all(tr, k=5)
    A, levels = B.segment_eval(F, B.Schedule(), tr, te)
    sh, gm = A["shrunk hierarchy"], A["global median"]
    assert C.mae(sh["err"]) < C.mae(gm["err"]) and sum(levels.values()) == len(te)
    cov = C.coverage(sh["y"], sh["lo"], sh["hi"])
    assert 0.7 <= cov <= 0.9, cov
    res, items = B.arrival_eval(F, B.Schedule(), tr, te)
    assert items and any(res[b]["Passio"]["err"] for b in res)


def main():
    tests = [(n, f) for n, f in sorted(globals().items()) if n.startswith("test_") and callable(f)]
    fails = 0
    for name, fn in tests:
        t = time.time()
        try:
            fn()
            print(f"PASS {name} ({time.time() - t:.1f}s)")
        except Exception:
            fails += 1
            print(f"FAIL {name}\n{traceback.format_exc()}")
    print(f"{len(tests) - fails} passed, {fails} failed")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
