// ui/views/bus.js (bus.test.html): the bus menu as it renders (owner 2026-11-20: "click a particular bus on the map which
// will show its next stop, line, and schedule ... at the bottom should be report and feedback ... for now gray this
// button out").
import { test, eq, ok } from "./lib.js";
import { renderBus, busSubtitle, busMetaHTML, busTitle, reportHTML, busModel, _resetBusMenu } from "../js/ui/views/bus.js";
import { BUS_MENU } from "../js/core/busmenu.js";
import { TRANSITION_TEXT } from "../js/core/seen.js";
import { PICK_HOLD_S } from "../js/core/busnum.js";
import { bindActions } from "../js/ui/actions.js";
import { fixture, makeCtx, NOW, root, tick } from "./views-fixtures.js";
import { serviceFixture } from "./route-fixtures.js";

const tu = (id, rid, vid, label, list) => ({ trip: { trip_id: id, route_id: rid }, vehicle: { id: vid, label }, stop_time_update: list.map(([st, dt]) => ({ stop_id: st, arrival: { time: NOW + dt } })) });
/** Bus v1 (label 101) on R1 heading to Library (S2), its trip predicting Library +5 min and Hospital +10 min. */
const state = (over = {}) => {
  const s = fixture({ view: "bus", routeId: "R1", busMenu: "v1" });
  s.buses = s.buses.map((b) => (b.vehicle.id === "v1" ? { ...b, stop_id: "S2" } : b));
  s.trips = [tu("t1", "R1", "v1", "101", [["S2", 300], ["S3", 600]]), tu("t2", "R2", "v2", "202", [["S3", 30], ["S2", 240], ["S4", 900]])];
  s.service = serviceFixture();   // R1: weekdays 7:00 AM to 7:25 PM
  return { ...s, ...over };
};
const dom = (h) => { const d = document.createElement("div"); d.innerHTML = h; return d; };
const txt = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");
const fresh = (fn) => () => { _resetBusMenu(); return fn(); };

test("bus view: header = the line's name, its badge and the bus; collapsed it also says where the bus heads and when", fresh(() => {
  const s = state();
  eq(busTitle(s), "Red Line");
  const meta = dom(busMetaHTML(s, { detent: "peek" }, NOW));
  ok(meta.querySelector(".chip") && txt(meta.querySelector(".chip")) === "R1", "the route badge (color chip)");
  eq(txt(meta.querySelector(".hm-bus")), "Bus 101");
  eq(txt(meta.querySelector(".bm-hmeta")), "5 min", "collapsed: the next stop's time");
  eq(meta.querySelector(".hm").getAttribute("aria-label"), "Red Line, Bus 101, Library in 5 minutes");
  ok(!dom(busMetaHTML(s, { detent: "half" }, NOW)).querySelector(".bm-hmeta"), "open: the card below says it");
  eq(busSubtitle(s, { detent: "peek" }, NOW), "Heading to Library");
  eq(busSubtitle(s, { detent: "full" }, NOW), "", "no second line while open");
}));

test("bus view: the status card says where the bus heads, its live time and label; one sentence for screen readers", fresh(() => {
  const d = dom(renderBus(state(), NOW));
  const card = d.querySelector(".bm-now");
  ok(card, "status card");
  eq(txt(card.querySelector(".bm-k")), "Heading to");
  eq(txt(card.querySelector(".bm-stop")), "Library");
  eq(txt(card.querySelector(".bm-eta")), "5 min");
  ok(/Live/.test(txt(card.querySelector(".bm-src"))), "the live label (words, not color alone)");
  eq(card.getAttribute("aria-label"), "Bus 101, heading to Library, in 5 minutes, live");
}));

