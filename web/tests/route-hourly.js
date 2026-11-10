// The route page's "Schedule by hour" (owner 2026-11-09: "Every 30 minutes between x times", under the bus counts, with
// a disclaimer that buses often don't keep to it). Renders with ui/views/route.js and checks the layout with route.css.
import { test, eq, ok } from "./lib.js";
import { renderRoute, renderService, headwayNote } from "../js/ui/views/route.js";
import { fixture } from "./views-fixtures.js";
import { serviceFixture, utc } from "./route-fixtures.js";

const WED_10AM = utc("2026-10-14T15:00:00Z"), WED_10PM = utc("2026-10-15T03:00:00Z");
const withAt = (svc, rid, at) => { svc.routes[rid].at = at; return svc; };
const svcState = (over = {}) => fixture({ routeId: "R1", service: withAt(serviceFixture(), "R1", "S2"), ...over });
const text = (h) => { const b = document.createElement("div"); b.innerHTML = h; return b.textContent.replace(/\s+/g, " "); };
const rows = (h) => {
  const box = document.createElement("div");
  box.innerHTML = h;
  return [...box.querySelectorAll(".r-frow")].map((li) => ({
    say: li.querySelector(".v-sr")?.textContent, k: li.querySelector(".r-fk")?.textContent, w: li.querySelector(".r-fw")?.textContent,
    hidden: [...li.querySelectorAll(".r-fk, .r-fw")].every((x) => x.getAttribute("aria-hidden") === "true"),
  }));
};

test("route page: Schedule by hour lists the timetable's ranges under the bus counts, then the disclaimer", () => {
  const h = renderRoute(svcState(), WED_10AM);
  const bars = h.indexOf("Scheduled buses by hour, today"), list = h.indexOf("Schedule by hour, today"), foot = h.indexOf("official published schedule");
  ok(bars > 0 && list > bars && foot > list, "bus counts, then Schedule by hour, then the section's footnote: " + JSON.stringify({ bars, list, foot }));
  ok(h.includes('<h3 class="r-h3" id="r-freq-h">Schedule by hour, today</h3>'), "section title style");
  ok(h.includes('<ul class="r-flist" aria-labelledby="r-freq-h">'), "the list is named by its title");
  const r = rows(h);
  eq(r.map((x) => `${x.k} | ${x.w}`), ["Every 30 min | 7:00 to 8:00 AM", "Every 15 min | 8:00 to 10:30 AM", "Every 30 min | 10:30 AM to 6:00 PM", "1 trip | 7:00 PM"]);
  eq(r.map((x) => x.say), ["Every 30 minutes, 7:00 to 8:00 AM", "Every 15 minutes, 8:00 to 10:30 AM", "Every 30 minutes, 10:30 AM to 6:00 PM", "1 trip, 7:00 PM"], "one natural sentence per row");
  ok(r.every((x) => x.hidden), "the visible halves are hidden from screen readers (the sentence carries them)");
  ok(text(h).includes("Timetable only, times at Library. Buses often don't keep to this schedule, so go by the live times when buses are running."), "disclaimer names the stop the times are for");
  ok(h.includes('<p class="r-fnote"><svg class="ic"'), "the disclaimer is the card's last row with an info glyph");
  ok(!/[\u2013\u2014]/.test(text(h)), "no dash characters (docs/DESIGN.md Copy)");
});

test("route page: a closed route shows Schedule by hour with the hours, before the stops", () => {
  const h = renderRoute(svcState({ buses: [] }), WED_10PM);
  const list = h.indexOf("Schedule by hour, today"), stops = h.indexOf('id="r-stops-h"');
  ok(list > 0 && stops > list, "hours (with the list) first, then the Stops heading: " + JSON.stringify({ list, stops }));
  eq((h.match(/id="r-freq-h"/g) || []).length, 1, "once");
});

test("route page: Schedule by hour shows without bars (one bus all day), and not at all without departures", () => {
  const svc = withAt(serviceFixture(), "R1", "S2");
  for (const k of ["mon", "tue", "wed", "thu", "fri"]) svc.routes.R1.days[k].buses = svc.routes.R1.days[k].buses.map((n) => (n ? 1 : 0));
  let h = renderService(svcState({ service: svc }), "R1", WED_10AM);
  ok(!h.includes("Scheduled buses by hour") && h.includes("Schedule by hour, today"), "no bars worth drawing, the list still shows");
  const old = withAt(serviceFixture(), "R1", "S2");
  for (const k of ["mon", "tue", "wed", "thu", "fri"]) delete old.routes.R1.days[k].dep;   // a cached service.json from before dep
  h = renderService(svcState({ service: old }), "R1", WED_10AM);
  ok(h.includes("Scheduled buses by hour, today") && !h.includes("r-freq"), "bars only, no empty card");
  const noAt = serviceFixture();
  ok(text(renderService(svcState({ service: noAt }), "R1", WED_10AM)).includes("Timetable only. Buses often"), "no reference stop: no stop name");
  eq(headwayNote(""), "Timetable only. Buses often don't keep to this schedule, so go by the live times when buses are running.");
});

