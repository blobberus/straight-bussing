#!/usr/bin/env python3
"""E32: real transition episodes for the display regression test (web/tests/data-display.js).

Each case is cut from inputs.py's replayed feeds of one archived day (the 10 s grid, every 3rd poll kept: about every
30 s; every 6th, about every minute, for the long ones): the vehicles of the case's line(s), the case's bus under any label, and one bus of another line that reports all
along (the feed is alive, core/transition.js FRESH_S); their trip updates (the stops of the case's line only); the alerts on display. The case carries the
static slices the app had that day (built from the day's GTFS: the deployed web/data; corridors.json and idle.json as
shipped), so the answers do not depend on the committed web/data. `guard` cases are episodes the shipped rules get
right; `gap` cases are episodes they get wrong for riders: the test asserts the CURRENT behavior and names the gap, so
whoever fixes one updates the case here (make_fixtures.py --expect) and says in RouteKnower E32 what changed for riders.

  python experiments/routeknower/E32-scripts/make_fixtures.py --work <inputs.py work dir> --out web/tests/fixtures/display_episodes.json
  python experiments/routeknower/E32-scripts/make_fixtures.py --expect web/tests/fixtures/display_episodes.json
"""
import argparse, html, json, re, shutil, subprocess, sys, tempfile
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

REPO = Path(__file__).resolve().parents[3]
CT = ZoneInfo("America/Chicago")
EVERY = 3   # keep every 3rd 10 s poll