test("bus view: Next stops = one lap of stop buttons with times; the first is marked Next; est. under estimated times", fresh(() => {
  const times = () => [{ stopId: "S2", idx: 1, t: NOW + 300, kind: "live" }, { stopId: "S3", idx: 2, t: NOW + 540, kind: "est" }];
  const d = dom(renderBus(state(), NOW, { times }));
  eq(txt(d.querySelector("#bm-stops-h")), "Next stops");
  const rows = [...d.querySelectorAll(".bm-tl .v-tlbtn")];
  eq(rows.map((b) => txt(b.querySelector(".v-prim"))), ["Library", "Hospital"]);
  ok(rows.every((b) => b.dataset.action === "stop:open"), "each row opens its stop");
  eq(rows.map((b) => b.dataset.id), ["S2", "S3"]);
  ok(rows[0].querySelector(".bm-nexttag") && !rows[1].querySelector(".bm-nexttag"), "Next on the first row only");
  ok(rows[0].closest(".v-tlstop").classList.contains("has-bus"), "the filled dot: where the bus heads");
  eq(txt(rows[1].querySelector(".v-tleta")), "~9 minest.", "estimate: ~ and est.");
  eq(rows[1].getAttribute("aria-label"), "Hospital, in about 9 minutes, estimated");
  eq(rows[0].getAttribute("aria-label"), "Library, next, in 5 minutes, live");
  ok(/est\. = estimated/.test(txt(d.querySelector(".v-foot"))), "the est. footer when an estimate shows");
  const live = dom(renderBus(state(), NOW));
  ok(!/est\. = /.test(txt(live.querySelector(".v-foot"))), "no est. footer with live times only");
  eq(txt(live.querySelector(".v-foot")), BUS_MENU.live);
}));

test("bus view: Line schedule = today's hours and Scheduled now / Not scheduled now, in the route page's words", fresh(() => {
  const noon = Date.parse("2026-11-20T18:00:00Z") / 1000;   // Friday 12:00 PM Chicago
  const s = state({ feedTs: noon - 5, lastOk: noon - 5 });
  s.buses = s.buses.map((b) => ({ ...b, timestamp: noon - 5 }));
  s.trips = [tu("t1", "R1", "v1", "101", [["S2", noon - NOW + 300]])];
  const d = dom(renderBus(s, noon));
  eq(txt(d.querySelector("#bm-sched-h")), "Line schedule");
  const card = d.querySelector(".bm-sched");
  eq(txt(card.querySelector(".r-k")), "Today");
  ok(/7:00 AM to 7:25 PM/.test(txt(card)), txt(card));
  eq(txt(card.querySelector(".r-sched")), "Scheduled now");
  _resetBusMenu();
  const night = dom(renderBus(state(), NOW));   // NOW = Friday 2:00 AM Chicago
  eq(txt(night.querySelector(".bm-sched .r-sched")), "Not scheduled now");
  _resetBusMenu();
  const none = state();
  none.service = {};
  eq(txt(dom(renderBus(none, NOW)).querySelector(".bm-sched")), BUS_MENU.noSchedule);
}));

test("bus view: See the whole route opens the route page with this bus picked and frames the line", fresh(async () => {
  const ctx = makeCtx({ view: "bus", routeId: "R1", busMenu: "v1" });
  const el = root();
  bindActions(el, () => ctx);
  el.innerHTML = renderBus(state(), NOW);
  const b = el.querySelector(".bm-whole");
  eq([b.dataset.action, b.dataset.id, b.dataset.bus], ["bus:route", "R1", "v1"]);
  eq(txt(b), "See the whole route");
  b.click();
  await tick();
  eq(ctx.calls.navigate.at(-1), ["route", { routeId: "R1" }]);
  eq(ctx.store.get().busId, "v1", "the bus is picked: its own time at each station");
  eq(ctx.calls.fitTo.length, 1, "the map frames the whole line");
  el.remove();
}));

