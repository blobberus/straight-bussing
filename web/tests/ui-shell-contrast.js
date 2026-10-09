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
