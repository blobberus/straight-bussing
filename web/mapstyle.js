/* Basemap: OpenFreeMap vector style (positron / dark) patched at runtime for legible streets,
   house numbers and campus place names. See docs/DESIGN.md "Map style changes".
   API: MapStyle.create(map, isDark) -> Leaflet layer (caller adds it); MapStyle.update(layer, isDark). */
(function () {
  "use strict";
  var BASE = "https://tiles.openfreemap.org/styles/";
  var ATTR = '&copy; <a href="https://openfreemap.org">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/">OpenMapTiles</a> data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
  var RASTER_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

  var PAL = {
    light: { bg: "#eef0ec", park: "#dde8d6", water: "#b9d2e1", bldg: "#e3e2dd", bldgLine: "#cbc9c2", minor: "#ffffff", minorCase: "#c4c7c2",
      major: "#ffffff", majorCase: "#aeb2ad", path: "#c8c4b8", text: "#2f3036", halo: "#ffffff", hn: "#585b63", poi: "#3b5266" },
    dark: { bg: "#161618", park: "#1b231d", water: "#0e1c29", bldg: "#212126", bldgLine: "#32323a", minor: "#3c3c43", minorCase: "#0a0a0b",
      major: "#52525b", majorCase: "#0a0a0b", path: "#4c4c53", text: "#e8e8ee", halo: "#161618", hn: "#b0b0ba", poi: "#bccad6" }
  };
  var NAME = ["coalesce", ["get", "name_en"], ["get", "name"]];
  var cache = {};

  function zoomSize(a) { return ["interpolate", ["linear"], ["zoom"], 13, a[0], 15, a[1], 17, a[2], 19, a[3]]; }
  function lineW(a) { return ["interpolate", ["exponential", 1.5], ["zoom"], 13, a[0], 16, a[1], 18, a[2], 20, a[3]]; }
  function setPaint(l, o) { l.paint = Object.assign(l.paint || {}, o); }
  function setLayout(l, o) { l.layout = Object.assign(l.layout || {}, o); }

  function adjust(base, dark) {
    var s = JSON.parse(JSON.stringify(base)), P = dark ? PAL.dark : PAL.light, out = [], firstRoadName = -1;
    s.layers.forEach(function (l) {
      var id = l.id;
      if (id === "background") setPaint(l, { "background-color": P.bg });
      else if (id === "water") setPaint(l, { "fill-color": P.water });
      else if (id === "park") setPaint(l, { "fill-color": P.park });
      else if (id === "building") { setPaint(l, { "fill-color": P.bldg, "fill-outline-color": P.bldgLine }); }
      else if (id === "highway_path") setPaint(l, { "line-color": P.path, "line-opacity": 1, "line-width": ["interpolate", ["linear"], ["zoom"], 14, 1, 18, 3] });
      else if (id === "highway_minor") {
        // add a casing underneath, then widen the fill
        var c = JSON.parse(JSON.stringify(l)); c.id = "sb_minor_casing";
        setPaint(c, { "line-color": P.minorCase, "line-opacity": 1, "line-width": lineW([2.6, 6.6, 14, 24]) });
        setLayout(c, { "line-cap": "round", "line-join": "round" }); out.push(c);
        setPaint(l, { "line-color": P.minor, "line-opacity": 1, "line-width": lineW([1.5, 4.6, 12, 22]) });
        setLayout(l, { "line-cap": "round", "line-join": "round" });
      } else if (id === "highway_major_casing") setPaint(l, { "line-color": P.majorCase, "line-width": ["interpolate", ["exponential", 1.3], ["zoom"], 10, 3.2, 16, 9, 20, 26] });
      else if (id === "highway_major_inner") setPaint(l, { "line-color": P.major, "line-width": ["interpolate", ["exponential", 1.3], ["zoom"], 10, 2, 16, 7, 20, 22] });
      else if (/^(highway-shield|road_shield)/.test(id)) setLayout(l, { visibility: "none" }); // clutter
      else if (/^highway[-_]name/.test(id) && !/motorway/.test(id)) {
        var path = /path/.test(id), major = /major/.test(id);
        l.minzoom = path ? 16 : major ? 12.5 : 14;
        setLayout(l, { "text-size": zoomSize(major ? [11, 12.5, 14, 16] : [10.5, 12, 13.5, 15]), "text-font": [major ? "Noto Sans Bold" : "Noto Sans Regular"],
          "text-transform": "none", "text-letter-spacing": 0.02, "symbol-spacing": 260, "text-padding": 3, "text-max-angle": 35 });
        delete l.layout["text-halo-blur"];
        setPaint(l, { "text-color": P.text, "text-halo-color": P.halo, "text-halo-width": 2, "text-halo-blur": 0.4, "text-opacity": 1 });
        if (firstRoadName < 0) firstRoadName = out.length;
      }
      out.push(l);
    });
    // extra symbol layers, inserted below street names so street names win label collisions
    var at = firstRoadName < 0 ? out.length : firstRoadName;
    var extra = [{
      id: "sb_poi_campus", type: "symbol", source: "openmaptiles", "source-layer": "poi", minzoom: 15.5,
      filter: ["all", ["has", "name"], ["match", ["get", "class"], ["college", "school", "hospital", "library", "stadium", "museum", "theatre"], true, false]],
      layout: { "text-field": NAME, "text-font": ["Noto Sans Bold"], "text-size": zoomSize([11, 11, 12, 13.5]), "text-max-width": 7, "text-padding": 3, "text-optional": true },
      paint: { "text-color": P.poi, "text-halo-color": P.halo, "text-halo-width": 1.8, "text-halo-blur": 0.3 }
    }, {
      id: "sb_housenumber", type: "symbol", source: "openmaptiles", "source-layer": "housenumber", minzoom: 16.5,
      layout: { "text-field": ["get", "housenumber"], "text-font": ["Noto Sans Regular"], "text-size": ["interpolate", ["linear"], ["zoom"], 16.5, 10, 18, 12, 20, 14], "text-padding": 2, "text-max-width": 5 },
      paint: { "text-color": P.hn, "text-halo-color": P.halo, "text-halo-width": 1.6, "text-halo-blur": 0.3 }
    }];
    Array.prototype.splice.apply(out, [at, 0].concat(extra));
    s.layers = out;
    return s;
  }

  function loadBase(name) {
    return cache[name] || (cache[name] = fetch(BASE + name).then(function (r) { if (!r.ok) throw new Error("style " + r.status); return r.json(); })
      .catch(function (e) { delete cache[name]; throw e; }));
  }

  function whenGl(layer, cb) {
    var gl = layer.getMaplibreMap && layer.getMaplibreMap();
    if (gl) return cb(gl);
    layer.once("add", function () { var g = layer.getMaplibreMap && layer.getMaplibreMap(); if (g) cb(g); });
  }

  function apply(layer, dark) {
    var token = layer._sbToken = (layer._sbToken || 0) + 1;
    layer._sbDark = !!dark;
    loadBase(dark ? "dark" : "positron").then(function (base) {
      if (token !== layer._sbToken) return;
      var style = adjust(base, dark);
      whenGl(layer, function (gl) { if (token === layer._sbToken) gl.setStyle(style); });
    }).catch(function () { /* keep the empty background; app still works without a basemap */ });
  }

  function raster(isDark) {
    var t = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: RASTER_ATTR });
    t._sbRaster = true;
    t.on("add", function () { var c = t.getContainer(); if (c) c.classList.toggle("tiles-dark", !!t._sbDark); });
    t._sbDark = !!isDark;
    return t;
  }

  window.MapStyle = {
    create: function (map, isDark) {
      if (!(window.maplibregl && window.L && L.maplibreGL)) return raster(isDark);
      var P = isDark ? PAL.dark : PAL.light;
      var layer = L.maplibreGL({
        attribution: ATTR,
        style: { version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": P.bg } }] }
      });
      apply(layer, isDark);
      return layer;
    },
    update: function (layer, isDark) {
      if (!layer) return;
      if (layer._sbRaster) { layer._sbDark = !!isDark; var c = layer.getContainer && layer.getContainer(); if (c) c.classList.toggle("tiles-dark", !!isDark); return; }
      apply(layer, isDark);
    },
    _adjust: adjust
  };
})();
