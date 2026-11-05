// Layout tests for the glass control layer vs the bottom sheet (SHELL, docs/DESIGN-SPEC-GLASS.md 3): the real
// tokens.css / base.css / sheet.css in an iframe with the index.html chrome, as a phone (393x852) and as the desktop
// phone frame. The sheet must not move, resize or change its content padding when the trip chip (#ctxbar) appears or
// goes, at any detent; the chip hides at the full detent; the status banner always shows and the full detent stops
// below the top rows; a banner change never moves the collapsed card. Plus the glass geometry: the floating bottom row,
// the inset collapsed card, the Settings circle and the lower-right group riding on the card.
import { test, eq, ok, near } from "./lib.js";
import { createSheet } from "../js/ui/sheet.js";

const PHONE = "(min-width: 99999px)"; // force detent mode for createSheet whatever the test window is
const CHROME = `<div id="app" class="app"><div id="map"></div>
<div id="pill" class="statuspill" role="status" hidden><span id="pillText" class="pilltext">No shuttles running right now</span></div>
<div id="topbar" class="topbar"><button id="settingsBtn" class="glass gcircle" type="button" aria-label="Settings">G</button></div>
<div id="ctxbar" class="ctxbar" role="status" hidden><span class="ctx-text"><span class="ctx-v">My commute</span></span><button type="button" class="ctx-btn">Clear</button></div>
<section id="sheet" class="sheet" data-detent="half"><div class="sheet-bg"><div id="cardGlass" class="sheet-glass glass"></div><div id="cardSolid" class="sheet-solid"></div></div>
<header id="sheetHead" class="sheet-head"><button id="grab" class="grab" type="button"></button><div class="titleline"><h1 id="title" class="sheet-title">My Routes</h1></div></header>
<div id="content" class="sheet-content"><div style="height:1400px">rows</div></div>
<div id="mapctl" class="mapctl glass"><button id="timeBtn" class="mapctl-btn" type="button">T</button><span class="mapctl-sep"></span><button id="locateBtn" class="mapctl-btn" type="button" aria-label="Show my location">L</button></div></section>
<div id="bottomrow" class="bottomrow"><nav id="tabs" class="tabcap glass"><span class="tab-pill" id="tabPill"></span><button type="button">A</button><button type="button">B</button><button type="button">C</button></nav><button id="searchBar" class="glass searchcircle" type="button">S</button></div>
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
      if ("detent" in o) { $("sheet").dataset.detent = o.detent; $("sheet").dataset.rest = o.detent; }   // a settled sheet
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

test("layout: map chrome text stops growing at 1.35 x, sheet text does not (spec 2.2; the Directions card is sheet content now)", async () => {
  const f = document.createElement("iframe");
  f.style.cssText = "position:absolute;left:-10000px;top:0;width:393px;height:852px;border:0";
  const css = ["tokens", "base", "sheet", "components", "views"].map((n) => `<link rel="stylesheet" href="../css/${n}.css">`).join("");
  // 34 px root = 200% browser text (2 x 17)
  f.srcdoc = `<!doctype html><html style="font-size:34px"><head>${css}</head><body><div id="app" class="app">`
    + '<div id="pill" class="statuspill" data-form="banner"><span class="pilltext">Live data delayed.</span></div>'
    + '<div id="ctxbar" class="ctxbar"><span class="ctx-text"><span class="ctx-v">Trip to X</span></span></div>'
    + '<div class="bottomrow"><nav class="tabcap"><button type="button"><span class="bn-label">Routes</span></button></nav></div>'
    + '<section id="sheet" class="sheet"><div class="sheet-content"><label class="v-search"><input type="text" value="Search stations"></label>'
    + '<div class="v-dirbox"><div class="v-dfield"><input id="panelField" type="text" value="My location"></div></div></div></section></div></body></html>';
  await new Promise((res) => { f.onload = res; document.body.appendChild(f); });
  try {
    const d = f.contentDocument, px = (sel) => parseFloat(f.contentWindow.getComputedStyle(d.querySelector(sel)).fontSize);
    near(px("#pill"), 17.55, 0.1, "status banner: footnote capped at 13 x 1.35 (compact banner, owner 2026-11-04)");
    near(px(".tabcap button"), 14.85, 0.1, "tab labels: 11 x 1.35");
    near(px("#ctxbar"), 17.55, 0.1, "trip chip: footnote capped at 13 x 1.35");
    near(px(".v-search input"), 34, 0.1, "sheet content never caps");
    near(px("#panelField"), 34, 0.1, "the Start / Destination card is sheet content (glass spec 9.2): it keeps growing");
  } finally { f.remove(); }
});

test("layout: the place summary shows the whole name at accessibility sizes, two lines otherwise (spec 13.6, as on iOS)", async () => {
  const f = document.createElement("iframe");
  f.style.cssText = "position:absolute;left:-10000px;top:0;width:393px;height:852px;border:0";
  const css = ["tokens", "components", "views", "journey"].map((n) => `<link rel="stylesheet" href="../css/${n}.css">`).join("");
  const name = "Ellis Garage &amp; Ratner Athletic Center (East), Max Palevsky Residential Commons";
  f.srcdoc = `<!doctype html><html><head>${css}</head><body style="width:393px"><div class="j-place"><span class="j-placeic"></span>`
    + `<div><p class="j-placename">${name}</p><p class="v-sec">Shuttle stop</p></div></div></body></html>`;
  await new Promise((res) => { f.onload = res; document.body.appendChild(f); });
  try {
    const d = f.contentDocument, el = d.querySelector(".j-placename");
    const lines = () => Math.round(el.getBoundingClientRect().height / parseFloat(f.contentWindow.getComputedStyle(el).lineHeight));
    d.documentElement.style.fontSize = "34px";   // 200% text: the name needs more than two lines
    ok(el.scrollHeight > el.clientHeight + 4, "default layout: clamped to two lines (" + lines() + ")");
    eq(lines(), 2, "two lines at the default class");
    d.documentElement.dataset.text = "ax";
    ok(el.scrollHeight <= el.clientHeight + 1, "ax: nothing cut");
    ok(lines() > 2, "ax: the whole name, " + lines() + " lines");
  } finally { f.remove(); }
});

test("layout: at 200% text route badges grow instead of clipping their name, and the trip header stacks End trip under the title", async () => {
  const f = document.createElement("iframe");
  f.style.cssText = "position:absolute;left:-10000px;top:0;width:393px;height:852px;border:0";
  const css = ["tokens", "components", "views", "journey", "trip"].map((n) => `<link rel="stylesheet" href="../css/${n}.css">`).join("");
  f.srcdoc = `<!doctype html><html style="font-size:34px" data-text="ax"><head>${css}</head><body style="width:393px;margin:0">`
    + '<span class="chip" id="b1">RE</span> <span class="chip sm" id="b2">AP/DX</span>'
    + '<div class="tp-head"><span class="v-grow"><span class="tp-title" id="tt">Trip to Trader Joe&rsquo;s</span></span><button type="button" class="v-btn tp-end" id="te">End trip</button></div></body></html>';
  await new Promise((res) => { f.onload = res; document.body.appendChild(f); });
  try {
    const d = f.contentDocument, r = (id) => d.getElementById(id).getBoundingClientRect();
    for (const id of ["b1", "b2"]) {
      const el = d.getElementById(id);
      const lh = parseFloat(f.contentWindow.getComputedStyle(el).lineHeight);
      ok(r(id).height >= lh - 0.5, `${id}: the badge is at least one line of its text tall (${r(id).height} vs ${lh})`);
      ok(r(id).height > 24, `${id}: taller than at the default size`);
    }
    ok(r("te").top >= r("tt").bottom - 1, "End trip sits under the title");
    ok(r("tt").width > 300, "the title gets the whole width: " + Math.round(r("tt").width));
  } finally { f.remove(); }
});

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

  test(`layout (${name}): chip shows over the map at every detent, like Settings; never over the grab handle or the title`, async () => {
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
        ok(t.visible("ctxbar"), "chip still shown at full (owner 2026-11-04: like the Settings button)");
        ok(t.f.contentWindow.getComputedStyle(t.$("ctxbar")).pointerEvents !== "none", "and it takes taps");
        ok(t.rect("ctxbar").bottom <= t.rect("sheet").top - 8 && t.rect("ctxbar").bottom <= t.rect("title").top, `chip clear of the grab area and title at full (pill ${pill})`);
        ok(!t.visible("locateBtn") && !t.visible("timeBtn"), "the lower-right group hidden at full");
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
      near(t.rect("settingsBtn").top, t.rect("pill").bottom + 8, 1, "Row B (Settings) 8 below the banner (Row A)");
      near(t.rect("sheet").top, t.rect("settingsBtn").bottom + 8, 1, "full sheet starts 8 below the lowest top row");
      const withPill = t.geo();
      t.set({ pill: false });
      const noPill = t.geo();
      eq(noPill.h, withPill.h, "sheet element height constant (--v-max)");
      ok(noPill.top < withPill.top, "without the pill the full detent is taller");
      near(noPill.top, t.rect("settingsBtn").bottom + 8, 1, "no banner: the full sheet starts 8 below the Settings row");
      // a two-line pill (main.js sets --pill-h from its real height): chip and full detent follow
      t.$("app").style.setProperty("--pill-h", "62px");
      t.set({ detent: "half", pill: true, chip: true });
      near(t.rect("ctxbar").top, t.rect("pill").top + 62 + 8 + 4, 1, "trip chip in Row B (centered beside Settings) below a 62px banner");
      t.set({ detent: "full" });
      near(t.rect("sheet").top, t.rect("pill").top + 62 + 8 + 44 + 8, 1, "full detent below Row B under a 62px banner");
    } finally { t.done(); }
  });
}

test("layout: content padding keeps the last row reachable (padding = sheet part hidden below + the floating row + 24, where the soft scroll edge starts)", async () => {
  const t = await frame(393, 852);
  try {
    for (const pill of [false, true]) {
      for (const detent of ["peek", "half", "full"]) {
        t.set({ detent, pill });
        const hidden = t.rect("sheet").bottom - t.rect("bottomrow").top;   // below the screen + behind the floating row
        near(parseFloat(t.geo().pad), hidden + 24, 1, `${detent} pill ${pill}`);
      }
    }
  } finally { t.done(); }
});

test("layout: the grab bar's hit area (12 px into the header) never covers Back: every point of the 44 pt circle goes back, not to the grab bar", async () => {
  const t = await frame(393, 852);
  try {
    for (const detent of ["peek", "full"]) {
      t.set({ detent });
      if (!t.$("back")) {   // the app's markup: the grab bar is a div slider (index.html), Back a 44 circle in the title line
        t.$("grab").outerHTML = '<div id="grab" class="grab" role="slider" tabindex="0" aria-label="Resize panel"></div>';
        t.d.querySelector(".titleline").insertAdjacentHTML("afterbegin", '<button id="back" class="back" type="button" aria-label="Back">B</button>');
      }
      const b = t.rect("back"), cx = b.left + b.width / 2, cy = b.top + b.height / 2;
      ok(b.width >= 44 && b.height >= 44, "Back is a 44 pt circle");
      for (const [x, y, where] of [[cx, b.top + 2, "top edge"], [cx, cy, "center"], [cx, b.bottom - 2, "bottom edge"], [b.left + 3, cy, "leading edge"]]) {
        const hit = t.d.elementFromPoint(x, y);
        ok(hit && hit.closest("#back"), `${detent}: a tap on Back's ${where} lands on Back (${hit && (hit.id || hit.className)})`);
      }
      const g = t.rect("grab");
      ok(t.d.elementFromPoint(g.left + g.width / 2, g.top + g.height / 2)?.closest("#grab"), `${detent}: the grab bar keeps its own strip`);
    }
  } finally { t.done(); }
});

