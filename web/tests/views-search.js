// Place search in the three UIs (ui/views/placesearch.js): on-device results on every keystroke (no debounce),
// Photon debounced + aborted, "search exactly" mode, and the search-assumption note in Directions, Current trip
// ("Type an address or place") and Routes to station ("Type an address or place").
import { test, eq, ok } from "./lib.js";
import { makeCtx, tick, root, type } from "./views-fixtures.js";
import { runAction } from "../js/ui/actions.js";
import { createPlaceSearch, placeDeps, assumeNoteHTML, PHOTON_MS } from "../js/ui/views/placesearch.js";
import { renderPick, mountPick, unmountPick, setMode, resetPick } from "../js/ui/views/pick.js";
import { D, renderDirections, mountDirections, unmountDirections } from "../js/ui/views/directions.js";
import { N, renderNearby, mountNearby, unmountNearby } from "../js/ui/views/nearby.js";

const REG = { label: "Joseph Regenstein Library", sub: "Library · 1100 E 57th St · 1 min walk to Regenstein Library (N)", lat: 41.7922, lon: -87.5999, local: true, score: 100 };
const BIG = { from: "regnstien", to: "Regenstein", big: true };
const REAL = { ...placeDeps };

/** Stub the backend: local answers synchronously, Photon (search) records calls. */
function stubDeps({ assumed = BIG, items = [REG], remote = [REG] } = {}) {
  const calls = { local: [], search: [] };
  placeDeps.local = (q, o) => { calls.local.push([q, !!o?.exact]); return o?.exact ? { items: [] } : { items, assumed }; };
  placeDeps.search = async (q, o) => { calls.search.push([q, !!o?.exact]); await tick(5); return o?.exact ? { items: [{ ...REG, label: "Regnstien Exact Hit" }] } : { items: remote, assumed }; };
  return calls;
}
const restore = () => Object.assign(placeDeps, REAL);
function mountWith(ctx, render, mount) { const el = root(); el.innerHTML = render(ctx.store.get()); mount(el, ctx); return el; }

test("place search: on-device results on every keystroke, Photon once after a pause", async () => {
  const seen = [], changes = [];
  const ps = createPlaceSearch((s) => changes.push(s.items.map((x) => x.label).join()), {
    local: (q) => ({ items: [{ label: "L:" + q }] }),
    search: async (q, o) => { seen.push([q, o.exact]); await tick(5); return { items: [{ label: "R:" + q }] }; },
    ms: 30,
  });
  ps.query("re");
  eq([ps.state.items[0].label, ps.state.status], ["L:re", ""], "2 letters: local only, nothing sent");
  for (const q of ["reg", "rege", "regen"]) { ps.query(q); eq(ps.state.items[0].label, "L:" + q, "synchronous for " + q); }
  eq(ps.state.status, "busy", "Photon still coming");
  await tick(90);
  eq(seen, [["regen", false]], "one Photon request for the burst");
  eq([ps.state.items[0].label, ps.state.status], ["R:regen", ""]);
  eq(PHOTON_MS, 250, "Photon debounce");
});

test("place search: 5 local matches = no Photon; stale answers dropped; exact() searches at once", async () => {
  const seen = [];
  let slow = true;
  const five = Array.from({ length: 5 }, (_, i) => ({ label: "P" + i }));
  const ps = createPlaceSearch(() => {}, {
    local: (q, o) => (q === "pizza" ? { items: five } : { items: [], assumed: o.exact ? undefined : { from: q, to: "Fixed", big: true } }),
    search: async (q, o) => { seen.push([q, o.exact]); await tick(slow ? 60 : 1); return { items: [{ label: "R:" + q + (o.exact ? "!" : "") }] }; },
    ms: 10,
  });
  ps.query("pizza");
  await tick(40);
  eq([seen.length, ps.state.status], [0, ""], "answered on the device");
  ps.query("first");
  await tick(20);                       // request in flight
  slow = false;
  ps.query("second");
  await tick(90);
  eq(ps.state.items[0].label, "R:second", "the slow first answer never replaces the newer one");
  eq(ps.state.assumed, null, "remote answer without assumed clears it");
  ps.query("wrongly");
  eq(ps.state.assumed?.to, "Fixed");
  ps.exact(true);
  eq([ps.state.exact, ps.state.fix?.to, ps.state.status], [true, "Fixed", "busy"]);
  await tick(5);
  eq(seen.at(-1), ["wrongly", true], "exact search sent right away (no debounce)");
  eq(ps.state.items[0].label, "R:wrongly!");
  ps.exact(false);
  eq(ps.state.exact, false, "back to the correction");
  ps.query("wrongly 2");
  eq([ps.state.exact, ps.state.fix], [false, null], "typing again leaves exact mode");
});

test("place search: while the index loads, results appear as soon as it is there", async () => {
  let ready = false, release;
  const ps = createPlaceSearch(() => {}, { local: () => (ready ? { items: [{ label: "L" }] } : null), load: () => new Promise((r) => { release = r; }), search: async () => ({ items: [] }), ms: 5000 });
  ps.query("ab");
  eq([ps.state.status, ps.state.items.length], ["busy", 0]);
  await tick(0);                         // load() starts in a microtask
  ready = true; release();
  await tick(5);
  eq([ps.state.status, ps.state.items[0].label], ["", "L"]);
});

