#!/usr/bin/env python3
"""Tests of the E30 odd-behavior rules on small synthetic tracks (stdlib unittest; numpy for the reused E27 helpers).

  python experiments/routeknower/E30-scripts/test_odd.py
"""
import sys, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import odd_lib as L          # noqa: E402

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

if __name__ == "__main__":
    unittest.main(verbosity=1)
