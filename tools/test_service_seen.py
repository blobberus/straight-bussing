#!/usr/bin/env python3
"""Tests for tools/build_service_seen.py (web/data/service_seen.json): stints, layovers against breaks, shifts and bus
order, transitions, the listed-hours filter, day types and the file's self-explanation. Synthetic data only (no
network, no tools/build_gtfs.py: the timetable folder is pre-built in the cache the way static_for() names it).

  python tools/test_service_seen.py
"""
import gzip, hashlib, json, sys, tempfile, unittest, zipfile
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_service_seen as B   # noqa: E402

CT = B.CT
# two lines: A runs along a straight north-south street, B along an east-west one
SHAPES = {"A": [[[41.78, -87.60], [41.80, -87.60]]], "B": [[[41.79, -87.61], [41.79, -87.59]]]}
ROUTES = {"A": {"long": "Line A"}, "B": {"long": "Line B"}, "N": {"long": "Night"}}
WEEK = {k: {"spans": [["07:00", "19:00"]]} for k in B.DOWS[:5]}
SERVICE = {"routes": {"A": {"days": dict(WEEK)}, "B": {"days": {k: {"spans": [["10:00", "20:00"]]} for k in B.DOWS}},
                      "N": {"days": {"fri": {"spans": [["18:00", "24:55"]]}, "sat": {"spans": [["18:00", "24:55"]]}}}}}


def ts(day, hhmm):
    d = date.fromisoformat(day)
    h, m = map(int, hhmm.split(":"))
    extra, h = divmod(h, 24)
    d2 = d + timedelta(days=extra)
    return int(datetime(d2.year, d2.month, d2.day, h, m, tzinfo=CT).timestamp())


class Folder:
    """A fetch.py-like folder: raw polls, a dummy timetable zip per day (its static folder pre-built) and arrivals."""

    def __init__(self, service=SERVICE):
        self.tmp = tempfile.TemporaryDirectory()
        self.dl = Path(self.tmp.name)
        self.cache = self.dl / "static"
        self.polls, self.arr = {}, []
        self.service = service

    def report(self, day, veh, rid, hhmm, lat=41.79, lon=-87.60):
        t = ts(day, hhmm)
        self.polls.setdefault(day, []).append({"t": t, "h": t + 5, "v": [[veh, "trip", rid, lat, lon, 0, 5, 0, "", None, t]]})

    def arrive(self, day, veh, rid, hhmm, stop="S1"):
        self.arr.append((ts(day, hhmm), rid, veh, stop))

    def write(self):
        for day, ps in self.polls.items():
            t0, t1 = B.day_bounds(day)
            beats = [{"t": t, "h": t, "v": []} for t in range(t0 + 60, t1 - 60, 120)]   # the collector polls all day
            with gzip.open(self.dl / f"raw-polls-{day}.jsonl.gz", "wt", encoding="utf-8") as f:
                for p in sorted(ps + beats, key=lambda p: p["h"]):
                    f.write(json.dumps(p) + "\n")
            zp = self.dl / f"gtfs-{day}.zip"
            with zipfile.ZipFile(zp, "w") as z:
                z.writestr("agency.txt", "agency_id\nX\n")
            h = hashlib.sha1()
            with zipfile.ZipFile(zp) as z:
                for n in sorted(z.namelist()):
                    h.update(n.encode()); h.update(z.read(n))
            out = self.cache / ("static-" + h.hexdigest()[:12])
            out.mkdir(parents=True, exist_ok=True)
            for n, obj in (("routes.json", ROUTES), ("shapes.json", SHAPES), ("service.json", self.service)):
                (out / n).write_text(json.dumps(obj), encoding="utf-8")
        with open(self.dl / "arrivals.csv", "w", encoding="utf-8", newline="") as f:
            f.write("epoch,route_id,vehicle_id,stop_id,stop_name\n")
            for t, rid, veh, stop in sorted(self.arr):
                f.write(f"{t},{rid},{veh},{stop},{stop}\n")
        return self

    def run(self, d0, d1, cal=None, odd=None):
        cal_path = None
        if cal is not None:
            cal_path = self.dl / "calendar.json"
            cal_path.write_text(json.dumps(cal), encoding="utf-8")
        return B.run(str(self.dl), d0, d1, None, str(self.cache), odd=odd, cal_path=cal_path, generated="2026-11-11",
                     log=lambda m: None)


