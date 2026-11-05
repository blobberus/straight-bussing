// Beta feedback (owner 2026-10-13, 2026-11-02; feedback.test.html): the shared pieces in ui/feedback.js (the form's one
// address and link, the words, the memory of given feedback, the removed popup's log that is only read now), the
// Settings card, and the privacy wording in About and privacy.html. The welcome popup was removed on 2026-11-04 (owner:
// "Stop the give feedback sign on every login to pop up. Keep the feedback button on the map screen."): the real app
// without it is covered by feedback-app.js, the map's feedback button by feedback-button.js.
import { test, eq, ok } from "./lib.js";
import { fixture, makeCtx, root, NOW } from "./views-fixtures.js";
import * as feedback from "../js/ui/feedback.js";
import { FEEDBACK_URL, WELCOME_LOG_KEY, FEEDBACK_BODY, FEEDBACK_IN_SETTINGS, FEEDBACK_LEAD,
  noteFeedbackOpened, feedbackDone, markFeedbackDone, FEEDBACK_DONE_KEY, _resetFeedback } from "../js/ui/feedback.js";
import { renderSettings, mountSettings, unmountSettings, FEEDBACK_LINE, FEEDBACK_NOTE } from "../js/ui/views/settings.js";
import { renderAbout } from "../js/ui/views/about.js";
import { bindActions } from "../js/ui/actions.js";
import { cleanNotify } from "../js/state.js";

const FORM = "https://forms.gle/zK4hi2UfYsrXURR97";   // the owner's link, verbatim
const OLD_TITLE = "Welcome to the beta version of Straight Bussing!";   // the removed popup's title
const DASH = /[–—]/;   // en / em dash: never in visible text (DESIGN.md 1b)
const DAY = 86400000, T0 = Date.UTC(2026, 10, 2, 15);

/** An in-memory Storage. */
function mem() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k), m };
}
/** Storage that throws on every use (blocked cookies / storage). */
const blocked = { getItem() { throw new Error("SecurityError"); }, setItem() { throw new Error("SecurityError"); } };
const userClick = (el, o = {}) => { const e = new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1, ...o }); el.dispatchEvent(e); return e; };
/** Stop a link's navigation AFTER the app's own handlers ran, and report whether they let it through. */
function catchNav() {
  const seen = [];
  const on = (e) => { if (e.target.closest?.("a[href]")) { seen.push(e.defaultPrevented); e.preventDefault(); } };
  window.addEventListener("click", on);
  return { seen, off: () => window.removeEventListener("click", on) };
}

test("feedback: one URL, the owner's form; the ask stresses that feedback is very helpful", () => {
  eq(FEEDBACK_URL, FORM);
  eq(FEEDBACK_LEAD, "Your feedback would be very helpful.");
  ok(/beta/.test(FEEDBACK_BODY) && /about a minute/.test(FEEDBACK_BODY) && /directly shapes/.test(FEEDBACK_BODY), "beta, a minute, it shapes the app: " + FEEDBACK_BODY);
  ok(/Settings/.test(FEEDBACK_IN_SETTINGS), "says Give feedback is also in Settings");
  for (const t of [FEEDBACK_LEAD, FEEDBACK_BODY, FEEDBACK_IN_SETTINGS, FEEDBACK_LINE]) {
    ok(!DASH.test(t), "no en / em dash: " + t);
    ok(!/UChicago|UGo|University/.test(t), "no university names of its own: " + t);
  }
  eq(FEEDBACK_DONE_KEY, "sb-feedback-done", "a clearly named key for 'already gave feedback'");
});

