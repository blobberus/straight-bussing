// Settings > Credits (owner 2026-10-16): the last item, a button that expands the credits list.
import { test, eq, ok } from "./lib.js";
import { makeCtx, root, NOW } from "./views-fixtures.js";
import { bindActions } from "../js/ui/actions.js";
import { renderSettings, mountSettings, unmountSettings, creditsHTML, CREDITS } from "../js/ui/views/settings.js";
import { cleanNotify } from "../js/state.js";

const base = () => ({ notify: cleanNotify(null), favStops: [], journey: null });
function mounted() {
  const ctx = makeCtx(base());
  const el = root();
  el.innerHTML = renderSettings(ctx.store.get(), NOW);
  mountSettings(el, ctx);
  const off = bindActions(el, () => ctx);
  return { el, done: () => { off?.(); unmountSettings(); el.remove(); } };
}
const click = (el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const DASHES = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]");

test("settings credits: the very last item, collapsed by default, toggles in place", () => {
  const { el, done } = mounted();
  const st = el.querySelector(".st");
  eq(st.lastElementChild.classList.contains("st-credits"), true, "the last thing in Settings");
  const btn = el.querySelector(".st-credbtn"), body = el.querySelector("#st-credits");
  eq(btn.getAttribute("aria-expanded"), "false");
  eq(btn.getAttribute("aria-controls"), "st-credits");
  ok(body.hidden, "collapsed by default");
  ok(btn.textContent.includes("Credits"));
  click(btn);
  eq(btn.getAttribute("aria-expanded"), "true");
  ok(!body.hidden, "open");
  click(btn);
  ok(body.hidden && btn.getAttribute("aria-expanded") === "false", "closed again");
  done();
  const again = mounted();   // nothing stored: every Settings opens collapsed
  ok(again.el.querySelector("#st-credits").hidden, "collapsed on every open");
  again.done();
});

test("settings credits: the app maker, map and search sources, bus data; no UChicago names", () => {
  const box = document.createElement("div");
  box.innerHTML = creditsHTML(true);
  const t = box.textContent;
  for (const s of ["App made by blobberus", "OpenFreeMap", "OpenMapTiles", "OpenStreetMap", "ODbL", "Leaflet", "MapLibre GL JS",
    "MapLibre GL Leaflet", "OSRM", "Valhalla", "FOSSGIS", "Overpass API", "Photon", "komoot", "Passio", "GTFS-Realtime",
    "GTFS schedule", "Data collection", "straight-bussing-data"]) ok(t.includes(s), s);
  const low = t.toLowerCase();
  ok(!low.includes("uchicago") && !low.includes("university") && !low.includes("administration") && !/(^|[^a-z])ugo([^a-z]|$)/i.test(t),
    "no UChicago, University, UGo or administration");
  ok(!DASHES.test(t), "no en or em dash");
  eq(CREDITS.map((g) => g.group), ["App", "Maps", "Search", "Bus data"]);
  const links = [...box.querySelectorAll("a")];
  ok(links.length >= 10, links.length + " links");
  ok(links.every((a) => a.target === "_blank" && a.rel === "noopener" && a.getAttribute("href").startsWith("https://")), "new tab, rel=noopener, https");
});

test("settings credits: the button is a 44 px target, the chevron is hidden from screen readers", () => {
  const { el, done } = mounted();
  el.style.width = "393px";
  const btn = el.querySelector(".st-credbtn");
  ok(btn.getBoundingClientRect().height >= 44, "height " + btn.getBoundingClientRect().height);
  ok(btn.querySelector(".v-chev")?.getAttribute("aria-hidden") === "true");
  done();
});
