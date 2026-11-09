import { test, eq, ok } from './lib.js';
import { createStore } from '../js/core/store.js';
import { loadStatic, STATIC_FILES } from '../js/data/static.js';
import { cleanTimetable, loadTimetable, timetableNow, _setTimetable } from '../js/data/timetable.js';
import { res, stubFetch } from './data-helpers.js';

// Directions' "Leave at" (owner 2026-11-09): the timetable loads only when a start time is chosen

const TT = {
  v: 1, generated: '2026-11-09T19:00:00Z', feed: { start: '2026-11-08', end: '2026-12-09' },
  services: { WK: { days: '1111100', start: '2025-01-01', end: '2027-12-31' }, BAD: { days: 'weekdays' } },
  dates: { '2026-11-26': { WK: 2, X: 7 }, nope: { WK: 1 } },
  routes: {
    R: [{ stops: ['A', 'B', 'A'], t: [0, 300, 600], starts: { WK: [36000, 28800], BAD: [1], ZZ: [5] } },
      { stops: ['A'], t: [0], starts: { WK: [1] } },                       // one stop: dropped
      { stops: ['A', 'B'], t: [0, -5], starts: { WK: [1] } },              // time going backwards: dropped
      { stops: ['A', 'B'], t: [0, 60], starts: { BAD: [1] } }],            // no known service left: dropped
    Q: 'junk',
  },
};

test('timetable: cleanTimetable keeps the good parts and sorts the starts', () => {
  const c = cleanTimetable(TT);
  eq(Object.keys(c.services), ['WK'], 'a service with bad days is dropped');
  eq(c.dates, { '2026-11-26': { WK: 2 } }, 'only 1 / 2 on real dates');
  eq(c.routes, { R: [{ stops: ['A', 'B', 'A'], t: [0, 300, 600], starts: { WK: [28800, 36000] } }] });
  eq(c.feed, { start: '2026-11-08', end: '2026-12-09' });
  eq(cleanTimetable(null), null);
  eq(cleanTimetable({ routes: {}, services: {} }), null, 'nothing usable');
});

test('timetable: not part of the boot files (first paint never waits for it)', async () => {
  ok(!STATIC_FILES.some(([, f]) => f === 'timetable.json'), 'not in STATIC_FILES');
  const f = stubFetch(() => res({}));
  await loadStatic(createStore({}), { base: 'data/', fetch: f });
  ok(!f.calls.some((c) => c.url.includes('timetable')), 'loadStatic never asks for it');
});

test('timetable: loads once, shares one request, retries after a failure', async () => {
  _setTimetable(null);
  let fail = true;
  const f = stubFetch(() => (fail ? res(null, 503) : res(TT)));
  eq(await loadTimetable({ fetch: f }), null, 'a failed load resolves null');
  eq(timetableNow(), null);
  fail = false;
  const [a, b] = await Promise.all([loadTimetable({ fetch: f }), loadTimetable({ fetch: f })]);
  ok(a && a === b, 'both callers get the same copy');
  eq(f.calls.length, 2, 'one request for the two callers (after the failed one)');
  eq(f.calls[1].url, 'data/timetable.json');
  ok(timetableNow() === a);
  await loadTimetable({ fetch: f });
  eq(f.calls.length, 2, 'cached afterwards');
  const thrown = stubFetch(() => { throw new Error('offline'); });
  _setTimetable(null);
  eq(await loadTimetable({ fetch: thrown }), null, 'never rejects');
  _setTimetable(null);
});

test('timetable: the real file loads and is small', async () => {
  _setTimetable(null);
  const r = await fetch('../data/timetable.json');
  const bytes = (await r.clone().text()).length;
  ok(bytes < 40000, 'about 11 kB: ' + bytes);
  const c = cleanTimetable(await r.json());
  ok(c && c.routes['4346'] && c.routes['4346'].length >= 1, 'the 53rd Street Express is in it');
  eq(Object.keys(c.routes).length >= 10, true, 'most routes have trips');
});
