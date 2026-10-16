#!/usr/bin/env python3
"""Tests for tools/replay_day.py (hermetic: synthetic buses, no network, no git).
  python tools/test_replay.py        -> prints 'ok N tests', exits 1 on failure"""
import json, sys, tempfile, traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import arrivals_lib as L
import replay_day as R
import truth_logger as TL
from arrival_detector import Tracker
from test_truth import T0, fake_static, simulate, tu_entity

TESTS = []


def test(fn):
    TESTS.append(fn)
    return fn


def vp_feed(reps):
    """vehiclePositions feed with these reports (what Passio sends; RawPolls keeps it)."""
    ents = []
    for r in reps:
        ents.append({"vehicle": {"vehicle": {"id": r["veh"]}, "trip": {"trip_id": r["trip"], "route_id": r["route"]},
                                 "position": {"latitude": r["lat"], "longitude": r["lon"], "bearing": 90.0,
                                              "speed": r["speed"]},
                                 "current_stop_sequence": r["q"], "stop_id": r["stop_id"], "timestamp": r["vt"]}})
    return {"header": {"timestamp": reps[0]["vt"] if reps else None}, "entity": ents}


def synthetic_day(st):
    """Two buses on loop R (a lap takes about 8 min: merge_arrivals' 300 s duplicate rule needs real laps), polls
    every 10 s, with tripUpdates that change, flip back (A, B, A) and are withdrawn for 2 min, including a loop
    terminal listed twice in one update. -> [(t, vehiclePositions feed, tripUpdates feed)]"""
    r1, t1 = simulate(st, ["A", "B", "C", "D", "A", "B", "C"], trip="T1", veh="V1", speed=3.0, dwell=30)
    r2, t2 = simulate(st, ["A", "B", "C", "D", "A"], t0=T0 + 95, trip="T2", veh="V2", speed=3.0, dwell=20,
                      noise_m=3, seed=7)
    by_t = {}
    for r in r1 + r2:
        by_t.setdefault(r["vt"] + 2, []).append(r)   # polled 2 s after the report time
    polls = []
    for i, t in enumerate(sorted(by_t)):
        made = t - t % 30                            # V1: a new update every 30 s, predicting about 20 s late
        ents = [tu_entity("T1", made, [("A", 1, int(t1[0]) + 20), ("B", 2, int(t1[1]) + 20 + (t // 60) % 3),
                                        ("C", 3, int(t1[2]) + 20), ("D", 4, int(t1[3]) + 20),
                                        ("A", 5, int(t1[4]) + 20)], veh="V1")]
        if not 30 <= i % 60 < 42:                    # V2: A, then B for a minute, then A again; withdrawn 2 min
            pb = int(t2[1]) + (40 if 12 <= i % 60 < 18 else 5)
            ents.append(tu_entity("T2", T0 - 60, [("B", 2, pb), ("C", 3, int(t2[2]) + 5)], veh="V2"))
        polls.append((t, vp_feed(by_t[t]), {"entity": ents}))
    return polls


def live_run(st, polls, work, seed_rows=()):
    """The live collector over these polls (truth_logger.poll with both feeds, RawPolls, PredLog, Writer)."""
    work = Path(work)
    work.mkdir(parents=True, exist_ok=True)
    tr, w = Tracker(st), TL.Writer(work / "run.csv", st, work / "run_pred.csv")
    plog, raw, err = TL.PredLog(work / "pred.jsonl"), TL.RawPolls(work / "raw.jsonl"), TL.Errors()
    tr.on_pred = plog
    tr.seed(list(seed_rows), polls[0][0])
    for t, vp, tu in polls:
        TL.poll(tr, w, t, err, get=lambda name, vp=vp, tu=tu: tu if name == "tripUpdates" else vp, raw=raw)
        plog.flush()
    w.write(tr.drain(polls[-1][0], final=True))
    assert err.proc == 0 and err.fetch == 0, err.first
    return work


def as_run(rid, live):
    return R.Run(rid, R.parse_polls((live / "raw.jsonl").read_text().splitlines()),
                 R.episodes((live / "pred.jsonl").read_text().splitlines()), "artifact")


@test
def a_replayed_run_gives_the_live_rows_exactly():
    """The replay feeds the run's PredLog updates (not the full tripUpdates of every poll) and its RawPolls lines
    back through truth_logger.poll: the arrivals and predictions rows must be byte for byte the live ones."""
    st = fake_static()
    with tempfile.TemporaryDirectory() as d:
        live = live_run(st, synthetic_day(st), Path(d) / "live")
        arr, pred, errs = R.replay_run(as_run("x", live), st, [], Path(d) / "replay")
        la, lp = (live / "run.csv").read_text(), (live / "run_pred.csv").read_text()
        assert errs == 0
        assert arr.read_text() == la, (arr.read_text(), la)
        assert pred.read_text() == lp, (pred.read_text(), lp)
        assert la.count("\n") > 10 and lp.count("\n") > 20, (la.count("\n"), lp.count("\n"))


@test
def overlapping_runs_lose_nothing_and_are_seeded_with_what_was_merged_before_them():
    """Three runs: 0 and 1 overlap; 2 starts after 0 has merged but while 1 still runs. Every arrival one long run
    finds is in the merged store once, and each run's seed holds exactly the rows merged before it started."""
    st = fake_static()
    polls = synthetic_day(st)
    n = len(polls)
    parts = [polls[: n * 6 // 10], polls[n * 4 // 10: n * 9 // 10], polls[n * 3 // 4:]]
    lag = (R.MERGE_LAG_S, R.SEED_LAG_S)
    seeds, real = [], R.replay_run
    try:
        R.MERGE_LAG_S = R.SEED_LAG_S = 0
        R.replay_run = lambda run, st, seed_rows, work: (seeds.append((run.rid, len(seed_rows))) or real(run, st, seed_rows, work))
        with tempfile.TemporaryDirectory() as d:
            runs = [as_run(str(k), live_run(st, part, Path(d) / f"live{k}")) for k, part in enumerate(parts)]
            store_a, store_p = R.replay(runs, lambda r: st, [], Path(d) / "work", log=lambda *a: None)
            rows = R.read_rows(store_a.read_text(), len(L.COLUMNS), R.I_EP)
            first = R.read_rows((Path(d) / "work" / "runs" / "run-0.csv").read_text(), len(L.COLUMNS), R.I_EP)
            whole = live_run(st, polls, Path(d) / "whole")
            want = R.read_rows((whole / "run.csv").read_text(), len(L.COLUMNS), R.I_EP)
    finally:
        R.MERGE_LAG_S, R.SEED_LAG_S = lag
        R.replay_run = real
    assert len(want) >= 10, len(want)
    pairs, only_store, only_whole = R.pair(rows, want, lambda r: (r[R.I_VEH], r[R.I_STOP]), R.I_EP)
    assert not only_whole and not only_store, (only_whole, only_store)
    assert seeds == [("0", 0), ("1", 0), ("2", len(first))], (seeds, len(first))


@test
def an_update_shown_again_after_another_stays_two_entries():
    lines = [json.dumps(x) for x in (["V", "T", "B", 100, 500, 2, 110, 110], ["V", "T", "B", 100, 500, 2, 110, 170],
                                     ["V", "T", "B", 120, 530, 2, 180, 200], ["V", "T", "B", 100, 500, 2, 210, 240],
                                     ["V", "T", "B", 100, 500, 2, 210, 300])]
    eps = R.episodes(lines + ["not json", "[1, 2]"])
    assert eps == [["V", "T", "B", 100, 500, 2, 110, 170], ["V", "T", "B", 120, 530, 2, 180, 200],
                   ["V", "T", "B", 100, 500, 2, 210, 300]], eps
    clipped = R.clip_episodes(eps, 190, 260)            # a run that started at 190 sees B at its first poll
    assert clipped == [["V", "T", "B", 120, 530, 2, 190, 200], ["V", "T", "B", 100, 500, 2, 210, 300]], clipped


@test
def a_logged_last_sighting_moves_on_but_never_past_the_next_update_or_the_run():
    eps = [["V", "T", "B", 100, 500, 2, 110, 130], ["V", "T", "B", 120, 530, 2, 150, 160],
           ["V", "T", "C", 100, 600, 3, 110, 110], ["V", "T", "B", 140, 540, 2, 300, 300]]
    got = R.estimate_last(eps, 320, ext=44)
    assert [x[7] for x in got] == [149, 204, 154, 320], got   # next B update at 150; C alone; the run ended at 320
    assert eps[0][7] == 130, "the input is not changed"
    st = fake_static()
    with tempfile.TemporaryDirectory() as d:                # the live rows still come back exactly from a run's log
        live = live_run(st, synthetic_day(st), Path(d) / "live")
        run = as_run("x", live)
        run.preds = R.estimate_last(run.preds, run.t_last)
        arr, pred, _ = R.replay_run(run, st, [], Path(d) / "replay")
        assert arr.read_text() == (live / "run.csv").read_text()
        assert pred.read_text() == (live / "run_pred.csv").read_text()


@test
def a_raw_poll_row_reads_back_as_the_same_report():
    st = fake_static()
    reps, _ = simulate(st, ["A", "B"], trip="T1", veh="V1")
    feed = vp_feed(reps[:3])
    feed["entity"].append({"vehicle": {"vehicle": {"id": "V9"}, "trip": {}, "position": {"latitude": 1, "longitude": 2}}})
    feed["entity"].append({"vehicle": {"vehicle": {"id": "V8"}, "trip": {"trip_id": "Z"}, "position": {"longitude": 2}}})
    back = {"entity": [R.entity(v) for v in TL.RawPolls.rows(feed)]}
    assert list(TL.reports(back)) == list(TL.reports(feed)), (list(TL.reports(back)), list(TL.reports(feed)))


@test
def rows_without_any_prediction_log_keep_the_live_passio_columns():
    row = lambda ep, veh, pe="", pl="": [str(ep)] + [""] * 8 + [veh, "B"] + [""] * 11 + [pe, pl, "transition"]
    mine = [row(1000, "V1"), row(5000, "V1"), row(9000, "V2", "9100", "300")]
    live = [row(1030, "V1", "1100", "400"), row(5010, "V1", "5050", "200"), row(9000, "V2", "9200", "500")]
    n = R.fill_live_pred(mine, live, [(4000, 6000)])     # a run with a prediction log covered 4000-6000
    assert n == 1 and mine[0][R.I_PE] == "1100" and mine[0][R.I_PL] == "400", mine[0]
    assert mine[1][R.I_PE] == "", "covered by a prediction log: the replay's own (none) stands"
    assert mine[2][R.I_PE] == "9100", "a replayed value is never overwritten"


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
