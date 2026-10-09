#!/usr/bin/env python3
"""Context data for RouteKnower: weather and traffic around the shuttle network. Stdlib only.

  python tools/context_fetch.py weather-obs  --start 2026-10-08 --end 2026-10-09 --out data/context/weather_mdw.csv
  python tools/context_fetch.py weather-grid --start 2026-10-08 --end 2026-10-09 --out data/context/weather_campus.csv
  python tools/context_fetch.py traffic-regions --start 2018-03-01 --end 2026-05-01 --out data/context/traffic_regions_hourly.csv
  python tools/context_fetch.py recent --days 4 --dir data/context      # what .github/workflows/context.yml runs daily

Sources (vetted 2026-10-08; reasons and rejected sources in RouteKnower.md §3.4):
  weather-obs      Iowa Environmental Mesonet (IEM) ASOS archive, station MDW = Chicago Midway airport, about
                   10 km west of campus. Hourly routine METARs (temperature, wind, visibility, 1-hour precipitation,
                   present-weather codes such as RA / SN / FG, snow depth). Free; 1 request/s per-IP throttle.
  weather-grid     Open-Meteo hourly model data at the campus point (41.7886, -87.5987): precipitation, rain,
                   snowfall, snow depth, weather code, wind. CC BY 4.0: credit "Weather data by Open-Meteo.com".
                   Archive API for dates older than 5 days, forecast API (past days) otherwise.
  traffic-regions  City of Chicago Traffic Tracker, "Historical Congestion Estimates by Region - 2018-2026"
                   (data.cityofchicago.org, dataset kf7e-cur8): mean arterial speed per region, estimated by the
                   city from CTA bus GPS every 10 min. City of Chicago Data Portal terms of use.
                   NO LONGER UPDATED: the newest record is 2026-04-30, so it is a historical prior only.
Requests carry only dates, fixed station/region ids and the campus point, plus a contact User-Agent.
Output CSVs are merged by key (re-running a range is safe) and sorted by time.
"""
import argparse, csv, json, sys, time, urllib.error, urllib.parse, urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from model_core import chicago  # America/Chicago wall clock with a DST fallback (Windows has no tzdata)

UA = "StraightBussing-research/1.0 (unofficial student project; github.com/blobberus/straight-bussing)"
CAMPUS = (41.7886, -87.5987)
IEM = "https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py"
OM_FORECAST = "https://api.open-meteo.com/v1/forecast"
OM_ARCHIVE = "https://archive-api.open-meteo.com/v1/archive"
SODA_REGIONS = "https://data.cityofchicago.org/resource/kf7e-cur8.json"
# Traffic Tracker regions that contain shuttle stops (2026-10-08: 76 / 7 / 6 / 2 of 91 stops)
REGIONS = {"21": "Hyde Park-Kenwood-Woodlawn", "13": "Chicago Loop", "20": "Fuller-Grand Blvd-Washington Park",
           "29": "Downtown Lakefront"}
OBS_FIELDS = ["tmpf", "dwpf", "relh", "sknt", "gust", "vsby", "p01i", "wxcodes", "snowdepth", "skyc1", "skyl1"]
GRID_FIELDS = ["temperature_2m", "precipitation", "rain", "snowfall", "snow_depth", "weather_code", "wind_speed_10m",
               "wind_gusts_10m"]

OBS_HEADER = ["epoch", "ts_utc", "local_time", "station"] + OBS_FIELDS
GRID_HEADER = ["epoch", "ts_utc", "local_time"] + GRID_FIELDS
TRAFFIC_HEADER = ["epoch", "ts_utc", "local_time", "region_id", "region", "speed_mph", "bus_count", "n_estimates"]


