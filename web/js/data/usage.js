/**
 * @module data/usage
 * Anonymous usage statistics for the WEBSITE (owner 2026-10-27: "track when a distinct user logs on (time of day),
 * track how long they use it, track what locations they use it most often from", anonymously; visit start and
 * distinct users "should collect regardless", visit length on with an opt-out, nearest stop opt-in). The rider's
 * identity is never collected. docs/USAGE-STATS.md.
 *
 * Off until configured: USAGE_URL is empty, and while it is empty nothing is ever sent, no number is made and
 * Settings, About and the location note look exactly as before. The owner fills it in with the address of the
 * receiver (tools/usage/Code.gs, a Google Apps Script web app that appends rows to a Google Sheet).
 *
 * Three kinds of rows, each tied to one rule (all carry id + sid so a visit's rows join up):
 *   start  ALWAYS (the owner's rule): when a visit begins. day / dow / time = Chicago date, weekday (0 = Sunday),
 *          clock time to the minute; app = "home-screen" (installed web app) or "browser"; ver; nu = 1 on this
 *          browser's first visit
 *   end    unless the rider turned off "Share how long I use the app" (on by default, off by default when the
 *          browser sends Global Privacy Control or Do Not Track): dur = seconds on screen in this visit, to 5 s,
 *          at most 3 h; sent each time the page goes to the background (the length only grows within a visit)
 *   place  only when the rider turned on "Include my nearest stop" and allowed location: zone = the name of the stop
 *          nearest the first position of the visit, within 400 m (both directions of a street stop are one place),
 *          or "Away from stops". Never coordinates. Once per visit.
 *   id   a random 128-bit number made in this browser (localStorage 'sb:usageId'): it only tells two visits of the
 *        same browser apart. It is not linked to a name, account, email, phone, IP address or device details, and
 *        Settings can replace it with a new one at any time.
 *   sid  a random number for this visit.
 * Never sent: coordinates, IP address (the receiver cannot see it), user agent, screen, referrer, searches, taps.
 * Never sent at all: demo mode, automated browsers, pages not served over https. The iPhone app has no part in this
 * (its App Privacy label stays Data Not Collected).
 * A visit ends after 30 min in the background (NEW_SESSION_S): coming back later is a new visit.
 */
import { DEMO } from "../core/demo.js";
import { hav } from "../core/geo.js";
import { ZONE } from "../core/time.js";
import { load, save, remove } from "../core/storage.js";

/** The receiver: the owner's Apps Script web app (tools/usage/Code.gs; docs/USAGE-STATS.md). Empty: nothing is ever sent. */
export const USAGE_URL = "https://script.google.com/macros/s/AKfycbzNBpOOftjp3sVA_UuyIGgFGsKFhMo3e_iP0u9NFwUJT3FeR8b6NwSgJMiBo7UGzWUr/exec";
/** Background time after which coming back counts as a new visit. */
export const NEW_SESSION_S = 30 * 60;
/** Longest visit length sent (a tab left open on a desktop must not count as a day of use). */
export const MAX_SESSION_S = 3 * 3600;
/** The nearest stop counts as the place only this close (metres). */
export const ZONE_RADIUS_M = 400;
/** A position farther than this from every stop. */
export const AWAY = "Away from stops";
/** A position less certain than this (metres) gives no place. */
const MAX_ACCURACY_M = 500;
/** An "end" row is sent again only when the length grew by at least this much. */
const RESEND_S = 5;
const ID_KEY = "usageId";
const HEX32 = /^[0-9a-f]{32}$/;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Live configuration (tests replace parts of it with _configureUsage). */
const cfg = { url: USAGE_URL, send: null, now: () => Date.now() / 1000, force: false };

/** @returns {boolean} true when a receiver is set (the feature exists at all) */
export function usageConfigured() {
  return !!cfg.url;
}

/**
 * Does the browser ask not to be tracked (Global Privacy Control or Do Not Track)?
 * @param {Navigator|object|null} [nav]
 * @returns {boolean}
 */
export function privacySignal(nav = typeof navigator !== "undefined" ? navigator : null) {
  try { return !!nav && (nav.globalPrivacyControl === true || nav.doNotTrack === "1" || nav.doNotTrack === "yes"); } catch (e) { return false; }
}

