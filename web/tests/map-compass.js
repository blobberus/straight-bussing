/** Tests for the heading cone: ui/compass.js (sensor -> heading) and MapApi.setHeading (map/map.js, geometry.unwrapDeg). */
import { test, eq, ok } from './lib.js';
import { norm, screenAngle, headingFromEvent, spreadFor, turn, changed, createCompass,
  SPREAD_DEFAULT, SPREAD_MIN, SPREAD_MAX, COMPASS_FRESH_MS, COURSE_FRESH_MS } from '../js/ui/compass.js';
import { unwrapDeg } from '../js/map/geometry.js';
import { createMap } from '../js/map/map.js';
import { P } from './map-fixtures.js';

test('compass: norm, turn, screenAngle', () => {
  eq(norm(370), 10); eq(norm(-10), 350); eq(norm(0), 0); eq(norm(360), 0);
  eq(turn(350, 10), 20); eq(turn(10, 350), -20); eq(turn(0, 180), 180); eq(turn(90, 90), 0);
  eq(screenAngle({ screen: { orientation: { angle: 90 } }, orientation: 0 }), 90, 'screen.orientation first');
  eq(screenAngle({ screen: {}, orientation: -90 }), -90, 'window.orientation fallback (older iOS)');
  eq(screenAngle({ screen: {} }), 0, 'unknown = portrait');
});

test('compass: headingFromEvent (iOS webkitCompassHeading, Android absolute alpha, relative ignored)', () => {
  eq(headingFromEvent({ type: 'deviceorientation', webkitCompassHeading: 45, webkitCompassAccuracy: 15, alpha: 200 }),
    { deg: 45, acc: 15 }, 'iOS: compass heading wins over alpha');
  eq(headingFromEvent({ type: 'deviceorientation', webkitCompassHeading: 45, webkitCompassAccuracy: -1 }).acc, -1, 'not calibrated kept');
  eq(headingFromEvent({ type: 'deviceorientationabsolute', alpha: 90, absolute: true }), { deg: 270, acc: null }, 'alpha counts counterclockwise');
  eq(headingFromEvent({ type: 'deviceorientation', alpha: 30, absolute: true }), { deg: 330, acc: null }, 'absolute deviceorientation (Firefox)');
  eq(headingFromEvent({ type: 'deviceorientation', alpha: 30, absolute: false }), null, 'relative alpha is not a direction');
  eq(headingFromEvent({ type: 'deviceorientationabsolute', alpha: null }), null, 'no sensor');
  eq(headingFromEvent({ type: 'deviceorientation', webkitCompassHeading: -1 }), null, 'iOS without a reading');
  eq(headingFromEvent(null), null);
  // landscape: facing north with the phone turned 90 deg counterclockwise, the device top points west (270)
  eq(headingFromEvent({ webkitCompassHeading: 270 }, 90).deg, 0, 'iOS landscape: + screen angle');
  eq(headingFromEvent({ type: 'deviceorientationabsolute', alpha: 90 }, 90).deg, 0, 'Android landscape: + screen angle');
  eq(headingFromEvent({ webkitCompassHeading: 90 }, -90).deg, 0, 'turned the other way');
});

test('compass: spreadFor (no invented precision) and changed', () => {
  eq(spreadFor(null), SPREAD_DEFAULT); eq(spreadFor(undefined), SPREAD_DEFAULT); eq(spreadFor(NaN), SPREAD_DEFAULT);
  eq(spreadFor(-1), SPREAD_MAX, 'not calibrated: wide open');
  eq(spreadFor(5), SPREAD_MIN, 'never narrower than the minimum');
  eq(spreadFor(25), 50); eq(spreadFor(90), SPREAD_MAX);
  ok(changed(null, { deg: 0, spread: 60 }) && changed({ deg: 0, spread: 60 }, null), 'appear / go');
  ok(!changed(null, null));
  ok(!changed({ deg: 359, spread: 60 }, { deg: 0.5, spread: 60 }), '1.5 deg across north: no redraw');
  ok(changed({ deg: 359, spread: 60 }, { deg: 2, spread: 60 }), '3 deg across north: redraw');
  ok(changed({ deg: 10, spread: 60 }, { deg: 10, spread: 80 }), 'width change');
});

test('geometry.unwrapDeg: a turn across north continues the short way', () => {
  eq(unwrapDeg(NaN, 370), 10);
  eq(unwrapDeg(350, 10), 370);
  eq(unwrapDeg(370, 5), 365);
  eq(unwrapDeg(10, 350), -10);
  eq(unwrapDeg(0, 180), 180);
  eq(unwrapDeg(720, 90), 810);
});

