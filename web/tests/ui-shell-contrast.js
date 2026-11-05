// QA regression (2026-10-09): small text stays >= 4.5:1 (WCAG AA) in light and dark with the real CSS:
// "est." / "sidewalk route" tags on option cards (were 4.37 light, 3.90 dark), green "Now" / "Scheduled now"
// (were 3.42 on white) and the amber "N active" alert count (was 4.29).
import { test, ok } from "./lib.js";

const CSS = ["tokens", "base", "components", "views", "route", "trip", "settings", "journey"];
const rgba = (c) => { const m = String(c).match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
const over = (top, base) => ({ r: top.r * top.a + base.r * (1 - top.a), g: top.g * top.a + base.g * (1 - top.a), b: top.b * top.a + base.b * (1 - top.a), a: 1 });
const L = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

function frame() {
  return new Promise((resolve) => {
    const f = document.createElement("iframe");
    f.style.cssText = "position:absolute;left:-2000px;width:400px;height:400px";
    f.srcdoc = `<!doctype html><html><head>${CSS.map((n) => `<link rel="stylesheet" href="../css/${n}.css">`).join("")}</head><body style="background:#fff">`
      + `<div class="v-opt is-on"><span class="v-est">est.</span></div>`
      + `<div class="v-card"><span class="v-est">sidewalk route</span></div>`
      + `<div style="background:var(--bg-solid)"><span class="r-sched is-on">Scheduled now</span><span class="tp-eta is-now">Now</span><span class="v-tleta is-now">Now</span><span class="st-count">3 active</span><span class="v-est">est.</span></div>`
      + `</body></html>`;
    f.onload = () => setTimeout(() => resolve(f), 50);
    document.body.appendChild(f);
  });
}

/** Effective background behind el (alpha layers composited up to an opaque one, else the theme base). */
function bgOf(win, el, base) {
  const layers = [];
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    const c = rgba(win.getComputedStyle(n).backgroundColor);
    if (c && c.a > 0) { layers.push(c); if (c.a >= 0.999) break; }
  }
  return layers.reverse().reduce((acc, c) => over(c, acc), base);
}

test("contrast: small status text and est. tags are >= 4.5:1 in light and dark (QA 2026-10-09)", async () => {
  const f = await frame(), win = f.contentWindow, doc = f.contentDocument;
  const bad = [];
  for (const theme of ["light", "dark"]) {
    doc.documentElement.dataset.theme = theme;
    doc.body.style.background = theme === "dark" ? "#1c1c1e" : "#ffffff";
    const base = theme === "dark" ? { r: 28, g: 28, b: 30, a: 1 } : { r: 255, g: 255, b: 255, a: 1 };
    for (const el of doc.querySelectorAll(".v-est, .r-sched, .tp-eta, .v-tleta, .st-count")) {
      const bg = bgOf(win, el, base), fg = over(rgba(win.getComputedStyle(el).color), bg), cr = ratio(fg, bg);
      if (!(cr >= 4.5)) bad.push(`${theme} .${el.className.split(" ")[0]} in .${el.parentElement.className.split(" ")[0] || "plain"}: ${cr.toFixed(2)}`);
    }
  }
  f.remove();
  ok(!bad.length, bad.join("; "));
});

