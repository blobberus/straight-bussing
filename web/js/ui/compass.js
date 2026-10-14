/**
 * @module ui/compass
 * The way the rider faces, for the heading cone on the location dot (MapApi.setHeading; owner 2026-10-14: "the
 * tracking dot should have a direction based on the user's heading"). Sources, best first:
 *  1. the compass: iOS Safari `deviceorientation` + `webkitCompassHeading` (iOS 13+ shows it only after
 *     `DeviceOrientationEvent.requestPermission()`, which must run inside a tap: `request()`, called from the taps that
 *     ask for the location, never at launch); Chrome / Android `deviceorientationabsolute` (or an `absolute`
 *     `deviceorientation`), heading = 360 - alpha;
 *  2. the GPS course (`coords.heading`) while moving at least COURSE_MIN_MPS (walking or riding);
 *  3. nothing: the plain dot, as before.
 * The heading never enters the store (sensor events come at up to 60 Hz): readings are coalesced to one per
 * animation frame and passed on only when they turn at least MIN_STEP_DEG. Nothing is stored or sent anywhere; the
 * listener is off while location sharing is off or the page is hidden.
 */

export const COURSE_MIN_MPS = 1;       // slower than this, the GPS course is noise
export const COMPASS_FRESH_MS = 3000;  // a compass silent this long gives way to the course
export const COURSE_FRESH_MS = 10000;  // a course with no fix since this long is dropped (standing still sends no fixes)
export const MIN_STEP_DEG = 2;         // smaller turns are not redrawn
export const SPREAD_DEFAULT = 60;      // cone width (deg) when the source gives no accuracy (Android, the GPS course)
export const SPREAD_MIN = 40, SPREAD_MAX = 120;

/** @param {number} d degrees @returns {number} 0 <= x < 360 */
export function norm(d) {
  const x = d % 360;
  return x < 0 ? x + 360 : x;
}

/**
 * How far the screen is turned from the device's natural (portrait) orientation, degrees: `screen.orientation.angle`
 * (iOS 16.4+, Chrome), else the older `window.orientation` (may be -90). 0 when unknown.
 * @param {object} [w] window
 */
export function screenAngle(w = globalThis) {
  const a = w && w.screen && w.screen.orientation ? +w.screen.orientation.angle : NaN;
  if (Number.isFinite(a)) return a;
  const o = w ? +w.orientation : NaN;
  return Number.isFinite(o) ? o : 0;
}

/**
 * Compass heading (deg clockwise from north) of the TOP OF THE SCREEN from an orientation event, or null.
 * Both sources give the heading of the device's top edge in portrait. Turned to landscape the screen's top is another
 * edge: the phone rotated 90 deg counterclockwise (screen angle 90) has its top edge pointing 90 deg left of where
 * the rider faces, so the screen top's heading is the device heading + the screen angle (portrait facing north,
 * then turned: webkitCompassHeading / 360 - alpha read 270, + 90 = 0, still north). alpha itself counts
 * counterclockwise, hence 360 - alpha. Not yet checked on a real phone in landscape.
 * @param {{type?:string, webkitCompassHeading?:number, webkitCompassAccuracy?:number, alpha?:number|null, absolute?:boolean}} e
 * @param {number} [angle] screen angle (screenAngle())
 * @returns {{deg:number, acc:number|null}|null} acc: compass accuracy in deg (iOS only; < 0 = not calibrated)
 */
export function headingFromEvent(e, angle = 0) {
  if (!e) return null;
  const wk = e.webkitCompassHeading;
  let raw = null, acc = null;
  if (typeof wk === "number" && Number.isFinite(wk) && wk >= 0) {
    raw = wk;
    acc = Number.isFinite(e.webkitCompassAccuracy) ? e.webkitCompassAccuracy : null;
  } else if ((e.type === "deviceorientationabsolute" || e.absolute === true) && typeof e.alpha === "number" && Number.isFinite(e.alpha)) {
    raw = 360 - e.alpha;   // a relative alpha (absolute false: 0 = wherever the page loaded) is not a direction
  }
  if (raw === null) return null;
  return { deg: norm(raw + (Number.isFinite(angle) ? angle : 0)), acc };
}

/**
 * Cone width (deg) for a compass accuracy: twice the stated error (+/- acc), never so narrow it claims more than the
 * sensor knows, wide open when the compass says it is not calibrated (acc < 0).
 * @param {number|null|undefined} acc
 */
