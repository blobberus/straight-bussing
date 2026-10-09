/**
 * @module ui/contextbar
 * Map context bar (SHELL): a small floating bar under the status pill that says why the map shows
 * fewer routes than usual, with a one-tap way out.
 *   journey set          -> "Only showing routes for: <label>" + route chips + "Show all" (journey:end)
 *   custom route applied -> "My route: <name>" + "Clear" (custom:clear)
 * Registers the global actions `journey:end` and `custom:clear`; they work from any button in the
 * app (sheet content, dialogs, this bar) because actions are looked up by name at tap time.
 * Text too long for the bar scrolls like a song title in Apple Music (startMarquee): it rests at the
 * start, glides left until a copy of the text sits where it began, rests again. Off with reduced motion.
 */
import { registerAction } from "./actions.js";
import { esc } from "../core/esc.js";
import { activeCustomRoute } from "../core/visibility.js";
import { clearCustom } from "../core/custom.js";
import { routeChip } from "./components.js";

const MAX_CHIPS = 4;
/** Marquee timing: rest at the start (ms), then glide at pxPerS until the copy lands where the text began. */
export const MARQUEE = { restMs: 3500, pxPerS: 32 };
const reducedMotion = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } };
/** The scrolling text of the bar: a viewport (.ctx-text) around a run that holds the text (and its copy while scrolling). */
const textHTML = (k, v) => `<span class="ctx-text"><span class="ctx-run"><span class="ctx-track"><span class="ctx-k">${k}</span> <span class="ctx-v">${esc(v)}</span></span></span></span>`;

/**
 * Inner HTML of the context bar for a state ('' = hide the bar).
 * @param {object} state store state
 * @returns {string}
 */
export function contextBarHTML(state) {
  const j = state && state.journey;
  if (j && Array.isArray(j.rids) && j.rids.length) {
    const rids = j.rids.filter((r) => state.routes && state.routes[r]);
    const chips = rids.slice(0, MAX_CHIPS).map((r) => routeChip(r, state.routes, { small: true })).join("")
      + (rids.length > MAX_CHIPS ? `<span class="ctx-more">+${rids.length - MAX_CHIPS}</span>` : "");
    return textHTML("Only showing routes for:", j.label || "your trip")
      + (chips ? `<span class="ctx-chips">${chips}</span>` : "")
      + '<button type="button" class="ctx-btn" data-action="journey:end">Show all</button>';
  }
  const c = activeCustomRoute(state || {});
  if (c) {
    return textHTML("My route:", c.name)
      + `<button type="button" class="ctx-btn" data-action="custom:clear" aria-label="Clear my route ${esc(c.name)}">Clear</button>`;
  }
  return "";
}

/**
 * Store patch that ends a journey (station journeys also drop their station filter).
 * @param {object} state
 * @returns {object}
 */
export function endJourneyPatch(state) {
  const j = state && state.journey;
  const patch = { journey: null };
  if (j && j.kind === "station") patch.routeFilter = null;
  return patch;
}

/**
 * Register journey:end / custom:clear. Safe to call more than once (later call replaces).
 * @returns {void}
 */
export function registerContextActions() {
  registerAction("journey:end", (ds, ev, ctx) => {
    ctx.store.set(endJourneyPatch(ctx.store.get()));
  });
  registerAction("custom:clear", (ds, ev, ctx) => {
    const p = clearCustom(ctx.store.get());
    if (Object.keys(p).length) ctx.store.set(p);
  });
}

/**
 * Scroll the bar's text when it does not fit: rest at the start, glide left until an aria-hidden copy of
 * the text sits exactly where the text began (so the loop restarts seamlessly), repeat. Text that fits,
 * a hidden bar and reduced motion stay still (ellipsis). Safe to call again: it rebuilds from scratch.
 * @param {HTMLElement|null} el the bar
 * @param {{reduced?:()=>boolean}} [opts] reduced: prefers-reduced-motion check (injectable for tests)
 * @returns {Animation|null} the running animation, or null when the text stays still
 */
export function startMarquee(el, { reduced = reducedMotion } = {}) {
  const box = el && el.querySelector(".ctx-text"), run = box && box.querySelector(".ctx-run");
  const track = run && run.querySelector(".ctx-track");
  if (!track) return null;
  for (const a of run.getAnimations ? run.getAnimations() : []) a.cancel();
  for (const n of run.querySelectorAll(".ctx-copy")) n.remove();
  box.classList.remove("is-marquee");
  const w = track.getBoundingClientRect().width;
  if (!(box.clientWidth > 0) || w - box.clientWidth <= 1 || reduced() || typeof run.animate !== "function") return null;
  const copy = track.cloneNode(true);
  copy.classList.add("ctx-copy");
  copy.setAttribute("aria-hidden", "true");
  run.appendChild(copy);
  box.classList.add("is-marquee");
  const d = copy.getBoundingClientRect().left - track.getBoundingClientRect().left;   // text + gap
  const total = MARQUEE.restMs + (d / MARQUEE.pxPerS) * 1000;
  return run.animate([
    { transform: "translate3d(0,0,0)" },
    { transform: "translate3d(0,0,0)", offset: MARQUEE.restMs / total, easing: "ease-in-out" },
    { transform: `translate3d(${-d}px,0,0)` },
  ], { duration: total, iterations: Infinity });
}

/**
 * Keep the bar element in sync with the store (patch only when the markup changes) and keep its text
 * scrolling when it does not fit (re-measured when the bar is drawn or resized; a mouse hover pauses it).
 * @param {HTMLElement|null} el
 * @param {{get():object, subscribe(fn):()=>void}} store
 * @param {{reduced?:()=>boolean}} [opts] passed to startMarquee
 * @returns {() => void} unsubscribe
 */
export function mountContextBar(el, store, opts = {}) {
  if (!el || !store) return () => {};
  let last = null, anim = null, raf = 0, width = -1;
  const marquee = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { anim = startMarquee(el, opts); }); };
  const draw = (s) => {
    const html = contextBarHTML(s);
    if (html === last) return;
    last = html;
    if (anim) { anim.cancel(); anim = null; }
    el.innerHTML = html;
    el.hidden = !html;
    if (html) marquee();
  };
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => {
    const w = el.clientWidth;
    if (w !== width) { width = w; if (!el.hidden) marquee(); }
  }) : null;
  ro?.observe(el);
  const hover = (on) => (e) => { if (e.pointerType === "mouse" && anim) { if (on) anim.pause(); else anim.play(); } };
  const enter = hover(true), leave = hover(false);
  el.addEventListener("pointerenter", enter);
  el.addEventListener("pointerleave", leave);
  draw(store.get());
  const off = store.subscribe((s, changed) => {
    if (!changed || ["journey", "activeCustom", "customRoutes", "routes"].some((k) => changed.has(k))) draw(s);
  });
  return () => {
    off();
    ro?.disconnect();
    cancelAnimationFrame(raf);
    if (anim) anim.cancel();
    el.removeEventListener("pointerenter", enter);
    el.removeEventListener("pointerleave", leave);
  };
}
