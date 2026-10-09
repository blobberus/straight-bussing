/**
 * @module ui/views/myroutes-swipe
 * Apple-Music-style swipe actions for custom route rows: drag a row left to reveal its action tray
 * (Details, Edit, Delete). A full or fast swipe only OPENS the tray; it never runs an action, so
 * Delete always needs its own tap plus the confirmation popup (ui/confirm.js).
 * Markup (myroutes.js): .mr-swipe[data-swipe-id] > .mr-acts (tray, inert while closed) + .mr-front
 * (the row). The open row id lives with the caller, so re-renders keep it (.is-open sets the offset).
 * While a tray is open, a tap anywhere else in the list only closes it (like iOS).
 */

/** Width of the action tray: three 72px buttons. */
export const TRAY_W = 216;
const SLOP = 8;          // px before a drag is decided
const FLING = 0.45;      // px/ms that counts as a fling...
const FLING_MIN = 48;    // ...but only after this much travel (a tiny flick never opens the tray)

/**
 * Wire swipe gestures on a list root.
 * @param {HTMLElement} root
 * @param {{getOpen:() => (string|null), setOpen:(id:string|null) => void}} state
 * @returns {() => void} detach
 */
export function attachSwipe(root, { getOpen, setOpen }) {
  let g = null, suppress = false, timer = 0;
  const front = (row) => row && row.querySelector(".mr-front");
  const setX = (row, x, animate) => {
    const f = front(row);
    if (!f) return;
    f.style.transition = animate ? "" : "none";
    f.style.transform = `translate3d(${x}px, 0, 0)`;
  };
  const swallowNextClick = () => { suppress = true; clearTimeout(timer); timer = setTimeout(() => { suppress = false; }, 450); };
  const rowOf = (id) => id && root.querySelector(`.mr-swipe[data-swipe-id="${CSS.escape(id)}"]`);
  const close = () => {
    const id = getOpen(), row = rowOf(id);
    if (!id) return;
    if (row) setX(row, 0, true);
    setTimeout(() => { if (getOpen() === id) setOpen(null); }, 180);
  };

  function down(e) {
    if (e.button > 0) return;
    const row = e.target.closest?.(".mr-swipe");
    const openId = getOpen();
    if (openId && !(row && row.dataset.swipeId === openId && e.target.closest(".mr-acts, .mr-more"))) {
      close();                       // any other tap only closes the open tray
      swallowNextClick();
      return;
    }
    if (!row || e.target.closest(".mr-acts, .mr-more")) return;
    g = { row, id: row.dataset.swipeId, x0: e.clientX, y0: e.clientY, dx: 0, on: false, t: e.timeStamp, pid: e.pointerId, last: [e.timeStamp, e.clientX] };
  }
  function move(e) {
    if (!g || e.pointerId !== g.pid) return;
    const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
    if (!g.on) {
      if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
      if (Math.abs(dy) >= Math.abs(dx)) { g = null; return; }   // vertical: the list scrolls
      g.on = true;
      try { g.row.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events */ }
    }
    g.prev = g.last; g.last = [e.timeStamp, e.clientX];
    g.dx = dx;
    let x = dx;
    if (x > 0) x *= 0.25;                                      // rubber band to the right
    if (x < -TRAY_W) x = -TRAY_W + (x + TRAY_W) * 0.25;         // past the tray: rubber band, never an action
    setX(g.row, x, false);
    if (e.cancelable) e.preventDefault();
  }
  function up(e) {
    if (!g || e.pointerId !== g.pid) return;
    const s = g;
    g = null;
    if (!s.on) return;                                         // a plain tap: the row's own button handles it
    swallowNextClick();                                        // the click after a drag must not toggle the route
    const [t0, x0] = s.prev || [s.t, s.x0], [t1, x1] = s.last;
    const v = (x1 - x0) / Math.max(16, t1 - t0);
    const open = e.type !== "pointercancel" && ((v < -FLING && s.dx < -FLING_MIN) || (v <= FLING && s.dx < -TRAY_W / 2));
    setX(s.row, open ? -TRAY_W : 0, true);
    setTimeout(() => setOpen(open ? s.id : null), 180);
  }
  function click(e) {
    if (!suppress) return;
    suppress = false;
    e.preventDefault();
    e.stopPropagation();
  }

  root.addEventListener("pointerdown", down);
  root.addEventListener("pointermove", move, { passive: false });
  root.addEventListener("pointerup", up);
  root.addEventListener("pointercancel", up);
  root.addEventListener("click", click, true);
  return () => {
    clearTimeout(timer);
    root.removeEventListener("pointerdown", down);
    root.removeEventListener("pointermove", move);
    root.removeEventListener("pointerup", up);
    root.removeEventListener("pointercancel", up);
    root.removeEventListener("click", click, true);
  };
}
