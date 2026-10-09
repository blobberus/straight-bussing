#!/usr/bin/env python3
"""Join ground-truth arrivals with weather, traffic and fleet context (RouteKnower §3.4, §5 M13). Stdlib only.

  python tools/context_join.py --arrivals arrivals.csv --context data/context --out arrivals_ctx.csv

Every context value uses only information available when the bus STARTED the segment
(t0 = prev_arrival_epoch, else the arrival itself), so backtests stay leakage-free (RouteKnower §6.2):
  wx_*   latest Midway (MDW) hourly observation at or before t0, if it is at most 90 min old
         wx_precip / wx_snow / wx_heavy are 0/1 flags from 1-hour precipitation and present-weather codes
  gr_*   Open-Meteo campus-point values for the hour ENDING at or before t0 (its sums cover the past hour)
  tr_*   typical arterial speed (mph) of the Traffic Tracker region holding the stop, for that weekday
         and hour, from history since 2022 (the city's feed stopped 2026-04-30: typical pattern only)
  fl_*   fleet congestion index: median over every shuttle segment that FINISHED in the 30 min before t0
         (any route) of observed / scheduled segment time; fl_n = how many segments that used
  cal_regime  class / finals / break / holiday from data/calendar.json when present, else ''
"""
import argparse, bisect, csv, json, math, sys
from collections import defaultdict, deque
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from model_core import chicago, WEB_DATA, ROOT

# Traffic Tracker regions holding shuttle stops: (west, east, south, north), from dataset kf7e-cur8
REGION_BOX = {
    "13": (-87.647208, -87.62308, 41.866129, 41.88886),     # Chicago Loop
    "20": (-87.636322, -87.606334, 41.764066, 41.822792),   # Fuller-Grand Blvd-Washington Park
    "21": (-87.606334, -87.56626, 41.764066, 41.822792),    # Hyde Park-Kenwood-Woodlawn
    "29": (-87.62308, -87.595378, 41.866129, 41.911401),    # Downtown Lakefront
}
WX_MAX_AGE = 5400
FLEET_WINDOW = 1800
TYPICAL_SINCE = "2022-01-01"   # skip 2018-2021: pandemic-era traffic is not typical
PRECIP_CODES = ("RA", "SN", "DZ", "PL", "GR", "GS", "SG", "IC", "UP", "TS", "SH")
CTX_COLS = ["wx_age_s", "wx_tmpf", "wx_p01i", "wx_codes", "wx_vsby", "wx_sknt", "wx_snowdepth", "wx_precip", "wx_snow",
            "wx_heavy", "gr_precip_mm", "gr_rain_mm", "gr_snow_cm", "gr_snow_depth_m", "gr_code", "gr_wind",
            "tr_region", "tr_typ_mph", "fl_idx", "fl_n", "cal_regime"]


def _f(x):
    try:
        v = float(x)
        return v if math.isfinite(v) else None
    except (TypeError, ValueError):
        return None


