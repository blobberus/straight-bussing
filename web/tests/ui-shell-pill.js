// ui/pill.js: status pill states, one icon per state (iOS RootView StatusPill parity, 2026-10-10). Pure + one DOM
// render; no timers (this file is last on ui-shell.test.html, after the contextbar marquee test).
import { test, eq, ok, near } from "./lib.js";
import { pillState, pillIconSVG, createPill, PILL_ICONS, RETRY_HOLD_MS, BACK_MSG, CALL_TEXT, MORE_LABEL } from "../js/ui/pill.js";
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
  const ic = el.querySelector(".pillicon"), retry = el.querySelector(".pillbtn");
  ok(ic && ic.getAttribute("aria-hidden") === "true", "icon slot created, hidden from screen readers");
  ok(el.firstElementChild === retry && retry.nextElementSibling.matches('[data-action="alerts:open"]') && retry.nextElementSibling.nextElementSibling === ic,
    "the action slot first, on the leading edge (Retry, See alert; owner 2026-11-03), then the icon");
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

// Owner 2026-11-03: "move the retry button to the left side of the notification so if the user spams it while on a route, it
// doesn't shift and accidentally cancel their current trip". After a tap the banner holds still for RETRY_HOLD_MS.
test("pill: after a Retry tap the banner holds still, then shows the feed's state", async () => {
  const host = document.createElement("div");
  host.innerHTML = '<div class="statuspill" hidden><button class="pillbtn" hidden>Retry</button><span class="pilltext"></span></div>';
  document.body.appendChild(host);
  const el = host.firstChild, retry = el.querySelector(".pillbtn"), p = createPill({ pill: el, text: el.querySelector(".pilltext"), retry });
  p.render({ ...fresh, failed: true, lastOk: NOW - 120 }, NOW);
  ok(!el.hidden && !retry.hidden, "error banner with Retry");
  retry.click();
  eq(retry.getAttribute("aria-busy"), "true", "busy while retrying");
  const h0 = el.offsetHeight;
  p.render(fresh, NOW);   // the feed is back at once
  ok(!el.hidden && !retry.hidden && el.textContent.includes(BACK_MSG), "held: \"Live data is back.\" with Retry still in its slot");
  eq(retry.getAttribute("aria-disabled"), "true", "taps absorbed (no poll, no action)");
  eq(el.offsetHeight, h0, "the banner keeps its height");
  retry.click();   // another tap restarts the hold (RETRY_HOLD_MS after the LAST tap)
  await new Promise((r) => setTimeout(r, RETRY_HOLD_MS + 80));
  ok(el.hidden && !retry.hasAttribute("aria-busy"), "after the hold: the current state (fresh = no banner)");
  host.remove();
});

// 2026-11-05 QA: Details sits on the banner's trailing side, where the trip chip's Show all (which ends the trip at once)
// would slide up if the banner went away between two taps (the feed coming back). A Details tap holds the banner too.
test("pill: a Details tap holds the banner, so the trip chip never slides up under a second tap", async () => {
  const host = document.createElement("div");
  host.innerHTML = '<div class="statuspill" hidden><button class="pillbtn" hidden>Retry</button><span class="pilltext"></span></div>';
  document.body.appendChild(host);
  const el = host.firstChild, retry = el.querySelector(".pillbtn"), p = createPill({ pill: el, text: el.querySelector(".pilltext"), retry });
  const more = () => el.querySelector(".pillmore");
  p.render({ ...fresh, feedTs: NOW - 150 }, NOW);   // delayed: a banner with no Retry
  ok(!el.hidden && retry.hidden, "a delayed-feed banner");
  more().click();
  p.render(fresh, NOW);   // the feed is fresh again a moment later
  ok(!el.hidden && el.textContent.includes(BACK_MSG), "held: the banner stays and says \"Live data is back.\"");
  p.render({ ...fresh, failed: true, lastOk: NOW - 120 }, NOW);   // a new problem during the hold still shows
  ok(!el.hidden && el.textContent.includes("Can't reach the shuttle feed") && !retry.hidden && !retry.hasAttribute("aria-disabled"), "a new warning still shows, Retry usable");
  p.render(fresh, NOW);
  await new Promise((r) => setTimeout(r, RETRY_HOLD_MS + 80));
  ok(el.hidden, "after the hold: the current state");
  p.render({ ...fresh, buses: [] }, NOW);   // "No shuttles running": not a feed problem
  ok(!el.hidden, "a no-shuttles banner");
  more().click();
  p.render(fresh, NOW);
  ok(!el.hidden && !el.textContent.includes(BACK_MSG), "held without \"Live data is back.\" (the live data never went)");
  await new Promise((r) => setTimeout(r, RETRY_HOLD_MS + 80));
  ok(el.hidden, "then gone");
  host.remove();
});

