/*
 * The bus menu in the real app (owner 2026-11-20: "There should be an ability for the user to click a particular bus on
 * the map which will show its next stop, line, and schedule. In this menu, at the bottom should be report and feedback
 * ... for now gray this button out"). A tap on a bus badge through the real Leaflet click path opens its bus menu; See
 * the whole route opens the route page with that bus picked; Back returns to the same bus's menu, Back again to where
 * the rider was. e2e.js registers these in its shared session (the stub feed: one bus per line, heading to the line's
 * second stop, live times every 2 min from 5 min on).
 */

/**
 * Register the bus menu flow.
 * @param {{test:Function, ok:Function, eq:Function, waitFor:Function, $:(sel:string)=>Element, $$:(sel:string)=>Element[],
 *          txt:(el:Element)=>string, click:Function, tab:(id:string)=>void, W:()=>Window, sb:()=>object}} h
 */
export function busMenuE2E(h) {
  const { test, ok, eq, waitFor, $, $$, txt, click, tab } = h;
  const state = () => h.sb().store.get();
  const title = () => txt($("#title"));

  test("bus menu: tap a bus on the map > its menu (next stop, line, schedule, grayed-out Report and feedback) > See the whole route > Back > Back", async () => {
    h.sb().store.set({ journey: null, routeFilter: null, hiddenRoutes: [], activeCustom: null });
    tab("routes");
    await waitFor(() => (state().view === "routes" && !$("#map .sb-busicon.is-faded")) || null, "Routes, no bus faded");
    const icon = await waitFor(() => $("#map .sb-busicon"), "a bus on the map");
    icon.dispatchEvent(new (h.W().MouseEvent)("click", { bubbles: true, cancelable: true }));
    await waitFor(() => (state().view === "bus" && state().busMenu) || null, "a bus tap opens the bus menu");
    const s = state(), key = s.busMenu, rid = s.routeId, r = s.routes[rid];
    const bus = s.buses.find((b) => String(b.vehicle.id) === key);
    ok(bus && String(bus.trip.route_id) === rid, "the menu is the tapped bus's, on its line");
    await waitFor(() => title() === (r.long || r.short) || null, "the header names the line");
    ok($("#titleRight .chip") && /^Bus /.test(txt($("#titleRight .hm-bus"))), "its badge and the bus: " + txt($("#titleRight")));
    await waitFor(() => $("#map .sb-bus.is-picked"), "the bus is ringed on the map");

    // the menu: where it heads and when, Next stops, Line schedule, See the whole route, Report and feedback last
    const next = s.stops[bus.stop_id].name;
    await waitFor(() => (txt($("#content .bm-stop")) === next) || null, "Heading to its next stop");
    ok(/^\d+ min$/.test(txt($("#content .bm-eta"))), "its live time: " + txt($("#content .bm-eta")));
    const rows = $$("#content .bm-tl .v-tlbtn");
    ok(rows.length >= 7 && txt(rows[0].querySelector(".v-prim")) === next, `Next stops from ${next}: ${rows.length} rows`);
    ok(rows.every((b) => b.getBoundingClientRect().height >= 44), "44 px rows");
    eq(txt($("#content #bm-sched-h")), "Line schedule");
    ok(/Scheduled now|Not scheduled now|No published schedule/.test(txt($("#content .bm-sched"))), "today's hours: " + txt($("#content .bm-sched")));
    const rep = $("#content .v-bus").lastElementChild, btn = rep.querySelector(".bm-reportbtn");
    ok(rep.classList.contains("bm-report") && btn.getAttribute("aria-disabled") === "true", "Report and feedback at the very bottom, grayed out");
    eq(txt(rep.querySelector(".bm-reportnote")), "Coming soon: report a problem with this bus or send feedback.");
    const view0 = state().view;
    btn.click();
    await new Promise((res) => setTimeout(res, 100));
    eq([state().view, h.W().document.querySelectorAll("dialog[open]").length], [view0, 0], "tapping it does nothing yet");

    // See the whole route: the route page with this bus picked
    click($("#content .bm-whole"), "See the whole route");
    await waitFor(() => (state().view === "route" && state().routeId === rid) || null, "the route page");
    await waitFor(() => (state().busId === key && $("#content .r-busnote")) || null, "the bus is picked there (its own times)");
    eq(state().busMenu, null, "off the bus menu: no menu bus");

    // Back: the same bus's menu; Back again: where the rider was
    click($("#back"), "Back");
    await waitFor(() => (state().view === "bus" && state().busMenu === key) || null, "Back returns to the same bus's menu");
    eq(state().busId, null, "the route page's pick is let go");
    await waitFor(() => (txt($("#content .bm-stop")) === next) || null, "the menu shows that bus again");
    click($("#back"), "Back");
    await waitFor(() => (state().view === "routes" && title() === "Routes") || null, "Back again: the Routes list it came from");
    eq(state().busMenu, null);
    await waitFor(() => !$("#map .sb-bus.is-picked") || null, "no ring left on the map");
  });
  // a bus menu opened from a bus menu takes its place: tests/ui-shell-router.js (the stub feed has one bus per line, and
  // another line's buses are faded, so not tappable, while a bus menu focuses its line)
}