def read_csv(path):
    p = Path(path)
    if not p.exists():
        return []
    with open(p, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def wx_flags(p01i, codes):
    """(precip, snow, heavy) 0/1 flags from 1-hour precip (inches) and METAR present-weather codes."""
    c = (codes or "").upper()
    p = _f(p01i) or 0.0
    precip = int(p >= 0.01 or any(k in c for k in PRECIP_CODES))
    snow = int("SN" in c or "SG" in c or "PL" in c)
    heavy = int(p >= 0.10 or "+" in c or "TS" in c)
    return precip, snow, heavy


def region_of(lat, lon):
    for rid, (w, e, s, n) in REGION_BOX.items():
        if w <= lon <= e and s <= lat <= n:
            return rid
    return ""


def typical_profile(traffic_rows, since=TYPICAL_SINCE):
    """{(region, dow, hour): mean mph} from hourly region speeds since `since` (local date)."""
    acc = defaultdict(lambda: [0.0, 0])
    for r in traffic_rows:
        if (r.get("local_time") or "") < since:
            continue
        v = _f(r.get("speed_mph"))
        e = _f(r.get("epoch"))
        if v is None or v <= 0 or e is None:
            continue
        t = chicago(e)
        a = acc[(r.get("region_id", ""), t.weekday(), t.hour)]
        a[0] += v
        a[1] += 1
    return {k: s / n for k, (s, n) in acc.items() if n}


def load_calendar(path):
    """data/calendar.json {"regimes": [{"start":"YYYY-MM-DD","end":"YYYY-MM-DD","regime":"finals"}, ...]} (end inclusive)."""
    try:
        j = json.loads(Path(path).read_text(encoding="utf-8"))
        return [(x["start"], x["end"], x["regime"]) for x in j.get("regimes", [])]
    except (OSError, ValueError, KeyError, TypeError):
        return []


def regime_on(cal, day):
    for s, e, reg in cal:
        if s <= day <= e:
            return reg
    return ""


def scheduled_seconds():
    """{(route, prev_stop, stop): scheduled seconds incl. dwell} from web/data/segments.json + route_stops.json."""
    try:
        seg = json.loads((WEB_DATA / "segments.json").read_text(encoding="utf-8")).get("routes", {})
        order = json.loads((WEB_DATA / "route_stops.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    out = {}
    for rid, s in seg.items():
        ids, arr, dw = order.get(rid) or [], s.get("seg") or [], float(s.get("dwell") or 0)
        for i in range(min(len(ids) - 1, len(arr))):
            if isinstance(arr[i], (int, float)) and arr[i] > 0:
                out[(rid, str(ids[i]), str(ids[i + 1]))] = float(arr[i]) + dw
    return out


def join(arrivals, wx_rows, grid_rows, traffic_rows, cal=(), sched=None):
    """Return arrival dicts with CTX_COLS added (input order kept)."""
    sched = scheduled_seconds() if sched is None else sched
    wx = sorted(((int(float(r["epoch"])), r) for r in wx_rows if _f(r.get("epoch")) is not None), key=lambda x: x[0])
    wx_t = [t for t, _ in wx]
    grid = {int(float(r["epoch"])): r for r in grid_rows if _f(r.get("epoch")) is not None}
    typ = typical_profile(traffic_rows)
    t0_of = lambda r: _f(r.get("prev_arrival_epoch")) or _f(r.get("epoch")) or 0
    # fleet index: process in arrival order; a segment enters the window once it has finished (its epoch)
    done = sorted((_f(r.get("epoch")) or 0, i) for i, r in enumerate(arrivals))
    ratio = {}
    for i, r in enumerate(arrivals):
        s = sched.get((r.get("route_id", ""), r.get("prev_stop_id", ""), r.get("stop_id", "")))
        seg = _f(r.get("segment_s"))
        if s and seg and 0 < seg < 1800:
            ratio[i] = math.log(seg / s)
    out = [None] * len(arrivals)
    win, j = deque(), 0
    for i in sorted(range(len(arrivals)), key=lambda k: t0_of(arrivals[k])):
        r = dict(arrivals[i])
        t0 = t0_of(r)
        while j < len(done) and done[j][0] < t0:
            if done[j][1] in ratio:
                win.append((done[j][0], ratio[done[j][1]]))
            j += 1
        while win and win[0][0] < t0 - FLEET_WINDOW:
            win.popleft()
        vals = sorted(v for _, v in win)
        r["fl_n"] = len(vals)
        r["fl_idx"] = round(math.exp(vals[len(vals) // 2] if len(vals) % 2 else (vals[len(vals) // 2 - 1] + vals[len(vals) // 2]) / 2), 3) if vals else ""
        k = bisect.bisect_right(wx_t, t0) - 1
        w = wx[k][1] if k >= 0 and t0 - wx[k][0] <= WX_MAX_AGE else None
        if w:
            r.update({"wx_age_s": int(t0 - wx[k][0]), "wx_tmpf": w.get("tmpf", ""), "wx_p01i": w.get("p01i", ""),
                      "wx_codes": w.get("wxcodes", ""), "wx_vsby": w.get("vsby", ""), "wx_sknt": w.get("sknt", ""),
                      "wx_snowdepth": w.get("snowdepth", "")})
            r["wx_precip"], r["wx_snow"], r["wx_heavy"] = wx_flags(w.get("p01i"), w.get("wxcodes"))
        g = grid.get(int(t0 // 3600 * 3600))
        if g:
            r.update({"gr_precip_mm": g.get("precipitation", ""), "gr_rain_mm": g.get("rain", ""), "gr_snow_cm": g.get("snowfall", ""),
                      "gr_snow_depth_m": g.get("snow_depth", ""), "gr_code": g.get("weather_code", ""), "gr_wind": g.get("wind_speed_10m", "")})
        lat, lon = _f(r.get("stop_lat")), _f(r.get("stop_lon"))
        reg = region_of(lat, lon) if lat is not None and lon is not None else ""
        r["tr_region"] = reg
        if reg and t0:
            t = chicago(t0)
            v = typ.get((reg, t.weekday(), t.hour))
            r["tr_typ_mph"] = round(v, 2) if v else ""
            r["cal_regime"] = regime_on(cal, t.strftime("%Y-%m-%d"))
        for c in CTX_COLS:
            r.setdefault(c, "")
        out[i] = r
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--arrivals", required=True)
    ap.add_argument("--context", default=str(ROOT / "data" / "context"), help="folder with weather_mdw.csv, weather_campus.csv, traffic_regions_hourly.csv")
    ap.add_argument("--calendar", default=str(ROOT / "data" / "calendar.json"))
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    arr = read_csv(a.arrivals)
    if not arr:
        print("no arrivals", file=sys.stderr)
        return 1
    ctx = Path(a.context)
    rows = join(arr, read_csv(ctx / "weather_mdw.csv"), read_csv(ctx / "weather_campus.csv"),
                read_csv(ctx / "traffic_regions_hourly.csv"), load_calendar(a.calendar))
    header = list(arr[0].keys()) + [c for c in CTX_COLS if c not in arr[0]]
    with open(a.out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=header, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    have = lambda c: sum(1 for r in rows if r.get(c) not in ("", None))
    print(f"{a.out}: {len(rows)} rows; with weather obs {have('wx_tmpf')}, campus grid {have('gr_precip_mm')}, "
          f"typical traffic {have('tr_typ_mph')}, fleet index {have('fl_idx')}, calendar {have('cal_regime')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
