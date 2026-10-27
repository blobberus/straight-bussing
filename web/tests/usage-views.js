// Usage statistics in Settings, About, the location note and privacy.html (usage.test.html).
import { test, eq, ok } from "./lib.js";
import { fixture, makeCtx, tick, root, NOW } from "./views-fixtures.js";
import { bindActions } from "../js/ui/actions.js";
import { renderSettings, mountSettings, unmountSettings, locHTML, LOC_DISCLAIMER, LOC_ZONE_NOTE, USAGE_ALWAYS, USAGE_RESET } from "../js/ui/views/settings.js";
import { renderAbout, ABOUT_USAGE } from "../js/ui/views/about.js";
import { cleanNotify } from "../js/state.js";
import { useMemoryOverlay, load } from "../js/core/storage.js";
import { USAGE_URL, cleanUsage, anonId, _configureUsage } from "../js/data/usage.js";

const DASH = /[–—]/;
const base = (over = {}) => ({ notify: cleanNotify(null), favStops: [], journey: null, usage: cleanUsage(null, {}), ...over });
const on = () => _configureUsage({ url: "https://script.google.com/macros/s/TEST/exec" });
const off = () => _configureUsage({ url: USAGE_URL });
const click = (el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const change = (el, set) => { set(el); el.dispatchEvent(new Event("change", { bubbles: true })); };

test("usage views: nothing changes until a receiver is set", () => {
  off();
  const h = renderSettings(fixture(base()), NOW);
  ok(!h.includes("Usage statistics") && !h.includes("usageDur"), "no Settings section");
  const a = renderAbout();
  ok(a.includes("No account, no ads, no tracking.") && !a.includes("Usage statistics"), "About as before");
  ok(locHTML(fixture(base({ usage: { dur: true, zone: true } }))).includes(LOC_DISCLAIMER) && !locHTML(fixture(base({ usage: { dur: true, zone: true } }))).includes(LOC_ZONE_NOTE));
});

test("usage views: Settings explains what is always counted, the identity line, two switches and the reset", () => {
  on();
  try {
    const h = renderSettings(fixture(base()), NOW);
    ok(h.includes('<h3 class="v-h">Usage statistics</h3>'));
    ok(USAGE_ALWAYS.includes("Your identity is never collected") && USAGE_ALWAYS.includes("Always counted, anonymously") && USAGE_ALWAYS.includes("the iPhone app collects nothing"));
    ok(h.includes('data-st-in="usageDur"') && h.includes('data-st-in="usageZone"') && h.includes(USAGE_RESET));
    ok(/data-st-in="usageDur"[^>]*checked/.test(h), "length on by default");
    ok(!/data-st-in="usageZone"[^>]*checked/.test(h), "nearest stop off by default");
    for (const t of [USAGE_ALWAYS, LOC_ZONE_NOTE, ABOUT_USAGE]) ok(!DASH.test(t), "no dash characters: " + t.slice(0, 30));
  } finally { off(); }
});

test("usage views: the switches save the choices; the location note says when the nearest stop is shared", async () => {
  on();
  useMemoryOverlay(true);
  const ctx = makeCtx(base());
  const el = root();
  el.innerHTML = renderSettings(ctx.store.get(), NOW);
  mountSettings(el, ctx);
  const unbind = bindActions(el, () => ctx);
  try {
    change(el.querySelector('[data-st-in="usageDur"]'), (x) => { x.checked = false; });
    await tick();
    eq(ctx.store.get().usage, { dur: false, zone: false });
    change(el.querySelector('[data-st-in="usageZone"]'), (x) => { x.checked = true; });
    await tick();
    eq(ctx.store.get().usage, { dur: false, zone: true });
    ok(el.querySelector('[data-region="loc"]').textContent.includes("You turned on Include my nearest stop"), "location note updated");
    const id = anonId().id;
    click(el.querySelector('[data-st="usage-reset"]'));
    await tick();
    eq(load("usageId", null), null, "the number is forgotten");
    ok(ctx.calls.toast.some((t) => /new random number/.test(t)), "the rider is told");
    ok(id && anonId().id !== id, "the next visit makes a new one");
  } finally { unbind?.(); unmountSettings(); el.remove(); useMemoryOverlay(false); off(); }
});

test("usage views: About drops 'no tracking' and describes the statistics once they are on", () => {
  on();
  try {
    const a = renderAbout();
    ok(!a.includes("no tracking") && a.includes("No account, no ads."));
    ok(a.includes("Usage statistics (website only)") && a.includes("Your identity is never collected"));
  } finally { off(); }
});

test("usage views: privacy.html says what is always sent, what can be turned off, and that identity is never collected", async () => {
  const page = (await (await fetch("../privacy.html", { cache: "no-store" })).text()).replace(/\s+/g, " ");
  ok(page.includes("<b>Anonymous usage statistics (website only).</b>"));
  ok(page.includes("<b>Always:</b> when a visit starts") && page.includes("<b>Unless you turn it off</b>") && page.includes("<b>Only if you turn it on</b>"));
  ok(page.includes("Your identity is never collected"));
  ok(page.includes("The <b>iPhone app collects nothing</b>"), "the iPhone app's label stays Data Not Collected");
  ok(page.includes("Never your coordinates"));
  ok(!page.includes("no tracking, no analytics"), "the old promise is gone");
});
