/**
 * @module ui/wheel
 * Wheel columns like the iPhone's alarm clock (owner 2026-10-18, Lines by Time): each column is a vertical
 * scroller of rows with scroll snapping, the chosen row in a band across the middle, rows fading toward the edges.
 * Swipe or scroll a column, tap a row, or use the keyboard: the column is a focusable spinbutton
 * (ArrowUp / ArrowDown one row, PageUp / PageDown five, Home / End), with aria-valuenow / aria-valuetext kept current,
 * so a screen reader hears "Hour, 9" and adjusts it like any spinbutton. Reduced motion: no smooth scrolling.
 * Markup from wheelHTML(); behaviour from attachWheel() on the mounted element.
 */
import { esc } from "../core/esc.js";

/** Row height in px (css/settings.css .wh-col uses the same 40px, with 5 rows in view). */
export const ROW = 40;
const SETTLE_MS = 120;
/** The rider taking hold of a column (ends a scroll the column started itself). */
const USER = ["pointerdown", "touchstart", "wheel"];
const reducedMotion = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } };

/**
 * One column.
 * @param {{id:string, label:string, items:{text:string, say?:string}[], index:number, cls?:string}} c
 *   items: shown text and (optional) what a screen reader says for it
 * @returns {string}
 */
export function wheelHTML({ id, label, items, index, cls = "" }) {
  const i = clampIndex(index, items.length), cur = items[i] || { text: "" };
  return `<div class="wh-col${cls ? " " + cls : ""}" id="${esc(id)}" data-wheel="${esc(id)}" role="spinbutton" tabindex="0"`
    + ` aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="${items.length - 1}" aria-valuenow="${i}" aria-valuetext="${esc(cur.say || cur.text)}">`
    + `<ul class="wh-list" aria-hidden="true">${itemsHTML(items, i)}</ul></div>`;
}

function itemsHTML(items, sel) {
  return items.map((it, k) => `<li class="wh-item${k === sel ? " is-sel" : ""}" data-i="${k}">${esc(it.text)}</li>`).join("");
}

function clampIndex(i, n) {
  return Math.max(0, Math.min(n - 1, Math.round(Number(i) || 0)));
}

/**
 * Make a column interactive.
 * @param {HTMLElement} el the .wh-col element
 * @param {{items:{text:string, say?:string}[], index:number, onChange?:(index:number)=>void}} o
 * @returns {{get index():number, set(i:number, opts?:{scroll?:boolean, silent?:boolean}):void,
 *           setItems(items:object[], index:number):void, sync():void, detach():void}}
 */
export function attachWheel(el, { items, index, onChange }) {
  let list = items.slice(), idx = clampIndex(index, list.length), timer = 0;
  // driving: the column is scrolling itself to idx (a key, a tap, a value set in code). Its own scroll events never
  // change the value, only the rider's swipe, wheel or drag does: a long frame in the middle of the animation once
  // read a row in between as the choice. It ends when the row is in the band, at the rider's touch, or after 1.5 s.
  let driving = false, driveTimer = 0;
  const drive = () => { driving = true; clearTimeout(driveTimer); driveTimer = setTimeout(() => { driving = false; }, 1500); };
  const release = () => { driving = false; clearTimeout(driveTimer); };
  const ul = el.querySelector(".wh-list");
  const mark = () => {
    const cur = list[idx] || { text: "" };
    el.setAttribute("aria-valuenow", String(idx));
    el.setAttribute("aria-valuemax", String(list.length - 1));
    el.setAttribute("aria-valuetext", cur.say || cur.text);
    for (const li of ul.children) li.classList.toggle("is-sel", Number(li.dataset.i) === idx);
  };
  const scrollTo = (smooth) => {
    const top = idx * ROW;
    if (Math.abs(el.scrollTop - top) < 1) return;
    drive();
    if (smooth && !reducedMotion() && typeof el.scrollTo === "function") el.scrollTo({ top, behavior: "smooth" });
    else el.scrollTop = top;
  };
  const api = {
    get index() { return idx; },
    set(i, { scroll = true, silent = false } = {}) {
      const n = clampIndex(i, list.length), changed = n !== idx;
      idx = n;
      mark();
      if (scroll) scrollTo(true);
      if (changed && !silent) onChange?.(idx);
    },
    setItems(next, i) {
      list = next.slice();
      ul.innerHTML = itemsHTML(list, clampIndex(i, list.length));
      idx = clampIndex(i, list.length);
      mark();
      scrollTo(false);
    },
    /** Put the chosen row in the band without animation (after the column becomes visible: a hidden one cannot scroll). */
    sync() { scrollTo(false); },
    detach() {
      clearTimeout(timer);
      release();
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("keydown", onKey);
      el.removeEventListener("click", onClick);
      for (const ev of USER) el.removeEventListener(ev, release);
    },
  };
  const onScroll = () => {
    clearTimeout(timer);
    if (driving) { if (Math.abs(el.scrollTop - idx * ROW) < 1) release(); return; }
    timer = setTimeout(() => {
      const n = clampIndex(el.scrollTop / ROW, list.length);
      if (n !== idx) api.set(n, { scroll: false });
      if (Math.abs(el.scrollTop - n * ROW) >= 1) scrollTo(true);   // browsers without scroll snapping
    }, SETTLE_MS);
  };
  const onKey = (e) => {
    const step = { ArrowUp: -1, ArrowDown: 1, PageUp: -5, PageDown: 5 }[e.key];
    let n = null;
    if (step) n = idx + step;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = list.length - 1;
    if (n == null) return;
    e.preventDefault();
    api.set(n);
  };
  const onClick = (e) => {
    const li = e.target && e.target.closest ? e.target.closest(".wh-item") : null;
    if (li && el.contains(li)) api.set(Number(li.dataset.i));
  };
  el.addEventListener("scroll", onScroll, { passive: true });
  el.addEventListener("keydown", onKey);
  el.addEventListener("click", onClick);
  for (const ev of USER) el.addEventListener(ev, release, { passive: true });
  mark();
  el.scrollTop = idx * ROW;
  return api;
}
