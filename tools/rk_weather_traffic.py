#!/usr/bin/env python3
"""RouteKnower E15: how much do rain and snow slow arterial traffic around the shuttle network, and how
many wet / snowy service days can we expect to collect before shipping? Stdlib only.

  python tools/rk_weather_traffic.py --traffic data/context/traffic_regions_hourly.csv \
      --weather data/context/weather_mdw.csv --out experiments/routeknower/E15-weather-traffic-prior.md

Data: City of Chicago Traffic Tracker hourly region speeds (CTA-bus-GPS estimates; 2022-01 .. 2026-04-30,
pandemic years skipped) joined hour-by-hour with Chicago Midway (MDW) routine METARs (the :53 report of
local hour H covers roughly that hour). Relative speed = speed / median speed of DRY hours in the same
region x weekday x hour x season (Nov-Mar = winter). Intervals: 95% bootstrap over whole days (days are the
unit of noise; resampling single hours would overstate certainty).
"""
import argparse, csv, random, statistics as st, sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

PRECIP = ("RA", "SN", "DZ", "PL", "GR", "GS", "SG", "UP", "TS", "SH")
SINCE = "2022-01-01"
REGION_NAMES = {"21": "Hyde Park-Kenwood-Woodlawn", "13": "Chicago Loop", "20": "Fuller-Grand Blvd-Washington Park", "29": "Downtown Lakefront"}


