import { test, eq, ok, near } from './lib.js';
import { createStore } from '../js/core/store.js';
import { startLive, BASE, parseTrips } from '../js/data/live.js';
import { res, hang, stubFetch, sleep, setHidden, feeds, feedName } from './data-helpers.js';

const initial = () => createStore({ buses: [], trips: [], alerts: [], feedTs: 0, lastOk: 0, failed: false, liveLoaded: false });
/** fetch stub driven by a mutable mode: 'ok' | 'fail' | 'vpfail' | 'alertsfail' | 'hang' */
function modal(mode = 'ok') {
  const st = { mode };
  const f = stubFetch((url, init) => {
    const name = feedName(url);
    if (st.mode === 'hang') return hang(init.signal);
    if (st.mode === 'fail') throw new TypeError('Failed to fetch');
    if (st.mode === 'vpfail' && name === 'vehiclePositions') return res(null, 503);
    if (st.mode === 'alertsfail' && name === 'serviceAlerts') return res(null, 500);
    return res(feeds()[name]);
  });
  f.st = st;
  return f;
}
const pollsOf = (f) => f.calls.filter((c) => feedName(c.url) === 'vehiclePositions').length;
const fast = { intervalMs: 100000, backoffMs: 100000 }; // no timer-driven polls unless a test wants them

test('live: success fills buses/trips/alerts/feedTs/lastOk, 3 feeds in parallel, no-store + cache-buster', async () => {
  const store = initial();
  const f = modal('ok');
  const live = startLive(store, { ...fast, fetch: f });
  try {
    await live.pollNow();
    const s = store.get();
    eq(f.calls.length, 3);
    eq(f.calls.map((c) => feedName(c.url)).sort(), ['serviceAlerts', 'tripUpdates', 'vehiclePositions']);
    ok(f.calls.every((c) => c.url.startsWith(BASE) && /\.json\?_=\d+$/.test(c.url) && c.init.cache === 'no-store' && c.init.signal), 'url/init');
    eq(s.buses.length, 1, 'bus without position dropped');
    eq(s.buses[0].timestamp, 1700000000 - 5, 'timestamp numeric');
    eq(s.trips[0].stop_time_update[0].arrival.time, 1700000060, 'arrival time coerced to number');
    eq(s.alerts, [{ header_text: 'Detour' }]);
    eq(s.feedTs, 1700000000);
    near(s.lastOk, Date.now() / 1000, 5);
    eq([s.failed, s.liveLoaded], [false, true]);
  } finally { live.stop(); }
});

test('live: failure keeps last good data and sets failed; lastOk unchanged', async () => {
  const store = initial();
  const f = modal('ok');
  const live = startLive(store, { ...fast, fetch: f });
  try {
    await live.pollNow();
    const before = store.get();
    f.st.mode = 'fail';
    await live.pollNow();
    const s = store.get();
    eq(s.failed, true);
    ok(s.buses === before.buses && s.trips === before.trips && s.alerts === before.alerts, 'data kept by reference');
    eq(s.lastOk, before.lastOk);
    eq(s.feedTs, before.feedTs);
    eq(live.failures(), 1);
  } finally { live.stop(); }
});

test('live: first poll failing still sets liveLoaded with failed:true', async () => {
  const store = initial();
  const live = startLive(store, { ...fast, fetch: modal('fail') });
  try {
    await live.pollNow();
    const s = store.get();
    eq([s.liveLoaded, s.failed, s.lastOk, s.buses], [true, true, 0, []]);
  } finally { live.stop(); }
});

test('live: alerts feed failing alone is tolerated (keeps previous alerts)', async () => {
  const store = initial();
  const f = modal('ok');
  const live = startLive(store, { ...fast, fetch: f });
  try {
    await live.pollNow();
    const alerts = store.get().alerts;
    f.st.mode = 'alertsfail';
    await live.pollNow();
    eq(store.get().failed, false);
    ok(store.get().alerts === alerts);
    eq(live.failures(), 0);
  } finally { live.stop(); }
});