test("note: only for a long stretch, accessible, escaped", () => {
  const s = { q: "regnstien", items: [REG], status: "", assumed: BIG, exact: false, fix: null };
  const h = assumeNoteHTML(s, "x:exact");
  ok(h.includes('role="status"') && h.includes("Showing results for <b>Regenstein</b>"), h);
  ok(h.includes('data-action="x:exact" data-exact="1"') && h.includes("Search for &ldquo;regnstien&rdquo; instead"));
  eq(assumeNoteHTML({ ...s, assumed: { ...BIG, big: false } }, "x:exact"), "", "one-letter fix: no note");
  const ex = assumeNoteHTML({ ...s, exact: true, fix: BIG }, "x:exact");
  ok(ex.includes("Showing results for &ldquo;regnstien&rdquo;") && ex.includes('data-exact="0"') && ex.includes("Did you mean Regenstein?"), ex);
  ok(!assumeNoteHTML({ ...s, q: "<b>", assumed: { from: "<b>", to: "<i>", big: true } }, "x").includes("<i>"), "escaped");
});

test("routes to station / address: note + search exactly, focus stays on the note", async () => {
  resetPick();
  const calls = stubDeps();
  const ctx = makeCtx({ view: "pick" });
  const el = mountWith(ctx, renderPick, mountPick);
  await setMode("addr", ctx);
  type(el.querySelector('[data-input="pick-q"]'), "regnstien");
  ok(el.textContent.includes("Joseph Regenstein Library"), "local result shown without waiting");
  const note = el.querySelector("[data-assume]");
  ok(note && note.querySelector('[role="status"]').textContent === "Showing results for Regenstein", "note");
  const btn = note.querySelector('button[data-action="pick:exact"]');
  eq(btn.textContent, "Search for “regnstien” instead");
  btn.focus();
  runAction("pick:exact", { exact: "1" }, null, ctx);
  await tick(20);
  eq(calls.search.at(-1), ["regnstien", true], "exact search as typed");
  ok(el.textContent.includes("Regnstien Exact Hit"), "exact results");
  const back = el.querySelector('[data-assume] button[data-exact="0"]');
  ok(back && back.textContent === "Did you mean Regenstein?", "way back to the correction");
  eq(document.activeElement, back, "focus kept on the note");
  unmountPick(); el.remove(); resetPick(); restore();
});

test("current trip / type an address: note + search exactly", async () => {
  N.q = ""; N.mode = "place"; N.anchor = null;
  const calls = stubDeps();
  const ctx = makeCtx();
  const el = mountWith(ctx, renderNearby, mountNearby);
  type(el.querySelector('[data-input="nearby-q"]'), "regnstien");
  ok(el.querySelector('[data-region="nearby-results"]').textContent.includes("Joseph Regenstein Library"), "instant local result");
  ok(el.querySelector("[data-assume]")?.textContent.includes("Showing results for Regenstein"), "note");
  runAction("nearby:exact", { exact: "1" }, null, ctx);
  await tick(20);
  eq(calls.search.at(-1), ["regnstien", true]);
  ok(el.textContent.includes("Regnstien Exact Hit") && el.textContent.includes("Did you mean Regenstein?"));
  runAction("nearby:exact", { exact: "0" }, null, ctx);
  ok(el.textContent.includes("Showing results for Regenstein"), "back to the correction");
  unmountNearby(); el.remove(); N.q = ""; N.mode = "station"; restore();
});

test("directions: place suggestions on the keystroke itself, note above the list, search exactly", async () => {
  Object.assign(D, { from: null, to: null, fromText: "", toText: "", active: null, sugs: [], result: null });
  const calls = stubDeps({ assumed: { from: "regnstien", to: "Regenstein", big: true } });
  const ctx = makeCtx();
  const el = mountWith(ctx, renderDirections, mountDirections);
  const to = el.querySelector('[data-input="dir-to"]');
  to.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  type(to, "regnstien");
  const sug = el.querySelector('[data-region="dir-sug"]');
  ok([...sug.querySelectorAll('[data-action="dir:sug"]')].some((b) => b.textContent.includes("Joseph Regenstein Library")), "suggested synchronously");
  ok(sug.querySelector('[role="listbox"]') && !sug.querySelector('[role="listbox"] [data-assume]'), "note outside the listbox");
  ok(sug.querySelector("[data-assume]").textContent.includes("Showing results for Regenstein"));
  ok(sug.textContent.includes("Searching more places"), "Photon still coming");
  eq(calls.search.length, 0, "Photon waits for the pause");
  await tick(PHOTON_MS + 60);
  eq(calls.search, [["regnstien", false]]);
  runAction("dir:exact", { exact: "1" }, null, ctx);
  await tick(20);
  eq(calls.search.at(-1), ["regnstien", true]);
  ok(sug.textContent.includes("Regnstien Exact Hit") && sug.textContent.includes("Did you mean Regenstein?"));
  unmountDirections(); el.remove(); restore();
  Object.assign(D, { from: null, to: null, fromText: "", toText: "", active: null, sugs: [], result: null });
});

test("directions: a one-letter correction shows results without a note", async () => {
  Object.assign(D, { from: null, to: null, fromText: "", toText: "", active: null, sugs: [], result: null });
  stubDeps({ assumed: { from: "regenstien", to: "Regenstein", big: false } });
  const ctx = makeCtx();
  const el = mountWith(ctx, renderDirections, mountDirections);
  const to = el.querySelector('[data-input="dir-to"]');
  to.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  type(to, "regenstien");
  const sug = el.querySelector('[data-region="dir-sug"]');
  ok(sug.textContent.includes("Joseph Regenstein Library") && !sug.querySelector("[data-assume]"));
  unmountDirections(); el.remove(); restore();
  Object.assign(D, { from: null, to: null, fromText: "", toText: "", active: null, sugs: [], result: null });
});