/** A fake window/document pair: listeners, visibility, an optional iOS permission prompt. */
function fakeEnv({ absolute = false, perm = null } = {}) {
  const ls = {}, dls = {};
  const win = {
    screen: { orientation: { angle: 0 } },
    addEventListener(n, f) { (ls[n] = ls[n] || new Set()).add(f); },
    removeEventListener(n, f) { ls[n]?.delete(f); },
  };
  if (absolute) win.ondeviceorientationabsolute = null;
  if (perm) win.DeviceOrientationEvent = { requestPermission: () => { perm.asked++; return Promise.resolve(perm.answer); } };
  const doc = { hidden: false, addEventListener(n, f) { (dls[n] = dls[n] || new Set()).add(f); } };
  const fire = (n, e) => { for (const f of ls[n] || []) f({ type: n, ...e }); };
  const count = (n) => (ls[n] ? ls[n].size : 0);
  const setHidden = (h) => { doc.hidden = h; for (const f of dls.visibilitychange || []) f(); };
  return { win, doc, fire, count, setHidden };
}
function harness(env) {
  let t = 1000;
  const calls = [];
  const c = createCompass({ onHeading: (d, w) => calls.push([d, w]), win: env.win, doc: env.doc, now: () => t, raf: (fn) => fn() });
  return { c, calls, tick: (ms) => { t += ms; } };
}

test('createCompass: iOS compass readings, coalesced, then stop', async () => {
  const perm = { asked: 0, answer: 'granted' };
  const env = fakeEnv({ perm });
  const { c, calls } = harness(env);
  env.fire('deviceorientation', { webkitCompassHeading: 90, webkitCompassAccuracy: 10 });
  eq(calls.length, 0, 'nothing before location sharing starts');
  eq(env.count('deviceorientation'), 0, 'no listener before start');
  c.start();
  eq(env.count('deviceorientation'), 1, 'iOS: deviceorientation');
  env.fire('deviceorientation', { webkitCompassHeading: 90, webkitCompassAccuracy: 10 });
  eq(calls, [[90, 40]]);
  env.fire('deviceorientation', { webkitCompassHeading: 91, webkitCompassAccuracy: 10 });
  eq(calls.length, 1, 'a 1 deg wobble is not redrawn');
  env.fire('deviceorientation', { webkitCompassHeading: 100, webkitCompassAccuracy: 10 });
  eq(calls[1], [100, 40]);
  c.request();
  await Promise.resolve();
  eq(perm.asked, 0, 'the compass already reads: no prompt');
  c.stop();
  eq(calls[2], [null, undefined], 'stop hides the cone');
  eq(env.count('deviceorientation'), 0, 'stop removes the listener');
  env.fire('deviceorientation', { webkitCompassHeading: 120 });
  eq(calls.length, 3, 'nothing after stop');
});

test('createCompass: iOS permission asked only by request(), listener re-attached once granted', async () => {
  const perm = { asked: 0, answer: 'granted' };
  const env = fakeEnv({ perm });
  const { c, calls } = harness(env);
  c.start();
  eq(perm.asked, 0, 'start never prompts (launch)');
  c.request();
  eq(perm.asked, 1, 'request prompts synchronously, inside the tap');
  await new Promise((r) => setTimeout(r, 0));
  eq(env.count('deviceorientation'), 1, 'one listener after the grant');
  env.fire('deviceorientation', { webkitCompassHeading: 10 });
  eq(calls[0], [10, SPREAD_DEFAULT], 'no accuracy given: default width');
  const env2 = fakeEnv({ perm: { asked: 0, answer: 'denied' } });
  const h2 = harness(env2);
  h2.c.start(); h2.c.request();
  await new Promise((r) => setTimeout(r, 0));
  eq(h2.calls.length, 0, 'denied: plain dot');
});

test('createCompass: Android absolute events, hidden page detaches', () => {
  const env = fakeEnv({ absolute: true });
  const { c, calls } = harness(env);
  c.start();
  eq(env.count('deviceorientationabsolute'), 1);
  env.fire('deviceorientation', { alpha: 40, absolute: false });
  eq(calls.length, 0, 'relative reading ignored');
  env.fire('deviceorientationabsolute', { alpha: 40, absolute: true });
  eq(calls[0], [320, SPREAD_DEFAULT]);
  env.setHidden(true);
  eq(env.count('deviceorientationabsolute') + env.count('deviceorientation'), 0, 'hidden: no listeners');
  env.setHidden(false);
  eq(env.count('deviceorientationabsolute'), 1, 'visible again: listening');
  c.request();   // no requestPermission API: nothing to do, never throws
});