test("bus view: Report and feedback is the very last thing, grayed out, still read by screen readers, 44 px", fresh(() => {
  const el = root();
  el.innerHTML = renderBus(state(), NOW);
  const v = el.querySelector(".v-bus"), rep = v.lastElementChild;
  ok(rep.classList.contains("bm-report"), "at the very bottom");
  const b = rep.querySelector(".bm-reportbtn");
  eq(b.tagName, "BUTTON");
  eq(b.getAttribute("aria-disabled"), "true");
  ok(!b.disabled && !b.hasAttribute("tabindex") && !b.dataset.action, "focusable (not disabled), no action");
  eq(txt(rep.querySelector(".bm-reportnote")), "Coming soon: report a problem with this bus or send feedback.");
  eq(b.getAttribute("aria-describedby"), rep.querySelector(".bm-reportnote").id, "the reason is read with it");
  ok(/Report and feedback, not available yet/.test(txt(b)), "its spoken name says it is not available yet");
  ok(b.getBoundingClientRect().height >= 44, "44 px target: " + b.getBoundingClientRect().height);
  b.focus();
  eq(document.activeElement, b, "reachable by keyboard and screen readers");
  const cs = getComputedStyle(b);
  ok(cs.cursor === "not-allowed" && cs.opacity === "1", "grayed by color, not faded: " + cs.opacity);
  el.remove();
}));

test("bus view: with a form set, Report and feedback opens it in a new tab, prefilled with only the five details", fresh(() => {
  const s = state(), m = busModel(s, NOW);
  const h = reportHTML(m, NOW, { url: "https://docs.google.com/forms/d/e/X/viewform", entries: { line: "entry.1", bus: "entry.2", stop: "entry.3", time: "entry.4", version: "entry.5" } });
  const a = dom(h).querySelector("a.bm-reportbtn");
  ok(a && a.target === "_blank" && a.rel === "noopener", "a real link, new tab");
  const u = new URL(a.href);
  eq([u.searchParams.get("entry.1"), u.searchParams.get("entry.2"), u.searchParams.get("entry.3"), u.searchParams.get("entry.5")], ["Red Line", "Bus 101", "Library", "2.0.0"]);
  ok(/^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(u.searchParams.get("entry.4")), "Chicago time to the minute");
  eq(a.getAttribute("aria-label"), "Report and feedback, opens a Google Form in a new tab");
  ok(/Nothing is sent until you press Submit/.test(txt(dom(h).querySelector(".bm-reportnote"))), "what opening it sends");
}));

test("bus view: a bus gone from the feed for 45 s says it is no longer reporting, with See the whole route", fresh(() => {
  const s = state();
  ok(dom(renderBus(s, NOW)).querySelector(".bm-now"), "shown");
  const gone = { ...s, buses: s.buses.filter((b) => b.vehicle.id !== "v1") };
  ok(dom(renderBus(gone, NOW + 10)).querySelector(".bm-now"), "missing 10 s: still shown (the map keeps its badge too)");
  const d = dom(renderBus({ ...gone }, NOW + 10 + PICK_HOLD_S));
  eq(txt(d.querySelector(".empty b")), "This bus is no longer reporting");
  const w = d.querySelector(".bm-whole");
  ok(w && !w.dataset.bus && w.dataset.id === "R1", "See the whole route, nothing to pick");
  ok(d.querySelector(".v-bus").lastElementChild.classList.contains("bm-report"), "Report and feedback stays at the bottom");
  eq(busSubtitle({ ...gone }, { detent: "peek" }, NOW + 20 + PICK_HOLD_S), BUS_MENU.goneTitle);
}));

test("bus view: away from its route and transitioning buses say so; a transitioning bus shows no times", fresh(() => {
  const aw = dom(renderBus(state({ away: [{ vehicle: { id: "v1" }, trip: { route_id: "R1" } }] }), NOW));
  eq(txt(aw.querySelector(".empty b")), BUS_MENU.awayTitle);
  _resetBusMenu();
  const tr = dom(renderBus(state({ transitioning: ["v1"] }), NOW));
  eq(txt(tr.querySelector(".bm-trans")), TRANSITION_TEXT);
  ok(!tr.querySelector(".bm-tl") && !tr.querySelector(".bm-eta"), "no times");
  ok(tr.querySelector(".bm-whole")?.dataset.bus === "v1", "See the whole route still picks it");
}));

