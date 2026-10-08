"use strict";
const BASE = "https://passio3.com/chicago/passioTransit/gtfs/realtime/";
const POLL_MS = 10000, STALE_BUS_S = 60, DELAY_S = 120, OLD_S = 300;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeColor = (c) => (/^#[0-9a-fA-F]{6}$/.test(c || "") ? c : "#555555");
const now = () => Date.now() / 1000;

if (!window.L) { document.getElementById("pill").hidden = false; document.getElementById("pill").className = "statuspill err"; document.getElementById("pill").textContent = "Couldn't load the map. Check your connection and reload."; throw new Error("Leaflet not loaded"); }
const S = { routes: {}, stops: {}, shapes: {}, routeStops: {}, stopRoutes: {}, buses: [], trips: [], alerts: [],
  view: "nearby", prev: null, stop: null, route: null, user: null, lastOk: 0, feedTs: 0, loaded: false, failed: false };

/* ---------- color helpers ---------- */
function lum(hex) { const n = parseInt(hex.slice(1), 16); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(n >> 16) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255); }
const textOn = (hex) => (lum(hex) > 0.45 ? "#111114" : "#fff");
const color = (rid) => safeColor(S.routes[rid]?.color);
const rname = (rid) => S.routes[rid]?.short || S.routes[rid]?.long || "?";
const chip = (rid) => { const c = color(rid); const low = lum(c) > 0.8 || lum(c) < 0.02;
  return `<span class="chip${low ? " ring" : ""}" style="background:${c};color:${textOn(c)}">${esc(rname(rid))}</span>`; };

/* ---------- map ---------- */
const dark = matchMedia("(prefers-color-scheme: dark)");
const map = L.map("map", { zoomControl: false, minZoom: 12, maxZoom: 18 }).setView([41.7897, -87.5997], 15);
let tiles;
function setTiles() {
  if (tiles) map.removeLayer(tiles);
  const attr = '&copy; <a href="https://openfreemap.org">OpenFreeMap</a> &copy; OpenMapTiles &copy; OpenStreetMap contributors';
  tiles = window.maplibregl && L.maplibreGL
    ? L.maplibreGL({ style: "https://tiles.openfreemap.org/styles/" + (dark.matches ? "dark" : "positron"), attribution: attr })
    : L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" });
  tiles.addTo(map);
}
setTiles(); dark.addEventListener?.("change", setTiles);
map.attributionControl.setPosition("topleft");
map.createPane("casing").style.zIndex = 380; map.createPane("lines").style.zIndex = 390;
const lineLayer = L.layerGroup().addTo(map), stopLayer = L.layerGroup().addTo(map), selLayer = L.layerGroup().addTo(map), busLayer = L.layerGroup().addTo(map);
map.on("zoomstart", () => $("map").classList.add("nogl")); map.on("zoomend", () => { $("map").classList.remove("nogl"); toggleStops(); });
const toggleStops = () => { const on = map.getZoom() >= 14; if (on && !map.hasLayer(stopLayer)) stopLayer.addTo(map); if (!on) map.removeLayer(stopLayer); };

