#!/usr/bin/env python3
"""Tests for the usage statistics receiver's pure logic (tools/usage/Code.gs: toRow, summarize, timeText, dayText,
isTestRow), run in headless Edge: Apps Script is plain V8 JavaScript, so the file is loaded into a page next to small
stand-ins for Utilities.formatDate / parseDate. The Sheet, Cache and Lock parts need Google and are not covered.

  python tools/test_usage_receiver.py
"""
import json, os, re, subprocess, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EDGE = os.environ.get("EDGE", r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe")

HARNESS = r"""<!doctype html><meta charset="utf-8"><title>running</title><pre id="out"></pre>
<script>
// Stand-ins for the Apps Script Utilities used by the pure functions (America/Chicago only).
var Utilities = {
  formatDate: function (d, tz, fmt) {
    var p = {}; new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
    var h = Number(p.hour) % 24, h12 = (h % 12) || 12;
    return fmt.replace("yyyy", p.year).replace("MM", p.month).replace("dd", p.day).replace("HH", String(h).padStart(2, "0"))
      .replace("h:mm a", h12 + ":" + p.minute + " " + (h < 12 ? "AM" : "PM")).replace("mm", p.minute);
  },
  parseDate: function (s, tz, fmt) {   // midnight in Chicago (CDT -5 / CST -6) of a yyyy-MM-dd day
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    var guess = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 5));
    return Utilities.formatDate(guess, tz, "HH") === "00" ? guess : new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 6));
  }
};
</script>
<script>/*CODE*/</script>
<script>
var results = [], fail = 0;
function check(name, cond, info) { results.push((cond ? "pass " : "FAIL ") + name + (cond ? "" : " " + JSON.stringify(info))); if (!cond) fail++; }
try {
  var NOW = new Date(Date.UTC(2026, 9, 29, 18, 30));   // 1:30 PM CDT, Thursday Oct 29 2026
  var A = "a".repeat(32), B = "b".repeat(32), C = "c".repeat(32), S1 = "1".repeat(31) + "a", S2 = "2".repeat(31) + "a", S3 = "3".repeat(31) + "a", S4 = "4".repeat(31) + "a";
  var start = toRow({ v: 1, e: "start", id: A, sid: S1, day: "2026-10-29", dow: 4, time: "08:15", app: "home-screen", ver: "2.0.0", nu: 1 }, NOW);
  check("start row: when, numbers, day, weekday name, time text, app, version, Yes", start && start[0] === NOW && start[1] === A && start[2] === S1
    && Utilities.formatDate(start[3], CHI, "yyyy-MM-dd") === "2026-10-29" && start[4] === "Thu" && start[5] === "08:15" && start[6] === "home-screen"
    && start[7] === "2.0.0" && start[8] === "Yes", start);
  var end = toRow({ v: 1, e: "end", id: A, sid: S1, dur: 245 }, NOW);
  check("end row: seconds and minutes", end && end[3] === 245 && end[4] === 4.1, end);
  check("place row: formula guard", toRow({ v: 1, e: "place", id: A, sid: S1, zone: "=1+1" }, NOW)[3] === "'=1+1");
  check("junk dropped", toRow({ v: 1, e: "start", id: "x", sid: S1 }, NOW) === null && toRow({ v: 2, e: "end", id: A, sid: S1, dur: 3 }, NOW) === null
    && toRow({ v: 1, e: "end", id: A, sid: S1, dur: 99999 }, NOW) === null && toRow({ v: 1, e: "start", id: A, sid: S1, day: "2026-10-29", dow: 9, time: "08:15" }, NOW) === null);
  check("timeText reads a clock value and text", timeText(new Date(Date.UTC(1899, 11, 30, 14, 5))) === "08:05" && timeText("17:40") === "17:40", timeText(new Date(Date.UTC(1899, 11, 30, 14, 5))));
  check("test rows: zero visitor (also stored as the number 0) or test version", isTestRow(0, "2.0.0") && isTestRow("0".repeat(32), "") && isTestRow(A, "receivercheck") && !isTestRow(A, "2.0.0"));

  var day = function (s) { return Utilities.parseDate(s, CHI, "yyyy-MM-dd"); };
  var starts = [
    [NOW, A, S1, day("2026-10-29"), "Thu", "08:15", "home-screen", "2.0.0", "Yes"],
    [NOW, A, S2, day("2026-10-29"), "Thu", "17:40", "browser", "2.0.0", "No"],
    [NOW, B, S3, day("2026-10-26"), "Mon", "08:05", "browser", "2.0.0", "Yes"],
    ["2026-10-29T05:00:00.000Z", C, S4, "2026-10-29", 4, "09:00", "browser", "2.0.0", 1],   // a version 1 row
    [NOW, 0, "f".repeat(32), day("2026-10-29"), "Thu", "00:00", "browser", "receivercheck", "No"]   // the setup test row
  ];
  var ends = [[NOW, A, S1, 60, 1], [NOW, A, S1, 240, 4], [NOW, B, S3, 30, 0.5]];
  var places = [[NOW, A, S1, "Reynolds Club"], [NOW, A, S2, "Reynolds Club"], [NOW, B, S3, "'=x"]];
  var s = summarize(starts, ends, places, NOW);
  var t = {}; s.totals.forEach(function (r) { t[r[0]] = r[1]; });
  check("totals: today 2 visitors / 3 visits (test row out), week 3 / 4", t["Distinct visitors today"] === 2 && t["Visits today (every page load)"] === 3
    && t["Distinct visitors, last 7 days"] === 3 && t["Visits, last 7 days"] === 4 && t["Distinct visitors, all time"] === 3, t);
  check("summary carries the 30-minute logins", Array.isArray(s.logins) && t["Logins, all time (30 min rule)"] === s.logins.length, t);
  check("median visit length in minutes (largest end per visit)", t["Typical visit length, all time (median minutes)"] === 2.3, t);
  check("home-screen share", t["Visits from the installed home-screen app"] === "25%", t);
  check("per day newest first with weekday, visitors, visits, new", JSON.stringify(s.days[0]) === JSON.stringify(["2026-10-29", "Thu", 2, 3, 2, 4]) && s.days[1][0] === "2026-10-26", s.days);
  check("hours in 12-hour clock", JSON.stringify(s.hours) === JSON.stringify([["8 AM", 2, 2], ["9 AM", 1, 1], ["5 PM", 1, 1]]), s.hours);
  check("places by visits, guard removed", JSON.stringify(s.places) === JSON.stringify([["Reynolds Club", 2, 1], ["=x", 1, 1]]), s.places);
  check("updated stamp in Chicago time", s.updated === "2026-10-29 1:30 PM", s.updated);
  // the 30-minute rule: per visitor, a start counts again only 30 min or more after the previous LOGGED login
  var at = function (hhmm) { var p = hhmm.split(":"); return new Date(Date.UTC(2026, 9, 29, 13 + Number(p[0]) - 8, Number(p[1]))); };   // CDT clock time
  var sid = function (n) { return String(n).repeat(32).slice(0, 31) + "f"; };
  var st = [
    [at("08:00"), A, sid(1), day("2026-10-29"), "Thu", "08:00", "browser", "2.0.0", "Yes"],
    [at("08:10"), A, sid(2), day("2026-10-29"), "Thu", "08:10", "browser", "2.0.0", "No"],   // reload: folds in
    [at("08:29"), A, sid(3), day("2026-10-29"), "Thu", "08:29", "browser", "2.0.0", "No"],   // 29 min: folds in
    [at("08:31"), A, sid(4), day("2026-10-29"), "Thu", "08:31", "browser", "2.0.0", "No"],   // 31 min after 08:00: a new login
    [at("09:10"), A, sid(5), day("2026-10-29"), "Thu", "09:10", "home-screen", "2.0.0", "No"],   // 39 min after 08:31
    [at("08:05"), B, sid(6), day("2026-10-29"), "Thu", "08:05", "browser", "2.0.0", "Yes"],
    [at("08:06"), 0, sid(7), day("2026-10-29"), "Thu", "08:06", "browser", "receivercheck", "No"]   // test row: out
  ];
  var en = [[NOW, A, sid(1), 60, 1], [NOW, A, sid(2), 90, 1.5], [NOW, A, sid(2), 120, 2], [NOW, B, sid(6), 30, 0.5]];
  var L = dedupeLogins(st, en);
  check("30-minute logins: 4 rows, newest first", L.length === 4 && L.map(function (r) { return r[4]; }).join(",") === "09:10,08:31,08:05,08:00", L.map(function (r) { return r[4]; }));
  var first = L[3];
  check("folded login: 3 page loads, lengths summed (60 + 120 s = 3 min), new visitor kept", first[1] === A && first[7] === 3 && first[8] === 3 && first[6] === "Yes" && first[2] === "2026-10-29" && first[3] === "Thu", first);
  check("a login without any length shows blank, app kept", L[0][8] === "" && L[0][5] === "home-screen", L[0]);
  check("exactly 30 minutes later counts again", dedupeLogins([[at("10:00"), C, sid(8), "2026-10-29", 4, "10:00", "browser", "2.0.0", 0],
    [at("10:30"), C, sid(9), "2026-10-29", 4, "10:30", "browser", "2.0.0", 0]], []).length === 2);
} catch (e) { check("no exception", false, String(e && e.stack || e)); }
document.getElementById("out").textContent = results.join("\n");
document.title = "RESULT fail=" + fail;
</script>"""


def main():
    code = (ROOT / "tools" / "usage" / "Code.gs").read_text(encoding="utf-8")
    page = HARNESS.replace("/*CODE*/", code.replace("</script>", "<\\/script>"))
    with tempfile.TemporaryDirectory() as tmp:
        f = Path(tmp) / "receiver.html"
        f.write_text(page, encoding="utf-8")
        out = subprocess.run([EDGE, "--headless=new", "--disable-gpu", "--virtual-time-budget=5000", "--dump-dom", f.as_uri()],
                             capture_output=True, text=True, timeout=120).stdout
    m = re.search(r'<pre id="out">(.*?)</pre>', out, re.S)
    body = (m.group(1) if m else "no output").replace("&quot;", '"').replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    print(body)
    fails = body.count("FAIL") + (0 if m else 1)
    print(("ok" if not fails else "FAILED"), f"({fails} failing)")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
