#!/usr/bin/env python3
"""Tests of the E30 odd-behavior rules on small synthetic tracks (stdlib unittest; numpy for the reused E27 helpers).

  python experiments/routeknower/E30-scripts/test_odd.py
"""
import sys, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import odd_lib as L          # noqa: E402
import odd_feed as F         # noqa: E402
import odd_labels as LB      # noqa: E402
import odd_passio as P       # noqa: E402
import odd_schedule as S     # noqa: E402

DAY = "2026-11-09"           # a Monday
T0 = L.day_bounds(DAY)[0] + 6 * 3600       # 10:00 CST
# two straight east-west lines 300 m apart (about 0.0027 deg of latitude) and one north-south line
LAT_A, LAT_B = 41.7900, 41.7927
LON0 = -87.6100
SHAPES = {"A": [[[LAT_A, LON0], [LAT_A, LON0 + 0.03]]], "B": [[[LAT_B, LON0], [LAT_B, LON0 + 0.03]]],
          "N": [[[41.7800, LON0 + 0.015], [41.8000, LON0 + 0.015]]]}
DEG_PER_M_LON = 1 / (111320 * 0.7455)


def drive(veh, rid, lat, t0, n, step_s=10, mps=8.0, lon0=LON0, trip="t1", spd=True):
    """n fresh reports of a bus driving east along latitude lat."""
    out = []
    for k in range(n):
        t = t0 + k * step_s
        out.append((t, rid, trip, lat, lon0 + k * step_s * mps * DEG_PER_M_LON, mps if spd else None, "", t))
    return out


def shuttle(rid, lat, t0, n, step_s=10, mps=8.0, span_deg=0.025):
    """n fresh reports of a bus driving back and forth along latitude lat (stays on a 2 km line)."""
    out, x, d = [], 0.0, 1
    for k in range(n):
        t = t0 + k * step_s
        out.append((t, rid, "t1", lat, LON0 + x, mps, "", t))
        x += d * step_s * mps * DEG_PER_M_LON
        if x > span_deg or x < 0:
            d = -d
            x = min(max(x, 0.0), span_deg)
    return out


def park(veh, rid, lat, lon, t0, n, step_s=10, trip="t1"):
    return [(t0 + k * step_s, rid, trip, lat, lon, 0.0, "", t0 + k * step_s) for k in range(n)]


