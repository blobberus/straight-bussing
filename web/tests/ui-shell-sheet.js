// Tests for ui/sheet.js (D1): release math + DOM tests of the controller. Two resting states since 2026-10-12
// (owner: "remove the midway stop", "copy Google Maps"): collapsed (peek) and expanded (full).
import { test, eq, ok, near } from "./lib.js";
import { DETENTS, rubberBand, snapDetent, settleMs, velocity, stepDetent, createSheet } from "../js/ui/sheet.js";
import { bus } from "../js/core/events.js";

const S = { peek: 112, full: 800 };
const PHONE = "(min-width: 99999px)"; // force phone (detent) mode whatever the headless window size

test("sheet: rubberBand applies 0.3 resistance only past the ends", () => {
  eq(rubberBand(500, 112, 800), 500);
  near(rubberBand(900, 112, 800), 830);
  near(rubberBand(12, 112, 800), 82);
});

test("sheet: two resting states; the finger's last motion decides on release", () => {
  eq(DETENTS, ["peek", "full"]);
  eq(snapDetent(S, 500, -0.3), "full", "moving up -> expanded, wherever it is");
  eq(snapDetent(S, 700, 0.3), "peek", "moving down -> collapsed, even from near the top");
  eq(snapDetent(S, 150, -0.2), "full", "a short push up from collapsed expands");
  eq(snapDetent(S, 780, 2.5), "peek", "a fast swipe down collapses");
  eq(snapDetent(S, 450, 0.02, -1), "full", "held still at the end: the last movement (up) decides");
  eq(snapDetent(S, 450, 0, 1), "peek", "held still, last movement down");
  eq(snapDetent(S, 700, 0, 0), "full", "no motion at all: the nearer state");
  eq(snapDetent(S, 200, 0, 0), "peek");
});

test("sheet: settleMs shortens the animation for a fast flick so it starts at the finger's speed", () => {
  eq(settleMs(300, 0, 320), 320, "no velocity: normal duration");
  eq(settleMs(300, 0.05, 320), 320, "a slow release too");
  ok(settleMs(100, 2, 320) < 320 && settleMs(100, 2, 320) >= 160, "fast flick, short way: shorter");
  near(settleMs(100, 2, 320), 160, 0.5, "never below 160 ms");
  eq(settleMs(700, 1, 320), 320, "long way: the curve is already faster than the finger");
  eq(settleMs(300, 2, 120), 120, "reduced motion's short duration is left alone");
});

test("sheet: velocity uses the last 100 ms of samples", () => {
  eq(velocity([]), 0);
  eq(velocity([{ y: 0, t: 0 }]), 0);
  near(velocity([{ y: 0, t: 0 }, { y: 100, t: 400 }, { y: 150, t: 450 }, { y: 200, t: 500 }]), 1);
  near(velocity([{ y: 300, t: 0 }, { y: 250, t: 50 }]), -1);
});

test("sheet: stepDetent goes to the other state", () => {
  eq(stepDetent("peek", -1), "peek");
  eq(stepDetent("peek", 1), "full");
  eq(stepDetent("full", 1), "full");
  eq(stepDetent("full", -1), "peek");
  eq(stepDetent("bogus", 0), "peek");
});

function makeSheet(initial) {
  const sheetEl = document.createElement("section");
  sheetEl.className = "sheet";
  sheetEl.innerHTML = '<header class="sheet-head"><div class="grab"></div><div class="titleline"><button class="back" type="button">Back</button><h1>Title</h1><span class="titleright">53RD 4 min</span></div></header><div class="sheet-content"></div>';
  document.body.appendChild(sheetEl);
  const sh = createSheet({ sheetEl, headEl: sheetEl.querySelector("header"), contentEl: sheetEl.querySelector(".sheet-content"), initial, panelMedia: PHONE });
  return { sheetEl, sh, head: sheetEl.querySelector("header"), grab: sheetEl.querySelector(".grab"), done: () => { sh.destroy(); sheetEl.remove(); } };
}

test("sheet: controller starts collapsed, toggles on taps, keeps its state for a 'half' request, emits sheet:inset", () => {
  const insets = [];
  const off = bus.on("sheet:inset", (p) => insets.push(p.px));
  const { sheetEl, sh, grab, done } = makeSheet();
  const changes = [];
  sh.onChange((d) => changes.push(d));
  eq([sh.getDetent(), sheetEl.dataset.detent, sheetEl.dataset.rest], ["peek", "peek", "peek"], "starts collapsed, map first");
  eq(grab.getAttribute("aria-valuetext"), "Collapsed");
  sh.setDetent("half");
  eq(sh.getDetent(), "peek", "no midway stop: 'half' keeps the current state");
  sh.setDetent("nonsense");
  eq(sh.getDetent(), "peek");
  grab.click();
  eq(sh.getDetent(), "full", "a tap on the grab bar expands");
  sh.setDetent("half");
  eq(sh.getDetent(), "full", "and keeps expanded");
  grab.click();
  eq(sh.getDetent(), "peek", "a second tap collapses");
  sheetEl.querySelector("h1").click();
  eq(sh.getDetent(), "full", "a tap on a collapsed header expands");
  ok(sh.stepDown());
  eq(sh.getDetent(), "peek");
  ok(!sh.stepDown(), "already collapsed");
  ok(insets.length >= 3 && insets.every((n) => typeof n === "number" && n >= 0), "inset emitted on settle: " + insets.length);
  eq(changes, ["full", "peek", "full", "peek"]);
  off();
  done();
});