# name, day, from, to, bus, routes, stop (next time read there), kind, what the app shows, gap: why wrong + the fix E32
# recommends (owner decision), plan (at, from stop, to stop)
CASES = [
    dict(name="gone_shift_end", day="2026-11-09", t=("21:40", "22:20"), bus="4319", routes=["1078"], stop="9593", kind="guard",
         says="Central 4319 stops reporting at 21:46 while Passio keeps predicting it until 22:16 (the times count down "
              "to Now and stay there): its badge goes 5 min after its last report (core/operating.js), its times 15 min "
              "after (core/transition.js GONE), so International House no longer shows it from about 22:01."),
    dict(name="offroute_garage", day="2026-11-09", t=("12:00", "12:28"), bus="4322", routes=["5704"], stop="8612", kind="guard",
         says="Downtown Campus Connector 4322 drives off the line after its last arrival (12:08): hidden with its times "
              "(core/offroute.js) and still tracked (store.away)."),
    dict(name="idle_parked", day="2026-11-06", t=("18:44", "19:40"), bus="4315", routes=["5699"], stop="67599", kind="guard",
         every=6,
         says="Red Line/Arts Block 4315 parked after its last arrival (18:40): hidden as idle (core/idle.js IDLE: still 30 "
              "min, no Passio time 2 min ahead) from 19:17, shown again at 19:32 when Passio gives it a time ahead."),
    dict(name="number_join", day="2026-11-06", t=("09:20", "09:50"), bus="12645", routes=["5704"], stop="8612", kind="guard",
         says="A bus joining the Downtown Campus Connector renumbers the line in vehicle id order (core/busnum.js; every "
              "phone shows the same numbers)."),
    dict(name="offroute_then_silent", day="2026-11-06", t=("18:15", "19:05"), bus="4317", routes=["6126"], stop="8612", kind="gap",
         every=6,
         says="AP/DX 4317 ends its shift (last arrival 18:13), drives off the line and is hidden with its times at 18:21 "
              "(core/offroute.js); its last report is at 18:43, at 18:48 it leaves the operating list (5 min) and its "
              "Passio times come back on screen until GONE drops them at 18:58 (15 min).",
         gap="Rider: times from a bus already at the garage return for up to 10 min (5 to 15 min after its last report). "
             "1,555 bus-minutes Oct 10 to Nov 5 replayed, 174 Nov 6 to 10 (the Downtown Campus Connector most). Fix: keep dropping the times of a "
             "bus core/offroute.js or core/idle.js hid until it reports again (data/live.js), or let GONE start from the "
             "hide; an owner decision since it changes what riders see."),
    dict(name="gone_comeback", day="2026-11-09", t=("07:45", "08:25"), bus="4322", routes=["5702"], stop="8612", kind="gap",
         says="Apostolic 4322 sends no report from 07:55 to 08:13 between morning runs: GONE drops its times at 08:10, it "
              "reports again at 08:13 and serves Goldblatt within 15 min.",
         gap="Rider: the next Apostolic departure vanishes for a few minutes before the bus comes. 94% of GONE minutes on "
             "Apostolic (4322, 5 to 10 AM) were such comebacks. Fix (owner): a longer GONE time for a bus whose next Passio "
             "time is a trip start, or keep such times labeled est."),
    dict(name="offroute_loop", day="2026-11-06", t=("17:58", "18:26"), bus="4331", routes=["6126"], stop="8615", kind="gap",
         says="AP/DX 4331 runs a 17 min loop off the drawn line (north to 55th Street, east toward Lake Park) on each "
              "evening round: hidden with its times while away, shown again at Goldblatt (18:19), where it serves.",
         gap="Rider: the next AP/DX time at Bernard Mitchell / Goldblatt disappears for about 12 min of each loop. Fix "
             "(owner, pending since Nov 6): learned off-line service runs (the loop as a corridor), or keep the times of "
             "a hidden bus that Passio predicts within 10 min."),
    dict(name="offroute_fcm", day="2026-11-06", t=("19:25", "19:50"), bus="4313", routes=["5700"], stop="8612", kind="gap",
         says="Friend Center/Metra 4313 in the evening: hidden off its line for about 12 min (south of 60th Street, parked "
              "4 min), then serves Wyler Pavilion at 19:46.",
         gap="Rider: no Friend Center/Metra bus or time for about 12 min while it is coming (53% of the line's off-route minutes "
             "Oct 10 to Nov 10 were such, 68% since Nov 6; 6 to 9 PM, 4325 and 4313). Fix (owner): the same as offroute_loop."),
    dict(name="idle_linger_comeback", day="2026-11-09", t=("23:35", "00:05"), bus="4317", routes=["1075"], stop="8579", kind="gap",
         says="North 4317 waits at Reynolds Club after the learned linger time: hidden (core/idle.js LINGER), then serves "
              "again 10 min later.",
         gap="Rider: the late North bus is hidden while it waits to make one more run. Fix: refresh idle.json (the linger "
             "time was learned before Nov 6) or require no Passio time ahead for LINGER."),
    dict(name="parked_rolling", day="2026-11-06", t=("18:30", "19:20"), bus="12645", routes=["5704"], stop="8654", kind="gap",
         says="Downtown Campus Connector 12645 parked downtown from 18:30 to 20:49: shown with a time about 20 min ahead at "
              "59th and Ellis that slides forward with the clock; GPS jitter of about 100 m keeps restarting the 80 m still clock, so "
              "core/idle.js never hides it.",
         gap="Rider: 'DCC in 20 min' at 59th and Ellis for over two hours. Fix (owner): a wider still radius downtown "
             "(about 150 m), or label times that slide 5+ min in 10 min while the bus is still as est. (a hide rule on that "
             "alone would be wrong 3 times in 4: only 24% of the minutes it picks were ghosts, E32)."),
    dict(name="parked_now", day="2026-11-06", t=("18:02", "18:50"), bus="12644", routes=["6126"], stop="8615", kind="gap",
         says="AP/DX 12644 parked at Goldblatt for an hour with Passio saying it reaches Bernard Mitchell in under a "
              "minute (it moves again at 19:09); later stops keep a time ahead, so core/idle.js IDLE never applies, and its "
              "90 min PARKED limit is not reached.",
         gap="Rider: 'Now' at Bernard Mitchell Hospital for an hour. Fix (owner): IDLE should ignore Passio times that "
             "slide with the clock (the next stop's time stays under 2 min while the bus is still)."),
    dict(name="planner_leaving", day="2026-11-06", t=("17:40", "18:25"), bus="4318", routes=["5704"], stop="8654", kind="gap",
         every=6, plan=("17:45", "8654", "132963"),
         says="Directions at 17:45 from 59th and Ellis to Gleacher Center: the top option boards Downtown Campus Connector "
              "4318 on its live time (Passio: at 59th and Ellis in about 12 min) while the bus is downtown; it makes its "
              "last arrival at 18:00 (Roosevelt Station) and logs no other arrival that day.",
         gap="Rider: a trip planned on a bus that never comes (its live time at 59th and Ellis was impossible from "
             "downtown). No live signal predicts a leave (E29). Fix (owner): none in the rules; a live time far below the "
             "timetable's ride time from where the bus is could be shown as est."),
    dict(name="number_flap", day="2026-11-09", t=("10:00", "10:30"), bus="12643", routes=["5704"], stop="8612", kind="gap",
         says="Downtown Campus Connector, 6 buses: each time core/offroute.js hides or shows a bus at the edge of the "
              "line, the others are renumbered (Bus 3 becomes Bus 2 and back).",
         gap="Rider: 'Bus 3 in 4 min' turns into 'Bus 2 in 4 min' with no bus change. 50% of the DCC's swaps (Oct 10 to Nov "
             "10) came from rule toggles. Fix (owner): keep a hidden bus's number place while it is in store.away (as for a feed gap)."),
]


