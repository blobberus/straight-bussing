#!/usr/bin/env python3
"""Summarize the website's anonymous usage statistics (web/js/data/usage.js, receiver tools/usage/Code.gs).

Download the three tabs of the Google Sheet as CSV (File > Download > Comma separated values, once per tab) into one
folder as starts.csv, ends.csv and places.csv (ends / places may be missing), then:

  python tools/usage_report.py --dir <folder> [--since YYYY-MM-DD] [--out report.md]

It answers the owner's three questions (2026-10-27): when distinct visitors open the site (time of day, weekday,
per day), how long they use it, and where they use it from (only riders who turned on "Include my nearest stop").
The data holds no identity: a visitor is a random number made in one browser (the installed home-screen app and a
Safari tab on the same phone count as two). Stdlib only. Tests: tools/test_usage_report.py.
"""
import argparse, csv, statistics, sys
from collections import Counter, defaultdict
from pathlib import Path

DAYS = ("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")
LENGTH_BINS = ((60, "under 1 min"), (180, "1 to 3 min"), (600, "3 to 10 min"), (1800, "10 to 30 min"), (10 ** 9, "30 min or more"))


# receiver version 2 headers (readable) -> the version 1 names used below; values normalized too
V2 = {"Visitor (anonymous number)": "anon_id", "Visit": "session_id", "Day": "day", "Weekday": "weekday",
      "Start time": "start_time", "App": "app", "Version": "version", "New visitor": "new_user",
      "Length (seconds)": "duration_s", "Nearest stop": "zone", "Received (Chicago time)": "received"}


def normalize(r):
    out = {V2.get(k, k): (v or "").strip() for k, v in r.items() if k}
    if out.get("weekday") in DAYS:
        out["weekday"] = str(DAYS.index(out["weekday"]))
    if out.get("new_user") in ("Yes", "No"):
        out["new_user"] = "1" if out["new_user"] == "Yes" else "0"
    if out.get("day"):
        out["day"] = out["day"][:10]
    if out.get("start_time"):
        out["start_time"] = out["start_time"].zfill(5)[:5] if ":" in out["start_time"] else out["start_time"]
    return out


def is_test(r):
    return set(r.get("anon_id", "")) <= {"0"} or r.get("version") in ("receivercheck", "selftest")


def read(path):
    p = Path(path)
    if not p.exists():
        return []
    with open(p, encoding="utf-8-sig", newline="") as f:
        return [normalize(r) for r in csv.DictReader(f)]


def pct(a, b):
    return f"{100 * a / b:.0f}%" if b else ""


def logins(S, gap_s=1800):
    """Logins with reloads folded in, as the Sheet's "logins (30 min)" tab: per visitor in time order, a visit counts
    again only gap_s or more after that visitor's previous logged login (times from day + start time, Chicago)."""
    from datetime import datetime
    by = defaultdict(list)
    for r in S:
        try:
            by[r["anon_id"]].append(datetime.strptime(f"{r['day']} {r['start_time'][:5]}", "%Y-%m-%d %H:%M"))
        except (KeyError, ValueError):
            pass
    n = 0
    for times in by.values():
        last = None
        for t in sorted(times):
            if last is None or (t - last).total_seconds() >= gap_s:
                n += 1
                last = t
    return n


