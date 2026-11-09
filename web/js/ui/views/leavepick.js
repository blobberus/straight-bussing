/**
 * @module ui/views/leavepick
 * The trip start time picker (owner 2026-11-09: "when deciding a destination, the user should have an optional trip start
 * time"). Directions' "Leave now" control opens it (dir:when, registered by ./directions.js). Built like Lines by Time
 * (ui/settings-overlay.js: the same sheet, scrim, Escape / scrim tap / swipe down / browser back close it), with Cancel and
 * Set in its head: a day wheel (Today, Tomorrow, then the dates through the timetable's last date) above an alarm-style
 * time (hour, minute, AM / PM) from ui/wheel.js, a live line saying what Set will do, a "Leave now" button that resets,
 * and the official contact at the bottom. Starts at the chosen time, else now rounded up to 5 minutes.
 *
 * What Set does is core/timetable.js startMode: a time less than 10 minutes away plans with live times from then; a later
 * one from the timetable (the larger disclaimer comes with the options); a time already past is Leave now. Nothing is
 * stored. Opening the picker also starts loading the timetable (data/timetable.js), so the plan is quick after Set.
 */
import { esc } from "../../core/esc.js";
import { nowS } from "../../core/time.js";
import {
  LIVE_SOON_MIN, LEAVE_NOW, TT_OUTSIDE, startMode, leaveLabel, leaveDays, leaveValues, leaveUnix, leaveDefault, outsideTimetable,
} from "../../core/timetable.js";
import { loadTimetable, timetableNow } from "../../data/timetable.js";
import { OFFICIAL_HTML } from "./pick.js";
import { openSettingsOverlay, closeSettingsOverlay } from "../settings-overlay.js";
import { wheelHTML, attachWheel } from "../wheel.js";

/** data-kind of the overlay while it shows this picker. */
export const LEAVE_KIND = "leave";
export const LEAVE_TITLE = "Trip start time";
export const LEAVE_NOTE = `Up to ${LIVE_SOON_MIN} minutes from now, bus times stay live. Later times come from the timetable, and most buses run later than scheduled.`;
const pad2 = (n) => String(n).padStart(2, "0");
const HOURS = Array.from({ length: 12 }, (_, i) => ({ text: String(i + 1) }));
const MINUTES = Array.from({ length: 60 }, (_, i) => ({ text: pad2(i), say: String(i) }));
const AMPM = [{ text: "AM" }, { text: "PM" }];

/** Open picker: values {iso, hour12, minute, pm}, the day list, mounted wheels. */
let V = null, days = [], live = null;

const nowOf = (ctx) => (ctx && typeof ctx.now === "function" ? ctx.now() : nowS());
const dayIndex = (iso) => Math.max(0, days.findIndex((d) => d.iso === iso));

/**
 * What Set would do, in one sentence (the live line under the wheels).
 * @param {number} at the picked moment
 * @param {number} now
 * @param {object|null} tt the timetable when loaded
 * @returns {string}
 */
export function previewText(at, now, tt) {
  const mode = startMode(at, now);
  if (mode === "now") return at < now - 59 ? "That time has passed, so trips are planned from now. Bus times are live." : `${LEAVE_NOW}. Bus times are live.`;
  if (mode === "live") return `${leaveLabel(at, now)}. Less than ${LIVE_SOON_MIN} minutes away, so bus times stay live.`;
  return `${leaveLabel(at, now)}. Bus times will come from the timetable.` + (tt && outsideTimetable(tt, at) ? " " + TT_OUTSIDE : "");
}

/**
 * Picker body.
 * @param {{iso:string, hour12:number, minute:number, pm:boolean}} v
 * @param {Array<{iso:string, text:string, say:string}>} list the day items
 * @param {number} now
 * @returns {string}
 */
export function renderLeavePick(v, list, now) {
  const at = leaveUnix(v);
  return '<div class="tp lp">'
    + '<h3 class="v-h tp-h" id="lpDayH">Day</h3>'
    + '<div class="wh wh--day" role="group" aria-labelledby="lpDayH"><span class="wh-band" aria-hidden="true"></span>'
    + wheelHTML({ id: "lpDay", label: "Day", items: list, index: Math.max(0, list.findIndex((d) => d.iso === v.iso)), cls: "wh-col--day" })
    + "</div>"
    + '<h3 class="v-h tp-h" id="lpTimeH">Time</h3>'
    + '<div class="wh wh--time" role="group" aria-labelledby="lpTimeH"><span class="wh-band" aria-hidden="true"></span>'
    + wheelHTML({ id: "lpHour", label: "Hour", items: HOURS, index: v.hour12 - 1 })
    + '<span class="wh-colon" aria-hidden="true">:</span>'
    + wheelHTML({ id: "lpMinute", label: "Minute", items: MINUTES, index: v.minute })
    + wheelHTML({ id: "lpAmpm", label: "AM or PM", items: AMPM, index: v.pm ? 1 : 0, cls: "wh-col--ampm" })
    + "</div>"
    + `<p class="tp-result lp-result" data-region="lp-result" role="status" aria-live="polite">${esc(previewText(at, now, timetableNow()))}</p>`
    + `<p class="tp-desc">${esc(LEAVE_NOTE)}</p>`
    + `<button type="button" class="v-btn v-btn--secondary v-btn--block lp-now" data-lp="now">${esc(LEAVE_NOW)}</button>`
    + OFFICIAL_HTML
    + "</div>";
}

