// data/usage.js (usage.test.html): rows, places, choices and the visit lifecycle, with a fake clock, page and sender.
import { test, eq, ok } from "./lib.js";
import { createStore } from "../js/core/store.js";
import { useMemoryOverlay } from "../js/core/storage.js";
import { USAGE_URL, AWAY, MAX_SESSION_S, NEW_SESSION_S, chicagoParts, placeName, nearestPlace, cleanUsage, privacySignal,
  buildRow, startUsage, anonId, resetId, usageConfigured, lastSend, _configureUsage } from "../js/data/usage.js";
import { bus } from "../js/core/events.js";

const URL_ = "https://script.google.com/macros/s/TEST/exec";
const STOPS = {
  a: { name: "57th St. & Metra (NB)", lat: 41.7915, lon: -87.5935 },
  b: { name: "Reynolds Club", lat: 41.7912, lon: -87.5986 },
};
const NEAR_B = { lat: 41.7914, lon: -87.5990, accuracy: 20 };   // about 40 m from Reynolds Club
const FAR = { lat: 41.85, lon: -87.65, accuracy: 20 };          // the Loop side: kilometres from every stop
const tick = () => new Promise((r) => setTimeout(r, 0));

function fakePage() {
  const doc = new EventTarget(), win = new EventTarget();
  doc.visibilityState = "visible";
  return { doc, win, hide() { doc.visibilityState = "hidden"; doc.dispatchEvent(new Event("visibilitychange")); },
    show() { doc.visibilityState = "visible"; doc.dispatchEvent(new Event("visibilitychange")); } };
}
/** A configured, forced setup with a fake clock and a capturing sender; restores everything in done(). */
function rig(state = {}) {
  useMemoryOverlay(true);
  let t = 1_793_106_000;   // 2026-10-27 13:00 UTC = 8:00 AM CDT, a Tuesday
  const sent = [];
  _configureUsage({ url: URL_, force: true, now: () => t, send: (u, body) => sent.push({ u, row: JSON.parse(body) }) });
  const store = createStore({ usage: cleanUsage(null, {}), user: null, stops: STOPS, ...state });
  const page = fakePage();
  const u = startUsage(store, { ver: "2.0.0", doc: page.doc, win: page.win });
  return { u, store, page, sent, rows: (e) => sent.filter((x) => x.row.e === e).map((x) => x.row), adv: (s) => { t += s; },
    done() { u?.stop(); _configureUsage({ url: USAGE_URL, force: false, send: null, now: () => Date.now() / 1000 }); useMemoryOverlay(false); } };
}

test("usage: off until a receiver is set; no number is made then", () => {
  ok(/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(USAGE_URL), "the owner's Apps Script receiver");
  ok(usageConfigured());
  _configureUsage({ url: "" });
  ok(!usageConfigured());
  useMemoryOverlay(true);
  try {
    const store = createStore({ usage: cleanUsage(null, {}) });
    eq(startUsage(store), null, "not configured: does nothing");
    _configureUsage({ url: URL_ });
    eq(startUsage(store), null, "configured but not a real https site (tests run on localhost): does nothing");
  } finally { _configureUsage({ url: USAGE_URL }); useMemoryOverlay(false); }
});

test("usage: Chicago date, weekday and time to the minute, both sides of daylight saving", () => {
  eq(chicagoParts(1_793_106_000), { day: "2026-10-27", dow: 2, time: "08:00" });
  eq(chicagoParts(1_796_104_800 + 59), { day: "2026-12-01", dow: 2, time: "00:00" }, "CST, just after midnight");
  eq(chicagoParts(1_793_149_200 - 60).time, "19:59");
});

test("usage: a place is the nearest stop within 400 m, both directions as one; never coordinates", () => {
  eq(placeName("57th St. & Metra (NB)"), "57th St. & Metra");
  eq(placeName("Garfield Red Line Station (EB)"), "Garfield Red Line Station");
  eq(nearestPlace(NEAR_B, STOPS), "Reynolds Club");
  eq(nearestPlace(FAR, STOPS), AWAY);
  eq(nearestPlace({ ...NEAR_B, accuracy: 900 }, STOPS), "", "too uncertain: no place");
  eq(nearestPlace(null, STOPS), "");
});

test("usage: choices default to length on, nearest stop off; a privacy signal turns length off by default", () => {
  eq(cleanUsage(null, {}), { dur: true, zone: false });
  eq(cleanUsage(null, { globalPrivacyControl: true }), { dur: false, zone: false });
  eq(cleanUsage(null, { doNotTrack: "1" }), { dur: false, zone: false });
  eq(cleanUsage({ dur: true, zone: true }, { globalPrivacyControl: true }), { dur: true, zone: true }, "the rider's own choice wins");
  ok(privacySignal({ globalPrivacyControl: true }) && !privacySignal({}));
});

