// Layout tests for the floating chrome vs the bottom sheet (SHELL): the real tokens.css / base.css /
// sheet.css in an iframe with the index.html chrome, as a phone (393x852) and as the desktop phone frame.
// The sheet must not move, resize or change its content padding when the context chip (#ctxbar)
// appears / disappears, at any detent; the chip hides at the full detent; the status pill always shows
// and the full detent stops below it; a status pill change never moves the sheet at peek / half.
import { test, eq, ok, near } from "./lib.js";
import { createSheet } from "../js/ui/sheet.js";

const PHONE = "(min-width: 99999px)"; // force detent mode for createSheet whatever the test window is
const CHROME = `<div id="app" class="app"><div id="map"></div>
<div id="topbar" class="topbar"><div class="searchbar"><button id="searchBar" class="searchbar-btn" type="button">Search</button><button id="settingsBtn" class="searchbar-gear" type="button" aria-label="Settings">G</button></div></div>
<button id="locateBtn" class="fab" type="button" aria-label="Show my location">L</button>
<div id="pill" class="statuspill" role="status" hidden><span id="pillText" class="pilltext">No shuttles running right now</span></div>
<div id="ctxbar" class="ctxbar" role="status" hidden><span class="ctx-text"><span class="ctx-k">My route:</span> <span class="ctx-v">My commute</span></span><button type="button" class="ctx-btn">Clear</button></div>
<section id="sheet" class="sheet" data-detent="half"><header id="sheetHead" class="sheet-head"><button id="grab" class="grab" type="button"></button><div class="titleline"><h1 id="title" class="sheet-title">My Routes</h1></div></header>
<div id="content" class="sheet-content"><div style="height:1400px">rows</div></div></section>
<nav id="tabs" class="bottomnav"><button type="button">A</button><button type="button">B</button><button type="button">C</button></nav>
<div id="toast" class="toast hide"></div></div>`;

/** Load the chrome with the real CSS into an iframe of the given size; transitions off so reads are final. */
async function frame(w, h) {
  const f = document.createElement("iframe");
  f.style.cssText = `position:absolute;left:-10000px;top:0;width:${w}px;height:${h}px;border:0`;
  const css = ["tokens", "base", "sheet"].map((n) => `<link rel="stylesheet" href="../css/${n}.css">`).join("");
  f.srcdoc = `<!doctype html><html><head><meta name="viewport" content="width=device-width">${css}`
    + "<style>*,*::before,*::after{transition:none!important;animation:none!important}</style></head><body>" + CHROME + "</body></html>";
  await new Promise((res) => { f.onload = res; document.body.appendChild(f); });
  const d = f.contentDocument, $ = (id) => d.getElementById(id);
  const rect = (id) => $(id).getBoundingClientRect();
  return {
    f, d, $, rect,
    set(o) {
      if ("detent" in o) $("sheet").dataset.detent = o.detent;
      if ("chip" in o) $("ctxbar").hidden = !o.chip;
      if ("pill" in o) $("pill").hidden = !o.pill;
      void d.body.offsetHeight;
    },
    geo: () => ({ top: Math.round(rect("sheet").top * 10) / 10, h: $("sheet").offsetHeight,
      pad: f.contentWindow.getComputedStyle($("content")).paddingBottom }),
    visible: (id) => !$(id).hidden && f.contentWindow.getComputedStyle($(id)).visibility === "visible",
    done: () => f.remove(),
  };
}

