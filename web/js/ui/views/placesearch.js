/**
 * @module ui/views/placesearch
 * Place search shared by the three place-search UIs: Directions suggestions, Current trip "Type an address or
 * place" and Routes to station "Type an address or place".
 * Speed: on-device results (data/places.js over data/places.json) on EVERY keystroke, no debounce; Photon only
 * after a PHOTON_MS pause, only when the local index has fewer than 5 matches (or for "search exactly"), with
 * stale requests aborted and results cached (data/geocode.js). data/places.json is preloaded in idle time
 * right after start (importing this module schedules it), so the first search is instant too.
 * Spelling: when results are for a corrected query that is a long stretch (assumed.big), a small note says
 * "Showing results for <b>Regenstein</b>" with a button "Search for “regensteen” instead" (exact search: as
 * typed, local + Photon); in exact mode a "Did you mean Regenstein?" button goes back.
 */
import { esc } from "../../core/esc.js";
import { searchPlaces, localPlaces, debounce } from "../../data/geocode.js";
import { loadPlaces, preloadPlaces, norm } from "../../data/places.js";

/** Pause before asking Photon (ms); local results never wait. */
export const PHOTON_MS = 250;
/** Local matches that make Photon unnecessary (privacy: nothing is sent). */
const ENOUGH = 5;
const PIN = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>';

/** Injectable place-search backend shared by the picker, Nearby and Directions (tests stub it). */
export const placeDeps = { search: searchPlaces, local: localPlaces, load: () => loadPlaces() };

/**
 * Place search state machine. query(q) updates `state` synchronously with on-device results (render right
 * after calling it); onChange fires only for results that arrive later (Photon, or the index finishing loading).
 * state.status: '' settled | 'busy' Photon (or the index) still coming, items may already be listed | 'err' Photon failed and nothing found.
 * @param {(s:object)=>void} onChange
 * @param {{search?:Function, local?:Function, load?:Function, ms?:number}} [opts] defaults: placeDeps
 * @returns {{state:{q:string, items:object[], status:string, assumed:null|{from:string,to:string,big:boolean}, exact:boolean, fix:null|object},
 *   query(q:string):void, exact(on?:boolean):void, cancel():void}}
 */
export function createPlaceSearch(onChange, { search = (q, o) => placeDeps.search(q, o), local = (q, o) => placeDeps.local(q, o), load = () => placeDeps.load(), ms = PHOTON_MS } = {}) {
  const st = { q: "", items: [], status: "", assumed: null, exact: false, fix: null };
  let ctl = null, tok = 0, pending = false;
  const remote = debounce(async (q, exact, my) => {
    ctl?.abort();
    const mine = (ctl = new AbortController());
    let r;
    try { r = await search(q, { signal: mine.signal, exact }); } catch (e) { r = { items: [], error: "network" }; }
    if (mine.signal.aborted || my !== tok) return;
    pending = false;
    const items = Array.isArray(r) ? r : r?.items || [];
    const err = !Array.isArray(r) && r?.error && r.error !== "aborted";
    st.items = items; st.assumed = exact ? null : r?.assumed || null;
    st.status = err && !items.length ? "err" : "";
    onChange(st);
  }, ms);
  const stop = () => { tok++; pending = false; remote.cancel(); ctl?.abort(); ctl = null; };
  /** On-device results now; null while the index loads, else whether Photon is still wanted. */
  const fromLocal = (q) => {
    let r = null;
    try { r = local(q, { exact: st.exact }); } catch (e) { r = null; }
    if (!r) return null;
    st.items = r.items || []; st.assumed = st.exact ? null : r.assumed || null;
    return st.exact || st.items.length < ENOUGH;
  };
  function start(q, now) {
    stop();
    const my = tok, need = fromLocal(q);
    if (need === null) {
      st.items = []; st.assumed = null;
      Promise.resolve().then(load).catch(() => {}).then(() => {
        if (my !== tok) return;
        fromLocal(q);                      // stays empty if data/places.json is missing (Photon may still answer)
        if (!pending) st.status = "";
        onChange(st);
      });
    }
    pending = q.length >= 3 && need !== false;
    st.status = pending || need === null ? "busy" : "";
    if (pending) { remote(q, st.exact, my); if (now) remote.flush(); }
  }
  return {
    state: st,
    query(q) {
      q = String(q || "").trim();
      if (q === st.q && st.status !== "err") return;
      st.q = q; st.exact = false; st.fix = null;
      if (norm(q).length < 2) { stop(); st.items = []; st.status = ""; st.assumed = null; return; }
      start(q, false);
    },
    /** Search exactly as typed (on = true), or go back to the spelling correction (on = false). */
    exact(on = true) {
      if (norm(st.q).length < 2 || st.exact === !!on) return;
      if (on) st.fix = st.assumed;
      st.exact = !!on;
      start(st.q, true);
    },
    /** Stop pending work (view unmount). Unfinished results are dropped so the same text searches again. */
    cancel() { stop(); if (st.status === "busy") { st.q = ""; st.status = ""; } },
  };
}

