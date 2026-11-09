// The REAL app without the beta welcome popup (feedback.test.html; removed 2026-11-04, owner: "Stop the give feedback
// sign on every login to pop up. Keep the feedback button on the map screen."): a first visit, a reload and a visit a
// week after the old popup last appeared show no popup, and the map's feedback button still appears under the Settings
// circle until the rider gives feedback (same-origin iframes share this page's sessionStorage and localStorage).
// 1. live mode (e2e-stubs.js: fake feed, no location) in a 393 x 852 phone iframe; 2. ?demo=1 in a 1280 x 800
// desktop window (phone frame), then a reload; 3. new visits with the old popup's log in storage.
import { test, eq, ok } from "./lib.js";
import { WELCOME_LOG_KEY, FEEDBACK_DONE_KEY, FEEDBACK_URL } from "../js/ui/feedback.js";
import { FEEDBACK_BTN_OFF_KEY, crowds } from "../js/ui/feedback-button.js";
import { OVERLAY_ID } from "../js/ui/settings-overlay.js";
import { A2HS_OFF_KEY } from "../js/ui/install-prompt.js";
// test seam: the Add to Home Screen card (ui/install-prompt.js) never shows by itself in these flows (install.test.html covers it)
try { sessionStorage.setItem(A2HS_OFF_KEY, "1"); } catch (e) { /* blocked storage */ }

const OLD_TITLE = "Welcome to the beta version of Straight Bussing!";   // the removed popup's title
const OLD_SEEN_KEY = "sb-welcome-seen";   // the removed popup's per-session flag: without it the old app showed the popup
const DAY = 86400000;

/** A first visit: a fresh session, nothing in this browser, no feedback given, the button's test seam off. */
function firstVisit() {
  sessionStorage.removeItem(OLD_SEEN_KEY);
  sessionStorage.removeItem(FEEDBACK_BTN_OFF_KEY);
  localStorage.removeItem(WELCOME_LOG_KEY);
  localStorage.removeItem(FEEDBACK_DONE_KEY);
}

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
const inside = (a, b, m = 0) => a.left >= b.left + m - 0.5 && a.right <= b.right - m + 0.5 && a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5;
/** The feedback button once it is on screen. */
const shownButton = (d) => { const b = d.getElementById("feedbackBtn"); return b && !b.hidden && b.getClientRects().length ? b : null; };
/** No popup of any kind: no open dialog, no old popup markup, not its title. */
function assertNoPopup(d, where) {
  eq(d.querySelector("dialog[open]"), null, where + ": no open dialog");
  eq(d.querySelector(".v-welcome"), null, where + ": no welcome popup markup");
  ok(!d.body.textContent.includes(OLD_TITLE), where + ": not the old popup's title");
}

/** The real index.html with the e2e stubs and a store handle, written into a new iframe (like tests/e2e.js). */
async function openLive(style = "width:393px;height:852px;border:0;display:block") {
  const html = await (await fetch("../index.html", { cache: "no-store" })).text();
  const base = new URL("../", location.href).href;
  let page = html.replace(/<head>/i, `<head><base href="${base}"><script src="tests/e2e-stubs.js"></script>`);
  page = page.replace(/<script type="module" src="js\/main\.js[^"]*"><\/script>/,
    (m) => `<script type="module">import { store } from "./js/state.js"; window.__st = store;</script>${m}`);
  if (!page.includes("window.__st")) throw new Error("js/main.js <script> tag not found in index.html");
  const f = document.createElement("iframe");
  f.style.cssText = style;
  document.body.appendChild(f);
  f.contentDocument.open();
  f.contentDocument.write(page);
  f.contentDocument.close();
  const w = f.contentWindow, d = w.document;
  await waitFor(() => w.__st && w.__st.get().staticLoaded && d.getElementById("app").dataset.view === "nearby", "the app rendered");
  return { f, w, d };
}

