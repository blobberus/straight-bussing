// ui/pill.js: status pill states, one icon per state (iOS RootView StatusPill parity, 2026-10-10). Pure + one DOM
// render; no timers (this file is last on ui-shell.test.html, after the contextbar marquee test).
import { test, eq, ok } from "./lib.js";
import { pillState, pillIconSVG, createPill, PILL_ICONS } from "../js/ui/pill.js";
import { DEMO_PILL } from "../js/core/demo.js";

const NOW = 1_800_000_000;
const fresh = { staticLoaded: true, liveLoaded: true, failed: false, lastOk: NOW - 5, feedTs: NOW - 5, buses: [{ id: "b" }], trips: [], service: {}, routes: {} };
const night = (last) => ({ first: "16:00", last, trips: 30, buses: Array(24).fill(1) });
const every = (d) => ({ days: Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((k) => [k, d])), exceptions: [] });

test("pill: each state has its own icon and words (never color alone)", () => {
  const cases = [
    [{ ...fresh }, "", "", ""],
    [{ ...fresh, failed: true, lastOk: NOW - 120 }, "err", "feed", "Can't reach the shuttle feed. Retrying. Showing last known data."],
    [{ ...fresh, failed: true, lastOk: 0, feedTs: 0 }, "err", "feed", "Can't reach the shuttle feed. Don't rely on these times; call 773.702.8181."],
    [{ ...fresh, feedTs: NOW - 150 }, "warn", "delay", "Live data delayed. Times may be off."],
    [{ ...fresh, feedTs: NOW - 400 }, "warn", "delay", "Live data is out of date"],
    [{ ...fresh, buses: [] }, "info", "idle", "No shuttles running right now"],
    [{ ...fresh, buses: [], routes: { N: { short: "N", long: "North" } }, service: { routes: { N: every(night("28:29")) } } }, "warn", "silent", "No shuttles are reporting live locations"],
  ];
  for (const [s, kind, icon, msg] of cases) {
    const p = pillState(s, NOW);
    eq([p.kind, p.icon], [kind, icon], msg || "fresh");
    ok(msg ? p.msg.startsWith(msg) : p.msg === "", p.msg);
    eq(p.retry, kind === "err");
    eq(p.alert, false, "no alert: no See alert");
  }
  // fresh empty feed + an active service alert: "See alert" (iOS parity); never on a feed error or with buses running
  const al = [{ header_text: "Call 773-655-9934 if no buses show", active_period: [{ start: NOW - 60, end: NOW + 60 }] }];
  eq(pillState({ ...fresh, buses: [], alerts: al }, NOW).alert, true, "nothing running + alert");
  eq(pillState({ ...fresh, buses: [], alerts: al, routes: { N: { short: "N", long: "North" } }, service: { routes: { N: every(night("28:29")) } } }, NOW).alert, true, "silent + alert");
  eq(pillState({ ...fresh, buses: [], alerts: [{ ...al[0], active_period: [{ start: NOW - 99, end: NOW - 9 }] }] }, NOW).alert, false, "expired alert");
  eq(pillState({ ...fresh, failed: true, lastOk: 0, buses: [], alerts: al }, NOW).alert, false, "feed error: Retry, not See alert");
  eq(pillState({ ...fresh, alerts: al }, NOW).msg, "", "buses running: no pill");
  eq(pillState({ liveLoaded: false, failed: false }, NOW, { bootS: NOW - 5 }).icon, "", "first poll grace");
  eq(pillState({ liveLoaded: false, failed: false }, NOW, { bootS: NOW - 60 }).icon, "feed", "never polled after the grace period");
  const icons = Object.keys(PILL_ICONS);
  eq(icons.sort(), ["delay", "demo", "feed", "idle", "silent"]);
  eq(new Set(icons.map((k) => PILL_ICONS[k])).size, 5, "five different drawings");
  eq(pillState({ ...fresh }, NOW).demo, false, "live: never the demo pill");
  ok(pillIconSVG("feed").includes('aria-hidden="true"') && pillIconSVG("nope") === "", "decorative; unknown = none");
});

