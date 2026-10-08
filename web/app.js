"use strict";
const BASE = "https://passio3.com/chicago/passioTransit/gtfs/realtime/";
const POLL_MS = 10000, STALE_BUS_S = 60, DELAY_S = 120, OLD_S = 300;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeColor = (c) => (/^#[0-9a-fA-F]{6}$/.test(c || "") ? c : "#555555");
const now = () => Date.now() / 1000;

if (!window.L) { document.getElementById("pill").hidden = false; document.getElementById("pill").className = "statuspill err"; document.getElementById("pill").textContent = "Couldn't load the map. Check your connection and reload."; throw new Error("Leaflet not loaded"); }
const S = { routes: {}, stops: {}, shapes: {}, routeStops: {}, stopRoutes: {}, buses: [], trips: [], alerts: [],
  view: "nearby", prev: null, stop: null, route: null, user: null, lastOk: 0, feedTs: 0, loaded: false, failed: false,
  hidden: new Set(), routeFilter: null, filterName: "", pick: null, dir: { from: null, to: null, opts: null, sel: -1, walk: null } };
const SUB = ["stop", "route", "about", "pick", "dir"], HID_KEY = "sb-hidden-routes";
try { S.hidden = new Set(JSON.parse(localStorage.getItem(HID_KEY) || "[]")); } catch (e) { /* storage unavailable */ }
const saveHidden = () => { try { localStorage.setItem(HID_KEY, JSON.stringify([...S.hidden])); } catch (e) { /* ignore */ } };
const routeOn = (rid) => !S.hidden.has(rid) && (!S.routeFilter || S.routeFilter.has(rid));

/* ---------- color helpers ---------- */
function lum(hex) { const n = parseInt(hex.slice(1), 16); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(n >> 16) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255); }
const textOn = (hex) => (lum(hex) > 0.45 ? "#111114" : "#fff");
const color = (rid) => safeColor(S.routes[rid]?.color);
const rname = (rid) => S.routes[rid]?.short || S.routes[rid]?.long || "?";
const chip = (rid) => { const c = color(rid); const low = lum(c) > 0.8 || lum(c) < 0.02;
  return `<span class="chip${low ? " ring" : ""}" style="background:${c};color:${textOn(c)}">${esc(rname(rid))}</span>`; };

/* ---------- map ---------- */
const dark = { get matches() { return window.Theme ? Theme.isDark() : matchMedia("(prefers-color-scheme: dark)").matches; } };
const map = L.map("map", { zoomControl: false, minZoom: 12, maxZoom: 18 }).setView([41.7897, -87.5997], 15);
let tiles;
function setTiles() {
  if (tiles) map.removeLayer(tiles);
  tiles = window.MapStyle ? MapStyle.create(map, dark.matches)
    : window.maplibregl && L.maplibreGL ? L.maplibreGL({ style: "https://tiles.openfreemap.org/styles/" + (dark.matches ? "dark" : "positron"), attribution: "&copy; OpenFreeMap &copy; OpenStreetMap contributors" })
    : L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" });
  tiles.addTo(map);
}
setTiles();
if (window.Theme) Theme.onChange((d) => { if (window.MapStyle && tiles) MapStyle.update(tiles, d); else setTiles(); if (S.shapes && Object.keys(S.shapes).length) { drawStatic(); drawBuses(); } });
else matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", setTiles);
map.attributionControl.setPosition("topleft");
map.createPane("casing").style.zIndex = 380; map.createPane("lines").style.zIndex = 390;
const lineLayer = L.layerGroup().addTo(map), stopLayer = L.layerGroup().addTo(map), selLayer = L.layerGroup().addTo(map), busLayer = L.layerGroup().addTo(map), pickLayer = L.layerGroup().addTo(map), dirLayer = L.layerGroup().addTo(map);
map.on("zoomstart", () => $("map").classList.add("nogl")); map.on("zoomend", () => { $("map").classList.remove("nogl"); toggleStops(); });
const toggleStops = () => { const on = map.getZoom() >= 14; if (on && !map.hasLayer(stopLayer)) stopLayer.addTo(map); if (!on) map.removeLayer(stopLayer); };

function drawStatic() {
  lineLayer.clearLayers(); stopLayer.clearLayers();
  const sel = S.route, w = map.getZoom() >= 17 ? 6 : map.getZoom() >= 15 ? 5 : 4, cs = dark.matches ? "rgba(28,28,30,.9)" : "rgba(255,255,255,.9)";
  const order = Object.keys(S.shapes).sort((a, b) => (a === sel) - (b === sel));
  for (const rid of order) {
    if (rid !== sel && !routeOn(rid)) continue;
    const dim = sel && rid !== sel, op = dim ? 0.25 : 0.9;
    for (const pts of S.shapes[rid]) {
      L.polyline(pts, { color: cs, weight: w + 3, opacity: dim ? 0.2 : 1, pane: "casing", lineCap: "round", lineJoin: "round", interactive: false }).addTo(lineLayer);
      L.polyline(pts, { color: color(rid), weight: w, opacity: op, pane: "lines", lineCap: "round", lineJoin: "round", interactive: false }).addTo(lineLayer);
    }
  }
  for (const [id, st] of Object.entries(S.stops)) {
    const rs = (S.stopRoutes[id] || []).filter((r) => r === sel || routeOn(r)); if (!rs.length || (sel && !rs.includes(sel))) continue;
    const c = rs.length === 1 ? color(rs[0]) : dark.matches ? "#a1a1a8" : "#5c5c63";
    L.circleMarker([st.lat, st.lon], { radius: 5, color: c, weight: 2.5, fillColor: "#fff", fillOpacity: 1, interactive: false }).addTo(stopLayer);
    L.circleMarker([st.lat, st.lon], { radius: 22, stroke: false, fillOpacity: 0 }).on("click", () => openStop(id)).addTo(stopLayer);
  }
  toggleStops(); drawSelStop();
}
function drawSelStop() {
  selLayer.clearLayers(); const st = S.stop && S.stops[S.stop]; if (!st) return;
  L.circleMarker([st.lat, st.lon], { radius: 9, color: dark.matches ? "#409cff" : "#0a84ff", weight: 3, fillColor: "#fff", fillOpacity: 1, interactive: false }).addTo(selLayer);
}