test("real app (live feed, phone), first visit: no popup; the map's feedback button appears under the Settings circle", async () => {
  firstVisit();
  const { f, w, d } = await openLive();
  try {
    await waitFor(() => w.__st.get().liveLoaded && w.__st.get().lastOk, "live data loads");
    const fab = await waitFor(() => shownButton(d), "the map's feedback button");
    await sleep(1000);   // well past the next paint, when the old popup used to open
    assertNoPopup(d, "first visit");
    const G = d.getElementById("settingsBtn").getBoundingClientRect(), B = fab.getBoundingClientRect();
    ok(B.top > G.bottom && B.top - G.bottom <= 12 && Math.abs(B.right - G.right) < 1, "right under the Settings circle");
    eq(d.elementFromPoint(B.left + B.width / 2, B.top + B.height / 2)?.closest("#feedbackBtn"), fab, "nothing covers it");
    eq(fab.getAttribute("aria-label"), "Give feedback");
    ok(d.activeElement === d.body || !d.activeElement?.closest("dialog"), "focus is not taken by any popup");
    eq(sessionStorage.getItem(OLD_SEEN_KEY), null, "no popup flag written to this session");
    eq(localStorage.getItem(WELCOME_LOG_KEY), null, "no popup date written to this browser");
    eq(w.__e2e.errors, [], "no console errors");
  } finally { f.remove(); }
});

let F = null;
test("real app (?demo=1, desktop phone frame), first visit: no popup; the feedback button is inside the frame", async () => {
  firstVisit();
  F = document.createElement("iframe");
  F.style.cssText = "width:1280px;height:800px;border:0;display:block";
  F.src = "../index.html?demo=1";
  document.body.appendChild(F);
  const w = F.contentWindow;
  const fab = await waitFor(() => w.document && shownButton(w.document), "the map's feedback button in demo mode");
  const d = w.document;
  // the iframe may boot before the test page has laid it out at 1280 x 800 (300 x 150 by default): frame.js then sets
  // is-framed on the resize that follows, so wait for it rather than read it at once (flaked 2 runs in 5 under load)
  await waitFor(() => d.documentElement.classList.contains("is-framed"), "desktop phone frame", 4000);
  await sleep(1000);
  assertNoPopup(d, "demo first visit");
  const app = d.getElementById("app").getBoundingClientRect(), r = fab.getBoundingClientRect();
  ok(inside(r, app, 4), "inside the phone frame: " + JSON.stringify({ fab: [r.left, r.right, r.top, r.bottom], app: [app.left, app.right, app.top, app.bottom] }));
});

test("real app: a reload in the same session shows no popup, and the button still asks (no feedback given yet)", async () => {
  ok(F, "previous test opened the app");
  try {
    const loaded = new Promise((r) => F.addEventListener("load", r, { once: true }));
    F.contentWindow.location.reload();
    await loaded;
    const w = F.contentWindow, d = w.document;
    const s = d.createElement("script");   // the app's own store (same URL as main.js imports)
    s.type = "module";
    s.textContent = 'import { store } from "./js/state.js"; window.__st = store;';
    d.head.appendChild(s);
    await waitFor(() => w.__st && w.__st.get().staticLoaded && d.getElementById("app").dataset.view === "nearby", "the reloaded app rendered");
    await waitFor(() => shownButton(d), "the feedback button after the reload");
    await sleep(1000);
    assertNoPopup(d, "reload");
  } finally { F.remove(); F = null; }
});

test("real app: a new visit a week after the old popup last appeared shows no popup; the button asks until feedback was given", async () => {
  let v = null;
  try {
    // a browser the old popup asked 8 days ago (it would have asked again now), no feedback given, a fresh session
    firstVisit();
    localStorage.setItem(WELCOME_LOG_KEY, JSON.stringify({ shown: Date.now() - 8 * DAY, feedback: 0 }));
    v = await openLive();
    await waitFor(() => shownButton(v.d), "the feedback button");
    await sleep(1000);
    assertNoPopup(v.d, "a week later");
    eq(JSON.parse(localStorage.getItem(WELCOME_LOG_KEY)).shown < Date.now() - 7 * DAY, true, "the old log is not rewritten");
    v.f.remove();
    // a form opened from the old popup before 2026-11-02 (only the old log has its date): no popup and no button
    firstVisit();
    localStorage.setItem(WELCOME_LOG_KEY, JSON.stringify({ shown: Date.now() - 40 * DAY, feedback: Date.now() - 40 * DAY }));
    v = await openLive();
    await sleep(1000);
    assertNoPopup(v.d, "feedback given before 2026-11-02");
    ok(v.d.getElementById("feedbackBtn").hidden, "the old log's feedback date still counts: the button stays gone");
    v.d.getElementById("settingsBtn").click();
    await waitFor(() => { const o = v.d.getElementById(OVERLAY_ID); return o && o.dataset.state === "open" && o.dataset.kind === "settings" && o.querySelector(`a[href="${FEEDBACK_URL}"]`); }, "Settings > Give feedback is still there");
  } finally {
    v?.f.remove();
    localStorage.removeItem(WELCOME_LOG_KEY);
    localStorage.removeItem(FEEDBACK_DONE_KEY);
  }
});

