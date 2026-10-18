// ui/views/timepick.js (Lines by Time, owner 2026-10-18) on the Settings shell, ui/wheel.js, and the "Lines active at"
// temporary custom route in the context bar and the Routes list (timepick.test.html)
import { test, eq, ok } from "./lib.js";
import { makeCtx, tick, NOW } from "./views-fixtures.js";
import { bindActions } from "../js/ui/actions.js";
import { isSettingsOpen, closeSettingsOverlay, overlayKind, OVERLAY_ID } from "../js/ui/settings-overlay.js";
import { pickerState, setTime, resultHTML, TIME_KIND } from "../js/ui/views/timepick.js";
import "../js/ui/views/settings.js";
import { contextBarHTML, registerContextActions } from "../js/ui/contextbar.js";
import { topBarHTML } from "../js/ui/views/routes.js";
import { TIME_TITLE, TIME_DESC, TIME_NONE, TIME_PREFIX, chicagoUnix, timeLabel } from "../js/core/timeactive.js";
import { settleTimeView } from "../js/core/custom.js";
import { OFFICIAL_URL } from "../js/ui/components.js";
import { cleanNotify } from "../js/state.js";

registerContextActions();

const day = (spans) => ({ first: spans[0][0], last: spans[spans.length - 1][1], trips: 9, buses: Array(24).fill(1), spans });
const every = (s) => ({ mon: day(s), tue: day(s), wed: day(s), thu: day(s), fri: day(s), sat: day(s), sun: day(s) });
const weekdays = (s) => ({ mon: day(s), tue: day(s), wed: day(s), thu: day(s), fri: day(s), sat: null, sun: null });
/** R1 weekdays 7:00 AM to 7:25 PM, R2 every night 4:00 PM to 4:29 AM, R3 no timetable. NOW = Fri Jan 15 2027, 2:00 AM. */
const SERVICE = { feed: { start: "2027-01-01", end: "2027-03-01" }, routes: { R1: { days: weekdays([["07:00", "19:25"]]), exceptions: [] }, R2: { days: every([["16:00", "28:29"]]), exceptions: [] } } };

function shell(over = {}) {
  const ctx = makeCtx({ notify: cleanNotify(null), favStops: [], journey: null, service: SERVICE, customRoutes: [], activeCustom: null, prevHidden: [], timeView: null, ...over });
  const app = document.createElement("div");
  app.id = "app";
  app.innerHTML = '<div class="searchbar"><button id="timeBtn" type="button" data-action="time:open" aria-label="Lines by Time" style="width:44px;height:44px">T</button>'
    + '<button id="settingsBtn" type="button" data-action="settings:open" aria-label="Settings" style="width:44px;height:44px">G</button></div>'
    + '<section id="sheet" data-detent="half" style="position:fixed;left:0;right:0;bottom:0;height:500px">'
    + '<header id="sheetHead"><h1 id="title" tabindex="-1">Current trip</h1><nav id="tabs" style="display:flex;height:40px"></nav></header>'
    + '<div id="content">sheet content</div></section>';
  document.body.appendChild(app);
  const sheet = app.querySelector("#sheet");
  ctx.setDetent = (d) => { sheet.dataset.detent = d; };
  const offs = [bindActions(app.querySelector(".searchbar"), () => ctx)];
  const ov = () => document.getElementById(OVERLAY_ID);
  return {
    ctx, app, ov, clock: app.querySelector("#timeBtn"), gear: app.querySelector("#settingsBtn"),
    col: (id) => ov().querySelector("#" + id),
    done: () => { closeSettingsOverlay({ focus: "none" }); offs.forEach((f) => f()); app.remove(); },
  };
}
const click = (el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const key = (el, k, n = 1) => { for (let i = 0; i < n; i++) el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })); };
const txt = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");

