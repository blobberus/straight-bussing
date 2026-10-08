/*
 * e2e stubs: a CLASSIC script injected (by e2e.js) at the top of the real index.html inside the
 * test iframe, before Leaflet and js/main.js run. It replaces the outside world only:
 *   - navigator.geolocation (denied by default; set __e2e.geo = {lat, lon} to grant)
 *   - navigator.permissions (always 'prompt'), navigator.serviceWorker (no-op register)
 *   - fetch to passio3.com -> synthetic live feeds built from the real static data
 *     (set __e2e.feedFail = true to make every poll fail)
 *   - fetch to photon / walking routers -> rejected (views use stubbed deps, see e2e-expose.js)
 *   - console.error -> recorded in __e2e.errors (the e2e test asserts it stays empty)
 * Everything else (app modules, static data, CDN scripts, map tiles) is the real thing.
 */
(function () {
  "use strict";
  var w = window;
  var T = (w.__e2e = { feedFail: false, geo: "denied", polls: 0, errors: [], walkCalls: 0, placeCalls: 0 });

  var origError = console.error.bind(console);
  console.error = function () {
    var parts = [];
    for (var i = 0; i < arguments.length; i++) {
      var a = arguments[i];
      parts.push(a && a.stack ? String(a.stack).split("\n")[0] : String(a));
    }
    T.errors.push(parts.join(" "));
    origError.apply(null, arguments);
  };
  w.addEventListener("error", function (e) {
    if (e.target && e.target !== w) return;
    T.errors.push("uncaught: " + (e.message || e.error));
  });
  w.addEventListener("unhandledrejection", function (e) {
    T.errors.push("unhandled rejection: " + String(e.reason && (e.reason.message || e.reason)));
  });

  function def(obj, key, value) {
    try { Object.defineProperty(obj, key, { value: value, configurable: true }); } catch (e) { /* ignore */ }
  }
  def(navigator, "geolocation", {
    getCurrentPosition: function (ok, err) {
      setTimeout(function () {
        if (T.geo === "denied") { if (err) err({ code: 1, message: "User denied Geolocation (e2e stub)" }); }
        else ok({ coords: { latitude: T.geo.lat, longitude: T.geo.lon, accuracy: 12 }, timestamp: Date.now() });
      }, 20);
    },
    watchPosition: function () { return 1; },
    clearWatch: function () {},
  });
  def(navigator, "permissions", { query: function () { return Promise.resolve({ state: "prompt", addEventListener: function () {} }); } });
  def(navigator, "serviceWorker", { register: function () { return Promise.resolve({}); } });

  /* History: in a document.write()n iframe, a real history.back() traverses to the iframe's
     original about:blank entry (it unloads the app). Emulate same-document traversal instead,
     as it behaves on the real top-level page: pushState counts, back() fires popstate. */
  T.log = [];
  var depth = 0;
  history.pushState = function () { depth++; T.log.push("pushState"); };
  history.back = function () {
    T.log.push("back");
    if (depth > 0) { depth--; setTimeout(function () { w.dispatchEvent(new PopStateEvent("popstate", { state: null })); }, 0); }
  };
  w.addEventListener("popstate", function () { T.log.push("popstate"); });

  var realFetch = w.fetch.bind(w);
  function json(url) { return realFetch(url, { cache: "no-store" }).then(function (r) { return r.json(); }); }

  /* Fixture: the first 3 routes with >= 7 distinct stops; one bus each, arrivals every 2 min. */
  T.ready = Promise.all([json("data/route_stops.json"), json("data/stops.json")]).then(function (res) {
    var rs = res[0], stops = res[1];
    T.stops = stops;
    T.routes = [];
    Object.keys(rs).forEach(function (rid) {
      var uniq = [];
      (rs[rid] || []).forEach(function (s) { if (uniq.indexOf(s) < 0 && stops[s]) uniq.push(s); });
      if (uniq.length >= 7 && T.routes.length < 3) T.routes.push({ rid: rid, stops: uniq });
    });
    var r = T.routes[0];
    T.R = r.rid;
    T.A = r.stops[1];          // directions board stop (start place is ~200 m north of it)
    T.Dst = r.stops[4];        // directions destination stop
    T.S = r.stops[2];          // station picked in "Select a station"
    T.S2 = T.routes[1] ? T.routes[1].stops[3] : r.stops[5]; // anchor for "Type an address"
  });

  T.feed = function (name) {
    var now = Math.floor(Date.now() / 1000);
    var head = { gtfs_realtime_version: "2.0", timestamp: now };
    if (name === "vehiclePositions") {
      return { header: head, entity: T.routes.map(function (r, i) {
        var s0 = T.stops[r.stops[0]];
        return { id: "v" + i, vehicle: { vehicle: { id: "e2e" + i, label: String(901 + i) },
          position: { latitude: s0.lat, longitude: s0.lon, bearing: 90, speed: 5 },
          trip: { trip_id: "e2e-" + r.rid, route_id: r.rid }, timestamp: now, stop_id: r.stops[1], current_stop_sequence: 2 } };
      }) };
    }
    if (name === "tripUpdates") {
      return { header: head, entity: T.routes.map(function (r, i) {
        return { id: "t" + i, trip_update: { trip: { trip_id: "e2e-" + r.rid, route_id: r.rid }, vehicle: { id: "e2e" + i, label: String(901 + i) },
          stop_time_update: r.stops.slice(1, 8).map(function (sid, k) {
            var t = now + 300 + 120 * k;
            return { stop_id: sid, arrival: { time: t }, departure: { time: t + 20 } };
          }) } };
      }) };
    }
    return { header: head, entity: [{ id: "a1", alert: {
      header_text: { translation: [{ text: "E2E detour on this route", language: "en" }] },
      description_text: { translation: [{ text: "Synthetic alert used by the e2e test.", language: "en" }] },
      active_period: [{ start: now - 3600, end: now + 3600 }], informed_entity: [{ route_id: T.R }] } }] };
  };

  /* Place search result: "start" queries land ~200 m north of T.A, anything else near T.S2. */
  T.places = function (q) {
    var s = T.stops[/start/i.test(q) ? T.A : T.S2];
    return [{ label: /start/i.test(q) ? "E2E Start Place" : "E2E Anchor Place", sub: "Test street, Chicago", lat: s.lat + 0.0018, lon: s.lon }];
  };

  w.fetch = function (input, init) {
    var url = String((input && input.url) || input);
    if (url.indexOf("passio3.com") >= 0) {
      T.polls++;
      if (T.feedFail) return Promise.reject(new TypeError("Failed to fetch (e2e stub)"));
      var m = /realtime\/(\w+)\.json/.exec(url);
      return T.ready.then(function () {
        return new Response(JSON.stringify(T.feed(m ? m[1] : "")), { status: 200, headers: { "Content-Type": "application/json" } });
      });
    }
    if (/photon\.komoot|routing\.openstreetmap|valhalla1\.openstreetmap/.test(url)) {
      return Promise.reject(new TypeError("blocked in e2e: " + url));
    }
    return realFetch(input, init);
  };
})();