test("layout: the top-right column takes taps only on its circles: not in the gap, not in the hidden feedback circle's slot over the expanded sheet", async () => {
  const t = await frame(393, 852);
  try {
    t.$("topbar").insertAdjacentHTML("beforeend", '<button id="feedbackBtn" class="glass gpress fbfab" type="button" aria-label="Give feedback">F</button>');
    t.set({ detent: "peek" });
    const g = t.rect("settingsBtn"), f = t.rect("feedbackBtn"), x = g.left + g.width / 2;
    ok(f.top - g.bottom >= 7.5, "8 between the circles");
    ok(t.d.elementFromPoint(x, f.top + f.height / 2)?.closest("#feedbackBtn"), "the circle takes its taps");
    ok(!t.d.elementFromPoint(x, (g.bottom + f.top) / 2)?.closest("#topbar"), "the gap between the circles is the map's");
    t.set({ detent: "full" });   // the feedback circle hides at the full detent (base.css); its slot is over the sheet header
    t.$("feedbackBtn").style.transition = "none";
    eq(t.f.contentWindow.getComputedStyle(t.$("feedbackBtn")).visibility, "hidden", "hidden at full");
    const hit = t.d.elementFromPoint(x, f.top + f.height / 2);
    ok(hit && !hit.closest("#topbar") && hit.closest("#sheet"), `the slot belongs to the sheet header under it (${hit && (hit.id || hit.className)})`);
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
    near(t.rect("sheet").top, t.rect("settingsBtn").bottom + 8, 1, "below the top rows");
    sh.destroy();
    eq(t.d.querySelectorAll("[data-sheet-probe]").length, 0, "destroy removes probes");
  } finally { t.done(); }
});