const busMarkers = new Map();
function drawBuses() {
  const seen = new Set();
  for (const v of S.buses) {
    const rid = v.trip?.route_id, id = v.vehicle?.id; if (!id) continue;
    if (S.route && rid !== S.route) continue;
    if (rid !== S.route && !routeOn(rid)) continue;
    seen.add(id);
    const c = color(rid), stale = now() - (v.timestamp || S.feedTs) > STALE_BUS_S, ll = [v.position.latitude, v.position.longitude];
    let m = busMarkers.get(id);
    if (!m || m.rid !== rid) {
      if (m) busLayer.removeLayer(m.mk);
      const icon = L.divIcon({ className: "busicon", iconSize: [28, 28], iconAnchor: [14, 14],
        html: `<div class="bus" style="background:${c};color:${textOn(c)};--c:${c}"><div class="hd"></div>${esc(rname(rid).slice(0, 3))}</div>` });
      m = { rid, mk: L.marker(ll, { icon, zIndexOffset: 500, keyboard: false }).addTo(busLayer) };
      m.mk.on("click", () => { if (rid) openRoute(rid); });
      busMarkers.set(id, m);
    } else m.mk.setLatLng(ll);
    const el = m.mk.getElement()?.firstElementChild;
    if (el) { el.classList.toggle("stale", stale); const hd = el.querySelector(".hd"); if (hd) hd.style.transform = `rotate(${v.position.bearing || 0}deg)`; }
  }
  for (const [id, m] of busMarkers) if (!seen.has(id)) { busLayer.removeLayer(m.mk); busMarkers.delete(id); }
}

/* ---------- data ---------- */
async function loadStatic() {
  const get = (f) => fetch("data/" + f).then((r) => r.json());
  try { [S.routes, S.stops, S.shapes, S.routeStops] = await Promise.all(["routes.json", "stops.json", "shapes.json", "route_stops.json"].map(get)); } catch (e) { console.warn("static data missing", e); }
  for (const [rid, ids] of Object.entries(S.routeStops)) for (const i of new Set(ids)) (S.stopRoutes[i] ||= []).push(rid);
  drawStatic();
}
async function getJSON(name) {
  const r = await fetch(BASE + name + ".json?_=" + Date.now(), { cache: "no-store" });
  if (!r.ok) throw new Error(name + " " + r.status);
  return r.json();
}
async function poll() {
  try {
    const [vp, tu, sa] = await Promise.all([getJSON("vehiclePositions"), getJSON("tripUpdates"), getJSON("serviceAlerts").catch(() => ({ entity: [] }))]);
    S.feedTs = vp.header?.timestamp || 0;
    S.buses = (vp.entity || []).map((e) => e.vehicle).filter((v) => v?.position);
    S.trips = (tu.entity || []).map((e) => e.trip_update).filter(Boolean);
    S.alerts = (sa.entity || []).map((e) => e.alert).filter(Boolean);
    S.lastOk = now(); S.failed = false;
  } catch (e) { console.warn("poll failed", e); S.failed = true; }
  S.loaded = true;
  drawBuses(); renderStatus(); render(); if (S.view === "dir") dirPlan(false);
}