test("route page: the bars and Schedule by hour follow calendar changes and the service day", () => {
  const s = svcState();
  const extra = renderService(s, "D", utc("2026-10-10T15:00:00Z"));   // the extra Saturday, every 20 min
  ok(extra.includes("Schedule by hour, today"), "the calendar change's own day");
  eq(rows(extra).map((x) => x.say), ["Every 20 minutes, 10:00 AM to 2:00 PM"]);
  ok(!extra.includes("Scheduled buses by hour"), "no bus counts for that day: no bars (never the regular Saturday's or Monday's)");
  const hol = renderService(s, "D", utc("2026-11-26T16:00:00Z"));      // Thanksgiving off
  ok(hol.includes("Scheduled buses by hour, Thursdays"), "a cancelled day: the bars show the weekday's regular timetable, named");
  ok(hol.includes("Schedule by hour, today") && text(hol).includes("Holiday schedule today: no service") && text(hol).includes("No service. Next service Friday"), "the list: today's real timetable, said so");
  const night = renderService(s, "N", utc("2026-10-08T07:00:00Z"));    // Thu 2 AM = Wednesday's night service
  ok(night.includes("Schedule by hour, Wednesday"), "after midnight: yesterday's service day by name");
  eq(rows(night).map((x) => x.say), ["Every 15 minutes, 4:00 to 11:00 PM", "Every 30 minutes, 11:00 PM to 4:00 AM"]);
  const sun = renderService(s, "R1", utc("2026-10-11T15:00:00Z"));      // a weekday route on Sunday
  ok(sun.includes("Scheduled buses by hour, Mondays"), "the bars: the first day with service");
  ok(sun.includes("Schedule by hour, today") && text(sun).includes("No service. Next service Monday"), "the list: today's tab (the weekend) says when service comes back");
});

test("route page: Schedule by hour escapes the stop name", () => {
  const s = svcState();
  s.stops = { ...s.stops, S2: { ...s.stops.S2, name: '<img src=x onerror="alert(1)">' } };
  const h = renderService(s, "R1", WED_10AM);
  ok(!h.includes("<img") && h.includes("times at &lt;img src=x onerror="), "escaped");
  ok(text(h).includes('times at <img src=x onerror="alert(1)">.'), "reads as the plain name");
});

test("route page: Schedule by hour fits 320 px at 200% text, rows never overflow", () => {
  const root = document.documentElement, was = root.style.fontSize;
  const box = document.createElement("div");
  box.style.cssText = "position:absolute;left:-10000px;top:0;width:288px";   // 320 minus the sheet's 16 pt insets
  box.innerHTML = renderService(svcState(), "R1", WED_10AM);
  document.body.appendChild(box);
  try {
    for (const size of ["100%", "200%"]) {
      root.style.fontSize = size;
      const card = box.querySelector(".r-freq"), cr = card.getBoundingClientRect();
      ok(card.scrollWidth <= card.clientWidth + 1, `${size}: no sideways scroll (${card.scrollWidth} > ${card.clientWidth})`);
      for (const el of card.querySelectorAll(".r-fk, .r-fw, .r-fnote")) {
        const r = el.getBoundingClientRect();
        ok(r.right <= cr.right + 0.5 && r.left >= cr.left - 0.5, `${size}: "${el.textContent}" inside the card`);
      }
      eq(getComputedStyle(card.querySelector(".r-fw")).fontVariantNumeric, "tabular-nums", "tabular times");
    }
  } finally { root.style.fontSize = was; box.remove(); }
});

