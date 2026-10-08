// Tests for core/store.js
import { test, eq, ok } from "./lib.js";
import { createStore } from "../js/core/store.js";

const tick = () => new Promise((r) => queueMicrotask(r));

test("store get/set shallow merges", () => {
  const init = { a: 1, b: { x: 1 } };
  const s = createStore(init);
  s.set({ a: 2 });
  eq(s.get().a, 2);
  eq(s.get().b, { x: 1 });
  eq(init.a, 1, "initial object not mutated");
});
test("subscribers batched once per microtask with changed keys", async () => {
  const s = createStore({ a: 1, b: 2, c: 3 });
  const calls = [];
  s.subscribe((st, changed) => calls.push([{ ...st }, [...changed].sort()]));
  s.set({ a: 10 });
  s.set({ b: 20 });
  s.set({ a: 11 });
  eq(calls.length, 0, "not synchronous");
  await tick();
  await tick();
  eq(calls.length, 1);
  eq(calls[0][0], { a: 11, b: 20, c: 3 });
  eq(calls[0][1], ["a", "b"]);
});
test("unchanged values do not notify", async () => {
  const obj = { k: 1 };
  const s = createStore({ a: 1, o: obj });
  let n = 0;
  s.subscribe(() => n++);
  s.set({ a: 1, o: obj });
  await tick(); await tick();
  eq(n, 0);
  s.set({ o: { k: 1 } }); // new identity -> changed
  await tick(); await tick();
  eq(n, 1);
});
test("unsubscribe and functional set", async () => {
  const s = createStore({ n: 1 });
  let n = 0;
  const off = s.subscribe(() => n++);
  s.set((st) => ({ n: st.n + 1 }));
  eq(s.get().n, 2);
  off();
  await tick(); await tick();
  eq(n, 0);
});
test("throwing subscriber does not block others; separate ticks notify separately", async () => {
  const s = createStore({ a: 0 });
  const seen = [];
  s.subscribe(() => { throw new Error("x"); });
  s.subscribe((st, ch) => seen.push([st.a, [...ch]]));
  const origErr = console.error; console.error = () => {};
  try {
    s.set({ a: 1 });
    await tick(); await tick();
    s.set({ a: 2, z: 5 });
    await tick(); await tick();
  } finally { console.error = origErr; }
  eq(seen, [[1, ["a"]], [2, ["a", "z"]]]);
  ok(s.get().z === 5);
});
test("set ignores junk patches", async () => {
  const s = createStore({ a: 1 });
  let n = 0;
  s.subscribe(() => n++);
  s.set(null); s.set(5); s.set(undefined);
  await tick(); await tick();
  eq(n, 0);
  eq(s.get(), { a: 1 });
});