test("pill: render writes the icon, text, kind and Retry; the icon slot is created when missing", () => {
  const host = document.createElement("div");
  host.innerHTML = '<div class="statuspill" hidden><span class="pilltext"></span><button class="pillbtn" hidden>Retry</button></div>';
  document.body.appendChild(host);
  const el = host.firstChild, p = createPill({ pill: el, text: el.querySelector(".pilltext"), retry: el.querySelector(".pillbtn") });
  const ic = el.querySelector(".pillicon");
  ok(ic && ic.getAttribute("aria-hidden") === "true" && el.firstChild === ic, "icon slot first, hidden from screen readers");
  p.render({ ...fresh, failed: true, lastOk: NOW - 120 }, NOW);
  eq([el.hidden, el.className, el.dataset.icon, el.querySelector(".pillbtn").hidden], [false, "statuspill err", "feed", false]);
  ok(ic.querySelector("svg") && el.textContent.includes("Can't reach"), "icon + words");
  const see = el.querySelector('[data-action="alerts:open"]');
  ok(see && see.hidden && see.textContent === "See alert" && see.getAttribute("aria-label") === "Read the service alert", "See alert button created, hidden");
  p.render({ ...fresh, buses: [] }, NOW);
  eq([el.className, el.dataset.icon, el.querySelector(".pillbtn").hidden, see.hidden], ["statuspill info", "idle", true, true]);
  p.render({ ...fresh, buses: [], alerts: [{ header_text: "x" }] }, NOW);
  eq([el.querySelector(".pillbtn").hidden, see.hidden], [true, false], "an alert is up: See alert, no Retry");
  p.render(fresh, NOW);
  ok(el.hidden && !ic.innerHTML, "fresh data: no pill");
  host.remove();
});

// Owner decision 2026-10-11: no demo banner. In demo mode (?demo=1) the pill is the one quiet, honest indicator:
// "Simulated buses" on every screen, and the whole pill is a button that explains it (action demo:info).
test("pill: demo mode reads 'Simulated buses' (flask icon, tap to explain); feed problems still win", () => {
  eq(DEMO_PILL, "Simulated buses");
  const d = pillState({ ...fresh }, NOW, { demo: true });
  eq([d.kind, d.icon, d.msg, d.demo, d.retry, d.alert], ["info", "demo", "Simulated buses", true, false, false]);
  eq(pillState({ liveLoaded: false, failed: false }, NOW, { bootS: NOW - 5, demo: true }).msg, "Simulated buses", "from the first frame");
  eq(pillState({ ...fresh, buses: [] }, NOW, { demo: true }).icon, "demo", "simulated feed: never 'No shuttles running'");
  eq(pillState({ ...fresh, failed: true, lastOk: NOW - 120 }, NOW, { demo: true }).kind, "err", "a failing feed is still an error");
  eq(pillState({ ...fresh, feedTs: NOW - 150 }, NOW, { demo: true }).icon, "delay", "a late feed is still late");
  const host = document.createElement("div");
  host.innerHTML = '<div class="statuspill" role="status" hidden><span class="pilltext"></span><button class="pillbtn" hidden>Retry</button></div>';
  document.body.appendChild(host);
  const el = host.firstChild, p = createPill({ pill: el, text: el.querySelector(".pilltext"), retry: el.querySelector(".pillbtn") }, { demo: true });
  const tap = el.querySelector('[data-action="demo:info"]');
  ok(tap && tap.tagName === "BUTTON" && tap.hidden && /Simulated buses/.test(tap.getAttribute("aria-label")), "tap button created, labeled, hidden");
  p.render({ ...fresh }, NOW);
  eq([el.hidden, el.className, el.dataset.icon, el.querySelector(".pilltext").textContent, tap.hidden], [false, "statuspill info", "demo", "Simulated buses", false]);
  ok(el.querySelector(".pillicon svg") && tap.querySelector("svg"), "flask icon + info mark (decorative)");
  // geometry (the whole pill is the 44 px target) is checked against the real CSS in tests/e2e-demo.js
  p.render({ ...fresh, failed: true, lastOk: NOW - 120 }, NOW);
  ok(tap.hidden && !el.querySelector(".pillbtn").hidden, "feed error: Retry, no demo tap");
  host.remove();
});