def serve(f, day, veh, rid, a, b, step=10, stop_first="S1", stop_last="S9", lat=41.79, lon=-87.60):
    """Arrivals every `step` min from a to b (clock 'HH:MM') with a report at each."""
    t, end = B.mins(a), B.mins(b)
    first = True
    while t <= end:
        hm = f"{t // 60:02d}:{t % 60:02d}"
        f.arrive(day, veh, rid, hm, stop_first if first else (stop_last if t + step > end else "S5"))
        f.report(day, veh, rid, hm, lat, lon)
        first = False
        t += step


MON = "2026-11-09"


class Helpers(unittest.TestCase):
    def test_clock_and_stats(self):
        self.assertEqual(B.hhmm(1470.4), "24:30")
        self.assertEqual(B.clock_min(ts(MON, "24:30"), MON), 1470)
        self.assertEqual(B.pct([1, 2, 3, 4, 5], 0.5), 3)
        self.assertAlmostEqual(B.pct([0, 10], 0.1), 1.0)
        s = B.stat([600, 610, 620])
        self.assertEqual((s["p50"], s["n"]), ("10:10", 3))
        self.assertIsNone(B.stat([]))

    def test_dow_label(self):
        self.assertEqual(B.dow_label(["mon", "wed", "thu", "fri"]), "mon+wed-fri")
        self.assertEqual(B.dow_label(["fri"]), "fri")
        self.assertEqual(B.dow_label(["mon", "tue"]), "mon-tue")

    def test_listed_share(self):
        self.assertEqual(B.listed_share([(600, 700)], 650, 750), 0.5)
        self.assertEqual(B.listed_share([(600, 700)], 650, 650), 1.0)
        self.assertEqual(B.listed_share([(600, 700)], 800, 800), 0.0)

    def test_differs_needs_a_real_pattern(self):
        late = [1440, 1442, 1445, 1441]
        normal = [1380, 1382, 1379, 1385, 1381, 1383]
        self.assertTrue(B.differs(late, normal)[1])
        noisy = [1380, 1382, 1440, 1441]          # two odd days only
        self.assertFalse(B.differs(noisy, normal)[1])


class Stints(unittest.TestCase):
    def arr(self, times, rid="A"):
        return [(ts(MON, t), rid, "S") for t in times]

    def test_layover_joins_and_break_splits(self):
        st = B.stints_of(self.arr(["08:00", "08:10", "08:20", "08:45", "08:55", "09:05"]), [])
        self.assertEqual(len(st), 1)                       # a 25 min silence is a layover
        st = B.stints_of(self.arr(["08:00", "08:10", "08:20", "09:00", "09:10", "09:20"]), [])
        self.assertEqual(len(st), 2)                       # 40 min: a break (two stints)

    def test_blip_dropped_and_rejoined(self):
        a = self.arr(["08:00", "08:10", "08:20"]) + self.arr(["08:25"], "B") + self.arr(["08:30", "08:40", "08:50"])
        st = B.stints_of(sorted(a), [])
        self.assertEqual([(s[0], s[3]) for s in st], [("A", 6)])

    def test_collector_gap_does_not_split(self):
        gap = [(ts(MON, "08:25"), ts(MON, "09:25"))]
        st = B.stints_of(self.arr(["08:00", "08:10", "08:20", "09:30", "09:40", "09:50"]), gap)
        self.assertEqual(len(st), 1)