def epoch(day, hm):
    d = date.fromisoformat(day)
    h, m = map(int, hm.split(":"))
    dt = datetime(d.year, d.month, d.day, h, m, tzinfo=CT)
    if h < 4:
        n = d + timedelta(days=1)
        dt = datetime(n.year, n.month, n.day, h, m, tzinfo=CT)
    return int(dt.timestamp())


def build(work, out):
    work = Path(work)
    fx = {"note": "RouteKnower E32: real transition episodes (archived raw polls, prediction updates and alerts rebuilt "
                  "on the app's 10 s poll grid by experiments/routeknower/E32-scripts/inputs.py, every 3rd poll kept) run "
                  "through web/js/data/live.js startLive by web/tests/display-run.js. expect / story = the shipped code's "
                  "answers (make_fixtures.py --expect). kind gap = the current behavior is wrong for riders (RouteKnower "
                  "E32 has the fix it recommends; the owner decides).",
          "format": "static = the slices the app had (shared by the cases); cases[i].polls[j] = {h, v: [[vehicle, trip, "
                    "route, lat, lon, report time]], u: [snap index], a: [alert index]}; snaps[k] = [vehicle, trip, route, "
                    "[[stop, time]]]; every time is seconds after the case's t0 (unix); expect[j] = [shown on the case's "
                    "routes, vehicles whose times are kept, away, {vehicle: number}, vehicle of the next time at the "
                    "case's stop]",
          "routes": None, "idle": None, "cases": []}
    cache = {}
    for C in CASES:
        day = C["day"]
        if day not in cache:
            cache[day] = json.loads((work / f"{day}.json").read_text(encoding="utf-8"))
        inp = cache[day]
        sdir = work / inp["static"]
        load = lambda n: json.loads((sdir / n).read_text(encoding="utf-8"))
        if fx["routes"] is None:
            fx["routes"], fx["idle"] = load("routes.json"), load("idle.json")
        a0, a1 = epoch(day, C["t"][0]), epoch(day, C["t"][1])
        grid = [p for p in inp["polls"] if a0 <= p[0] <= a1]
        grid = grid[::C.get("every", EVERY)]
        routes = set(C["routes"])
        keep = {C["bus"]}
        for p in grid:
            for v in p[1]:
                if v[2] in routes:
                    keep.add(v[0])
        others = {}
        for p in grid:
            for v in p[1]:
                if v[0] not in keep and p[0] - v[7] <= 60:
                    others[v[0]] = others.get(v[0], 0) + 1
        keeper = max(others, key=others.get) if others else None
        if keeper:
            keep.add(keeper)
        rstops0 = json.loads((sdir / "route_stops.json").read_text(encoding="utf-8"))
        want = {x for r in routes for x in rstops0.get(r, [])} | {C.get("stop")}
        if C.get("plan"):
            want |= {C["plan"][1], C["plan"][2]}
        snaps, six, alerts, aix, polls = [], {}, [], {}, []
        for p in grid:
            u = []
            for i in p[2]:
                s = inp["snaps"][i]
                if s[0] not in keep or (s[0] == keeper and s[2] not in routes):
                    continue
                if i not in six:
                    six[i] = len(snaps)
                    snaps.append([s[0], s[1], s[2], [x for x in s[3] if x[0] in want]])
                u.append(six[i])
            al = []
            for i in p[3]:
                if i not in aix:
                    aix[i] = len(alerts)
                    alerts.append(inp["alerts"][i])
                al.append(aix[i])
            polls.append({"h": p[0], "v": [[v[0], v[1], v[2], round(v[3], 5), round(v[4], 5), v[7]] for v in p[1] if v[0] in keep],
                          "u": u, "a": al})
        rs = set(routes)
        shapes, corr, service, rstops = load("shapes.json"), load("corridors.json"), load("service.json"), load("route_stops.json")
        stops = load("stops.json")
        want_stops = {x for r in routes for x in rstops.get(r, [])} | ({C["plan"][1], C["plan"][2]} if C.get("plan") else set())
        if fx.setdefault("static_key", inp["static"]) != inp["static"]:
            raise SystemExit(f"{C['name']}: another day's timetable ({inp['static']}); the cases share one set of static slices")
        S = fx.setdefault("static", {"shapes": {}, "corridors": {**{k: v for k, v in corr.items() if k != "routes"}, "routes": {}},
                                     "service": {**{k: v for k, v in service.items() if k != "routes"}, "routes": {}},
                                     "routeStops": {}, "stops": {}})
        for r in rs:
            for key, src in (("shapes", shapes), ("routeStops", rstops)):
                if r in src:
                    S[key][r] = src[r]
            for key, src in (("corridors", corr), ("service", service)):
                if r in src.get("routes", {}):
                    S[key]["routes"][r] = src["routes"][r]
        S["stops"].update({x: stops[x] for x in want_stops if x in stops})
        t0 = polls[0]["h"]
        for q in polls:
            q["h"] -= t0
            for v in q["v"]:
                v[5] -= t0
        for x in snaps:
            x[3] = [[st, t - t0] for st, t in x[3]]
        case = {"name": C["name"], "kind": C["kind"], "day": day, "bus": C["bus"], "routes": C["routes"], "stop": C.get("stop"),
                "says": C["says"], **({"gap": C["gap"]} if C.get("gap") else {}), "t0": t0,
                "snaps": snaps, "alerts": alerts, "polls": polls}
        if C.get("plan"):
            at, f, t = C["plan"]
            target = epoch(day, at)
            h = min((p["h"] + t0 for p in polls), key=lambda x: abs(x - target))
            case["plan"] = {"at": h - t0, "from": f, "to": t}
        fx["cases"].append(case)
        print(C["name"], len(polls), "polls", len(keep), "buses", len(snaps), "trip updates", file=sys.stderr)
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    Path(out).write_text(json.dumps(fx, separators=(",", ":")), encoding="utf-8")
    print(out, Path(out).stat().st_size // 1024, "KB", file=sys.stderr)


def expect(path):
    sys.path.insert(0, str(REPO / "tools"))
    import run_browser_tests as RB
    edge = RB.find_edge()
    srv, port = RB.start_server()
    prof = tempfile.mkdtemp(prefix="sb-edge-")
    try:
        cmd = [edge, "--headless=new", "--disable-gpu", "--no-first-run", "--virtual-time-budget=60000",
               f"--user-data-dir={prof}", "--dump-dom", f"http://127.0.0.1:{port}/tests/display-golden.html"]
        dom = subprocess.run(cmd, capture_output=True, timeout=300).stdout.decode("utf-8", "replace")
    finally:
        srv.shutdown()
        shutil.rmtree(prof, ignore_errors=True)
    m = re.search(r'<pre[^>]*id="result"[^>]*>(.*?)</pre>', dom, re.S)
    got = json.loads(html.unescape(m.group(1)))
    fx = json.loads(Path(path).read_text(encoding="utf-8"))
    for c in fx["cases"]:
        c["expect"], c["story"] = got[c["name"]]["polls"], got[c["name"]]["story"]
        print(c["name"], c["kind"], json.dumps(c["story"]), file=sys.stderr)
    Path(path).write_text(json.dumps(fx, separators=(",", ":")), encoding="utf-8")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--work")
    ap.add_argument("--out")
    ap.add_argument("--expect")
    a = ap.parse_args(argv)
    if a.expect:
        return expect(a.expect)
    build(a.work, a.out)


if __name__ == "__main__":
    main()
