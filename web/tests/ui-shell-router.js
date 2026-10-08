// Tests for ui/router.js and ui/actions.js (D1).
import { test, eq, ok } from "./lib.js";
import { createStore } from "../js/core/store.js";
import {
  initRouter, registerView, navigate, back, canGoBack, activeTab, rootOf, currentParams, getView, _resetRouter, _stack, TABS,
} from "../js/ui/router.js";
import { registerAction, runAction, bindActions, hasAction, _resetActions } from "../js/ui/actions.js";

function setup() {
  _resetRouter();
  const store = createStore({ view: "nearby", prevView: null, stopId: null, routeId: null });
  const detents = [];
  let detent = "half";
  initRouter({ store, setDetent: (d) => { detent = d; detents.push(d); }, getDetent: () => detent });
  const v = (title, extra = {}) => ({ title: () => title, render: () => title, ...extra });
  registerView("nearby", v("Nearby", { tab: "nearby", detent: "half" }));
  registerView("routes", v("Routes", { tab: "routes", detent: "half" }));
  registerView("alerts", v("Alerts", { tab: "alerts", detent: "half" }));
  registerView("stop", v("Stop", { detent: "half" }));
  registerView("route", v("Route", { parent: "routes", tab: "routes", detent: "half" }));
  registerView("about", v("About", { parent: "alerts", detent: "full" }));
  registerView("directions", v("Dir", { detent: "full" }));
  return { store, detents, setD: (d) => (detent = d), getD: () => detent };
}

test("router: TABS are the three root views", () => {
  eq([...TABS], ["nearby", "routes", "alerts"]);
});

test("router: navigate to a sub view sets view/prevView/stopId and detent", () => {
  const { store, detents } = setup();
  ok(navigate("stop", { stopId: 42 }));
  const s = store.get();
  eq(s.view, "stop");
  eq(s.prevView, "nearby");
  eq(s.stopId, "42", "ids are strings");
  eq(s.routeId, null);
  eq(detents.at(-1), "half");
  ok(canGoBack());
});

test("router: unknown view is refused and state unchanged", () => {
  const { store } = setup();
  eq(navigate("nope"), false);
  eq(store.get().view, "nearby");
});

test("router: back pops the stack and restores the previous detent", () => {
  const t = setup();
  navigate("routes");
  t.setD("full");
  navigate("route", { routeId: "r1" });
  eq(t.store.get().routeId, "r1");
  navigate("stop", { stopId: "s1" });
  eq(_stack().map((e) => e.view), ["routes", "route"]);
  ok(back());
  eq(t.store.get().view, "route");
  eq(t.store.get().routeId, "r1");
  eq(t.store.get().stopId, null);
  ok(back());
  eq(t.store.get().view, "routes");
  eq(t.getD(), "full", "detent restored to what it was on the routes list");
  eq(back(), false, "root with empty stack: nothing to do");
  ok(!canGoBack());
});

test("router: navigating to a view already on the stack pops back to it (no loops)", () => {
  const { store } = setup();
  navigate("stop", { stopId: "a" });
  navigate("route", { routeId: "r" });
  navigate("stop", { stopId: "a" });
  eq(_stack().map((e) => e.view), ["nearby"]);
  eq(store.get().view, "stop");
  back();
  eq(store.get().view, "nearby");
});

test("router: same view+params does not push", () => {
  setup();
  navigate("stop", { stopId: "a" });
  navigate("stop", { stopId: "a" });
  eq(_stack().length, 1);
});

test("router: tab navigation resets the stack and keeps a non-peek detent", () => {
  const t = setup();
  navigate("stop", { stopId: "a" });
  t.setD("full");
  navigate("alerts");
  eq(_stack().length, 0);
  eq(t.store.get().view, "alerts");
  eq(t.getD(), "full", "tab switch keeps detent");
  t.setD("peek");
  navigate("routes");
  eq(t.getD(), "half", "tab switch lifts out of peek");
});

test("router: back with empty stack goes to parent", () => {
  const { store } = setup();
  store.set({ view: "about" }); // e.g. deep state restored without history
  ok(canGoBack());
  ok(back());
  eq(store.get().view, "alerts");
});

test("router: activeTab follows def.tab, stack root, then parent chain", () => {
  const { store } = setup();
  navigate("routes");
  navigate("stop", { stopId: "x" });
  eq(activeTab(), "routes", "stop has no tab: use the stack root");
  navigate("alerts");
  navigate("about");
  eq(activeTab(), "alerts");
  eq(rootOf("about"), "alerts");
  eq(rootOf("route"), "routes");
  eq(rootOf("unknown"), "nearby");
  eq(activeTab({ view: "nearby" }), "nearby");
  ok(getView("about"));
  void store;
});

test("router: extra params are available via currentParams and restored on back", () => {
  setup();
  navigate("directions", { fromStopId: "s9" });
  eq(currentParams().fromStopId, "s9");
  navigate("stop", { stopId: "s1" });
  back();
  eq(currentParams().fromStopId, "s9");
});

test("router: explicit detent param wins over the view default", () => {
  const t = setup();
  navigate("about", { detent: "half" });
  eq(t.getD(), "half");
});

/* ---------------- actions ---------------- */
test("actions: register, run with dataset/event/ctx, fallback does not override", () => {
  _resetActions();
  const calls = [];
  registerAction("a", (ds, ev, ctx) => calls.push([ds.id, ev, ctx.k]));
  eq(registerAction("a", () => calls.push("fallback"), { fallback: true }), false);
  ok(hasAction("a"));
  ok(runAction("a", { id: "7" }, null, { k: 1 }));
  eq(calls, [["7", null, 1]]);
  eq(runAction("missing", {}, null, {}), false);
});

test("actions: a throwing handler is contained and toasts", () => {
  _resetActions();
  const toasts = [];
  registerAction("boom", () => { throw new Error("x"); });
  ok(runAction("boom", {}, null, { toast: (t) => toasts.push(t) }));
  eq(toasts.length, 1);
});

test("actions: delegation routes clicks on [data-action] and ignores disabled", () => {
  _resetActions();
  const root = document.createElement("div");
  root.innerHTML = '<button data-action="go" data-id="s1"><span id="inner">x</span></button>'
    + '<button data-action="go" data-id="s2" disabled>y</button>'
    + '<div role="button" tabindex="0" data-action="go" data-id="s3">z</div>'
    + '<input type="checkbox" data-action="chk" data-id="c1">';
  document.body.appendChild(root);
  const got = [];
  registerAction("go", (ds, ev, ctx) => got.push(ds.id + ":" + ctx.tag));
  registerAction("chk", (ds) => got.push("chk:" + ds.value));
  const off = bindActions(root, () => ({ tag: "ctx" }));
  root.querySelector("#inner").click();
  root.querySelectorAll("button")[1].click();
  root.querySelector('[role="button"]').dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  root.querySelector("input").click();
  off();
  root.querySelector("#inner").click();
  root.remove();
  eq(got, ["s1:ctx", "s3:ctx", "chk:true"]);
});
