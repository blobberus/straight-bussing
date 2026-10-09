// QA regression (2026-10-09): the self-update reload (ui/update.js) must never wipe a trip in progress.
// store.journey is in memory only, so reloading mid-ride (new deploy + app sent to the background) dropped the
// rider's live trip timeline. The reload now waits until the trip has ended and the app is hidden again.
import { test, eq } from "./lib.js";
import { startUpdates } from "../js/ui/update.js";
import { store } from "../js/state.js";

test("self-update: reloads in the background, but not while a trip is in progress", async () => {
  const L = {}, fake = { controller: {}, register: async () => ({ update: async () => {} }), addEventListener: (t, fn) => { L[t] = fn; } };
  const realSw = Object.getOwnPropertyDescriptor(navigator, "serviceWorker"), realHidden = Object.getOwnPropertyDescriptor(document, "hidden");
  let hidden = false, reloads = 0;
  Object.defineProperty(navigator, "serviceWorker", { value: fake, configurable: true });
  Object.defineProperty(document, "hidden", { get: () => hidden, configurable: true });
  const prevJourney = store.get().journey;
  try {
    startUpdates({ reload: () => { reloads++; } });
    store.set({ journey: { kind: "plan", rids: ["R1"], label: "To X", legs: [] } });
    L.controllerchange();                                    // new version took control while the app is visible
    hidden = true; document.dispatchEvent(new Event("visibilitychange"));
    eq(reloads, 0, "no reload mid-trip, even in the background");
    hidden = false; document.dispatchEvent(new Event("visibilitychange"));
    store.set({ journey: null });                            // trip ended
    hidden = true; document.dispatchEvent(new Event("visibilitychange"));
    eq(reloads, 1, "reloads the next time the app is hidden after the trip");
    hidden = true; L.controllerchange();
    eq(reloads, 2, "no trip: a takeover while hidden reloads at once");
  } finally {
    if (realSw) Object.defineProperty(navigator, "serviceWorker", realSw); else delete navigator.serviceWorker;
    if (realHidden) Object.defineProperty(document, "hidden", realHidden); else delete document.hidden;
    store.set({ journey: prevJourney });
  }
});