for (const [name, w, h, safeB, safeT] of [["phone", 393, 852, 0, 0], ["desktop frame", 1000, 900, 34, 54]]) {
  test(`layout (${name}): the glass geometry (glass spec 3): floating bottom row, inset card, Settings circle, the group on the card`, async () => {
    const t = await frame(w, h);
    try {
      t.set({ detent: "peek", pill: false, chip: false });
      // the phone's #app is a plain wrapper (0 tall): the viewport is the screen; in the frame #app is the phone
      const app = name === "phone" ? { left: 0, top: 0, right: w, bottom: h } : t.rect("app"), r = (id) => t.rect(id), inset = Math.max(12, safeB - 12);
      near(r("bottomrow").bottom, app.bottom - inset, 1, "bottom row: max(12, safe bottom - 12) above the screen's bottom");
      near(r("tabs").height, 56, 0.5, "tab bar 56 tall");
      near(r("searchBar").width, 56, 0.5, "search circle 56 wide");
      near(r("searchBar").right, app.right - 12, 1, "search circle 12 from the right");
      near(r("tabs").left, app.left + 12, 1, "tab bar 12 from the left");
      near(r("searchBar").left - r("tabs").right, 8, 1, "8 between the tab bar and the search circle");
      near(r("cardGlass").left, app.left + 12, 1, "card inset 12 (left)");
      near(r("cardGlass").right, app.right - 12, 1, "card inset 12 (right)");
      near(r("cardGlass").bottom, r("bottomrow").top - 8, 1, "card 8 above the bottom row");
      near(r("cardGlass").top, r("sheet").top, 1, "the card is the sheet's visible top");
      eq(t.f.contentWindow.getComputedStyle(t.$("cardSolid")).opacity, "0", "collapsed: the opaque layer is invisible");
      near(r("settingsBtn").width, 44, 0.5, "Settings: a 44 circle");
      near(r("settingsBtn").right, app.right - 12, 1, "Settings 12 from the right");
      near(r("settingsBtn").top, app.top + safeT + 8, 1, "Settings 8 below the safe area (Row B, no banner)");
      near(r("mapctl").height, 88.5, 1, "the group: 44 x 88 (plus the hairline)");
      near(r("mapctl").right, app.right - 12, 1, "the group 12 from the right");
      near(r("mapctl").bottom, r("cardGlass").top - 8, 1, "the group rides 8 above the card");
      t.set({ chip: true });
      near(r("ctxbar").top, r("settingsBtn").top + 4, 1, "no simulated-buses chip: the trip chip sits beside Settings");
      ok(r("ctxbar").right <= r("settingsBtn").left - 8 + 0.5, "and never under it");
      t.set({ detent: "full" });
      eq(t.f.contentWindow.getComputedStyle(t.$("cardSolid")).opacity, "1", "expanded: opaque");
      near(r("cardSolid").left, app.left, 1, "expanded: full width");
      ok(r("sheet").bottom >= app.bottom - 0.5, "expanded: the sheet reaches the screen's bottom, the row floats over it");
    } finally { t.done(); }
  });
}

