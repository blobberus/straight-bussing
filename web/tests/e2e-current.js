/*
 * Current trip in the real app at phone sizes. With no trip (owner 2026-11-04: "if a current trip is not selected,
 * don't display nearby routes, rather, just show that no current trip is selected. Keep the favorites and search
 * station bar. Also keep the alerts."): the alert row, "No current trip selected" and the search, no nearby buses.
 * During a trip the next-bus block (owner decisions 2026-10-11) still follows the trip and must hold at 320 px.
 * e2e.js registers these with its helpers; each test opens its own app iframe (393 x 852, the frame size; 320 x 640)
 * with the e2e stubs, so the shared session is untouched.
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
  async function phone(style, { trip = false } = {}) {
    const f = await openApp(style);
    const w = f.contentWindow, d = w.document;
    await waitFor(() => w.__sb && w.__e2e && w.__sb.store.get().staticLoaded && w.__sb.store.get().liveLoaded, "phone-sized app", 15000);
    await w.__e2e.ready;
    tripleTrips(w.__e2e);
    w.dispatchEvent(new w.Event("online"));   // poll now with the new feed
    await waitFor(() => w.__sb.store.get().trips.length >= 3 * w.__e2e.routes.length, "three trips per route");
    const stop = w.__e2e.stops[w.__e2e.routes[0].stops[2]];
    w.__sb.store.set({ user: { lat: stop.lat, lon: stop.lon }, locState: "granted" });
    let hero = null;
    if (trip) {   // nearby buses only during a trip (owner 2026-11-04)
      const rids = Object.keys(w.__sb.store.get().routes);
      w.__sb.store.set({ journey: { kind: "plan", rids, label: "To E2E Place", to: "E2E Place", t0: Math.floor(Date.now() / 1000), legs: [] } });
      hero = await waitFor(() => { const x = d.querySelector("#content .pt-next"); return x && x.querySelectorAll(".row.arr").length === 3 ? x : null; }, "the next-bus block with 3 arrivals");
    }
    d.getElementById("sheet").style.transition = "none";   // read settled states
    return { f, w, d, hero };
  }
  const box = (el) => el.getBoundingClientRect();

  test("current trip, 393 x 852, no trip: collapsed it says No current trip selected; expanded, the alert row, the no-trip card and the search show without scrolling; nothing nearby", async () => {
    const { f, w, d } = await phone("width:393px;height:852px");
    try {
      eq(d.getElementById("sheet").dataset.detent, "peek", "starts collapsed (map first, owner 2026-10-12)");
      await waitFor(() => d.getElementById("subtitle").textContent === "No current trip selected" || null, "collapsed: No current trip selected");
      eq(d.getElementById("titleRight").textContent.trim(), "", "no next bus in the collapsed header (owner 2026-11-04)");
      d.querySelector('#tabs button[data-tab="nearby"]').click();
      await waitFor(() => d.getElementById("sheet").dataset.detent === "full" || null, "expanded");
      eq(d.getElementById("content").scrollTop, 0, "not scrolled");
      const head = box(d.getElementById("sheetHead")), nav = box(d.getElementById("tabs")), sheet = box(d.getElementById("sheet"));
      const visTop = Math.max(head.bottom, sheet.top);
      const card = d.querySelector("#content .pt-notrip"), r = box(card);
      ok(/No current trip selected/.test(card.textContent) && /Search for a destination/.test(card.textContent), "the no-trip card says it and how to start");
      ok(r.top >= visTop - 1 && r.bottom <= nav.top + 1, `no-trip card fully visible: ${Math.round(r.top)}-${Math.round(r.bottom)} in ${Math.round(visTop)}-${Math.round(nav.top)}`);
      const al = d.querySelector('#content [data-region="nearby-alert"] .v-alertbanner');
      ok(al, "the feed's alert shows as a row");
      const a = box(al), line = al.querySelector(".v-alertline");
      ok(a.bottom <= r.top + 1 && a.top >= visTop - 1, "alert row directly above the no-trip card, visible");
      ok(a.height <= 48 && line.scrollHeight <= parseFloat(w.getComputedStyle(line).lineHeight) * 1.5, "one line: " + Math.round(a.height) + " px");
      const s = box(d.querySelector('#content [data-input="nearby-q"]'));
      ok(s.top >= r.bottom && s.bottom <= nav.top + 1, "Search stations under the card, visible");
      ok(!d.querySelector("#content .pt-next") && !d.querySelector('#content [data-action="nearby:locate"]') && !/Arriving soon|Also nearby/.test(d.getElementById("content").textContent), "no nearby buses, no location prompt, also with a location");
      const go = card.querySelector('[data-action="dir:open"]');
      ok(go && box(go).height >= 44, "Search for a destination, 44 px");
      eq(d.querySelectorAll("#content .v-btn--primary").length, 1, "one primary action");
      go.click();
      await waitFor(() => w.__sb.store.get().view === "directions" || null, "it opens Directions");
      eq(w.__e2e.errors, [], "no console errors");
    } finally {
      f.remove();
    }
  });

  test("current trip, 320 px wide, during a trip: the next-bus block holds (no sideways overflow, the name is never cut)", async () => {
    const { f, w, d, hero } = await phone("width:320px;height:640px", { trip: true });
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
