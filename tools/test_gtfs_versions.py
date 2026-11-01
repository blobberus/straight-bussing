#!/usr/bin/env python3
"""Asserts on tools/gtfs_versions.py (which timetable each day was collected with; risk review 2026-11-01, DC-021).
  python tools/test_gtfs_versions.py        -> prints 'ok N tests', exits 1 on failure
  SB_GTFS_ZIP=<an archived gtfs-<day>.zip> adds a real build through archive_day.day_timetable."""
import io, os, sys, tempfile, traceback, zipfile
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import gtfs_versions as GV
import service_gate as G

TESTS = []


def test(fn):
    TESTS.append(fn)
    return fn


def make_zip(path, stops="stop_id,stop_name\nA,One\n", feed_start="20261025", when=(2026, 10, 26, 12, 0, 0)):
    with zipfile.ZipFile(path, "w") as z:
        for name, text in (("feed_info.txt", f"feed_publisher_name,feed_start_date,feed_end_date\nPassio,{feed_start},20261125\n"),
                           ("routes.txt", "route_id,route_long_name\nR1,East\n"), ("stops.txt", stops),
                           ("trips.txt", "route_id,trip_id\nR1,T1\nR1,T2\n")):
            info = zipfile.ZipInfo(name, date_time=when)
            z.writestr(info, text)
    return path


def at(y, m, d, hh, mm=0):
    return int(datetime(y, m, d, hh, mm, tzinfo=G.CT).timestamp())


@test
def the_version_ignores_feed_dates_and_zip_times_but_not_the_timetable():
    d = Path(tempfile.mkdtemp(prefix="sb-gtfsv-"))
    a = make_zip(d / "a.zip")
    b = make_zip(d / "b.zip", feed_start="20261026", when=(2026, 10, 27, 18, 0, 0))     # Passio's daily rebuild
    c = make_zip(d / "c.zip", stops="stop_id,stop_name\nA,One\nB,Two\n")                 # a stop added
    assert GV.content_id(a) == GV.content_id(b) != GV.content_id(c)
    assert GV.describe(c) == {"feed_start": "20261025", "feed_end": "20261125", "routes": 1, "stops": 2, "trips": 2}


@test
def record_keeps_one_row_and_one_zip_per_version():
    d = Path(tempfile.mkdtemp(prefix="sb-gtfsv-"))
    csv_p, store = d / "gt" / "gtfs_versions.csv", d / "gt" / "gtfs"
    a, c = make_zip(d / "a.zip"), make_zip(d / "c.zip", stops="stop_id,stop_name\nA,One\nB,Two\n")
    t = at(2026, 10, 25, 8)
    assert GV.record(a, csv_p, store, t, t + 4200)[1] == "new"
    assert GV.record(a, csv_p, store, t + 2400, t + 6600)[1] == "extended"
    assert GV.record(a, csv_p, store, t + 2400, t + 6000)[1] == "same"
    v2, what = GV.record(c, csv_p, store, t + 90000, t + 94200)
    assert what == "new"
    rows = GV.read(csv_p)
    assert [r["version"] for r in rows] == [GV.content_id(a), v2]
    assert rows[0]["first_seen"] == str(t) and rows[0]["last_seen"] == str(t + 6600), rows[0]
    assert rows[0]["first_seen_local"] == "2026-10-25 08:00" and rows[1]["stops"] == "2"
    assert sorted(p.name for p in store.iterdir()) == sorted([f"gtfs-{rows[0]['version']}.zip", f"gtfs-{v2}.zip"])
    assert rows[1]["file"] == f"gtfs/gtfs-{v2}.zip"


@test
def pick_takes_the_version_used_for_most_of_the_service_day():
    d = Path(tempfile.mkdtemp(prefix="sb-gtfsv-"))
    csv_p, store = d / "gtfs_versions.csv", d / "gtfs"
    old, new = make_zip(d / "old.zip"), make_zip(d / "new.zip", stops="stop_id,stop_name\nA,One\nB,Two\n")
    GV.record(old, csv_p, store, at(2026, 10, 24, 5), at(2026, 10, 26, 0, 40))          # through Oct 25's evening
    GV.record(new, csv_p, store, at(2026, 10, 26, 4, 16), at(2026, 10, 28, 1))
    assert GV.pick(csv_p, store, "2026-10-25").name == f"gtfs-{GV.content_id(old)}.zip"
    assert GV.pick(csv_p, store, "2026-10-26").name == f"gtfs-{GV.content_id(new)}.zip"
    assert GV.pick(csv_p, store, "2026-10-20") is None                                # before the record began
    assert GV.pick(d / "missing.csv", store, "2026-10-25") is None


@test
def archive_day_builds_the_days_own_stop_lists():
    z = os.environ.get("SB_GTFS_ZIP")
    if not z or not Path(z).exists():
        return
    import archive_day as AD
    d = Path(tempfile.mkdtemp(prefix="sb-gtfsv-"))
    csv_p, store = d / "gtfs_versions.csv", d / "gtfs"
    GV.record(z, csv_p, store, at(2026, 10, 25, 4, 10), at(2026, 10, 26, 3, 50))
    got = AD.day_timetable("2026-10-25", csv_p, store, d / "work")
    assert got is not None
    zz, web, pat = got
    assert (web / "route_stops.json").exists() and pat.exists() and zz.name.startswith("gtfs-")
    assert AD.day_timetable("2026-10-01", csv_p, store, d / "work") is None


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
