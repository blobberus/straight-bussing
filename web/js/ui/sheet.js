/**
 * @module ui/sheet
 * Bottom sheet with three detents (peek / half / full) on phones and inside the desktop phone frame
 * (ui/frame.js); a fixed left panel only on wide + short screens (PANEL_MEDIA, e.g. phone landscape).
 * Drag math works in the sheet's own CSS px, so it stays right when the phone frame is scaled down.
 * Drag (owner 2026-10-12: "like Google Maps on an iPhone"): pointer events on the header (any part, incl.
 * the grab bar and tabs; a drag suppresses the click), tracked on the whole window while the finger is
 * down, so a drag that leaves the thin grab bar at once still counts; touch events on the content when it
 * is scrolled to the top. The sheet follows the finger 1:1 (rubber band 0.3 past the ends, one style
 * write per frame). Release projects the velocity like UIKit's scroll deceleration (px/ms * 499) and
 * snaps to the nearest detent of that point, so a slow drag settles where it is and a quick flick goes
 * all the way (full -> peek closes the sheet); any flick (> 0.4 px/ms) moves at least one detent its
 * way and never back. The settle animation starts at the finger's speed (shorter duration for a fast
 * flick). Tap on the header at peek -> half. Grabber = an adjustable control for screen readers and the
 * keyboard (role="slider" "Resize panel", value Collapsed / Half / Expanded, like the iOS app's VoiceOver
 * adjustable action): arrows / Page Up / Page Down step, Home = Collapsed, End = Expanded, Enter / Space and
 * taps cycle like a tap.
 * Emits bus 'sheet:inset' {px} (visible sheet height over the map; 0 in panel mode) on every settle.
 *
 * Geometry lives in css/sheet.css (--v-peek/--v-half/--v-full; the element itself is always --v-max
 * tall, so at "full" its translateY is --v-max - --v-full, not 0, while the status pill shows); this
 * module measures it with hidden probes (data-sheet-probe="peek|half|full", read by
 * ui/settings-overlay.js too) and only sets data-detent and the --drag offset (transform only, no layout).
 */
import { bus } from "../core/events.js";

/** Detent names, smallest to largest. */
export const DETENTS = Object.freeze(["peek", "half", "full"]);
/** What a screen reader says for each detent (the grabber's aria-valuetext; iOS BottomSheet accessibilityValue). */
export const DETENT_TEXT = Object.freeze({ peek: "Collapsed", half: "Half", full: "Expanded" });
const FLICK = 0.4;      // px/ms: a flick moves at least one detent in its direction
const PROJECT_MS = 499; // velocity projection: UIKit's normal deceleration, v * 0.998 / (1 - 0.998)
const RUBBER = 0.3;
const SLOP = 6;         // px before a press becomes a drag
const SPRING_SLOPE = 0.72 / 0.32;   // start speed of --ease-spring cubic-bezier(.32,.72,0,1), x distance / duration
const MIN_SETTLE_MS = 160;

/**
 * Rubber-band a visible height past [min, max] with resistance k.
 * @param {number} vis
 * @param {number} min
 * @param {number} max
 * @param {number} [k=0.3]
 * @returns {number}
 */
export function rubberBand(vis, min, max, k = RUBBER) {
  if (vis > max) return max + (vis - max) * k;
  if (vis < min) return min + (vis - min) * k;
  return vis;
}

/**
 * Pick the detent to settle on.
 * @param {{peek:number, half:number, full:number}} sizes visible heights in px
 * @param {number} releaseVis visible height at release (before rubber band)
 * @param {number} [v=0] finger velocity in px/ms, positive = moving down (sheet shrinking)
 * @returns {'peek'|'half'|'full'}
 */
export function snapDetent(sizes, releaseVis, v = 0) {
  const proj = releaseVis - v * PROJECT_MS;
  let best = "half";
  let bd = Infinity;
  for (const d of DETENTS) {
    const dd = Math.abs(sizes[d] - proj);
    if (dd < bd) {
      bd = dd;
      best = d;
    }
  }
  if (Math.abs(v) > FLICK) {             // a flick never stays put or goes back: at least the next detent its way
    if (v < 0 && !(sizes[best] > releaseVis + 1)) {
      best = DETENTS.find((d) => sizes[d] > releaseVis + 1) || "full";
    } else if (v > 0 && !(sizes[best] < releaseVis - 1)) {
      best = [...DETENTS].reverse().find((d) => sizes[d] < releaseVis - 1) || "peek";
    }
  }
  return best;
}

