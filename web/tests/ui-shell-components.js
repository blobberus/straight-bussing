// Tests for ui/components.js and ui/theme.js (D1).
import { test, eq, ok } from "./lib.js";
import {
  routeChip, etaBlock, arrivalRow, stopRow, emptyState, skeleton, pill, segmented, estTag, icon, fmtMin, fmtDist, routeName, liveLabel,
} from "../js/ui/components.js";
import { createStore } from "../js/core/store.js";
import { initTheme, setTheme, getTheme, isDark, onChange, mount } from "../js/ui/theme.js";

const EVIL = '<img src=x onerror="alert(1)">';
const routes = {
  r1: { short: "53", long: "53rd Street", color: "#800000" },
  r2: { short: EVIL, long: EVIL, color: "red;background:url(x)" },
  r3: { short: "Y", long: "Yellow", color: "#FFEE00" },
};
const T = 1_700_000_000;
const fresh = { routes, lastOk: T - 5, failed: false, feedTs: T - 10 };

function noRawTag(html) {
  return !/<img/i.test(html) && !/onerror="/i.test(html.replace(/&quot;/g, ""));
}

test("routeChip: escapes names, sanitises color, picks text color and ring class", () => {
  const a = routeChip("r1", routes);
  ok(a.includes("background:#800000"), a);
  ok(a.includes("color:#ffffff"));
  ok(a.includes(">53<"));
  const b = routeChip("r2", routes);
  ok(noRawTag(b), b);
  ok(b.includes("background:#555555"), "bad color falls back");
  const y = routeChip("r3", routes);
  ok(/class="chip[^"]*\blt\b/.test(y), "light color gets light-theme ring class");
  ok(y.includes("color:#111114"));
  ok(routeChip("missing", routes).includes(">?<"));
});

test("etaBlock: minutes, Now in live style, ~ when stale", () => {
  const h = etaBlock(T + 4 * 60 + 30, { now: T });
  ok(h.includes('class="num">4<') && h.includes(">min<"), h);
  ok(!h.includes("~"));
  const n = etaBlock(T + 20, { now: T });
  ok(n.includes("eta now") && n.includes(">Now<"), n);
  ok(!n.includes("stale"));
  const s = etaBlock(T + 7 * 60, { now: T, stale: true });
  ok(s.includes(">~7<") && s.includes("stale"), s);
  const sn = etaBlock(T - 10, { now: T, stale: true });
  ok(sn.includes("~Now") && sn.includes("stale"), "stale Now is muted, not live: " + sn);
});

test("arrivalRow: one aria sentence, live label, escaped, stale switches label", () => {
  const a = { rid: "r1", t: T + 4 * 60, bus: "12", tripId: "t1" };
  const h = arrivalRow(a, fresh, { now: T });
  ok(h.includes('aria-label="Route 53, 53rd Street, arrives in 4 minutes, live"'), h);
  ok(h.includes("Live") && h.includes("Bus 12"));
  const evil = arrivalRow({ rid: "r2", t: T + 60, bus: EVIL }, fresh, { now: T });
  ok(noRawTag(evil), evil);
  const old = arrivalRow(a, { ...fresh, lastOk: T - 5, feedTs: T - 400 }, { now: T });
  ok(old.includes("Last known") && old.includes("~4"), old);
  const err = arrivalRow(a, { ...fresh, failed: true }, { now: T });
  ok(err.includes("Last known"));
  const btn = arrivalRow(a, fresh, { now: T, action: "route" });
  ok(btn.startsWith("<button") && btn.includes('data-action="route"') && btn.includes('data-id="r1"') && btn.includes('data-trip="t1"'));
  const now = arrivalRow({ rid: "r1", t: T + 10 }, fresh, { now: T });
  ok(now.includes("arriving now"));
});

test("liveLabel: text for every level (never color alone)", () => {
  eq(liveLabel("").text, "live");
  ok(liveLabel("late").html.includes("delayed"));
  ok(liveLabel("err").html.includes("Last known"));
});

