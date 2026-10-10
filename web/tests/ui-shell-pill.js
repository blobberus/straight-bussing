// ui/pill.js: status pill states, one icon per state (iOS RootView StatusPill parity, 2026-10-10). Pure + one DOM
// render; no timers (this file is last on ui-shell.test.html, after the contextbar marquee test).
import { test, eq, ok } from "./lib.js";
import { pillState, pillIconSVG, createPill, PILL_ICONS } from "../js/ui/pill.js";

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
  }
  eq(pillState({ liveLoaded: false, failed: false }, NOW, { bootS: NOW - 5 }).icon, "", "first poll grace");
  eq(pillState({ liveLoaded: false, failed: false }, NOW, { bootS: NOW - 60 }).icon, "feed", "never polled after the grace period");
  const icons = Object.keys(PILL_ICONS);
  eq(icons.sort(), ["delay", "feed", "idle", "silent"]);
  eq(new Set(icons.map((k) => PILL_ICONS[k])).size, 4, "four different drawings");
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
  p.render({ ...fresh, buses: [] }, NOW);
  eq([el.className, el.dataset.icon, el.querySelector(".pillbtn").hidden], ["statuspill info", "idle", true]);
  p.render(fresh, NOW);
  ok(el.hidden && !ic.innerHTML, "fresh data: no pill");
  host.remove();
});