/**
 * How long the settle animation should take so it starts at the finger's speed: the spring curve starts at
 * SPRING_SLOPE x distance / duration, so a fast flick over a short distance gets a shorter animation (never
 * a stall after release); slow releases keep the normal duration.
 * @param {number} distance px still to travel
 * @param {number} v release velocity, px/ms
 * @param {number} base the normal duration, ms
 * @returns {number} ms
 */
export function settleMs(distance, v, base) {
  const s = Math.abs(v);
  if (!(base > MIN_SETTLE_MS) || s < 0.1 || !(distance > 0)) return base;
  return Math.max(MIN_SETTLE_MS, Math.min(base, (SPRING_SLOPE * distance) / s));
}

/**
 * Finger velocity (px/ms, positive = down) from recent samples [{y, t}] within the last `windowMs`.
 * @param {Array<{y:number, t:number}>} samples oldest first
 * @param {number} [windowMs=100]
 * @returns {number}
 */
export function velocity(samples, windowMs = 100) {
  if (!samples || samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  let first = samples[0];
  for (const s of samples) {
    if (last.t - s.t <= windowMs) {
      first = s;
      break;
    }
  }
  const dt = last.t - first.t;
  return dt > 0 ? (last.y - first.y) / dt : 0;
}

/**
 * Next detent up/down from `d` (clamped).
 * @param {string} d
 * @param {1|-1} dir
 * @returns {'peek'|'half'|'full'}
 */
export function stepDetent(d, dir) {
  const i = Math.max(0, DETENTS.indexOf(d));
  return DETENTS[Math.max(0, Math.min(DETENTS.length - 1, i + dir))];
}

/** Panel (left column, no detents) layout. Must match css/sheet.css, base.css, components.css. */
export const PANEL_MEDIA = "(min-width: 768px) and (max-height: 559px)";

function makeProbe(varName, host) {
  const p = document.createElement("div");
  p.setAttribute("aria-hidden", "true");
  p.dataset.sheetProbe = varName.replace("--v-", "");
  p.style.cssText = `position:fixed;left:-9px;top:0;width:1px;visibility:hidden;pointer-events:none;height:var(${varName})`;
  (host || document.body).appendChild(p);   // next to the sheet, so per-#app overrides of --v-* apply
  return p;
}

/**
 * Create the sheet controller.
 * @param {{sheetEl:HTMLElement, contentEl:HTMLElement, headEl:HTMLElement, grabEl?:HTMLElement, initial?:string, panelMedia?:string}} els
 *   panelMedia: media query for panel mode (default PANEL_MEDIA, must match css/sheet.css)
 * @returns {{setDetent(d:string):void, getDetent():string, onChange(fn:(d:string)=>void):()=>void,
 *            stepDown():boolean, stepUp():boolean, inset():number, isPanel():boolean, destroy():void}}
 */
export function createSheet({ sheetEl, contentEl, headEl, grabEl, initial, panelMedia }) {
  const grab = grabEl || sheetEl.querySelector(".grab");
  const panelMq = matchMedia(panelMedia || PANEL_MEDIA);
  const host = sheetEl.parentElement || document.body;
  const probes = { peek: makeProbe("--v-peek", host), half: makeProbe("--v-half", host), full: makeProbe("--v-full", host) };
  const listeners = new Set();
  const offs = [];
  let detent = DETENTS.includes(initial) ? initial : DETENTS.includes(sheetEl.dataset.detent) ? sheetEl.dataset.detent : "half";
  let drag = null;
  let suppressClick = false;
  let frame = 0, durTimer = 0;

  const on = (el, type, fn, opt) => {
    el.addEventListener(type, fn, opt);
    offs.push(() => el.removeEventListener(type, fn, opt));
  };
  const measure = () => ({ peek: probes.peek.offsetHeight, half: probes.half.offsetHeight, full: probes.full.offsetHeight });
  const isPanel = () => panelMq.matches;
  const inset = () => (isPanel() ? 0 : measure()[detent] || 0);
  const emitInset = () => bus.emit("sheet:inset", { px: inset() });

  if (grab) {   // adjustable control: slider semantics with three named values
    const a = { role: "slider", "aria-label": "Resize panel", "aria-orientation": "vertical", "aria-valuemin": "0", "aria-valuemax": "2" };
    for (const [k, v] of Object.entries(a)) grab.setAttribute(k, v);
    if (grab.tabIndex < 0 || !grab.hasAttribute("tabindex")) grab.tabIndex = 0;
    grab.removeAttribute("aria-expanded");
  }
  function paint() {
    sheetEl.dataset.detent = detent;
    if (grab) {
      grab.setAttribute("aria-valuenow", String(DETENTS.indexOf(detent)));
      grab.setAttribute("aria-valuetext", DETENT_TEXT[detent]);
    }
  }

  function setDetent(d) {
    if (!DETENTS.includes(d)) return;
    const changed = d !== detent;
    detent = d;
    paint();
    if (changed) for (const fn of [...listeners]) {
      try {
        fn(d);
      } catch (e) {
        console.error("sheet listener", e);
      }
    }
    emitInset();
  }

  /* ---- drag core (y arrives in screen px; k converts to the sheet's CSS px under a scaled frame) ---- */
  const scaleOf = () => {
    const h = sheetEl.offsetHeight, r = h ? sheetEl.getBoundingClientRect().height / h : 1;
    return r > 0.05 && isFinite(r) ? r : 1;
  };
  const baseMs = () => {
    const s = getComputedStyle(sheetEl).transitionDuration || "";
    const n = parseFloat(s);
    return isFinite(n) ? (s.trim().endsWith("ms") ? n : n * 1000) : 0;
  };
  function begin(yRaw, source) {
    const k = scaleOf(), y = yRaw / k;
    drag = { k, y0: y, y, sizes: measure(), startVis: 0, samples: [{ y, t: performance.now() }], moved: false, source,
      eff: 0, base: baseMs() };
    drag.startVis = drag.eff = drag.sizes[detent];
  }
  const paintDrag = () => {        // one style write per frame, however many move events arrive
    frame = 0;
    if (drag) sheetEl.style.setProperty("--drag", drag.startVis - drag.eff + "px");
  };
  function track(yRaw) {
    if (!drag) return;
    drag.y = yRaw / drag.k;
    drag.samples.push({ y: drag.y, t: performance.now() });
  }
  function move(yRaw) {
    if (!drag) return false;
    const y = yRaw / drag.k;
    const dy = y - drag.y0;
    if (!drag.moved) {
      if (Math.abs(dy) < SLOP && drag.source !== "touch") return false;
      drag.moved = true;
      sheetEl.classList.add("dragging");
    }
    drag.y = y;
    const t = performance.now();
    drag.samples.push({ y, t });
    if (drag.samples.length > 12) drag.samples.shift();
    drag.eff = rubberBand(drag.startVis - dy, drag.sizes.peek, drag.sizes.full);
    if (!frame) frame = requestAnimationFrame(paintDrag);
    return true;
  }
  function end(cancelled) {
    const d = drag;
    drag = null;
    unwatch();
    if (frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    if (!d) return;
    sheetEl.classList.remove("dragging");
    sheetEl.style.removeProperty("--drag");
    if (!d.moved) return;
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 350);
    if (cancelled) return emitInset();
    const v = velocity(d.samples);
    const target = snapDetent(d.sizes, d.startVis - (d.y - d.y0), v);
    const ms = settleMs(Math.abs(d.sizes[target] - d.eff), v, d.base);
    clearTimeout(durTimer);
    if (ms < d.base) {             // only shortened: the running transition keeps this duration once started
      sheetEl.style.transitionDuration = ms + "ms";
      durTimer = setTimeout(() => sheetEl.style.removeProperty("transition-duration"), ms + 100);
    } else {
      sheetEl.style.removeProperty("transition-duration");
    }
    setDetent(target);
  }

  /* ---- header: pointer events, followed on the whole window while pressed ---- */
  let pid = null, watching = false;
  const onMove = (e) => {
    if (!drag || e.pointerId !== pid) return;
    const wasMoved = drag.moved;
    if (move(e.clientY) && !wasMoved) {
      try {
        headEl.setPointerCapture(e.pointerId);   // from here on the map never sees this finger
      } catch (err) { /* pointer already gone */ }
    }
  };
  const onUp = (e) => {
    if (e.pointerId !== pid) return;
    track(e.clientY);
    pid = null;
    end(false);
  };
  const onCancel = (e) => {
    if (e.pointerId !== pid) return;
    pid = null;
    end(true);
  };
  function watch() {   // a fast drag up from the 28 px grab bar leaves the header before the first move event
    if (watching) return;
    watching = true;
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onCancel, true);
  }
  function unwatch() {
    if (!watching) return;
    watching = false;
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("pointerup", onUp, true);
    window.removeEventListener("pointercancel", onCancel, true);
  }
  offs.push(unwatch);
  on(headEl, "pointerdown", (e) => {
    if (isPanel() || (e.pointerType === "mouse" && e.button !== 0)) return;
    if (e.target.closest("input, select, textarea, [data-nodrag]")) return;
    if (drag) end(true);
    pid = e.pointerId;
    begin(e.clientY, "pointer");
    watch();
  });
  on(headEl, "lostpointercapture", () => {
    if (drag && drag.source === "pointer" && pid !== null) {
      pid = null;
      end(false);
    }
  });
  // swallow the click that follows a drag; tap on header at peek -> half
  on(headEl, "click", (e) => {
    if (suppressClick) {
      e.preventDefault();
      e.stopPropagation();
      suppressClick = false;
      return;
    }
    if (grab && (e.target === grab || grab.contains(e.target))) {
      setDetent(detent === "peek" ? "half" : detent === "half" ? "full" : "half");
      return;
    }
    if (detent === "peek" && !e.target.closest("button, a, input, select, textarea")) setDetent("half");
  }, true);
  if (grab) {
    on(grab, "keydown", (e) => {
      if (["ArrowUp", "ArrowRight", "PageUp"].includes(e.key)) setDetent(stepDetent(detent, 1));
      else if (["ArrowDown", "ArrowLeft", "PageDown"].includes(e.key)) setDetent(stepDetent(detent, -1));
      else if (e.key === "Home") setDetent("peek");     // slider minimum
      else if (e.key === "End") setDetent("full");      // slider maximum
      else if (e.key === "Enter" || e.key === " ") setDetent(detent === "peek" ? "half" : detent === "half" ? "full" : "half");
      else return;
      e.preventDefault();
    });
  }

  /* ---- content: touch drag when scrolled to top ---- */
  let tc = null;
  on(contentEl, "touchstart", (e) => {
    tc = null;
    if (isPanel() || e.touches.length !== 1 || drag) return;
    if (e.target.closest("input, select, textarea, [data-nodrag], .leaflet-container")) return;
    const t = e.touches[0];
    tc = { x0: t.clientX, y0: t.clientY, decided: false, dragging: false };
  }, { passive: true });
  on(contentEl, "touchmove", (e) => {
    if (!tc) return;
    const t = e.touches[0];
    const dx = t.clientX - tc.x0;
    const dy = t.clientY - tc.y0;
    if (!tc.decided) {
      if (dx === 0 && dy === 0) return;
      tc.decided = true;
      const vertical = Math.abs(dy) >= Math.abs(dx);
      const atTop = contentEl.scrollTop <= 0;
      const want = vertical && atTop && ((dy > 0 && detent !== "peek") || (dy < 0 && detent !== "full"));
      if (!want || !e.cancelable) {
        tc = null;
        return;
      }
      tc.dragging = true;
      begin(tc.y0, "touch");
    }
    if (tc.dragging) {
      e.preventDefault();
      move(t.clientY);
    }
  }, { passive: false });
  const touchEnd = (e) => {
    if (tc && tc.dragging && drag) {
      const t = e.changedTouches && e.changedTouches[0];
      if (t) track(t.clientY);
      end(e.type === "touchcancel");
    }
    tc = null;
  };
  on(contentEl, "touchend", touchEnd);
  on(contentEl, "touchcancel", touchEnd);

  /* ---- layout changes ---- */
  let raf = 0;
  const relayout = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(emitInset);
  };
  on(window, "resize", relayout);
  on(window, "orientationchange", relayout);
  const onMq = () => relayout();
  if (panelMq.addEventListener) {
    panelMq.addEventListener("change", onMq);
    offs.push(() => panelMq.removeEventListener("change", onMq));
  }

  paint();
  requestAnimationFrame(emitInset);

  return {
    setDetent,
    getDetent: () => detent,
    onChange(fn) {
      if (typeof fn !== "function") return () => {};
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** One detent smaller; false if already at peek or in panel mode. */
    stepDown() {
      if (isPanel() || detent === "peek") return false;
      setDetent(stepDetent(detent, -1));
      return true;
    },
    /** One detent larger; false if already full or in panel mode. */
    stepUp() {
      if (isPanel() || detent === "full") return false;
      setDetent(stepDetent(detent, 1));
      return true;
    },
    inset,
    isPanel,
    destroy() {
      offs.forEach((f) => f());
      Object.values(probes).forEach((p) => p.remove());
      listeners.clear();
    },
  };
}