test("the welcome popup is gone (owner 2026-11-04): ui/feedback.js has no popup, no shipped file styles or opens one", async () => {
  for (const name of ["maybeShowWelcome", "showWelcome", "welcomeAfterPaint", "welcomeDue", "welcomeSeen", "WELCOME_KEY", "WELCOME_TITLE", "WELCOME_EVERY_DAYS"]) {
    ok(!(name in feedback), "no " + name);
  }
  const sw = await (await fetch("../sw.js", { cache: "no-store" })).text();
  const files = [...sw.match(/const PRECACHE = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+\.(?:js|css|html))'/g)].map((m) => m[1]);
  ok(files.includes("js/main.js") && files.includes("css/settings.css"), "the shell is in the precache list");
  const hits = [];
  for (const f of files) {
    const t = await (await fetch("../" + f, { cache: "no-store" })).text();
    if (/v-welcome|welcomeAfterPaint|sb-welcome-seen/.test(t) || t.includes(OLD_TITLE)) hits.push(f);
  }
  eq(hits, [], "no popup markup, style, trigger or session flag left in any shipped file");
});

test("given feedback: opening the form (the map button's panel or Settings) counts; I already gave feedback silences; the old popup's log still counts and is never written", () => {
  _resetFeedback();
  // Send feedback on the panel / Give feedback in Settings
  const st = mem();
  noteFeedbackOpened({ storage: st, now: T0 });
  eq(feedbackDone(st), "gave", "the rider counts as having given feedback (the map button goes)");
  eq(JSON.parse(st.getItem(FEEDBACK_DONE_KEY)), { how: "gave", at: T0 }, "kept under its own key, with the time");
  eq(st.getItem(WELCOME_LOG_KEY), null, "nothing written to the removed popup's log");
  eq([...st.m.keys()], [FEEDBACK_DONE_KEY], "one key, nothing else stored");
  // "I already gave feedback"
  const st2 = mem();
  eq(markFeedbackDone("silenced", { storage: st2, now: T0 }), "silenced");
  eq(feedbackDone(st2), "silenced");
  eq(st2.getItem(WELCOME_LOG_KEY), null, "the old log stays unwritten");
  // a form opened before 2026-11-02: only the removed popup's log has its date, and that still counts
  const old = mem();
  old.setItem(WELCOME_LOG_KEY, JSON.stringify({ shown: T0 - 40 * DAY, feedback: T0 - 35 * DAY }));
  eq(feedbackDone(old), "gave", "earlier form opening = gave");
  const before = old.getItem(WELCOME_LOG_KEY);
  noteFeedbackOpened({ storage: old, now: T0 });
  eq(old.getItem(WELCOME_LOG_KEY), before, "the old log is read, never rewritten");
  // the popup having appeared is not feedback
  const seen = mem();
  seen.setItem(WELCOME_LOG_KEY, JSON.stringify({ shown: T0 - 3 * DAY, feedback: 0 }));
  eq(feedbackDone(seen), null, "the popup only appeared: the rider has not given feedback (the map button still asks)");
});

test("given feedback: 'gave' wins over 'silenced'; blocked storage remembers it for this page load only", () => {
  _resetFeedback();
  const st = mem();
  eq(feedbackDone(st), null, "nothing yet");
  markFeedbackDone("silenced", { storage: st, now: T0 });
  eq(feedbackDone(st), "silenced");
  markFeedbackDone("gave", { storage: st, now: T0 + 1 });
  eq(feedbackDone(st), "gave", "Give feedback after silencing: gave");
  markFeedbackDone("silenced", { storage: st, now: T0 + 2 });
  eq(feedbackDone(st), "gave", "silencing never undoes gave");
  st.setItem(FEEDBACK_DONE_KEY, "{broken");
  eq(feedbackDone(st), null, "an unreadable value: not done");
  st.setItem(FEEDBACK_DONE_KEY, JSON.stringify({ how: "maybe" }));
  eq(feedbackDone(st), null, "an unknown value: not done");
  for (const s of [blocked, null]) {
    _resetFeedback();
    eq(feedbackDone(s), null, "blocked: not done");
    let r = null;
    try { r = markFeedbackDone("silenced", { storage: s }); } catch (e) { ok(false, "threw: " + e.message); }
    eq(r, "silenced");
    eq(feedbackDone(s), "silenced", "remembered for this page load");
    _resetFeedback();   // a reload
    eq(feedbackDone(s), null, "gone after a reload (nothing could be stored)");
  }
});

test("the old popup's log: a broken value, a wrong clock or blocked storage never throws", () => {
  _resetFeedback();
  const bad = mem();
  bad.setItem(WELCOME_LOG_KEY, "{not json");
  eq(feedbackDone(bad), null, "unreadable log: no feedback given");
  bad.setItem(WELCOME_LOG_KEY, JSON.stringify({ shown: "x", feedback: -5 }));
  eq(feedbackDone(bad), null, "a negative date: none");
  bad.setItem(WELCOME_LOG_KEY, JSON.stringify({ feedback: "soon" }));
  eq(feedbackDone(bad), null, "not a number: none");
  bad.setItem(WELCOME_LOG_KEY, JSON.stringify({ shown: 0, feedback: T0 + 400 * DAY }));
  eq(feedbackDone(bad), "gave", "a form date from a wrong clock still counts as feedback given");
  eq(feedbackDone(blocked), null, "throwing storage");
  eq(feedbackDone(null), null, "no storage");
  noteFeedbackOpened({ storage: blocked });   // never throws
  noteFeedbackOpened({ storage: null });
  _resetFeedback();
});

/** Relative luminance contrast of two "rgb(...)" colors (opaque). */
function contrast(fg, bg) {
  const ch = (c) => String(c).match(/[\d.]+/g).slice(0, 3).map(Number);
  const L = (c) => { const [r, g, b] = ch(c).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const a = L(fg), b = L(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** A translucent color ("rgba(118, 118, 128, 0.12)", the iOS-style fill of Secondary buttons) laid over an opaque one. */
function over(top, base) {
  const t = String(top).match(/[\d.]+/g).map(Number), b = String(base).match(/[\d.]+/g).map(Number), a = t.length > 3 ? t[3] : 1;
  return `rgb(${[0, 1, 2].map((i) => Math.round(t[i] * a + b[i] * (1 - a))).join(", ")})`;
}

/** Is this "rgb(...)" color mostly green (the live color's job, DESIGN.md 1b)? */
const greenish = (c) => { const [r, g, b] = String(c).match(/[\d.]+/g).map(Number); return g > r + 20 && g > b + 20; };

const base = (over = {}) => ({ notify: cleanNotify(null), favStops: [], journey: null, ...over });

test("settings: Beta feedback comes first, a tinted card with the ask and a real link to the form (primary button, 44 px)", async () => {
  const h = renderSettings(fixture(base()), NOW);
  ok(!DASH.test(h.replace(/<[^>]+>/g, "")), "no en / em dash");
  const ctx = makeCtx(base());
  const el = root();
  el.innerHTML = h;
  mountSettings(el, ctx);
  const off = bindActions(el, () => ctx);
  const nav = catchNav();
  let saved = null, savedDone = null;
  try {
    saved = localStorage.getItem(WELCOME_LOG_KEY); localStorage.removeItem(WELCOME_LOG_KEY);
    savedDone = localStorage.getItem(FEEDBACK_DONE_KEY); localStorage.removeItem(FEEDBACK_DONE_KEY);
  } catch (e) { /* */ }
  try {
    eq(el.querySelector(".v-h").textContent, "Beta feedback", "the first section of Settings");
    const card = el.querySelector(".st-feedback");
    eq(card.previousElementSibling, el.querySelector(".v-h"), "the card right under it");
    eq(card.querySelector(".st-fblead").textContent, FEEDBACK_LEAD, "the same ask as the map button's panel, first");
    ok(card.querySelector(".fb-badge[aria-hidden='true'] svg"), "the panel's icon, decoration only");
    ok(card.textContent.includes(FEEDBACK_LINE) && card.textContent.includes(FEEDBACK_NOTE), "the beta line and the privacy note");
    ok(/about a minute/.test(FEEDBACK_LINE), "short form of the panel's message");
    const links = [...el.querySelectorAll(`a[href="${FORM}"]`)];
    eq(links.length, 1, "one feedback link");
    const a = links[0];
    eq([a.textContent.trim(), a.getAttribute("target")], ["Give feedback", "_blank"]);
    ok(/\bnoopener\b/.test(a.getAttribute("rel")) && /^Give feedback, .*new tab/.test(a.getAttribute("aria-label")), "rel + spoken label");
    ok(a.classList.contains("v-btn") && a.classList.contains("v-btn--primary") && !a.dataset.action, "styled as the primary button, not an app action");
    ok(card.contains(a), "inside the card");
    ok(a.getBoundingClientRect().height >= 44, "44 px target");
    ok(a.querySelector("svg[aria-hidden='true']"), "the 'opens elsewhere' arrow is decoration only");
    // readable and not the live green, in light and dark
    const html = document.documentElement, prevTheme = html.dataset.theme;
    const still = document.head.appendChild(document.createElement("style"));
    still.textContent = "*, *::before, *::after { transition: none !important; animation: none !important; }";
    try {
      for (const theme of ["light", "dark"]) {
        html.dataset.theme = theme;
        const cs = (x) => getComputedStyle(x), cbg = cs(card).backgroundColor, badge = card.querySelector(".fb-badge");
        ok(!/rgba\(0, 0, 0, 0\)|transparent/.test(cbg) && !greenish(cbg) && !greenish(cs(badge).backgroundColor), `${theme}: tinted, not green (${cbg})`);
        for (const [name, x, back] of [["lead", card.querySelector(".st-fblead"), cbg], ["line", card.querySelector(".st-intro"), cbg],
          ["note", card.querySelector(".st-fbnote"), cbg], ["button", a, over(cs(a).backgroundColor, cbg)], ["badge icon", badge, cs(badge).backgroundColor]]) {
          const k = contrast(cs(x).color, back);
          ok(k >= 4.5, `${theme}: ${name} contrast ${k.toFixed(2)} >= 4.5 (${cs(x).color} on ${back})`);
        }
      }
    } finally { still.remove(); if (prevTheme === undefined) delete html.dataset.theme; else html.dataset.theme = prevTheme; }
    userClick(a);
    eq(nav.seen, [false], "Settings lets the link open the form");
    eq([ctx.calls.navigate.length, ctx.calls.toast.length], [0, 0], "no app navigation or toast");
    eq(feedbackDone(), "gave", "tapping Give feedback counts as feedback given: the map button goes for good");
    eq(localStorage.getItem(WELCOME_LOG_KEY), null, "and nothing goes in the removed popup's log");
    // Settings keeps Give feedback after that (always available)
    el.innerHTML = renderSettings(fixture(base()), NOW);
    eq(el.querySelectorAll(`a[href="${FORM}"]`).length, 1, "Give feedback still in Settings after feedback was given");
  } finally {
    nav.off(); off?.(); unmountSettings(); el.remove();
    try {
      if (saved === null) localStorage.removeItem(WELCOME_LOG_KEY); else localStorage.setItem(WELCOME_LOG_KEY, saved);
      if (savedDone === null) localStorage.removeItem(FEEDBACK_DONE_KEY); else localStorage.setItem(FEEDBACK_DONE_KEY, savedDone);
    } catch (e) { /* */ }
  }
});

test("privacy: About and privacy.html say the feedback form opens only from the map button's panel or Settings", async () => {
  const about = renderAbout().replace(/\s+/g, " ");
  ok(about.includes("only when you tap “Send feedback” behind the feedback button on the map or “Give feedback” in Settings does a <b>Google Forms</b> page open"), "About");
  ok(about.includes("sent only when you press Submit"), "About: nothing typed is sent before Submit");
  ok(about.includes("bus alert choices) and whether you already gave feedback (which removes the feedback button) are saved in this browser only"), "About: the given-feedback choice is stored locally");
  ok(!/popup/i.test(about), "About no longer mentions a popup");
  const page = (await (await fetch("../privacy.html", { cache: "no-store" })).text()).replace(/\s+/g, " ");
  ok(/Effective November ([4-9]|[12]\d|30), 2026\./.test(page), "an effective date on or after the change (Nov 4, 2026)");
  ok(page.includes("<b>Beta feedback (optional).</b> Only when you tap &ldquo;Send feedback&rdquo; behind the feedback button on the map or &ldquo;Give feedback&rdquo; in Settings does a Google Form open"), "privacy.html bullet");
  ok(!page.includes("Go to Feedback"), "privacy.html: no popup button any more");
  ok(page.includes("whether you already gave feedback or chose &ldquo;I already gave feedback&rdquo;, which removes the feedback button from the map, on the web with its date"), "privacy.html: the choice stays on the device");
  ok(page.includes("in a browser that showed the beta welcome popup, removed on November 4, 2026, also the dates it last appeared and the feedback form was opened"), "privacy.html: what an old browser may still keep");
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
