// Beta feedback (owner 2026-10-13, 2026-11-02; feedback.test.html): the welcome popup (ui/feedback.js), how often it
// asks, the Settings card, and the privacy wording in About and privacy.html. The real app is covered by feedback-app.js.
import { test, eq, ok } from "./lib.js";
import { fixture, makeCtx, tick, root, NOW } from "./views-fixtures.js";
import { FEEDBACK_URL, WELCOME_KEY, WELCOME_LOG_KEY, WELCOME_TITLE, WELCOME_BODY, WELCOME_NOTE, FEEDBACK_LEAD,
  WELCOME_EVERY_DAYS, WELCOME_AFTER_FEEDBACK_DAYS, maybeShowWelcome, showWelcome, welcomeSeen, welcomeLog, welcomeDue,
  noteFeedbackOpened, _resetWelcome } from "../js/ui/feedback.js";
import { renderSettings, mountSettings, unmountSettings, FEEDBACK_LINE, FEEDBACK_NOTE } from "../js/ui/views/settings.js";
import { renderAbout } from "../js/ui/views/about.js";
import { bindActions } from "../js/ui/actions.js";
import { cleanNotify } from "../js/state.js";

const FORM = "https://forms.gle/zK4hi2UfYsrXURR97";   // the owner's link, verbatim
const OWNER_TITLE = "Welcome to the beta version of Straight Bussing!";
const DASH = /[–—]/;   // en / em dash: never in visible text (DESIGN.md 1b)
const DAY = 86400000, T0 = Date.UTC(2026, 10, 2, 15);

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

test("feedback: one URL, the owner's form; the owner's title; the ask stresses that feedback is very helpful", () => {
  eq(FEEDBACK_URL, FORM);
  eq(WELCOME_TITLE, OWNER_TITLE, "the owner's title, exactly");
  eq(FEEDBACK_LEAD, "Your feedback would be very helpful.");
  ok(/beta/.test(WELCOME_BODY) && /about a minute/.test(WELCOME_BODY) && /directly shapes/.test(WELCOME_BODY), "beta, a minute, it shapes the app: " + WELCOME_BODY);
  ok(/Settings/.test(WELCOME_NOTE), "says Give feedback is also in Settings");
  for (const t of [FEEDBACK_LEAD, WELCOME_BODY, WELCOME_NOTE, FEEDBACK_LINE]) {
    ok(!DASH.test(t), "no en / em dash: " + t);
    ok(!/UChicago|UGo|University/.test(t), "no university names of its own: " + t);
  }
  eq([WELCOME_EVERY_DAYS, WELCOME_AFTER_FEEDBACK_DAYS], [7, 30], "once a week at most; a month after the form was opened");
});

