#!/usr/bin/env python3
"""Tests for hidden_buses.py (data/labeled/hidden_buses/hidden_buses.csv) on a tiny synthetic replay: the rules, the
episodes, Passio's times, came-to-serve, the shipped reshow (not_operating), the owner's held rule and the file header.

  python experiments/routeknower/E32-scripts/test_hidden_buses.py
"""
import csv, json, sys, tempfile, unittest
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import hidden_buses as H   # noqa: E402

DAY = "2026-11-09"
T0 = int(datetime(2026, 11, 9, 18, 0, tzinfo=H.CT).timestamp())   # 18:00 Chicago, on the minute
STOPS = {"S1": {"name": "Stop one", "lat": 41.79, "lon": -87.60}, "S2": {"name": "Stop two", "lat": 41.80, "lon": -87.60}}
RSTOPS = {"A": ["S1", "S2"]}
NAMES = {"A": "Line A"}


class Replay:
    """inputs.py-like `inp` and replay.py-like `res` built minute by minute."""

    def __init__(self):
        self.inp = {"snaps": [], "polls": []}
        self.res = {"polls": []}

    def minute(self, k, op=(), off=(), idle=(), gone=(), times=None, reports=(), held=None):
        h = T0 + 60 * k
        snap_ix = []
        for veh, pts in (times or {}).items():
            self.inp["snaps"].append([veh, "trip", "A", [[s, h + 60 * m] for s, m in pts]])
            snap_ix.append(len(self.inp["snaps"]) - 1)
        vs = [[v, "trip", "A", 41.79, -87.60, 0, 0, h - 5] for v in reports]
        self.inp["polls"].append([h, vs, snap_ix, []])
        poll = [h, [[v, "A"] for v in op], list(off), [[v, w] for v, w in idle], list(gone), {}, [], {}]
        if held is not None:
            poll += [list(held), []]                       # replay.html fields 8 (held) and 9 (marked transitioning)
        self.res["polls"].append(poll)
        return h


class FakeArrivals(H.Arrivals):
    def __init__(self, rows):
        from collections import defaultdict
        self.vr, self.vs = defaultdict(list), defaultdict(list)
        for t, v, rid, stop in rows:
            self.vr[(v, rid)].append(t)
            self.vs[(v, stop)].append(t)


def run(rp, arrivals=(), label="shipped"):
    return H.day_episodes(DAY, rp.inp, rp.res, FakeArrivals(arrivals), STOPS, RSTOPS, NAMES, label)


class Episodes(unittest.TestCase):
    def test_off_route_with_times_came_to_serve(self):
        rp = Replay()
        for k in range(5):
            rp.minute(k, op=["1"], off=["1"], times={"1": [("S1", 5), ("S2", 9)]}, reports=["1"])
        rp.minute(5, op=["1"], reports=["1"])
        rows, no_times = run(rp, arrivals=[(T0 + 60 * 9, "1", "A", "S1")])
        (r,) = rows
        self.assertEqual((r["rule"], r["hidden_from"], r["hidden_to"], r["hidden_min"]), ("off_route", "18:00", "18:04", 5))
        self.assertEqual((r["passio_times_min"], r["stops_with_times"], r["first_times"]), (5, 2, 2))
        self.assertEqual(r["first_time_ahead_min"], 5.0)
        self.assertEqual(r["first_times_came_true"], 1)          # S1 predicted 18:05, served 18:09 (within 15 min); S2 never
        self.assertEqual((r["came_to_serve_15"], r["then"], r["times_shown_by_app"]), ("y", "shown", "n"))
        self.assertEqual(r["next_arrival_on_line_min"], 9.0)
        self.assertEqual(r["near_stop"], "Stop one")

    def test_came_true_window(self):
        rp = Replay()
        rp.minute(0, op=["1"], off=["1"], times={"1": [("S1", 5)]}, reports=["1"])
        rows, _ = run(rp, arrivals=[(T0 + 60 * 5 + 30, "1", "A", "S1")])
        self.assertEqual(rows[0]["first_times_came_true"], 1)

    def test_hide_without_times_is_counted_not_listed(self):
        rp = Replay()
        for k in range(3):
            rp.minute(k, op=["1"], idle=[("1", "linger")], reports=["1"])
        rows, no_times = run(rp)
        self.assertEqual(rows, [])
        self.assertEqual(no_times["idle"], 1)

    def test_reshown_after_hide_is_not_operating(self):
        rp = Replay()
        rp.minute(0, op=["1"], off=["1"], times={"1": [("S1", 8)]}, reports=["1"])
        for k in range(1, 4):        # silent: no longer operating, Passio still has the time
            rp.minute(k, times={"1": [("S1", 8 - k)]})
        rows, _ = run(rp)
        self.assertEqual([r["rule"] for r in rows], ["off_route", "not_operating"])
        no = rows[1]
        self.assertEqual((no["hidden_from"], no["hidden_to"], no["times_shown_by_app"]), ("18:01", "18:03", "y"))
        self.assertEqual(rows[0]["then"], "not_operating")
        self.assertEqual(no["next_report_min"], "")

    def test_not_operating_only_after_a_hide(self):
        rp = Replay()
        rp.minute(0, op=["1"], times={"1": [("S1", 8)]}, reports=["1"])
        rp.minute(1, times={"1": [("S1", 7)]})                   # silent, never hidden: its times are just shown
        rows, _ = run(rp)
        self.assertEqual(rows, [])

    def test_gone_and_held(self):
        rp = Replay()
        rp.minute(0, gone=["2"], times={"2": [("S2", 3)]})
        rp.minute(1, times={"2": [("S2", 2)]}, held=["2"])
        rows, _ = run(rp, label="held-15")
        self.assertEqual([(r["rule"], r["times_shown_by_app"], r["rules"]) for r in rows],
                         [("gone", "n", "held-15"), ("held", "n", "held-15")])

    def test_merge_within_two_minutes(self):
        rp = Replay()
        rp.minute(0, op=["1"], off=["1"], times={"1": [("S1", 5)]}, reports=["1"])
        rp.minute(1, op=["1"], reports=["1"])
        rp.minute(2, op=["1"], off=["1"], times={"1": [("S1", 3)]}, reports=["1"])
        rp.minute(6, op=["1"], off=["1"], times={"1": [("S1", 3)]}, reports=["1"])
        rows, _ = run(rp)
        self.assertEqual([(r["hidden_from"], r["hidden_min"]) for r in rows], [("18:00", 2), ("18:06", 1)])


