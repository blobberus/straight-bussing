/**
 * @module core/throttle
 * "Run at most every N ms, and never drop the latest request": a leading-edge throttle with one trailing run
 * and a gate. Used by Directions to re-plan in the background on live updates at most every 8 s (the iOS
 * AppModel.refreshDirections rule, dirRefreshS), so option cards don't reshuffle on every poll. No DOM; the
 * clock and timer are injectable so tests never wait.
 */

/**
 * @param {() => void} run the work
 * @param {{everyMs:number, gate?:() => 'go'|'defer'|'skip', now?:() => number, later?:(fn:Function, ms:number) => any,
 *   cancel?:(id:any) => void, retryMs?:number}} o
 *   gate: 'skip' drops this request (nothing to do), 'defer' retries after retryMs (busy), 'go' runs if allowed;
 *   now: ms clock (default Date.now); later / cancel: timer (default setTimeout / clearTimeout)
 * @returns {{poke():boolean, reset():void, pending():boolean}} poke: request a run (true if it ran now);
 *   reset: forget the last run and cancel a pending one
 */
export function createThrottle(run, { everyMs, gate = () => "go", now = () => Date.now(), later = (f, ms) => setTimeout(f, ms),
  cancel = (id) => clearTimeout(id), retryMs = 1000 }) {
  let last = -Infinity, timer = null;
  const fire = () => { timer = null; poke(); };
  function poke() {
    const g = gate();
    if (g === "skip") return false;
    const wait = everyMs - (now() - last);
    if (g === "defer" || wait > 0) {
      if (timer === null) timer = later(fire, Math.max(g === "defer" ? retryMs : 0, wait));
      return false;
    }
    last = now();
    run();
    return true;
  }
  return {
    poke,
    reset() { last = -Infinity; if (timer !== null) cancel(timer); timer = null; },
    pending: () => timer !== null,
  };
}
