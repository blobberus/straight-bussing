/**
 * Minimal browser test harness (no Node). Used by every web/tests/*.test.html page.
 *
 * Usage in a page:
 *   <pre id="result"></pre>
 *   <script type="module" src="lib.js"></script>           <!-- optional but recommended: reports import errors -->
 *   <script type="module" src="core-geo.js"></script>      <!-- files call test(...) at import time -->
 *
 * Tests run automatically after the window 'load' event (all module scripts have executed by then).
 * When finished: document.title = "TESTS pass=N fail=M" and <pre id="result"> holds a JSON summary
 * {pass, fail, failures:[{name, error}], tests:[{name, ok, ms}]}. tools/run_browser_tests.py parses both.
 * Pages that need to delay the start can call holdRun() and later run().
 */

const tests = [];
const pageErrors = [];
let started = false;
let held = false;
let loaded = false;

/** Per-test timeout in ms for async tests. */
export const TEST_TIMEOUT_MS = 8000;

/**
 * Register a test. fn may be async. A test fails if it throws/rejects or times out.
 * @param {string} name
 * @param {() => (void|Promise<void>)} fn
 */
export function test(name, fn) {
  tests.push({ name: String(name), fn });
}

function show(v) {
  try {
    return JSON.stringify(v);
  } catch (e) {
    return String(v);
  }
}

function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (a instanceof Set && b instanceof Set) return a.size === b.size && [...a].every((x) => b.has(x));
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
}

/**
 * Assert deep (structural) equality.
 * @param {*} actual
 * @param {*} expected
 * @param {string} [msg]
 */
export function eq(actual, expected, msg) {
  if (!deepEqual(actual, expected)) {
    throw new Error((msg ? msg + ": " : "") + "expected " + show(expected) + " got " + show(actual));
  }
}

/**
 * Assert truthy.
 * @param {*} cond
 * @param {string} [msg]
 */
export function ok(cond, msg) {
  if (!cond) throw new Error(msg || "expected truthy, got " + show(cond));
}

/**
 * Assert |actual - expected| <= tol.
 * @param {number} actual
 * @param {number} expected
 * @param {number} [tol=1e-6]
 * @param {string} [msg]
 */
export function near(actual, expected, tol = 1e-6, msg) {
  if (typeof actual !== "number" || !(Math.abs(actual - expected) <= tol)) {
    throw new Error((msg ? msg + ": " : "") + "expected " + expected + " +/- " + tol + " got " + show(actual));
  }
}

/**
 * Assert fn throws (sync) or rejects (async).
 * @param {() => any} fn
 * @param {string} [msg]
 */
export async function throws(fn, msg) {
  let threw = false;
  try {
    await fn();
  } catch (e) {
    threw = true;
  }
  if (!threw) throw new Error(msg || "expected an exception");
}

/** Prevent the automatic start; call run() yourself. */
export function holdRun() {
  held = true;
}

function withTimeout(p, ms) {
  let id;
  const t = new Promise((_, rej) => {
    id = setTimeout(() => rej(new Error("timeout after " + ms + " ms")), ms);
  });
  return Promise.race([p, t]).finally(() => clearTimeout(id));
}

/**
 * Run all registered tests sequentially and publish the summary. Idempotent.
 * @returns {Promise<{pass:number, fail:number}>}
 */
export async function run() {
  if (started) return null;
  started = true;
  const results = [];
  const failures = [];
  if (!tests.length) failures.push({ name: "setup", error: "no tests registered (import error?)" });
  for (const t of tests) {
    const t0 = performance.now();
    try {
      await withTimeout(Promise.resolve().then(t.fn), TEST_TIMEOUT_MS);
      results.push({ name: t.name, ok: true, ms: Math.round(performance.now() - t0) });
    } catch (e) {
      const error = (e && (e.stack || e.message)) || String(e);
      results.push({ name: t.name, ok: false, ms: Math.round(performance.now() - t0) });
      failures.push({ name: t.name, error: String(error).split("\n").slice(0, 4).join("\n") });
    }
  }
  for (const e of pageErrors) failures.push({ name: "page error", error: e });
  const pass = results.filter((r) => r.ok).length;
  const fail = failures.length;
  const summary = { pass, fail, failures, tests: results };
  const pre = document.getElementById("result") || document.body.appendChild(document.createElement("pre"));
  pre.id = "result";
  pre.textContent = JSON.stringify(summary, null, 2);
  document.title = "TESTS pass=" + pass + " fail=" + fail;
  if (typeof console !== "undefined") console.log(document.title);
  return { pass, fail };
}

if (typeof window !== "undefined") {
  window.addEventListener(
    "error",
    (ev) => {
      const tgt = ev.target;
      if (tgt && tgt !== window && tgt.tagName === "SCRIPT") pageErrors.push("failed to load script " + (tgt.src || "(inline)"));
      else if (ev.message) pageErrors.push(String(ev.message) + (ev.filename ? " @ " + ev.filename + ":" + ev.lineno : ""));
    },
    true
  );
  window.addEventListener("unhandledrejection", (ev) => {
    pageErrors.push("unhandled rejection: " + String(ev.reason && (ev.reason.message || ev.reason)));
  });
  const kick = () => {
    loaded = true;
    setTimeout(() => {
      if (!held) run();
    }, 0);
  };
  if (document.readyState === "complete") kick();
  else window.addEventListener("load", kick);
}

/** @returns {boolean} whether the page load event has fired */
export function isLoaded() {
  return loaded;
}