def other_bus(t0, t1, step_s=10):
    """A bus parked far away that keeps the feed alive."""
    return park("Z", "N", 41.7850, LON0 + 0.015, t0, (t1 - t0) // step_s + 1, step_s)


class LineIndexTest(unittest.TestCase):
    def test_on_and_off(self):
        li = L.LineIndex(SHAPES)
        self.assertTrue(li.on("A", LAT_A + 0.0001, LON0 + 0.01))            # 11 m
        self.assertFalse(li.on("A", LAT_A + 0.0010, LON0 + 0.01))           # 111 m
        self.assertEqual(li.lines_at(LAT_B, LON0 + 0.005), {"B"})
        self.assertEqual(li.lines_at(LAT_A, LON0 + 0.015), {"A", "N"})


class WindowTest(unittest.TestCase):
    def test_windows_and_lookup(self):
        tr = [{"event_id": "e1", "route_id": "A", "kind": "leave", "label": "break", "epoch": str(T0), "vehicle_id": "1"},
              {"event_id": "e2", "route_id": "A", "kind": "add", "label": "added_from_garage", "epoch": str(T0 + 600),
               "vehicle_id": "2"},
              {"event_id": "e3", "route_id": "A", "kind": "leave", "label": "layover_swap", "epoch": str(T0 + 9000),
               "vehicle_id": "1"}]
        W = L.build_windows(DAY, tr, {"A": [(T0 - 3 * 3600, T0 + 8 * 3600)]}, [("A", T0 + 7200, 2, 1)])
        kinds = sorted(w["kind"] for w in W)
        self.assertEqual(kinds, ["bus_change", "bus_change", "handover", "service_end", "service_start", "timetable_step"])
        wi = L.WindowIndex(W)
        self.assertEqual(wi.at("A", T0 + 60)["kind"], "bus_change")
        self.assertEqual(wi.at("A", T0 + 7300)["kind"], "timetable_step")
        self.assertIsNone(wi.at("A", T0 + 4 * 3600))                       # nothing within 30 min
        self.assertIsNone(wi.at("B", T0))                                   # other line
        self.assertEqual(wi.covered_s("A", T0 - 1800, T0 + 2400), 4200)     # two overlapping windows merged
        # an episode of bus 1 at its own leave: the only window left without its own events is the listed start's
        self.assertEqual(wi.at("A", T0 + 60, T0 + 120, {"1"})["kind"], "bus_change")     # bus 2's add (+10 min)
        self.assertIsNone(wi.at("A", T0 - 1500, T0 - 1400, {"1", "2"}))

    def test_listed_spans_cross_midnight(self):
        svc = {"routes": {"A": {"days": {"mon": {"spans": [["16:00", "28:29"]], "buses": [1] * 24}}}}}
        (a, b), = L.listed_spans(svc, DAY)["A"]
        self.assertEqual(L.ct(a, "%Y-%m-%d %H:%M"), "2026-11-09 16:00")
        self.assertEqual(L.ct(b, "%Y-%m-%d %H:%M"), "2026-11-10 04:29")

    def test_timetable_steps(self):
        b = [0] * 24
        b[9], b[10], b[11] = 2, 1, 1
        svc = {"routes": {"A": {"days": {"mon": {"spans": [["08:00", "12:00"]], "buses": b}}}}}
        sp = L.listed_spans(svc, DAY)
        st = L.timetable_steps(svc, DAY, sp)
        self.assertEqual([(r, L.ct(t, "%H:%M"), x, y) for r, t, x, y in st], [("A", "09:00", 0, 2), ("A", "10:00", 2, 1)])

    def test_hours_outside(self):
        self.assertEqual(L.hours_outside([(100, 200)], 150), ("", 0.0))
        self.assertEqual(L.hours_outside([(100, 200)], 260), ("after", 60))
        self.assertEqual(L.hours_outside([(100, 200), (1000, 2000)], 900), ("before", 100))


class FeedTest(unittest.TestCase):
    def setUp(self):
        self.li = L.LineIndex(SHAPES)

    def polls(self, tracks):
        return L.DayPolls.from_tracks(tracks)

    def test_feed_drop_mid_route_reappears_far(self):
        a = drive("1", "A", LAT_A, T0, 30)                  # 5 min driving
        b = drive("1", "A", LAT_A, T0 + 290 + 600, 10, lon0=LON0 + 0.02)   # back 10 min later, ~1.2 km on
        p = self.polls({"1": a + b, "Z": other_bus(T0, T0 + 1000)})
        eps = F.feed_drops(DAY, p, {"A", "N"}, self.li, [])
        self.assertEqual(len(eps), 1)
        e = eps[0]
        self.assertEqual((e["code"], e["outcome"], e["vehicle_id"]), ("feed_drop_mid_route", "reappeared_far", "1"))
        self.assertAlmostEqual(e["duration_min"], 10.0, delta=0.2)

    def test_no_drop_when_whole_feed_silent(self):
        a = drive("1", "A", LAT_A, T0, 30)
        b = drive("1", "A", LAT_A, T0 + 900, 10)
        p = self.polls({"1": a + b})                        # nobody else reported: a feed / collector gap
        self.assertEqual(F.feed_drops(DAY, p, {"A"}, self.li, []), [])

    def test_no_drop_when_parked_or_at_linger_spot(self):
        a = park("1", "A", LAT_A, LON0 + 0.01, T0, 30)
        b = drive("1", "A", LAT_A, T0 + 900, 10)
        p = self.polls({"1": a + b, "Z": other_bus(T0, T0 + 1200)})
        self.assertEqual(F.feed_drops(DAY, p, {"A", "N"}, self.li, []), [])
        a = drive("1", "A", LAT_A, T0, 30)
        last = a[-1]
        p = self.polls({"1": a + drive("1", "A", LAT_A, T0 + 900, 5), "Z": other_bus(T0, T0 + 1200)})
        self.assertEqual(F.feed_drops(DAY, p, {"A", "N"}, self.li, [(last[3], last[4], "Layover")]), [])

    def test_sparse_reporter_is_its_own_code_and_merges(self):
        tr = []
        for k in range(4):                                  # a report every 6 min, moving fast between them
            tr += drive("1", "A", LAT_A, T0 + k * 360, 2, step_s=5, lon0=LON0 + k * 0.004)
        p = self.polls({"1": tr, "Z": other_bus(T0, T0 + 1800)})
        eps = F.feed_drops(DAY, p, {"A", "N"}, self.li, [])
        codes = [e["code"] for e in eps]
        self.assertIn("feed_drop_mid_route", codes)         # the first gap: it was reporting every 5 s
        sparse = [e for e in eps if e["code"] == "sparse_reporting"]
        self.assertEqual(len(sparse), 0)                    # 5 s apart before each gap here
        tr2 = []
        for k in range(5):                                  # reports 150 s, then 330 s apart
            tr2 += [(T0 + k * 480, "A", "t", LAT_A, LON0 + k * 0.004, 9.0, "", T0 + k * 480),
                    (T0 + k * 480 + 150, "A", "t", LAT_A, LON0 + k * 0.004 + 0.002, 9.0, "", T0 + k * 480 + 150)]
        p = self.polls({"1": tr2, "Z": other_bus(T0, T0 + 2100)})
        sp = [e for e in F.feed_drops(DAY, p, {"A", "N"}, self.li, []) if e["code"] == "sparse_reporting"]
        self.assertEqual(len(sp), 1)
        self.assertGreaterEqual(sp[0]["gaps"], 3)

    def test_frozen_gps_needs_motion(self):
        frozen = [(T0 + k * 10, "A", "t", LAT_A, LON0 + 0.01, 7.0, "", T0 + k * 10) for k in range(40)]
        p = self.polls({"1": frozen})
        self.assertEqual([e["code"] for e in F.frozen_gps(DAY, p, {"A"})], ["frozen_gps"])
        parked = [(T0 + k * 10, "A", "t", LAT_A, LON0 + 0.01, 0.0, "", T0 + k * 10) for k in range(40)]
        self.assertEqual(F.frozen_gps(DAY, self.polls({"1": parked}), {"A"}), [])

    def test_position_jump_merges_and_spike(self):
        tr = drive("1", "A", LAT_A, T0, 5)
        t = tr[-1][0]
        tr.append((t + 10, "A", "t", LAT_A + 0.02, LON0, 8.0, "", t + 10))          # 2.2 km away
        tr.append((t + 20, "A", "t", tr[-2][3], tr[-2][4], 8.0, "", t + 20))        # straight back
        tr += drive("1", "A", LAT_A, t + 30, 3, lon0=tr[-1][4])
        eps = F.position_jumps(DAY, self.polls({"1": tr}), {"A"})
        self.assertEqual(len(eps), 1)
        self.assertEqual((eps[0]["outcome"], eps[0]["jumps"]), ("spike", 2))

    def test_twin_buses_same_label_only(self):
        a = drive("1", "A", LAT_A, T0, 30)
        b = [(r[0] + 2, r[1], r[2], r[3] + 0.0001, r[4], r[5], "", r[7] + 2) for r in a]
        eps = F.twin_buses(DAY, self.polls({"1": a, "2": b}), {"A"})
        self.assertEqual([(e["vehicle_id"], e["other_vehicle"], e["outcome"]) for e in eps], [("1", "2", "convoy")])
        c = [(r[0], "B", r[2], r[3], r[4], r[5], "", r[7]) for r in b]
        self.assertEqual(F.twin_buses(DAY, self.polls({"1": a, "2": c}), {"A", "B"}), [])

    def test_after_hours(self):
        spans3 = {"A": [(T0 - 7200, T0)]}
        tr = drive("1", "A", LAT_A, T0 + 600, 10, step_s=30) + drive("1", "A", LAT_A, T0 + 1200, 20, step_s=30)
        eps = F.after_hours(DAY, self.polls({"1": tr}), {"A"}, spans3, {})
        self.assertEqual(len(eps), 1)                         # starts > 15 min after the end
        self.assertEqual((eps[0]["side"], eps[0]["outcome"]), ("after", "not_serving"))
        self.assertGreater(eps[0]["start"], T0 + 900)


class LabelTest(unittest.TestCase):
    def test_wrong_line_needs_30_min_off_label(self):
        li = L.LineIndex(SHAPES)
        tr = shuttle("A", LAT_B, T0, 360)                                    # labeled A, drives B, 60 min
        p = L.DayPolls.from_tracks({"1": tr})
        eps = LB.wrong_line(DAY, p, li, {"A", "B", "N"}, {})
        self.assertEqual(len(eps), 1)
        self.assertEqual((eps[0]["route_id"], eps[0]["other_route"], eps[0]["outcome"]), ("A", "B", "kept_label"))
        short = shuttle("A", LAT_B, T0, 120)                                 # 20 min: not enough
        self.assertEqual(LB.wrong_line(DAY, L.DayPolls.from_tracks({"1": short}), li, {"A", "B"}, {}), [])
        own = shuttle("A", LAT_A, T0, 360)                                   # on its own line
        self.assertEqual(LB.wrong_line(DAY, L.DayPolls.from_tracks({"1": own}), li, {"A", "B"}, {}), [])

    def test_flipflop(self):
        tr = drive("1", "A", LAT_A, T0, 10) + drive("1", "B", LAT_A, T0 + 100, 6) + drive("1", "A", LAT_A, T0 + 160, 10)
        eps = LB.flipflops(DAY, L.DayPolls.from_tracks({"1": tr}), {"A", "B"})
        self.assertEqual([(e["route_id"], e["other_route"]) for e in eps], [("A", "B")])


class PassioTest(unittest.TestCase):
    def test_ghost_and_join(self):
        rows = [{"event_id": "e1", "kind": "leave", "label": "shift_end", "passio_pred_after_min": "22.0",
                 "phantom_stops": "6", "epoch": str(T0), "route_id": "A", "vehicle_id": "1", "spot_lat": "", "spot_lon": "",
                 "spot": "X"},
                {"event_id": "e2", "kind": "leave", "label": "layover_swap", "passio_pred_after_min": "30",
                 "phantom_stops": "0", "epoch": str(T0), "route_id": "A", "vehicle_id": "2", "spot_lat": "", "spot_lon": "",
                 "spot": "X"}]
        g = P.ghost_predictions(DAY, rows)
        self.assertEqual([(e["vehicle_id"], e["beyond_gone_min"], e["stops_affected"]) for e in g], [("1", 7.0, 6)])
        add = [{"event_id": "e3", "kind": "add", "label": "added_from_garage", "epoch": str(T0), "route_id": "A",
                "vehicle_id": "3", "spot_lat": "", "spot_lon": "", "spot": "Y"}]
        arr = {"3": [(T0 + 120, "A", "s1", "S1", 0, 0, False, "proximity"), (T0 + 300, "A", "s2", "S2", 0, 0, False, "proximity")]}
        preds = {"3": [(T0 + 400, T0 + 500, "trA", "s3", T0 + 700)]}
        j = P.joining_no_predictions(DAY, add, arr, preds, {"trA": "A"})
        self.assertEqual([(e["stops_affected"], e["outcome"]) for e in j], [(2, "predicted_later")])
        preds_early = {"3": [(T0 + 30, T0 + 500, "trA", "s3", T0 + 700)]}
        self.assertEqual(P.joining_no_predictions(DAY, add, arr, preds_early, {"trA": "A"}), [])

    def test_staying_late(self):
        rows = [{"event_id": "e1", "kind": "leave", "label": "break", "buses_after": "1", "epoch": str(T0),
                 "route_id": "A", "vehicle_id": "1", "spot_lat": "", "spot_lon": "", "spot": "X"}]
        p = L.DayPolls.from_tracks({"1": drive("1", "A", LAT_A, T0 - 300, 30), "2": drive("2", "A", LAT_A, T0 - 300, 60)})
        pc = {("A", "2"): [(T0 + 900, 600, -400, "s1"), (T0 + 900, 900, -300, "s1"), (T0 + 1500, 1200, -100, "s2")]}
        eps, tagged = P.staying_late(DAY, rows, p, pc)
        self.assertEqual(len(tagged), 3)
        self.assertEqual([(e["vehicle_id"], e["median_err_min"], e["late_rows"]) for e in eps], [("2", -5.0, 2)])
        pc_ok = {("A", "2"): [(T0 + 900, 600, -30, "s1"), (T0 + 900, 900, 20, "s1")]}
        self.assertEqual(P.staying_late(DAY, rows, p, pc_ok)[0], [])

    def test_bunching(self):
        arr = {"3": [(T0 + k * 300, "A", f"s{k}", "", 0, 0, True, "") for k in range(4)],
               "4": [(T0 + k * 300 + 60, "A", f"s{k}", "", 0, 0, True, "") for k in range(4)]}
        rarr = P.route_arrivals(arr, T0 - 10, T0 + 5000)
        add = [{"event_id": "e3", "kind": "add", "label": "added_from_garage", "epoch": str(T0 - 5), "route_id": "A",
                "vehicle_id": "3", "spot_lat": "", "spot_lon": "", "spot": "Y"}]
        eps = P.bunching_after_add(DAY, add, rarr)
        self.assertEqual([(e["other_vehicle"], e["arrivals_during"]) for e in eps], [("4", 4)])
        self.assertTrue(all(b for _, b in P.bunched_flags(rarr)["A"]))


class ScheduleTest(unittest.TestCase):
    def test_bus_count_and_start_end(self):
        tr = {"1": drive("1", "A", LAT_A, T0 + 1800, 180, step_s=20)}       # from 10:30 to 11:30
        p = L.DayPolls.from_tracks(tr)
        bc = S.BusCount(p, {"A"})
        self.assertEqual(bc.at("A", T0 + 2000), 1)
        self.assertEqual(bc.at("A", T0 + 1800 + 180 * 20 + 700), 0)          # silent > 10 min
        eps = S.start_end(DAY, {"A": [(T0, T0 + 3 * 3600)]}, bc)
        self.assertEqual(sorted(e["code"] for e in eps), ["service_end_early", "service_start_late"])

    def test_step_add_missed(self):
        tr = {"1": drive("1", "A", LAT_A, T0 - 3600, 400, step_s=20)}       # one bus 09:00 to 11:13
        bc = S.BusCount(L.DayPolls.from_tracks(tr), {"A"})
        eps = S.step_mismatches(DAY, [("A", T0, 1, 2)], bc, [])
        self.assertEqual([e["code"] for e in eps], ["timetable_add_missed"])
        joined = [{"kind": "add", "label": "added_from_garage", "route_id": "A", "epoch": str(T0 + 300)}]
        self.assertEqual(S.step_mismatches(DAY, [("A", T0, 1, 2)], bc, joined), [])

if __name__ == "__main__":
    unittest.main(verbosity=1)
