/**
 * @module ui/views/myroutes-patch
 * In-place DOM patching for the My Routes views. Instead of replacing a view's innerHTML on every
 * store change (live feed every 10 s, map visibility, countdown ticks), morph() walks the new markup
 * against the live DOM and only touches what changed: unchanged rows keep their elements, so taps,
 * hover, focus, running transitions and a swipe in progress are never interrupted, and nothing
 * re-flows. Elements with data-key are matched by key (rows can be added, removed or reordered);
 * other nodes are matched by position and tag. Inline `style` set by script (a row being dragged)
 * is kept unless the new markup sets its own.
 */

const sameNode = (a, b) => a.nodeType === b.nodeType && (a.nodeType !== 1 || a.tagName === b.tagName);
const keyOf = (n) => (n.nodeType === 1 ? n.getAttribute("data-key") : null);

function syncAttrs(from, to) {
  for (const a of [...from.attributes]) if (a.name !== "style" && !to.hasAttribute(a.name)) from.removeAttribute(a.name);
  for (const a of to.attributes) if (from.getAttribute(a.name) !== a.value) from.setAttribute(a.name, a.value);
}

function morphNode(from, to) {
  if (from.nodeType !== 1) {
    if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue;
    return;
  }
  syncAttrs(from, to);
  morphChildren(from, to);
}

function morphChildren(from, to) {
  const next = [...to.childNodes];
  const keyed = new Map();
  for (const n of from.childNodes) { const k = keyOf(n); if (k) keyed.set(k, n); }
  next.forEach((nn, j) => {
    const cur = from.childNodes[j] || null;
    const k = keyOf(nn);
    let match = k ? keyed.get(k) : cur && !keyOf(cur) && sameNode(cur, nn) ? cur : null;
    if (match && !sameNode(match, nn)) match = null;
    if (match) {
      if (k) keyed.delete(k);
      if (match !== cur) from.insertBefore(match, cur);
      morphNode(match, nn);
    } else {
      from.insertBefore(nn, cur);   // moves the parsed node in (it is not reused afterwards)
    }
  });
  while (from.childNodes.length > next.length) from.lastChild.remove();
}

/**
 * Make `root`'s children match `html`, reusing every element that can be kept.
 * @param {Element} root
 * @param {string} html
 */
export function morph(root, html) {
  const t = document.createElement("template");
  t.innerHTML = html;
  morphChildren(root, t.content);
}

/**
 * Patch a mounted view's root from a build function (morph, see above). A patch waits while a
 * pointer is down anywhere in the root (released on pointerup / pointercancel anywhere in the
 * window, or after 4 s at the latest) and while opts.busy() says an animation is running.
 * Keyboard focus survives because focused elements are kept; if the focused element itself went
 * away, focus moves to the element with the same data-fkey / data-action+data-id, if any.
 * @param {HTMLElement} root
 * @param {() => string} build
 * @param {{busy?: () => boolean}} [opts]
 * @returns {{flush():void, stop():void}}
 */
export function createPatcher(root, build, opts = {}) {
  let held = false, pending = false, last = null, retry = 0, holdTimer = 0;
  const flush = () => {
    if (held || opts.busy?.()) {
      pending = true;
      if (!held && !retry) retry = setTimeout(() => { retry = 0; if (pending) flush(); }, 120);
      return;
    }
    pending = false;
    const h = build();
    if (h === last) return;
    last = h;
    const a = document.activeElement, had = a && a !== root && root.contains(a);
    const ds = had ? a.dataset || {} : {};
    const attr = (keys) => keys.filter((k) => ds[k] != null).map((k) => `[data-${k}="${CSS.escape(ds[k])}"]`).join("");
    // where focus goes if the focused element is moved / disabled / removed by the patch (first enabled match)
    const sels = ds.fkey ? [attr(["fkey"])] : ds.action ? [attr(["action", "id", "rid", "dir"]), attr(["action", "id"])] : [];
    morph(root, h);
    if (!had || root.contains(document.activeElement)) return;
    for (const s of sels) {
      const el = [...root.querySelectorAll(s)].find((n) => !n.disabled);
      if (el) { el.focus({ preventScroll: true }); if (document.activeElement === el) return; }
    }
  };
  const release = () => {
    if (!held) return;
    clearTimeout(holdTimer);
    removeEventListener("pointerup", up, true);
    removeEventListener("pointercancel", up, true);
    held = false;
    if (pending) flush();
  };
  const up = () => setTimeout(release, 0);   // after the click that follows pointerup (mouse)
  const down = () => {
    if (held) return;
    held = true;
    addEventListener("pointerup", up, true);
    addEventListener("pointercancel", up, true);
    holdTimer = setTimeout(release, 4000);
  };
  root.addEventListener("pointerdown", down, true);
  return {
    flush,
    stop() {
      root.removeEventListener("pointerdown", down, true);
      clearTimeout(retry); clearTimeout(holdTimer);
      removeEventListener("pointerup", up, true);
      removeEventListener("pointercancel", up, true);
      held = false;
    },
  };
}