def summarize(starts, ends, places, since=None):
    """-> markdown text."""
    S = [r for r in starts if r.get("session_id") and r.get("anon_id") and not is_test(r) and (not since or r.get("day", "") >= since)]
    sids = {r["session_id"] for r in S}
    dur = {}
    for r in ends:
        sid = r.get("session_id")
        if sid in sids:
            try:
                dur[sid] = max(dur.get(sid, 0), int(float(r.get("duration_s") or 0)))
            except ValueError:
                pass
    zone = {}
    for r in places:
        if r.get("session_id") in sids and r.get("zone"):
            zone[r["session_id"]] = r["zone"].lstrip("'")
    out = ["# Straight Bussing website: anonymous usage", ""]
    if not S:
        return "\n".join(out + ["No visits in the data."])
    visitors = {r["anon_id"] for r in S}
    days = sorted({r["day"] for r in S})
    by_visitor = Counter(r["anon_id"] for r in S)
    out += [f"{days[0]} to {days[-1]}: **{len(visitors):,} distinct visitors**, {logins(S):,} logins (a visitor counts "
            f"again only after 30 minutes), {len(S):,} visits "
            f"({len(S) / len(visitors):.1f} per visitor); {sum(1 for v in by_visitor.values() if v >= 2):,} visitors came back "
            f"at least once; {pct(sum(1 for r in S if r.get('app') == 'home-screen'), len(S))} of visits from the installed "
            f"home-screen app.", "",
            "A visitor is a random number made in one browser, never a person's identity.", ""]

    out += ["## When people open it", "", "### Per day", "", "| day | weekday | distinct visitors | visits | new visitors |",
            "|---|---|---:|---:|---:|"]
    per_day = defaultdict(list)
    for r in S:
        per_day[r["day"]].append(r)
    for d in days:
        rs = per_day[d]
        wd = DAYS[int(rs[0]["weekday"])] if str(rs[0].get("weekday", "")).isdigit() else ""
        out.append(f"| {d} | {wd} | {len({r['anon_id'] for r in rs}):,} | {len(rs):,} | {sum(1 for r in rs if str(r.get('new_user')) == '1'):,} |")
    out += ["", "### By hour of the day (Chicago time the visit started)", "", "| hour | visits | share | distinct visitors |",
            "|---|---:|---:|---:|"]
    by_hour = defaultdict(list)
    for r in S:
        try:
            by_hour[int(str(r["start_time"])[:2])].append(r)
        except (ValueError, KeyError):
            pass
    for h in range(24):
        rs = by_hour.get(h, [])
        if rs:
            label = f"{(h % 12) or 12} {'AM' if h < 12 else 'PM'}"
            out.append(f"| {label} | {len(rs):,} | {pct(len(rs), len(S))} | {len({r['anon_id'] for r in rs}):,} |")
    out += ["", "### By weekday", "", "| weekday | visits | distinct visitors |", "|---|---:|---:|"]
    by_wd = defaultdict(list)
    for r in S:
        if str(r.get("weekday", "")).isdigit():
            by_wd[int(r["weekday"])].append(r)
    for w in range(7):
        if by_wd.get(w):
            out.append(f"| {DAYS[w]} | {len(by_wd[w]):,} | {len({r['anon_id'] for r in by_wd[w]}):,} |")

    out += ["", "## How long they use it", ""]
    lens = sorted(dur.values())
    if lens:
        q = lambda p: lens[min(len(lens) - 1, int(p * len(lens)))]
        out += [f"{len(lens):,} of {len(S):,} visits have a length ({pct(len(lens), len(S))}; the rest turned it off or "
                f"closed before the page went to the background). Median **{statistics.median(lens) / 60:.1f} min**, "
                f"mean {statistics.fmean(lens) / 60:.1f} min, 75th percentile {q(.75) / 60:.1f} min, "
                f"90th {q(.9) / 60:.1f} min.", "", "| length | visits | share |", "|---|---:|---:|"]
        lo = 0
        for hi, label in LENGTH_BINS:
            n = sum(1 for x in lens if lo <= x < hi)
            out.append(f"| {label} | {n:,} | {pct(n, len(lens))} |")
            lo = hi
        per_v = defaultdict(int)
        for r in S:
            per_v[r["anon_id"]] += dur.get(r["session_id"], 0)
        tot = sorted(per_v.values())
        out += ["", f"Per visitor over the whole period: median {statistics.median(tot) / 60:.1f} min in total."]
    else:
        out.append("No visit lengths yet.")

    out += ["", "## Where they use it from (only visitors who turned on Include my nearest stop)", ""]
    if zone:
        zc = Counter(zone.values())
        out += [f"{len(zone):,} visits with a place ({pct(len(zone), len(S))} of visits).", "",
                "| place (nearest stop) | visits | share |", "|---|---:|---:|"]
        for z, n in zc.most_common(15):
            out.append(f"| {z} | {n:,} | {pct(n, len(zone))} |")
        sid_v = {r["session_id"]: r["anon_id"] for r in S}
        fav = Counter()
        per = defaultdict(Counter)
        for sid, z in zone.items():
            per[sid_v[sid]][z] += 1
        for v, c in per.items():
            fav[c.most_common(1)[0][0]] += 1
        out += ["", "Each visitor's most frequent place:", "", "| place | visitors |", "|---|---:|"]
        for z, n in fav.most_common(15):
            out.append(f"| {z} | {n:,} |")
    else:
        out.append("No places yet.")
    return "\n".join(out) + "\n"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--dir", required=True, help="folder with starts.csv, ends.csv, places.csv")
    ap.add_argument("--since", help="first day to include (YYYY-MM-DD)")
    ap.add_argument("--out", help="write the report here instead of printing it")
    a = ap.parse_args(argv)
    d = Path(a.dir)
    text = summarize(read(d / "starts.csv"), read(d / "ends.csv"), read(d / "places.csv"), a.since)
    if a.out:
        Path(a.out).write_text(text, encoding="utf-8")
    else:
        sys.stdout.write(text)


if __name__ == "__main__":
    main()