/* ---------- derived ---------- */
const staleness = () => (!S.lastOk ? "err" : now() - S.lastOk > 60 || S.failed ? "err" : S.feedTs && now() - S.feedTs > OLD_S ? "old" : S.feedTs && now() - S.feedTs > DELAY_S ? "late" : "");
function arrivalsFor(stopId, rid) {
  const t0 = now(), out = [];
  for (const tu of S.trips) {
    const r = tu.trip?.route_id; if (rid ? r !== rid : S.hidden.has(r)) continue;
    for (const u of tu.stop_time_update || []) {
      if (u.stop_id !== stopId) continue;
      const t = u.arrival?.time || u.departure?.time;
      if (t && t > t0 - 30) out.push({ rid: r, t, bus: tu.vehicle?.label });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}
function hav(a, b) { const R = 6371000, rad = Math.PI / 180, dLa = (b.lat - a.lat) * rad, dLo = (b.lon - a.lon) * rad;
  const x = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); }
const walkMin = (m) => Math.max(1, Math.round(m / 80));
const nearest = (n) => (S.user ? Object.entries(S.stops).map(([id, s]) => ({ id, ...s, d: hav(S.user, s) })).filter((s) => s.d < 5000 && (S.stopRoutes[s.id] || []).some((r) => !S.hidden.has(r))).sort((a, b) => a.d - b.d).slice(0, n) : []);
const runningCount = (rid) => S.buses.filter((v) => v.trip?.route_id === rid).length;

/* ---------- views ---------- */
function etaHTML(t) {
  const m = Math.floor((t - now()) / 60), tilde = staleness() === "old" ? "~" : "";
  if (m < 1) return `<div class="eta now"><span class="num">Now</span></div>`;
  return `<div class="eta"><span class="num">${tilde}${m}</span><span class="unit">min</span></div>`;
}
function arrivalRow(x) {
  const m = Math.max(0, Math.floor((x.t - now()) / 60)), r = S.routes[x.rid]?.long || "";
  return `<div class="row" role="group" aria-label="Route ${esc(rname(x.rid))}, ${esc(r)}, arrives in ${m} minutes, live">${chip(x.rid)}<div class="grow"><span class="prim">${esc(r)}</span><span class="sec"><span class="dot-live"></span>Live${x.bus ? " · Bus " + esc(x.bus) : ""}</span></div>${etaHTML(x.t)}</div>`;
}
const skeleton = () => '<div class="skel"></div><div class="skel"></div><div class="skel"></div>';

function viewNearby() {
  if (!S.loaded) return skeleton();
  let h = "";
  const ns = nearest(3);
  if (ns.length) {
    ns.forEach((s, i) => {
      const a = arrivalsFor(s.id).slice(0, i ? 1 : 3);
      h += (i === 1 ? "<h2>Also nearby</h2>" : "") + `<div class="card"><button class="row cardhead" data-stop="${esc(s.id)}"><div class="grow"><span class="prim">${esc(s.name)}</span><span class="sec">${walkMin(s.d)} min walk · ${Math.round(s.d)} m</span></div></button>${a.length ? a.map(arrivalRow).join("") : '<div class="row"><span class="sec">No upcoming arrivals</span></div>'}</div>`;
    });
  } else {
    h += '<button class="cta" id="useLoc">Use my location</button>';
    const soon = Object.keys(S.stops).map((id) => ({ id, a: arrivalsFor(id)[0] })).filter((x) => x.a).sort((a, b) => a.a.t - b.a.t).slice(0, 6);
    h += "<h2>Arriving soon</h2>" + (soon.length ? '<div class="card">' + soon.map((x) => `<button class="row" data-stop="${esc(x.id)}">${chip(x.a.rid)}<div class="grow"><span class="prim">${esc(S.stops[x.id].name)}</span><span class="sec">${esc(S.routes[x.a.rid]?.long || "")}</span></div>${etaHTML(x.a.t)}</button>`).join("") + "</div>"
      : '<div class="empty"><b>No shuttles running right now</b>Check the official schedule for service hours.</div>');
    if (S.locDenied) h += '<p class="foot">Location is off. Enable it in your browser settings to see stops near you.</p>';
  }
  return h;
}
function viewStop() {
  const st = S.stops[S.stop]; if (!st) return "";
  const a = arrivalsFor(S.stop).slice(0, 10), rs = (S.stopRoutes[S.stop] || []).filter((r) => !S.hidden.has(r));
  let h = `<div class="muted" style="padding:2px 0 6px">${rs.map(chip).join(" ")}</div>`;
  h += a.length ? `<div>${a.map(arrivalRow).join("")}</div>` : '<div class="empty"><b>No upcoming arrivals</b>Nothing is predicted at this stop right now.</div>';
  return h + `<p class="foot">${S.lastOk ? "Updated " + Math.max(0, Math.round(now() - S.lastOk)) + "s ago" : ""}</p>`;
}
const EYE = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYEOFF = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z" opacity=".45"/><circle cx="12" cy="12" r="3" opacity=".45"/><path d="M3 3l18 18"/></svg>';
const filterChipHTML = () => (S.routeFilter ? `<div class="fchip"><span>Routes to ${esc(S.filterName)}</span><button data-clearfilter aria-label="Clear station filter, show all routes">&times;</button></div>` : "");
function viewRoutes() {
  let ids = Object.keys(S.routes).sort((a, b) => String(S.routes[a].short).localeCompare(String(S.routes[b].short), undefined, { numeric: true }));
  if (!ids.length) return skeleton();
  if (S.routeFilter) ids = ids.filter((i) => S.routeFilter.has(i));
  const on = ids.filter((i) => !S.hidden.has(i)), off = ids.filter((i) => S.hidden.has(i));
  const run = on.filter((i) => runningCount(i)), idle = on.filter((i) => !runningCount(i));
  const row = (i) => { const hid = S.hidden.has(i), n = runningCount(i), nm = esc(S.routes[i].long);
    return `<div class="row${hid ? " off" : ""}"><button class="rowmain" data-route="${esc(i)}">${chip(i)}<div class="grow"><span class="prim">${nm}</span><span class="sec">${hid ? "Hidden from map and times" : n ? n + (n > 1 ? " buses" : " bus") + " running" : "Not running"}</span></div></button><button class="eye" data-toggle="${esc(i)}" aria-pressed="${!hid}" aria-label="${hid ? "Show" : "Hide"} route ${esc(rname(i))}, ${nm}">${hid ? EYEOFF : EYE}</button></div>`; };
  return `<div class="actions"><button class="cta" id="btnPick">Routes to station&hellip;</button><button class="cta alt" id="btnDir">Directions</button></div>` + filterChipHTML()
    + (run.length ? "<h2>Running</h2>" + run.map(row).join("") : "") + (idle.length ? "<h2>Not running</h2>" + idle.map(row).join("") : "")
    + (off.length ? "<h2>Hidden</h2>" + off.map(row).join("") : "") + (ids.length ? "" : '<div class="empty"><b>No routes</b></div>');
}
function viewRoute() {
  const r = S.routes[S.route]; if (!r) return "";
  const ids = [...new Set(S.routeStops[S.route] || [])], n = runningCount(S.route), c = color(S.route);
  let h = `<p class="muted" style="margin:0 0 4px">${n ? n + (n > 1 ? " buses" : " bus") + " running" : "Not running right now"}</p><ul class="tl" style="--rc:${c}">`;
  h += ids.map((i) => { const a = arrivalsFor(i, S.route)[0]; return `<li><button class="grow" style="text-align:left;min-height:48px" data-stop="${esc(i)}"><span class="prim">${esc(S.stops[i]?.name || i)}</span></button><span class="t">${a ? Math.max(0, Math.floor((a.t - now()) / 60)) + " min" : ""}</span></li>`; }).join("");
  return h + "</ul>";
}
function viewAlerts() {
  const act = activeAlerts(), txt = (o) => o?.translation?.[0]?.text?.trim() || "";
  let h = act.length ? act.map((a) => `<div class="alert"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/></svg><div><span class="prim" style="white-space:normal">${esc(txt(a.header_text))}</span><p>${esc(txt(a.description_text))}</p></div></div>`).join("")
    : '<div class="empty"><b>No active alerts</b>Service changes will show up here.</div>';
  return h + '<button class="row" data-view="about"><div class="grow"><span class="prim">About this app</span></div></button>';
}
function viewAbout() {
  return `<div id="themeMount" style="margin-bottom:12px"></div><p><b>Straight Bussing is an unofficial student project.</b> It is not affiliated with or endorsed by the University or by Passio. Times are predictions and can be wrong.</p>
  <p>For safety or NightRide, use the official service: <a href="tel:7737028181">773.702.8181</a> or <a href="https://safety-security.uchicago.edu/Transportation" target="_blank" rel="noopener">the official transportation page</a>.</p>
  <p class="muted">Data: public Passio GTFS feeds. No ads, no account, no tracking. Your location, if you allow it, stays on your device.</p>
  <p class="muted">Directions: if you type a place or address, the text you type (and nothing else) is sent to <b>photon.komoot.io</b> (OpenStreetMap geocoder) to find it. Station names are searched on your device. Bus times in Directions are estimates.</p>`;
}
const activeAlerts = () => S.alerts.filter((a) => !(a.active_period || []).length || a.active_period.some((w) => (!w.start || w.start <= now()) && (!w.end || w.end >= now())));

/* ---------- render ---------- */
function render() {
  const c = $("content"), top = c.scrollTop, v = S.view;
  const titles = { nearby: "Nearby", routes: "Routes", alerts: "Alerts", about: "About", stop: S.stops[S.stop]?.name, route: S.routes[S.route]?.long, pick: "Routes to station", dir: "Directions" };
  const sub = SUB.includes(v), stat = v === "pick" || v === "dir";
  $("title").textContent = titles[v] || ""; $("title").classList.toggle("sm", sub);
  $("back").hidden = !sub;
  $("titleRight").textContent = v === "nearby" && S.user ? "" : "";
  $("seg").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.view === (sub ? S.prev || "nearby" : v)));
  if (stat) { if (c._built !== v) { c._built = v; c._html = null; c.innerHTML = v === "pick" ? buildPick() : buildDir(); c.scrollTop = 0; (v === "pick" ? bindPick : bindDir)(); } }
  else { c._built = null;
    const html = { nearby: viewNearby, stop: viewStop, routes: viewRoutes, route: viewRoute, alerts: viewAlerts, about: viewAbout }[v]();
    if (html !== c._html) { c._html = html; c.innerHTML = html; c.scrollTop = top; if (v === "about" && window.Theme && $("themeMount")) Theme.mount($("themeMount")); } }
  const fc = $("fchip"); fc.hidden = !S.routeFilter; fc.innerHTML = S.routeFilter ? filterChipHTML() : "";
  const n = activeAlerts().length; $("alertCount").hidden = !n; $("alertCount").textContent = n;
  if (v === "nearby" && S.loaded) { const s = nearest(1)[0], a = s && arrivalsFor(s.id)[0]; $("titleRight").textContent = a ? rname(a.rid) + " · " + Math.max(0, Math.floor((a.t - now()) / 60)) + " min" : ""; }
}
function renderStatus() {
  const p = $("pill"), st = staleness(); let msg = "";
  if (st === "err") msg = S.lastOk ? "Can't reach the shuttle feed. Retrying. Showing last known data." : "Can't reach the shuttle feed. Don't rely on this app; use the official service.";
  else if (st === "old") msg = "Live data is out of date. Times are approximate.";
  else if (st === "late") msg = "Live data delayed. Times may be off.";
  else if (S.loaded && !S.buses.length) msg = "No shuttles running right now.";
  p.hidden = !msg; p.textContent = msg; p.classList.toggle("err", st === "err");
}

