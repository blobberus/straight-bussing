/*
 * Current trip at the half detent, in the real app at phone sizes (owner decisions 2026-10-11, Ship checklist 3: the
 * next bus in one glance, no taps). e2e.js registers these with its helpers; each test opens its own app iframe
 * (393 x 852, the frame size; 320 x 640) with the e2e stubs, so the shared session is untouched.
 */

/** Three trips per route 15 min apart: every stop on a route then has 3 arrivals (the most the block lists). */
function tripleTrips(T) {
  const feed = T.feed;
  T.feed = (name) => {
    const out = feed(name);
    if (name !== "tripUpdates") return out;
    const base = out.entity;
    out.entity = [0, 900, 1800].flatMap((dt) => base.map((e) => ({ id: e.id + "-" + dt, trip_update: { ...e.trip_update,
      trip: { ...e.trip_update.trip, trip_id: e.trip_update.trip.trip_id + (dt ? "-" + dt : "") },
      stop_time_update: e.trip_update.stop_time_update.map((u) => ({ stop_id: u.stop_id, arrival: { time: u.arrival.time + dt }, departure: { time: u.departure.time + dt } })) } })));
    return out;
  };
}

/**
 * Register the Current trip layout tests.
 * @param {{test:Function, ok:Function, eq:Function, waitFor:Function, openApp:(style:string)=>Promise<HTMLIFrameElement>}} h
 */
export function currentTripE2E({ test, ok, eq, waitFor, openApp }) {
  async function phone(style) {
    const f = await openApp(style);
    const w = f.contentWindow, d = w.document;
    await waitFor(() => w.__sb && w.__e2e && w.__sb.store.get().staticLoaded && w.__sb.store.get().liveLoaded, "phone-sized app", 15000);
    await w.__e2e.ready;
    tripleTrips(w.__e2e);
    w.dispatchEvent(new w.Event("online"));   // poll now with the new feed
    await waitFor(() => w.__sb.store.get().trips.length >= 3 * w.__e2e.routes.length, "three trips per route");
    const stop = w.__e2e.stops[w.__e2e.routes[0].stops[2]];
    w.__sb.store.set({ user: { lat: stop.lat, lon: stop.lon }, locState: "granted" });
    const hero = await waitFor(() => { const x = d.querySelector("#content .pt-next"); return x && x.querySelectorAll(".row.arr").length === 3 ? x : null; }, "the next-bus block with 3 arrivals");
    d.getElementById("sheet").style.transition = "none";   // read the settled half detent
    return { f, w, d, hero };
  }
  const box = (el) => el.getBoundingClientRect();

  test("current trip, 393 x 852 half detent: the alert row (one line) and the next bus (stop + 3 arrivals) are fully visible", async () => {
    const { f, w, d, hero } = await phone("width:393px;height:852px");
    try {
      eq(d.getElementById("sheet").dataset.detent, "half", "half detent");
      eq(d.getElementById("content").scrollTop, 0, "not scrolled");
      const head = box(d.getElementById("sheetHead")), nav = box(d.getElementById("tabs")), sheet = box(d.getElementById("sheet"));
      const visTop = Math.max(head.bottom, sheet.top), r = box(hero);
      ok(r.top >= visTop - 1 && r.bottom <= nav.top + 1, `next bus inside the half detent: ${Math.round(r.top)}-${Math.round(r.bottom)} in ${Math.round(visTop)}-${Math.round(nav.top)}`);
      const al = d.querySelector('#content [data-region="nearby-alert"] .v-alertbanner');
      ok(al, "the feed's alert shows as a row");
      const a = box(al), line = al.querySelector(".v-alertline");
      ok(a.bottom <= r.top + 1 && a.top >= visTop - 1, "alert row directly above the next bus, visible");
      ok(a.height <= 48 && line.scrollHeight <= parseFloat(w.getComputedStyle(line).lineHeight) * 1.5, "one line: " + Math.round(a.height) + " px");
      ok(!d.querySelector("#content .pt-notrip"), "no 'No trip in progress' card");
      const name = hero.querySelector(".pt-nexthead .v-prim");
      eq(name.textContent, w.__sb.store.get().stops[w.__e2e.routes[0].stops[2]].name, "the nearest stop's name, whole");
      for (const row of hero.querySelectorAll(".row.arr")) ok(box(row).height >= 44, "44 px rows");
      // no location: "Use my location" leads (right under the alert row), "Search stations" next
      w.__sb.store.set({ user: null, locState: "unknown" });
      const btn = await waitFor(() => d.querySelector('#content [data-region="nearby-loc"] [data-action="nearby:locate"]'), "Use my location");
      const b = box(btn), s = box(d.querySelector('#content [data-input="nearby-q"]'));
      ok(b.top - box(al).bottom < 20 && b.bottom <= nav.top, "Use my location right under the alert row");
      ok(s.top >= b.bottom && s.top - b.bottom < 24, "Search stations next");
      eq(d.querySelectorAll("#content .v-btn--primary").length, 1, "one primary action");
      eq(w.__e2e.errors, [], "no console errors");
    } finally {
      f.remove();
    }
  });

  test("current trip, 320 px wide: the next-bus block holds (no sideways overflow, the name is never cut)", async () => {
    const { f, w, d, hero } = await phone("width:320px;height:640px");
    try {
      const c = d.getElementById("content");
      ok(c.scrollWidth <= c.clientWidth + 1, `no sideways scroll: ${c.scrollWidth} > ${c.clientWidth}`);
      ok(box(hero).right <= 320 - 8, "inside the screen");
      const name = hero.querySelector(".pt-nexthead .v-prim");
      ok(name.scrollHeight <= name.clientHeight + 1 && name.scrollWidth <= name.clientWidth + 1, "name not clipped");
      for (const el of d.querySelectorAll("#content .v-alt .v-link")) ok(el.scrollWidth <= el.clientWidth + 1 && box(el).height >= 44, "secondary action fits, 44 px: " + el.textContent);
      eq(w.__e2e.errors, [], "no console errors");
    } finally {
      f.remove();
    }
  });
}
