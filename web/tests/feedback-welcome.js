// Beta feedback (owner 2026-10-13; feedback.test.html): the welcome popup (ui/feedback.js), the Settings link, and the
// privacy wording in About and privacy.html. The real app is covered by feedback-app.js.
import { test, eq, ok } from "./lib.js";
import { fixture, makeCtx, tick, root, NOW } from "./views-fixtures.js";
import { FEEDBACK_URL, WELCOME_KEY, WELCOME_TITLE, WELCOME_BODY, maybeShowWelcome, showWelcome, welcomeSeen, _resetWelcome } from "../js/ui/feedback.js";
import { renderSettings, mountSettings, unmountSettings, FEEDBACK_LINE } from "../js/ui/views/settings.js";
import { renderAbout } from "../js/ui/views/about.js";
import { bindActions } from "../js/ui/actions.js";
import { cleanNotify } from "../js/state.js";

const FORM = "https://forms.gle/zK4hi2UfYsrXURR97";   // the owner's link, verbatim
const OWNER_TITLE = "Welcome to the beta version of Straight Bussing!";
const OWNER_BODY = "Thank you for trying the app out. Please give feedback on your experience (link to feedback also available in the settings menu).";
const DASH = /[–—]/;   // en / em dash: never in visible text (DESIGN.md 1b)

/** An in-memory sessionStorage. */
function mem() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k), m };
}
/** Storage that throws on every use (blocked cookies / storage). */
const blocked = { getItem() { throw new Error("SecurityError"); }, setItem() { throw new Error("SecurityError"); } };
const dlg = () => document.querySelector("dialog.v-welcome[open]");
const userClick = (el, o = {}) => { const e = new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1, ...o }); el.dispatchEvent(e); return e; };
/** Stop a link's navigation AFTER the app's own handlers ran, and report whether they let it through. */
function catchNav() {
  const seen = [];
  const on = (e) => { if (e.target.closest?.("a[href]")) { seen.push(e.defaultPrevented); e.preventDefault(); } };
  window.addEventListener("click", on);
  return { seen, off: () => window.removeEventListener("click", on) };
}
async function closeAny() {
  const d = dlg();
  if (d) { await tick(380); d.querySelector('[data-welcome="cancel"]').click(); }
  await tick(5);
  _resetWelcome();
}

test("feedback: one URL, the owner's form", () => {
  eq(FEEDBACK_URL, FORM);
  eq([WELCOME_TITLE, WELCOME_BODY], [OWNER_TITLE, OWNER_BODY], "the owner's words, exactly");
});

test("welcome popup: owner's title and text, buttons Cancel / Go to Feedback, the link opens the form in a new tab", async () => {
  _resetWelcome();
  const before = document.createElement("button");
  before.textContent = "opener";
  document.body.appendChild(before);
  before.focus();
  const st = mem();
  const p = maybeShowWelcome({ storage: st });
  ok(p && typeof p.then === "function", "shown");
  const d = dlg();
  ok(d && d.open && d.matches(":modal"), "a modal <dialog>");
  eq(d.querySelector("h2").textContent, OWNER_TITLE);
  eq(d.querySelector("p").textContent, OWNER_BODY);
  eq(document.getElementById(d.getAttribute("aria-labelledby")), d.querySelector("h2"), "aria-labelledby = the title");
  eq(document.getElementById(d.getAttribute("aria-describedby")), d.querySelector("p"), "aria-describedby = the text");
  const btns = [...d.querySelectorAll("[data-welcome]")];
  eq(btns.map((b) => b.textContent), ["Cancel", "Go to Feedback"], "exactly two buttons, owner's labels, in order");
  const a = btns[1];
  eq([a.tagName, a.getAttribute("href"), a.getAttribute("target")], ["A", FORM, "_blank"], "a real link to the form, new tab");
  ok(/\bnoopener\b/.test(a.getAttribute("rel")), "rel=noopener");
  ok(/^Go to Feedback, .*new tab/.test(a.getAttribute("aria-label")), "screen readers hear that it opens a new tab: " + a.getAttribute("aria-label"));
  eq(btns[0].tagName, "BUTTON");
  eq(document.activeElement, btns[0], "focus moved into the popup, on Cancel (the safe choice)");
  ok(!DASH.test(d.textContent), "no en / em dash");
  eq(st.getItem(WELCOME_KEY), "1", "counted as seen as soon as it opens");
  for (const b of btns) { const r = b.getBoundingClientRect(); ok(r.height >= 44 && r.width >= 44, "44 px target: " + b.textContent); }
  await tick(380);   // past the double-tap guard
  userClick(btns[0]);
  eq(await p, "cancel");
  ok(!d.open, "closed");
  await tick(5);
  ok(!document.querySelector("dialog.v-welcome"), "removed");
  eq(document.activeElement, before, "focus returned to where it was");
  before.remove();
  _resetWelcome();
});

