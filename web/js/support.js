/**
 * @module support
 * support.html only (not part of the app shell's views): the "Contact support" button. It opens the support form
 * (the pre-filled Google Form link in ../support-form.js) with the "App and device" answer filled in:
 * "Straight Bussing <platform> <version>, <OS / device>", from the query (?contact=1&app=ios&v=<version (build)>&os=<iOS
 * version on model> from the iPhone app; ?contact=1&app=web&v=<APP_VERSION> from the web About) or from the browser.
 * ?contact=1 forwards straight to the form (location.replace, so Back returns to the app's page, not here).
 * Without a form link (or without JavaScript) the page keeps the GitHub Issues option.
 * Privacy: nothing is sent from here; the form page shows the details, the rider can change them, and only the
 * form's Submit sends anything (privacy.html "Contacting support").
 */
import { SUPPORT_FORM_URL } from "../support-form.js";

/** GitHub Issues, the option until the form exists (and the fallback without JavaScript). */
export const ISSUES_URL = "https://github.com/blobberus/straight-bussing/issues/new";

const PLACEHOLDER = /\{app\}|%7Bapp%7D/gi;
const PLATFORMS = { ios: "iPhone app", web: "web app" };
const BROWSERS = [
  ["Edge", /Edg(?:iOS|A)?\/(\d+)/],
  ["Opera", /(?:OPR|OPiOS)\/(\d+)/],
  ["Samsung Internet", /SamsungBrowser\/(\d+)/],
  ["Firefox", /(?:FxiOS|Firefox)\/(\d+)/],
  ["Chrome", /(?:CriOS|Chrome)\/(\d+)/],
  ["Safari", /Version\/(\d+(?:\.\d+)?).*Safari\//],
];
const DEVICES = [
  ["iPhone", /iPhone|iPod/], ["iPad", /iPad/], ["Android", /Android/], ["ChromeOS", /CrOS/],
  ["Windows", /Windows/], ["Mac", /Macintosh|Mac OS X/], ["Linux", /Linux/],
];

/**
 * One query value made safe for the answer: no control characters, single spaces, at most `max` characters.
 * @param {*} v
 * @param {number} [max=60]
 * @returns {string}
 */
export function clean(v, max = 60) {
  return String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max).trim();
}

/**
 * "Safari 26.0 on iPhone", "Edge 141 on Windows" from a user agent. An iPad asking for the desktop site reports a
 * Mac; more than one touch point makes it an iPad.
 * @param {string} ua
 * @param {number} [touchPoints=0] navigator.maxTouchPoints
 * @returns {string}
 */
export function browserText(ua, touchPoints = 0) {
  const s = String(ua || "");
  let device = (DEVICES.find(([, re]) => re.test(s)) || [""])[0];
  if (device === "Mac" && touchPoints > 1) device = "iPad";
  const b = BROWSERS.find(([, re]) => re.test(s));
  const browser = b ? `${b[0]} ${s.match(b[1])[1]}` : "";
  return [browser, device].filter(Boolean).join(" on ") || "unknown browser";
}

/**
 * The "App and device" answer: "Straight Bussing iPhone app 1.0.0 (12), iOS 26.1 on iPhone17,1".
 * @param {string} search location.search
 * @param {string} ua navigator.userAgent
 * @param {number} [touchPoints=0]
 * @returns {string}
 */
export function appDetails(search, ua, touchPoints = 0) {
  const q = new URLSearchParams(search || "");
  const app = clean(q.get("app"), 10).toLowerCase();
  const head = ["Straight Bussing", PLATFORMS[app] || "", clean(q.get("v"), 40)].filter(Boolean).join(" ");
  const device = clean(q.get("os")) || browserText(ua, touchPoints);
  return `${head}, ${device}`;
}

/**
 * The form link with the answer in place of {app} (or Google's %7Bapp%7D); "" unless it is a Google Forms link.
 * @param {string} template SUPPORT_FORM_URL
 * @param {string} details appDetails(...)
 * @returns {string}
 */
export function formLink(template, details) {
  const t = String(template || "").trim();
  if (!/^https:\/\/(docs\.google\.com\/forms\/|forms\.gle\/)\S+$/i.test(t)) return "";
  return t.replace(PLACEHOLDER, () => encodeURIComponent(details));
}

/**
 * GitHub "new issue" link with the details at the top of the body (the option while there is no form).
 * @param {string} details
 * @returns {string}
 */
export function issuesLink(details) {
  return `${ISSUES_URL}?body=${encodeURIComponent(`App and device: ${details}\n\nWhat happened:\n`)}`;
}

/**
 * Wire support.html: button link, the details line, the form / GitHub texts, and ?contact=1 forwarding.
 * @param {{doc?: Document, loc?: {search: string, replace: (u: string) => void}, ua?: string, touchPoints?: number, form?: string}} [env]
 * @returns {"forwarded"|"form"|"issues"}
 */
export function mountSupport(env = {}) {
  const doc = env.doc || document;
  const loc = env.loc || location;
  const details = appDetails(loc.search, env.ua ?? navigator.userAgent, env.touchPoints ?? (navigator.maxTouchPoints || 0));
  const link = formLink(env.form ?? SUPPORT_FORM_URL, details);
  const btn = doc.querySelector("[data-support-contact]");
  for (const el of doc.querySelectorAll("[data-support-details]")) el.textContent = details;
  for (const el of doc.querySelectorAll("[data-js-only]")) el.hidden = false;
  doc.documentElement.classList.toggle("has-form", Boolean(link));
  if (btn) btn.href = link || issuesLink(details);
  const contact = new URLSearchParams(loc.search || "").get("contact") === "1";
  if (!link) {
    if (contact) doc.getElementById("contact")?.scrollIntoView?.();
    return "issues";
  }
  if (contact) {
    loc.replace(link);
    return "forwarded";
  }
  return "form";
}

if (typeof document !== "undefined" && document.querySelector("[data-support-contact]")) mountSupport();
