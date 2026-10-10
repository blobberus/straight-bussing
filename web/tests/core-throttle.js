// core/throttle.js (Directions' background re-plan, at most every 8 s like iOS refreshDirections) and
// core/demo.js (the ?demo=1 switch). Fake clock and timers: nothing here waits.
import { test, eq, ok } from "./lib.js";
import { createThrottle } from "../js/core/throttle.js";
import { isDemoSearch, exitDemoHref, DEMO, DEMO_TITLE } from "../js/core/demo.js";

function fakeTime() {
  const t = { now: 0, timers: [], seq: 0 };
  t.later = (fn, ms) => { const id = ++t.seq; t.timers.push({ id, at: t.now + ms, fn }); return id; };
  t.cancel = (id) => { t.timers = t.timers.filter((x) => x.id !== id); };
  t.advance = (ms) => {
    t.now += ms;
    for (;;) {
      const due = t.timers.filter((x) => x.at <= t.now).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      t.timers = t.timers.filter((x) => x !== due);
      due.fn();
    }
  };
  return t;
}

test("throttle: leading run, then at most one run per window; a request inside the window runs at its end (never dropped)", () => {
  const t = fakeTime(), runs = [];
  const th = createThrottle(() => runs.push(t.now), { everyMs: 8000, now: () => t.now, later: t.later, cancel: t.cancel });
  ok(th.poke(), "first request runs now");
  t.advance(3000);
  ok(!th.poke() && th.pending(), "inside the window: deferred to its end");
  ok(!th.poke(), "a second request inside the window joins the pending run");
  eq(t.timers.length, 1, "one timer");
  t.advance(4999);
  eq(runs, [0]);
  t.advance(1);
  eq(runs, [0, 8000], "trailing run at 8 s");
  t.advance(20000);
  ok(th.poke(), "after a quiet window: runs at once");
  eq(runs, [0, 8000, 28000]);
});

test("throttle: gate skip drops, defer retries; reset forgets the last run and the pending one", () => {
  const t = fakeTime(), runs = [];
  let gate = "skip";
  const th = createThrottle(() => runs.push(t.now), { everyMs: 8000, gate: () => gate, now: () => t.now, later: t.later, cancel: t.cancel, retryMs: 1000 });
  ok(!th.poke() && !th.pending(), "skip: nothing to do, nothing scheduled");
  gate = "defer";
  ok(!th.poke() && th.pending(), "defer: retried later");
  t.advance(1000);
  ok(th.pending(), "still busy: retried again");
  gate = "go";
  t.advance(1000);
  eq(runs, [2000], "ran once the gate opened");
  th.poke();
  ok(th.pending());
  th.reset();
  ok(!th.pending() && t.timers.length === 0, "reset cancels the pending run");
  ok(th.poke(), "and forgets the window");
  eq(runs, [2000, 2000]);
});

test("demo flag: only ?demo=1 turns it on; exit link drops just that parameter", () => {
  ok(isDemoSearch("?demo=1") && isDemoSearch("?x=2&demo=1"));
  for (const q of ["", "?demo", "?demo=0", "?demo=true", "?demo=yes", "?demo=11", "#demo=1", "?Demo=1"]) ok(!isDemoSearch(q), q);
  eq(DEMO, false, "test pages are not demo mode");
  eq(exitDemoHref({ pathname: "/straight-bussing/", search: "?demo=1", hash: "" }), "/straight-bussing/");
  eq(exitDemoHref({ pathname: "/app/", search: "?x=1&demo=1", hash: "#h" }), "/app/?x=1#h");
  eq(DEMO_TITLE, "Demo mode: simulated buses", "iOS DemoFeed.alertHeader words");
});