test("route page: Schedule by hour on real data (service.json + stops.json)", async () => {
  const [svc, stops] = await Promise.all(["service", "stops"].map(async (f) => (await fetch(`../data/${f}.json`, { cache: "no-store" })).json()));
  const s = fixture({ service: svc, stops });
  let shown = 0;
  for (const rid of Object.keys(svc.routes)) {
    const h = renderService(s, rid, WED_10AM);
    if (!h.includes("r-freq")) continue;
    shown++;
    const r = rows(h);
    ok(r.length > 0 && r.every((x) => /^(About every|Every) \d+ min$|^\d trips?$|^No service$/.test(x.k) && (/\d:\d\d/.test(x.w) || /^(Next service \w+day)?$/.test(x.w))), rid + " " + JSON.stringify(r));
    if (svc.routes[rid].at) ok(text(h).includes(`times at ${stops[svc.routes[rid].at].name}.`), rid + " names its stop");
  }
  ok(shown > 0, "some routes show Schedule by hour");
});

// ---- All times by hour (owner 2026-11-09: "expandable to show exactly what time of day the bus can be expected. The table
// should highlight the current time. It can break it down between the weekday and weekend.")
const WED_1005 = utc("2026-10-14T15:05:00Z"), WED_1930 = utc("2026-10-15T00:30:00Z");
const dom = (h) => { const b = document.createElement("div"); b.innerHTML = h; return b; };
const opened = (over = {}) => svcState({ freq: { rid: "R1", open: true, tab: null }, ...over });

test("times table: collapsed by default, a 44 px Show all times button with aria-expanded; opened, the table by hour", () => {
  let b = dom(renderService(svcState(), "R1", WED_1005));
  let btn = b.querySelector(".r-fmore");
  eq([btn.textContent.trim(), btn.getAttribute("aria-expanded"), btn.hasAttribute("aria-controls"), !!b.querySelector("#r-ftimes")], ["Show all times", "false", false, false]);
  eq(btn.dataset.action, "route:freqopen");
  b = dom(renderService(opened(), "R1", WED_1005));
  btn = b.querySelector(".r-fmore");
  eq([btn.textContent.trim(), btn.getAttribute("aria-expanded"), btn.getAttribute("aria-controls")], ["Hide times", "true", "r-ftimes"]);
  const rows = [...b.querySelectorAll("#r-ftimes tbody tr")];
  eq(rows.map((r) => r.querySelector("th [aria-hidden]").textContent), ["7 AM", "8 AM", "9 AM", "10 AM", "11 AM", "12 PM", "1 PM", "2 PM", "3 PM", "4 PM", "5 PM", "6 PM", "7 PM"]);
  eq(rows[1].querySelector(".r-tms").textContent, ":00:15:30:45", "minutes after the hour");
  ok(b.querySelector("#r-ftimes caption").textContent.includes("Scheduled times at Library, by hour"), "the table names its stop");
  ok(b.querySelector(".r-fnote") && b.querySelector(".r-fnote").compareDocumentPosition(b.querySelector("#r-ftimes")) & Node.DOCUMENT_POSITION_PRECEDING, "the disclaimer stays, under the table");
  eq(renderService(svcState({ freq: { rid: "R2", open: true } }), "R1", WED_1005).includes("r-ftimes"), false, "another route's open state does not apply");
});

test("times table: today's tab marks the current hour (Now) and the next bus (Next), in words for screen readers too", () => {
  const b = dom(renderService(opened(), "R1", WED_1005));   // Wed 10:05 AM: buses 10:00, 10:15, 10:30
  const now = b.querySelectorAll("#r-ftimes tr.is-now");
  eq(now.length, 1);
  eq([now[0].querySelector("th .v-sr").textContent, now[0].querySelector(".r-tnow").textContent], ["10 AM, now", "Now"]);
  eq(now[0].querySelector("td .v-sr").textContent, "10:00 AM, 10:15 AM, next, 10:30 AM");
  const next = b.querySelectorAll("#r-ftimes .r-tm.is-next");
  eq([next.length, next[0].textContent], [1, ":15Next"], "one Next, outlined and labeled");
  eq(b.querySelector(".r-fnext").textContent, "Next scheduled bus 10:15 AM");
  const late = dom(renderService(opened(), "R1", WED_1930));   // 7:30 PM: the 7:00 PM bus was the last
  eq([late.querySelector(".r-fnext").textContent, late.querySelectorAll(".r-tm.is-next").length], ["No more scheduled buses today.", 0]);
  eq(late.querySelector("tr.is-now th .v-sr").textContent, "7 PM, now");
});

