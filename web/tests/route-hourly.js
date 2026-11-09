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
  ok(hol.includes("Scheduled buses by hour, Thursdays") && hol.includes("Schedule by hour, Thursdays"), "a cancelled day: the weekday's regular timetable, named");
  const night = renderService(s, "N", utc("2026-10-08T07:00:00Z"));    // Thu 2 AM = Wednesday's night service
  ok(night.includes("Schedule by hour, Wednesday"), "after midnight: yesterday's service day by name");
  eq(rows(night).map((x) => x.say), ["Every 15 minutes, 4:00 to 11:00 PM", "Every 30 minutes, 11:00 PM to 4:00 AM"]);
  const sun = renderService(s, "R1", utc("2026-10-11T15:00:00Z"));      // a weekday route on Sunday
  ok(sun.includes("Scheduled buses by hour, Mondays") && sun.includes("Schedule by hour, Mondays"), "the first day with service");
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
    ok(r.length > 0 && r.every((x) => /^(About every|Every) \d+ min$|^\d trips?$|^No service$/.test(x.k) && /\d:\d\d/.test(x.w)), rid + " " + JSON.stringify(r));
    if (svc.routes[rid].at) ok(text(h).includes(`times at ${stops[svc.routes[rid].at].name}.`), rid + " names its stop");
  }
  ok(shown > 0, "some routes show Schedule by hour");
});
