// Tests for ui/frame.js (desktop phone frame scale) and ui/sheet.js drag math under a scaled frame (SHELL).
import { test, eq, ok, near } from "./lib.js";
import { frameScale, FRAME_W, FRAME_H, FRAME_MEDIA, FRAME_MARGIN } from "../js/ui/frame.js";
import { createSheet, PANEL_MEDIA } from "../js/ui/sheet.js";

const NEVER = "(min-width: 100000px)";

test("frame: iPhone logical size and media queries", () => {
  eq([FRAME_W, FRAME_H], [393, 852]);
  ok(FRAME_MEDIA.includes("min-width: 521px"), FRAME_MEDIA);
  ok(PANEL_MEDIA.includes("min-width: 768px") && PANEL_MEDIA.includes("max-height"), "panel only on wide + short screens");
});

test("frame: scale fits the window, never above 1, keeps a margin", () => {
  eq(frameScale(1440, 1200), 1, "tall window: full size");
  near(frameScale(1440, 900), (900 - 2 * FRAME_MARGIN) / FRAME_H, 0.002);
  near(frameScale(1280, 720), (720 - 2 * FRAME_MARGIN) / FRAME_H, 0.002);
  ok(frameScale(600, 600) < 1 && frameScale(600, 600) > 0.5);
  ok(frameScale(10, 10) >= 0.3, "clamped");
});

test("sheet: drag distance is measured in the frame's CSS px when the frame is scaled", () => {
  const wrap = document.createElement("div");
  wrap.style.cssText = "position:fixed;left:0;top:0;width:400px;height:800px;transform:scale(.5);transform-origin:0 0";
  const sheetEl = document.createElement("section");
  sheetEl.className = "sheet";
  sheetEl.innerHTML = '<header class="sheet-head"><button class="grab" type="button"></button><h1>T</h1></header><div class="sheet-content"></div>';
  wrap.appendChild(sheetEl);
  document.body.appendChild(wrap);
  const head = sheetEl.querySelector("header");
  const sh = createSheet({ sheetEl, headEl: head, contentEl: sheetEl.querySelector(".sheet-content"), initial: "half", panelMedia: NEVER });
  const pe = (type, y) => head.dispatchEvent(new PointerEvent(type, { pointerId: 9, clientY: y, bubbles: true, pointerType: "touch", isPrimary: true }));
  pe("pointerdown", 300);
  pe("pointermove", 290);
  pe("pointermove", 270); // 30 screen px up at scale .5 = 60 CSS px
  const d = parseFloat(sheetEl.style.getPropertyValue("--drag"));
  near(d, -60, 0.5, "--drag in CSS px: " + d);
  pe("pointercancel", 270);
  eq(sh.getDetent(), "half");
  sh.destroy();
  wrap.remove();
});
