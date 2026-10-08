// Fetch stubs shared by the data-layer tests (Agent B).

/**
 * A minimal Response-like object.
 * @param {*} body JSON body (or a function that throws, to simulate bad JSON)
 * @param {number} [status=200]
 */
export function res(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => (typeof body === 'function' ? body() : body),
  };
}

/** Promise that never resolves unless the signal aborts (then rejects with AbortError). */
export function hang(signal) {
  return new Promise((_, rej) => {
    const fail = () => rej(new DOMException('aborted', 'AbortError'));
    if (signal?.aborted) fail();
    signal?.addEventListener('abort', fail, { once: true });
  });
}

/**
 * Build a recording fetch stub. handler(url, init) returns a res(...) / Promise / throws.
 * @param {(url:string, init:object) => any} handler
 */
export function stubFetch(handler) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  };
  f.calls = calls;
  return f;
}

/** Wait ms (real/virtual time). */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Let queued microtasks (store subscribers) flush. */
export const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * Override document.hidden for visibility tests; returns restore().
 * @param {boolean} v
 */
export function setHidden(v) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => v });
  document.dispatchEvent(new Event('visibilitychange'));
  return () => { delete document.hidden; };
}

/** Sample live feeds. */
export function feeds(ts = 1700000000) {
  return {
    vehiclePositions: {
      header: { timestamp: ts },
      entity: [
        { vehicle: { vehicle: { id: 'v1', label: '101' }, position: { latitude: 41.79, longitude: -87.6, bearing: 90 }, trip: { trip_id: 't1', route_id: 'r1' }, timestamp: String(ts - 5) } },
        { vehicle: { vehicle: { id: 'v2' } } }, // no position: dropped
      ],
    },
    tripUpdates: {
      header: { timestamp: ts },
      entity: [{ trip_update: { trip: { trip_id: 't1', route_id: 'r1' }, vehicle: { id: 'v1', label: '101' },
        stop_time_update: [{ stop_id: 's1', arrival: { time: String(ts + 60) } }, { stop_id: 's2', departure: { time: ts + 120 } }] } }],
    },
    serviceAlerts: { header: { timestamp: ts }, entity: [{ alert: { header_text: 'Detour' } }] },
  };
}

/** Name of the feed in a Passio URL ('vehiclePositions' | 'tripUpdates' | 'serviceAlerts'). */
export const feedName = (url) => (url.match(/([A-Za-z]+)\.json/) || [])[1];