function drawStatic() {
  lineLayer.clearLayers(); stopLayer.clearLayers();
  const sel = S.route, w = map.getZoom() >= 17 ? 6 : map.getZoom() >= 15 ? 5 : 4, cs = dark.matches ? "rgba(28,28,30,.9)" : "rgba(255,255,255,.9)";
  const order = Object.keys(S.shapes).sort((a, b) => (a === sel) - (b === sel));
  for (const rid of order) {
    const dim = sel && rid !== sel, op = dim ? 0.25 : 0.9;
    for (const pts of S.shapes[rid]) {
      L.polyline(pts, { color: cs, weight: w + 3, opacity: dim ? 0.2 : 1, pane: "casing", lineCap: "round", lineJoin: "round", interactive: false }).addTo(lineLayer);
      L.polyline(pts, { color: color(rid), weight: w, opacity: op, pane: "lines", lineCap: "round", lineJoin: "round", interactive: false }).addTo(lineLayer);
    }
  }
  for (const [id, st] of Object.entries(S.stops)) {
    const rs = S.stopRoutes[id] || []; if (sel && !rs.includes(sel)) continue;
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
  drawBuses(); renderStatus(); render();
}

/* ---------- derived ---------- */
const staleness = () => (!S.lastOk ? "err" : now() - S.lastOk > 60 || S.failed ? "err" : S.feedTs && now() - S.feedTs > OLD_S ? "old" : S.feedTs && now() - S.feedTs > DELAY_S ? "late" : "");
function arrivalsFor(stopId, rid) {
  const t0 = now(), out = [];
  for (const tu of S.trips) {
    const r = tu.trip?.route_id; if (rid && r !== rid) continue;
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
const nearest = (n) => (S.user ? Object.entries(S.stops).map(([id, s]) => ({ id, ...s, d: hav(S.user, s) })).filter((s) => s.d < 5000).sort((a, b) => a.d - b.d).slice(0, n) : []);
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
  const a = arrivalsFor(S.stop).slice(0, 10), rs = (S.stopRoutes[S.stop] || []);
  let h = `<div class="muted" style="padding:2px 0 6px">${rs.map(chip).join(" ")}</div>`;
  h += a.length ? `<div>${a.map(arrivalRow).join("")}</div>` : '<div class="empty"><b>No upcoming arrivals</b>Nothing is predicted at this stop right now.</div>';
  return h + `<p class="foot">${S.lastOk ? "Updated " + Math.max(0, Math.round(now() - S.lastOk)) + "s ago" : ""}</p>`;
}
function viewRoutes() {
  const ids = Object.keys(S.routes).sort((a, b) => String(S.routes[a].short).localeCompare(String(S.routes[b].short), undefined, { numeric: true }));
  const run = ids.filter((i) => runningCount(i)), idle = ids.filter((i) => !runningCount(i));
  const row = (i) => `<button class="row" data-route="${esc(i)}">${chip(i)}<div class="grow"><span class="prim">${esc(S.routes[i].long)}</span><span class="sec">${runningCount(i) ? runningCount(i) + (runningCount(i) > 1 ? " buses" : " bus") + " running" : "Not running"}</span></div></button>`;
  return (run.length ? "<h2>Running</h2>" + run.map(row).join("") : "") + (idle.length ? "<h2>Not running</h2>" + idle.map(row).join("") : "") || skeleton();
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
  return `<p><b>Straight Bussing is an unofficial student project.</b> It is not affiliated with or endorsed by the University or by Passio. Times are predictions and can be wrong.</p>
  <p>For safety or NightRide, use the official service: <a href="tel:7737028181">773.702.8181</a> or <a href="https://safety-security.uchicago.edu/Transportation" target="_blank" rel="noopener">the official transportation page</a>.</p>
  <p class="muted">Data: public Passio GTFS feeds. No ads, no account, no tracking. Your location, if you allow it, stays on your device.</p>`;
}
const activeAlerts = () => S.alerts.filter((a) => !(a.active_period || []).length || a.active_period.some((w) => (!w.start || w.start <= now()) && (!w.end || w.end >= now())));

/* ---------- render ---------- */
function render() {
  const c = $("content"), top = c.scrollTop, v = S.view;
  const titles = { nearby: "Nearby", routes: "Routes", alerts: "Alerts", about: "About", stop: S.stops[S.stop]?.name, route: S.routes[S.route]?.long };
  const sub = v === "stop" || v === "route" || v === "about";
  $("title").textContent = titles[v] || ""; $("title").classList.toggle("sm", sub);
  $("back").hidden = !sub;
  $("titleRight").textContent = v === "nearby" && S.user ? "" : "";
  $("seg").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.view === (sub ? S.prev || "nearby" : v)));
  const html = { nearby: viewNearby, stop: viewStop, routes: viewRoutes, route: viewRoute, alerts: viewAlerts, about: viewAbout }[v]();
  if (html !== c._html) { c._html = html; c.innerHTML = html; c.scrollTop = top; }
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
  if (view === "stop" || view === "route" || view === "about") S.prev = S.view === "stop" || S.view === "route" ? S.prev : S.view;
  S.view = view;
  if (view !== "stop" && view !== "route") { S.stop = view === "about" ? S.stop : null; }
  if (view !== "route") S.route = view === "about" ? S.route : null;
  drawStatic(); drawBuses(); $("content").scrollTop = 0; render(); if (opts.detent) setDetent(opts.detent);
}
function openStop(id) { S.stop = id; S.route = null; go("stop", { detent: "half" }); const s = S.stops[id]; if (s) flyTo([s.lat, s.lon]); }
function openRoute(id) { S.route = id; S.stop = null; go("route", { detent: "half" });
  const pts = (S.shapes[id] || []).flat(); if (pts.length) map.fitBounds(L.latLngBounds(pts), { paddingBottomRight: [0, visHeight() ], paddingTopLeft: [0, 70], animate: true }); }
function flyTo(ll) { const z = Math.max(map.getZoom(), 16), p = map.project(ll, z).add([0, visHeight() / 2]); map.flyTo(map.unproject(p, z), z, { duration: 0.6 }); }
const visHeight = () => (matchMedia("(min-width:768px)").matches ? 0 : $("sheet").classList.contains("peek") ? $("pPeek").offsetHeight : $("pHalf").offsetHeight);
$("back").onclick = () => go(S.prev || "nearby");
$("seg").onclick = (e) => { const b = e.target.closest("button"); if (b) go(b.dataset.view); };
$("content").onclick = (e) => {
  const t = e.target.closest("[data-stop],[data-route],[data-view],#useLoc"); if (!t) return;
  if (t.id === "useLoc") return locate();
  if (t.dataset.stop) openStop(t.dataset.stop); else if (t.dataset.route) openRoute(t.dataset.route); else if (t.dataset.view) go(t.dataset.view);
};

/* ---------- location ---------- */
let meMarker;
function locate() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition((pos) => {
    S.user = { lat: pos.coords.latitude, lon: pos.coords.longitude }; S.locDenied = false;
    meMarker?.remove(); meMarker = L.marker([S.user.lat, S.user.lon], { icon: L.divIcon({ className: "", html: '<div class="me"></div>', iconSize: [14, 14] }), interactive: false, keyboard: false }).addTo(map);
    map.flyTo([S.user.lat, S.user.lon], 16, { duration: 0.6 }); if (S.view === "nearby") render();
  }, () => { S.locDenied = true; render(); }, { enableHighAccuracy: true, timeout: 8000 });
}
$("locateBtn").onclick = locate;

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
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { if (detent === "full") setDetent("half"); else if (S.view === "stop" || S.view === "route" || S.view === "about") go(S.prev || "nearby"); } });
})();

matchMedia("(min-width:768px)").addEventListener?.("change", (e) => { if (e.matches) setDetent("half"); });

/* ---------- boot ---------- */
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
map.on("zoomend", () => { if (S.shapes && Object.keys(S.shapes).length) drawStatic(); });
render();
loadStatic().then(() => { poll(); setInterval(poll, POLL_MS); setInterval(() => { renderStatus(); render(); }, 15000); });
document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