// Owner 2026-11-04: "Reduce the size of the reconnecting notification." One 44 pt line in the footnote role that still
// says the times can't be relied on; the full sentence and the official number one tap away (Details); screen readers
// always hear the full sentence; the line (and the Retry slot) never moves when the details open or close.
test("pill: compact banner: a short line per state that still warns, the full sentence kept for screen readers", () => {
  const cases = [
    [{ ...fresh, failed: true, lastOk: NOW - 120 }, "Live data lost. Times may be off."],
    [{ ...fresh, failed: true, lastOk: 0, feedTs: 0 }, "No live data. Don't rely on times."],
    [{ ...fresh, feedTs: NOW - 150 }, "Live data delayed. Times may be off."],
    [{ ...fresh, buses: [] }, "No shuttles running right now"],
  ];
  for (const [s, short] of cases) {
    const p = pillState(s, NOW);
    eq(p.short, short, p.msg);
    ok(p.short.length <= 40, "short enough for one line beside the Retry slot: " + p.short.length);
  }
  const old = pillState({ ...fresh, feedTs: NOW - 400 }, NOW);
  ok(/^Last update .+\. Times approximate\.$/.test(old.short) && old.msg.startsWith("Live data is out of date"), "out of date: " + old.short);
  eq(pillState({ ...fresh, feedTs: 0, lastOk: NOW - 400, liveLoaded: true }, NOW).short.length > 0, true, "always a short line when there is a message");
  for (const s of [{ ...fresh, failed: true, lastOk: NOW - 120 }, { ...fresh, failed: true, lastOk: 0, feedTs: 0 }, { ...fresh, feedTs: NOW - 150 }, { ...fresh, feedTs: NOW - 400 }]) {
    ok(/off|rely|approximate/.test(pillState(s, NOW).short), "a feed problem's short line says the times can't be relied on: " + pillState(s, NOW).short);
  }
  eq(pillState({ ...fresh }, NOW, { demo: true }).short, "Simulated buses", "the demo chip keeps its words");
  ok(!/[–—]/.test(cases.map((c) => c[1]).join(" ")) && !/UChicago|UGo/.test(CALL_TEXT), "no dashes, no university names");
  eq(CALL_TEXT, "Call 773.702.8181");
});