function go(view, opts = {}) {
  if (SUB.includes(view)) S.prev = ["stop", "route", "pick", "dir"].includes(S.view) ? S.prev : S.view;
  S.view = view; $("content")._built = null;
  if (view !== "pick") pickLayer.clearLayers(); if (view !== "dir") dirLayer.clearLayers();
  if (view !== "stop" && view !== "route") { S.stop = view === "about" ? S.stop : null; }
  if (view !== "route") S.route = view === "about" ? S.route : null;
  drawStatic(); drawBuses(); $("content").scrollTop = 0; render(); if (opts.detent) setDetent(opts.detent);
}
function openStop(id) { if (S.view === "pick") return chooseStation(id); if (S.view === "dir") return dirPickStop(id); S.stop = id; S.route = null; go("stop", { detent: "half" }); const s = S.stops[id]; if (s) flyTo([s.lat, s.lon]); }
function openRoute(id) { S.route = id; S.stop = null; go("route", { detent: "half" });
  const pts = (S.shapes[id] || []).flat(); if (pts.length) map.fitBounds(L.latLngBounds(pts), { paddingBottomRight: [0, visHeight() ], paddingTopLeft: [0, 70], animate: true }); }
function flyTo(ll) { const z = Math.max(map.getZoom(), 16), p = map.project(ll, z).add([0, visHeight() / 2]); map.flyTo(map.unproject(p, z), z, { duration: 0.6 }); }
const visHeight = () => (matchMedia("(min-width:768px)").matches ? 0 : $("sheet").classList.contains("peek") ? $("pPeek").offsetHeight : $("pHalf").offsetHeight);
$("back").onclick = () => go(S.prev || "nearby");
$("fchip").onclick = (e) => { if (e.target.closest("[data-clearfilter]")) clearFilter(); };
$("seg").onclick = (e) => { const b = e.target.closest("button"); if (b) go(b.dataset.view); };
$("content").onclick = (e) => {
  const t = e.target.closest("[data-stop],[data-route],[data-view],[data-toggle],[data-clearfilter],[data-pickstop],[data-pickplace],[data-pickmode],[data-opt],[data-sug],#useLoc,#btnPick,#btnDir"); if (!t) return;
  if (t.id === "useLoc") return locate();
  if (t.id === "btnPick") return openDlg();
  if (t.id === "btnDir") return go("dir", { detent: "full" });
  if (t.dataset.toggle) return toggleRoute(t.dataset.toggle);
  if (t.hasAttribute("data-clearfilter")) return clearFilter();
  if (t.dataset.pickstop) return chooseStation(t.dataset.pickstop);
  if (t.dataset.pickplace) { const p = S.pick?.places?.[+t.dataset.pickplace]; if (p) { S.pick.anchor = p; $("content")._built = null; render(); } return; }
  if (t.dataset.pickmode) return startPick(t.dataset.pickmode);
  if (t.dataset.opt) return selectOpt(+t.dataset.opt);
  if (t.dataset.sug) return applySug(+t.dataset.sug);
  if (t.dataset.stop) openStop(t.dataset.stop); else if (t.dataset.route) openRoute(t.dataset.route); else if (t.dataset.view) go(t.dataset.view);
};

/* ---------- location ---------- */
let meMarker;
function locate(cb, fly = true) {
  if (!navigator.geolocation) { cb?.(false); return; }
  navigator.geolocation.getCurrentPosition((pos) => {
    S.user = { lat: pos.coords.latitude, lon: pos.coords.longitude }; S.locDenied = false;
    meMarker?.remove(); meMarker = L.marker([S.user.lat, S.user.lon], { icon: L.divIcon({ className: "", html: '<div class="me"></div>', iconSize: [14, 14] }), interactive: false, keyboard: false }).addTo(map);
    if (fly) map.flyTo([S.user.lat, S.user.lon], 16, { duration: 0.6 }); if (S.view === "nearby") render(); cb?.(true);
  }, () => { S.locDenied = true; render(); cb?.(false); }, { enableHighAccuracy: true, timeout: 8000 });
}
$("locateBtn").onclick = () => locate();