test("welcome popup: owner's title and text, buttons Cancel / Go to Feedback, the link opens the form in a new tab", async () => {
  _resetWelcome();
  const before = document.createElement("button");
  before.textContent = "opener";
  document.body.appendChild(before);
  before.focus();
  const st = mem(), lg = mem();
  const p = maybeShowWelcome({ storage: st, log: lg, now: T0 });
  ok(p && typeof p.then === "function", "shown");
  const d = dlg();
  ok(d && d.open && d.matches(":modal"), "a modal <dialog>");
  eq(d.querySelector(".v-welcome-band h2").textContent, OWNER_TITLE, "the title sits in the tinted band");
  ok(d.querySelector(".v-welcome-band .fb-badge[aria-hidden='true'] svg"), "the speech bubble icon is decoration only");
  eq([...d.querySelectorAll("p")].map((x) => x.textContent), [FEEDBACK_LEAD, WELCOME_BODY, WELCOME_NOTE], "the ask first, then why, then where else");
  eq(getComputedStyle(d.querySelector(".v-welcome-lead")).fontWeight, "650", "the ask in bold");
  eq(document.getElementById(d.getAttribute("aria-labelledby")), d.querySelector("h2"), "aria-labelledby = the title");
  eq(document.getElementById(d.getAttribute("aria-describedby")).textContent, FEEDBACK_LEAD + WELCOME_BODY + WELCOME_NOTE, "aria-describedby = all the text");
  const btns = [...d.querySelectorAll("[data-welcome]")];
  eq(btns.map((b) => b.textContent), ["Cancel", "Go to Feedback"], "exactly two buttons, owner's labels, in order");
  const a = btns[1];
  eq([a.tagName, a.getAttribute("href"), a.getAttribute("target")], ["A", FORM, "_blank"], "a real link to the form, new tab");
  ok(/\bnoopener\b/.test(a.getAttribute("rel")), "rel=noopener");
  ok(/^Go to Feedback, .*new tab/.test(a.getAttribute("aria-label")), "screen readers hear that it opens a new tab: " + a.getAttribute("aria-label"));
  eq(btns[0].tagName, "BUTTON");
  eq(document.activeElement, btns[0], "focus moved into the popup, on Cancel (the safe choice)");
  ok(!DASH.test(d.textContent), "no en / em dash");
  eq(st.getItem(WELCOME_KEY), "1", "counted as seen in this visit as soon as it opens");
  eq(welcomeLog(lg), { shown: T0, feedback: 0 }, "and its date remembered for the weekly rule");
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

test("welcome popup: never twice in one visit; a reload or a new visit within the week does not show it again", async () => {
  _resetWelcome();
  const st = mem(), lg = mem();
  ok(!welcomeSeen(st));
  const p = maybeShowWelcome({ storage: st, log: lg, now: T0 });
  ok(p && dlg(), "first visit: shown");
  eq(maybeShowWelcome({ storage: st, log: lg, now: T0 }), null, "a second call in the same page load does nothing");
  eq(document.querySelectorAll("dialog.v-welcome").length, 1, "only one popup");
  await closeAny();
  // a reload: the page (and module state) starts over, sessionStorage and localStorage stay
  eq(maybeShowWelcome({ storage: st, log: lg, now: T0 + 60000 }), null, "a reload: not shown");
  ok(!dlg());
  ok(welcomeSeen(st));
  _resetWelcome();
  // new visits (new tab / browser restart: a fresh sessionStorage) during the week: not shown
  for (const days of [1, 3, 6.9]) {
    eq(maybeShowWelcome({ storage: mem(), log: lg, now: T0 + days * DAY }), null, `a new visit ${days} days later: not shown`);
    _resetWelcome();
  }
  ok(!dlg());
  // a week later: shown once more, and the week starts again
  const p2 = maybeShowWelcome({ storage: mem(), log: lg, now: T0 + 7 * DAY });
  ok(p2 && dlg(), "a new visit 7 days later: shown");
  eq(welcomeLog(lg).shown, T0 + 7 * DAY);
  await closeAny();
  eq(maybeShowWelcome({ storage: mem(), log: lg, now: T0 + 10 * DAY }), null, "3 days after that: not shown");
  _resetWelcome();
});

test("welcome popup: after the rider opens the form (popup or Settings), a month without asking", async () => {
  // Go to Feedback in the popup
  _resetWelcome();
  const lg = mem();
  const p = maybeShowWelcome({ storage: mem(), log: lg, now: T0 });
  ok(p && dlg(), "shown");
  await tick(380);
  const nav = catchNav();
  try { userClick(dlg().querySelector('[data-welcome="feedback"]')); } finally { nav.off(); }
  eq(await p, "feedback");
  ok(welcomeLog(lg).feedback > 0, "the form's opening is remembered");
  await tick(5);
  // pin the date for the arithmetic below (the popup's own note uses the real clock)
  noteFeedbackOpened({ storage: lg, now: T0 });
  eq(welcomeLog(lg), { shown: T0, feedback: T0 });
  for (const days of [7, 14, 29.9]) {
    _resetWelcome();
    eq(maybeShowWelcome({ storage: mem(), log: lg, now: T0 + days * DAY }), null, `${days} days after opening the form: not shown`);
  }
  _resetWelcome();
  const p2 = maybeShowWelcome({ storage: mem(), log: lg, now: T0 + 30 * DAY });
  ok(p2 && dlg(), "30 days after: shown again");
  await closeAny();
  // Give feedback in Settings counts the same, even before the popup ever showed
  const lg2 = mem();
  noteFeedbackOpened({ storage: lg2, now: T0 });
  eq(maybeShowWelcome({ storage: mem(), log: lg2, now: T0 + 8 * DAY }), null, "Settings' Give feedback 8 days ago: not shown");
  _resetWelcome();
});

test("welcome popup: the weekly rule is pure and survives a broken log or a changed clock", () => {
  eq(welcomeDue({ shown: 0, feedback: 0 }, T0), true, "never shown: due");
  eq(welcomeDue(null, T0), true);
  eq(welcomeDue({ shown: T0 - 6 * DAY }, T0), false);
  eq(welcomeDue({ shown: T0 - 7 * DAY }, T0), true);
  eq(welcomeDue({ shown: T0 - 8 * DAY, feedback: T0 - 29 * DAY }, T0), false, "the form rule wins");
  eq(welcomeDue({ shown: T0 - 8 * DAY, feedback: T0 - 31 * DAY }, T0), true);
  eq(welcomeDue({ shown: T0 + 2 * DAY }, T0), false, "a date just ahead (clock set back): wait");
  eq(welcomeDue({ shown: T0 + 400 * DAY }, T0), true, "a date far ahead (a wrong clock) never silences it for good");
  const bad = mem();
  bad.setItem(WELCOME_LOG_KEY, "{not json");
  eq(welcomeLog(bad), { shown: 0, feedback: 0 }, "unreadable log: as if never shown");
  bad.setItem(WELCOME_LOG_KEY, JSON.stringify({ shown: "x", feedback: -5 }));
  eq(welcomeLog(bad), { shown: 0, feedback: 0 });
  eq(welcomeLog(blocked), { shown: 0, feedback: 0 }, "throwing storage");
  eq(welcomeLog(null), { shown: 0, feedback: 0 });
  noteFeedbackOpened({ storage: blocked });   // never throws
  noteFeedbackOpened({ storage: null });
});

test("welcome popup: blocked storage or private mode never crashes and shows it at most once per page load", async () => {
  for (const st of [blocked, null]) {
    _resetWelcome();
    let p = null;
    try { p = maybeShowWelcome({ storage: st, log: st }); } catch (e) { ok(false, "threw: " + e.message); }
    ok(p && dlg(), "shown once (" + (st ? "throwing storage" : "no storage") + ")");
    await tick(380);
    dlg().querySelector('[data-welcome="cancel"]').click();
    await tick(5);
    eq(maybeShowWelcome({ storage: st, log: st }), null, "not again in this page load, not on every render");
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

/** Is this "rgb(...)" color mostly green (the live color's job, DESIGN.md 1b)? */
const greenish = (c) => { const [r, g, b] = String(c).match(/[\d.]+/g).map(Number); return g > r + 20 && g > b + 20; };

test("welcome popup: noticeable (a tinted band, not the live green) and readable in light and dark, sized like the confirm popup, scales with the desktop phone frame", async () => {
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
      const band = d.querySelector(".v-welcome-band"), bandBg = cs(band).backgroundColor, badge = d.querySelector(".fb-badge");
      ok(bandBg !== bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(bandBg), `${theme}: the band stands out (${bandBg} on ${bg})`);
      const probe = document.body.appendChild(document.createElement("div"));
      probe.style.background = "var(--accent-bg)";
      eq(bandBg, cs(probe).backgroundColor, theme + ": band = --accent-bg");
      probe.remove();
      ok(!greenish(bandBg) && !greenish(cs(badge).backgroundColor), theme + ": never the green live color");
      const br = band.getBoundingClientRect(), dr = d.getBoundingClientRect();
      ok(Math.abs(br.left - dr.left) < 1 && Math.abs(br.right - dr.right) < 1 && Math.abs(br.top - dr.top) < 1, theme + ": the band runs edge to edge at the top");
      const pairs = [["title", d.querySelector("h2"), bandBg], ["badge icon", badge, cs(badge).backgroundColor]];
      for (const x of d.querySelectorAll("#v-welcome-b p")) pairs.push([x.className, x, bg]);
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
      const tops = new Set();
      for (const n of b.childNodes) {
        if (n.nodeType !== 3 || !n.textContent.trim()) continue;
        const r = document.createRange();
        r.selectNodeContents(n);
        for (const x of r.getClientRects()) tops.add(Math.round(x.top));
      }
      eq(tops.size, 1, "label on one line: " + b.textContent);
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

test("settings: Beta feedback comes first, a tinted card with the ask and a real link to the form (primary button, 44 px)", async () => {
  const h = renderSettings(fixture(base()), NOW);
  ok(!DASH.test(h.replace(/<[^>]+>/g, "")), "no en / em dash");
  const ctx = makeCtx(base());
  const el = root();
  el.innerHTML = h;
  mountSettings(el, ctx);
  const off = bindActions(el, () => ctx);
  const nav = catchNav();
  let saved = null;
  try { saved = localStorage.getItem(WELCOME_LOG_KEY); localStorage.removeItem(WELCOME_LOG_KEY); } catch (e) { /* */ }
  try {
    eq(el.querySelector(".v-h").textContent, "Beta feedback", "the first section of Settings");
    const card = el.querySelector(".st-feedback");
    eq(card.previousElementSibling, el.querySelector(".v-h"), "the card right under it");
    eq(card.querySelector(".st-fblead").textContent, FEEDBACK_LEAD, "the same ask as the popup, first");
    ok(card.querySelector(".fb-badge[aria-hidden='true'] svg"), "the popup's icon, decoration only");
    ok(card.textContent.includes(FEEDBACK_LINE) && card.textContent.includes(FEEDBACK_NOTE), "the beta line and the privacy note");
    ok(/about a minute/.test(FEEDBACK_LINE), "short form of the popup's message");
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
          ["note", card.querySelector(".st-fbnote"), cbg], ["button", a, cs(a).backgroundColor], ["badge icon", badge, cs(badge).backgroundColor]]) {
          const k = contrast(cs(x).color, back);
          ok(k >= 4.5, `${theme}: ${name} contrast ${k.toFixed(2)} >= 4.5 (${cs(x).color} on ${back})`);
        }
      }
    } finally { still.remove(); if (prevTheme === undefined) delete html.dataset.theme; else html.dataset.theme = prevTheme; }
    userClick(a);
    eq(nav.seen, [false], "Settings lets the link open the form");
    eq([ctx.calls.navigate.length, ctx.calls.toast.length], [0, 0], "no app navigation or toast");
    ok(welcomeLog().feedback > 0, "tapping Give feedback quiets the welcome popup for a month");
  } finally {
    nav.off(); off?.(); unmountSettings(); el.remove();
    try { if (saved === null) localStorage.removeItem(WELCOME_LOG_KEY); else localStorage.setItem(WELCOME_LOG_KEY, saved); } catch (e) { /* */ }
  }
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