/**
 * The rider's choices: visit length on by default (off with a privacy signal), nearest stop off until turned on.
 * @param {unknown} v persisted value
 * @param {Navigator|object|null} [nav]
 * @returns {{dur:boolean, zone:boolean}}
 */
export function cleanUsage(v, nav) {
  const o = v && typeof v === "object" ? v : {};
  return { dur: typeof o.dur === "boolean" ? o.dur : !privacySignal(nav), zone: typeof o.zone === "boolean" ? o.zone : false };
}

/**
 * Chicago date, weekday (0 = Sunday) and clock time (HH:MM, 24 h) of a moment.
 * @param {number} unixS
 * @returns {{day:string, dow:number, time:string}}
 */
export function chicagoParts(unixS) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" });
  const p = {};
  for (const x of f.formatToParts(new Date(unixS * 1000))) p[x.type] = x.value;
  return { day: `${p.year}-${p.month}-${p.day}`, dow: DAYS.indexOf(p.weekday), time: `${p.hour === "24" ? "00" : p.hour}:${p.minute}` };
}

/**
 * A stop's name as a place: both directions of a street stop ("57th St. & Metra (NB)" / "(SB)") are one place.
 * @param {string} name
 * @returns {string}
 */
export function placeName(name) {
  return String(name || "").replace(/\s*\((?:NB|SB|EB|WB|N|S|E|W)\)\s*$/i, "").trim().slice(0, 60);
}

/**
 * The place of a position: the nearest stop within ZONE_RADIUS_M, AWAY beyond, "" when unknown or too uncertain.
 * @param {{lat:number, lon:number, accuracy?:number}|null} user
 * @param {Record<string,{name:string, lat:number, lon:number}>} stops
 * @returns {string}
 */