/* ---------- bottom sheet ---------- */
const sheet = $("sheet"), DET = ["peek", "half", "full"];
let detent = "half";
function setDetent(d) { detent = d; sheet.classList.remove(...DET); sheet.classList.add(d); $("grab").setAttribute("aria-expanded", d !== "peek"); }
(function initSheet() {
  const head = $("sheetHead"); let y0 = 0, startVis = 0, t0 = 0, lastY = 0, lastT = 0, v = 0, active = false, sizes;
  const measure = () => ({ peek: $("pPeek").offsetHeight, half: $("pHalf").offsetHeight, full: $("pFull").offsetHeight });
  head.addEventListener("pointerdown", (e) => {
    if (matchMedia("(min-width:768px)").matches || e.target.closest("button:not(#grab)")) return;
    active = true; sizes = measure(); startVis = sizes[detent]; y0 = lastY = e.clientY; t0 = lastT = performance.now(); v = 0;
    head.setPointerCapture(e.pointerId); sheet.classList.add("dragging");
  });
  head.addEventListener("pointermove", (e) => {
    if (!active) return;
    const vis = startVis - (e.clientY - y0);
    const over = vis > sizes.full ? (vis - sizes.full) * 0.7 : vis < sizes.peek ? (vis - sizes.peek) * 0.7 : 0;
    sheet.style.setProperty("--drag", e.clientY - y0 + over + "px");
    const t = performance.now(); v = (e.clientY - lastY) / Math.max(1, t - lastT); lastY = e.clientY; lastT = t;
  });
  const end = (e) => {
    if (!active) return; active = false; sheet.classList.remove("dragging"); sheet.style.removeProperty("--drag");
    if (e.type === "pointercancel") return;
    const dy = e.clientY - y0, moved = Math.abs(dy) > 6;
    if (!moved) { if (detent === "peek") setDetent("half"); return; }
    const proj = startVis - dy - v * 200; // v>0 means moving down
    let best = "half"; let bd = 1e9;
    for (const d of DET) { const dd = Math.abs(sizes[d] - proj); if (dd < bd) { bd = dd; best = d; } }
    if (Math.abs(v) > 0.5) { const i = DET.indexOf(detent) + (v < 0 ? 1 : -1); best = DET[Math.max(0, Math.min(2, i))]; }
    setDetent(best);
  };
  head.addEventListener("pointerup", end); head.addEventListener("pointercancel", end);
  $("grab").addEventListener("keydown", (e) => { if (e.key === "ArrowUp") setDetent(DET[Math.min(2, DET.indexOf(detent) + 1)]); if (e.key === "ArrowDown") setDetent(DET[Math.max(0, DET.indexOf(detent) - 1)]); });
  $("grab").addEventListener("click", (e) => { if (e.detail === 0) setDetent(detent === "full" ? "half" : detent === "half" ? "peek" : "half"); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { if (detent === "full") setDetent("half"); else if (SUB.includes(S.view)) go(S.prev || "nearby"); } });
})();

matchMedia("(min-width:768px)").addEventListener?.("change", (e) => { if (e.matches) setDetent("half"); });