test("welcome popup: once per browser session; a reload in the same session does not show it again", async () => {
  _resetWelcome();
  const st = mem();
  ok(!welcomeSeen(st));
  const p = maybeShowWelcome({ storage: st });
  ok(p && dlg(), "first open of the session: shown");
  eq(maybeShowWelcome({ storage: st }), null, "a second call in the same page load does nothing");
  eq(document.querySelectorAll("dialog.v-welcome").length, 1, "only one popup");
  await closeAny();
  // a reload: the page (and module state) starts over, sessionStorage stays
  eq(maybeShowWelcome({ storage: st }), null, "same session after a reload: not shown");
  ok(!dlg());
  ok(welcomeSeen(st));
  // a new session (new tab / browser restart): shown again
  const p2 = maybeShowWelcome({ storage: mem() });
  ok(p2 && dlg(), "new session: shown");
  await closeAny();
});

test("welcome popup: blocked storage or private mode never crashes and shows it at most once per page load", async () => {
  for (const st of [blocked, null]) {
    _resetWelcome();
    let p = null;
    try { p = maybeShowWelcome({ storage: st }); } catch (e) { ok(false, "threw: " + e.message); }
    ok(p && dlg(), "shown once (" + (st ? "throwing storage" : "no storage") + ")");
    await tick(380);
    dlg().querySelector('[data-welcome="cancel"]').click();
    await tick(5);
    eq(maybeShowWelcome({ storage: st }), null, "not again in this page load, not on every render");
    ok(!dlg());
  }
  ok(!welcomeSeen(blocked), "a throwing storage reads as not seen");
  _resetWelcome();
});

test("welcome popup: Escape closes it (the browser's cancel event, or a close without one)", async () => {
  // Escape: the browser fires "cancel" on the dialog
  _resetWelcome();
  let p = showWelcome(), d = dlg();
  const esc = new Event("cancel", { cancelable: true });
  d.dispatchEvent(esc);
  eq(await p, "cancel", "Escape closes");
  ok(esc.defaultPrevented && !d.open, "handled like confirm.js");
  await tick(5);
  // closed by the browser without "cancel" (Chrome: Escape with no earlier user tap). The browser's own "close" event
  // waits for a rendered frame, which this headless test page does not paint, so it is sent here
  p = showWelcome(); d = dlg();
  d.close();
  d.dispatchEvent(new Event("close"));
  eq(await p, "cancel", "a browser close settles too");
  await tick(5);
  _resetWelcome();
});

test("welcome popup: a tap outside closes it; a tap on its padding and a ghost tap do not", async () => {
  const p = showWelcome(), d = dlg();
  let settled = null;
  p.then((v) => { settled = v; });
  const r = d.getBoundingClientRect();
  userClick(d, { clientX: r.left - 10, clientY: r.top - 10 });
  await tick(5);
  ok(settled === null && d.open, "a tap right after it opened is ignored (double tap guard)");
  const ghost = userClick(d.querySelector('[data-welcome="feedback"]'));
  await tick(5);
  ok(ghost.defaultPrevented && settled === null && d.open, "a ghost tap on Go to Feedback opens nothing and keeps the popup");
  await tick(380);
  userClick(d, { clientX: r.left + 4, clientY: r.top + 4 });
  await tick(5);
  ok(settled === null && d.open, "a tap on the popup's own padding does not close it");
  userClick(d, { clientX: Math.max(0, r.left - 10), clientY: Math.max(0, r.top - 10) });
  await tick(5);
  eq(settled, "cancel", "a tap outside closes it");
  ok(!d.open);
  await tick(5);
  _resetWelcome();
});

test("welcome popup: Go to Feedback opens the form (the link's own action, never blocked) and closes the popup", async () => {
  _resetWelcome();
  const p = showWelcome(), d = dlg();
  await tick(380);
  const nav = catchNav();
  try {
    const a = d.querySelector('[data-welcome="feedback"]');
    userClick(a);
    eq(nav.seen, [false], "the app does not cancel the link: the browser opens the form in a new tab");
    eq(await p, "feedback");
    ok(!d.open, "popup closed");
    // keyboard: Enter on the focused link is a click with detail 0 (no guard)
    await tick(5);
    const p2 = showWelcome(), d2 = dlg();
    d2.querySelector('[data-welcome="feedback"]').dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 }));
    eq(await p2, "feedback", "keyboard activation works at once");
    eq(nav.seen, [false, false]);
  } finally { nav.off(); }
  await tick(5);
  _resetWelcome();
});