for (const [name, w, h] of [["phone", 393, 852], ["desktop frame", 1000, 900]]) {
  test(`layout (${name}): the context chip never moves or resizes the sheet, at any detent`, async () => {
    const t = await frame(w, h);
    try {
      for (const pill of [false, true]) {
        for (const detent of ["peek", "half", "full"]) {
          t.set({ detent, pill, chip: false });
          const a = t.geo();
          t.set({ chip: true });
          eq(t.geo(), a, `${detent}, pill ${pill}: chip shown`);
          t.set({ chip: false });
          eq(t.geo(), a, `${detent}, pill ${pill}: chip cleared`);
        }
      }
    } finally { t.done(); }
  });

  test(`layout (${name}): chip shows over the map, hides at the full detent; never over the grab handle`, async () => {
    const t = await frame(w, h);
    try {
      for (const pill of [false, true]) {
        for (const detent of ["peek", "half"]) {
          t.set({ detent, pill, chip: true });
          ok(t.visible("ctxbar"), `chip visible at ${detent}`);
          ok(t.rect("ctxbar").bottom <= t.rect("sheet").top - 8, `chip clear of the grab area at ${detent} (pill ${pill})`);
          if (pill) ok(t.rect("ctxbar").top >= t.rect("pill").bottom, "chip below the pill");
        }
        t.set({ detent: "full", pill, chip: true });
        ok(!t.visible("ctxbar"), "chip hidden at full");
        eq(t.f.contentWindow.getComputedStyle(t.$("ctxbar")).pointerEvents, "none", "hidden chip takes no taps");
        ok(!t.visible("locateBtn"), "locate button hidden at full");
      }
    } finally { t.done(); }
  });

  test(`layout (${name}): status pill always visible; full detent stops below it; peek/half never move`, async () => {
    const t = await frame(w, h);
    try {
      for (const detent of ["peek", "half"]) {
        t.set({ detent, pill: false, chip: false });
        const a = t.geo();
        t.set({ pill: true });
        eq(t.geo(), a, `pill shown at ${detent}: sheet unchanged`);
      }
      t.set({ detent: "full", pill: true, chip: true });
      ok(t.visible("pill"), "pill visible at full");
      near(t.rect("sheet").top, t.rect("pill").bottom + 8, 1, "full sheet starts 8px below the pill");
      const withPill = t.geo();
      t.set({ pill: false });
      const noPill = t.geo();
      eq(noPill.h, withPill.h, "sheet element height constant (--v-max)");
      ok(noPill.top < withPill.top, "without the pill the full detent is taller");
      near(noPill.top, t.rect("searchBar").bottom + 10, 3, "full sheet tucks 8px under the search bar");
      // a two-line pill (main.js sets --pill-h from its real height): chip and full detent follow
      t.$("app").style.setProperty("--pill-h", "62px");
      t.set({ detent: "half", pill: true, chip: true });
      near(t.rect("ctxbar").top, t.rect("pill").top + 62 + 8, 1, "chip below a 62px pill");
      t.set({ detent: "full" });
      near(t.rect("sheet").top, t.rect("pill").top + 62 + 8, 1, "full detent below a 62px pill");
    } finally { t.done(); }
  });
}

test("layout: content padding keeps the last row reachable (padding = sheet part hidden below)", async () => {
  const t = await frame(393, 852);
  try {
    for (const pill of [false, true]) {
      for (const detent of ["peek", "half", "full"]) {
        t.set({ detent, pill });
        const hidden = t.rect("sheet").bottom - t.rect("tabs").top;   // sheet px behind the bottom navigation
        near(parseFloat(t.geo().pad), hidden + 16, 1, `${detent} pill ${pill}`);
      }
    }
  } finally { t.done(); }
});

test("layout: toast never covers the status pill", async () => {
  const t = await frame(393, 852);
  try {
    t.set({ pill: true });
    t.$("toast").classList.remove("hide");
    t.$("toast").textContent = "Showing your usual routes";
    ok(t.rect("toast").top >= t.rect("pill").bottom, "toast below the pill");
  } finally { t.done(); }
});

test("sheet: probes carry data-sheet-probe (read by the Settings overlay) and measure the detents", async () => {
  const t = await frame(393, 852);
  try {
    const sh = createSheet({ sheetEl: t.$("sheet"), headEl: t.$("sheetHead"), contentEl: t.$("content"), panelMedia: PHONE });
    const probes = [...t.d.querySelectorAll("[data-sheet-probe]")].map((p) => p.dataset.sheetProbe);
    eq(probes.sort(), ["full", "half", "peek"]);
    const full = t.d.querySelector('[data-sheet-probe="full"]');
    eq(full.parentElement, t.$("app"), "inside #app so the pill override applies");
    eq(full.offsetHeight, t.$("sheet").offsetHeight, "no pill: full = whole sheet");
    t.set({ pill: true });
    eq(full.offsetHeight, t.$("sheet").offsetHeight - 52, "pill: full detent 52px shorter");
    sh.setDetent("full");
    near(t.rect("sheet").top, t.rect("pill").bottom + 8, 1);
    sh.destroy();
    eq(t.d.querySelectorAll("[data-sheet-probe]").length, 0, "destroy removes probes");
  } finally { t.done(); }
});
