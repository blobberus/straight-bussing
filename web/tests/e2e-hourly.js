/*
 * The route page's "Schedule by hour" times table in the real app (owner 2026-11-09: "The schedule by hour should be
 * expandable to show exactly what time of day the bus can be expected. The table should highlight the current time. It
 * can break it down between the weekday and weekend."): Show all times opens the table, a day tab switches it, and the
 * card is collapsed again on the next visit (store.freq is never saved; main.js clears it off the route page).
 * e2e.js registers these in its shared session.
 */

import { scheduleTabs } from "../js/core/schedule.js";

const EXPRESS = "4346";   // web/data/routes.json: 53rd Street Express (weekdays only: Weekday / Weekend tabs)

/**
 * Register the times-table tests.
 * @param {{test:Function, ok:Function, eq:Function, waitFor:Function, $:(sel:string)=>Element, $$:(sel:string)=>Element[],
 *          txt:(el:Element)=>string, click:Function, tab:(id:string)=>void, sb:()=>object}} h
 */
export function hourlyE2E(h) {
  const { test, ok, eq, waitFor, $, $$, txt, click, tab } = h;
  const state = () => h.sb().store.get();
  async function openExpress() {
    h.sb().store.set({ journey: null, routeFilter: null, hiddenRoutes: [], activeCustom: null });
    tab("routes");
    click(await waitFor(() => $(`#content [data-action="route:open"][data-id="${EXPRESS}"]`), "the 53rd Street Express row"), "53rd Street Express");
    await waitFor(() => (state().view === "route" && state().routeId === EXPRESS) || null, "its route page");
    return waitFor(() => $("#content .r-freq"), "the Schedule by hour card");
  }
  /** Show all times (on a weekend today's tab has no buses: the Weekday tab first). */
  async function showButton() {
    if (!$("#content .r-fmore")) click(await waitFor(() => $$("#content .r-freq .seg button").find((b) => txt(b) === "Weekday"), "the Weekday tab"), "Weekday");
    return waitFor(() => $("#content .r-fmore"), "Show all times");
  }

  test("Schedule by hour: Show all times opens the table, a day tab switches it, the next visit starts collapsed", async () => {
    await openExpress();
    let btn = await showButton();
    eq([txt(btn), btn.getAttribute("aria-expanded")], ["Show all times", "false"], "collapsed by default");
    click(btn, "Show all times");
    const table = await waitFor(() => $("#content #r-ftimes table"), "the times table");
    btn = $("#content .r-fmore");
    eq([txt(btn), btn.getAttribute("aria-expanded"), btn.getAttribute("aria-controls")], ["Hide times", "true", "r-ftimes"]);
    ok(table.querySelectorAll("tbody tr").length >= 10, "one row per hour of service");
    eq(state().freq && state().freq.open, true);
    const tabs = $$("#content .r-freq .seg button");
    eq(tabs.map((b) => txt(b)), ["Weekday", "Weekend"], "53rd runs weekdays only: Weekday / Weekend");
    click(tabs[1], "Weekend");
    await waitFor(() => txt($("#content .r-freq .seg button[aria-pressed=true]")) === "Weekend" || null, "the Weekend tab");
    ok(/^Schedule by hour, (weekends|today)$/.test(txt($("#r-freq-h"))), txt($("#r-freq-h")));
    ok(/No service/.test(txt($("#content .r-flist"))) && !$("#content #r-ftimes"), "no weekend service: no table, says so");
    click($("#back"), "Back");
    await waitFor(() => state().view !== "route" || null, "Back leaves the route page");
    eq(state().freq, null, "forgotten off the page");
    await openExpress();
    eq([!!$("#content #r-ftimes"), ($("#content .r-fmore") || { getAttribute: () => "false" }).getAttribute("aria-expanded")], [false, "false"], "collapsed again");
    const t = scheduleTabs(state().service, EXPRESS, Date.now() / 1000);
    eq(txt($("#content .r-freq .seg button[aria-pressed=true]")), t.tabs.find((x) => x.id === t.selected).label, "today's tab selected again");
  });
}