export function nearestPlace(user, stops) {
  if (!user || !Number.isFinite(user.lat) || !Number.isFinite(user.lon) || !stops) return "";
  if (Number.isFinite(user.accuracy) && user.accuracy > MAX_ACCURACY_M) return "";
  let best = null, bd = Infinity;
  for (const s of Object.values(stops)) {
    if (!s || !Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;
    const d = hav(user, s);
    if (d < bd) { bd = d; best = s; }
  }
  if (!best) return "";
  return bd <= ZONE_RADIUS_M ? placeName(best.name) : AWAY;
}

function randomHex(bytes) {
  const a = new Uint8Array(bytes);
  try { crypto.getRandomValues(a); } catch (e) { for (let i = 0; i < bytes; i++) a[i] = Math.floor(Math.random() * 256); }
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * This browser's random number, made and remembered the first time it is needed.
 * @returns {{id:string, made:boolean}} made: true when it was just made (this browser's first visit)
 */
export function anonId() {
  const id = load(ID_KEY, null);
  if (typeof id === "string" && HEX32.test(id)) return { id, made: false };
  const nid = randomHex(16);
  save(ID_KEY, nid);
  return { id: nid, made: true };
}

/** Settings > "Get a new anonymous number": forget this browser's number; the next visit makes a new one. */
export function resetId() {
  remove(ID_KEY);
}

/** The installed home-screen app, or a browser tab. */
function appKind() {
  try {
    if (window.matchMedia?.("(display-mode: standalone)")?.matches || navigator.standalone === true) return "home-screen";
  } catch (e) { /* */ }
  return "browser";
}

/** Fire and forget: a beacon (survives the page closing), else a keepalive POST. Never throws. */
function defaultSend(url, body) {
  try {
    if (navigator.sendBeacon && navigator.sendBeacon(url, new Blob([body], { type: "text/plain;charset=UTF-8" }))) return true;
  } catch (e) { /* */ }
  try {
    fetch(url, { method: "POST", mode: "no-cors", keepalive: true, headers: { "Content-Type": "text/plain;charset=UTF-8" }, body }).catch(() => {});
    return true;
  } catch (e) { return false; }
}

/** May this page send at all (receiver set, real site, not demo, not an automated browser)? */
function allowedHere() {
  if (!cfg.url) return false;
  if (cfg.force) return true;
  if (DEMO) return false;
  try {
    if (navigator.webdriver) return false;
    if (location.protocol !== "https:") return false;
  } catch (e) { return false; }
  return true;
}

/**
 * Build one row. Pure: the caller supplies who, the visit and the extras.
 * @param {"start"|"end"|"place"} e
 * @param {{id:string, made?:boolean}} who
 * @param {{sid:string, startS:number, dur?:number, zone?:string}} visit
 * @param {{app?:string, ver?:string}} [extra]
 * @returns {object}
 */
export function buildRow(e, who, visit, extra = {}) {
  const row = { v: 1, e, id: who.id, sid: visit.sid };
  if (e === "start") {
    const p = chicagoParts(visit.startS);
    Object.assign(row, { day: p.day, dow: p.dow, time: p.time, app: extra.app || "browser", ver: String(extra.ver || "").slice(0, 20), nu: who.made ? 1 : 0 });
  } else if (e === "end") {
    row.dur = Math.min(MAX_SESSION_S, Math.max(0, Math.round((visit.dur || 0) / 5) * 5));
  } else if (e === "place") {
    row.zone = String(visit.zone || "").slice(0, 60);
  }
  return row;
}

/**
 * Start counting visits for this page. Returns null (and does nothing) unless a receiver is set and this page may
 * send. The rider's choices are read from store.get().usage at every send.
 * @param {{get():object, subscribe(fn:Function):Function}} store
 * @param {{ver?:string, doc?:Document, win?:Window}} [o]
 * @returns {{stop():void, visit():object}|null}
 */
export function startUsage(store, o = {}) {
  if (!allowedHere()) return null;
  const doc = o.doc || document, win = o.win || window;
  const send = cfg.send || defaultSend;
  const app = appKind();
  let visit = null, visibleSince = null, hiddenAt = null;
  const prefs = () => cleanUsage(store.get().usage);

  function post(e) {
    if (!visit) return;
    const row = buildRow(e, visit.who, visit, { app, ver: o.ver });
    try { send(cfg.url, JSON.stringify(row)); } catch (err) { /* never break the app */ }
    if (e === "end") visit.sentDur = row.dur;
    if (e === "place") visit.placeSent = true;
  }
  function placeOnce(s) {
    if (!visit || visit.placeSent || !cleanUsage(s.usage).zone || !s.user) return;
    if (!visit.zone) visit.zone = nearestPlace(s.user, s.stops);
    if (visit.zone) post("place");
  }
  function begin() {
    const now = cfg.now();
    // the visit keeps the number it started with (a reset in Settings applies from the next visit)
    visit = { who: anonId(), sid: randomHex(16), startS: now, dur: 0, zone: "", sentDur: -1, placeSent: false };
    visibleSince = doc.visibilityState === "hidden" ? null : now;
    post("start");   // always: visit start and distinct users are counted regardless of the switches (owner)
    placeOnce(store.get());
  }
  function onHide() {
    if (!visit || visibleSince === null) return;
    const now = cfg.now();
    visit.dur = Math.min(MAX_SESSION_S, visit.dur + Math.max(0, now - visibleSince));
    visibleSince = null;
    hiddenAt = now;
    if (prefs().dur && Math.round(visit.dur) - visit.sentDur >= RESEND_S) post("end");
  }
  function onShow() {
    const now = cfg.now();
    if (hiddenAt !== null && now - hiddenAt >= NEW_SESSION_S) { hiddenAt = null; begin(); return; }
    hiddenAt = null;
    if (visibleSince === null) visibleSince = now;
  }
  const onVis = () => (doc.visibilityState === "hidden" ? onHide() : onShow());
  doc.addEventListener("visibilitychange", onVis);
  win.addEventListener("pagehide", onHide);
  const off = store.subscribe((s, ch) => {
    if (!ch || ch.has("user") || ch.has("stops") || ch.has("usage")) placeOnce(s);
  });
  begin();
  return {
    stop() { doc.removeEventListener("visibilitychange", onVis); win.removeEventListener("pagehide", onHide); off?.(); },
    visit: () => ({ ...visit }),
    _hide: onHide, _show: onShow,
  };
}

/**
 * Test seam: replace the receiver, the sender, the clock, or skip the "real site" checks.
 * @param {{url?:string, send?:Function|null, now?:Function, force?:boolean}} o
 * @returns {void}
 */
export function _configureUsage(o) {
  if ("url" in o) cfg.url = o.url;
  if ("send" in o) cfg.send = o.send;
  if ("now" in o) cfg.now = o.now;
  if ("force" in o) cfg.force = !!o.force;
}
