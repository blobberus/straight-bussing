#!/usr/bin/env python3
"""Flagged lines: one registry of the lines (and their stops, hours, buses) whose data behaves oddly, so every agent that
models, shows or collects the data notices them and accounts for them (owner, 2026-11-11: "Create or indicate wherever
appropriate for another agent to analyze and notice and account for this data. Flag these lines").

Producers write one file each in data/labeled/flags/ (schema and rules: data/labeled/flags/README.md):
  transition_flags.csv  category transition       odd bus behavior at transition times (RouteKnower E30)
  prediction_flags.csv  category prediction_miss  lines with large prediction misses (RouteKnower E31)
  display_flags.csv     category display          what the shipped display rules showed riders (RouteKnower E32)
This tool validates them and merges them into data/labeled/flags/flagged_lines.csv (active flags first, then by
severity, route and flag) and docs/FLAGGED-LINES.md (a per-line summary in plain English, generated: never edit it by
hand). A flag keeps its first_flagged date across refreshes; a flag that a producer's refreshed file no longer reports
becomes `resolved` (last_checked = the day it was resolved) instead of disappearing. A producer file that is missing
altogether leaves its old flags as they were (not rechecked; a warning says so).

  python tools/flag_lines.py            validate, merge, write the registry and the summary
  python tools/flag_lines.py --check    validate only: exit 1 on a problem, or when the registry or the summary is
                                        out of date with the producer files (run the tool without --check to fix)
  python tools/flag_lines.py --check-inputs   validate the producer files only (what a producer runs before it
                                        commits its *_flags.csv; the registry is merged afterwards)
  options: --flags-dir DIR (producer files, default data/labeled/flags) --routes web/data/routes.json
           --prev CSV (previous registry, default <out>) --out CSV --md MD --today YYYY-MM-DD (default: Chicago today)
The data repo's weekly findings run (straight-bussing-data findings/run_findings.py) calls it with --flags-dir on a
fresh run of the producers' scripts and --prev / --out / --md in its own findings/ folder. Stdlib only.
"""
import argparse, csv, io, json, re, sys, time
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FLAGS_DIR = ROOT / "data" / "labeled" / "flags"
ROUTES = ROOT / "web" / "data" / "routes.json"
MD = ROOT / "docs" / "FLAGGED-LINES.md"
COMBINED = "flagged_lines.csv"

COLS = ["flag_id", "route_id", "route", "category", "flag", "severity", "scope", "metric", "value", "baseline", "n",
        "data_from", "data_to", "evidence", "agent_action", "first_flagged", "last_checked", "status"]