/* ---------- route filter, hide toggle, station picker ---------- */
function toggleRoute(rid) {
  if (S.hidden.has(rid)) S.hidden.delete(rid); else S.hidden.add(rid);
  saveHidden(); drawStatic(); drawBuses(); render();
}
function clearFilter() { S.routeFilter = null; S.filterName = ""; drawStatic(); drawBuses(); render(); }
function openDlg() { $("dlg").hidden = false; $("dlgLoc").focus(); }
function closeDlg() { $("dlg").hidden = true; }
$("dlg").addEventListener("click", (e) => {
  if (e.target === $("dlg") || e.target.id === "dlgCancel") { closeDlg(); $("btnPick")?.focus(); }
  else if (e.target.id === "dlgLoc") startPick("loc"); else if (e.target.id === "dlgSel") startPick("sel"); else if (e.target.id === "dlgAddr") startPick("addr");
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("dlg").hidden) { closeDlg(); e.stopImmediatePropagation(); } }, true);
function startPick(mode) {
  closeDlg(); S.pick = { mode, q: "", locState: "" };
  if (mode === "loc") {
    if (S.user) { go("pick", { detent: "half" }); return; }
    S.pick.locState = "wait"; go("pick", { detent: "half" });
    locate((ok) => { if (S.view !== "pick" || S.pick?.mode !== "loc") return; S.pick.locState = ok ? "" : "denied"; $("content")._built = null; render(); }, false);
  } else go("pick", { detent: "half" });
}
function pickItems() {
  const P = S.pick || {};
  if (P.mode === "addr") {
    if (!P.anchor) return [];
    return Object.entries(S.stops).map(([id, s]) => ({ id, ...s, d: hav(P.anchor, s) })).filter((s) => s.d <= 1500 && (S.stopRoutes[s.id] || []).length).sort((a, b) => a.d - b.d).slice(0, 5);
  }
  if (P.mode === "loc") {
    if (!S.user) return [];
    return Object.entries(S.stops).map(([id, s]) => ({ id, ...s, d: hav(S.user, s) })).filter((s) => s.d <= 1500 && (S.stopRoutes[s.id] || []).length).sort((a, b) => a.d - b.d).slice(0, 5);
  }
  const q = (P.q || "").trim().toLowerCase();
  return Object.entries(S.stops).filter(([id, s]) => (S.stopRoutes[id] || []).length && (!q || s.name.toLowerCase().includes(q)))
    .map(([id, s]) => ({ id, ...s, d: S.user ? hav(S.user, s) : null })).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).slice(0, 40);
}
function pickListHTML() {
  const P = S.pick || {}, items = pickItems();
  if (P.mode === "addr" && !P.anchor) {
    const q = (P.q || "").trim();
    if (q.length < 3) return '<div class="empty">Type at least 3 letters of an address, building or place.</div>';
    if (P.placeState === "busy") return '<div class="empty">Searching places&hellip;</div>';
    if (P.placeState === "err") return '<div class="empty"><b>Could not search places right now</b>Try again, or select a station by name.</div><button class="cta" data-pickmode="sel">Select a station</button>';
    return (P.places || []).length ? '<div class="card">' + P.places.map((p, i) => `<button class="row" data-pickplace="${i}"><div class="grow"><span class="prim">${esc(p.label)}</span><span class="sec">${esc(p.sub)}</span></div></button>`).join("") + "</div>" : '<div class="empty"><b>No places found</b>Check the spelling or try a nearby landmark.</div>';
  }
  if (P.mode === "addr" && P.anchor && !items.length) return `<div class="empty"><b>No stops within 1.5 km of ${esc(P.anchor.label)}</b>Try another place or select a station.</div><button class="cta" data-pickmode="addr">Search another place</button>`;
  if (P.mode === "loc" && P.locState === "wait") return '<div class="empty">Finding your location&hellip;</div>';
  if (P.mode === "loc" && !S.user) return '<div class="empty"><b>Location unavailable</b>You can still choose without sharing location.</div><button class="cta" data-pickmode="sel">Select a station</button><button class="cta alt" data-pickmode="addr">Type an address or place</button>';
  if (!items.length) return `<div class="empty"><b>${P.mode === "loc" ? "No stops within 1.5 km" : "No matching stations"}</b>${P.mode === "loc" ? "Try selecting a station by name." : "Check the spelling."}</div>${P.mode === "loc" ? '<button class="cta" data-pickmode="sel">Select a station</button>' : ""}`;
  return '<div class="card">' + items.map((s) => `<button class="row" data-pickstop="${esc(s.id)}"><div class="grow"><span class="prim">${esc(s.name)}</span><span class="sec">${s.d != null ? walkMin(s.d) + " min walk · " + Math.round(s.d) + " m · " : ""}${(S.stopRoutes[s.id] || []).map((r) => esc(rname(r))).join(", ")}</span></div></button>`).join("") + "</div>";
}
function highlightPick() {
  pickLayer.clearLayers(); const items = pickItems(), pts = [];
  if (S.view !== "pick" || !items.length || (S.pick.mode === "loc" && !S.user)) return;
  if (S.pick.mode === "addr" && S.pick.anchor) pts.push([S.pick.anchor.lat, S.pick.anchor.lon]);
  const acc = dark.matches ? "#409cff" : "#0a84ff";
  for (const s of items.slice(0, S.pick.mode === "loc" ? 5 : 12)) {
    pts.push([s.lat, s.lon]);
    L.circleMarker([s.lat, s.lon], { radius: 11, color: acc, weight: 3, fillColor: acc, fillOpacity: 0.25 }).on("click", () => chooseStation(s.id)).addTo(pickLayer);
  }
  if (S.pick.mode === "loc" && S.user) pts.push([S.user.lat, S.user.lon]);
  if (pts.length && (S.pick.mode === "loc" || S.pick.mode === "addr" || S.pick.q)) map.fitBounds(L.latLngBounds(pts), { paddingBottomRight: [0, visHeight()], paddingTopLeft: [0, 70], maxZoom: 17, animate: true });
}
function buildPick() {
  const P = S.pick || (S.pick = { mode: "sel", q: "" });
  return (P.mode === "addr" && P.anchor ? `<p class="muted" style="margin:4px 0">Stops within 1.5 km of <b>${esc(P.anchor.label)}</b>. Tap one to see its routes. <button class="small" data-pickmode="addr">Change</button></p>`
    : P.mode === "addr" ? '<label class="srch"><span class="sr">Search address or place</span><input id="pickQ" type="search" inputmode="search" autocomplete="off" spellcheck="false" placeholder="Address, building or place" aria-label="Address or place"></label><p class="foot" style="margin:6px 0">The text you type is sent to photon.komoot.io to find the place. Nothing else is sent.</p>'
    : P.mode === "sel" ? '<label class="srch"><span class="sr">Search stations</span><input id="pickQ" type="search" inputmode="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Search station name" aria-label="Search station name"></label>'
    : '<p class="muted" style="margin:4px 0">Nearest stops within 1.5 km. Tap one to see its routes.</p>') + '<div id="pickList">' + pickListHTML() + "</div>";
}
function bindPick() {
  const q = $("pickQ");
  if (q && S.pick.mode === "addr") { q.value = S.pick.q || ""; q.oninput = () => { S.pick.q = q.value; searchPlaces(q.value.trim()); }; q.focus({ preventScroll: true }); }
  else if (q) { q.oninput = () => { S.pick.q = q.value; $("pickList").innerHTML = pickListHTML(); highlightPick(); }; q.focus({ preventScroll: true }); }
  highlightPick();
}
let placeTimer = 0, placeCtl = null;
function searchPlaces(q) {
  const P = S.pick; clearTimeout(placeTimer); placeCtl?.abort();
  const draw = () => { const l = $("pickList"); if (l && S.view === "pick" && S.pick === P) l.innerHTML = pickListHTML(); };
  if (q.length < 3) { P.placeState = ""; P.places = []; draw(); return; }
  P.placeState = "busy"; draw();
  placeTimer = setTimeout(async () => {
    placeCtl = new AbortController();
    try {
      const r = await fetch("https://photon.komoot.io/api/?q=" + encodeURIComponent(q) + "&limit=5&lat=41.79&lon=-87.60&lang=en", { signal: placeCtl.signal });
      if (!r.ok) throw new Error(r.status);
      const j = await r.json();
      P.places = (j.features || []).filter((f) => f.geometry?.coordinates).map((f) => { const p = f.properties || {};
        const line = [p.street ? (p.housenumber ? p.housenumber + " " : "") + p.street : "", p.city || p.county, p.state].filter(Boolean).join(", ");
        return { lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], label: p.name || line || q, sub: p.name ? line : "Place" }; });
      P.placeState = "";
    } catch (e) { if (e.name === "AbortError") return; P.placeState = "err"; }
    draw();
  }, 400);
}
function chooseStation(id) {
  const rs = S.stopRoutes[id] || []; if (!rs.length) return;
  S.routeFilter = new Set(rs); S.filterName = S.stops[id]?.name || "station"; pickLayer.clearLayers();
  go("routes", { detent: "half" });
  const pts = rs.flatMap((r) => (S.shapes[r] || []).flat()); if (pts.length) map.fitBounds(L.latLngBounds(pts), { paddingBottomRight: [0, visHeight()], paddingTopLeft: [0, 70], animate: true });
}

