/**
 * @module ui/sheet
 * Bottom sheet with two resting states, collapsed (peek) and expanded (full), on phones and inside the desktop
 * phone frame (ui/frame.js); a fixed left panel only on wide + short screens (PANEL_MEDIA, e.g. phone landscape).
 * Drag math works in the sheet's own CSS px, so it stays right when the phone frame is scaled down.
 *
 * Behavior (owner 2026-10-12, "copy Google Maps"): there is no midway stop. While the finger is down the sheet
 * follows it 1:1 to any height (rubber band 0.3 past the ends); touching it while it is still settling stops it
 * under the finger. On release the direction of the finger's last motion decides: moving up -> expanded, moving
 * down -> collapsed; a finger that had stopped uses the direction of its last movement of 2 px or more; no
 * movement at all is a tap (the grab bar, or a collapsed header, toggles). The settle animation starts at the
 * finger's speed (settleMs), and the content's bottom inset changes only after it has settled (data-rest), so
 * nothing is laid out while the sheet moves. A request for the old "half" detent (views that only say "the
 * map matters") keeps the current state.
 *
 * Input: the WHOLE header strip (the top edge, the grab bar, the title line incl. its right-side summary and the
 * Back button) is a drag handle. Touch input uses touch events with a non-passive touchmove that always claims the
 * gesture (iOS Safari otherwise may take it as a page pan and cancel pointer events); mouse and pen use pointer
 * events followed on the whole window while pressed. The content drags the sheet when it is scrolled to the top.
 * Grabber = an adjustable control for screen readers and the keyboard (role="slider" "Resize panel", value
 * Collapsed / Expanded): arrows / Page Up / Page Down / Home / End, Enter / Space and taps toggle.
 * Emits bus 'sheet:inset' {px} (visible sheet height over the map; 0 in panel mode) on every settle.
 *
 * Geometry lives in css/sheet.css (--v-peek/--v-full; the element itself is always --v-max tall, so at "full"
 * its translateY is --v-max - --v-full, not 0, while the status pill shows); this module measures it with hidden
 * probes (data-sheet-probe="peek|half|full", read by ui/settings-overlay.js too) and only sets data-detent,
 * data-rest and the --drag offset (transform only, no layout).
 */
import { bus } from "../core/events.js";

/** Resting states, smallest to largest. */
export const DETENTS = Object.freeze(["peek", "full"]);
/** What a screen reader says for each state (the grabber's aria-valuetext; iOS BottomSheet accessibilityValue). */
export const DETENT_TEXT = Object.freeze({ peek: "Collapsed", full: "Expanded" });
const STOPPED = 0.1;    // px/ms: slower than this at release, the finger counts as stopped
const RUBBER = 0.3;
const SLOP = 6;         // px before a press becomes a drag
const DIR_STEP = 2;     // px: a movement this long sets the "last direction"
const SPRING_SLOPE = 0.72 / 0.32;   // start speed of --ease-spring cubic-bezier(.32,.72,0,1), x distance / duration
const MIN_SETTLE_MS = 160;
const TOUCH = typeof window !== "undefined" && "ontouchstart" in window;

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
 * Where to settle on release: the direction of the finger's last motion.
 * @param {{peek:number, full:number}} sizes visible heights in px
 * @param {number} releaseVis visible height at release
 * @param {number} [v=0] finger velocity at release in px/ms, positive = moving down (sheet shrinking)
 * @param {number} [lastDir=0] sign of the finger's last movement of DIR_STEP px or more (+1 down, -1 up, 0 none)
 * @returns {'peek'|'full'}
 */