test("high contrast / forced colors: on-off state of check circles and segments stays visible (QA 2026-10-09)", async () => {
  // prefers-contrast: more sets --hairline-strong to currentColor, so a check circle colored `transparent` lost its
  // ring; forced colors repaint a `transparent` check, so OFF rows showed a check. Off checks now hide by opacity.
  const f = await frame(), win = f.contentWindow, doc = f.contentDocument;
  const link = doc.createElement("link"); link.rel = "stylesheet"; link.href = "../css/myroutes.css";
  await new Promise((r) => { link.onload = r; link.onerror = r; doc.head.appendChild(link); });
  doc.body.insertAdjacentHTML("beforeend", '<button class="mr-crow"><span class="mr-tick"><svg class="ic"></svg></span></button><button class="mr-crow is-on"><span class="mr-tick"><svg class="ic"></svg></span></button>'
    + '<button class="mr-hl"><span class="mr-hltick"><svg class="ic"></svg></span></button><button class="mr-hl is-on"><span class="mr-hltick"><svg class="ic"></svg></span></button>');
  const [offT, onT] = doc.querySelectorAll(".mr-tick"), [offH, onH] = doc.querySelectorAll(".mr-hltick"), cs = (e) => win.getComputedStyle(e);
  ok(rgba(cs(offT).color).a > 0, "off circle keeps a real color (its ring is currentColor in high contrast)");
  ok(cs(offT.querySelector(".ic")).opacity === "0" && cs(onT.querySelector(".ic")).opacity === "1", "check hidden by opacity when off");
  ok(cs(offH.querySelector(".ic")).opacity === "0" && cs(onH.querySelector(".ic")).opacity === "1", "highlight tick hidden by opacity when off");
  f.remove();
  const comp = await fetch("../css/components.css").then((r) => r.text());
  const forced = comp.slice(comp.indexOf("@media (forced-colors: active)"));
  ok(/\.themeseg button\[aria-checked="true"\][^{]*\{[^}]*Highlight/.test(forced), "selected theme segment marked with Highlight in forced colors");
});

// Taste audit 2026-10-10 (docs/DESIGN-AUDIT-2026-10-10.md section 4): every button, toggle, tag, badge and the field
// placeholder color stay >= 4.5:1 in light and dark with the real CSS. The dark Delete button and the alert count badge
// were white on #ff6961 (2.82:1) before --danger-fill.
function buttonsFrame() {
  return new Promise((resolve) => {
    const f = document.createElement("iframe");
    f.style.cssText = "position:absolute;left:-2000px;width:400px;height:900px";
    // transitions off: a theme switch must not be measured mid-fade (.v-btn animates its background)
    f.srcdoc = `<!doctype html><html><head>${[...CSS, "myroutes"].map((n) => `<link rel="stylesheet" href="../css/${n}.css">`).join("")}<style>*,*::before,*::after{transition:none!important}</style></head><body>`
      + `<div style="background:var(--bg-solid)">`
      + `<button class="v-btn v-btn--primary">Use my location</button><button class="v-btn v-btn--secondary">Routes to station</button>`
      + `<button class="v-btn v-btn--danger">Delete</button><button class="v-btn v-btn--quiet">Show all</button><button class="v-link">Type an address</button>`
      + `<button class="cta">Go</button><button class="cta alt">Alt</button><span class="badge">1</span><span class="pill pill-warn">Delayed</span><span class="pill pill-err">Error</span>`
      + `<span class="mr-showing">Showing on the map</span><button class="mr-hl is-on">Highlight</button><button class="mr-hl">Highlight</button><button class="mr-fav">Favorite</button>`
      + `<span class="tp-tag tp-tag--board">Board</span><span class="tp-tag tp-tag--alight">Get off</span><span class="v-fchip"><span class="v-fchip-t">Routes to X</span></span>`
      + `<div class="mr-acts" style="visibility:visible;position:static;width:auto"><button class="mr-act mr-act--info">Details</button><button class="mr-act mr-act--edit">Edit</button><button class="mr-act mr-act--del">Delete</button></div>`
      + `<span class="t-ph" style="color:var(--text-2);background:var(--surface)">Station name (placeholder color on a field)</span></div>`
      + `<div class="v-card"><button class="v-btn v-btn--secondary">In a card</button><button class="v-btn v-btn--destructive">End trip</button><span class="j-crit">Least walking</span></div>`
      + `</body></html>`;
    f.onload = () => setTimeout(() => resolve(f), 50);
    document.body.appendChild(f);
  });
}

test("contrast: buttons, toggles, tags, badges and placeholders are >= 4.5:1 in light and dark (taste audit 2026-10-10)", async () => {
  const f = await buttonsFrame(), win = f.contentWindow, doc = f.contentDocument, bad = [];
  let n = 0;
  for (const theme of ["light", "dark"]) {
    doc.documentElement.dataset.theme = theme;
    const base = theme === "dark" ? { r: 28, g: 28, b: 30, a: 1 } : { r: 252, g: 252, b: 253, a: 1 };
    for (const el of doc.querySelectorAll("button, .badge, .pill, .mr-showing, .tp-tag, .v-fchip-t, .j-crit, .t-ph")) {
      const bg = bgOf(win, el, base), fg = over(rgba(win.getComputedStyle(el).color), bg), cr = ratio(fg, bg);
      n++;
      if (!(cr >= 4.5)) bad.push(`${theme} .${el.className.split(" ").join(".")} "${el.textContent}": ${cr.toFixed(2)}`);
    }
  }
  f.remove();
  ok(n >= 40, "measured " + n);
  ok(!bad.length, bad.join("; "));
});

// DESIGN-SPEC 4.2: every text / surface pair of the redesign is >= 4.5:1 in light and dark, measured from the real tokens
// with translucent fills composited over the surface they sit on (the spec's table, and the redesign's own pairs).
const PAIRS = [
  ["label", "bg-sheet"], ["label", "bg-card"], ["label-2", "bg-sheet"], ["label-2", "bg-card"],
  ["label-2", "fill", "bg-card"], ["label-2", "fill", "bg-sheet"], ["label", "fill", "bg-card"],
  ["tint", "bg-sheet"], ["tint", "bg-card"], ["tint", "fill", "bg-card"], ["tint", "fill", "bg-sheet"], ["tint", "tint-bg"],
  ["label-2", "tint-bg"], ["label", "tint-bg"],
  ["live", "bg-sheet"], ["live", "bg-card"],
  ["warn", "bg-card"], ["warn", "warn-bg"], ["label", "warn-bg"], ["tint", "warn-bg"],
  ["danger", "bg-sheet"], ["danger", "bg-card"], ["danger", "fill", "bg-card"], ["danger", "danger-bg"], ["label", "danger-bg"], ["tint", "danger-bg"],
  ["on-fill", "tint-fill"], ["on-fill", "danger-fill"], ["on-fill", "neutral-fill"],
  ["label-inverse", "bg-inverse"], ["label", "bg-chrome-solid"], ["label-2", "bg-chrome-solid"],
];
test("contrast: the spec's token pairs (DESIGN-SPEC 4.2) are >= 4.5:1 in light and dark", async () => {
  const f = document.createElement("iframe");
  f.style.cssText = "position:absolute;left:-2000px;width:200px;height:200px";
  f.srcdoc = '<!doctype html><html><head><link rel="stylesheet" href="../css/tokens.css"></head><body></body></html>';
  await new Promise((r) => { f.onload = () => setTimeout(r, 30); document.body.appendChild(f); });
  const win = f.contentWindow, doc = f.contentDocument, bad = [];
  const col = (name) => rgba(win.getComputedStyle(doc.documentElement).getPropertyValue("--" + name).trim().replace(/^#([0-9a-f]{6})$/i, (m, h) => `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4), 16)})`));
  for (const theme of ["light", "dark"]) {
    doc.documentElement.dataset.theme = theme;
    for (const [fgN, bgN, underN] of PAIRS) {
      const under = underN ? col(underN) : null, bgTop = col(bgN), fgTop = col(fgN);
      if (!bgTop || !fgTop || (underN && !under)) { bad.push(`${theme}: unreadable token ${fgN} / ${bgN}`); continue; }
      const bg = under ? over(bgTop, under) : bgTop, fg = over(fgTop, bg), cr = ratio(fg, bg);
      if (!(cr >= 4.5)) bad.push(`${theme} ${fgN} on ${bgN}${underN ? " over " + underN : ""}: ${cr.toFixed(2)}`);
    }
  }
  f.remove();
  ok(!bad.length, bad.join("; "));
});

test("contrast: text and icons on glass pass over the worst backdrop with no blur (DESIGN-SPEC-GLASS 5.3)", async () => {
  // light glass over pure black, dark glass over pure white (blur only makes real maps better); label and labelGlass2
  // as text need 4.5:1, tint as an icon 3:1; label2 and tint as TEXT must fail (they are not allowed on glass), which
  // keeps the 80% fill honest if someone lowers it
  const f = document.createElement("iframe");
  f.style.cssText = "position:absolute;left:-2000px;width:200px;height:200px";
  f.srcdoc = '<!doctype html><html><head><link rel="stylesheet" href="../css/tokens.css"></head><body></body></html>';
  await new Promise((r) => { f.onload = () => setTimeout(r, 30); document.body.appendChild(f); });
  const win = f.contentWindow, doc = f.contentDocument, bad = [];
  const hex = (v) => v.trim().replace(/^#([0-9a-f]{6})$/i, (m, h) => `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4), 16)})`);
  const col = (name) => rgba(hex(win.getComputedStyle(doc.documentElement).getPropertyValue("--" + name)));
  const worst = { light: { r: 0, g: 0, b: 0, a: 1 }, dark: { r: 255, g: 255, b: 255, a: 1 } };
  for (const theme of ["light", "dark"]) {
    doc.documentElement.dataset.theme = theme;
    const fill = col("glass-fill");
    if (!fill || !(fill.a < 1)) { bad.push(`${theme}: glass-fill is not translucent (${JSON.stringify(fill)})`); continue; }
    const bg = over(fill, worst[theme]);
    for (const [fg, need] of [["label", 4.5], ["label-glass-2", 4.5], ["tint", 3]]) {
      const cr = ratio(over(col(fg), bg), bg);
      if (!(cr >= need)) bad.push(`${theme} ${fg} on glass: ${cr.toFixed(2)} < ${need}`);
    }
    for (const fg of ["label-2", "tint"]) {
      const cr = ratio(over(col(fg), bg), bg);
      if (cr >= 4.5) bad.push(`${theme} ${fg} as text on glass passes (${cr.toFixed(2)}): the rule in 5.3 no longer matches the fill`);
    }
    const solid = col("glass-solid");
    if (!solid || solid.a < 1) bad.push(`${theme}: glass-solid must be opaque`);
  }
  f.remove();
  ok(!bad.length, bad.join("; "));
});

// Owner 2026-11-05: "change the color of favorite station icons to yellow instead of brown". The star tokens are a real
// yellow (not the old #A35400 brown, not 53rd Street's lemon #F7EB07 route color), the dark star on the map disc reads,
// and the badge / sheet star stays visible: on light surfaces through the dark edge (the yellow alone is about 1.4:1),
// on dark surfaces the yellow itself.
test("contrast: favorite stars are yellow and stay visible on the land and the cards in light and dark", async () => {
  const f = document.createElement("iframe");
  f.style.cssText = "position:absolute;left:-2000px;width:200px;height:200px";
  f.srcdoc = '<!doctype html><html><head><link rel="stylesheet" href="../css/tokens.css"></head><body></body></html>';
  await new Promise((r) => { f.onload = () => setTimeout(r, 30); document.body.appendChild(f); });
  const win = f.contentWindow, doc = f.contentDocument, bad = [];
  const hex = (v) => v.trim().replace(/^#([0-9a-f]{6})$/i, (m, h) => `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4), 16)})`);
  const col = (name) => rgba(hex(win.getComputedStyle(doc.documentElement).getPropertyValue("--" + name)));
  const hsl = ({ r, g, b }) => {
    const R = r / 255, G = g / 255, B = b / 255, mx = Math.max(R, G, B), mn = Math.min(R, G, B), l = (mx + mn) / 2, d = mx - mn;
    if (!d) return { h: 0, s: 0, l };
    const h = mx === R ? ((G - B) / d) % 6 : mx === G ? (B - R) / d + 2 : (R - G) / d + 4;
    return { h: (h * 60 + 360) % 360, s: d / (1 - Math.abs(2 * l - 1)), l };
  };
  const lemon = hsl({ r: 0xf7, g: 0xeb, b: 0x07 }).h;   // 53rd Street Express (routes.json), a route color: stars must not look like it
  for (const theme of ["light", "dark"]) {
    doc.documentElement.dataset.theme = theme;
    const mark = col("fav-mark"), ink = col("fav-ink"), edge = col("fav-edge"), land = col("map-land"), card = col("bg-card");
    if (!mark || !ink || !edge || !land || !card) { bad.push(`${theme}: unreadable favorite token`); continue; }
    const c = hsl(mark);
    if (!(c.h >= 42 && c.h <= 54 && c.s >= 0.9 && c.l >= 0.45 && L(mark) >= 0.5)) bad.push(`${theme} fav-mark is not a clear yellow: ${JSON.stringify(c)}`);
    if (!(Math.abs(c.h - lemon) >= 5)) bad.push(`${theme} fav-mark hue ${c.h.toFixed(1)} too close to 53rd Street's ${lemon.toFixed(1)}`);
    const star = ratio(over(ink, mark), mark);
    if (!(star >= 4.5)) bad.push(`${theme} star on the yellow disc: ${star.toFixed(2)}`);
    for (const [name, base] of [["map-land", land], ["bg-card", card]]) {
      // the visible boundary: on light the dark edge (composited over the surface), on dark the yellow itself
      const seen = theme === "light" ? ratio(over(edge, base), base) : ratio(mark, base);
      if (!(seen >= 3)) bad.push(`${theme} favorite star boundary on ${name}: ${seen.toFixed(2)} < 3`);
    }
  }
  f.remove();
  ok(!bad.length, bad.join("; "));
});
