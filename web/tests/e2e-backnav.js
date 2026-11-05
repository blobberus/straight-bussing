/*
 * Back after opening a line from a line, in the real app (owner 2026-11-02: "Pressing back after selecting a specific
 * line to view should not shift to the previous line but rather go to the previous menu view entirely"). The route page
 * is a replaceSelf view (ui/router.js): a line opened from a line takes its place, so Back (the header button and the
 * browser's back) returns to the menu the first line was opened from. e2e.js registers these in its shared session.
 * The second line is opened the way a rider does it on a route page: a tap on its line on the map (main.js onLineTap),
 * driven through the real Leaflet click path at a point of that line where no other drawn line comes near.
 */

const CENTRAL = "1078", EXPRESS = "4346";   // web/data/routes.json: Central, 53rd Street Express

/**
 * Register the back-navigation tests.
 * @param {{test:Function, ok:Function, eq:Function, waitFor:Function, $:(sel:string)=>Element, $$:(sel:string)=>Element[],
 *          txt:(el:Element)=>string, click:Function, tab:(id:string)=>void, W:()=>Window, sb:()=>object}} h
 */
export function backNavE2E(h) {
  const { test, ok, eq, waitFor, $, $$, txt, click, tab } = h;
  const state = () => h.sb().store.get();
  const title = () => txt($("#title"));
  const detent = () => $("#sheet").dataset.detent;
  const rowIds = () => $$('#content [data-action="route:open"]').map((b) => b.dataset.id);

  /** Metres from point p to segment a-b ([lat, lon] pairs; flat earth, fine at campus scale). */
  function segM(p, a, b) {
    const kx = Math.cos((p[0] * Math.PI) / 180) * 111320, ky = 110540;
    const ax = (a[1] - p[1]) * kx, ay = (a[0] - p[0]) * ky, bx = (b[1] - p[1]) * kx, by = (b[0] - p[0]) * ky;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
    return Math.hypot(ax + t * dx, ay + t * dy);
  }
  /** Tap the map on route rid's line, where every other drawn line is farthest away (the map zooms there first). */
  function tapLine(rid) {
    const s = state(), lm = h.sb().map, hidden = new Set((s.hiddenRoutes || []).map(String));
    ok(lm, "the app's Leaflet map");
    const others = Object.keys(s.shapes || {}).filter((o) => o !== rid && s.routes[o] && !hidden.has(o)).flatMap((o) => s.shapes[o]);
    let best = null;
    for (const line of s.shapes[rid] || []) {
      for (let i = 0; i < line.length; i += 3) {
        const p = line[i];
        let d = Infinity;
        for (const l of others) for (let j = 1; j < l.length && d > 0; j++) d = Math.min(d, segM(p, l[j - 1], l[j]));
        if (!best || d > best.d) best = { p, d };
      }
    }
    ok(best && best.d > 40, `a stretch of ${rid} away from other lines (${best && Math.round(best.d)} m)`);
    lm.setView(best.p, 17, { animate: false });   // also ends a route-fit glide still running
    const pt = lm.latLngToContainerPoint(best.p);
    lm.fire("click", { latlng: lm.containerPointToLatLng(pt), containerPoint: pt, originalEvent: { target: lm.getContainer() } });
  }
  async function openLine(rid, how) {
    click(await waitFor(() => $(`#content [data-action="route:open"][data-id="${rid}"]`), "row of line " + rid), how);
    await waitFor(() => (state().view === "route" && state().routeId === rid) || null, "route page " + rid);
  }
  async function lineFromLine(rid, name) {
    tapLine(rid);
    await waitFor(() => (state().view === "route" && state().routeId === rid && title() === name) || null, "a map tap on its line opens " + name);
  }
  /** Back with the header button, or with the browser's back (emulated same-document history, e2e-stubs.js). */
  function goBack(browser) {
    if (browser) h.W().history.back();
    else click($("#back"), "Back");
  }

  for (const browser of [false, true]) {
    const how = browser ? "browser back" : "Back";
    test(`${how}: My Routes > Central > 53rd Street Express > ${how} = the My Routes view it came from, not Central (owner 2026-11-02)`, async () => {
      h.sb().store.set({ journey: null, routeFilter: null, hiddenRoutes: [], activeCustom: null,
        customRoutes: [{ id: "e2e-back", name: "E2E lines", rids: [CENTRAL, EXPRESS], highlight: [] }] });
      tab("myroutes");
      click(await waitFor(() => state().view === "myroutes" && $('#content [data-action="mr:swipe"][data-id="e2e-back"]'), "More actions"), "More actions");
      click(await waitFor(() => $('#content .mr-swipe.is-open [data-action="mr:details"][data-id="e2e-back"]'), "Details"), "Details");
      await waitFor(() => (state().view === "customroute" && title() === "E2E lines") || null, "the custom route's page");
      const before = { ids: rowIds(), det: detent(), text: txt($("#content .mr-status")) };
      eq(before.ids, [CENTRAL, EXPRESS], "its two lines");
      await openLine(CENTRAL, "Central");
      await lineFromLine(EXPRESS, "53rd Street Express");
      goBack(browser);
      await waitFor(() => state().view !== "route" || null, how + " leaves the line");
      eq(state().view, "customroute", how + " returns to the custom route, never to Central");
      await waitFor(() => title() === "E2E lines" || null, "the custom route's title");
      await waitFor(() => rowIds().length || null, "its rows");
      eq(rowIds(), before.ids, "the same lines listed");
      eq(txt($("#content .mr-status")), before.text, "the same status line");
      eq(detent(), before.det, "the sheet as it was");
      goBack(browser);
      await waitFor(() => state().view === "myroutes" || null, "then My Routes");
      await waitFor(() => $("#back").hidden || null, "a tab: no Back");
      h.sb().store.set({ customRoutes: [] });
    });
  }

  test("Routes list > a line > a map tap on another line > Back = the Routes list; a single line > Back too", async () => {
    tab("routes");
    await waitFor(() => (state().view === "routes" && $(".v-routerow")) || null, "Routes list");
    await openLine(EXPRESS, "53rd Street Express");
    await lineFromLine(CENTRAL, "Central");
    click($("#back"), "Back");
    await waitFor(() => state().view === "routes" || null, "Back returns to the Routes list, not 53rd Street Express");
    await openLine(CENTRAL, "Central");
    click($("#back"), "Back");
    await waitFor(() => state().view === "routes" || null, "a single line: Back returns to the Routes list");
    await openLine(CENTRAL, "Central");
    h.W().history.back();
    await waitFor(() => state().view === "routes" || null, "a single line: browser back returns to the Routes list");
    tab("nearby");
    await waitFor(() => state().view === "nearby" || null, "Current trip");
  });

  test("Escape in Directions with a typed destination: the suggestions close, then Escape goes Back (QA 2026-11-05)", async () => {
    const W = h.W();
    click($("#searchBar"), "search circle");
    const to = await waitFor(() => (state().view === "directions" && $('[data-input="dir-to"]')) || null, "Directions");
    to.focus();
    to.value = "medi";
    to.dispatchEvent(new W.Event("input", { bubbles: true }));
    await waitFor(() => $$('[data-action="dir:sug"]').length || null, "suggestions for the typed text");
    const esc = () => { const e = new W.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }); W.document.activeElement.dispatchEvent(e); return e; };
    ok(esc().defaultPrevented, "the first Escape closes the suggestions");
    await waitFor(() => !$$('[data-action="dir:sug"]').length || null, "suggestions closed");
    eq(state().view, "directions", "still in Directions after the first Escape");
    esc();
    await waitFor(() => state().view === "nearby" || null, "the second Escape goes Back to Current trip");
    tab("nearby");
  });
}
