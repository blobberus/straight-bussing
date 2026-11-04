#!/usr/bin/env python3
"""E27: real bus reports for the off-route tests (web/tests/core-offroute.js and the iOS Kit OffRouteTests share the
file). Writes the inputs of web/tests/fixtures/offroute_golden.json: the Nov 1 2026 timetable's route lines, listed
hours and alias ids, and four cases cut from the archived raw polls (every 3rd poll, about every 30 s):
  dc022     Nov 1 23:50 to Nov 2 00:40: North 4313, Central 4325, East 4327 drive to the garage after service (DC-022)
  dcc       Oct 22 16:00 to 17:00: every Downtown Campus Connector bus on the detour off Lake Shore Drive (riders on board)
  apostolic Oct 27 07:55 to 08:40: Apostolic 4328 on its 8 AM run to the 57th Street Metra station (another line)
  garage    Nov 3 13:00 to 13:50: Apostolic/Drexel 4324 parked at the operator's garage inside its listed hours
The expected answers come from web/js/core/offroute.js itself: --expect runs web/tests/offroute-golden.html in headless
Edge (tools/run_browser_tests.py's server) and stores its answers in the file. Copy the result to
ios/StraightBussingKit/Tests/StraightBussingKitTests/Fixtures/offroute_golden.json.

  python experiments/routeknower/E27-scripts/make_golden.py --dl <raw-polls + gtfs dir> --out web/tests/fixtures/offroute_golden.json
  python experiments/routeknower/E27-scripts/make_golden.py --expect web/tests/fixtures/offroute_golden.json
"""
import argparse, gzip, json, sys, tempfile
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import offroute as O   # noqa: E402

CASES = [
    ("dc022", "2026-11-01", (2026, 11, 1, 23, 50), 50, {"4313", "4325", "4327"}),
    ("dcc", "2026-10-22", (2026, 10, 22, 16, 0), 60, None, "5704"),
    ("apostolic", "2026-10-27", (2026, 10, 27, 7, 55), 45, {"4328"}),
    ("garage", "2026-11-03", (2026, 11, 3, 13, 0), 50, {"4324"}),
]


def expect(path):
    """Run web/tests/offroute-golden.html in headless Edge and store its answers (expect per case) in the file."""
    import html, re, shutil, subprocess
    sys.path.insert(0, str(O.REPO / "tools"))
    import run_browser_tests as T
    edge = T.find_edge()
    srv, port = T.start_server()
    prof = tempfile.mkdtemp(prefix="sb-edge-")
    try:
        cmd = [edge, "--headless=new", "--disable-gpu", "--no-first-run", "--virtual-time-budget=30000",
               f"--user-data-dir={prof}", "--dump-dom", f"http://127.0.0.1:{port}/tests/offroute-golden.html"]
        dom = subprocess.run(cmd, capture_output=True, timeout=120).stdout.decode("utf-8", "replace")
    finally:
        srv.shutdown()
        shutil.rmtree(prof, ignore_errors=True)
    m = re.search(r'<pre[^>]*id="result"[^>]*>(.*?)</pre>', dom, re.S)
    got = json.loads(html.unescape(m.group(1)))
    fx = json.loads(Path(path).read_text(encoding="utf-8"))
    for c in fx["cases"]:
        c["expect"] = got[c["name"]]["expect"]
        hid = sorted({v for step in c["expect"] for v in step})
        print(c["name"], "hidden at some poll:", hid, file=sys.stderr)
    Path(path).write_text(json.dumps(fx, separators=(",", ":")), encoding="utf-8")
    return got


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dl")
    ap.add_argument("--out")
    ap.add_argument("--expect", help="add the JavaScript's answers to this fixture")
    ap.add_argument("--trace", action="store_true", help="with --expect: print each poll's hidden ids and clocks")
    a = ap.parse_args(argv)
    if a.expect:
        got = expect(a.expect)
        if a.trace:
            for name, g in got.items():
                for row in g["trace"]:
                    print(name, datetime.fromtimestamp(row[0], O.CT).strftime("%m-%d %H:%M:%S"), row[1] or "-", row[2])
        return
    st = O.build_static(O.zip_for(a.dl, "2026-11-01"), Path(tempfile.gettempdir()) / "sb-e27-static")
    out = {"note": "Real bus reports (archived raw polls) for core/offroute.js; inputs from experiments/routeknower/"
                   "E27-scripts/make_golden.py, expect = web/js/core/offroute.js offRouteStep chained poll by poll "
                   "(nowS = feedTs = the poll's header time), computed in headless Edge. The iOS Kit OffRouteTests "
                   "replays the same file.",
           "format": "cases[i] = {name, polls: [{h, v: [[veh, route_id, lat, lon, report time]]}], expect: [[hidden "
                     "vehicle ids] per poll]}; shapes / service / routes = the Nov 1 2026 timetable",
           "shapes": st["shapes"], "service": st["service"],
           "routes": {rid: {"alias_ids": r.get("alias_ids") or []} for rid, r in st["routes"].items()}, "cases": []}
    for case in CASES:
        name, day, t0, minutes, vehs = case[:5]
        rid_only = case[5] if len(case) > 5 else None
        a0 = datetime(*t0, tzinfo=O.CT).timestamp()
        a1 = a0 + minutes * 60
        polls = []
        with gzip.open(Path(a.dl) / f"raw-polls-{day}.jsonl.gz", "rt", encoding="utf-8") as f:
            lines = [json.loads(ln) for ln in f if ln.strip()]
        lines.sort(key=lambda p: p["t"])
        k = 0
        for p in lines:
            h = int(p.get("h") or p["t"])
            if not (a0 <= h <= a1):
                continue
            v = [[str(x[0]), str(x[2]), round(float(x[3]), 6), round(float(x[4]), 6), int(x[10] or 0)] for x in p.get("v") or []
                 if (vehs is None or str(x[0]) in vehs) and (rid_only is None or str(x[2]) == rid_only)]
            if not v:
                continue
            if k % 3 == 0:
                polls.append({"h": h, "v": v})
            k += 1
        out["cases"].append({"name": name, "polls": polls})
        print(name, len(polls), "polls", sum(len(p["v"]) for p in polls), "reports", file=sys.stderr)
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    main()
