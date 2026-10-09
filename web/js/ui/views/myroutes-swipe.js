/**
 * @module ui/views/myroutes-swipe
 * Apple-Music-style swipe actions for custom route rows: drag a row left to reveal its action tray
 * (Details, Edit, Delete). A full or fast swipe only OPENS the tray; it never runs an action, so
 * Delete always needs its own tap plus the confirmation popup (ui/confirm.js).
 * Markup (myroutes.js): .mr-swipe[data-swipe-id] > .mr-front (the row: .mr-crow + .mr-morebtn) +
 * .mr-acts (tray, inert while closed). The open row id lives with the caller (getOpen / setOpen) so
 * re-renders keep it; this module paints open / closed straight onto the existing elements (class
 * is-open, inert, aria-expanded) and lets the CSS transition animate it, so nothing is re-rendered.
 *
 * Tap vs drag: a press that stays within SLOP px (measured in the row's own CSS px, so the scaled
 * desktop phone frame behaves like a phone) is a tap: the row never moves and its click toggles the
 * route. Past SLOP it is a gesture: horizontal drags move the row (starting from 0, no jump),
 * vertical ones are left to the list scroll, and in both cases the click that follows is swallowed.
 * While a tray is open, a press anywhere else in the list only closes it (like iOS). Taps on the
 * tray within GUARD_MS of it opening are ignored (a double tap on "More" never hits Delete).
 * Escape closes an open tray and puts focus back on its More button.
 */

/** Width of the action tray: three 72px buttons (keep in sync with css/myroutes.css). */
export const TRAY_W = 216;
const SLOP = 10;         // CSS px a press may wander and still be a tap
const FLING = 0.45;      // px/ms that counts as a fling...
const FLING_MIN = 48;    // ...but only after this much travel (a tiny flick never opens the tray)
const ANIM_MS = 340;     // css transition (--d-sheet) + a frame
const GUARD_MS = 350;    // tray taps ignored this long after it opened
const SWALLOW_MS = 400;  // the click that follows a gesture arrives within this time after pointerup

/**
 * Wire swipe gestures on a list root.
 * @param {HTMLElement} root
 * @param {{getOpen:() => (string|null), setOpen:(id:string|null) => void}} state
 * @returns {{detach():void, toggle(id:string, focusTray?:boolean):void, close():void, busy():boolean}}
 */
