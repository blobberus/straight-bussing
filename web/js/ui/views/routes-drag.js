/**
 * @module ui/views/routes-drag
 * Drag-to-reorder for the Routes "Map order" editor. Pointer events on a row's grip handle
 * ([data-grip], marked data-nodrag so the sheet does not drag): the row follows the finger, the
 * other rows slide out of the way, the content scrolls near its edges, and on release
 * `onDrop(rid, toIndex)` is called. Escape cancels. Keyboard and screen-reader users reorder with the
 * row's Move up / Move down buttons; the grip is a pointer-only shortcut (aria-hidden).
 * Works inside the scaled desktop iPhone frame (screen px are converted to layout px).
 */

const EDGE_PX = 48;     // auto-scroll when the finger is this close to the scroll area's edge
const SCROLL_STEP = 10;

/**
 * Index the dragged row would land at: how many other rows' midpoints lie above its midpoint.
 * @param {number[]} mids layout-px midpoints of every row in list order
 * @param {number} from index of the dragged row
 * @param {number} mid current layout-px midpoint of the dragged row
 * @returns {number}
 */
export function targetIndex(mids, from, mid) {
  let n = 0;
  mids.forEach((m, i) => { if (i !== from && m < mid) n++; });
  return n;
}

/**
 * Attach drag-to-reorder to a root that contains `ol[data-sort] > li[data-id]` rows with `[data-grip]`.
 * @param {HTMLElement} root
 * @param {{onDrop:(rid:string, toIndex:number)=>void, onStart?:()=>void, onEnd?:()=>void}} opts
 * @returns {() => void} detach
 */
export function attachOrderDrag(root, opts) {
  let d = null;

  function scroller(el) {
    for (let n = el.parentElement; n; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight) return n;
    }
    return null;
  }

  function down(e) {
    const grip = e.target.closest?.("[data-grip]");
    if (!grip || !root.contains(grip) || (e.button !== undefined && e.button !== 0) || d) return;
    const li = grip.closest("li[data-id]"), list = li?.closest("ol[data-sort]");
    if (!li || !list) return;
    e.preventDefault();
    e.stopPropagation();
    const rows = [...list.querySelectorAll(":scope > li[data-id]")];
    const r0 = li.getBoundingClientRect();
    const k = li.offsetHeight ? r0.height / li.offsetHeight : 1;           // frame scale (1 on phones)
    const sc = scroller(list);
    d = { li, rows, from: rows.indexOf(li), k, sc, y0: e.clientY, s0: sc ? sc.scrollTop : 0, y: e.clientY, to: rows.indexOf(li),
      mids: rows.map((r) => r.offsetTop + r.offsetHeight / 2), h: li.offsetHeight, id: e.pointerId, raf: 0 };
    try { grip.setPointerCapture(e.pointerId); } catch (err) { /* old browsers */ }
    li.classList.add("is-dragging");
    list.classList.add("is-sorting");
    opts.onStart?.();
    document.addEventListener("keydown", key, true);
  }

  function layout() {
    if (!d) return;
    const scroll = d.sc ? d.sc.scrollTop - d.s0 : 0;
    const dy = (d.y - d.y0) / d.k + scroll;
    d.li.style.transform = `translateY(${dy}px)`;
    d.to = targetIndex(d.mids, d.from, d.mids[d.from] + dy);
    d.rows.forEach((r, i) => {
      if (r === d.li) return;
      let shift = 0;
      if (d.from < d.to && i > d.from && i <= d.to) shift = -d.h;
      else if (d.from > d.to && i >= d.to && i < d.from) shift = d.h;
      r.style.transform = shift ? `translateY(${shift}px)` : "";
    });
  }

  function autoscroll() {
    if (!d || !d.sc) return;
    const b = d.sc.getBoundingClientRect();
    const v = d.y < b.top + EDGE_PX ? -SCROLL_STEP : d.y > b.bottom - EDGE_PX ? SCROLL_STEP : 0;
    if (v) { d.sc.scrollTop += v; layout(); }
    d.raf = v ? requestAnimationFrame(autoscroll) : 0;
  }

  function move(e) {
    if (!d || e.pointerId !== d.id) return;
    e.preventDefault();
    d.y = e.clientY;
    layout();
    if (!d.raf) d.raf = requestAnimationFrame(autoscroll);
  }

  function finish(commit) {
    if (!d) return;
    const { li, rows, from, to, raf } = d;
    if (raf) cancelAnimationFrame(raf);
    document.removeEventListener("keydown", key, true);
    for (const r of rows) r.style.transform = "";
    li.classList.remove("is-dragging");
    li.closest("ol")?.classList.remove("is-sorting");
    const rid = li.dataset.id;
    d = null;
    opts.onEnd?.();
    if (commit && to !== from) opts.onDrop(rid, to);
  }

  function up(e) { if (d && e.pointerId === d.id) finish(e.type === "pointerup"); }
  function key(e) { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); } }

  root.addEventListener("pointerdown", down);
  root.addEventListener("pointermove", move);
  root.addEventListener("pointerup", up);
  root.addEventListener("pointercancel", up);
  return () => {
    finish(false);
    root.removeEventListener("pointerdown", down);
    root.removeEventListener("pointermove", move);
    root.removeEventListener("pointerup", up);
    root.removeEventListener("pointercancel", up);
  };
}