test('live: vehiclePositions failing applies tripUpdates but flags failed', async () => {
  const store = initial();
  const f = modal('vpfail');
  const live = startLive(store, { ...fast, fetch: f });
  try {
    await live.pollNow();
    const s = store.get();
    eq(s.failed, true);
    eq(s.trips.length, 1);
    eq(s.buses, []);
    eq(s.lastOk, 0);
  } finally { live.stop(); }
});

test('live: 8 s style timeout aborts hung requests and counts as failure', async () => {
  const store = initial();
  const f = modal('hang');
  const live = startLive(store, { ...fast, timeoutMs: 60, fetch: f });
  try {
    const t0 = performance.now();
    await live.pollNow();
    ok(performance.now() - t0 < 2000, 'returned after timeout');
    ok(f.calls.every((c) => c.init.signal.aborted), 'signals aborted');
    eq(store.get().failed, true);
    eq(live.failures(), 1);
  } finally { live.stop(); }
});

test('live: no overlapping polls (pollNow joins the in-flight poll)', async () => {
  const store = initial();
  const f = modal('hang');
  const live = startLive(store, { ...fast, timeoutMs: 80, fetch: f });
  try {
    const a = live.pollNow(), b = live.pollNow();
    ok(a === b, 'same promise');
    await a;
    eq(pollsOf(f), 1, 'only one poll ran');
  } finally { live.stop(); }
});

test('live: backs off to backoffMs after 3 consecutive failures, recovers on success', async () => {
  const store = initial();
  const f = modal('fail');
  const live = startLive(store, { intervalMs: 20, backoffMs: 400, fetch: f });
  try {
    await sleep(250);
    eq(pollsOf(f), 3, 'polled at 20 ms until 3 failures, then waits 400 ms');
    eq(live.failures(), 3);
    eq(live.delay(), 400);
    f.st.mode = 'ok';
    await live.pollNow();
    eq(live.failures(), 0);
    eq(live.delay(), 20, 'interval restored');
    eq(store.get().failed, false);
    const n = pollsOf(f);
    await sleep(110);
    ok(pollsOf(f) >= n + 3, 'fast polling resumed (' + (pollsOf(f) - n) + ' polls)');
  } finally { live.stop(); }
});

test('live: pauses while hidden, polls immediately on visible', async () => {
  const store = initial();
  const f = modal('ok');
  const live = startLive(store, { intervalMs: 15, fetch: f });
  let restore = () => {};
  try {
    await sleep(40);
    restore = setHidden(true);
    await sleep(30); // let any in-flight poll settle
    const n = pollsOf(f);
    await sleep(120);
    eq(pollsOf(f), n, 'no polls while hidden');
    restore();
    restore = setHidden(false);
    await sleep(5);
    ok(pollsOf(f) >= n + 1, 'polled on visible');
  } finally { live.stop(); restore(); }
});

test('live: started while hidden does nothing until visible', async () => {
  const store = initial();
  const f = modal('ok');
  let restore = setHidden(true);
  const live = startLive(store, { intervalMs: 10, fetch: f });
  try {
    await sleep(60);
    eq(f.calls.length, 0);
    eq(store.get().liveLoaded, false);
    restore();
    restore = setHidden(false);
    await sleep(20);
    eq(store.get().liveLoaded, true);
  } finally { live.stop(); restore(); }
});

test('live: stop() halts polling and ignores late results', async () => {
  const store = initial();
  const f = modal('ok');
  const live = startLive(store, { intervalMs: 10, fetch: f });
  await sleep(35);
  live.stop();
  const n = f.calls.length;
  await sleep(60);
  eq(f.calls.length, n, 'no polls after stop');
  await live.pollNow();
  eq(f.calls.length, n, 'pollNow is a no-op after stop');
});

test('live: parseTrips tolerates missing fields', () => {
  eq(parseTrips({ entity: [{ trip_update: { trip: {} } }, {}, null] }), [{ trip: {}, stop_time_update: [] }]);
  eq(parseTrips(null), []);
});