test("the clock opens Lines by Time on the Settings card: own title, Cancel / Set time, wheels, sentence, disclaimer, official link last", async () => {
  const t = shell();
  try {
    click(t.clock);
    const o = t.ov();
    ok(o && !o.hidden && isSettingsOpen() && overlayKind() === TIME_KIND, "menu open");
    eq([o.getAttribute("role"), o.getAttribute("aria-modal"), o.dataset.kind], ["dialog", "true", "time"]);
    eq(txt(document.getElementById(o.getAttribute("aria-labelledby"))), TIME_TITLE);
    eq(t.clock.getAttribute("aria-expanded"), "true", "the clock says the menu is open");
    ok(t.gear.getAttribute("aria-expanded") !== "true", "the gear does not");
    const cancel = o.querySelector('[data-sto="start-btn"]'), set = o.querySelector('[data-sto="done"]');
    eq([txt(cancel), txt(set)], ["Cancel", "Set time"]);
    for (const b of [cancel, set]) { const r = b.getBoundingClientRect(); ok(r.width >= 44 && r.height >= 44, txt(b) + " is a 44px target"); }
    const cols = [...o.querySelectorAll('[role="spinbutton"]')];
    eq(cols.map((c) => c.getAttribute("aria-label")), ["Month", "Day", "Hour", "Minute", "AM or PM"]);
    eq(cols.map((c) => c.getAttribute("aria-valuetext")), ["January", "15", "2", "0", "AM"], "defaults: now in Chicago (Fri Jan 15, 2:00 AM)");
    ok(cols.every((c) => c.tabIndex === 0), "every column takes keyboard focus");
    const date = o.querySelector(".wh--date"), time = o.querySelector(".wh--time");
    ok(date.compareDocumentPosition(time) & Node.DOCUMENT_POSITION_FOLLOWING, "the date is above the time");
    eq(txt(o.querySelector(".tp-desc")), TIME_DESC, "the owner's sentence");
    ok(time.compareDocumentPosition(o.querySelector(".tp-desc")) & Node.DOCUMENT_POSITION_FOLLOWING, "under the clock");
    ok(/holidays/.test(txt(o.querySelector(".tp-disc"))) && /unofficial/.test(txt(o.querySelector(".tp-disc"))), "disclaimer");
    const body = o.querySelector(".tp"), last = body.lastElementChild;
    ok(last.querySelector(`a[href="${OFFICIAL_URL}"]`) && /773\.702\.8181/.test(txt(last)), "official link at the very bottom");
    ok(/1 line/.test(txt(o.querySelector('[data-region="tp-result"]'))) && o.querySelector('[data-region="tp-result"] .chip'), "R2 (Thursday night) runs at 2 AM");
    eq(t.ctx.store.get().timeView, null, "opening changes nothing");
  } finally { t.done(); }
});

test("wheels: arrow keys, Home / End and a tap move a column; the result line follows; February offers 29 days", async () => {
  const t = shell();
  try {
    click(t.clock);
    const hour = t.col("tpHour"), month = t.col("tpMonth"), ampm = t.col("tpAmpm");
    key(hour, "ArrowDown", 8);                                  // 2 -> 10 AM Friday: R1
    eq([hour.getAttribute("aria-valuenow"), hour.getAttribute("aria-valuetext"), pickerState().hour12], ["9", "10", 10]);
    ok(/1 line/.test(txt(t.ov().querySelector('[data-region="tp-result"]'))), "10 AM Friday: R1 only");
    key(ampm, "End");                                           // 10 PM: R2
    eq(pickerState().pm, true);
    key(month, "ArrowDown");                                    // February
    eq(t.col("tpDay").getAttribute("aria-valuemax"), "28", "29 days (index 0..28)");
    key(month, "ArrowUp");
    eq(t.col("tpDay").getAttribute("aria-valuemax"), "30");
    click(t.col("tpMinute").querySelector('.wh-item[data-i="45"]'));
    eq(pickerState().minute, 45, "a tap on a row picks it");
    key(t.col("tpMinute"), "PageUp");
    eq(pickerState().minute, 40);
    key(t.col("tpMinute"), "Home");
    eq(pickerState().minute, 0);
    ok(t.col("tpMinute").querySelector(".wh-item.is-sel").dataset.i === "0", "the chosen row is marked");
  } finally { t.done(); }
});

test("wheels: their own scrolling never changes the value; the rider's swipe does", async () => {
  const t = shell();
  try {
    click(t.clock);
    await tick(50);
    const hour = t.col("tpHour");
    key(hour, "ArrowDown", 8);                                  // 10, scrolling there on its own
    hour.scrollTop = 3 * 40;                                    // a frame in the middle of that animation
    hour.dispatchEvent(new Event("scroll"));
    await tick(250);
    eq(pickerState().hour12, 10, "a row in between is not the choice");
    hour.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));   // the rider takes hold and swipes to 6
    hour.scrollTop = 5 * 40;
    hour.dispatchEvent(new Event("scroll"));
    await tick(250);
    eq([pickerState().hour12, hour.getAttribute("aria-valuetext")], [6, "6"], "the rider's swipe picks the row in the band");
  } finally { t.done(); }
});

test("Set time: a temporary custom route 'Lines active at <time>', the menu closes and says so; Clear puts back the routes", async () => {
  const t = shell({ hiddenRoutes: ["R3"] });
  try {
    click(t.clock);
    key(t.col("tpHour"), "ArrowDown", 8);                       // Fri Jan 15, 10:00 AM: R1
    click(t.ov().querySelector('[data-sto="done"]'));
    const s = t.ctx.store.get(), at = chicagoUnix(2027, 1, 15, 10, 0);
    ok(s.timeView, "applied");
    eq([s.timeView.name, s.timeView.rids, s.timeView.at], [`${TIME_PREFIX} ${timeLabel(at)}`, ["R1"], at]);
    eq(s.hiddenRoutes, ["R2", "R3"]);
    ok(!isSettingsOpen(), "the menu closed");
    ok(t.ctx.calls.toast.some((x) => /Showing 1 line active at Fri Jan 15/.test(x)), t.ctx.calls.toast.join("|"));
    ok(!s.customRoutes.length, "not saved to My Routes");
    const bar = contextBarHTML(s);
    ok(bar.includes(TIME_PREFIX) && bar.includes("Fri Jan 15") && bar.includes('data-action="time:clear"'), "context bar names it");
    ok(topBarHTML(s, { naming: false }).includes(`Showing <strong class="rt-cname">${TIME_PREFIX}`), "Routes list names it");
    const box = document.createElement("div");
    box.innerHTML = bar;
    document.body.appendChild(box);
    const off = bindActions(box, () => t.ctx);
    click(box.querySelector('[data-action="time:clear"]'));
    off(); box.remove();
    eq([t.ctx.store.get().timeView, t.ctx.store.get().hiddenRoutes], [null, ["R3"]], "Clear: the routes from before");
    click(t.clock);
    eq(pickerState().hour12, 2, "after Clear the menu starts at now again");
  } finally { t.done(); }
});