test("times table: after midnight a night route's 12 AM row is on the evening's service day, marked now", () => {
  const s = svcState({ routeId: "N", freq: { rid: "N", open: true } });
  const b = dom(renderService(s, "N", utc("2026-10-08T05:10:00Z")));   // Thu 12:10 AM CDT
  ok(b.querySelector("#r-freq-h").textContent === "Schedule by hour, Wednesday", b.querySelector("#r-freq-h").textContent);
  const hours = [...b.querySelectorAll("#r-ftimes th [aria-hidden]")].map((x) => x.textContent);
  eq([hours[0], hours[7], hours[8], hours[hours.length - 1]], ["4 PM", "11 PM", "12 AM", "4 AM"]);
  eq(b.querySelector("tr.is-now th .v-sr").textContent, "12 AM, now");
  eq(b.querySelector(".r-fnext").textContent, "Next scheduled bus 12:30 AM");
});

test("times table: the highlight is today's only; other tabs and days without service", () => {
  const svc = withAt(serviceFixture(), "R1", "S2");
  svc.routes.R1.days.sat = { ...svc.routes.R1.days.mon, dep: [600, 60, 60, 60] };   // Saturdays 10 AM to 1 PM, hourly
  const s = svcState({ service: svc, freq: { rid: "R1", open: true, tab: "sat" } });
  const b = dom(renderService(s, "R1", WED_1005));
  eq([...b.querySelectorAll(".seg button")].map((x) => [x.textContent, x.getAttribute("aria-pressed")]), [["Weekday", "false"], ["Saturday", "true"], ["Sunday", "false"]]);
  eq(b.querySelector("#r-freq-h").textContent, "Schedule by hour, Saturdays");
  eq([b.querySelectorAll("tr.is-now").length, b.querySelectorAll(".is-next").length, !!b.querySelector(".r-fnext")], [0, 0, false], "no Now / Next on another day");
  eq([...b.querySelectorAll("#r-ftimes th [aria-hidden]")].map((x) => x.textContent), ["10 AM", "11 AM", "12 PM", "1 PM"]);
  const sun = dom(renderService(svcState({ service: svc, freq: { rid: "R1", open: true, tab: "sun" } }), "R1", WED_1005));
  eq([sun.querySelector(".r-frow").textContent.includes("No service"), sun.querySelector(".r-frow .r-fw").textContent, !!sun.querySelector(".r-fmore")], [true, "Next service Monday", false], "no service: the next day with service, nothing to open");
  const we = dom(renderService(svcState({ freq: { rid: "R1", tab: "sat-sun" } }), "R1", WED_1005));
  eq([we.querySelector("#r-freq-h").textContent, [...we.querySelectorAll(".seg button")].map((x) => x.textContent)], ["Schedule by hour, weekends", ["Weekday", "Weekend"]], "Saturday and Sunday alike: one Weekend tab");
});

test("times table: calendar changes, today's tab says so", () => {
  const extra = dom(renderService(svcState(), "D", utc("2026-10-10T15:00:00Z")));
  eq([extra.querySelector(".seg button[aria-pressed=true]").textContent, extra.querySelector(".r-fday").textContent], ["Weekend", "Extra service today"]);
  eq(extra.querySelector(".r-fk").textContent, "Every 20 min");
  const hol = dom(renderService(svcState(), "D", utc("2026-11-26T16:00:00Z")));
  eq([hol.querySelector(".seg button[aria-pressed=true]").textContent, hol.querySelector(".r-fday").textContent], ["Weekday", "Holiday schedule today: no service"]);
});

test("times table: 320 px at 200% text, rows and the button fit; the button is at least 44 px tall", () => {
  const root = document.documentElement, was = root.style.fontSize;
  const box = document.createElement("div");
  box.style.cssText = "position:absolute;left:-10000px;top:0;width:288px";
  box.innerHTML = renderService(opened(), "R1", WED_1005);
  document.body.appendChild(box);
  try {
    for (const size of ["100%", "200%"]) {
      root.style.fontSize = size;
      const card = box.querySelector(".r-freq"), cr = card.getBoundingClientRect();
      ok(card.scrollWidth <= card.clientWidth + 1, `${size}: no sideways scroll`);
      for (const el of card.querySelectorAll(".r-ftab th, .r-tm, .seg button")) {
        const r = el.getBoundingClientRect();
        ok(r.right <= cr.right + 0.5 && r.left >= cr.left - 0.5, `${size}: "${el.textContent}" inside the card`);
      }
      ok(box.querySelector(".r-fmore").getBoundingClientRect().height >= 44, `${size}: 44 px button`);
    }
  } finally { root.style.fontSize = was; box.remove(); }
});