function mountLeavePick(root, ctx, onSet) {
  const wheels = {};
  const update = () => {
    const out = root.querySelector('[data-region="lp-result"]');
    if (out) out.textContent = previewText(leaveUnix(V), nowOf(ctx), timetableNow());
  };
  const col = (id) => root.querySelector(`#${id}`);
  wheels.day = attachWheel(col("lpDay"), { items: days, index: dayIndex(V.iso), onChange: (i) => { V.iso = days[i].iso; update(); } });
  wheels.hour = attachWheel(col("lpHour"), { items: HOURS, index: V.hour12 - 1, onChange: (i) => { V.hour12 = i + 1; update(); } });
  wheels.minute = attachWheel(col("lpMinute"), { items: MINUTES, index: V.minute, onChange: (i) => { V.minute = i; update(); } });
  wheels.ampm = attachWheel(col("lpAmpm"), { items: AMPM, index: V.pm ? 1 : 0, onChange: (i) => { V.pm = i === 1; update(); } });
  root.querySelector('[data-lp="now"]')?.addEventListener("click", () => finish(ctx, onSet, null));
  const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (f) => setTimeout(f, 0);
  raf(() => raf(() => Object.values(wheels).forEach((w) => w.sync())));
  live = { root, ctx, wheels, update };
  // the timetable's dates make the day list (a week until it loads)
  loadTimetable().then((tt) => {
    if (!live || live.root !== root || !tt) return;
    const next = leaveDays(nowOf(ctx), tt);
    if (next.length !== days.length) { days = next; wheels.day.setItems(days, dayIndex(V.iso)); }
    update();
  }).catch(() => {});
}

function unmountLeavePick() {
  if (!live) return;
  Object.values(live.wheels).forEach((w) => w.detach());
  live = null;
}

/** Close and hand the result to Directions (null = Leave now). */
function finish(ctx, onSet, at) {
  const now = nowOf(ctx), keep = Number.isFinite(at) && startMode(at, now) !== "now" ? at : null;
  closeSettingsOverlay({ focus: "none" });
  try { onSet?.(keep); } catch (e) { console.error("start time", e); }
  if (Number.isFinite(at) && keep == null) ctx.toast?.("That time has passed, so trips are planned from now.");
  return keep;
}

/**
 * Set: the picked moment (a time already past = Leave now).
 * @param {object} ctx
 * @param {(at:number|null)=>void} onSet
 * @returns {number|null}
 */
export function setLeave(ctx, onSet) {
  return finish(ctx, onSet, V ? leaveUnix(V) : null);
}

/**
 * Open the picker.
 * @param {object} ctx app ctx
 * @param {{at?:number|null, onSet:(at:number|null)=>void, trigger?:HTMLElement}} o
 * @returns {HTMLElement} the overlay root
 */
export function openLeavePick(ctx, { at = null, onSet, trigger } = {}) {
  const now = nowOf(ctx);
  V = leaveValues(leaveDefault(at, now));
  days = leaveDays(now, timetableNow());
  if (!days.some((d) => d.iso === V.iso)) V.iso = days[0].iso;
  const content = {
    render: () => renderLeavePick(V, days, nowOf(ctx)),
    mount: (root) => mountLeavePick(root, ctx, onSet),
    unmount: () => unmountLeavePick(),
    refresh: () => live?.update(),
  };
  return openSettingsOverlay(ctx, content, {
    trigger, opener: trigger || null, title: LEAVE_TITLE, kind: LEAVE_KIND,
    start: { label: "Cancel", onClick: () => closeSettingsOverlay() },
    end: { label: "Set", onClick: () => setLeave(ctx, onSet) },
  });
}

/** Current picker values (tests). */
export const leavePickState = () => (V ? { ...V, days: days.map((d) => d.iso) } : null);
