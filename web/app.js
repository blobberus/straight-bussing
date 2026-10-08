"use strict";
const BASE = "https://passio3.com/chicago/passioTransit/gtfs/realtime/";
const POLL_MS = 10000, STALE_S = 60;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const S = { routes: {}, stops: {}, shapes: {}, routeStops: {}, buses: [], trips: [], alerts: [],
  hidden: new Set(JSON.parse(localStorage.getItem("hiddenRoutes") || "[]")),
  stop: localStorage.getItem("stop") || null, lastOk: 0, feedTs: 0, user: null };

const map = L.map("map", { zoomControl: false }).setView([41.7897, -87.5997], 14);
L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
  { maxZoom: 19, attribution: "&copy; OpenStreetMap &copy; CARTO" }).addTo(map);
const lineLayer = L.layerGroup().addTo(map), stopLayer = L.layerGroup().addTo(map), busLayer = L.layerGroup().addTo(map);
const busMarkers = new Map();

const color = (rid) => S.routes[rid]?.color || "#444444";
const rname = (rid) => S.routes[rid]?.short || S.routes[rid]?.long || "?";

async function loadStatic() {
  const get = (f) => fetch("data/" + f).then((r) => r.json());
  try {
    [S.routes, S.stops, S.shapes, S.routeStops] = await Promise.all(["routes", "stops", "shapes", "route_stops"].map(get));
    const m = await get("meta.json");
    $("meta").textContent = "Schedule data generated " + m.generated_utc;
  } catch (e) { console.warn("static data missing", e); }
  drawStatic(); renderRoutes();
}

function drawStatic() {
  lineLayer.clearLayers(); stopLayer.clearLayers();
  for (const [rid, lines] of Object.entries(S.shapes)) {
    if (S.hidden.has(rid)) continue;
    for (const pts of lines) L.polyline(pts, { color: color(rid), weight: 4, opacity: 0.7 }).addTo(lineLayer);
  }
  const shown = new Set();
  for (const [rid, ids] of Object.entries(S.routeStops)) if (!S.hidden.has(rid)) ids.forEach((i) => shown.add(i));
  for (const id of shown) {
    const st = S.stops[id]; if (!st) continue;
    L.marker([st.lat, st.lon], { icon: L.divIcon({ className: "", html: '<div class="stopdot" style="width:12px;height:12px"></div>', iconSize: [12, 12] }) })
      .on("click", () => selectStop(id)).addTo(stopLayer).bindTooltip(st.name);
  }
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
    S.lastOk = Date.now() / 1000;
  } catch (e) { console.warn("poll failed", e); }
  drawBuses(); renderArrivals(); renderAlerts(); renderBanner();
}

function drawBuses() {
  const seen = new Set();
  for (const v of S.buses) {
    const rid = v.trip?.route_id, id = v.vehicle?.id;
    if (!id || S.hidden.has(rid)) continue;
    seen.add(id);
    const c = color(rid), html = `<div class="bus" style="background:${c};color:${c}"><i style="transform:rotate(${v.position.bearing || 0}deg)"></i><span style="color:#fff">${esc(rname(rid)).slice(0, 3)}</span></div>`;
    const icon = L.divIcon({ className: "", html, iconSize: [30, 30], iconAnchor: [15, 15] });
    const ll = [v.position.latitude, v.position.longitude];
    let m = busMarkers.get(id);
    if (m) { m.setLatLng(ll); m.setIcon(icon); } else { m = L.marker(ll, { icon, zIndexOffset: 500 }).addTo(busLayer); busMarkers.set(id, m); }
  }
  for (const [id, m] of busMarkers) if (!seen.has(id)) { busLayer.removeLayer(m); busMarkers.delete(id); }
}

function renderBanner() {
  const b = $("banner"), now = Date.now() / 1000;
  let msg = "";
  if (!S.lastOk) msg = "Can't reach bus data. Don't rely on this app. Use the official shuttle service.";
  else if (now - S.lastOk > STALE_S) msg = "Live data is out of date. Don't rely on these positions.";
  else if (S.feedTs && now - S.feedTs > 120) msg = "The shuttle feed hasn't updated in " + Math.round((now - S.feedTs) / 60) + " min. Positions may be old.";
  else if (!S.buses.length) msg = "No shuttles reporting right now. Check the official service for schedules.";
  b.hidden = !msg; b.textContent = msg;
}

const fmtEta = (t) => { const m = Math.round((t - Date.now() / 1000) / 60); return m <= 0 ? "Now" : m + " min"; };

function arrivalsFor(stopId) {
  const now = Date.now() / 1000, out = [];
  for (const tu of S.trips) {
    const rid = tu.trip?.route_id;
    if (S.hidden.has(rid)) continue;
    for (const u of tu.stop_time_update || []) {
      if (u.stop_id !== stopId) continue;
      const t = u.arrival?.time || u.departure?.time;
      if (t && t > now - 30) out.push({ rid, t, bus: tu.vehicle?.label });
    }
  }
  return out.sort((a, b) => a.t - b.t).slice(0, 8);
}