export function spreadFor(acc) {
  if (acc === null || acc === undefined || !Number.isFinite(acc)) return SPREAD_DEFAULT;
  if (acc < 0) return SPREAD_MAX;
  return Math.max(SPREAD_MIN, Math.min(SPREAD_MAX, Math.round(2 * acc)));
}

/** Smallest signed turn from a to b, degrees (-180 < x <= 180). */
export function turn(a, b) {
  return 180 - norm(180 - (b - a));
}

/**
 * Worth redrawing? A cone appears / goes, turns at least MIN_STEP_DEG, or changes width.
 * @param {{deg:number, spread:number}|null} prev
 * @param {{deg:number, spread:number}|null} next
 */
export function changed(prev, next) {
  if (!prev || !next) return !prev !== !next;
  return Math.abs(turn(prev.deg, next.deg)) >= MIN_STEP_DEG || prev.spread !== next.spread;
}

/**
 * Start the heading source.
 * @param {{onHeading:(deg:number|null, spread?:number)=>void, win?:object, doc?:object, now?:()=>number,
 *   raf?:(fn:Function)=>any}} o test seams: win (window), doc (document), now (ms), raf (requestAnimationFrame)
 * @returns {{start():void, stop():void, request():void, course(coords:object|null):void, current():object|null}}
 *   start: location sharing is on; stop: it is off (cone gone, listener off); request: ask for the iOS compass
 *   permission (call inside a tap); course: a position fix (its heading + speed)
 */
export function createCompass(o) {
  const win = o.win || globalThis, doc = o.doc || globalThis.document;
  const now = o.now || (() => Date.now());
  const raf = o.raf || ((fn) => (win.requestAnimationFrame ? win.requestAnimationFrame(fn) : setTimeout(fn, 16)));
  const evName = win && "ondeviceorientationabsolute" in win ? "deviceorientationabsolute" : "deviceorientation";
  let active = false, listening = false, pending = false, timer = 0, sawCompass = false;
  let compass = null, course = null, shown = null;

  function onEvent(e) {
    const h = headingFromEvent(e, screenAngle(win));
    if (!h) return;
    sawCompass = true;
    compass = { deg: h.deg, spread: spreadFor(h.acc), at: now() };
    schedule();
  }
  function attach() {
    if (listening || !active || (doc && doc.hidden) || !win || !win.addEventListener) return;
    win.addEventListener(evName, onEvent);
    // iOS has no deviceorientationabsolute; Chrome sends absolute readings there and relative ones here
    if (evName === "deviceorientationabsolute") win.addEventListener("deviceorientation", onEvent);
    listening = true;
  }
  function detach() {
    if (!listening) return;
    win.removeEventListener(evName, onEvent);
    if (evName === "deviceorientationabsolute") win.removeEventListener("deviceorientation", onEvent);
    listening = false;
  }
  function current() {
    if (!active) return null;
    const t = now();
    if (compass && t - compass.at <= COMPASS_FRESH_MS) return { deg: compass.deg, spread: compass.spread };
    if (course && t - course.at <= COURSE_FRESH_MS) return { deg: course.deg, spread: SPREAD_DEFAULT };
    return null;
  }
  function flush() {
    pending = false;
    const cur = current();
    clearTimeout(timer);
    if (cur) timer = setTimeout(schedule, 1000);   // readings stopped coming: drop the cone once they are stale
    if (!changed(shown, cur)) return;
    shown = cur;
    o.onHeading(cur ? cur.deg : null, cur ? cur.spread : undefined);
  }
  function schedule() {
    if (pending) return;
    pending = true;
    raf(flush);
  }
  if (doc && doc.addEventListener) doc.addEventListener("visibilitychange", () => (doc.hidden ? detach() : attach()));

  return {
    start() { active = true; attach(); },
    stop() {
      active = false;
      detach();
      compass = course = null;
      clearTimeout(timer);
      if (shown) { shown = null; o.onHeading(null); }
    },
    request() {
      const D = win && win.DeviceOrientationEvent;
      if (sawCompass || !D || typeof D.requestPermission !== "function") return;
      try {
        Promise.resolve(D.requestPermission()).then((r) => { if (r === "granted") { detach(); attach(); } }).catch(() => {});
      } catch (e) { /* not in a tap, or no such API */ }
    },
    course(c) {
      if (!c) return;
      const sp = c.speed, hd = c.heading;
      if (typeof hd === "number" && Number.isFinite(hd) && typeof sp === "number" && sp >= COURSE_MIN_MPS) course = { deg: norm(hd), at: now() };
      else if (typeof sp === "number" && Number.isFinite(sp) && sp < COURSE_MIN_MPS) course = null;   // stopped
      schedule();
    },
    current,
  };
}
