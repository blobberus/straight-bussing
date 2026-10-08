/**
 * @module ui/theme
 * Auto / Light / Dark appearance. The mode lives in store.theme (persisted by state.js);
 * this module paints <html data-theme>, color-scheme and the theme-color metas, follows the
 * system setting while in Auto, and notifies listeners when the effective darkness flips.
 *
 * Module-level API (usable from any view):  getTheme(), setTheme(mode), isDark(), onChange(fn), mount(el)
 * initTheme(store) wires it to the store and returns the same API as an object.
 */

const MODES = ["auto", "light", "dark"];
const LABELS = { auto: "Auto", light: "Light", dark: "Dark" };
const META_LIGHT = "#f2f2f7";
const META_DARK = "#1c1c1e";

let store = null;
let unsub = null;
let mode = "auto";
let last = null;
let mq = null;
const listeners = new Set();
const mounted = new Set();

function clean(m) {
  return MODES.includes(m) ? m : "auto";
}

function sysDark() {
  return !!(mq && mq.matches);
}

/**
 * Whether the effective appearance is dark right now.
 * @returns {boolean}
 */
export function isDark() {
  return mode === "dark" || (mode === "auto" && sysDark());
}

/**
 * Current mode.
 * @returns {'auto'|'light'|'dark'}
 */
export function getTheme() {
  return mode;
}

function paint() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (mode === "auto") delete root.dataset.theme;
  else root.dataset.theme = mode;
  root.style.colorScheme = mode === "auto" ? "light dark" : mode;
  const metas = document.querySelectorAll('meta[name="theme-color"]');
  metas.forEach((m, i) => {
    if (mode === "auto") {
      const dark = i === 1;
      m.setAttribute("media", `(prefers-color-scheme: ${dark ? "dark" : "light"})`);
      m.setAttribute("content", dark ? META_DARK : META_LIGHT);
    } else {
      m.removeAttribute("media");
      m.setAttribute("content", mode === "dark" ? META_DARK : META_LIGHT);
    }
  });
}

function fire(force) {
  const d = isDark();
  if (!force && d === last) return;
  last = d;
  for (const fn of [...listeners]) {
    try {
      fn(d, mode);
    } catch (e) {
      console.error("theme listener", e);
    }
  }
}

function syncControls() {
  for (const seg of [...mounted]) {
    if (!seg.isConnected) {
      mounted.delete(seg);
      continue;
    }
    seg.querySelectorAll("button[data-mode]").forEach((b) => {
      const on = b.dataset.mode === mode;
      b.classList.toggle("on", on);
      b.setAttribute("aria-checked", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
    });
  }
}

function apply(m) {
  mode = clean(m);
  paint();
  syncControls();
  fire(false);
}

/**
 * Change the mode. Writes store.theme (state.js persists it) and repaints immediately.
 * Unknown values are ignored.
 * @param {'auto'|'light'|'dark'} m
 */
export function setTheme(m) {
  if (!MODES.includes(m)) return;
  apply(m);
  if (store && store.get().theme !== m) store.set({ theme: m });
}

/**
 * Listen for effective light/dark flips (system change while in Auto, or manual change).
 * @param {(isDark:boolean, mode:string)=>void} fn
 * @returns {() => void} unsubscribe
 */
export function onChange(fn) {
  if (typeof fn !== "function") return () => {};
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Render an Auto/Light/Dark radio-style segmented control into `el` (appended).
 * Arrow keys move the selection. Returns the control element.
 * @param {HTMLElement} el
 * @returns {HTMLElement|null}
 */
export function mount(el) {
  if (!el || typeof document === "undefined") return null;
  const seg = document.createElement("div");
  seg.className = "themeseg";
  seg.setAttribute("role", "radiogroup");
  seg.setAttribute("aria-label", "Appearance");
  for (const m of MODES) {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.mode = m;
    b.textContent = LABELS[m];
    b.setAttribute("role", "radio");
    b.addEventListener("click", () => setTheme(m));
    b.addEventListener("keydown", (e) => {
      const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
      if (!dir) return;
      e.preventDefault();
      setTheme(MODES[(MODES.indexOf(mode) + dir + MODES.length) % MODES.length]);
      const nb = seg.querySelector(`[data-mode="${mode}"]`);
      if (nb) nb.focus();
    });
    seg.appendChild(b);
  }
  el.appendChild(seg);
  mounted.add(seg);
  syncControls();
  return seg;
}

function onSystemChange() {
  if (mode === "auto") {
    paint();
    fire(false);
  }
}

/**
 * Wire the theme to the store: read store.theme, paint, follow prefers-color-scheme, and react to
 * store.theme changes made elsewhere. Safe to call more than once (rebinds to the new store).
 * @param {{get():Object, set(p:Object):void, subscribe(fn:Function):Function}} st
 * @returns {{getTheme:typeof getTheme, setTheme:typeof setTheme, isDark:typeof isDark, onChange:typeof onChange, mount:typeof mount}}
 */
export function initTheme(st) {
  if (unsub) unsub();
  store = st || null;
  if (!mq && typeof matchMedia === "function") {
    mq = matchMedia("(prefers-color-scheme: dark)");
    if (mq.addEventListener) mq.addEventListener("change", onSystemChange);
    else if (mq.addListener) mq.addListener(onSystemChange);
  }
  mode = clean(store ? store.get().theme : mode);
  paint();
  last = isDark();
  syncControls();
  unsub = store
    ? store.subscribe((s, changed) => {
        if (changed.has("theme") && clean(s.theme) !== mode) apply(s.theme);
      })
    : null;
  return { getTheme, setTheme, isDark, onChange, mount };
}
