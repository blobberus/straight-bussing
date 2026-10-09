/**
 * @module ui/views/about
 * About: unofficial notice, official phone/link, privacy statements (what leaves the device:
 * typed place text -> photon.komoot.io; rounded walking-leg endpoints -> routing.openstreetmap.de /
 * valhalla1.openstreetmap.de), theme control (ui/theme.js mount), data credits and version.
 */
import { registerView } from "../router.js";
import * as theme from "../theme.js";
import { esc } from "../../core/esc.js";

/** App version shown in About. */
export const APP_VERSION = "2.0.0";

const THEMES = [["auto", "Auto"], ["light", "Light"], ["dark", "Dark"]];
let offStore = null;

/**
 * Render the about view (static except for the schedule date patched in by mount).
 * @returns {string}
 */
export function renderAbout() {
  return `<div class="v-about">
<section class="v-card v-unofficial" aria-label="Unofficial app">
  <p class="v-prim">Straight Bussing is an unofficial student project.</p>
  <p class="v-sec">It is not affiliated with or endorsed by the University or by Passio. Arrival times are predictions and can be wrong.</p>
  <p class="v-sec">For safety rides or anything urgent, use the official service:</p>
  <div class="v-actions"><a class="v-btn v-btn--primary" href="tel:7737028181">Call 773.702.8181</a><a class="v-btn v-btn--secondary" href="https://safety-security.uchicago.edu/Transportation" target="_blank" rel="noopener">Official transportation page</a></div>
</section>
<h3 class="v-h">Appearance</h3>
<div class="v-theme" data-region="theme"></div>
<h3 class="v-h">Privacy</h3>
<ul class="v-plain">
  <li>No account, no ads, no tracking. Your location, if you allow it, stays on this device.</li>
  <li>Place search: station names and places within a 30-minute walk of campus stops are searched on your device, including spelling fixes. Only when that finds fewer than 5 matches, or when you tap “Search for … instead”, is text sent to <b>photon.komoot.io</b> (OpenStreetMap geocoder): the text you typed, or its spelling fix when results are shown for the fix, and nothing else.</li>
  <li>Walking directions: the start and end of each walking leg, rounded to about 10 m, are sent to <b>routing.openstreetmap.de</b> (or <b>valhalla1.openstreetmap.de</b> if that is down) to follow sidewalks. If both fail, a straight-line estimate is used and labeled "estimate".</li>
  <li>Settings (theme, hidden routes) are saved in this browser only.</li>
</ul>
<h3 class="v-h">How times work</h3>
<p class="v-sec">Arrival times come from the live shuttle feed. Ride, wait and total times in Directions are estimates from schedules and live predictions, and each one says where it came from. If the feed is late or down, the app tells you.</p>
<h3 class="v-h">Credits</h3>
<ul class="v-plain v-sec">
  <li>Live and schedule data: public Passio GTFS and GTFS-Realtime feeds.</li>
  <li>Map data and the campus places list: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors (ODbL).</li>
  <li>Map tiles: <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>, using <a href="https://openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a>. Rendering: Leaflet and MapLibre GL.</li>
  <li>Place search: Photon by komoot. Walking routes: FOSSGIS OSRM and Valhalla.</li>
</ul>
<p class="v-foot" data-region="about-data">Version ${esc(APP_VERSION)}</p>
<p class="v-foot">Unofficial. Not affiliated with the University. Official service: <a href="tel:7737028181">773.702.8181</a>.</p>
</div>`;
}

function fallbackTheme(el, ctx) {
  const draw = () => {
    const cur = ctx?.store?.get?.().theme || "auto";
    el.innerHTML = `<div class="v-seg" role="radiogroup" aria-label="Theme">${THEMES.map(([v, l]) => `<button type="button" role="radio" class="v-segbtn${cur === v ? " is-on" : ""}" aria-checked="${cur === v}" data-theme-val="${v}">${l}</button>`).join("")}</div>`;
  };
  draw();
  el.addEventListener("click", (e) => {
    const b = e.target.closest?.("[data-theme-val]");
    if (b) ctx?.store?.set?.({ theme: b.dataset.themeVal });
  });
  offStore = ctx?.store?.subscribe?.((s, ch) => { if (ch.has("theme")) draw(); }) || null;
}

/**
 * Mount the theme control and the schedule date.
 * @param {Element} root
 * @param {object} ctx
 */
export function mountAbout(root, ctx) {
  const el = root.querySelector('[data-region="theme"]');
  if (el && !el.childElementCount) {
    let done = false;
    try {
      if (typeof theme.mount === "function") { theme.mount(el); done = true; }
      else if (typeof ctx?.theme?.mount === "function") { ctx.theme.mount(el); done = true; }
    } catch (e) { done = false; }
    if (!done || !el.childElementCount) fallbackTheme(el, ctx);
  }
  const dataEl = root.querySelector('[data-region="about-data"]');
  if (dataEl && typeof fetch === "function") {
    fetch("data/meta.json").then((r) => (r.ok ? r.json() : null)).then((j) => {
      const d = j?.generated_utc ? new Date(j.generated_utc) : null;
      if (d && !isNaN(d) && dataEl.isConnected) dataEl.textContent = `Version ${APP_VERSION} · Schedule data from ${d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}`;
    }).catch(() => {});
  }
}

registerView("about", {
  title: () => "About",
  parent: "myroutes",
  detent: "full",
  tab: "myroutes",
  render: () => renderAbout(),
  mount: (root, ctx) => mountAbout(root, ctx),
  unmount: () => { offStore?.(); offStore = null; },
});
