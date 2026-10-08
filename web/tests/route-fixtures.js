// Schedule fixture for the ROUTE tests (route.test.html).
const day = (first, last, buses, spans) => ({ first, last, trips: 10, buses, spans: spans || [[first, last]] });
const night = () => {
  const b = Array(24).fill(0);
  for (const h of [16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4]) b[h] = h < 5 ? 1 : 2;
  return day("16:00", "28:29", b);
};
const wk = () => {
  const b = Array(24).fill(0);
  for (let h = 7; h <= 19; h++) b[h] = h >= 8 && h <= 10 ? 3 : 1;
  return day("07:00", "19:25", b);
};

/** service.json-shaped fixture: N = every-night route, D = weekday day route with calendar changes. */
export function serviceFixture() {
  return {
    feed: { start: "2026-10-07", end: "2026-12-31" },
    routes: {
      N: { days: { mon: night(), tue: night(), wed: night(), thu: night(), fri: night(), sat: night(), sun: night() }, exceptions: [] },
      D: {
        days: { mon: wk(), tue: wk(), wed: wk(), thu: wk(), fri: wk(), sat: null, sun: null },
        exceptions: [
          { date: "2026-10-10", type: "added", days: "sat", hours: { first: "10:00", last: "14:00", trips: 4, spans: [["10:00", "14:00"]] } },
          { date: "2026-11-26", type: "removed", days: "thu", hours: null },
        ],
      },
      R1: { days: { mon: wk(), tue: wk(), wed: wk(), thu: wk(), fri: wk(), sat: null, sun: null }, exceptions: [] },
    },
  };
}

/** unix seconds for a UTC ISO string. */
export const utc = (iso) => Date.parse(iso) / 1000;
