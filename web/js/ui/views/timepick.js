/**
 * @module ui/views/timepick
 * Lines by Time (owner 2026-10-18): the clock button next to the gear in the search bar opens a menu built like
 * Settings (ui/settings-overlay.js: same card, scrim, back / Escape / scrim tap close it) with Cancel and Set time in
 * its head. Inside, top to bottom: a date (month and day, no year) and a time (hour, minute, AM / PM) on wheel columns
 * like the iPhone's alarm clock (ui/wheel.js), the owner's sentence under the clock, a live line saying how many lines
 * the timetable has running then (with their chips), the disclaimer, and the official service link at the very bottom.
 * Defaults: the time already applied, else now (Chicago).
 *
 * Set time shows only those lines on the map as a temporary custom route named "Lines active at <time>"
 * (core/custom.js applyTimeView: not saved, not in My Routes; the context bar and the Routes list say its name, with
 * Clear). Deselecting (or adding) a line drops the name and keeps the lines shown, like an edited custom route
 * (settleTimeView, wired in main.js). No line scheduled: an on-screen message, the map does not change. A trip in
 * progress decides the map, so the menu says Set time ends it. The schedule logic is core/timeactive.js.
 */
import { registerAction } from "../actions.js";
import { esc } from "../../core/esc.js";
import { nowS } from "../../core/time.js";
import {
  TIME_TITLE, TIME_DESC, TIME_DISCLAIMER, TIME_NONE, MONTHS_LONG,
  pickerValues, pickedUnix, pickerDays, linesActiveAt, timeLabel, timeName,
} from "../../core/timeactive.js";
import { applyTimeView } from "../../core/custom.js";
import { routeChip } from "../components.js";
import { OFFICIAL_HTML } from "./pick.js";
import { openSettingsOverlay, closeSettingsOverlay, isSettingsOpen, overlayKind } from "../settings-overlay.js";
import { wheelHTML, attachWheel } from "../wheel.js";

/** data-kind of the overlay while it shows this menu. */
export const TIME_KIND = "time";
const pad2 = (n) => String(n).padStart(2, "0");
const HOURS = Array.from({ length: 12 }, (_, i) => ({ text: String(i + 1) }));
const MINUTES = Array.from({ length: 60 }, (_, i) => ({ text: pad2(i), say: String(i) }));
const AMPM = [{ text: "AM" }, { text: "PM" }];
const MONTH_ITEMS = MONTHS_LONG.map((m) => ({ text: m }));
const dayItems = (m) => Array.from({ length: pickerDays(m) }, (_, i) => ({ text: String(i + 1) }));

/** Values while the menu is open: {month, day, hour12, minute, pm}. */
let V = null, live = null;

const nowOf = (ctx) => (ctx && typeof ctx.now === "function" ? ctx.now() : nowS());

/**
 * The live line under the description: what Set time would show.
 * @param {object} state
 * @param {number} at unix seconds
 * @returns {string}
 */
export function resultHTML(state, at) {
  const r = linesActiveAt(state.service, state.routes, at);
  if (!r.known) return '<span class="tp-msg">The timetable is still loading.</span>';
  const when = esc(timeLabel(at));
  if (!r.rids.length) return `<span class="tp-msg tp-msg--none" data-tp-none>${esc(TIME_NONE)}</span> <span class="tp-when">${when}</span>`;
  const n = r.rids.length;
  const chips = r.rids.map((rid) => routeChip(rid, state.routes, { small: true })).join("");
  return `<span class="tp-msg"><strong>${n} line${n === 1 ? "" : "s"}</strong> scheduled at ${when}</span>`
    + `<span class="tp-chips">${chips}</span>`
    + (r.note ? `<span class="tp-note">${esc(r.note)}</span>` : "");
}

/**
 * Menu body.
 * @param {object} state
 * @param {{month:number, day:number, hour12:number, minute:number, pm:boolean}} v picker values
 * @param {number} now unix seconds
 * @returns {string}
 */
export function renderTimePick(state, v, now) {
  const trip = state.journey && state.journey.kind === "plan";
  return '<div class="tp">'
    + '<h3 class="v-h tp-h" id="tpDateH">Date</h3>'
    + '<div class="wh wh--date" role="group" aria-labelledby="tpDateH"><span class="wh-band" aria-hidden="true"></span>'
    + wheelHTML({ id: "tpMonth", label: "Month", items: MONTH_ITEMS, index: v.month - 1, cls: "wh-col--month" })
    + wheelHTML({ id: "tpDay", label: "Day", items: dayItems(v.month), index: v.day - 1 })
    + "</div>"
    + '<h3 class="v-h tp-h" id="tpTimeH">Time</h3>'
    + '<div class="wh wh--time" role="group" aria-labelledby="tpTimeH"><span class="wh-band" aria-hidden="true"></span>'
    + wheelHTML({ id: "tpHour", label: "Hour", items: HOURS, index: v.hour12 - 1 })
    + '<span class="wh-colon" aria-hidden="true">:</span>'
    + wheelHTML({ id: "tpMinute", label: "Minute", items: MINUTES, index: v.minute })
    + wheelHTML({ id: "tpAmpm", label: "AM or PM", items: AMPM, index: v.pm ? 1 : 0, cls: "wh-col--ampm" })
    + "</div>"
    + `<p class="tp-desc">${esc(TIME_DESC)}</p>`
    + `<p class="tp-result" data-region="tp-result" role="status" aria-live="polite">${resultHTML(state, pickedUnix(v, now))}</p>`
    + (trip ? '<p class="v-fine tp-trip">A trip is in progress. Set time ends it, so the map can show these lines.</p>' : "")
    + `<section class="tp-disc" aria-labelledby="tpDiscH"><h3 class="v-h" id="tpDiscH">Timetable estimate</h3><p class="v-fine">${esc(TIME_DISCLAIMER)}</p></section>`
    + OFFICIAL_HTML
    + "</div>";
}