/** Relative luminance contrast of two "rgb(...)" colors (opaque). */
function contrast(fg, bg) {
  const ch = (c) => String(c).match(/[\d.]+/g).slice(0, 3).map(Number);
  const L = (c) => { const [r, g, b] = ch(c).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const a = L(fg), b = L(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test("welcome popup: readable in light and dark, sized like the confirm popup, scales with the desktop phone frame", async () => {
  _resetWelcome();
  const html = document.documentElement, prevTheme = html.dataset.theme;
  const p = showWelcome(), d = dlg();
  const still = document.head.appendChild(document.createElement("style"));   // read settled colors, not a theme transition
  still.textContent = "*, *::before, *::after, ::backdrop { transition: none !important; animation: none !important; }";
  try {
    for (const theme of ["light", "dark"]) {
      html.dataset.theme = theme;
      const cs = (el) => getComputedStyle(el), bg = cs(d).backgroundColor;
      ok(!/rgba\(0, 0, 0, 0\)|transparent/.test(bg), theme + ": solid popup background " + bg);
      const pairs = [["title", d.querySelector("h2"), bg], ["text", d.querySelector("p"), bg]];
      for (const b of d.querySelectorAll("[data-welcome]")) pairs.push([b.textContent, b, cs(b).backgroundColor]);
      for (const [name, el, back] of pairs) {
        const k = contrast(cs(el).color, back);
        ok(k >= 4.5, `${theme}: ${name} contrast ${k.toFixed(2)} >= 4.5 (${cs(el).color} on ${back})`);
      }
    }
    const w = d.getBoundingClientRect().width;
    ok(w <= 340.5 && w <= innerWidth - 47, "no wider than the confirm popup: " + w);
    const [c, g] = [...d.querySelectorAll("[data-welcome]")].map((b) => b.getBoundingClientRect());
    ok(Math.abs(c.top - g.top) < 1, "both buttons on one line at the default text size");
    for (const b of d.querySelectorAll("[data-welcome]")) {
      const r = document.createRange();
      r.selectNodeContents(b);
      const lines = new Set([...r.getClientRects()].map((x) => Math.round(x.top)));
      eq(lines.size, 1, "label on one line: " + b.textContent);
    }
    html.style.setProperty("--frame-k", "0.8");
    eq(getComputedStyle(d).scale, "0.8", "shrinks with the phone frame (native dialogs sit outside the frame's transform)");
  } finally {
    still.remove();
    html.style.removeProperty("--frame-k");
    if (prevTheme === undefined) delete html.dataset.theme; else html.dataset.theme = prevTheme;
  }
  d.querySelector('[data-welcome="cancel"]').click();
  eq(await p, "cancel");
  await tick(5);
  _resetWelcome();
});

const base = (over = {}) => ({ notify: cleanNotify(null), favStops: [], journey: null, ...over });

test("settings: Beta feedback comes first, with a real link to the form in a new tab (secondary button, 44 px)", async () => {
  const h = renderSettings(fixture(base()), NOW);
  ok(!DASH.test(h.replace(/<[^>]+>/g, "")), "no en / em dash");
  const ctx = makeCtx(base());
  const el = root();
  el.innerHTML = h;
  mountSettings(el, ctx);
  const off = bindActions(el, () => ctx);
  const nav = catchNav();
  try {
    eq(el.querySelector(".v-h").textContent, "Beta feedback", "the first section of Settings");
    ok(el.textContent.includes(FEEDBACK_LINE), "the beta line");
    const links = [...el.querySelectorAll(`a[href="${FORM}"]`)];
    eq(links.length, 1, "one feedback link");
    const a = links[0];
    eq([a.textContent.trim(), a.getAttribute("target")], ["Give feedback", "_blank"]);
    ok(/\bnoopener\b/.test(a.getAttribute("rel")) && /^Give feedback, .*new tab/.test(a.getAttribute("aria-label")), "rel + spoken label");
    ok(a.classList.contains("v-btn") && a.classList.contains("v-btn--secondary") && !a.dataset.action, "styled as the secondary button, not an app action");
    ok(a.getBoundingClientRect().height >= 44, "44 px target");
    ok(a.querySelector("svg[aria-hidden='true']"), "the 'opens elsewhere' arrow is decoration only");
    userClick(a);
    eq(nav.seen, [false], "Settings lets the link open the form");
    eq([ctx.calls.navigate.length, ctx.calls.toast.length], [0, 0], "no app navigation or toast");
  } finally { nav.off(); off?.(); unmountSettings(); el.remove(); }
});

test("privacy: About and privacy.html say the feedback form is opened only when tapped", async () => {
  const about = renderAbout().replace(/\s+/g, " ");
  ok(about.includes("only when you tap “Give feedback” in Settings or “Go to Feedback” in the welcome popup") && about.includes("<b>Google Forms</b>"), "About");
  ok(about.includes("sent only when you press Submit"), "About: nothing typed is sent before Submit");
  const page = (await (await fetch("../privacy.html", { cache: "no-store" })).text()).replace(/\s+/g, " ");
  ok(page.includes("<b>Beta feedback (optional, web app).</b> Only when you tap &ldquo;Give feedback&rdquo; in Settings or &ldquo;Go to Feedback&rdquo; in the welcome popup"), "privacy.html bullet");
  ok(page.includes("unless you send a support request or beta feedback"), "privacy.html short version");
  ok(!DASH.test(page), "no en / em dash in the policy");
});

test("feedback: the form's address lives in one module only; the support form is separate", async () => {
  const sw = await (await fetch("../sw.js", { cache: "no-store" })).text();
  const files = [...sw.match(/const PRECACHE = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+\.(?:js|html))'/g)].map((m) => m[1]);
  ok(files.includes("js/ui/feedback.js"), "precached");
  const hits = [];
  for (const f of files) if ((await (await fetch("../" + f, { cache: "no-store" })).text()).includes("forms.gle/zK4hi2UfYsrXURR97")) hits.push(f);
  eq(hits, ["js/ui/feedback.js"]);
});
