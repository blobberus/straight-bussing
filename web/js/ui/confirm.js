/**
 * @module ui/confirm
 * A small modal confirmation popup (native <dialog>, styled like the app's other dialogs). Used for
 * destructive actions such as deleting a custom route: Cancel has focus first, and Escape or a tap
 * outside the popup cancels, so the destructive button is never the default.
 */
import { esc } from "../core/esc.js";

/**
 * Ask the user to confirm. Resolves true only when the confirm button was pressed.
 * @param {{title:string, body?:string, confirmLabel?:string, danger?:boolean}} o
 * @returns {Promise<boolean>}
 */
export function confirmDialog({ title, body = "", confirmLabel = "OK", danger = false } = {}) {
  if (typeof document === "undefined" || typeof HTMLDialogElement === "undefined") return Promise.resolve(false);
  const opener = document.activeElement;
  const dlg = document.createElement("dialog");
  dlg.className = "v-dialog v-confirm";
  dlg.setAttribute("role", "alertdialog");
  dlg.setAttribute("aria-labelledby", "v-confirm-t");
  if (body) dlg.setAttribute("aria-describedby", "v-confirm-b");
  dlg.innerHTML = `<h2 class="v-dlg-title" id="v-confirm-t">${esc(title)}</h2>${body ? `<p class="v-sec v-confirm-b" id="v-confirm-b">${esc(body)}</p>` : ""}`
    + '<div class="v-actions v-confirm-acts"><button type="button" class="v-btn v-btn--secondary" data-confirm="no">Cancel</button>'
    + `<button type="button" class="v-btn ${danger ? "v-btn--danger" : "v-btn--primary"}" data-confirm="yes">${esc(confirmLabel)}</button></div>`;
  document.body.appendChild(dlg);
  return new Promise((resolve) => {
    let done = false;
    // settle straight from the button / key: don't wait for the async "close" event
    const finish = (yes) => {
      if (done) return;
      done = true;
      resolve(yes);
      try { if (dlg.open) dlg.close(yes ? "yes" : "no"); } catch (e) { /* already closed */ }
      dlg.remove();
      if (opener && opener.isConnected) opener.focus?.({ preventScroll: true });
    };
    dlg.addEventListener("click", (e) => {
      if (e.target === dlg) { finish(false); return; }       // tap on the backdrop
      const b = e.target.closest?.("[data-confirm]");
      if (b) finish(b.dataset.confirm === "yes");
    });
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); finish(false); });   // Escape
    dlg.addEventListener("close", () => finish(dlg.returnValue === "yes"));
    try { dlg.showModal(); } catch (e) { dlg.setAttribute("open", ""); }
    dlg.querySelector('[data-confirm="no"]').focus();
  });
}
