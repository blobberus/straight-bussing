// Demo for trip.test.html: renders the Current trip timeline for every fixture scene (one phone-width
// sheet each) so it can be screenshot without live buses.
// Query: ?theme=light|dark  ?only=<scene id>  ?compare=1 (adds the route detail timeline of the same
// route for a side-by-side look)  ?shot=1 (hides the test output).
import { tripProgressHTML } from "../js/ui/views/tripprogress.js";
import { renderRoute } from "../js/ui/views/route.js";
import { scenes, NOW } from "./trip-fixtures.js";

const q = new URLSearchParams(location.search);
const theme = q.get("theme");
if (theme === "dark" || theme === "light") document.documentElement.dataset.theme = theme;
if (q.get("shot")) document.documentElement.classList.add("is-shot");
const only = q.get("only");
const host = document.getElementById("demo");

for (const s of scenes()) {
  if (only && s.id !== only) continue;
  const sec = document.createElement("section");
  sec.className = "demo";
  sec.dataset.scene = s.id;
  sec.innerHTML = `<h2 class="demo-h">${s.title}</h2><div class="demo-sheet sheet-content">${tripProgressHTML(s.state, NOW)}</div>`;
  host.appendChild(sec);
}
if (q.get("compare")) {
  const st = scenes().find((s) => s.id === "waiting").state;
  const sec = document.createElement("section");
  sec.className = "demo";
  sec.innerHTML = `<h2 class="demo-h">Route detail (same bus) for comparison</h2><div class="demo-sheet sheet-content">${renderRoute({ ...st, routeId: "R" }, NOW)}</div>`;
  host.appendChild(sec);
}