def get(url, params, timeout=90, tries=3, pause=0.0):
    """GET with a contact User-Agent and simple retries. Returns the body text."""
    full = url + "?" + urllib.parse.urlencode(params, doseq=True)
    last = None
    for i in range(tries):
        if pause:
            time.sleep(pause)
        try:
            req = urllib.request.Request(full, headers={"User-Agent": UA, "Accept": "*/*"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read().decode("utf-8", "replace")
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            last = e
            time.sleep(2 + 3 * i)
    raise RuntimeError(f"GET failed after {tries} tries: {full[:120]}... ({last})")


def stamp(epoch):
    """(ts_utc ISO, local wall clock 'YYYY-MM-DD HH:MM:SS') for unix seconds."""
    utc = datetime.fromtimestamp(epoch, timezone.utc)
    return utc.strftime("%Y-%m-%dT%H:%M:%SZ"), chicago(epoch).strftime("%Y-%m-%d %H:%M:%S")


def merge_csv(path, header, rows, key):
    """Merge rows (dicts) into CSV `path` by key fields; newer rows replace older ones. Returns (added, total)."""
    path = Path(path)
    old = {}
    if path.exists() and path.stat().st_size:
        with open(path, newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                old[tuple(r.get(k, "") for k in key)] = r
    before = len(old)
    for r in rows:
        old[tuple(str(r.get(k, "")) for k in key)] = {h: r.get(h, "") for h in header}
    path.parent.mkdir(parents=True, exist_ok=True)
    out = sorted(old.values(), key=lambda r: (float(r.get("epoch") or 0), [r.get(k, "") for k in key]))
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=header, extrasaction="ignore")
        w.writeheader()
        w.writerows(out)
    return len(old) - before, len(old)


def parse_iem(text, station="MDW"):
    """IEM asos.py 'onlycomma' output (tz=Etc/UTC) -> rows. 'M' (missing) becomes ''; trace precip 'T' -> 0.0001."""
    rows = []
    for r in csv.DictReader(line for line in text.splitlines() if line and not line.startswith("#")):
        try:
            epoch = int(datetime.strptime(r["valid"], "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc).timestamp())
        except (KeyError, ValueError):
            continue
        d = {"epoch": epoch, "station": r.get("station") or station}
        d["ts_utc"], d["local_time"] = stamp(epoch)
        for k in OBS_FIELDS:
            v = (r.get(k) or "").strip()
            d[k] = "0.0001" if (k == "p01i" and v == "T") else ("" if v in ("M", "") else v)
        rows.append(d)
    return rows


def weather_obs(start, end, station="MDW"):
    """Hourly routine METARs for [start, end) (dates). One request per 31 days (IEM throttle respected)."""
    rows, d0 = [], start
    while d0 < end:
        d1 = min(end, d0 + timedelta(days=31))
        p = {"station": station, "data": OBS_FIELDS, "tz": "Etc/UTC", "format": "onlycomma", "report_type": "3",
             "year1": d0.year, "month1": d0.month, "day1": d0.day, "year2": d1.year, "month2": d1.month, "day2": d1.day}
        rows += parse_iem(get(IEM, p, pause=1.1), station)
        d0 = d1
    return rows


def parse_open_meteo(j):
    """Open-Meteo JSON (timeformat=unixtime) -> rows."""
    h = (j or {}).get("hourly") or {}
    rows = []
    for i, t in enumerate(h.get("time") or []):
        d = {"epoch": int(t)}
        d["ts_utc"], d["local_time"] = stamp(int(t))
        for k in GRID_FIELDS:
            col = h.get(k)
            v = col[i] if col and i < len(col) else None
            d[k] = "" if v is None else v
        rows.append(d)
    return rows


def weather_grid(start, end, today=None):
    """Hourly model weather at the campus point for [start, end)."""
    today = today or date.today()
    url = OM_ARCHIVE if end <= today - timedelta(days=5) else OM_FORECAST
    p = {"latitude": CAMPUS[0], "longitude": CAMPUS[1], "hourly": ",".join(GRID_FIELDS), "timezone": "GMT",
         "timeformat": "unixtime", "start_date": start.isoformat(), "end_date": (end - timedelta(days=1)).isoformat()}
    return parse_open_meteo(json.loads(get(url, p)))


def parse_regions(items):
    """Socrata rows {region_id, day (floating ISO date, Chicago local), hour (0-23), avg_speed, buses, n} -> rows.
    The portal stores local Chicago time without an offset (its record_id carries UTC), so local hours are
    turned into epochs as Chicago time."""
    rows = []
    for it in items or []:
        try:
            local = datetime.strptime(it["day"][:10], "%Y-%m-%d") + timedelta(hours=int(it["hour"]))
        except (KeyError, ValueError, TypeError):
            continue
        guess = int(local.replace(tzinfo=timezone.utc).timestamp())          # treat as UTC, then fix the offset
        off = chicago(guess).utcoffset() or timedelta(hours=-6)
        epoch = int(guess - off.total_seconds())
        rid = str(it.get("region_id", ""))
        d = {"epoch": epoch, "region_id": rid, "region": REGIONS.get(rid, ""),
             "speed_mph": round(float(it.get("avg_speed") or 0), 2), "bus_count": it.get("buses", ""), "n_estimates": it.get("n", "")}
        d["ts_utc"], d["local_time"] = stamp(epoch)
        rows.append(d)
    return rows


def traffic_regions(start, end, regions=tuple(REGIONS)):
    """Hourly mean speed per region for [start, end), in 6-month chunks, paginated. Speeds <= 0 (no estimate) skipped."""
    rows, d0 = [], start
    ids = ",".join(f"'{r}'" for r in regions)
    while d0 < end:
        d1 = min(end, d0 + timedelta(days=183))
        offset = 0
        while True:
            q = {"$select": "region_id, date_trunc_ymd(time) as day, hour, avg(speed) as avg_speed, sum(bus_count) as buses, count(*) as n",
                 "$where": f"region_id in({ids}) AND time >= '{d0.isoformat()}T00:00:00' AND time < '{d1.isoformat()}T00:00:00' AND speed > 0",
                 "$group": "region_id, day, hour", "$order": "day, hour, region_id", "$limit": 50000, "$offset": offset}
            items = json.loads(get(SODA_REGIONS, q, timeout=170))
            rows += parse_regions(items)
            if len(items) < 50000:
                break
            offset += 50000
        d0 = d1
    return rows


def _date(s):
    return datetime.strptime(s, "%Y-%m-%d").date()


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["weather-obs", "weather-grid", "traffic-regions", "recent"])
    ap.add_argument("--start", type=_date)
    ap.add_argument("--end", type=_date, help="exclusive")
    ap.add_argument("--out")
    ap.add_argument("--days", type=int, default=4, help="recent: how many past days to (re)fetch")
    ap.add_argument("--dir", default="data/context", help="recent: output folder")
    a = ap.parse_args(argv)
    if a.cmd == "recent":
        end = date.today() + timedelta(days=1)
        start = end - timedelta(days=a.days + 1)
        out = Path(a.dir)
        added, total = merge_csv(out / "weather_mdw.csv", OBS_HEADER, weather_obs(start, end), ["station", "epoch"])
        print(f"weather_mdw.csv: +{added} rows, {total} total")
        added, total = merge_csv(out / "weather_campus.csv", GRID_HEADER, weather_grid(start, end), ["epoch"])
        print(f"weather_campus.csv: +{added} rows, {total} total")
        return 0
    if not (a.start and a.end and a.out) or a.end <= a.start:
        ap.error("--start, --end (exclusive, after start) and --out are required")
    if a.cmd == "weather-obs":
        rows, key, header = weather_obs(a.start, a.end), ["station", "epoch"], OBS_HEADER
    elif a.cmd == "weather-grid":
        rows, key, header = weather_grid(a.start, a.end), ["epoch"], GRID_HEADER
    else:
        rows, key, header = traffic_regions(a.start, a.end), ["region_id", "epoch"], TRAFFIC_HEADER
    added, total = merge_csv(a.out, header, rows, key)
    print(f"{a.out}: fetched {len(rows)}, +{added} new, {total} total")
    return 0


if __name__ == "__main__":
    sys.exit(main())