test("the menu reopens at the time already set; deselecting a line drops the name and keeps the lines", async () => {
  const t = shell();
  try {
    const at = chicagoUnix(2027, 1, 15, 17, 30);                // Fri 5:30 PM: R1 and R2
    eq(setTime(t.ctx, { month: 1, day: 15, hour12: 5, minute: 30, pm: true }).rids, ["R1", "R2"]);
    click(t.clock);
    eq(pickerState(), { month: 1, day: 15, hour12: 5, minute: 30, pm: true }, "reopens at Fri 5:30 PM");
    closeSettingsOverlay({ focus: "none" });
    const s1 = t.ctx.store.get();
    eq(s1.timeView.at, at);
    t.ctx.store.set({ hiddenRoutes: [...s1.hiddenRoutes, "R2"] });   // the eye on R2 (main.js runs settleTimeView)
    t.ctx.store.set(settleTimeView(t.ctx.store.get()));
    const s2 = t.ctx.store.get();
    eq([s2.timeView, s2.hiddenRoutes], [null, ["R3", "R2"]], "name gone, R1 still the only line shown");
    ok(!contextBarHTML(s2).includes(TIME_PREFIX) && !topBarHTML(s2, { naming: false }).includes(TIME_PREFIX), "no name anywhere");
    ok(topBarHTML(s2, { naming: false }).includes("Make this a custom route"), "like an unsaved custom route");
  } finally { t.done(); }
});

test("no line scheduled: an on-screen message, the menu stays open, the map does not change", async () => {
  const t = shell();
  try {
    click(t.clock);
    key(t.col("tpDay"), "ArrowDown", 2);                       // Sun Jan 17
    key(t.col("tpHour"), "ArrowDown", 8);                      // 10 AM: nothing
    const res = t.ov().querySelector('[data-region="tp-result"]');
    ok(txt(res).includes(TIME_NONE) && res.getAttribute("aria-live") === "polite", "said in the menu as you pick: " + txt(res));
    const before = JSON.stringify(t.ctx.store.get().hiddenRoutes);
    click(t.ov().querySelector('[data-sto="done"]'));
    ok(isSettingsOpen(), "still open");
    eq(t.ctx.calls.toast.at(-1), TIME_NONE, "on-screen message");
    eq([JSON.stringify(t.ctx.store.get().hiddenRoutes), t.ctx.store.get().timeView], [before, null], "nothing changed");
    ok(resultHTML({ ...t.ctx.store.get(), service: {} }, NOW).includes("still loading"), "no timetable yet");
  } finally { t.done(); }
});

test("Cancel, Escape and the scrim close it without changes; the clock toggles; the gear swaps it for Settings", async () => {
  const t = shell();
  try {
    for (const how of ["cancel", "escape", "scrim", "clock"]) {
      click(t.clock);
      ok(isSettingsOpen() && overlayKind() === TIME_KIND, how + ": open");
      key(t.col("tpHour"), "ArrowDown", 3);
      if (how === "cancel") click(t.ov().querySelector('[data-sto="start-btn"]'));
      else if (how === "escape") document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      else if (how === "scrim") click(document.querySelector(".sto-scrim"));
      else click(t.clock);
      ok(!isSettingsOpen(), how + " closes");
      eq(t.ctx.store.get().timeView, null, how + ": nothing applied");
    }
    click(t.clock);
    click(t.gear);
    await tick();
    ok(isSettingsOpen() && overlayKind() === "settings", "the gear opens Settings instead");
    eq(txt(document.getElementById("stoTitle")), "Settings");
    ok(!t.ov().querySelector('[data-sto="start-btn"]') && txt(t.ov().querySelector('[data-sto="done"]')) === "Done", "Settings' own head");
    eq([t.clock.getAttribute("aria-expanded"), t.gear.getAttribute("aria-expanded")], ["false", "true"]);
  } finally { t.done(); }
});

test("a trip in progress: the menu says Set time ends it, and it does", async () => {
  const t = shell({ journey: { rids: ["R2"], label: "To Library", kind: "plan", legs: [] } });
  try {
    click(t.clock);
    ok(/A trip is in progress/.test(txt(t.ov())), "said before Set time");
    click(t.ov().querySelector('[data-sto="done"]'));       // 2 AM: R2
    eq([t.ctx.store.get().journey, t.ctx.store.get().timeView.rids], [null, ["R2"]]);
  } finally { t.done(); }
});