export function attachSwipe(root, { getOpen, setOpen }) {
  let g = null, swallowPid = null, swallowUntil = 0, busyUntil = 0, openedAt = -1e9;
  const now = () => performance.now();
  const rowOf = (id) => (id ? root.querySelector(`.mr-swipe[data-swipe-id="${CSS.escape(id)}"]`) : null);
  const front = (row) => row && row.querySelector(".mr-front");
  const scaleOf = (el) => { const w = el.offsetWidth, r = w ? el.getBoundingClientRect().width / w : 1; return r > 0.05 && isFinite(r) ? r : 1; };
  const reduced = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } };

  /** Paint a row open / closed on its existing elements; the css transition animates the move. */
  function paint(row, open) {
    if (!row) return;
    const f = front(row);
    if (f) { f.style.transition = ""; f.style.transform = ""; }   // hand over from the drag offset to the class
    row.classList.toggle("is-open", open);
    row.classList.remove("is-drag");
    row.querySelector(".mr-acts")?.toggleAttribute("inert", !open);
    row.querySelector(".mr-morebtn")?.setAttribute("aria-expanded", String(open));
    busyUntil = now() + (reduced() ? 0 : ANIM_MS);
  }
  function setRow(id, open) {
    const cur = getOpen();
    if (open && cur && cur !== id) paint(rowOf(cur), false);
    setOpen(open ? id : cur === id || !id ? null : cur);
    paint(rowOf(id), open);
    if (open) openedAt = now();
  }
  function close() { const id = getOpen(); if (id) setRow(id, false); }
  function setX(row, x) {
    const f = front(row);
    if (!f) return;
    f.style.transition = "none";
    f.style.transform = `translate3d(${x}px, 0, 0)`;
  }

  function down(e) {
    if (e.button > 0 || (g && g.pid !== e.pointerId)) return;   // other buttons / a second finger
    const row = e.target.closest?.(".mr-swipe");
    const openId = getOpen();
    const inOpenTray = row && row.dataset.swipeId === openId && e.target.closest(".mr-acts, .mr-morebtn");
    if (openId && !inOpenTray) {
      close();                       // any other press only closes the open tray...
      swallowPid = e.pointerId;      // ...and its click does nothing else
      return;
    }
    if (!row || e.target.closest(".mr-acts, .mr-morebtn")) return;
    g = { row, id: row.dataset.swipeId, pid: e.pointerId, x0: e.clientX, y0: e.clientY, k: scaleOf(row), moved: false, on: false, xs: 0, dx: 0, s: [[e.timeStamp, 0]] };
  }
  function move(e) {
    if (!g || e.pointerId !== g.pid) return;
    const dx = (e.clientX - g.x0) / g.k, dy = (e.clientY - g.y0) / g.k;
    if (!g.moved) {
      if (Math.hypot(dx, dy) < SLOP) return;                   // still a tap: the row does not move
      g.moved = true;                                           // no longer a tap (its click is swallowed)
      if (Math.abs(dx) <= Math.abs(dy) * 1.2) return;          // vertical: leave it to the list scroll
      g.on = true;
      g.xs = dx;                                                // start moving from 0, no jump
      g.row.classList.add("is-drag");                           // (no pressed highlight while dragging)
      try { g.row.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events */ }
    }
    if (!g.on) return;
    let x = dx - g.xs;
    g.dx = x;
    g.s.push([e.timeStamp, x]);
    if (g.s.length > 6) g.s.shift();
    if (x > 0) x *= 0.25;                                       // rubber band to the right
    if (x < -TRAY_W) x = -TRAY_W + (x + TRAY_W) * 0.25;         // past the tray: rubber band, never an action
    setX(g.row, x);
    busyUntil = now() + ANIM_MS;
    if (e.cancelable) e.preventDefault();
  }
  function up(e) {
    if (swallowPid !== null && e.pointerId === swallowPid) {
      swallowPid = null;
      swallowUntil = e.type === "pointercancel" ? 0 : now() + SWALLOW_MS;
    }
    if (!g || e.pointerId !== g.pid) return;
    const s = g;
    g = null;
    if (!s.moved) return;                                       // a plain tap: the row's own button handles it
    swallowUntil = e.type === "pointercancel" ? 0 : now() + SWALLOW_MS;
    if (!s.on) return;
    const [t0, x0] = s.s[0], [t1, x1] = s.s[s.s.length - 1];
    const v = (x1 - x0) / Math.max(16, t1 - t0);
    const open = e.type !== "pointercancel" && ((v < -FLING && s.dx < -FLING_MIN) || (v <= FLING && s.dx < -TRAY_W / 2));
    setRow(s.id, open);
  }
  function click(e) {
    const t = now();
    if (swallowUntil && t < swallowUntil) {
      swallowUntil = 0;
      e.preventDefault(); e.stopPropagation();
      return;
    }
    swallowUntil = 0;
    // a tray button pressed right as the tray opened (double tap on More, tap during the swipe)
    if (e.detail !== 0 && t - openedAt < GUARD_MS && e.target.closest?.(".mr-acts")) { e.preventDefault(); e.stopPropagation(); }
  }
  function key(e) {
    if (e.key !== "Escape" || !getOpen()) return;
    const id = getOpen();
    close();
    rowOf(id)?.querySelector(".mr-morebtn")?.focus({ preventScroll: true });
    e.preventDefault(); e.stopPropagation();
  }

  root.addEventListener("pointerdown", down);
  root.addEventListener("pointermove", move, { passive: false });
  root.addEventListener("pointerup", up);
  root.addEventListener("pointercancel", up);
  root.addEventListener("click", click, true);
  root.addEventListener("keydown", key);
  return {
    detach() {
      root.removeEventListener("pointerdown", down);
      root.removeEventListener("pointermove", move);
      root.removeEventListener("pointerup", up);
      root.removeEventListener("pointercancel", up);
      root.removeEventListener("click", click, true);
      root.removeEventListener("keydown", key);
      g = null;
    },
    /** Open / close a row's tray (the "More" button). focusTray: move focus to its first action. */
    toggle(id, focusTray = false) {
      const open = getOpen() !== id;
      setRow(id, open);
      if (open && focusTray) rowOf(id)?.querySelector(".mr-act")?.focus({ preventScroll: true });
    },
    close,
    /** True while a finger is dragging a row or a tray is animating (don't re-render rows now). */
    busy: () => !!(g && g.on) || now() < busyUntil,
  };
}