class File(unittest.TestCase):
    def test_header_and_reader(self):
        with tempfile.TemporaryDirectory() as d:
            work, res = Path(d) / "work", Path(d) / "results"
            work.mkdir(); res.mkdir()
            rp = Replay()
            rp.minute(0, op=["1"], off=["1"], times={"1": [("S1", 5)]}, reports=["1"])
            st = work / "static-x"
            st.mkdir()
            (st / "routes.json").write_text(json.dumps({"A": {"long": "Line A"}}), encoding="utf-8")
            (st / "stops.json").write_text(json.dumps(STOPS), encoding="utf-8")
            (st / "route_stops.json").write_text(json.dumps(RSTOPS), encoding="utf-8")
            (work / f"{DAY}.json").write_text(json.dumps({**rp.inp, "static": "static-x"}), encoding="utf-8")
            (res / f"{DAY}.json").write_text(json.dumps(rp.res), encoding="utf-8")
            arr = Path(d) / "arrivals.csv"
            arr.write_text("epoch,route_id,vehicle_id,stop_id\n", encoding="utf-8")
            out = Path(d) / "hidden_buses.csv"
            H.main(["--work", str(work), "--results", str(res), "--arrivals", str(arr), "--from", DAY, "--to", DAY,
                    "--out", str(out)])
            txt = out.read_text(encoding="utf-8")
            for word in ("# WHAT:", "# WHY:", "# HOW:", "# COLUMNS:", "# REFRESH:", "# TOTALS:"):
                self.assertIn(word, txt)
            rows = H.read_rows(out)
            self.assertEqual(len(rows), 1)
            self.assertEqual(list(rows[0]), H.COLUMNS)
            self.assertEqual(set(H.DOCS) >= {"day", "rule", "evidence"}, True)
            # every column is documented in the header
            documented = {c.strip() for k in H.DOCS for c in k.split(",")}
            self.assertEqual(set(H.COLUMNS) - documented, set())

    def test_committed_file_parses(self):
        p = H.REPO / "data" / "labeled" / "hidden_buses" / "hidden_buses.csv"
        if not p.exists():
            self.skipTest("no committed file")
        rows = H.read_rows(p)
        self.assertTrue(rows)
        self.assertEqual(list(rows[0]), H.COLUMNS)
        self.assertTrue(all(r["rule"] in H.PRIORITY for r in rows))
        self.assertTrue(all(int(r["passio_times_min"]) >= 1 for r in rows))


if __name__ == "__main__":
    unittest.main(verbosity=1)