test("pill: Details opens the full sentence and the call link under the line; the line and the Retry slot never move", () => {
  const f = document.createElement("iframe");
  f.style.cssText = "position:absolute;left:-10000px;top:0;width:393px;height:852px;border:0";
  document.body.appendChild(f);
  const d = f.contentDocument;
  d.open();
  d.write('<!doctype html><html><head><meta name="viewport" content="width=device-width">'
    + ["tokens", "base"].map((n) => `<link rel="stylesheet" href="${new URL("../css/" + n + ".css", location.href).href}">`).join("")
    + '<style>*,*::before,*::after{transition:none!important;animation:none!important}</style></head><body><div id="app" class="app">'
    + '<div id="pill" class="statuspill" role="status" aria-live="polite" hidden><button id="pillRetry" class="pillbtn pillslot" type="button" hidden>Retry</button>'
    + '<button id="pillAlert" class="pillbtn pillslot" type="button" data-action="alerts:open" hidden>See alert</button>'
    + '<span id="pillIcon" class="pillicon" aria-hidden="true"></span><span id="pillText" class="pilltext"></span></div></div></body></html>');
  d.close();
  return new Promise((res) => setTimeout(res, 300)).then(async () => {
    try {
      const el = d.getElementById("pill"), retry = d.getElementById("pillRetry"), text = d.getElementById("pillText");
      const p = createPill({ pill: el, text, retry });
      p.render({ ...fresh, failed: true, lastOk: 0, feedTs: 0 }, NOW);
      const more = el.querySelector(".pillmore"), call = el.querySelector(".pillcall"), short = el.querySelector(".pillshort");
      ok(more && more.tagName === "BUTTON" && more.getAttribute("aria-label") === MORE_LABEL && more.getAttribute("aria-expanded") === "false", "a Details button, closed");
      eq(more.getAttribute("aria-controls"), "pillText");
      eq(short.getAttribute("aria-hidden"), "true", "the short line is for the eye; the full sentence is read");
      ok(text.textContent.includes("Don't rely on these times; call 773.702.8181."), "screen readers hear the full warning: " + text.textContent);
      eq(short.textContent, "No live data. Don't rely on times.");
      ok(call && call.hidden && call.getAttribute("href") === "tel:+17737028181" && call.textContent === CALL_TEXT, "the call link, hidden while closed");
      const w = f.contentWindow, R = (x) => x.getBoundingClientRect();
      const h0 = R(el).height, line0 = R(more), slot0 = R(retry);
      ok(h0 <= 46, "one 44 pt line: " + h0);
      ok(R(text).width <= 1, "the full sentence is visually hidden while closed");
      eq(w.getComputedStyle(el).fontSize, "13px", "the footnote role (13 at the 17 px root)");
      ok(Math.abs(slot0.left - R(el).left) < 1 && slot0.width >= 84 && slot0.height >= 44, "the Retry slot: 84 x 44 at the leading edge");
      more.click();
      eq([more.getAttribute("aria-expanded"), call.hidden, el.classList.contains("is-open")], ["true", false, true], "open");
      ok(R(el).height > h0 + 30 && R(text).width > 100, "the full sentence shows under the line");
      eq([R(more).top, R(more).left, R(retry).top, R(retry).left], [line0.top, line0.left, slot0.top, slot0.left], "the line and the Retry slot stay put");
      ok(R(call).height >= 44 && R(call).top > R(text).top, "Call 773.702.8181 under the sentence, 44 pt tall");
      p.render({ ...fresh, failed: true, lastOk: NOW - 120 }, NOW);
      ok(el.classList.contains("is-open") && !call.hidden, "a new feed state keeps the details open");
      ok(text.textContent.includes("Showing last known data") && short.textContent === "Live data lost. Times may be off.", "and updates both texts");
      more.click();
      eq([more.getAttribute("aria-expanded"), call.hidden], ["false", true], "closed again");
      eq([R(more).top, R(retry).top], [line0.top, slot0.top], "closing moves nothing on the line");
      near(R(el).height, h0, 1, "back to one line");
      p.render(fresh, NOW);
      ok(!el.hidden && short.textContent === BACK_MSG, "fresh data right after a Details tap: the banner holds (\"Live data is back.\")");
      await new Promise((r) => setTimeout(r, RETRY_HOLD_MS + 80));
      ok(el.hidden, "fresh data: no banner once the hold ends");
      p.render({ ...fresh, feedTs: NOW - 150 }, NOW);
      ok(!el.classList.contains("is-open") && call.hidden, "a banner that comes back starts closed");
      p.render({ ...fresh, failed: true, lastOk: NOW - 120 }, NOW);
      more.click();    // details open...
      retry.click();   // ...a Retry hold keeps the open height...
      more.click();    // ...and closing the details during it leaves the extra height under the line (base.css align-content)
      eq([R(more).top, R(retry).top], [line0.top, slot0.top], "closing the details during a Retry hold moves nothing on the line");
      // the demo chip: no Details, the words in the chip
      const q = createPill({ pill: el, text, retry }, { demo: true });
      q.render({ ...fresh }, NOW);
      ok(more.hidden && w.getComputedStyle(more).display === "none" && R(text).width > 40, "the demo chip shows its words, no Details");
    } finally { f.remove(); }
  });
});
