// Tests for ui/sheet.js (D1): pure snap math + a DOM smoke test of the controller.
import { test, eq, ok, near } from "./lib.js";
import { DETENTS, rubberBand, snapDetent, velocity, stepDetent, createSheet } from "../js/ui/sheet.js";
import { bus } from "../js/core/events.js";

const S = { peek: 112, half: 400, full: 800 };
const PHONE = "(min-width: 99999px)"; // force phone (detent) mode whatever the headless window size

test("sheet: rubberBand applies 0.3 resistance only past the ends", () => {
  eq(rubberBand(500, 112, 800), 500);
  near(rubberBand(900, 112, 800), 830);
  near(rubberBand(12, 112, 800), 82);
});

test("sheet: slow release snaps to the nearest detent of the projected position", () => {
  eq(snapDetent(S, 410, 0), "half");
  eq(snapDetent(S, 700, 0), "full");
  eq(snapDetent(S, 200, 0), "peek");
  // slow downward motion (0.4 px/ms) projects 80 px further down: 300 -> 220 -> peek
  eq(snapDetent(S, 300, 0.4), "peek");
  // slow upward motion projects up: 560 + 80 = 640 -> full
  eq(snapDetent(S, 560, -0.4), "full");
});

test("sheet: a flick goes to the next detent in that direction", () => {
  eq(snapDetent(S, 420, -0.8), "full", "flick up from just above half");
  eq(snapDetent(S, 390, 0.8), "peek", "flick down from just below half");
  eq(snapDetent(S, 760, 0.9), "half", "flick down from near full");
  eq(snapDetent(S, 900, -2), "full", "already past full");
  eq(snapDetent(S, 50, 2), "peek", "already below peek");
});

test("sheet: velocity uses the last 100 ms of samples", () => {
  eq(velocity([]), 0);
  eq(velocity([{ y: 0, t: 0 }]), 0);
  near(velocity([{ y: 0, t: 0 }, { y: 100, t: 400 }, { y: 150, t: 450 }, { y: 200, t: 500 }]), 1);
  near(velocity([{ y: 300, t: 0 }, { y: 250, t: 50 }]), -1);
});

test("sheet: stepDetent clamps", () => {
  eq(DETENTS, ["peek", "half", "full"]);
  eq(stepDetent("peek", -1), "peek");
  eq(stepDetent("peek", 1), "half");
  eq(stepDetent("full", 1), "full");
  eq(stepDetent("bogus", 1), "half");
});

test("sheet: controller sets data-detent, aria-expanded, emits sheet:inset, keyboard steps", async () => {
  const sheetEl = document.createElement("section");
  sheetEl.className = "sheet";
  sheetEl.innerHTML = '<header class="sheet-head"><button class="grab" type="button"></button><h1>T</h1></header><div class="sheet-content"></div>';
  document.body.appendChild(sheetEl);
  const insets = [];
  const off = bus.on("sheet:inset", (p) => insets.push(p.px));
  const sh = createSheet({ sheetEl, headEl: sheetEl.querySelector("header"), contentEl: sheetEl.querySelector(".sheet-content"), panelMedia: PHONE });
  const changes = [];
  sh.onChange((d) => changes.push(d));
  eq(sh.getDetent(), "half");
  eq(sheetEl.dataset.detent, "half");
  sh.setDetent("peek");
  eq(sheetEl.dataset.detent, "peek");
  eq(sheetEl.querySelector(".grab").getAttribute("aria-expanded"), "false");
  sh.setDetent("nonsense");
  eq(sh.getDetent(), "peek");
  const grab = sheetEl.querySelector(".grab");
  grab.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
  eq(sh.getDetent(), "half");
  grab.click(); // tap cycles half -> full
  eq(sh.getDetent(), "full");
  ok(sh.stepDown());
  eq(sh.getDetent(), "half");
  ok(insets.length >= 3, "inset emitted on settle: " + insets.length);
  ok(insets.every((n) => typeof n === "number" && n >= 0));
  eq(changes.slice(0, 2), ["peek", "half"]);
  // tapping the header area at peek expands to half
  sh.setDetent("peek");
  sheetEl.querySelector("h1").click();
  eq(sh.getDetent(), "half");
  off();
  sh.destroy();
  sheetEl.remove();
});

test("sheet: pointer drag far up snaps to full; pointercancel restores", () => {
  const sheetEl = document.createElement("section");
  sheetEl.className = "sheet";
  sheetEl.innerHTML = '<header class="sheet-head"><button class="grab" type="button"></button><h1>T</h1></header><div class="sheet-content"></div>';
  document.body.appendChild(sheetEl);
  const head = sheetEl.querySelector("header");
  const sh = createSheet({ sheetEl, headEl: head, contentEl: sheetEl.querySelector(".sheet-content"), initial: "half", panelMedia: PHONE });
  ok(!sh.isPanel());
  const pe = (type, y) => head.dispatchEvent(new PointerEvent(type, { pointerId: 7, clientY: y, bubbles: true, pointerType: "touch", isPrimary: true }));
  pe("pointerdown", 500);
  pe("pointermove", 480);
  ok(sheetEl.classList.contains("dragging"), "dragging class while moving");
  ok(sheetEl.style.getPropertyValue("--drag") !== "", "--drag set");
  pe("pointermove", 100);
  pe("pointerup", -400); // far past full: settles on full whatever the viewport size
  ok(!sheetEl.classList.contains("dragging"));
  eq(sheetEl.style.getPropertyValue("--drag"), "");
  eq(sh.getDetent(), "full");
  pe("pointerdown", 300);
  pe("pointermove", 500);
  pe("pointercancel", 500);
  eq(sh.getDetent(), "full", "cancel never changes detent");
  eq(sheetEl.style.getPropertyValue("--drag"), "");
  sh.destroy();
  sheetEl.remove();
});