test("usage: rows carry only what is described: start, end (length to 5 s, at most 3 h), place", () => {
  const who = { id: "a".repeat(32), made: true }, v = { sid: "b".repeat(32), startS: 1_793_106_000, dur: 123.4, zone: "Reynolds Club" };
  eq(buildRow("start", who, v, { app: "home-screen", ver: "2.0.0" }),
    { v: 1, e: "start", id: who.id, sid: v.sid, day: "2026-10-27", dow: 2, time: "08:00", app: "home-screen", ver: "2.0.0", nu: 1 });
  eq(buildRow("end", who, v), { v: 1, e: "end", id: who.id, sid: v.sid, dur: 125 });
  eq(buildRow("end", who, { ...v, dur: 99999 }).dur, MAX_SESSION_S);
  eq(buildRow("place", who, v), { v: 1, e: "place", id: who.id, sid: v.sid, zone: "Reynolds Club" });
  for (const e of ["start", "end", "place"]) {
    const keys = Object.keys(buildRow(e, who, v)).join(",");
    ok(!/lat|lon|ip|agent|name|email/i.test(keys), "no coordinates or identity fields: " + keys);
  }
});

test("usage: a visit sends start at once, then its length when the page goes to the background", () => {
  const r = rig();
  try {
    eq(r.rows("start").length, 1);
    const s = r.rows("start")[0];
    ok(/^[0-9a-f]{32}$/.test(s.id) && /^[0-9a-f]{32}$/.test(s.sid) && s.id !== s.sid);
    eq([s.day, s.time, s.nu, s.ver], ["2026-10-27", "08:00", 1, "2.0.0"]);
    r.adv(120); r.page.hide();
    eq(r.rows("end").map((x) => x.dur), [120]);
    r.page.show(); r.adv(2); r.page.hide();
    eq(r.rows("end").length, 1, "grew by under 5 s: not sent again");
    r.page.show(); r.adv(60); r.page.hide();
    eq(r.rows("end").map((x) => x.dur), [120, 180], "the same visit, a longer length");
    eq(new Set(r.sent.map((x) => x.row.sid)).size, 1);
    eq(r.rows("place").length, 0, "nearest stop off by default: no place");
  } finally { r.done(); }
});

test("usage: 30 min in the background makes the next foreground a new visit with the same number", () => {
  const r = rig();
  try {
    r.adv(30); r.page.hide();
    r.adv(NEW_SESSION_S + 5); r.page.show();
    const st = r.rows("start");
    eq(st.length, 2);
    ok(st[0].sid !== st[1].sid && st[0].id === st[1].id, "new visit, same browser");
    eq([st[0].nu, st[1].nu], [1, 0], "only the first visit of this browser is new");
    eq(st[1].time, "08:30");
  } finally { r.done(); }
});

test("usage: start is always sent, even with the length switched off; the length is not", () => {
  const r = rig({ usage: { dur: false, zone: false } });
  try {
    r.adv(300); r.page.hide();
    eq(r.rows("start").length, 1, "visit start and distinct visitors are counted regardless (owner)");
    eq(r.rows("end").length, 0);
    r.store.set({ usage: { dur: true, zone: false } });
    r.page.show(); r.adv(10); r.page.hide();
    eq(r.rows("end").map((x) => x.dur), [310], "turned on again: the visit's whole length");
  } finally { r.done(); }
});

test("usage: nearest stop only when turned on, once per visit, never coordinates", async () => {
  const r = rig({ usage: { dur: true, zone: false }, user: NEAR_B });
  try {
    eq(r.rows("place").length, 0, "off: nothing, even with location on");
    r.store.set({ usage: { dur: true, zone: true } });
    await tick();
    eq(r.rows("place").map((x) => x.zone), ["Reynolds Club"]);
    r.store.set({ user: FAR });
    await tick();
    eq(r.rows("place").length, 1, "once per visit (the first position)");
    ok(!JSON.stringify(r.sent).includes("41.79"), "no coordinates in any row");
  } finally { r.done(); }
});

test("usage: a new anonymous number from the next visit on; length capped at 3 h", () => {
  const r = rig();
  try {
    const first = r.rows("start")[0].id;
    resetId();
    r.adv(4 * 3600); r.page.hide();
    eq(r.rows("end")[0].dur, MAX_SESSION_S, "a tab left on screen counts at most 3 h");
    eq(r.rows("end")[0].id, first, "the visit keeps the number it started with");
    r.adv(NEW_SESSION_S + 1); r.page.show();
    const second = r.rows("start")[1];
    ok(second.id !== first && second.nu === 1, "a new number, counted as a new visitor");
    eq(anonId().id, second.id, "remembered");
  } finally { r.done(); }
});

test("usage: the start row's reply is kept for Settings; rows leaving the page ask for keepalive", async () => {
  useMemoryOverlay(true);
  let t = 1_793_106_000;
  const calls = [];
  const seen = [];
  const off = bus.on("usage:sent", (x) => seen.push(x));
  _configureUsage({ url: URL_, force: true, now: () => t, send: (u, body, o) => { calls.push({ e: JSON.parse(body).e, keep: !!(o && o.keep) }); return Promise.resolve("ok"); } });
  const page = fakePage();
  const u = startUsage(createStore({ usage: cleanUsage(null, {}), user: null, stops: STOPS }), { doc: page.doc, win: page.win });
  try {
    await tick(); await tick();
    eq(lastSend(), { at: t, res: "ok" });
    eq(seen.length, 1, "Settings is told");
    t += 60; page.hide();
    eq(calls.map((c) => [c.e, c.keep]), [["start", false], ["end", true]]);
  } finally { off(); u?.stop(); _configureUsage({ url: USAGE_URL, force: false, send: null, now: () => Date.now() / 1000 }); useMemoryOverlay(false); }
});
