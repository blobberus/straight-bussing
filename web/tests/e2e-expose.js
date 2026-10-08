/*
 * e2e: a module injected (by e2e.js) into the real app inside the test iframe, just before
 * js/main.js. It imports the SAME module instances the app uses (identical URLs) and exposes the
 * store plus the views' injectable dependencies, replacing the network-backed ones:
 *   place search (pick.js placeDeps.search) and walking routes (directions.js deps.walkRoute).
 */
import { store } from "../js/state.js";
import { placeDeps } from "../js/ui/views/pick.js";
import { deps as dirDeps } from "../js/ui/views/directions.js";
import { hav } from "../js/core/geo.js";

const T = window.__e2e;

placeDeps.search = async (q) => {
  T.placeCalls++;
  await T.ready;
  return { items: T.places(q) };
};

dirDeps.walkRoute = async (from, to) => {
  T.walkCalls++;
  const m = hav(from, to) * 1.25;
  const mid = [(from.lat + to.lat) / 2 + 0.0002, (from.lon + to.lon) / 2];
  return { m, min: m / 80, coords: [[from.lat, from.lon], mid, [to.lat, to.lon]], source: "router" };
};

window.__sb = { store, placeDeps, dirDeps };