/** Defaults: the time already applied, else now. */
function defaults(state, now) {
  return pickerValues(state.timeView && state.timeView.at ? state.timeView.at : now);
}

/**
 * Apply the picked time. None scheduled: an on-screen message and the map stays as it is.
 * @param {object} ctx app ctx
 * @param {{month:number, day:number, hour12:number, minute:number, pm:boolean}} [v] default: the open menu's values
 * @returns {{ok:boolean, rids:string[], at:number, message:string}}
 */
export function setTime(ctx, v = V) {
  const s = ctx.store.get(), now = nowOf(ctx), vals = v || defaults(s, now);
  const at = pickedUnix(vals, now), r = linesActiveAt(s.service, s.routes, at);
  if (!r.known) {
    const message = "The timetable has not loaded yet. Try again in a moment.";
    ctx.toast?.(message);
    return { ok: false, rids: [], at, message };
  }
  const patch = r.rids.length ? applyTimeView(s, { at, name: timeName(at), rids: r.rids }) : {};
  if (!Object.keys(patch).length) {
    ctx.toast?.(TIME_NONE);
    return { ok: false, rids: [], at, message: TIME_NONE };
  }
  ctx.store.set(patch);
  const n = patch.timeView.rids.length, message = `Showing ${n} line${n === 1 ? "" : "s"} active at ${timeLabel(at)}`;
  if (isSettingsOpen() && overlayKind() === TIME_KIND) closeSettingsOverlay();
  ctx.toast?.(message);
  return { ok: true, rids: patch.timeView.rids, at, message };
}

/** Mount the wheels; every change re-reads the result line. */
function mountTimePick(root, ctx) {
  const wheels = {};
  const update = () => {
    const s = ctx.store.get(), out = root.querySelector('[data-region="tp-result"]');
    if (out) out.innerHTML = resultHTML(s, pickedUnix(V, nowOf(ctx)));
  };
  const col = (id) => root.querySelector(`#${id}`);
  wheels.month = attachWheel(col("tpMonth"), { items: MONTH_ITEMS, index: V.month - 1, onChange: (i) => {
    V.month = i + 1;
    const days = dayItems(V.month);
    V.day = Math.min(V.day, days.length);
    wheels.day.setItems(days, V.day - 1);
    update();
  } });
  wheels.day = attachWheel(col("tpDay"), { items: dayItems(V.month), index: V.day - 1, onChange: (i) => { V.day = i + 1; update(); } });
  wheels.hour = attachWheel(col("tpHour"), { items: HOURS, index: V.hour12 - 1, onChange: (i) => { V.hour12 = i + 1; update(); } });
  wheels.minute = attachWheel(col("tpMinute"), { items: MINUTES, index: V.minute, onChange: (i) => { V.minute = i; update(); } });
  wheels.ampm = attachWheel(col("tpAmpm"), { items: AMPM, index: V.pm ? 1 : 0, onChange: (i) => { V.pm = i === 1; update(); } });
  const sync = () => Object.values(wheels).forEach((w) => w.sync());
  const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (f) => setTimeout(f, 0);
  raf(() => raf(sync));               // the overlay is shown right after mount: scroll the wheels once they can
  const off = ctx.store.subscribe?.((s, ch) => { if (!ch || ["service", "routes", "staticLoaded"].some((k) => ch.has(k))) update(); });
  live = { root, ctx, wheels, update, off };
}

function unmountTimePick() {
  if (!live) return;
  Object.values(live.wheels).forEach((w) => w.detach());
  live.off?.();
  live = null;
}

/** Content adapter for ui/settings-overlay.js. */
export const TIME_CONTENT = Object.freeze({
  render: (state) => renderTimePick(state, V, nowS()),
  mount: (root, ctx) => mountTimePick(root, ctx),
  unmount: () => unmountTimePick(),
  refresh: () => live?.update(),
});

/**
 * Open Lines by Time.
 * @param {object} ctx app ctx
 * @param {HTMLElement} [trigger] gets focus back on close (default: the clock button)
 * @returns {HTMLElement} the overlay root
 */
export function openTimePick(ctx, trigger) {
  V = defaults(ctx.store.get(), nowOf(ctx));
  const btn = document.getElementById("timeBtn");
  const content = { ...TIME_CONTENT, render: (state) => renderTimePick(state, V, nowOf(ctx)) };
  return openSettingsOverlay(ctx, content, {
    trigger: trigger || btn || undefined, opener: btn, title: TIME_TITLE, kind: TIME_KIND,
    start: { label: "Cancel", onClick: () => closeSettingsOverlay() },
    end: { label: "Set time", onClick: () => setTime(ctx) },
  });
}

/** Current picker values (tests). */
export const pickerState = () => (V ? { ...V } : null);

// The clock button toggles the menu (Settings open: the clock swaps it for this menu).
registerAction("time:open", (ds, ev, ctx) => {
  if (isSettingsOpen()) {
    const mine = overlayKind() === TIME_KIND;
    closeSettingsOverlay({ focus: "none" });
    if (mine) return;
  }
  openTimePick(ctx, ev?.target?.closest?.("[data-action]") || undefined);
});