test("real app, 320 pt wide, short, 200% text: an open status banner pushes Settings down; the feedback circle steps aside so Lines by Time stays reachable, then comes back", async () => {
  firstVisit();
  let v = null;
  try {
    // 320 x 520 with no safe areas (this test window) meets like a 320 x 568 iPhone SE (Display Zoom) with its status bar
    v = await openLive("width:320px;height:520px;border:0;display:block");
    const { w, d } = v, $ = (id) => d.getElementById(id);
    d.documentElement.style.fontSize = "34px";   // 200% browser text (2 x 17)
    d.documentElement.dataset.text = "ax";
    const fab = await waitFor(() => shownButton(d), "the feedback button", 3000);
    w.__e2e.feedFail = true;
    w.dispatchEvent(new w.Event("online"));
    const more = await waitFor(() => !$("pill").hidden && d.querySelector("#pill .pillmore"), "the status banner with Details", 3000);
    await sleep(500);
    ok(!fab.classList.contains("is-crowded"), "a closed banner leaves room: the circle shows");
    more.click();
    await waitFor(() => $("pill").classList.contains("is-open"), "Details open", 2000);
    // the test runner's virtual time delivers no ResizeObserver notes after load: stand in for pill.js's (--pill-h = the
    // banner's real height, so Row B follows it) and fire the resize that also re-checks the room
    const settle = async () => { $("app").style.setProperty("--pill-h", $("pill").offsetHeight + "px"); w.dispatchEvent(new w.Event("resize")); await sleep(600); };
    await settle();
    ok($("settingsBtn").getBoundingClientRect().top >= $("pill").getBoundingClientRect().bottom, "Settings sits under the open banner");
    ok(crowds(fab.getBoundingClientRect(), $("mapctl").getBoundingClientRect()), "the scene does crowd: the circle would meet the lower-right group");
    ok(fab.classList.contains("is-crowded"), "so it steps aside");
    eq(w.getComputedStyle(fab).pointerEvents, "none", "it takes no taps at once");
    fab.style.transition = "none";   // the end state of its fade (this runner's virtual time draws no frames for transitions)
    eq(w.getComputedStyle(fab).visibility, "hidden", "then hidden: no focus, not read out");
    fab.style.removeProperty("transition");
    const t = $("timeBtn").getBoundingClientRect(), f = fab.getBoundingClientRect();
    const shared = [Math.max(t.top, f.top), Math.min(t.bottom, f.bottom)];   // where the circle would sit over the clock
    const y = shared[1] > shared[0] ? (shared[0] + shared[1]) / 2 : t.top + t.height / 2;
    const hit = d.elementFromPoint(t.left + t.width / 2, y);
    ok(hit && hit.closest("#timeBtn"), `Lines by Time takes its own taps (${hit && (hit.id || hit.className)}, clock ${Math.round(t.top)}..${Math.round(t.bottom)}, circle ${Math.round(f.top)}..${Math.round(f.bottom)})`);
    more.click();
    await settle();
    ok(!fab.classList.contains("is-crowded"), "the banner closed: the circle is back");
    eq(w.__e2e.errors, [], "no console errors");
  } finally {
    if (v) { v.w.__e2e.feedFail = false; v.f.remove(); }
  }
});
