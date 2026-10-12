// ui/views/settings.js (settings.test.html)
import { test, eq, ok } from "./lib.js";
import { fixture, makeCtx, tick, root, NOW } from "./views-fixtures.js";
import { bindActions, hasAction } from "../js/ui/actions.js";
import { renderSettings, mountSettings, unmountSettings, stationHTML, optsHTML, alertsHTML, searchStations, permHTML, statusHTML, ALERTS_NOTE, locHTML, LOC_DISCLAIMER } from "../js/ui/views/settings.js";
import { getView } from "../js/ui/router.js";
import { cleanNotify } from "../js/state.js";

const base = (over = {}) => ({ notify: cleanNotify(null), favStops: [], journey: null, ...over });
const noRaw = (h) => !h.includes("<script>") && !h.includes("javascript:");

function mounted(over = {}) {
  const ctx = makeCtx(base(over));
  const el = root();
  el.innerHTML = renderSettings(ctx.store.get(), NOW);
  mountSettings(el, ctx);
  const off = bindActions(el, () => ctx);
  return { ctx, el, done: () => { off?.(); unmountSettings(); el.remove(); } };
}
const click = (el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const change = (el, set) => { set(el); el.dispatchEvent(new Event("change", { bubbles: true })); };

test("settings: gear action registered; 'settings' view is only a shim (no sheet content, no detent)", () => {
  const d = getView("settings");
  ok(d && d.parent === "nearby" && !d.detent && typeof d.mount === "function");
  eq(d.render(fixture(base())), "", "settings content no longer renders in the sheet");
  ok(hasAction("settings:open"));
});

test("settings: render has appearance, alerts, bus alerts, iPhone row, about; escaped", () => {
  const h = renderSettings(fixture(base()), NOW);
  for (const s of ["Appearance", "Service alerts", "Bus alerts", "Alerts work only while Straight Bussing is open", "Coming to the iPhone app", 'data-action="about:open"', "estimates from live predictions"]) ok(h.includes(s), s);
  ok(noRaw(h));
});

test("settings: alerts inline with escaping and period; empty state has official contact", () => {
  const a = { header_text: { translation: [{ text: "Detour <b>now</b>", language: "en" }] }, description_text: "Use 55th", active_period: [{ start: NOW - 60, end: NOW + 3600 }] };
  const h = alertsHTML(fixture({ alerts: [a] }), NOW);
  ok(h.includes("Detour &lt;b&gt;now&lt;/b&gt;") && h.includes("Use 55th") && h.includes(" to ") && !/[–—]/.test(h), "period reads '4:00 PM to 5:00 PM'");
  const e = alertsHTML(fixture({ alerts: [] }), NOW);
  ok(e.includes("No active alerts") && e.includes("773.702.8181"));
  ok(alertsHTML(fixture({ liveLoaded: false }), NOW).includes("Checking"));
  ok(renderSettings(fixture(base({ alerts: [a] })), NOW).includes("1 active"));
  const call = alertsHTML(fixture({ alerts: [{ ...a, description_text: "Call 773-655-9934 <now>" }] }), NOW);
  ok(call.includes('<a href="tel:+17736559934">773-655-9934</a> &lt;now&gt;'), "phone numbers in alert text are call links, the rest escaped");
});

test("settings: station search ranks word starts, needs a serving route", () => {
  const s = fixture();
  eq(searchStations(s, "lib").map((x) => x.id), ["S2"]);
  eq(searchStations(s, "orphan"), [], "stop with no routes");
  eq(searchStations(s, "  "), []);
});

test("settings: picker lists favorites + nearest; chosen station shows Change / Turn off", () => {
  const p = stationHTML(fixture(base({ favStops: ["S2"], user: { lat: 41.79, lon: -87.6 } })), { picking: true, query: "" });
  ok(p.includes("Favorites") && p.includes('data-id="S2"') && p.includes("Nearest station") && p.includes('id="st-q"'));
  const c = stationHTML(fixture(base({ notify: cleanNotify({ stopId: "S1" }) })), { picking: false, query: "" });
  ok(c.includes("Main &amp; 1st") && c.includes("1301 East 53rd Street") && c.includes('data-st="change"') && c.includes('data-st="off"'));
});

test("settings: options list serving routes (hidden marked), switches and minutes", () => {
  eq(optsHTML(fixture(base())), "");
  const h = optsHTML(fixture(base({ notify: cleanNotify({ stopId: "S3" }), hiddenRoutes: ["R3"] })));
  ok(h.includes('data-id="R1"') && h.includes('data-id="R2"') && h.includes(">hidden<"));
  ok(h.includes('role="switch"') && h.includes("2 stops away") && h.includes("1 stop away") && h.includes("10 min away"));
  ok(h.includes("any visible route"));
  ok(noRaw(h));
});

test("settings: status line is an estimate and pauses when data is down", () => {
  const s = fixture(base({ notify: cleanNotify({ stopId: "S3", rids: ["R1"] }) }));
  const h = statusHTML(s, NOW);
  ok(h.includes("2 stops away") && h.includes("(est.)") && h.includes("From live predictions"));
  ok(statusHTML({ ...s, lastOk: 0 }, NOW).includes("paused"));
});

test("settings: permission lines say how the ONE alert arrives (iOS wording, adapted; 2026-10-10)", () => {
  ok(permHTML("granted").includes("as a banner while you use the app, and as a notification while it is open in the background"));
  for (const p of ["denied", "unsupported"]) {
    const h = permHTML(p);
    ok(h.includes("Notifications are off") && h.includes("so alerts show as a banner inside the app while it is open"), p);
  }
  ok(permHTML("denied").includes("blocked in your browser settings"));
  const d = permHTML("default");
  ok(d.includes('data-st="perm"') && d.includes(">Allow notifications<") && d.includes('aria-describedby="st-permhint"'), "one button, described");
  ok(d.includes("Without notifications, alerts show as a banner inside the app."));
  ok(ALERTS_NOTE.startsWith("Alerts work only while Straight Bussing is open") && !/[–—]/.test(ALERTS_NOTE), "footer, no dashes");
  ok(!renderSettings(fixture(base()), NOW).includes("System notifications"), "old wording gone");
  ok(!renderSettings(fixture(base()), NOW).includes("off in demo mode"), "no demo note outside demo mode");
});

test("settings: pick a favorite, toggle switches, keep at least one route, turn off", async () => {
  const { ctx, el, done } = mounted({ favStops: ["S3"] });
  try {
    click(el.querySelector('[data-st="pick"][data-id="S3"]'));
    await tick();
    eq(ctx.store.get().notify.stopId, "S3");
    ok(el.querySelector('[data-region="opts"]').innerHTML.includes("2 stops away"), "options appear");
    change(el.querySelector('[data-st-in="twoStops"]'), (x) => { x.checked = false; });
    await tick();
    eq(ctx.store.get().notify.twoStops, false);
    change(el.querySelector('[data-st-in="minutes"]'), (x) => { x.value = "5"; });
    await tick();
    eq(ctx.store.get().notify.minutes, 5);
    for (const r of ["R2", "R3"]) {
      change(el.querySelector(`[data-st-in="rid"][data-id="${r}"]`), (x) => { x.checked = false; });
      await tick();
    }
    eq(ctx.store.get().notify.rids, ["R1"]);
    const last = el.querySelector('[data-st-in="rid"][data-id="R1"]');
    change(last, (x) => { x.checked = false; });
    await tick();
    ok(last.checked && ctx.calls.toast.includes("Keep at least one route"));
    click(el.querySelector('[data-st="anyroute"]'));
    await tick();
    eq(ctx.store.get().notify.rids, []);
    click(el.querySelector('[data-st="off"]'));
    await tick();
    eq(ctx.store.get().notify.stopId, null);
    ok(el.querySelector("#st-q"), "picker back");
  } finally { done(); }
});

test("settings: typing searches without rebuilding the field; picking a result saves it", async () => {
  const { ctx, el, done } = mounted();
  try {
    const q = el.querySelector("#st-q");
    q.focus();
    q.value = "hosp";
    q.dispatchEvent(new Event("input", { bubbles: true }));
    ctx.store.set({ buses: [...ctx.store.get().buses] });
    await tick();
    ok(el.querySelector("#st-q") === q && document.activeElement === q, "same focused input after a live update");
    click(el.querySelector('[data-region="results"] [data-id="S3"]'));
    await tick();
    eq(ctx.store.get().notify.stopId, "S3");
    click(el.querySelector('[data-st="change"]'));
    ok(el.querySelector("#st-q") && el.querySelector('[data-st="cancel"]'));
    click(el.querySelector('[data-st="cancel"]'));
    ok(el.querySelector('[data-st="change"]'));
  } finally { done(); }
});

test("settings: Live Activity preference saved for later", async () => {
  const { ctx, el, done } = mounted();
  try {
    change(el.querySelector('[data-st-in="liveActivity"]'), (x) => { x.checked = false; });
    await tick();
    eq(ctx.store.get().notify.liveActivity, false);
  } finally { done(); }
});

test("settings: Location: share / stop sharing / blocked with how to fix it, and the no-collection promise (owner 2026-10-12)", async () => {
  const off = locHTML(fixture({ user: null, locState: "unknown" }));
  ok(off.includes('data-st="loc-on"') && off.includes("Share my location"), "not shared yet: one button that asks");
  const on = locHTML(fixture({ user: { lat: 41.79, lon: -87.6 }, locState: "granted" }));
  ok(on.includes("Sharing your location") && on.includes('data-st="loc-off"'), "shared: say so, offer Stop sharing");
  const blocked = locHTML(fixture({ user: null, locState: "denied" }));
  ok(blocked.includes("blocked") && blocked.includes("Safari Websites") && blocked.includes('data-st="loc-on"'), "blocked: the iPhone steps and Try again");
  for (const h of [off, on, blocked]) ok(h.includes("does not collect your location"), "the disclaimer is always shown");
  ok(LOC_DISCLAIMER.includes("nothing is stored") && !/[–—]/.test(LOC_DISCLAIMER), "plain words, no dash characters");
  ok(renderSettings(fixture({})).includes('data-region="loc"'), "a Location section in Settings");
  // the buttons call the device: Share asks for the location, Stop sharing forgets it
  const ctx = makeCtx({ user: null, locState: "unknown" }, { locateResult: { lat: 41.79, lon: -87.6 } });
  let stopped = 0;
  ctx.stopLocation = () => { stopped++; ctx.store.set({ user: null, locState: "off" }); };
  const el = root();
  el.innerHTML = renderSettings(ctx.store.get());
  mountSettings(el, ctx);
  el.querySelector('[data-st="loc-on"]').click();
  await tick(20);
  eq(ctx.calls.locate, 1, "Share my location asks the device");
  await tick(20);
  ok(el.querySelector('[data-region="loc"]').textContent.includes("Sharing your location"), "then says it is shared");
  el.querySelector('[data-st="loc-off"]').click();
  eq(stopped, 1, "Stop sharing");
  ok(el.querySelector('[data-region="loc"] [data-st="loc-on"]'), "and offers to share again");
  unmountSettings(); el.remove();
});