test("bus view: a stale feed puts ~ on live times and says so; an old report says how old", fresh(() => {
  const s = state({ feedTs: NOW - 200, lastOk: NOW - 5 });   // feed 200 s old: late
  s.buses = s.buses.map((b) => (b.vehicle.id === "v1" ? { ...b, timestamp: NOW - 130 } : b));
  const d = dom(renderBus(s, NOW));
  eq(txt(d.querySelector(".bm-eta")), "~5 min");
  ok(/Times and bus positions may be off/.test(txt(d.querySelector(".v-foot"))), txt(d.querySelector(".v-foot")));
  ok(/location from 2 min ago/.test(txt(d.querySelector(".bm-src"))), txt(d.querySelector(".bm-src")));
}));

test("bus view: names from the feed are escaped; an unknown bus or line never breaks the menu", fresh(() => {
  const s = state({ routeId: "R3", busMenu: "v4" });
  s.buses = [...s.buses, { vehicle: { id: "v4", label: "<b>x</b>" }, position: { latitude: 41.79, longitude: -87.6 }, trip: { trip_id: "t4", route_id: "R3" }, timestamp: NOW - 5, stop_id: "S1" }];
  const h = renderBus(s, NOW) + busMetaHTML(s, { detent: "peek" }, NOW);
  ok(!/<script>|<b>x<\/b>/.test(h), "escaped");
  _resetBusMenu();
  ok(dom(renderBus(state({ busMenu: "nope" }), NOW + 100)).querySelector(".empty"), "unknown bus: no longer reporting");
  eq(busTitle(state({ busMenu: "nope", routeId: "ZZ" })), "Bus");
  _resetBusMenu();
  ok(/skel/.test(renderBus(state({ staticLoaded: false }), NOW)), "loading: skeleton rows");
}));

/* ---------- the real CSS: grayed out but readable, in light and dark ---------- */
const rgba = (c) => { const m = String(c).match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
const over = (top, base) => ({ r: top.r * top.a + base.r * (1 - top.a), g: top.g * top.a + base.g * (1 - top.a), b: top.b * top.a + base.b * (1 - top.a), a: 1 });
const L = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

test("bus view CSS: the grayed-out button, its note, est. and the Next tag stay >= 4.5:1 in light and dark", fresh(async () => {
  const f = document.createElement("iframe");
  f.style.cssText = "position:absolute;left:-2000px;width:400px;height:900px";
  f.srcdoc = `<!doctype html><html><head>${["tokens", "components", "views", "route", "bus"].map((n) => `<link rel="stylesheet" href="../css/${n}.css">`).join("")}</head>`
    + `<body style="background:var(--bg-sheet);margin:0"><div class="sheet-content">${renderBus(state(), NOW, { times: () => [{ stopId: "S2", idx: 1, t: NOW + 300, kind: "live" }, { stopId: "S3", idx: 2, t: NOW + 540, kind: "est" }] })}</div></body></html>`;
  await new Promise((r) => { f.onload = () => setTimeout(r, 80); document.body.appendChild(f); });
  const win = f.contentWindow, doc = f.contentDocument, bad = [];
  for (const theme of ["light", "dark"]) {
    doc.documentElement.dataset.theme = theme;
    await new Promise((r) => setTimeout(r, 30));
    const base = rgba(win.getComputedStyle(doc.body).backgroundColor);
    const bg = (el) => { const layers = []; for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const c = rgba(win.getComputedStyle(n).backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a >= 0.999) break; } } return layers.reverse().reduce((acc, c) => over(c, acc), base); };
    for (const sel of [".bm-reportbtn", ".bm-reportnote", ".bm-kind", ".bm-nexttag", ".bm-k", ".bm-sched .r-sched", ".v-foot"]) {
      const el = doc.querySelector(sel);
      if (!el) { bad.push(`${theme} ${sel} missing`); continue; }
      const r = ratio(rgba(win.getComputedStyle(el).color), bg(el));
      if (r < 4.5) bad.push(`${theme} ${sel} ${r.toFixed(2)}`);
    }
    const btn = doc.querySelector(".bm-reportbtn"), tint = win.getComputedStyle(doc.querySelector(".bm-whole")).color;
    if (win.getComputedStyle(btn).color === tint) bad.push(`${theme}: the grayed button keeps the accent color`);
  }
  f.remove();
  eq(bad, []);
}));
