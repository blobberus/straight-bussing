/**
 * @module ui/frame
 * Desktop / tablet "iPhone frame" (SHELL). On windows matching FRAME_MEDIA, css/base.css draws the app
 * in a 393 x 852 CSS px phone frame; this module shrinks it uniformly (--frame-k on <html>) when the
 * window is too small to show it whole, so the page never scrolls. Phones (narrow windows) are untouched.
 * The frame keeps its layout size, so Leaflet and the sheet measure 393 x 852 at any scale; pointer
 * math that uses clientX/Y must divide by the scale (ui/sheet.js does).
 */

/** Must match the media query in css/tokens.css and css/base.css. */
export const FRAME_MEDIA = "(min-width: 521px) and (min-height: 560px)";
/** Logical iPhone 15/16 size in CSS px. */
export const FRAME_W = 393, FRAME_H = 852;
/** Space kept around the frame (bezel + breathing room), px. */
export const FRAME_MARGIN = 28;

/**
 * Uniform scale that fits the frame in a window (never above 1).
 * @param {number} winW
 * @param {number} winH
 * @returns {number}
 */
export function frameScale(winW, winH) {
  const k = Math.min(1, (winH - 2 * FRAME_MARGIN) / FRAME_H, (winW - 2 * FRAME_MARGIN) / FRAME_W);
  return Math.max(0.3, Math.round(k * 1000) / 1000);
}

/**
 * Is the phone frame active right now?
 * @returns {boolean}
 */
export function frameActive() {
  try { return typeof matchMedia === "function" && matchMedia(FRAME_MEDIA).matches; } catch (e) { return false; }
}

/**
 * Keep --frame-k current on resize. Safe to call once at boot.
 * @param {HTMLElement} [root] element that gets the variable (default <html>)
 * @returns {() => void} stop
 */
export function initFrame(root = document.documentElement) {
  const apply = () => {
    if (frameActive()) root.style.setProperty("--frame-k", String(frameScale(innerWidth, innerHeight)));
    else root.style.removeProperty("--frame-k");
    root.classList.toggle("is-framed", frameActive());
  };
  apply();
  addEventListener("resize", apply);
  return () => removeEventListener("resize", apply);
}
