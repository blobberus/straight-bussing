/*
 * Directions' trip start time in the real app (owner 2026-11-09: "when deciding a destination, the user should have an
 * optional trip start time ... based on the scheduled arrival time (this should have a larger disclaimer ...)"). e2e.js
 * registers these in its shared session: the control under the fields, the wheels in the Settings-style sheet, the
 * timetable fetched only then (never at boot), the disclaimer over the plan, no Start for a plan for later, one tap back
 * to Leave now.
 */

/**
 * Register the trip start time tests.
 * @param {{test:Function, ok:Function, eq:Function, waitFor:Function, $:(sel:string)=>Element, $$:(sel:string)=>Element[],
 *          txt:(el:Element)=>string, click:Function, type:Function, tab:(id:string)=>void, W:()=>Window, sb:()=>object,
 *          stopName:(id:string)=>string, dst:()=>string}} h
 */
export function tripStartE2E(h) {
  const { test, ok, eq, waitFor, $, $$, txt, click, type, tab } = h;
  const state = () => h.sb().store.get();
  const fetchedTimetable = () => h.W().performance.getEntriesByType("resource").some((e) => /\/data\/timetable\.json/.test(e.name));
  const key = (el, k) => el.dispatchEvent(new (h.W().KeyboardEvent)("keydown", { key: k, bubbles: true, cancelable: true }));

  test("trip start time: Leave now under the fields; a later time plans from the timetable under the disclaimer; one tap back", async () => {
    ok(!fetchedTimetable(), "the timetable is not loaded at boot (first paint never waits for it)");
    tab("nearby");
    click($("#searchBar"), "search circle");
    await waitFor(() => state().view === "directions" && $("#content .v-dirbox") || null, "Directions");
    const from = $('#content [data-input="dir-from"]'), to = $('#content [data-input="dir-to"]');
    type(from, "e2e start", "start field");
    click(await waitFor(() => $$('#content [data-action="dir:sug"]').find((b) => /E2E Start Place/.test(txt(b))), "place suggestion"), "place");
    type(to, h.stopName(h.dst()), "destination field");
    click(await waitFor(() => $$('#content [data-action="dir:sug"]').find((b) => txt(b).startsWith(h.stopName(h.dst()))), "stop suggestion"), "stop");
    const when = await waitFor(() => $('#content .v-dirbox [data-action="dir:when"]'), "the start time control in the card");
    eq(txt(when), "Leave now");
    await waitFor(() => $("#content .v-opt, #content .empty") || null, "live options first");
    // the wheels
    click(when, "Leave now");
    const sheet = await waitFor(() => { const s = $("#settingsOverlay"); return s && !s.hidden && s.dataset.kind === "leave" ? s : null; }, "the start time sheet");
    eq(txt(sheet.querySelector("#stoTitle")), "Trip start time");
    await waitFor(() => fetchedTimetable() || null, "the timetable loads once the sheet opens");
    key(sheet.querySelector("#lpDay"), "ArrowDown");        // tomorrow
    key(sheet.querySelector("#lpHour"), "End");             // 12
    key(sheet.querySelector("#lpMinute"), "Home");          // :00
    key(sheet.querySelector("#lpAmpm"), "End");             // PM
    await waitFor(() => /Bus times will come from the timetable/.test(txt(sheet.querySelector('[data-region="lp-result"]'))) || null, "says what Set does");
    click(sheet.querySelector('[data-sto="done"]'), "Set");
    await waitFor(() => sheet.dataset.state === "closed" || null, "the sheet closes");
    const label = await waitFor(() => { const t = txt($("#content .v-dwhentxt")); return /^Leave tomorrow at 12:00/.test(t) ? t : null; }, "the chosen time on the control");
    ok(/PM|12:00$/.test(label), label);
    await waitFor(() => $("#content .v-ttnote") && !/Checking sidewalk/.test(txt($("#content"))) || null, "the disclaimer, refined");
    const res = $('#content [data-region="dir-res"]'), note = res.querySelector(".v-ttnote");   // after the last re-render
    ok(/Scheduled times, not live/.test(txt(note)) && /Most buses run later than scheduled/.test(txt(note)), txt(note));
    ok(/773\.702\.8181/.test(txt(note)), "the official contact in it");
    const opt = res.querySelector(".v-opt:not(.v-opt--walk)");
    if (opt) {   // a weekend noon can have no scheduled bus at the stub stops: the "No scheduled shuttle trip" state then
      ok(note.compareDocumentPosition(opt) & h.W().Node.DOCUMENT_POSITION_FOLLOWING, "above the options");
      ok(/Scheduled bus/.test(txt(opt)), "scheduled, not live: " + txt(opt).slice(0, 160));
    } else ok(/No scheduled shuttle trip/.test(txt(res)), txt(res).slice(0, 200));
    ok(!res.querySelector(".v-livedot, .dot-live, .src-live"), "no live mark on timetable times");
    ok(!res.querySelector('[data-action="dir:start"]'), "no Start for a plan for later");
    // one tap back to Leave now
    click($('#content [data-action="dir:when-clear"]'), "clear the start time");
    await waitFor(() => txt($("#content .v-dwhentxt")) === "Leave now" && !$("#content .v-ttnote") || null, "back to Leave now, live times");
    click($("#back"), "back");
    await waitFor(() => state().view !== "directions" || null, "out of Directions");
  });
}
