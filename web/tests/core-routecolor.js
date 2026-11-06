// Tests for core/routecolor.js: route colors on the dark map (owner 2026-11-06: "Outline or change coloring of the dark
// shuttles to make them more noticable"). The golden file is shared with the iOS Kit (RouteColorTests).
import { test, eq, ok } from "./lib.js";
import { liftForDark, darkRouteColor, mapColor, oklab, badgeTextOk, DARK_LAND, DARK_STREET, LINE_MIN_CONTRAST, BADGE_TEXT_MIN } from "../js/core/routecolor.js";
import { contrast, textOn } from "../js/core/esc.js";

const golden = fetch("fixtures/routecolor_golden.json", { cache: "no-store" }).then((r) => r.json());
const routesJson = fetch("../data/routes.json", { cache: "no-store" }).then((r) => r.json());
const hue = (hex) => { const [, a, b] = oklab(hex); return Math.atan2(b, a) * 180 / Math.PI; };
const chroma = (hex) => { const [, a, b] = oklab(hex); return Math.hypot(a, b); };
const dist = (x, y) => { const p = oklab(x), q = oklab(y); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
const turn = (x, y) => { const d = Math.abs(x - y) % 360; return Math.min(d, 360 - d); };

test("routecolor: the golden answers (shared with the iOS Kit)", async () => {
  const g = await golden;
  eq(g.land, DARK_LAND, "golden land");
  eq(g.street, DARK_STREET, "golden street");
  eq(g.min, LINE_MIN_CONTRAST);
  eq(g.badgeTextMin, BADGE_TEXT_MIN);
  const now = {
    dark: g.dark.map((x) => darkRouteColor(x.color)),
    text: g.dark.map((x) => textOn(darkRouteColor(x.color)).toUpperCase()),
    lift: g.lift.map((x) => liftForDark(x.color, x.bg, x.min)),
  };
  const want = { dark: g.dark.map((x) => x.out), text: g.dark.map((x) => x.text), lift: g.lift.map((x) => x.out) };
  if (JSON.stringify(now) !== JSON.stringify(want)) console.log("routecolor answers now:", JSON.stringify(now));
  eq(now.dark, want.dark, "darkRouteColor");
  eq(now.text, want.text, "badge text color");
  eq(now.lift, want.lift, "liftForDark");
  for (const x of g.dark) {
    ok(Math.abs(contrast(x.out, DARK_LAND) - x.land) < 0.001, x.name + " land ratio");
    ok(Math.abs(contrast(x.out, DARK_STREET) - x.street) < 0.001, x.name + " street ratio");
  }
});

test("routecolor: every route reaches 3:1 on the dark land; a lifted one also on the street fill, with AA badge text", async () => {
  const routes = await routesJson;
  for (const r of Object.values(routes)) {
    const c = r.color.toUpperCase(), d = mapColor(c, true);
    ok(contrast(d, DARK_LAND) >= 3, `${r.long} ${c} -> ${d} on the land`);
    if (d === c) continue;
    ok(contrast(c, DARK_LAND) < 3, `${r.long}: only a color under 3:1 changes`);
    ok(contrast(d, DARK_STREET) >= 3, `${r.long} ${d} on the street fill`);
    ok(badgeTextOk(d) && contrast(d, textOn(d)) >= 4.5, `${r.long} ${d} badge text`);
    ok(turn(hue(d), hue(c)) < 3, `${r.long}: same hue (${hue(c).toFixed(1)} -> ${hue(d).toFixed(1)})`);
    const ch = [1, 3, 5].map((i) => parseInt(d.slice(i, i + 2), 16));
    ok(chroma(d) >= chroma(c) * 0.9 || Math.min(...ch) <= 2 || Math.max(...ch) >= 253, `${r.long}: chroma kept, or as much as sRGB shows`);
    ok(oklab(d)[0] > oklab(c)[0], `${r.long}: lighter`);
  }
});

test("routecolor: the five dark shuttles are lifted; the light map and the brighter routes keep their published colors", async () => {
  const routes = await routesJson;
  const byName = Object.fromEntries(Object.values(routes).map((r) => [r.long, r.color.toUpperCase()]));
  for (const n of ["Downtown Campus Connector", "Regents Express", "Apostolic", "Friend Center/Metra", "Move In Charter"]) {
    if (!byName[n]) continue;   // a later timetable may drop a route
    ok(contrast(byName[n], DARK_LAND) < 2.4, n + " is dark on the dark land");
    ok(mapColor(byName[n], true) !== byName[n], n + " lifted");
  }
  for (const c of Object.values(byName)) eq(mapColor(c, false), c, "light map: " + c);
  for (const n of ["Red Line/Arts Block", "Midway Metra", "South", "53rd Street Express"]) if (byName[n]) eq(mapColor(byName[n], true), byName[n], n + " unchanged");
});

test("routecolor: lifting keeps the routes apart (no two closer than the closest published pair)", async () => {
  const routes = await routesJson;
  const cs = [...new Set(Object.values(routes).map((r) => r.color.toUpperCase()))];
  let pub = Infinity, drawn = Infinity, why = "";
  for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
    pub = Math.min(pub, dist(cs[i], cs[j]));
    const d = dist(mapColor(cs[i], true), mapColor(cs[j], true));
    if (d < drawn) { drawn = d; why = cs[i] + " / " + cs[j]; }
  }
  ok(drawn >= pub * 0.9, `closest dark-map pair ${drawn.toFixed(3)} (${why}) vs published ${pub.toFixed(3)}`);
});

test("routecolor: liftForDark basics", () => {
  eq(liftForDark("#F7EB07"), "#F7EB07", "already 3:1: unchanged");
  eq(liftForDark("#0e5700"), liftForDark("#0E5700"), "case and a bare hex do not matter");
  eq(liftForDark("javascript:alert(1)"), liftForDark("#555555"), "invalid input is the #555555 fallback");
  ok(contrast(liftForDark("#000000"), DARK_LAND) >= 3, "black lifts to a gray");
  eq(liftForDark("#000000", "#FFFFFF"), "#000000", "on a light background black already stands out");
  eq(liftForDark("#808080", "#FFFFFF", 21), "#FFFFFF", "an impossible ratio ends at white");
  ok(contrast(liftForDark("#393B79", DARK_LAND, 4.5), DARK_LAND) >= 4.5, "custom ratio");
  eq(mapColor("#393B79", true), mapColor("#393B79", true), "cached answer is stable");
});
