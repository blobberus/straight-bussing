// RouteKnower E32: what the shipped live pipeline shows riders on real transition episodes (buses leaving their line,
// parking, going silent, coming back, lines renumbering, a trip planned on a leaving bus). The episodes are cut from
// the archived feeds of Nov 6 to 9, 2026 (fixtures/display_episodes.json, made by
// experiments/routeknower/E32-scripts/make_fixtures.py) and run through data/live.js startLive by display-run.js.
// guard = the rules get it right for riders; KNOWN GAP = they do not, and this test asserts the CURRENT behavior so a
// fix shows up here: whoever changes core/offroute.js, core/idle.js, core/transition.js, core/busnum.js or data/live.js
// reruns make_fixtures.py --expect, checks every story below and writes in RouteKnower.md E32 what changed for riders
// (the gaps' recommended fixes are owner decisions). docs/ARCHITECTURE.md points here from each rule's section.
import { test, eq, ok } from "./lib.js";
import { runCase } from "./display-run.js";

/** Every case the fixture must have (a case dropped from the file fails here instead of passing silently). */
const CASES = [
  ["gone_shift_end", "guard"], ["offroute_garage", "guard"], ["idle_parked", "guard"], ["number_join", "guard"],
  ["offroute_then_silent", "gap"], ["gone_comeback", "gap"], ["offroute_loop", "gap"], ["offroute_fcm", "gap"],
  ["idle_linger_comeback", "gap"], ["parked_rolling", "gap"], ["parked_now", "gap"], ["planner_leaving", "gap"],
  ["number_flap", "gap"],
];

let fxp = null;
const fixture = () => (fxp ||= fetch("fixtures/display_episodes.json", { cache: "no-store" }).then((r) => r.json()));
const clock = (c, i) => new Date((c.t0 + c.polls[i].h) * 1000).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hourCycle: "h23" });

test("display E32: the fixture has every episode, each with its stored answers", async () => {
  const fx = await fixture();
  eq(fx.cases.map((c) => [c.name, c.kind]), CASES, "cases and kinds");
  for (const c of fx.cases) ok(Array.isArray(c.expect) && c.expect.length === c.polls.length && c.story, c.name + ": expect / story stored");
  for (const c of fx.cases) ok(c.kind !== "gap" || /Fix/.test(c.gap || ""), c.name + ": a known gap names the fix E32 recommends");
});

for (const [name, kind] of CASES) {
  test(`display E32 ${kind === "gap" ? "KNOWN GAP (expected current behavior)" : "guard"}: ${name}`, async () => {
    const fx = await fixture();
    const c = fx.cases.find((x) => x.name === name);
    ok(c, name + " in the fixture");
    const got = await runCase(fx, c);
    const why = `${c.says}${c.gap ? " | KNOWN GAP: " + c.gap : ""}`;
    eq(got.story, c.story, `${name}: what riders see changed (${why})`);
    const i = got.polls.findIndex((p, k) => JSON.stringify(p) !== JSON.stringify(c.expect[k]));
    ok(i < 0, i < 0 ? "" : `${name}: poll ${i} (${clock(c, i)}) shows ${JSON.stringify(got.polls[i])}, stored ${JSON.stringify(c.expect[i])}`);
  });
}

test("display E32 stories in words: the rider-visible facts the E32 entry cites", async () => {
  const fx = await fixture();
  const S = Object.fromEntries(fx.cases.map((c) => [c.name, c.story]));
  // guards
  eq(S.gone_shift_end.times.at(-1)[1], "22:01:00", "Central 4319: its times leave 15 min after its last report (21:46)");
  eq(S.offroute_garage.away[0][0], "12:13:30", "DCC 4322 off to the garage: hidden at 12:13:30, still tracked");
  eq(S.idle_parked.shown.map((s) => s[0]), ["18:44:00", "19:32:00"], "Red Line 4315: hidden as idle 19:17 to 19:32");
  eq(S.number_join.number, [["09:20:00", 4], ["09:30:00", 5]], "DCC 12645: Bus 4 becomes Bus 5 when a lower id joins");
  // known gaps: the current behavior (RouteKnower E32 has the fixes)
  eq(S.offroute_then_silent.times[1], ["18:49:00", "18:58:00"], "AP/DX 4317 at the garage: its times come back 18:49 to 18:58");
  eq(S.gone_comeback.times.map((s) => s[1]), ["08:09:30", "08:25:00"], "Apostolic 4322: times gone 08:10 to 08:13, then it serves");
  eq(S.offroute_loop.away, [["18:05:30", "18:18:00"]], "AP/DX 4331's evening loop: hidden 12 min while it serves the loop");
  eq(S.offroute_fcm.away, [["19:31:30", "19:44:00"]], "Friend Center/Metra 4313: hidden 12 min, then serves Goldblatt");
  eq(S.idle_linger_comeback.shown.map((s) => s[0]), ["23:35:00", "23:56:00"], "North 4317 at Reynolds Club: hidden 23:46 to 23:56, then one more run");
  eq(S.parked_rolling.shown, [["18:30:00", "19:20:00"]], "DCC 12645 parked downtown: shown with sliding times all along");
  eq(S.parked_now.next_at_stop.at(-1), ["18:10:30", "18:50:00"], "AP/DX 12644 parked: 'Now' at Bernard Mitchell for 40 min");
  eq(S.planner_leaving.plan[0][0].slice(0, 2), ["5704", "4318"], "Directions boards DCC 4318, which leaves the line at 18:00");
  ok(S.number_flap.swaps >= 20, "DCC: 20+ number swaps in 30 min from off-route toggles: " + S.number_flap.swaps);
});