test("layout: the selection capsule slides by transform to the selected tab", async () => {
  const t = await frame(393, 852);
  try {
    const pill = t.$("tabPill"), btns = t.$("tabs").querySelectorAll("button");
    pill.style.transition = "none";
    near(pill.getBoundingClientRect().left, btns[0].getBoundingClientRect().left, 1, "first tab");
    t.$("tabs").style.setProperty("--tab-i", "2");
    near(pill.getBoundingClientRect().left, btns[2].getBoundingClientRect().left, 1, "third tab");
    near(pill.getBoundingClientRect().width, btns[2].getBoundingClientRect().width, 1, "one item wide");
    ok(t.f.contentWindow.getComputedStyle(pill).transform.startsWith("matrix"), "moved by transform");
  } finally { t.done(); }
});

test("layout: simulated-buses chip + trip chip (demo): the trip chip in Row C stays shown at full and the expanded sheet starts 8 below it", async () => {
  const t = await frame(393, 852);
  try {
    t.$("pill").dataset.form = "chip";
    t.set({ pill: true, chip: false, detent: "full" });
    const alone = t.rect("sheet").top;
    t.set({ chip: true });
    ok(t.visible("ctxbar"), "trip chip shown");
    ok(t.rect("ctxbar").top >= t.rect("pill").bottom, "under the simulated-buses chip (Row C)");
    near(t.rect("sheet").top, t.rect("ctxbar").bottom + 8, 1.5, "the expanded sheet starts 8 below the trip chip");
    ok(t.rect("sheet").top > alone, "only the full detent moves for it");
    for (const d of ["peek", "half"]) {
      t.set({ detent: d, chip: false });
      const a = t.geo();
      t.set({ chip: true });
      eq(t.geo(), a, `${d}: the collapsed card never moves for the chip`);
    }
  } finally { t.done(); }
});
