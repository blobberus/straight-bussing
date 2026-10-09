/*
 * Real-app SHELL checks that run inside the e2e session (e2e.js calls shellE2E() where they belong in
 * the flow and passes its helpers): showing / clearing a custom route never moves the sheet, the chip
 * hides at the full detent, the map credit has no copyright sign and collapses to an accessible (i)
 * button that stays clear of the floating chrome, and About credits OpenStreetMap / OpenMapTiles /
 * OpenFreeMap.
 */

/**
 * Register the shell e2e tests.
 * @param {{test:Function, ok:Function, eq:Function, waitFor:Function, $:(sel:string)=>Element, txt:(el:Element)=>string,
 *          W:()=>Window, store:()=>object, click:Function, tab:(id:string)=>void}} h
 * @param {'chip'|'credit'} which
 */
export function shellE2E(h, which) {
  const { test, ok, eq, waitFor, $, txt } = h;
  const COPY = /©|&copy;/i;
  /** Read layout with transitions off (headless test frames may not advance CSS transitions). */
  const settled = (els, fn) => {
    const prev = els.map((e) => e.style.transition);
    els.forEach((e) => { e.style.transition = "none"; });
    try { return fn(); } finally { els.forEach((e, i) => { e.style.transition = prev[i]; }); }
  };
  const sheetGeo = () => settled([$("#sheet")], () => {
    const s = $("#sheet"), cs = h.W().getComputedStyle(s);
    return { top: Math.round(s.getBoundingClientRect().top), h: s.offsetHeight, pad: h.W().getComputedStyle($("#content")).paddingBottom, tf: cs.transform };
  });
  const setDetent = (d) => {
    const g = $("#grab"), key = d === "full" ? "Home" : d === "peek" ? "End" : null;
    g.dispatchEvent(new (h.W().KeyboardEvent)("keydown", { key: key || "End", bubbles: true }));
    if (!key) g.dispatchEvent(new (h.W().KeyboardEvent)("keydown", { key: "ArrowUp", bubbles: true }));
  };

  if (which === "chip") {
    test("context chip: showing / clearing a custom route never moves the sheet; hidden at the full detent", async () => {
      const rids = Object.keys(h.store().get().routes), R = rids[0];
      const apply = () => h.store().set({ customRoutes: [{ id: "e2s", name: "E2E shell", rids: [R], highlight: [] }], activeCustom: "e2s",
        prevHidden: [], hiddenRoutes: rids.filter((r) => r !== R) });
      const clear = () => h.store().set({ activeCustom: null, hiddenRoutes: [], prevHidden: [] });
      for (const d of ["half", "full", "peek"]) {
        setDetent(d);
        await waitFor(() => $("#sheet").dataset.detent === d, "detent " + d);
        const before = sheetGeo();
        apply();
        await waitFor(() => !$("#ctxbar").hidden, "chip shown");
        eq(sheetGeo(), before, `chip shown at ${d}: sheet unchanged`);
        const vis = settled([$("#ctxbar")], () => h.W().getComputedStyle($("#ctxbar")).visibility);
        eq(vis, d === "full" ? "hidden" : "visible", `chip visibility at ${d}`);
        if (d !== "full") ok($("#ctxbar").getBoundingClientRect().bottom <= before.top - 8, "chip clear of the grab handle");
        clear();
        await waitFor(() => $("#ctxbar").hidden, "chip cleared");
        eq(sheetGeo(), before, `chip cleared at ${d}: sheet unchanged`);
      }
      setDetent("half");
      h.store().set({ customRoutes: [] });
    });
    return;
  }

  test("map credit: no copyright sign; collapses to a 44px (i) button clear of the chrome; tap reopens", async () => {
    setDetent("half");
    const cr = await waitFor(() => $("#map .sb-credits"), "map credit");
    ok(!$("#map .leaflet-control-attribution"), "no Leaflet attribution control");
    ok(!COPY.test($("#map").innerHTML), "no copyright sign in the map");
    const btn = cr.querySelector("button");
    eq(btn.getAttribute("aria-label"), "Map credits");
    await waitFor(() => btn.getAttribute("aria-expanded") === "false", "collapsed after 5 s", 9000);
    ok(cr.querySelector(".sb-credits-text").hidden, "credit text hidden when collapsed");
    const r = settled([cr, $("#sheet")], () => btn.getBoundingClientRect());
    ok(r.width >= 44 && r.height >= 44, "44px target: " + r.width + "x" + r.height);
    const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    for (const id of ["#topbar", "#locateBtn", "#pill", "#ctxbar"]) {
      const el = $(id);
      if (el && !el.hidden) ok(!hit(r, el.getBoundingClientRect()), "credit button clear of " + id);
    }
    const sheetTop = settled([$("#sheet")], () => $("#sheet").getBoundingClientRect().top);
    ok(r.bottom <= sheetTop - 8, `above the sheet and its grab area (${r.bottom} vs ${sheetTop})`);
    h.click(btn, "(i)");
    eq(btn.getAttribute("aria-expanded"), "true", "tap reopens");
    ok(/OpenFreeMap/.test(txt(cr)) && /OpenMapTiles/.test(txt(cr)) && /OpenStreetMap/.test(txt(cr)), "credit text: " + txt(cr));
    h.click(btn, "(i)");
    eq(btn.getAttribute("aria-expanded"), "false", "second tap collapses");
  });

  test("About credits: OpenStreetMap (ODbL), OpenMapTiles, OpenFreeMap, no copyright sign", async () => {
    h.tab("myroutes");
    h.click(await waitFor(() => h.store().get().view === "myroutes" && $('#content [data-action="about:open"]'), "About row"), "About row");
    const c = await waitFor(() => /Credits/.test(txt($("#content"))) && $("#content"), "About");
    const t = txt(c);
    ok(/OpenStreetMap contributors \(ODbL\)/.test(t) && /OpenMapTiles/.test(t) && /OpenFreeMap/.test(t), t.slice(-400));
    ok(!COPY.test(c.innerHTML), "no copyright sign in About");
    h.tab("nearby");
    await waitFor(() => h.store().get().view === "nearby", "back to Current trip");
  });
}