def fnum(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def weather_class(p01i, codes):
    c = (codes or "").upper()
    p = fnum(p01i)
    if "SN" in c or "SG" in c or "PL" in c:
        return "snow"
    if (p is not None and p >= 0.10) or "+RA" in c or "TS" in c:
        return "heavy rain"
    if (p is not None and p >= 0.01) or any(k in c for k in PRECIP):
        return "light rain"
    if p is None and not c:
        return None            # unknown: skip
    return "dry"


def daypart(h):
    return "am peak 7-9" if 7 <= h <= 9 else "pm peak 16-18" if 16 <= h <= 18 else "midday 10-15" if 10 <= h <= 15 else "evening/night"


def load_weather(path):
    """{local 'YYYY-MM-DD HH': (class, p01i, codes, snowdepth)} from routine obs."""
    out = {}
    with open(path, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            k = (r.get("local_time") or "")[:13]
            wc = weather_class(r.get("p01i"), r.get("wxcodes"))
            if k and wc:
                out[k] = (wc, fnum(r.get("p01i")), r.get("wxcodes") or "", fnum(r.get("snowdepth")))
    return out


def boot_ci(day_vals, n=1000, seed=7):
    """95% bootstrap CI of the mean over days; day_vals = {day: [values]}."""
    days = list(day_vals)
    if len(days) < 5:
        return None
    rnd = random.Random(seed)
    means = []
    for _ in range(n):
        pick = [day_vals[rnd.choice(days)] for _ in days]
        flat = [v for vs in pick for v in vs]
        means.append(sum(flat) / len(flat))
    means.sort()
    return means[int(0.025 * n)], means[int(0.975 * n)]


def analyse(traffic_path, weather_path, regions=("21", "13")):
    wx = load_weather(weather_path)
    rows = []
    with open(traffic_path, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            lt = r.get("local_time") or ""
            if lt < SINCE or r.get("region_id") not in regions:
                continue
            v = fnum(r.get("speed_mph"))
            w = wx.get(lt[:13])
            if v is None or v <= 0 or not w:
                continue
            t = datetime.strptime(lt[:19], "%Y-%m-%d %H:%M:%S")
            season = "winter" if t.month in (11, 12, 1, 2, 3) else "warm"
            rows.append({"region": r["region_id"], "day": lt[:10], "dow": t.weekday(), "hour": t.hour, "season": season, "v": v, "wc": w[0]})
    base = defaultdict(list)
    for r in rows:
        if r["wc"] == "dry":
            base[(r["region"], r["dow"], r["hour"], r["season"])].append(r["v"])
    base = {k: st.median(v) for k, v in base.items() if len(v) >= 8}
    for r in rows:
        b = base.get((r["region"], r["dow"], r["hour"], r["season"]))
        r["rel"] = r["v"] / b if b else None
    return [r for r in rows if r["rel"] is not None]


def table(rows, key):
    """Markdown rows: group -> weather class -> mean relative speed with day-bootstrap CI."""
    groups = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
    for r in rows:
        groups[key(r)][r["wc"]][r["day"]].append(r["rel"])
    out = []
    for g in sorted(groups):
        for wc in ("dry", "light rain", "heavy rain", "snow"):
            dv = groups[g].get(wc)
            if not dv:
                continue
            flat = [v for vs in dv.values() for v in vs]
            ci = boot_ci(dv)
            mean = sum(flat) / len(flat)
            out.append(f"| {g} | {wc} | {100 * (mean - 1):+.1f}% | {'%+.1f%% to %+.1f%%' % (100 * (ci[0] - 1), 100 * (ci[1] - 1)) if ci else 'too few days'} | {len(flat)} | {len(dv)} |")
    return out


def expected_days(weather_path, start_md="10-08", end_md="11-30", years=range(2018, 2026), service=(7, 23)):
    """Per year: service days (7:00-22:59) in [start_md, end_md] with measurable precip / snow at MDW."""
    days = defaultdict(lambda: {"precip": False, "snow": False, "hours": 0})
    with open(weather_path, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            lt = r.get("local_time") or ""
            if len(lt) < 13 or not (service[0] <= int(lt[11:13]) < service[1]):
                continue
            y, md = int(lt[:4]), lt[5:10]
            if y not in years or not (start_md <= md <= end_md):
                continue
            wc = weather_class(r.get("p01i"), r.get("wxcodes"))
            d = days[lt[:10]]
            d["hours"] += 1
            d["precip"] |= wc in ("light rain", "heavy rain", "snow")
            d["snow"] |= wc == "snow"
    per_year = defaultdict(lambda: [0, 0, 0])
    for day, d in days.items():
        if d["hours"] < 12:
            continue
        py = per_year[int(day[:4])]
        py[0] += 1
        py[1] += d["precip"]
        py[2] += d["snow"]
    return dict(sorted(per_year.items()))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--traffic", required=True)
    ap.add_argument("--weather", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    rows = analyse(a.traffic, a.weather)
    if not rows:
        print("no joined rows", file=sys.stderr)
        return 1
    reg = lambda r: REGION_NAMES[r["region"]]
    md = ["| group | weather (MDW hour) | mean speed vs dry baseline | 95% CI (days bootstrap) | hours | days |", "|---|---|---:|---|---:|---:|"]
    lines = ["## By region"] + md + table(rows, reg)
    lines += ["", "## Hyde Park-Kenwood-Woodlawn by daypart"] + md + table([r for r in rows if r["region"] == "21"], lambda r: daypart(r["hour"]))
    lines += ["", "## Hyde Park-Kenwood-Woodlawn by season"] + md + table([r for r in rows if r["region"] == "21"], lambda r: r["season"])
    ex = expected_days(a.weather)
    lines += ["", "## Expected wet / snowy service days, Oct 8 - Nov 30 (MDW, 7 AM - 11 PM, days with >= 12 hourly reports)",
              "| year | service days | days with measurable precip | days with snow reported |", "|---|---:|---:|---:|"]
    lines += [f"| {y} | {v[0]} | {v[1]} | {v[2]} |" for y, v in ex.items()]
    if ex:
        n = len(ex)
        lines += [f"| mean | {sum(v[0] for v in ex.values()) / n:.1f} | {sum(v[1] for v in ex.values()) / n:.1f} | {sum(v[2] for v in ex.values()) / n:.1f} |"]
    span = (min(r["day"] for r in rows), max(r["day"] for r in rows))
    head = [f"Joined hours: {len(rows)} ({span[0]} to {span[1]}), regions: {', '.join(sorted({reg(r) for r in rows}))}.", ""]
    body = "\n".join(head + lines) + "\n"
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    marker = "<!-- E15:RESULTS -->"
    p = Path(a.out)
    if p.exists() and marker in p.read_text(encoding="utf-8"):
        pre = p.read_text(encoding="utf-8").split(marker)[0]
        p.write_text(pre + marker + "\n" + body, encoding="utf-8")
    else:
        p.write_text(marker + "\n" + body, encoding="utf-8")
    print(body)
    return 0


if __name__ == "__main__":
    sys.exit(main())