/* ---------- directions ---------- */
const NOTE = "Bus times are estimates from schedules and live predictions. They will get more accurate as we collect more ride data.";
const SRC = { learned: "learned from past rides", schedule: "from schedule", estimate: "distance estimate" };
const clock = (t) => new Date(t * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const D = S.dir; let dirField = "to", sugList = [], photonCtl = null, photonTimer = 0, photonState = "", photonRes = { q: "", items: [] };
function buildDir() {
  if (!D.from && S.user) D.from = { lat: S.user.lat, lon: S.user.lon, label: "My location", me: true };
  return `<div class="dirbox"><div class="dfield"><span class="pin a" aria-hidden="true"></span><input id="dfrom" type="text" autocomplete="off" spellcheck="false" placeholder="Start" aria-label="Start: station or place" value="${esc(D.from?.label || "")}"></div>
  <div class="dfield"><span class="pin b" aria-hidden="true"></span><input id="dto" type="text" autocomplete="off" spellcheck="false" placeholder="Destination" aria-label="Destination: station or place" value="${esc(D.to?.label || "")}"></div>
  <button id="dswap" class="dswap" aria-label="Swap start and destination"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3"/></svg></button></div>
  <div id="dsug" role="listbox" aria-label="Suggestions"></div><div id="dres" aria-live="polite"></div>`;
}
function bindDir() {
  const f = $("dfrom"), t = $("dto");
  for (const [el, key] of [[f, "from"], [t, "to"]]) {
    el.onfocus = () => { dirField = key; el.select?.(); renderSug(el.value); };
    el.oninput = () => { dirField = key; D[key] = null; D.opts = null; renderSug(el.value); renderRes(); dirDraw(false); };
    el.onkeydown = (e) => { if (e.key === "Enter" && sugList[0]) { e.preventDefault(); applySug(0); } };
  }
  $("dswap").onclick = () => { [D.from, D.to] = [D.to, D.from]; f.value = D.from?.label || ""; t.value = D.to?.label || ""; sugList = []; $("dsug").innerHTML = ""; dirPlan(true); };
  if (!D.from) renderSug(""); dirPlan(true);
  if (D.from && !D.to) t.focus({ preventScroll: true });
  else if (!D.from && !S.user && navigator.permissions?.query) navigator.permissions.query({ name: "geolocation" }).then((p) => { if (p.state === "granted") useMyLocation("from"); }).catch(() => {});
}
function localMatches(q) {
  q = q.trim().toLowerCase(); if (!q) return [];
  return Object.entries(S.stops).filter(([id, s]) => s.name.toLowerCase().includes(q)).sort((a, b) => a[1].name.localeCompare(b[1].name, undefined, { numeric: true })).slice(0, 5)
    .map(([id, s]) => ({ kind: "stop", id, lat: s.lat, lon: s.lon, label: s.name, sub: "Shuttle stop · " + (S.stopRoutes[id] || []).map(rname).join(", ") }));
}
function renderSug(q) {
  q = q || ""; const el = $("dsug"); if (!el) return;
  const cur = D[dirField]; sugList = [];
  if (!cur || q !== cur.label) {
    if (!q.trim() || "my location".startsWith(q.trim().toLowerCase())) sugList.push({ kind: "me", label: "My location", sub: S.user ? "Use current location" : "Allow location access" });
    sugList.push(...localMatches(q));
    if (photonState === "res:" && photonRes.q === q.trim()) sugList.push(...photonRes.items);
  }
  let h = sugList.map((s, i) => `<button class="row sug" role="option" data-sug="${i}"><div class="grow"><span class="prim">${esc(s.label)}</span><span class="sec">${esc(s.sub || "")}</span></div></button>`).join("");
  if (photonState === "busy" && q.trim().length >= 3) h += '<p class="foot" style="margin:6px 0">Searching places&hellip;</p>';
  if (photonState === "err" && q.trim().length >= 3) h += '<p class="foot" style="margin:6px 0">Couldn\'t search places right now. Station names still work.</p>';
  if (D.meDenied) h += '<p class="foot" style="margin:6px 0">Location is off. Enable it in your browser settings, or type a start.</p>';
  el.innerHTML = h;
  schedulePhoton(q);
}
function schedulePhoton(q) {
  clearTimeout(photonTimer); q = (q || "").trim();
  if (q.length < 3 || (D[dirField] && D[dirField].label === q)) { photonState = ""; return; }
  if (photonRes.q === q) { photonState = "res:"; return; }
  photonState = "busy";
  photonTimer = setTimeout(async () => {
    photonCtl?.abort(); photonCtl = new AbortController();
    try { // only the typed text is sent
      const r = await fetch("https://photon.komoot.io/api/?q=" + encodeURIComponent(q) + "&limit=5&lat=41.79&lon=-87.60&lang=en", { signal: photonCtl.signal });
      if (!r.ok) throw new Error(r.status);
      const j = await r.json();
      photonRes = { q, items: (j.features || []).filter((f) => f.geometry?.coordinates).map((f) => { const p = f.properties || {};
        const line = [p.street ? (p.housenumber ? p.housenumber + " " : "") + p.street : "", p.city || p.county, p.state].filter(Boolean).join(", ");
        return { kind: "place", lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], label: p.name || line || q, sub: p.name ? line : "Place" }; }) };
      photonState = "res:";
    } catch (e) { if (e.name === "AbortError") return; photonState = "err"; }
    const el = $(dirField === "from" ? "dfrom" : "dto"); if (S.view === "dir" && el && el.value.trim() === q) renderSug(el.value);
  }, 400);
}
function useMyLocation(key) {
  const set = () => { D[key] = { lat: S.user.lat, lon: S.user.lon, label: "My location", me: true }; D.meDenied = false; const el = $(key === "from" ? "dfrom" : "dto"); if (el) el.value = "My location"; if ($("dsug")) $("dsug").innerHTML = ""; dirPlan(true); };
  if (S.user) return set();
  locate((ok) => { if (S.view !== "dir") return; if (ok) set(); else { D.meDenied = true; renderSug($(key === "from" ? "dfrom" : "dto").value); } }, false);
}
function applySug(i) {
  const s = sugList[i]; if (!s) return; const key = dirField;
  if (s.kind === "me") return useMyLocation(key);
  D[key] = { lat: s.lat, lon: s.lon, label: s.label, stop: s.kind === "stop" ? s.id : null };
  const el = $(key === "from" ? "dfrom" : "dto"); if (el) el.value = s.label;
  sugList = []; $("dsug").innerHTML = ""; photonState = "";
  dirPlan(true);
  if (!D.to) $("dto")?.focus({ preventScroll: true }); else if (!D.from) $("dfrom")?.focus({ preventScroll: true }); else document.activeElement?.blur?.();
}
function dirPickStop(id) { const s = S.stops[id]; if (!s) return; sugList = [{ kind: "stop", id, lat: s.lat, lon: s.lon, label: s.name }]; dirField = D.from ? "to" : "from"; applySug(0); }
function selectOpt(i) { D.sel = i; D.selKey = D.opts?.options[i]?.key; renderRes(); dirDraw(true); }
function dirPlan(fresh) {
  if (!D.from || !D.to) { D.opts = null; renderRes(); dirDraw(false); return; }
  if (!S.loaded) { renderRes(); return; }
  if (!window.Planner) { D.opts = { options: [], walkOnly: { min: 0, m: 0 }, err: true }; renderRes(); return; }
  D.opts = Planner.plan({ from: D.from, to: D.to, now: now(), data: { stops: S.stops, routes: S.routes, routeStops: S.routeStops, trips: S.trips, buses: S.buses } });
  const o = D.opts.options; let k = fresh ? -1 : o.findIndex((x) => x.key === D.selKey);
  if (k < 0) k = o.length ? 0 : -1; const changed = k !== D.sel || o[k]?.key !== D.selKey; D.sel = k; D.selKey = o[k]?.key;
  renderRes(); if (fresh || changed) dirDraw(fresh);
}
const bold = (t) => `<b>${esc(t)}</b>`;
function stepsHTML(o) {
  const li = (ic, h) => `<li><span class="si">${ic}</span><span>${h}</span></li>`;
  return '<ol class="steps">' + o.legs.map((l) => {
    if (l.type === "walk") return li("&#128694;", `Walk ${Math.max(1, Math.round(l.min))} min (${l.m} m) to ${bold(l.to.name)}`);
    const w = Math.round(l.wait), r = Math.max(1, Math.round(l.ride));
    return li(chip(l.rid), `Board at ${bold(l.board.name)}<br><span class="muted">Wait ~${w < 1 ? "&lt;1" : w} min <span class="est">${l.waitLive ? "live" : "est."}</span></span><br><span class="muted">Ride ~${r} min <span class="est">est.</span> to ${esc(l.alight.name)} · ${l.stopsPassed} stop${l.stopsPassed > 1 ? "s" : ""} · ${esc(SRC[l.source] || l.source)}</span>`);
  }).join("") + "</ol>";
}
function renderRes() {
  const el = $("dres"); if (!el) return; let h = "";
  if (!D.from || !D.to) h = '<p class="muted" style="margin:12px 0">Choose a start and a destination. Type a station name, a place, or an address.</p>';
  else if (!S.loaded) h = skeleton();
  else if (D.opts?.err) h = '<div class="empty"><b>Planner unavailable</b>Reload the app.</div>';
  else if (D.opts) {
    const o = D.opts.options, w = D.opts.walkOnly;
    if (!o.length) h = `<div class="empty"><b>No practical shuttle route right now</b>${S.buses.length ? "Nothing runs close enough to both places." : "No shuttles are running."}</div><div class="card"><div class="row"><div class="grow"><span class="prim">Walk ${w.min} min</span><span class="sec">${w.m} m</span></div></div></div>`;
    else {
      h = o.map((x, i) => { const on = i === D.sel;
        const sum = x.legs.map((l) => l.type === "walk" ? `<span class="wk">Walk ${Math.max(1, Math.round(l.min))}</span>` : chip(l.rid)).join('<span class="arr">&rsaquo;</span>');
        return `<div class="opt${on ? " on" : ""}"><button class="optmain" data-opt="${i}" aria-pressed="${on}" aria-label="Option ${i + 1}: about ${x.totalMin} minutes, arrive ${esc(clock(x.arrive))}. Estimate."><div class="otop"><span class="otot">~${x.totalMin}<small> min</small> <span class="est">est.</span></span><span class="oarr">Arrive ${esc(clock(x.arrive))}</span></div><div class="osum">${sum}</div></button>${on ? stepsHTML(x) : ""}</div>`; }).join("");
      h += `<p class="foot">Walking the whole way: ${w.min} min (${w.m} m).</p><p class="foot note">${esc(NOTE)}</p>`;
    }
  }
  if (el._h !== h) { el._h = h; el.innerHTML = h; }
}
function dirDraw(fit) {
  dirLayer.clearLayers(); if (S.view !== "dir") return;
  const pts = [], acc = dark.matches ? "#409cff" : "#0a84ff";
  const dot = (p, c) => { pts.push([p.lat, p.lon]); L.circleMarker([p.lat, p.lon], { radius: 8, color: "#fff", weight: 3, fillColor: c, fillOpacity: 1, interactive: false }).addTo(dirLayer); };
  if (D.from) dot(D.from, "#1e9e4a"); if (D.to) dot(D.to, "#c4291c");
  const o = D.opts?.options[D.sel];
  if (o) for (const l of o.legs) {
    if (l.type === "walk") L.polyline([[l.from.lat, l.from.lon], [l.to.lat, l.to.lon]], { color: acc, weight: 4, dashArray: "2 8", lineCap: "round", interactive: false }).addTo(dirLayer);
    else { const ll = l.path.map((p) => [p.lat, p.lon]); pts.push(...ll);
      L.polyline(ll, { color: "#fff", weight: 9, opacity: 0.9, lineCap: "round", lineJoin: "round", interactive: false }).addTo(dirLayer);
      L.polyline(ll, { color: color(l.rid), weight: 6, lineCap: "round", lineJoin: "round", interactive: false }).addTo(dirLayer);
      for (const p of [l.board, l.alight]) L.circleMarker([p.lat, p.lon], { radius: 6, color: color(l.rid), weight: 3, fillColor: "#fff", fillOpacity: 1, interactive: false }).addTo(dirLayer); }
  } else if (D.from && D.to && D.opts && !D.opts.options.length) L.polyline([[D.from.lat, D.from.lon], [D.to.lat, D.to.lon]], { color: acc, weight: 4, dashArray: "2 8", lineCap: "round", interactive: false }).addTo(dirLayer);
  if (fit && pts.length > 1) map.fitBounds(L.latLngBounds(pts), { paddingBottomRight: [0, visHeight()], paddingTopLeft: [0, 70], maxZoom: 17, animate: true });
}

/* ---------- boot ---------- */
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
map.on("zoomend", () => { if (S.shapes && Object.keys(S.shapes).length) drawStatic(); });
render();
loadStatic().then(() => { poll(); setInterval(poll, POLL_MS); setInterval(() => { renderStatus(); render(); }, 15000); });
document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