export function snapDetent(sizes, releaseVis, v = 0, lastDir = 0) {
  const dir = Math.abs(v) >= STOPPED ? Math.sign(v) : Math.sign(lastDir || 0);
  if (dir < 0) return "full";
  if (dir > 0) return "peek";
  return Math.abs(releaseVis - sizes.full) < Math.abs(releaseVis - sizes.peek) ? "full" : "peek";
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
 * The other state up/down from `d` (clamped).
 * @param {string} d
 * @param {1|-1} dir
 * @returns {'peek'|'full'}
 */
export function stepDetent(d, dir) {
  return dir > 0 ? "full" : dir < 0 ? "peek" : DETENTS.includes(d) ? d : "peek";
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
  const pick = (d) => (DETENTS.includes(d) ? d : null);
  let detent = pick(initial) || pick(sheetEl.dataset.detent) || "peek";
  let drag = null;
  let suppressClick = false;
  let durTimer = 0, restTimer = 0;

  const on = (el, type, fn, opt) => {
    el.addEventListener(type, fn, opt);
    offs.push(() => el.removeEventListener(type, fn, opt));
  };
  const measure = () => ({ peek: probes.peek.offsetHeight, full: probes.full.offsetHeight });
  const isPanel = () => panelMq.matches;
  const inset = () => (isPanel() ? 0 : measure()[detent] || 0);
  const emitInset = () => bus.emit("sheet:inset", { px: inset() });

  if (grab) {   // adjustable control: slider semantics with two named values
    const a = { role: "slider", "aria-label": "Resize panel", "aria-orientation": "vertical", "aria-valuemin": "0", "aria-valuemax": "1" };
    for (const [k, v] of Object.entries(a)) grab.setAttribute(k, v);
    if (grab.tabIndex < 0 || !grab.hasAttribute("tabindex")) grab.tabIndex = 0;
    grab.removeAttribute("aria-expanded");
  }
  const baseMs = () => {
    const s = getComputedStyle(sheetEl).transitionDuration || "";
    const n = parseFloat(s);
    return isFinite(n) ? (s.trim().endsWith("ms") ? n : n * 1000) : 0;
  };
  /* data-rest = the state the content's bottom inset is laid out for (css/sheet.css). It follows data-detent
     only once the sheet has settled: changing it lays out every row, which must not happen while it moves. */
  function rest(now) {
    clearTimeout(restTimer);
    const apply = () => { if (sheetEl.dataset.rest !== detent) sheetEl.dataset.rest = detent; };
    if (now || !sheetEl.dataset.rest) return apply();
    const ms = (parseFloat(sheetEl.style.transitionDuration) || baseMs() || 0) + 60;
    restTimer = setTimeout(apply, ms);
  }
  function paint() {
    sheetEl.dataset.detent = detent;
    if (grab) {
      grab.setAttribute("aria-valuenow", String(DETENTS.indexOf(detent)));
      grab.setAttribute("aria-valuetext", DETENT_TEXT[detent]);
    }
  }

  function setDetent(d) {
    if (d === "half") d = detent;          // "the map matters": keep whatever the rider chose
    if (!DETENTS.includes(d)) return;
    const changed = d !== detent;
    detent = d;
    paint();
    rest(!changed || isPanel());
    if (changed) for (const fn of [...listeners]) {
      try {
        fn(d);
      } catch (e) {
        console.error("sheet listener", e);
      }
    }
    emitInset();
  }
  const toggle = () => setDetent(detent === "peek" ? "full" : "peek");

  /* ---- drag core (y arrives in screen px; k converts to the sheet's CSS px under a scaled frame) ---- */
  const scaleOf = () => {
    const h = sheetEl.offsetHeight, r = h ? sheetEl.getBoundingClientRect().height / h : 1;
    return r > 0.05 && isFinite(r) ? r : 1;
  };
  /** Visible height on screen now (mid-settle it differs from the state's): the sheet's live transform. */
  function visNow(sizes) {
    const m = getComputedStyle(sheetEl).transform;
    if (!m || m === "none") return sizes[detent];
    const ty = new DOMMatrixReadOnly(m).m42;
    const v = sheetEl.offsetHeight - ty;
    return isFinite(v) ? v : sizes[detent];
  }
  function begin(yRaw, source) {
    const k = scaleOf(), y = yRaw / k;
    const sizes = measure(), at = visNow(sizes);
    drag = { k, y0: y, y, lastY: y, lastDir: 0, sizes, startVis: at, home: sizes[detent], samples: [{ y, t: performance.now() }],
      moved: false, source, eff: at, base: baseMs(), caught: false };
    if (Math.abs(at - drag.home) > 1) {    // still settling: stop it under the finger instead of jumping later
      drag.caught = true;
      sheetEl.classList.add("dragging");
      sheetEl.style.setProperty("--drag", drag.home - at + "px");
    }
  }
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
    if (Math.abs(y - drag.lastY) >= DIR_STEP) {
      drag.lastDir = Math.sign(y - drag.lastY);
      drag.lastY = y;
    }
    drag.y = y;
    drag.samples.push({ y, t: performance.now() });
    if (drag.samples.length > 12) drag.samples.shift();
    drag.eff = rubberBand(drag.startVis - dy, drag.sizes.peek, drag.sizes.full);
    sheetEl.style.setProperty("--drag", drag.home - drag.eff + "px");   // --drag is not inherited: cheap
    return true;
  }
  function end(cancelled) {
    const d = drag;
    drag = null;
    unwatch();
    if (!d) return;
    if (!d.moved && d.caught && !cancelled) {   // a touch that stopped a settling sheet, then let go: settle nearest
      d.moved = true;
      d.samples = [];
    }
    sheetEl.classList.remove("dragging");
    sheetEl.style.removeProperty("--drag");
    if (!d.moved) return;
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 350);
    if (cancelled) return emitInset();
    const v = velocity(d.samples);
    const target = snapDetent(d.sizes, d.eff, v, d.lastDir);
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

  /* ---- header, touch: the whole strip claims the gesture (iOS would otherwise pan and cancel it) ---- */
  let ht = null;
  const fromField = (t) => t && t.closest && t.closest("input, select, textarea, [data-nodrag]");
  on(headEl, "touchstart", (e) => {
    ht = null;
    if (isPanel() || e.touches.length !== 1 || fromField(e.target)) return;
    if (drag) end(true);
    const t = e.touches[0];
    ht = { id: t.identifier };
    begin(t.clientY, "head-touch");
  }, { passive: true });
  on(headEl, "touchmove", (e) => {
    if (!ht || !drag) return;
    const t = [...e.touches].find((x) => x.identifier === ht.id) || e.touches[0];
    if (!t) return;
    if (e.cancelable) e.preventDefault();
    move(t.clientY);
  }, { passive: false });
  const headTouchEnd = (e) => {
    if (!ht) return;
    const t = e.changedTouches && e.changedTouches[0];
    if (t && drag) track(t.clientY);
    ht = null;
    end(e.type === "touchcancel");
  };
  on(headEl, "touchend", headTouchEnd);
  on(headEl, "touchcancel", headTouchEnd);

  /* ---- header, mouse / pen (and touch where touch events are missing): pointer events on the window ---- */
  let pid = null, watching = false;
  // followed on the window, no pointer capture: capturing made WebKit stop sending a second drag's moves, and the
  // map only pans from a press on the map itself, so it never takes over a drag that started on the header
  const onMove = (e) => {
    if (!drag || e.pointerId !== pid) return;
    move(e.clientY);
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
    if (e.pointerType === "touch" && TOUCH) return;   // the touch handlers above own touch input
    if (fromField(e.target)) return;
    if (drag) end(true);
    // no text selection, no native drag of an earlier selection (WebKit then stops sending this press's moves)
    if (e.pointerType === "mouse" && e.cancelable) e.preventDefault();
    try { window.getSelection?.()?.removeAllRanges?.(); } catch (err) { /* */ }
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
  // swallow the click that follows a drag; a tap on the grab bar toggles, a tap on a collapsed header expands
  on(headEl, "click", (e) => {
    if (suppressClick) {
      e.preventDefault();
      e.stopPropagation();
      suppressClick = false;
      return;
    }
    if (grab && (e.target === grab || grab.contains(e.target))) return toggle();
    if (detent === "peek" && !e.target.closest("button, a, input, select, textarea")) setDetent("full");
  }, true);
  if (grab) {
    on(grab, "keydown", (e) => {
      if (["ArrowUp", "ArrowRight", "PageUp", "End"].includes(e.key)) setDetent("full");
      else if (["ArrowDown", "ArrowLeft", "PageDown", "Home"].includes(e.key)) setDetent("peek");
      else if (e.key === "Enter" || e.key === " ") toggle();
      else return;
      e.preventDefault();
    });
  }

  /* ---- content: touch drag when scrolled to the top ---- */
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
  rest(true);
  requestAnimationFrame(emitInset);

  return {
    setDetent,
    getDetent: () => detent,
    onChange(fn) {
      if (typeof fn !== "function") return () => {};
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Collapse; false if already collapsed or in panel mode. */
    stepDown() {
      if (isPanel() || detent === "peek") return false;
      setDetent("peek");
      return true;
    },
    /** Expand; false if already expanded or in panel mode. */
    stepUp() {
      if (isPanel() || detent === "full") return false;
      setDetent("full");
      return true;
    },
    inset,
    isPanel,
    destroy() {
      offs.forEach((f) => f());
      Object.values(probes).forEach((p) => p.remove());
      listeners.clear();
      clearTimeout(restTimer);
      clearTimeout(durTimer);
    },
  };
}