test('createCompass: GPS course fallback, compass wins while fresh, stale readings drop the cone', () => {
  const env = fakeEnv({ absolute: true });
  const { c, calls, tick } = harness(env);
  c.start();
  c.course({ heading: 180, speed: 0.4 });
  eq(calls.length, 0, 'standing still: no course');
  c.course({ heading: NaN, speed: 2 });
  eq(calls.length, 0, 'no course reported');
  c.course({ heading: 180, speed: 1.4 });
  eq(calls[0], [180, SPREAD_DEFAULT], 'walking: the course');
  env.fire('deviceorientationabsolute', { alpha: 270 });
  eq(calls[1], [90, SPREAD_DEFAULT], 'compass takes over');
  c.course({ heading: 200, speed: 1.4 });
  eq(calls.length, 2, 'course ignored while the compass is fresh');
  tick(COMPASS_FRESH_MS + 1);
  c.course({ heading: 200, speed: 1.4 });
  eq(calls[2], [200, SPREAD_DEFAULT], 'compass silent: back to the course');
  tick(COURSE_FRESH_MS + 1);
  c.course(null);
  eq(c.current(), null, 'everything stale');
  c.course({ heading: 200, speed: 0 });
  eq(calls[calls.length - 1], [null, undefined], 'stopped walking: plain dot');
});

test('MapApi.setHeading: cone shown, turned the short way, sized, hidden, kept for a new dot', () => {
  const d = document.createElement('div');
  d.id = 't-head';
  d.style.cssText = 'position:absolute;left:-2000px;top:0;width:400px;height:600px';
  document.body.appendChild(d);
  const api = createMap('t-head');
  const el = api.leaflet.getContainer();
  eq(typeof api.setHeading, 'function');
  api.setHeading(45, 50);   // before any dot: remembered
  api.setUser({ lat: P(1, 1)[0], lon: P(1, 1)[1], accuracy: 10 });
  const icon = el.querySelector('.sb-meicon'), cone = el.querySelector('.sb-mecone');
  ok(icon && cone && el.querySelector('.sb-me'), 'dot + cone markup');
  ok(icon.classList.contains('sb-me-head'), 'cone on');
  eq(cone.style.getPropertyValue('--sb-head'), '45deg');
  eq(cone.style.getPropertyValue('--sb-spread'), '50deg');
  ok(getComputedStyle(cone).display !== 'none', 'cone visible');
  ok(getComputedStyle(cone).pointerEvents === 'none', 'cone never takes a tap');
  api.setHeading(340);
  eq(cone.style.getPropertyValue('--sb-head'), '-20deg', '45 -> 340 turns 65 deg counterclockwise, not 295 clockwise');
  api.setUser(null); api.setHeading(350);
  api.setUser({ lat: P(1, 1)[0], lon: P(1, 1)[1], accuracy: 10 });
  const icon2 = el.querySelector('.sb-meicon'), cone2 = el.querySelector('.sb-mecone');
  eq(cone2.style.getPropertyValue('--sb-head'), '350deg', 'a new dot starts from the plain heading');
  api.setHeading(10);
  eq(cone2.style.getPropertyValue('--sb-head'), '370deg', '350 -> 10 turns 20 deg, not 340 back');
  eq(cone2.style.getPropertyValue('--sb-spread'), '60deg', 'default width');
  api.setHeading(10, 999);
  eq(cone2.style.getPropertyValue('--sb-spread'), '160deg', 'width clamped');
  api.setHeading(null);
  ok(!icon2.classList.contains('sb-me-head'), 'null hides');
  eq(getComputedStyle(cone2).display, 'none');
  api.setHeading(90);
  api.setUser(null);
  ok(!el.querySelector('.sb-mecone'), 'no dot, no cone');
  api.setUser({ lat: P(2, 2)[0], lon: P(2, 2)[1] });
  ok(el.querySelector('.sb-meicon').classList.contains('sb-me-head'), 'a new dot gets the current heading');
  eq(el.querySelector('.sb-mecone').style.getPropertyValue('--sb-head'), '90deg');
  el.classList.add('sb-you-onbus');
  eq(getComputedStyle(el.querySelector('.sb-meicon')).display, 'none', 'on the bus the dot and its cone step back');
  api.leaflet.remove();
});