test("sheet: grabber is an adjustable control: Resize panel, Collapsed / Expanded (iOS parity)", () => {
  const { sh, grab: g, done } = makeSheet("full");
  const at = (k) => g.getAttribute(k);
  eq([at("role"), at("aria-label"), at("aria-orientation"), at("aria-valuemin"), at("aria-valuemax"), at("tabindex")], ["slider", "Resize panel", "vertical", "0", "1", "0"]);
  eq([at("aria-valuenow"), at("aria-valuetext")], ["1", "Expanded"]);
  ok(!g.hasAttribute("aria-expanded"), "no aria-expanded on a slider");
  const key = (k) => { const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }); g.dispatchEvent(e); return e.defaultPrevented; };
  const seen = [];
  for (const k of ["ArrowDown", "ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", "ArrowLeft", "ArrowRight", "Enter", " "]) {
    ok(key(k), k + " handled");
    seen.push(at("aria-valuetext"));
  }
  eq(seen, ["Collapsed", "Collapsed", "Expanded", "Collapsed", "Expanded", "Collapsed", "Expanded", "Collapsed", "Expanded", "Collapsed", "Expanded"]);
  eq([sh.getDetent(), at("aria-valuenow")], ["full", "1"]);
  ok(!key("a"), "other keys pass through");
  done();
});

const tick = () => new Promise((r) => setTimeout(r, 0));   // headless can starve requestAnimationFrame
const pointer = (el, type, y, id = 7, kind = "mouse") => el.dispatchEvent(new PointerEvent(type, { pointerId: id, clientY: y, bubbles: true, cancelable: true, pointerType: kind, isPrimary: true, button: 0 }));

test("sheet: while held it follows the finger anywhere; release follows the last motion; cancel restores", async () => {
  const { sheetEl, sh, head, done } = makeSheet("peek");
  pointer(head, "pointerdown", 600);
  pointer(head, "pointermove", 580);
  ok(sheetEl.classList.contains("dragging"), "dragging class while moving");
  pointer(head, "pointermove", 400);
  ok(parseFloat(sheetEl.style.getPropertyValue("--drag")) < -150, "the sheet is part way up, wherever the finger is: " + sheetEl.style.getPropertyValue("--drag"));
  pointer(head, "pointerup", 400);
  ok(!sheetEl.classList.contains("dragging"));
  eq(sheetEl.style.getPropertyValue("--drag"), "");
  eq(sh.getDetent(), "full", "last motion up: expanded (no midway stop)");
  pointer(head, "pointerdown", 300);
  pointer(head, "pointermove", 360);
  pointer(head, "pointermove", 420);
  pointer(head, "pointerup", 420);
  eq(sh.getDetent(), "peek", "last motion down: collapsed");
  pointer(head, "pointerdown", 600);
  pointer(head, "pointermove", 500);
  pointer(head, "pointercancel", 500);
  eq(sh.getDetent(), "peek", "cancel never changes the state");
  eq(sheetEl.style.getPropertyValue("--drag"), "");
  await tick();
  done();
});

test("sheet: pull up, then back down a little before letting go: it collapses (the last motion wins)", async () => {
  const { sh, head, done } = makeSheet("peek");
  pointer(head, "pointerdown", 600);
  for (const y of [580, 520, 450, 380, 330]) pointer(head, "pointermove", y);
  for (const y of [340, 352, 366]) pointer(head, "pointermove", y);   // the finger turns back down
  await new Promise((r) => setTimeout(r, 140));                          // and stops before lifting
  pointer(head, "pointerup", 366);
  eq(sh.getDetent(), "peek");
  done();
});

test("sheet: the title line and the Back button start a drag too (the whole header strip)", async () => {
  const { sh, sheetEl, done } = makeSheet("peek");
  const title = sheetEl.querySelector("h1"), right = sheetEl.querySelector(".titleright"), backBtn = sheetEl.querySelector(".back");
  for (const [el, id] of [[title, 21], [right, 22], [backBtn, 23]]) {
    sh.setDetent("peek");
    pointer(el, "pointerdown", 600, id);
    pointer(document.body, "pointermove", 560, id);   // off the header at once
    pointer(document.body, "pointermove", 420, id);
    pointer(document.body, "pointerup", 400, id);
    eq(sh.getDetent(), "full", (el.className || el.tagName) + " drags the sheet");
  }
  await tick();
  done();
});

test("sheet: touch on the header claims the gesture (touchmove default prevented) and drags", async () => {
  if (typeof Touch !== "function" || typeof TouchEvent !== "function") return ok(true, "no Touch constructor here");
  const { sh, head, sheetEl, done } = makeSheet("full");
  const title = sheetEl.querySelector("h1");
  const te = (type, y) => {
    const t = new Touch({ identifier: 5, target: title, clientX: 100, clientY: y });
    const e = new TouchEvent(type, { touches: type === "touchend" ? [] : [t], changedTouches: [t], targetTouches: type === "touchend" ? [] : [t], bubbles: true, cancelable: true });
    title.dispatchEvent(e);
    return e;
  };
  te("touchstart", 200);
  const m1 = te("touchmove", 230);
  ok(m1.defaultPrevented, "iOS cannot turn it into a page pan");
  te("touchmove", 300);
  te("touchmove", 380);
  te("touchend", 380);
  eq(sh.getDetent(), "peek", "dragged down from the title: collapsed");
  await tick();
  done();
});