function nearestStops(n) {
  if (!S.user) return [];
  const d = (s) => (s.lat - S.user.lat) ** 2 + ((s.lon - S.user.lon) * 0.75) ** 2;
  return Object.entries(S.stops).map(([id, s]) => ({ id, ...s, d: d(s) })).sort((a, b) => a.d - b.d).slice(0, n);
}

function renderArrivals() {
  const p = $("panel-arrivals");
  let h = "";
  if (S.stop && S.stops[S.stop]) {
    h += `<h3>${esc(S.stops[S.stop].name)}</h3>`;
    const a = arrivalsFor(S.stop);
    h += a.length ? a.map((x) => `<div class="row"><span class="chip" style="background:${color(x.rid)}">${esc(rname(x.rid))}</span><div class="grow"><b>${esc(S.routes[x.rid]?.long || "")}</b><span class="muted">Bus ${esc(x.bus || "")}</span></div><span class="eta">${fmtEta(x.t)}</span></div>`).join("")
      : '<p class="muted">No predicted arrivals here right now.</p>';
    h += '<p><button class="small" id="clearStop">Choose another stop</button></p>';
  } else {
    h += "<h3>Pick a stop</h3><p class=\"muted\">Tap a stop on the map, or use your location.</p>";
    const ns = nearestStops(6);
    if (ns.length) h += ns.map((s) => `<div class="row"><button class="stopbtn grow" data-stop="${esc(s.id)}"><b>${esc(s.name)}</b></button></div>`).join("");
    else h += '<p><button class="small" id="locate">Find stops near me</button></p>';
  }
  p.innerHTML = h;
  p.querySelectorAll("[data-stop]").forEach((el) => (el.onclick = () => selectStop(el.dataset.stop)));
  const cs = $("clearStop"); if (cs) cs.onclick = () => { S.stop = null; localStorage.removeItem("stop"); renderArrivals(); };
  const lc = $("locate"); if (lc) lc.onclick = locate;
}

function selectStop(id) {
  S.stop = id; localStorage.setItem("stop", id);
  switchTab("arrivals"); renderArrivals();
  const s = S.stops[id]; if (s) map.panTo([s.lat, s.lon]);
}

function renderRoutes() {
  const p = $("panel-routes");
  p.innerHTML = Object.entries(S.routes).sort((a, b) => String(a[1].short).localeCompare(String(b[1].short), undefined, { numeric: true }))
    .map(([id, r]) => `<label class="chk"><input type="checkbox" data-r="${esc(id)}" ${S.hidden.has(id) ? "" : "checked"}><span class="chip" style="background:${esc(r.color)}">${esc(r.short || "")}</span><span class="grow">${esc(r.long || "")}</span></label>`).join("") || '<p class="muted">Route data not loaded.</p>';
  p.querySelectorAll("input").forEach((el) => (el.onchange = () => {
    el.checked ? S.hidden.delete(el.dataset.r) : S.hidden.add(el.dataset.r);
    localStorage.setItem("hiddenRoutes", JSON.stringify([...S.hidden]));
    drawStatic(); drawBuses(); renderArrivals();
  }));
}

function renderAlerts() {
  const now = Date.now() / 1000;
  const act = S.alerts.filter((a) => !(a.active_period || []).length || a.active_period.some((w) => (!w.start || w.start <= now) && (!w.end || w.end >= now)));
  const txt = (o) => o?.translation?.[0]?.text?.trim() || "";
  $("panel-alerts").innerHTML = act.length ? act.map((a) => `<div class="alert"><b>${esc(txt(a.header_text))}</b>${esc(txt(a.description_text))}</div>`).join("") : '<p class="muted">No active alerts.</p>';
  const c = $("alertCount"); c.hidden = !act.length; c.textContent = act.length;
}

function locate() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition((pos) => {
    S.user = { lat: pos.coords.latitude, lon: pos.coords.longitude };
    L.circleMarker([S.user.lat, S.user.lon], { radius: 7, color: "#fff", weight: 2, fillColor: "#2563eb", fillOpacity: 1 }).addTo(map);
    renderArrivals();
  }, () => {}, { enableHighAccuracy: true, timeout: 8000 });
}

function switchTab(t) {
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === t));
  ["arrivals", "routes", "alerts", "about"].forEach((n) => ($("panel-" + n).hidden = n !== t));
}
document.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => switchTab(b.dataset.tab)));
$("grab").onclick = () => { const s = $("sheet"); s.className = "sheet" + (s.classList.contains("min") ? "" : s.classList.contains("max") ? " min" : " max"); };

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
loadStatic().then(() => { poll(); setInterval(poll, POLL_MS); setInterval(() => { renderBanner(); renderArrivals(); }, 15000); });
document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