test("stopRow: action/id, walking sub line, escaped name, chips", () => {
  const h = stopRow({ id: "s1", name: EVIL, d: 400 }, { chips: ["r1"], routes });
  ok(noRawTag(h), h);
  ok(h.includes('data-action="stop"') && h.includes('data-id="s1"'));
  ok(h.includes("5 min walk · 400 m"), h);
  ok(h.includes("chip"));
  const r = stopRow({ id: "s2", name: "A" }, { action: "pick:choose", right: "<b>", sub: "x" });
  ok(r.includes('data-action="pick:choose"') && r.includes("&lt;b&gt;") && r.includes(">x<"));
});

test("emptyState / skeleton / pill / segmented / icon", () => {
  const e = emptyState(EVIL, EVIL, { official: true });
  ok(noRawTag(e) && e.includes("773.702.8181") && e.includes("tel:+17737028181"), e);
  ok(!emptyState("t").includes("773"));
  eq((skeleton(4).match(/class="skel"/g) || []).length, 4);
  ok(skeleton().includes("Loading"));
  ok(pill("warn", EVIL).includes("pill-warn") && noRawTag(pill("warn", EVIL)));
  ok(pill("bogus", "x").includes("pill-info"));
  const seg = segmented([{ id: "a", label: "A", on: true }, { id: "b", label: EVIL, badge: 3 }], { label: "Pick", action: "x" });
  ok(seg.includes('aria-pressed="true"') && seg.includes('data-action="x"') && seg.includes(">3<") && noRawTag(seg), seg);
  ok(icon("back").startsWith("<svg") && icon("back").includes('aria-hidden="true"'));
  eq(icon("nope"), "");
});

test("estTag: four labels, unknown -> estimate", () => {
  ok(estTag("live").includes(">live<"));
  ok(estTag("schedule").includes(">schedule<"));
  ok(estTag("learned").includes(">learned<"));
  ok(estTag("estimate").includes(">estimate<"));
  ok(estTag("router").includes(">estimate<"));
  ok(estTag('"><script>').includes(">estimate<"));
});

test("formatters", () => {
  eq(fmtMin(0.4), "<1");
  eq(fmtMin(3.6), "4");
  eq(fmtMin(NaN), "?");
  eq(fmtDist(83), "80 m");
  eq(fmtDist(1234), "1.2 km");
  eq(fmtDist(undefined), "");
  eq(routeName("r1", routes), "53");
  eq(routeName("zz", routes), "?");
});

/* ---------------- theme ---------------- */
test("theme: setTheme paints data-theme, writes store, fires onChange on flips", async () => {
  const store = createStore({ theme: "auto" });
  initTheme(store);
  const seen = [];
  const off = onChange((d, m) => seen.push(d + ":" + m));
  setTheme("dark");
  eq(document.documentElement.dataset.theme, "dark");
  eq(store.get().theme, "dark");
  ok(isDark());
  setTheme("light");
  eq(document.documentElement.dataset.theme, "light");
  ok(!isDark());
  setTheme("bogus");
  eq(getTheme(), "light");
  // external store change is applied
  store.set({ theme: "dark" });
  await Promise.resolve();
  await Promise.resolve();
  eq(getTheme(), "dark");
  off();
  ok(seen.includes("true:dark") && seen.includes("false:light"), JSON.stringify(seen));
  setTheme("auto");
  ok(!("theme" in document.documentElement.dataset));
});

test("theme: mount renders a radio group and arrow keys change mode", () => {
  const store = createStore({ theme: "light" });
  initTheme(store);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const seg = mount(host);
  const btns = seg.querySelectorAll("button");
  eq(btns.length, 3);
  eq(seg.getAttribute("role"), "radiogroup");
  eq(seg.querySelector('[aria-checked="true"]').dataset.mode, "light");
  seg.querySelector('[data-mode="light"]').dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  eq(getTheme(), "dark");
  btns[0].click();
  eq(getTheme(), "auto");
  eq(seg.querySelector('[aria-checked="true"]').dataset.mode, "auto");
  host.remove();
});
