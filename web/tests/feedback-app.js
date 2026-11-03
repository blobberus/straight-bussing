// The beta welcome popup in the REAL app (feedback.test.html): it opens on a first visit once the app has rendered,
// never blocks the data, fits the phone and the desktop phone frame, and does not come back after a reload or on a new
// visit within the week (same-origin iframes share this page's sessionStorage and localStorage).
// 1. live mode (e2e-stubs.js: fake feed, no location) in a 393 x 852 phone iframe; 2. ?demo=1 in a 1280 x 800
// desktop window (phone frame), then a reload, then a new visit.
import { test, eq, ok } from "./lib.js";
import { WELCOME_KEY, WELCOME_LOG_KEY, FEEDBACK_DONE_KEY } from "../js/ui/feedback.js";

/** A first visit: no popup yet in this session, none ever in this browser, no feedback given. */
function firstVisit() {
  sessionStorage.removeItem(WELCOME_KEY);
  localStorage.removeItem(WELCOME_LOG_KEY);
  localStorage.removeItem(FEEDBACK_DONE_KEY);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, what, ms = 7000) {
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try { v = fn(); } catch (e) { v = null; }
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting for " + what);
    await sleep(25);
  }
}
const welcome = (d) => d.querySelector("dialog.v-welcome[open]");
const inside = (a, b, m = 0) => a.left >= b.left + m - 0.5 && a.right <= b.right - m + 0.5 && a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5;

/** The real index.html with the e2e stubs and a store handle, written into a new iframe (like tests/e2e.js). */
async function openLive(style) {
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
  return f;
}

test("real app (live feed, phone): the popup opens after the first render, data keeps loading, Cancel closes it", async () => {
  firstVisit();
  const f = await openLive("width:393px;height:852px;border:0;display:block");
  try {
    const w = f.contentWindow, d = w.document;
    const dlg = await waitFor(() => welcome(d), "the welcome popup");
    eq(d.getElementById("app").dataset.view, "nearby", "opened after the app shell rendered its first view");
    eq(sessionStorage.getItem(WELCOME_KEY), "1", "marked in this browser session");
    ok(JSON.parse(localStorage.getItem(WELCOME_LOG_KEY)).shown > 0, "its date remembered for the weekly rule");
    eq(d.activeElement, dlg.querySelector('[data-welcome="cancel"]'), "focus in the popup");
    await waitFor(() => w.__st.get().staticLoaded && w.__st.get().liveLoaded && w.__st.get().lastOk, "stops, routes and live data load underneath");
    const r = dlg.getBoundingClientRect();
    ok(inside(r, { left: 0, right: 393, top: 0, bottom: 852 }, 20), "fits the phone with margins: " + JSON.stringify([r.left, r.right, r.top, r.bottom]));
    const sheet = d.getElementById("sheet").dataset.detent, view = w.__st.get().view;
    d.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    eq([d.getElementById("sheet").dataset.detent, w.__st.get().view], [sheet, view], "while it is open, Escape is the popup's (main.js leaves the sheet alone)");
    await sleep(400);   // past the double-tap guard
    dlg.querySelector('[data-welcome="cancel"]').dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    await waitFor(() => !d.querySelector("dialog.v-welcome"), "popup closed and removed");
    eq(w.__e2e.errors, [], "no console errors");
  } finally { f.remove(); }
});

let F = null;
test("real app (?demo=1, desktop phone frame): shown inside the frame; Go to Feedback opens the form and closes it", async () => {
  firstVisit();
  F = document.createElement("iframe");
  F.style.cssText = "width:1280px;height:800px;border:0;display:block";
  F.src = "../index.html?demo=1";
  document.body.appendChild(F);
  const w = F.contentWindow;
  const dlg = await waitFor(() => w.document && welcome(w.document), "the welcome popup in demo mode");
  const d = w.document;
  ok(d.documentElement.classList.contains("is-framed"), "desktop phone frame");
  const app = d.getElementById("app").getBoundingClientRect(), r = dlg.getBoundingClientRect();
  ok(inside(r, app, 12), "inside the phone frame: " + JSON.stringify({ dlg: [r.left, r.right, r.top, r.bottom], app: [app.left, app.right, app.top, app.bottom] }));
  await sleep(400);
  const fab = await waitFor(() => { const b = d.getElementById("feedbackBtn"); return b && !b.hidden ? b : null; }, "the map's feedback button next to the popup");
  const seen = [];
  const stop = (e) => { if (e.target.closest?.("a[href]")) { seen.push([e.target.closest("a").href, e.defaultPrevented]); e.preventDefault(); } };
  w.addEventListener("click", stop);   // after the app's own handlers: record, then keep the test page from opening a tab
  dlg.querySelector('[data-welcome="feedback"]').dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
  w.removeEventListener("click", stop);
  eq(seen, [["https://forms.gle/zK4hi2UfYsrXURR97", false]], "the link to the form is followed (new tab)");
  await waitFor(() => !d.querySelector("dialog.v-welcome"), "popup closed");
  ok(JSON.parse(localStorage.getItem(WELCOME_LOG_KEY)).feedback > 0, "the form's opening logged");
  eq(JSON.parse(localStorage.getItem(FEEDBACK_DONE_KEY)).how, "gave", "Go to Feedback counts as feedback given");
  ok(fab.hidden, "the map's feedback button went at once");
});

test("real app: a reload in the same session does not show the popup again", async () => {
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
    await sleep(800);   // well past the next paint, when the first launch showed it
    ok(!d.querySelector("dialog.v-welcome"), "no welcome popup after the reload");
    eq(sessionStorage.getItem(WELCOME_KEY), "1");
    ok(d.getElementById("feedbackBtn").hidden, "nor the feedback button: feedback was given");
  } finally { F.remove(); F = null; }
});

test("real app: a new visit within the week (fresh session) does not show the popup; one a week later does", async () => {
  const visit = async () => {
    sessionStorage.removeItem(WELCOME_KEY);   // a new tab or browser restart: a fresh session, the same localStorage
    const f = await openLive("width:393px;height:852px;border:0;display:block");
    const w = f.contentWindow, d = w.document;
    await waitFor(() => w.__st && w.__st.get().staticLoaded && d.getElementById("app").dataset.view === "nearby", "the app rendered");
    await sleep(800);
    return { f, d };
  };
  try {
    const DAY = 86400000;
    localStorage.removeItem(FEEDBACK_DONE_KEY);   // a rider who has not given feedback (the test above did)
    localStorage.setItem(WELCOME_LOG_KEY, JSON.stringify({ shown: Date.now() - 3 * DAY, feedback: 0 }));
    let v = await visit();
    ok(!v.d.querySelector("dialog.v-welcome"), "shown 3 days ago: not again");
    v.f.remove();
    localStorage.setItem(WELCOME_LOG_KEY, JSON.stringify({ shown: Date.now() - 8 * DAY, feedback: 0 }));
    v = await visit();
    ok(v.d.querySelector("dialog.v-welcome[open]"), "shown 8 days ago: asks again");
    v.f.remove();
  } finally {
    localStorage.removeItem(WELCOME_LOG_KEY);
    localStorage.removeItem(FEEDBACK_DONE_KEY);
    sessionStorage.setItem(WELCOME_KEY, "1");
  }
});
