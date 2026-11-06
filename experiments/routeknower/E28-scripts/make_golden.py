#!/usr/bin/env python3
"""E28: real bus reports for the idle-bus tests (web/tests/core-idle.js and the iOS Kit IdleTests share the file).
Writes the inputs of web/tests/fixtures/idle_golden.json: the Nov 5 2026 timetable's listed hours (service.json),
the learned linger cutoffs (web/data/idle.json), and cases cut from the archived raw polls (every 3rd poll, about every
30 s), each poll with the latest Passio prediction then visible for each bus (from the logged prediction updates):
  regenstein  Nov 5 23:10 to Nov 6 00:06: the buses the owner saw at 11:50 PM (North 4328, East 4325, Central 4313 at
              Reynolds Club beside Regenstein, South 4538 at Burton-Judson, Apostolic/Drexel 4318 and 12645 at
              Goldblatt), with their 23:15 to 23:30 layovers before (they served again: never hidden)
  parked      Oct 29 12:10 to 14:00: Downtown Campus Connector 12647 parked from 12:16 to 21:18, never serving
  idle        Nov 5 18:45 to 20:00: Red Line/Arts Block 4317 still at Logan Center 18:55 to 19:54 with no prediction
  past        Oct 29 21:55 to 22:50: Friend Center/Metra 4325 at Logan Center 70 min after its listed hours
  nopred      Oct 31 15:40 to 16:20: East 4328 waiting 27 min at Reynolds Club with no prediction, then serving
The expected answers come from web/js/core/idle.js itself: --expect runs web/tests/idle-golden.html in headless Edge
and stores its answers in the file. Copy the result to
ios/StraightBussingKit/Tests/StraightBussingKitTests/Fixtures/idle_golden.json.

  python experiments/routeknower/E28-scripts/make_golden.py --dl <fetch.py folder> --idle web/data/idle.json
      --out web/tests/fixtures/idle_golden.json
  python experiments/routeknower/E28-scripts/make_golden.py --expect web/tests/fixtures/idle_golden.json
"""
import argparse, gzip, html, json, re, shutil, subprocess, sys, tempfile
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "E27-scripts"))
import offroute as O   # noqa: E402

CASES = [
    ("regenstein", "2026-11-05", (2026, 11, 5, 23, 10), 56, {"4328", "4325", "4313", "4538", "4318", "12645"}),
    ("parked", "2026-10-29", (2026, 10, 29, 12, 10), 110, {"12647"}),
    ("idle", "2026-11-05", (2026, 11, 5, 18, 45), 75, {"4317"}),
    ("past", "2026-10-29", (2026, 10, 29, 21, 55), 55, {"4325"}),
    ("nopred", "2026-10-31", (2026, 10, 31, 15, 40), 40, {"4328"}),
]


def preds_of(dl, day, vehs):
    out = {}
    for p in sorted(Path(dl).glob("pred-updates-*.jsonl.gz")):
        if abs((datetime.fromisoformat(p.name[13:23]) - datetime.fromisoformat(day)).days) > 1:
            continue
        with gzip.open(p, "rt", encoding="utf-8") as f:
            for ln in f:
                x = json.loads(ln)
                if str(x[0]) in vehs:
                    seen = int(x[6]) if len(x) > 6 else int(x[3])
                    last = int(x[7]) if len(x) > 7 else seen
                    out.setdefault(str(x[0]), []).append((seen, last, int(x[4])))
    return out


def latest_pred(lst, h):
    """The latest predicted time visible at h (seen <= h <= last + 90, not more than 60 s in the past), or 0."""
    best = 0
    for seen, last, pred in lst or ():
        if seen <= h <= last + 90 and pred >= h - 60:
            best = max(best, pred)
    return best


def expect(path):
    sys.path.insert(0, str(O.REPO / "tools"))
    import run_browser_tests as T
    edge = T.find_edge()
    srv, port = T.start_server()
    prof = tempfile.mkdtemp(prefix="sb-edge-")
    try:
        cmd = [edge, "--headless=new", "--disable-gpu", "--no-first-run", "--virtual-time-budget=30000",
               f"--user-data-dir={prof}", "--dump-dom", f"http://127.0.0.1:{port}/tests/idle-golden.html"]
        dom = subprocess.run(cmd, capture_output=True, timeout=120).stdout.decode("utf-8", "replace")
    finally:
        srv.shutdown()
        shutil.rmtree(prof, ignore_errors=True)
    m = re.search(r'<pre[^>]*id="result"[^>]*>(.*?)</pre>', dom, re.S)
    got = json.loads(html.unescape(m.group(1)))
    fx = json.loads(Path(path).read_text(encoding="utf-8"))
    for c in fx["cases"]:
        c["expect"] = got[c["name"]]["expect"]
        first = {}
        for p, step in zip(c["polls"], c["expect"]):
            for v in step:
                first.setdefault(v, datetime.fromtimestamp(p["h"], O.CT).strftime("%H:%M:%S"))
        print(c["name"], "hidden from:", first, file=sys.stderr)
    Path(path).write_text(json.dumps(fx, separators=(",", ":")), encoding="utf-8")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dl")
    ap.add_argument("--idle")
    ap.add_argument("--out")
    ap.add_argument("--expect")
    a = ap.parse_args(argv)
    if a.expect:
        return expect(a.expect)
    st = O.build_static(O.zip_for(a.dl, "2026-11-05"), Path(tempfile.gettempdir()) / "sb-e27-static")
    out = {"note": "Real bus reports (archived raw polls) for core/idle.js; inputs from experiments/routeknower/E28-scripts/"
                   "make_golden.py, expect = web/js/core/idle.js idleStep chained poll by poll (nowS = feedTs = the poll's "
                   "header time), computed in headless Edge. The iOS Kit IdleTests replays the same file.",
           "format": "cases[i] = {name, polls: [{h, v: [[veh, route_id, lat, lon, report time]], p: [[veh, latest "
                     "predicted time]]}], expect: [[hidden vehicle ids] per poll]}; service = the Nov 5 2026 timetable, "
                     "idle = web/data/idle.json",
           "service": st["service"], "idle": json.loads(Path(a.idle).read_text(encoding="utf-8")), "cases": []}
    for name, day, t0, minutes, vehs in CASES:
        a0 = datetime(*t0, tzinfo=O.CT).timestamp()
        a1 = a0 + minutes * 60
        preds = preds_of(a.dl, day, vehs)
        with gzip.open(Path(a.dl) / f"raw-polls-{day}.jsonl.gz", "rt", encoding="utf-8") as f:
            lines = [json.loads(ln) for ln in f if ln.strip()]
        lines.sort(key=lambda p: p["t"])
        polls, k = [], 0
        for p in lines:
            h = int(p.get("h") or p["t"])
            if not (a0 <= h <= a1):
                continue
            v = [[str(x[0]), str(x[2]), round(float(x[3]), 6), round(float(x[4]), 6), int(x[10] or 0)] for x in p.get("v") or []
                 if str(x[0]) in vehs and h - int(x[10] or 0) <= O.FRESH_S]
            if not v:
                continue
            if k % 3 == 0:
                polls.append({"h": h, "v": v, "p": [[veh, latest_pred(preds.get(veh), h)] for veh in sorted({x[0] for x in v})]})
            k += 1
        out["cases"].append({"name": name, "polls": polls})
        print(name, len(polls), "polls", sum(len(p["v"]) for p in polls), "reports", file=sys.stderr)
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    main()