class Build(unittest.TestCase):
    def setUp(self):
        self._folders = []

    def tearDown(self):
        for f in self._folders:
            f.tmp.cleanup()

    def folder(self):
        f = Folder()
        self._folders.append(f)
        return f

    def test_shifts_order_breaks_transition(self):
        f = self.folder()
        # bus 2 reports first (06:40, deadheading under A's label) and serves 07:00-12:00 with a 45 min break
        f.report(MON, "2", "A", "06:40")
        serve(f, MON, "2", "A", "07:00", "09:00")
        serve(f, MON, "2", "A", "09:40", "12:00")
        # bus 1 serves A 08:00-10:00, then drives to line B (still labeled A, far off both lines) and serves B
        serve(f, MON, "1", "A", "08:00", "10:00")
        f.report(MON, "1", "A", "10:05", 41.70, -87.70)
        f.report(MON, "1", "A", "10:08", 41.70, -87.70)
        f.report(MON, "1", "B", "10:12", 41.79, -87.605)
        serve(f, MON, "1", "B", "10:15", "13:00")
        # a bus under A's label at 04:30 (outside the listed hours): never a Bus k
        serve(f, MON, "9", "A", "04:30", "05:00", step=5)
        doc, facts = f.write().run(MON, MON)
        e = doc["lines"]["A"]["days"][0]
        self.assertEqual(e["type"], "weekday")
        buses = e["buses"]
        self.assertEqual([b["vehicle"] for b in buses], ["2", "1"])     # order of first report
        self.assertEqual(buses[0]["first_report"]["p50"], "06:40")
        self.assertEqual(buses[0]["first_stop"]["p50"], "07:00")
        self.assertEqual(buses[0]["last_stop"]["p50"], "12:00")
        self.assertEqual(buses[0]["breaks_days"], 1)
        self.assertEqual(buses[1]["last_stop"]["p50"], "10:00")
        self.assertEqual(buses[1]["last_report"]["p50"], "10:08")       # it kept A's label on the way
        self.assertEqual(e["seen"]["last_stop"]["p50"], "12:00")
        self.assertEqual(e["listed"]["spans"], [["07:00", "19:00"]])
        self.assertEqual(e["vs_listed"]["end_early_min"], 7 * 60)
        self.assertEqual(e["outside_listed"]["times"], 1)
        tr = [t for f_ in facts for t in f_["transitions"]]
        self.assertEqual(len(tr), 1)
        t = tr[0]
        self.assertEqual((t["from"], t["to"], t["from_order"], t["to_order"]), ("A", "B", 2, 1))
        self.assertEqual(dict(t["labels"]), {"from": 2, "to": 1})
        self.assertEqual((t["off_line"], t["judged"]), (2, 3))
        self.assertAlmostEqual(t["to_label_min"], 12.0)
        self.assertEqual(doc["transitions"], [])                       # seen on 1 day only: not a usual transition

    def test_usual_transition_kept_over_days(self):
        f = self.folder()
        days = ["2026-11-02", "2026-11-03", "2026-11-04"]
        for d in days:
            serve(f, d, "1", "A", "08:00", "10:00")
            f.report(d, "1", "B", "10:06", 41.79, -87.605)
            serve(f, d, "1", "B", "10:10", "12:00")
        doc, _ = f.write().run(days[0], days[-1])
        (t,) = doc["transitions"]
        self.assertEqual((t["from"], t["to"], t["day_type"], t["days"], t["of_days"]), ("A", "B", "weekday", 3, 3))
        self.assertEqual((t["kind"], t["leave"]["p50"], t["join"]["p50"], t["gap_min"]), ("direct", "10:00", "10:10", 10))
        self.assertEqual(t["label_on_the_way"], "to")
        self.assertEqual(t["off_line_share"], 0.0)

    def test_calendar_leaves_out_breaks(self):
        f = self.folder()
        for d in ("2026-11-02", "2026-11-03"):
            serve(f, d, "1", "A", "08:00", "10:00")
        cal = {"regimes": [{"start": "2026-11-03", "end": "2026-11-03", "regime": "break"}]}
        doc, _ = f.write().run("2026-11-02", "2026-11-03", cal=cal)
        self.assertEqual(doc["days_used"], 1)
        self.assertEqual(doc["days_left_out"], [{"day": "2026-11-03", "why": "calendar: break"}])

    def test_listed_split_and_friday_check(self):
        f = self.folder()
        thu, fri, sat = "2026-11-05", "2026-11-06", "2026-11-07"
        serve(f, thu, "1", "A", "08:00", "10:00")              # Thursday has polls, N is not listed then
        serve(f, fri, "5", "N", "18:00", "24:40")
        serve(f, sat, "5", "N", "18:00", "24:30")
        doc, _ = f.write().run(thu, sat)
        types = {e["type"]: e for e in doc["lines"]["N"]["days"]}
        self.assertEqual(set(types), {"fri", "sat"})               # Mon-Thu not listed and not seen: no entry
        self.assertIn("different hours", types["fri"]["split"])
        self.assertEqual(types["fri"]["seen"]["last_stop"]["p50"], "24:40")

    def test_timetable_change_keeps_the_newest_listing(self):
        new = {"routes": {"A": {"days": {k: {"spans": [["08:00", "19:00"]]} for k in B.DOWS[:5]}}, "B": SERVICE["routes"]["B"],
                          "N": SERVICE["routes"]["N"]}}
        listed = {"2026-11-02": SERVICE, "2026-11-09": new}          # two Mondays, the timetable changed between them
        ld = {"2026-11-02": {"first_stop": 420, "last_stop": 600}, "2026-11-09": {"first_stop": 480, "last_stop": 600}}
        g = B.group_days("A", ["2026-11-02", "2026-11-09"], lambda rid, d: B.listed_spans(listed[d], rid, d), ld)
        self.assertEqual([(x[0], x[2]) for x in g], [("weekday", ["2026-11-09"])])
        self.assertIn("1 earlier day", g[0][3])

    def test_file_explains_itself_and_is_json(self):
        f = self.folder()
        serve(f, MON, "1", "A", "08:00", "10:00")
        doc, _ = f.write().run(MON, MON)
        txt = B.dump(doc)
        back = json.loads(txt)
        for k in ("about", "fields", "method", "why_seen_differs_from_listed", "layovers_vs_lasting",
                  "how_the_app_uses_it", "refresh", "valid_until", "lines", "transitions"):
            self.assertIn(k, back)
        self.assertEqual(list(back)[0], "about")
        self.assertEqual(back["valid_until"], "2026-12-24")
        self.assertIn("buses[]", back["fields"])

    def test_wrong_label_arrivals_left_out(self):
        f = self.folder()
        serve(f, MON, "1", "A", "08:00", "10:00")
        f.write()
        odd = f.dl / "odd.csv"
        odd.write_text("code,vehicle_id,local_time,end_time\nwrong_line_label,1,2026-11-09 07:59,2026-11-09 10:01\n",
                       encoding="utf-8")
        doc, _ = f.run(MON, MON, odd=str(odd))
        self.assertNotIn("buses", doc["lines"]["A"]["days"][0])


class RealFile(unittest.TestCase):
    """The committed web/data/service_seen.json keeps its schema (what web/js and the Kit read)."""

    def test_committed_file(self):
        p = B.ROOT / "web" / "data" / "service_seen.json"
        if not p.exists():
            self.skipTest("no committed file")
        d = json.loads(p.read_text(encoding="utf-8"))
        for k in ("about", "fields", "method", "refresh", "from", "to", "valid_until", "lines", "transitions"):
            self.assertIn(k, d)
        for rid, ln in d["lines"].items():
            self.assertTrue(ln["name"])
            for e in ln["days"]:
                self.assertTrue(set(e["dows"]) <= set(B.DOWS))
                self.assertIn("spans", e["listed"])
                for b in e.get("buses", []):
                    for k in ("first_report", "first_stop", "last_stop", "last_report"):
                        self.assertRegex(b[k]["p50"], r"^\d\d:\d\d$")
        for t in d["transitions"]:
            self.assertIn(t["from"], d["lines"])
            self.assertIn(t["label_on_the_way"], ("from", "to", "other", "none"))


if __name__ == "__main__":
    unittest.main(verbosity=1)
