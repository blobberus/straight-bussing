#!/usr/bin/env python3
"""E29: real feed polls for the gone-bus tests (web/tests/core-transition.js and the iOS Kit TransitionTests share the
file). Each case is cut from the archived raw polls (every 3rd poll, about every 30 s): the vehicles the feed listed
then (every bus with a report at most 300 s old, with its latest report time) and the vehicles Passio was predicting
(any prediction update visible at that moment, from the logged prediction updates):
  shift_end     Oct 15 22:05 to 23:15: Central 4317 leaves the feed at Ellis Ave & 57th St at 22:21 for good; Passio
                keeps predicting it for 47 min (14 stops it never served)
  break         Nov 5 17:50 to 19:05: Downtown Campus Connector 12643 leaves at 18:01, one report while away, back
                at S Michigan Ave/Roosevelt after 61 min; Passio kept predicting it for 39 min
  layover       Oct 17 17:25 to 18:00: North 4322 out of the feed 10 min at Booth School between trips, then serving
  long_layover  Oct 12 18:10 to 18:50: Downtown Campus Connector 4314 out of the feed about 15 min at Roosevelt Station,
                then serving (never dropped); and 12647, which reported only every 5 to 20 min that evening while it
                drove the line (never dropped: SPARSE_S)
The expected answers come from web/js/core/transition.js itself: --expect runs web/tests/transition-golden.html in
headless Edge and stores its answers in the file. Copy the result to
ios/StraightBussingKit/Tests/StraightBussingKitTests/Fixtures/transition_golden.json.

  python experiments/routeknower/E29-scripts/make_golden.py --dl <E28 fetch.py folder> --out web/tests/fixtures/transition_golden.json
  python experiments/routeknower/E29-scripts/make_golden.py --expect web/tests/fixtures/transition_golden.json
"""
import argparse, gzip, html, json, re, shutil, subprocess, sys, tempfile
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import transitions as T   # noqa: E402
O = T.O

CASES = [
    ("shift_end", "2026-10-15", (2026, 10, 15, 22, 5), 70, "4317"),
    ("break", "2026-11-05", (2026, 11, 5, 17, 50), 75, "12643"),
    ("layover", "2026-10-17", (2026, 10, 17, 17, 25), 35, "4322"),
    ("long_layover", "2026-10-12", (2026, 10, 12, 18, 10), 40, "4314"),
]


def expect(path):
    sys.path.insert(0, str(O.REPO / "tools"))
    import run_browser_tests as RB
    edge = RB.find_edge()
    srv, port = RB.start_server()
    prof = tempfile.mkdtemp(prefix="sb-edge-")
    try:
        cmd = [edge, "--headless=new", "--disable-gpu", "--no-first-run", "--virtual-time-budget=30000",
               f"--user-data-dir={prof}", "--dump-dom", f"http://127.0.0.1:{port}/tests/transition-golden.html"]
        dom = subprocess.run(cmd, capture_output=True, timeout=120).stdout.decode("utf-8", "replace")
    finally:
        srv.shutdown()
        shutil.rmtree(prof, ignore_errors=True)
    m = re.search(r'<pre[^>]*id="result"[^>]*>(.*?)</pre>', dom, re.S)
    got = json.loads(html.unescape(m.group(1)))
    fx = json.loads(Path(path).read_text(encoding="utf-8"))
    for c in fx["cases"]:
        c["expect"] = got[c["name"]]["expect"]
        first, back = {}, {}
        for p, step in zip(c["polls"], c["expect"]):
            for v in step:
                first.setdefault(v, datetime.fromtimestamp(p["h"], O.CT).strftime("%H:%M:%S"))
            for v in first:
                if v not in step:
                    back.setdefault(v, datetime.fromtimestamp(p["h"], O.CT).strftime("%H:%M:%S"))
        print(c["name"], "gone from:", first, "back:", back, file=sys.stderr)
    Path(path).write_text(json.dumps(fx, separators=(",", ":")), encoding="utf-8")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dl")
    ap.add_argument("--out")
    ap.add_argument("--expect")
    a = ap.parse_args(argv)
    if a.expect:
        return expect(a.expect)
    out = {"note": "Real feed polls (archived raw polls + logged prediction updates) for core/transition.js; inputs from "
                   "experiments/routeknower/E29-scripts/make_golden.py, expect = web/js/core/transition.js goneStep chained "
                   "poll by poll (feedTs = nowS = the poll's header time), computed in headless Edge. The iOS Kit "
                   "TransitionTests replays the same file.",
           "format": "cases[i] = {name, bus, polls: [{h, v: [[vehicle id, report time]], p: [vehicle ids Passio predicts]}], "
                     "expect: [[gone vehicle ids] per poll]}",
           "cases": []}
    for name, day, t0, minutes, bus in CASES:
        a0 = datetime(*t0, tzinfo=O.CT).timestamp()
        a1 = a0 + minutes * 60
        preds = T.load_preds(a.dl, [day])
        with gzip.open(Path(a.dl) / f"raw-polls-{day}.jsonl.gz", "rt", encoding="utf-8") as f:
            lines = [json.loads(ln) for ln in f if ln.strip()]
        lines.sort(key=lambda p: p["t"])
        latest, polls, k = {}, [], 0
        for p in lines:
            h = int(p.get("h") or p["t"])
            for x in p.get("v") or []:
                vt = int(x[10] or 0)
                if vt and h - vt <= T.FRESH_S and vt > latest.get(str(x[0]), 0):
                    latest[str(x[0])] = vt
            if not (a0 <= h <= a1):
                continue
            if k % 3 == 0:
                v = sorted([veh, vt] for veh, vt in latest.items() if h - vt <= T.FRESH_S)
                pv = sorted(veh for veh, pl in preds.items()
                            if any(s <= h <= last + T.PRED_SEEN_S and pred >= h - 60 for s, last, _, _, pred in pl))
                polls.append({"h": h, "v": v, "p": pv})
            k += 1
        out["cases"].append({"name": name, "bus": bus, "polls": polls})
        print(name, len(polls), "polls", sum(len(p["v"]) for p in polls), "reports", file=sys.stderr)
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    main()
