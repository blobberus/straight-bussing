#!/usr/bin/env python3
"""Which timetable (GTFS) each day was collected with.

  python tools/gtfs_versions.py record --zip gtfs.zip --into data/ground_truth/gtfs_versions.csv --store data/ground_truth/gtfs --since T0
  python tools/gtfs_versions.py pick --versions data/ground_truth/gtfs_versions.csv --store data/ground_truth/gtfs --day 2026-10-25
  python tools/gtfs_versions.py id gtfs.zip

Why (risk review 2026-11-01, DC-021): arrival rows carry stop_index, a position in the route's stop list, and that list
comes from Passio's GTFS, which every collect run downloads and builds afresh. When Passio publishes a new timetable
the lists change (Oct 26: Apostolic 9 -> 10 stops, Apostolic/Drexel 10 -> 12), yet the daily archive downloaded the
GTFS the NEXT morning, so gtfs-2026-10-25.zip on the release holds Oct 26's lists, and a replay or forecast table of
Oct 25 built from it would number stops differently from the rows the collector logged that day. Nothing recorded
which timetable a run used.

Now every collect run records the timetable it built from: one row per timetable version in gtfs_versions.csv (first
and last time a run used it, Passio's feed dates, counts) and the zip itself, once per version, as
data/ground_truth/gtfs/gtfs-<version>.zip (about 80 kB; a few versions a month). The version is a hash of the
timetable's content, not of the zip: Passio regenerates the zip every day (new feed dates and file times) even when
nothing changed, so a zip hash would make a new "version" daily. archive_day.py picks the version that was in use for
most of each service day (`pick`). Stdlib only. Tests: tools/test_gtfs_versions.py.
"""
import argparse, csv, hashlib, io, shutil, sys, time, zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import arrivals_lib as L

COLUMNS = ("version", "first_seen", "last_seen", "first_seen_local", "last_seen_local", "feed_start", "feed_end",
           "routes", "stops", "trips", "file")
SKIP = {"feed_info.txt"}            # dates that change daily without a timetable change


def content_id(zip_path):
    """12-hex hash of every timetable file's bytes (by name), feed_info.txt and zip metadata left out."""
    h = hashlib.sha256()
    with zipfile.ZipFile(zip_path) as z:
        for name in sorted(n for n in z.namelist() if not n.endswith("/") and Path(n).name not in SKIP):
            h.update(Path(name).name.encode() + b"\0" + z.read(name) + b"\0")
    return h.hexdigest()[:12]


def describe(zip_path):
    """-> dict of feed dates and counts for the CSV row."""
    def rows(z, name):
        try:
            return list(csv.DictReader(io.StringIO(z.read(name).decode("utf-8-sig"))))
        except KeyError:
            return []
    with zipfile.ZipFile(zip_path) as z:
        fi = (rows(z, "feed_info.txt") or [{}])[0]
        return {"feed_start": fi.get("feed_start_date", ""), "feed_end": fi.get("feed_end_date", ""),
                "routes": len(rows(z, "routes.txt")), "stops": len(rows(z, "stops.txt")), "trips": len(rows(z, "trips.txt"))}


def local(epoch):
    return L.chicago(int(epoch)).strftime("%Y-%m-%d %H:%M")


def read(path):
    p = Path(path)
    if not p.exists():
        return []
    with open(p, encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def write(path, rows):
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(p.name + ".tmp")
    with open(tmp, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(COLUMNS), lineterminator="\n", extrasaction="ignore")
        w.writeheader()
        w.writerows(sorted(rows, key=lambda r: int(r["first_seen"])))
    tmp.replace(p)


def record(zip_path, into, store, since, now=None):
    """Note that a run used this zip from `since` to `now`. -> (version, 'new' | 'extended' | 'same')."""
    now = int(now or time.time())
    since = int(since or now)
    ver = content_id(zip_path)
    rows = read(into)
    row = next((r for r in rows if r["version"] == ver), None)
    store = Path(store)
    store.mkdir(parents=True, exist_ok=True)
    keep = store / f"gtfs-{ver}.zip"
    if not keep.exists():
        shutil.copyfile(zip_path, keep)
    rel = f"gtfs/{keep.name}"
    if row is None:
        rows.append({"version": ver, "first_seen": since, "last_seen": now, "first_seen_local": local(since),
                     "last_seen_local": local(now), **describe(zip_path), "file": rel})
        write(into, rows)
        return ver, "new"
    changed = False
    if since < int(row["first_seen"]):
        row["first_seen"], row["first_seen_local"], changed = since, local(since), True
    if now > int(row["last_seen"]):
        row["last_seen"], row["last_seen_local"], changed = now, local(now), True
    if changed:
        write(into, rows)
    return ver, "extended" if changed else "same"


def pick(versions, store, day):
    """The stored zip of the version in use for the most of service day `day` (04:00 to 04:00 Chicago), or None."""
    import build_eta_dataset as B
    t0, t1 = B.day_bounds(day)
    best, best_s = None, 0
    for r in read(versions):
        s = min(t1, int(r["last_seen"])) - max(t0, int(r["first_seen"]))
        if s > best_s:
            best, best_s = r, s
    if best is None:
        return None
    p = Path(store) / Path(best["file"]).name
    return p if p.exists() else None


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("record")
    r.add_argument("--zip", required=True)
    r.add_argument("--into", required=True)
    r.add_argument("--store", required=True)
    r.add_argument("--since", type=float, help="when the run started using it (epoch; default now)")
    p = sub.add_parser("pick")
    p.add_argument("--versions", required=True)
    p.add_argument("--store", required=True)
    p.add_argument("--day", required=True)
    i = sub.add_parser("id")
    i.add_argument("zip")
    a = ap.parse_args(argv)
    if a.cmd == "record":
        ver, what = record(a.zip, a.into, a.store, a.since)
        print(f"gtfs version {ver}: {what}")
    elif a.cmd == "pick":
        z = pick(a.versions, a.store, a.day)
        if z is None:
            return 1
        print(z)
    else:
        print(content_id(a.zip))
    return 0


if __name__ == "__main__":
    sys.exit(main())
