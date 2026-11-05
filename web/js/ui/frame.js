/**
 * @module ui/frame
 * Desktop / tablet "iPhone frame" (SHELL). On windows matching FRAME_MEDIA, css/base.css draws the app
 * in a 393 x 852 CSS px phone frame; this module shrinks it uniformly (--frame-k on <html>) when the
 * window is too small to show it whole, so the page never scrolls. Phones (narrow windows) are untouched.
 * The frame keeps its layout size, so Leaflet and the sheet measure 393 x 852 at any scale; pointer
 * math that uses clientX/Y must divide by the scale (ui/sheet.js does).
 */

/** Must match the media query in css/tokens.css and css/base.css. */
export const FRAME_MEDIA = "(min-width: 521px) and (min-height: 560px)";
/** Logical iPhone 15/16 size in CSS px. */
export const FRAME_W = 393, FRAME_H = 852;
/** Space kept around the frame (bezel + breathing room), px. */
export const FRAME_MARGIN = 28;

/**
 * Uniform scale that fits the frame in a window (never above 1).
 * @param {number} winW
 * @param {number} winH
 * @returns {number}
 */
export function frameScale(winW, winH) {
  const k = Math.min(1, (winH - 2 * FRAME_MARGIN) / FRAME_H, (winW - 2 * FRAME_MARGIN) / FRAME_W);
  return Math.max(0.3, Math.round(k * 1000) / 1000);
}

/**
 * Is the phone frame active right now?
 * @returns {boolean}
 */
export function frameActive() {
  try { return typeof matchMedia === "function" && matchMedia(FRAME_MEDIA).matches; } catch (e) { return false; }
}

/**
 * Text-size class for a root font size (docs/DESIGN-SPEC.md 2.2): "default" under 20 px, "large" from 20 to 27 px (iOS
 * xLarge to xxxLarge), "ax" from 28 px (iOS accessibility sizes). Layout switches read html[data-text].
 * @param {number} px computed root font size
 * @returns {'default'|'large'|'ax'}
 */
export function textClass(px) {
  const n = Number(px) || 17;
  return n >= 28 ? "ax" : n >= 20 ? "large" : "default";
}

/**
 * Keep html[data-text] in step with the root font size: on resize, on return to the page (iOS Dynamic Type changes
 * while Safari is in the background) and whenever a 1rem probe changes size (browser text size, zoom). Safe to call once.
 * The first reading comes from the probe's ResizeObserver in the first frame (before the first paint, so no layout jump),
 * never synchronously at boot: reading a computed style there would force a style pass of the whole page before the app
 * has built it (about 12 ms of main-thread time at load with a 4x slower CPU, measured in headless Edge).
 * @param {HTMLElement} [root] default <html>
 * @returns {() => void} stop
 */
export function initTextSize(root = document.documentElement) {
  const apply = () => {
    const c = textClass(parseFloat(getComputedStyle(root).fontSize));
    if (root.dataset.text !== c) root.dataset.text = c;
  };
  addEventListener("resize", apply);
  const vis = () => { if (!document.hidden) apply(); };
  document.addEventListener("visibilitychange", vis);
  let ro = null, probe = null;
  if (typeof ResizeObserver === "function" && document.body) {
    probe = document.createElement("span");
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText = "position:fixed;left:-99px;top:0;width:1rem;height:1px;visibility:hidden;pointer-events:none";
    document.body.appendChild(probe);
    ro = new ResizeObserver(apply);
    ro.observe(probe);   // its first call comes in the first frame, after the style the browser computes anyway, before the paint
  } else apply();        // no observer: read it now (forces a style pass, once)
  return () => { removeEventListener("resize", apply); document.removeEventListener("visibilitychange", vis); ro?.disconnect(); probe?.remove(); };
}

/** glass-lite (docs/DESIGN-SPEC-GLASS.md 12.4): watch this long after the first touch of the map or the sheet (ms)... */
export const LITE_WATCH_MS = 10000;
/** ...and switch to solid glass when more than this share of the frames took longer than LITE_SLOW_MS. */
export const LITE_SHARE = 0.2;
export const LITE_SLOW_MS = 24;

/**
 * Is this device too slow for blurred glass? True when at least 30 frames were seen and more than 20% of them took
 * longer than 24 ms (pure; unit-tested).
 * @param {number[]} deltas frame-to-frame times (ms)
 * @returns {boolean}
 */
export function tooSlowForGlass(deltas) {
  const d = (deltas || []).filter((x) => Number.isFinite(x) && x > 0 && x < 1000);   // a background pause is no frame
  if (d.length < 30) return false;
  return d.filter((x) => x > LITE_SLOW_MS).length / d.length > LITE_SHARE;
}

/**
 * The safety valve of glass spec 12.4: from the first touch of the map or the sheet, measure frame times for 10 s;
 * on a slow device set html.glass-lite for the session (every glass surface solid, no blur; same shapes and layout).
 * Nothing is stored or sent. Safe to call once at boot.
 * @param {{targets?:Element[], root?:HTMLElement, raf?:(fn:(t:number)=>void)=>number, now?:()=>number}} [o]
 * @returns {() => void} stop
 */
export function initGlassLite(o = {}) {
  const root = o.root || document.documentElement, raf = o.raf || ((fn) => requestAnimationFrame(fn));
  const now = o.now || (() => performance.now()), targets = (o.targets || []).filter(Boolean);
  let started = false, stopped = false;
  const deltas = [];
  const start = () => {
    if (started || stopped) return;
    started = true;
    const t0 = now();
    let last = t0;
    const tick = () => {
      if (stopped) return;
      const t = now();
      if (!document.hidden) deltas.push(t - last);
      last = t;
      if (t - t0 < LITE_WATCH_MS) { raf(tick); return; }
      if (tooSlowForGlass(deltas)) root.classList.add("glass-lite");
      stop();
    };
    raf(tick);
  };
  const types = ["pointerdown", "touchstart"];
  for (const el of targets) for (const ty of types) el.addEventListener(ty, start, { passive: true, once: true });
  function stop() {
    stopped = true;
    for (const el of targets) for (const ty of types) el.removeEventListener(ty, start);
  }
  return stop;
}

/**
 * Keep --frame-k current on resize. Safe to call once at boot.
 * @param {HTMLElement} [root] element that gets the variable (default <html>)
 * @returns {() => void} stop
 */
export function initFrame(root = document.documentElement) {
  const apply = () => {
    if (frameActive()) root.style.setProperty("--frame-k", String(frameScale(innerWidth, innerHeight)));
    else root.style.removeProperty("--frame-k");
    root.classList.toggle("is-framed", frameActive());
  };
  apply();
  addEventListener("resize", apply);
  return () => removeEventListener("resize", apply);
}