FILES = {"transition_flags.csv": "transition", "prediction_flags.csv": "prediction_miss", "display_flags.csv": "display"}
SEVERITY = ("high", "medium", "low")
STATUS = ("open", "watch", "resolved")
ACTIVE = ("open", "watch")
# Scope tokens a bench or an app agent can apply as a filter (key=value, values joined by |; README "scope").
SCOPE_KEYS = {
    "stops": "GTFS stop ids (web/data/stops.json)",
    "hours": "Chicago clock hours, start-end, end exclusive (15-19 = 3 to 7 PM; 23-01 wraps past midnight)",
    "days": "weekday, saturday, sunday, weekend, or mon..sun",
    "vehicles": "Passio bus numbers",
    "lead": "minutes ahead of the arrival, lo-hi (prediction flags)",
    "trips": "no_timetable (trips the timetable does not list) or timetable",
    "dates": "service days YYYY-MM-DD",
    "note": "free text for people (never a filter)",
}
DAYS = {"weekday", "weekend", "saturday", "sunday", "mon", "tue", "wed", "thu", "fri", "sat", "sun"}
TRIPS = {"no_timetable", "timetable"}
FLAG_RE = re.compile(r"^[a-z][a-z0-9_]*$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
RANGE_RE = re.compile(r"^(\d{1,2})-(\d{1,2})$")
LEAD_RE = re.compile(r"^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$")
NUM_RE = re.compile(r"^-?\d+(\.\d+)?([eE][-+]?\d+)?$")
ABS_PATH = re.compile(r"(^/|^[A-Za-z]:[\\/]|\\Users\\|/Users/|/home/)")


def today_chicago():
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from arrivals_lib import chicago
    return chicago(time.time()).date().isoformat()


def load_routes(path):
    """{route_id: (long name, short name)} from web/data/routes.json."""
    d = json.loads(Path(path).read_text(encoding="utf-8"))
    d = d.get("routes", d) if isinstance(d, dict) else {r["id"]: r for r in d}
    return {str(k): (v.get("long") or v.get("short") or str(k), v.get("short") or "") for k, v in d.items()}


def read_rows(path):
    """-> (header, [dict]) of a CSV (utf-8, a BOM is ignored)."""
    text = Path(path).read_text(encoding="utf-8-sig")
    r = list(csv.reader(io.StringIO(text)))
    r = [x for x in r if any(c.strip() for c in x)]
    if not r:
        return [], []
    hdr = r[0]
    return hdr, [dict(zip(hdr, x + [""] * (len(hdr) - len(x)))) | ({"__extra": x[len(hdr):]} if len(x) > len(hdr) else {})
                 for x in r[1:]]


def parse_scope(scope):
    """'hours=15-19;days=weekday;note=...' -> ({key: [values]}, [problems], [warnings]). Empty or 'all' = the whole
    line. Values are joined by |."""
    out, problems, warns = {}, [], []
    s = (scope or "").strip()
    if s.lower() in ("", "all"):
        return out, problems, warns
    for tok in (t.strip() for t in s.split(";")):
        if not tok:
            continue
        if "=" not in tok:
            warns.append(f"scope part '{tok}' is not key=value: kept as text, no bench or app can filter on it")
            out.setdefault("note", []).append(tok)
            continue
        k, v = (x.strip() for x in tok.split("=", 1))
        k = k.lower()
        vals = [x.strip() for x in v.split("|") if x.strip()]
        if k not in SCOPE_KEYS:
            warns.append(f"scope key '{k}' is not one the bench applies ({', '.join(SCOPE_KEYS)}): kept as text")
            out.setdefault("note", []).append(tok)
            continue
        if not vals:
            problems.append(f"scope '{k}=' has no value")
            continue
        for x in vals:
            if k == "hours":
                m = RANGE_RE.match(x)
                if not m or not (0 <= int(m.group(1)) <= 23 and 1 <= int(m.group(2)) <= 24) or int(m.group(1)) == int(m.group(2)):
                    problems.append(f"scope hours '{x}' is not start-end in 0..24 (e.g. 15-19)")
            elif k == "lead":
                m = LEAD_RE.match(x)
                if not m or float(m.group(1)) >= float(m.group(2)):
                    problems.append(f"scope lead '{x}' is not lo-hi minutes (e.g. 10-30)")
            elif k == "days" and x.lower() not in DAYS:
                problems.append(f"scope days '{x}' is not one of {', '.join(sorted(DAYS))}")
            elif k == "trips" and x.lower() not in TRIPS:
                problems.append(f"scope trips '{x}' is not one of {', '.join(sorted(TRIPS))}")
            elif k == "dates" and not valid_date(x):
                problems.append(f"scope dates '{x}' is not YYYY-MM-DD")
            elif k == "vehicles" and not re.fullmatch(r"[A-Za-z0-9_-]+", x):
                problems.append(f"scope vehicles '{x}' is not a bus number")
        out.setdefault(k, []).extend(vals if k != "days" and k != "trips" else [x.lower() for x in vals])
    return out, problems, warns


def valid_date(s):
    if not DATE_RE.match(s or ""):
        return False
    try:
        date.fromisoformat(s)
        return True
    except ValueError:
        return False


def validate_row(r, routes, category=None, stops=None, registry=False):
    """-> (problems, warnings) for one row (a dict of COLS). category: the file's category (None = any)."""
    p, w = [], []
    if r.get("__extra"):
        p.append(f"{len(r['__extra'])} cell(s) beyond the header")
    rid = (r.get("route_id") or "").strip()
    if rid not in routes:
        (w if registry else p).append(f"route_id '{rid}' is not in web/data/routes.json (GTFS route ids only)")
    elif r.get("route", "").strip().lower() not in {x.lower() for x in routes[rid] if x}:
        w.append(f"route '{r.get('route')}' is not the name of route {rid} ('{routes[rid][0]}'): the registry uses that")
    cat = r.get("category", "")
    if cat not in FILES.values():
        p.append(f"category '{cat}' is not one of {', '.join(FILES.values())}")
    elif category and cat != category:
        p.append(f"category '{cat}' in the {category} file")
    if not FLAG_RE.match(r.get("flag", "")):
        p.append(f"flag '{r.get('flag')}' is not snake_case")
    if r.get("flag_id") != f"{cat}:{r.get('flag')}:{rid}":
        p.append(f"flag_id '{r.get('flag_id')}' is not category:flag:route_id ('{cat}:{r.get('flag')}:{rid}')")
    if r.get("severity") not in SEVERITY:
        p.append(f"severity '{r.get('severity')}' is not one of {', '.join(SEVERITY)}")
    if r.get("status") not in STATUS:
        p.append(f"status '{r.get('status')}' is not one of {', '.join(STATUS)}")
    for c in ("value", "baseline"):
        v = (r.get(c) or "").strip()
        if c == "baseline" and not v:
            continue
        if not NUM_RE.match(v):
            p.append(f"{c} '{v}' is not a number (dot decimals, no % or commas)")
    if not re.fullmatch(r"\d+", (r.get("n") or "").strip()):
        p.append(f"n '{r.get('n')}' is not a whole number")
    for c in ("data_from", "data_to", "first_flagged", "last_checked"):
        if not valid_date(r.get(c, "")):
            p.append(f"{c} '{r.get(c)}' is not a date YYYY-MM-DD")
    if all(valid_date(r.get(c, "")) for c in ("data_from", "data_to", "first_flagged", "last_checked")):
        if r["data_from"] > r["data_to"]:
            p.append(f"data_from {r['data_from']} is after data_to {r['data_to']}")
        if r["first_flagged"] > r["last_checked"]:
            p.append(f"first_flagged {r['first_flagged']} is after last_checked {r['last_checked']}")
        if r["data_to"] > r["last_checked"]:
            p.append(f"data_to {r['data_to']} is after last_checked {r['last_checked']}")
    for c in ("metric", "evidence", "agent_action"):
        if not (r.get(c) or "").strip():
            p.append(f"{c} is empty")
    if ABS_PATH.search(r.get("evidence", "")):
        p.append("evidence has an absolute path: use repo-relative paths (never a PC's folder names)")
    sc, sp, sw = parse_scope(r.get("scope", ""))
    p += sp
    w += sw
    if stops is not None:
        bad = [s for s in sc.get("stops", []) if s not in stops]
        if bad:
            w.append(f"scope stops not in web/data/stops.json: {', '.join(bad)}")
    return p, w


def read_producers(flags_dir, routes, stops=None):
    """-> (rows, categories read, problems, warnings). Every *_flags.csv in flags_dir; unknown ones are a problem."""
    rows, cats, problems, warns = [], set(), [], []
    seen = {}
    for path in sorted(Path(flags_dir).glob("*_flags.csv")):
        cat = FILES.get(path.name)
        if cat is None:
            problems.append(f"{path.name}: not a known producer file ({', '.join(FILES)}); add it to FILES in tools/flag_lines.py")
            continue
        hdr, body = read_rows(path)
        if hdr != COLS:
            problems.append(f"{path.name}: header must be exactly: {','.join(COLS)}")
            continue
        cats.add(cat)
        for i, r in enumerate(body, 2):
            p, w = validate_row(r, routes, cat, stops)
            problems += [f"{path.name} line {i}: {x}" for x in p]
            warns += [f"{path.name} line {i}: {x}" for x in w]
            fid = r.get("flag_id")
            if fid in seen:
                problems.append(f"{path.name} line {i}: flag_id {fid} repeats ({seen[fid]})")
                continue
            seen[fid] = f"{path.name} line {i}"
            if not p:
                rows.append(clean(r, routes))
    return rows, cats, problems, warns


def clean(r, routes):
    out = {c: " ".join((r.get(c) or "").split()) for c in COLS}
    if out["route_id"] in routes:
        out["route"] = routes[out["route_id"]][0]
    return out


def sort_key(r):
    sev = SEVERITY.index(r["severity"]) if r["severity"] in SEVERITY else len(SEVERITY)
    return (r["status"] == "resolved", sev, r["route"].lower(), r["flag"], r["route_id"], r["category"])


def merge(prev, rows, cats, today):
    """prev: the previous registry's rows; rows: this refresh's producer rows; cats: categories whose file was read.
    -> (merged rows sorted, [warnings])."""
    old = {r["flag_id"]: r for r in prev}
    out, warns = {}, []
    for r in rows:
        r = dict(r)
        p = old.get(r["flag_id"])
        if p and valid_date(p.get("first_flagged", "")) and p["first_flagged"] < r["first_flagged"]:
            r["first_flagged"] = p["first_flagged"]
        out[r["flag_id"]] = r
    for fid, p in old.items():
        if fid in out:
            continue
        p = {c: p.get(c, "") for c in COLS}
        if p["category"] not in cats:
            if p["status"] != "resolved":
                warns.append(f"{fid}: not rechecked (no {p['category']} producer file this run); kept as {p['status']}")
        elif p["status"] != "resolved":
            p["status"], p["last_checked"] = "resolved", today
        out[fid] = p
    return sorted(out.values(), key=sort_key), warns


def csv_text(rows):
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(COLS)
    for r in rows:
        w.writerow([r.get(c, "") for c in COLS])
    return buf.getvalue()


def pretty_scope(scope, stop_names=None):
    """'stops=20132;hours=15-19' -> 'stops 20132 (53 & Kimbark (EB)); hours 15-19' for people."""
    sc, _, _ = parse_scope(scope)
    if not sc:
        return "the whole line"
    names = {"stops": "stops", "hours": "Chicago time", "days": "days", "vehicles": "buses", "lead": "minutes ahead",
             "trips": "trips", "dates": "service days", "note": ""}
    parts = []
    for k, v in sc.items():
        if k == "stops" and stop_names:
            v = [f"{x} ({stop_names[x]})" if stop_names.get(x) else x for x in v]
        elif k == "hours":
            v = [f"{int(x.split('-')[0]):02d}:00-{int(x.split('-')[1]) % 24:02d}:00" if RANGE_RE.match(x) else x for x in v]
        parts.append((names[k] + " " if names[k] else "") + ", ".join(v))
    return "; ".join(parts)


def md_text(rows, stop_names=None):
    """docs/FLAGGED-LINES.md from the merged rows only (so --check can rebuild it exactly)."""
    stop_names = stop_names or {}
    active = [r for r in rows if r["status"] in ACTIVE]
    resolved = [r for r in rows if r["status"] == "resolved"]
    newest = max((r["last_checked"] for r in rows), default="(none)")
    L = ["# Flagged lines", "",
         "<!-- Generated by tools/flag_lines.py from data/labeled/flags/*_flags.csv. Do not edit by hand: fix the "
         "producer's flags and rerun the tool. -->", "",
         f"**Generated** by `tools/flag_lines.py` from the producer files in `data/labeled/flags/` (newest check "
         f"{newest}); do not edit by hand. The same rows, machine-readable: `data/labeled/flags/flagged_lines.csv`. "
         "What a flag is, the columns, the severity rules and **what every agent must do** about a flag: "
         "`data/labeled/flags/README.md`.", "",
         "In short: a prediction or ETA agent scores every flagged line (and its flagged stops, hours and buses) as its "
         "own slice and does not ship a model that loses on one (RouteKnower.md 6.4); an app agent reads the flags before "
         "changing a display rule and never hides a bus or a time on a flag alone without the owner's decision; a data "
         "agent rechecks the flags at every checkup.", "",
         "Unofficial analysis of the public Passio feed; not a statement by the operator or the University. Official "
         "service information: 773.702.8181.", ""]
    if not rows:
        L += ["No flags yet: the producers (RouteKnower E30, E31, E32) have not written their files.", ""]
        return "\n".join(L) + "\n"
    sev = {s: sum(r["severity"] == s for r in active) for s in SEVERITY}
    lines = sorted({(r["route"], r["route_id"]) for r in active}, key=lambda x: (min(
        SEVERITY.index(r["severity"]) for r in active if r["route_id"] == x[1]), -sum(r["route_id"] == x[1] for r in active), x[0].lower()))
    L += [f"**{len(active)} active flags on {len(lines)} lines** ({sev['high']} high, {sev['medium']} medium, "
          f"{sev['low']} low; {sum(r['status'] == 'watch' for r in active)} of them on watch), {len(resolved)} resolved.", ""]
    if lines:
        L += ["| Line | Route id | High | Medium | Low | Categories | Flags |", "|---|---|---:|---:|---:|---|---|"]
        for name, rid in lines:
            mine = [r for r in active if r["route_id"] == rid]
            cats = ", ".join(sorted({r["category"] for r in mine}))
            L.append(f"| {name} | {rid} | " + " | ".join(str(sum(r["severity"] == s for r in mine)) for s in SEVERITY) +
                     f" | {cats} | " + ", ".join(f"`{r['flag']}`" for r in mine) + " |")
        L.append("")
    for name, rid in lines:
        L += [f"## {name} (route id {rid})", ""]
        for r in (x for x in active if x["route_id"] == rid):
            L.append(flag_md(r, stop_names))
        L.append("")
    if resolved:
        L += ["## Resolved (no longer reported by a refresh; kept so a returning problem keeps its history)", ""]
        for r in resolved:
            L.append(flag_md(r, stop_names))
        L.append("")
    return "\n".join(L) + "\n"


def flag_md(r, stop_names):
    base = f" (all lines {r['baseline']})" if r["baseline"] else ""
    scope = pretty_scope(r["scope"], stop_names)
    since = f"flagged {r['first_flagged']}, checked {r['last_checked']}"
    return (f"- **{r['severity'].capitalize()} · {r['category']} · `{r['flag']}`** ({r['status']}; {since}). "
            f"{r['metric'][:1].upper()}{r['metric'][1:]}: **{r['value']}**{base}, n = {r['n']}, service days {r['data_from']} to {r['data_to']}. "
            f"Where and when: {scope}. **Agents:** {r['agent_action']} Evidence: {r['evidence']}.")


def stop_names_for(rows, stops):
    ids = set()
    for r in rows:
        ids.update(parse_scope(r["scope"])[0].get("stops", []))
    return {s: stops[s] for s in sorted(ids) if s in stops}


def load_stops(path):
    try:
        d = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return {str(k): (v.get("name", "") if isinstance(v, dict) else "") for k, v in d.items()}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--check", action="store_true", help="validate only (exit 1 on a problem or an out-of-date registry)")
    ap.add_argument("--check-inputs", action="store_true", help="validate the producer files only (exit 1 on a problem)")
    ap.add_argument("--flags-dir", default=str(FLAGS_DIR))
    ap.add_argument("--routes", default=str(ROUTES))
    ap.add_argument("--stops", default=str(ROUTES.parent / "stops.json"))
    ap.add_argument("--out", default=None, help=f"registry CSV (default <flags-dir>/{COMBINED})")
    ap.add_argument("--prev", default=None, help="previous registry (default: --out)")
    ap.add_argument("--md", default=str(MD))
    ap.add_argument("--today", default=None)
    a = ap.parse_args(argv)
    out = Path(a.out or Path(a.flags_dir) / COMBINED)
    prev_path = Path(a.prev) if a.prev else out
    today = a.today or today_chicago()
    if not valid_date(today):
        sys.exit(f"--today {today} is not YYYY-MM-DD")
    routes, stops = load_routes(a.routes), load_stops(a.stops)
    rows, cats, problems, warns = read_producers(a.flags_dir, routes, stops)
    prev = []
    if prev_path.exists():
        hdr, prev = read_rows(prev_path)
        if hdr != COLS:
            problems.append(f"{prev_path.name}: header must be exactly: {','.join(COLS)}")
            prev = []
        for i, r in enumerate(prev, 2):
            p, w = validate_row(r, routes, None, None, registry=True)
            problems += [f"{prev_path.name} line {i}: {x}" for x in p]
    merged, mw = merge(prev, rows, cats, today)
    warns += mw
    md = md_text(merged, stop_names_for(merged, stops or {}))
    for x in warns:
        print("warning:", x, file=sys.stderr)
    if a.check_inputs:
        for x in problems:
            print("problem:", x, file=sys.stderr)
        print(f"flag_lines --check-inputs: {len(rows)} valid producer flags from {len(cats)} file(s), "
              f"{len(problems)} problem(s), {len(warns)} warning(s)")
        return 1 if problems else 0
    if a.check:
        if not problems:
            if prev_path.exists() and csv_text(merge(prev, rows, cats, "9999-12-31")[0]) != csv_text(
                    sorted([{c: r.get(c, "") for c in COLS} for r in prev], key=sort_key)):
                problems.append(f"{out} is out of date with the producer files: run python tools/flag_lines.py")
            elif not prev_path.exists() and rows:
                problems.append(f"{out} is missing: run python tools/flag_lines.py")
            md_path = Path(a.md)
            want = md_text(sorted([{c: r.get(c, "") for c in COLS} for r in prev], key=sort_key),
                           stop_names_for(prev, stops or {})) if prev_path.exists() else None
            if want is not None and (not md_path.exists() or md_path.read_text(encoding="utf-8").replace("\r\n", "\n") != want):
                problems.append(f"{md_path.name} is out of date with {out.name}: run python tools/flag_lines.py")
        for x in problems:
            print("problem:", x, file=sys.stderr)
        n_act = sum(r["status"] in ACTIVE for r in merged)
        print(f"flag_lines --check: {len(rows)} producer flags from {len(cats)} file(s), {n_act} active in the registry, "
              f"{len(problems)} problem(s), {len(warns)} warning(s)")
        return 1 if problems else 0
    if problems:
        for x in problems:
            print("problem:", x, file=sys.stderr)
        print(f"flag_lines: {len(problems)} problem(s); nothing written")
        return 1
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", encoding="utf-8", newline="") as f:
        f.write(csv_text(merged))
    Path(a.md).parent.mkdir(parents=True, exist_ok=True)
    with open(a.md, "w", encoding="utf-8", newline="") as f:
        f.write(md)
    n_act = sum(r["status"] in ACTIVE for r in merged)
    print(f"flag_lines: {len(rows)} producer flags from {len(cats)} file(s) -> {out} ({len(merged)} rows, {n_act} active, "
          f"{len(merged) - n_act} resolved) and {a.md}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
