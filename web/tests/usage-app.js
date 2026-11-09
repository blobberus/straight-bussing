// The REAL app and the anonymous usage statistics (usage.test.html), checked after the glass interface came over from
// the experimental build (2026-11-05, owner: "Check for bugs and data collcetion for logins that may be messed up during
// the change"): in the test suite (http://localhost, an automated browser) nothing is ever sent, and the glass Settings
// sheet still has Settings > Usage statistics with its two labeled switches, which save the rider's choice. The rows
// themselves, the live path and the experimental path are covered in usage-core.js (realSite).
import { test, eq, ok } from "./lib.js";
import { FEEDBACK_BTN_OFF_KEY } from "../js/ui/feedback-button.js";
import { A2HS_OFF_KEY } from "../js/ui/install-prompt.js";
// test seam: the Add to Home Screen card (ui/install-prompt.js) never shows by itself in these flows (install.test.html covers it)
try { sessionStorage.setItem(A2HS_OFF_KEY, "1"); } catch (e) { /* blocked storage */ }
import { OVERLAY_ID } from "../js/ui/settings-overlay.js";
import { LOC_ZONE_NOTE } from "../js/ui/views/settings.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, what, ms = 8000) {
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try { v = fn(); } catch (e) { v = null; }
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting for " + what);
    await sleep(25);
  }
}

/** Records every request to the usage receiver (fetch and sendBeacon), installed before the app's own scripts. */
const SPY = `<script>(function () {
  var w = window, sent = (w.__usageSent = []);
  var hit = function (u) { return /script\\.google\\.com|script\\.googleusercontent\\.com/.test(String(u && u.url || u)); };
  var f = w.fetch;
  w.fetch = function (u) { if (hit(u)) { sent.push("fetch " + String(u && u.url || u)); return Promise.resolve(new Response("ok")); } return f.apply(this, arguments); };
  try { var b = navigator.sendBeacon; navigator.sendBeacon = function (u) { if (hit(u)) { sent.push("beacon " + u); return true; } return b ? b.apply(navigator, arguments) : false; }; } catch (e) {}
})();</script>`;

/** The real index.html with the e2e stubs, the spy and a store handle, in a 393 x 852 phone iframe. */
async function openApp() {
  const html = await (await fetch("../index.html", { cache: "no-store" })).text();
  const base = new URL("../", location.href).href;
  let page = html.replace(/<head>/i, `<head><base href="${base}"><script src="tests/e2e-stubs.js"></script>${SPY}`);
  page = page.replace(/<script type="module" src="js\/main\.js[^"]*"><\/script>/,
    (m) => `<script type="module">import { store } from "./js/state.js"; window.__st = store;</script>${m}`);
  if (!page.includes("window.__st")) throw new Error("js/main.js <script> tag not found in index.html");
  const f = document.createElement("iframe");
  f.style.cssText = "width:393px;height:852px;border:0;display:block";
  document.body.appendChild(f);
  f.contentDocument.open();
  f.contentDocument.write(page);
  f.contentDocument.close();
  const w = f.contentWindow, d = w.document;
  await waitFor(() => w.__st && w.__st.get().staticLoaded && w.__st.get().liveLoaded && d.getElementById("app").dataset.view === "nearby", "the app rendered with live data");
  return { f, w, d };
}

let A = null;   // the app shared by the two tests below (each test has 8 s)
const keep = {};

test("real app (glass interface): boots with live data and sends no usage row in the test suite (http, automated browser)", async () => {
  sessionStorage.setItem(FEEDBACK_BTN_OFF_KEY, "1");   // the feedback circle stays out of this flow
  for (const k of Object.keys(localStorage)) if (/usage/i.test(k)) keep[k] = localStorage.getItem(k);
  A = await openApp();
  await sleep(1000);   // past the dynamic import of data/usage.js
  eq(A.w.__usageSent, [], "nothing sent");
});

test("real app (glass interface): Settings > Usage statistics has both labeled switches and they save the choice", async () => {
  ok(A, "the app from the previous test");
  const { f, w, d } = A;
  try {
    d.getElementById("settingsBtn").click();
    const dur = await waitFor(() => d.querySelector(`#${OVERLAY_ID} [data-st-in="usageDur"]`), "the Settings sheet's usage switches", 5000);
    const zone = d.querySelector(`#${OVERLAY_ID} [data-st-in="usageZone"]`);
    ok(zone, "both switches");
    const ov = d.getElementById(OVERLAY_ID);
    ok([...ov.querySelectorAll("h3")].some((h) => h.textContent.trim() === "Usage statistics"), "the Usage statistics section");
    ok(/Always counted, anonymously/.test(ov.textContent) && /Your identity is never collected/.test(ov.textContent), "it says what is always sent and that identity never is");
    for (const [el, name] of [[dur, "Share how long I use the app"], [zone, "Include my nearest stop"]]) {
      const lab = el.closest("label");
      ok(lab && lab.textContent.includes(name), "labeled: " + name);
      eq(el.getAttribute("role"), "switch", name + " is a switch");
      ok(lab.getBoundingClientRect().height >= 44, name + ": a 44 px target (" + Math.round(lab.getBoundingClientRect().height) + ")");
    }
    ok(dur.checked && !zone.checked, "defaults: length on, nearest stop off");
    dur.closest("label").click();
    await waitFor(() => w.__st.get().usage.dur === false, "the length switch turns off", 2000);
    const q = (k) => d.querySelector(`#${OVERLAY_ID} [data-st-in="${k}"]`);   // the region may be redrawn after a change
    ok(!q("usageDur").checked, "the switch shows it");
    q("usageZone").closest("label").click();
    await waitFor(() => w.__st.get().usage.zone === true, "the nearest-stop switch turns on", 2000);
    await waitFor(() => ov.textContent.includes(LOC_ZONE_NOTE), "the location note says the nearest stop is shared", 2000);
    const saved = Object.keys(localStorage).filter((k) => /usage/i.test(k) && !/usageId|usageLastStart/i.test(k)).map((k) => localStorage.getItem(k)).join(" ");
    ok(/"dur":false/.test(saved) && /"zone":true/.test(saved), "the choice is saved in this browser: " + saved);
    eq(w.__usageSent, [], "still nothing sent");
    eq(w.__e2e.errors, [], "no console errors");
  } finally {
    f.remove();
    sessionStorage.removeItem(FEEDBACK_BTN_OFF_KEY);
    for (const k of Object.keys(localStorage)) if (/usage/i.test(k) && !(k in keep)) localStorage.removeItem(k);
    for (const [k, v] of Object.entries(keep)) localStorage.setItem(k, v);
  }
});