/**
 * The small "search assumption" note above the results ('' when there is nothing to say).
 * @param {object} s place-search state
 * @param {string} action data-action of the button (each view registers its own; data-exact="1" | "0")
 * @returns {string}
 */
export function assumeNoteHTML(s, action) {
  if (s.exact && s.fix) {
    return `<div class="v-assume" data-assume><p class="v-assume-txt" role="status">Showing results for &ldquo;${esc(s.q)}&rdquo;</p>`
      + `<button type="button" class="v-link v-assume-btn" data-action="${action}" data-exact="0">Did you mean ${esc(s.fix.to)}?</button></div>`;
  }
  const a = s.assumed;
  if (s.exact || !a || !a.big) return "";
  return `<div class="v-assume" data-assume><p class="v-assume-txt" role="status">Showing results for <b>${esc(a.to)}</b></p>`
    + `<button type="button" class="v-link v-assume-btn" data-action="${action}" data-exact="1">Search for &ldquo;${esc(a.from)}&rdquo; instead</button></div>`;
}

/** Rows for a list of places; each button carries data-action + data-i. */
export function placeRows(items, action) {
  return '<div class="v-card">' + items.map((p, i) => `<button type="button" class="v-row" data-action="${action}" data-i="${i}"><span class="v-ic" aria-hidden="true">${PIN}</span><span class="v-grow"><span class="v-prim">${esc(p.label)}</span><span class="v-sec">${esc(p.sub || "")}</span></span></button>`).join("") + "</div>";
}

/**
 * Results list for the "Type an address or place" fields (Routes to station, Current trip).
 * @param {object} s place-search state
 * @param {string} q typed text
 * @param {string} action row action (data-i = index into s.items)
 * @param {string} exactAction note button action
 * @param {string} errHTML shown when Photon failed and nothing was found
 * @returns {string}
 */
export function placeListHTML(s, q, action, exactAction, errHTML) {
  if (norm(q).length < 2) return '<p class="v-hint">Type at least 2 letters of an address, building or place.</p>';
  const note = assumeNoteHTML(s, exactAction);
  if (!s.items.length) {
    if (s.status === "busy") return note + '<p class="v-hint" role="status">Searching places&hellip;</p>';
    if (s.status === "err") return errHTML;
    if (q.trim().length < 3) return '<p class="v-hint">Keep typing to search more places.</p>';
    return note + '<div class="v-empty"><b>No places found</b><span>Check the spelling or try a nearby landmark.</span></div>';
  }
  return note + placeRows(s.items, action) + (s.status === "busy" ? '<p class="v-fine v-more" role="status">Searching more places&hellip;</p>' : "");
}

/** Replace a region's markup keeping keyboard focus (lives in ui/actions.js, shared with main.js and Routes). */
export { setHTMLKeepFocus } from "../actions.js";

/**
 * After a note button: keep keyboard focus on the note (its replacement button).
 * @param {Element|null} region
 */
export function focusNote(region) {
  region?.querySelector?.("[data-assume] button")?.focus({ preventScroll: true });
}

preloadPlaces();
