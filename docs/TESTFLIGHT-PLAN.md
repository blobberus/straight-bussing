# TestFlight plan: test and fix on real iPhones before the App Store

Written 2026-10-11. Goal: ride with the real app on your iPhone, then with other riders, fix everything found, and
submit the exact build that passed. TestFlight comes with the paid Apple Developer Program (99 USD a year), so the
plan starts with enrolling. Account setup is "Nathan's checklist" in `docs/APPSTORE-SUBMIT.md` (steps 1 to 9); this
file is the testing loop. Dates are targets.

Visual version with links, "where it can snag" tips for every step and ticks that are remembered: open
`docs/testflight-plan.html` in a browser.

## Timeline

| Phase | Dates | Who | Done when |
|---|---|---|---|
| 0. Prep | Oct 12 to 14 | Claude | the prep list below is done (no Apple account needed) |
| 1. Enroll and set up | Oct 12 to 15 | Nathan | checklist steps 1 to 9: build 1 is on your iPhone |
| 2. Round 1: you alone (internal testing) | Oct 15 to 21 | Nathan rides, Claude fixes | every item in A to F passed once, no open P0 |
| 3. Round 2: other riders (external testing) | Oct 22 to Nov 1 | 10 to 30 riders, Claude fixes | no open P0 or P1, no crash in the last 7 days |
| 4. Freeze and submit | Nov 2 to 6 | both | the final build passes the full list and is submitted |
| 5. Review and release | about Nov 4 to 10 | Apple, then Nathan | live well before Thanksgiving Break (Nov 23 to 27) |

## Phase 0: Claude's prep before build 1

- [ ] **"What to Test" on every build**: `ios-release.yml` fills TestFlight's What to Test note from the commits since
  the last build, so you know what to re-check.
- [ ] **`ios/scripts/asc.py feedback`**: downloads TestFlight screenshot and crash feedback (App Store Connect API,
  `betaFeedbackScreenshotSubmissions` / `betaFeedbackCrashSubmissions`) into a private folder on this PC. Never into
  the repo or a GitHub issue: tester screenshots show where they are on the map. It uses a second API key with the
  **Developer** role, kept on this PC only (it can read feedback, not sign apps or manage users); the Admin key stays
  in the GitHub `appstore` environment.
- [ ] **Bug tracking**: GitHub label `testflight` plus P0 to P3 labels. Claude files each report as an issue in words
  only (public repo: no screenshots, no locations, no tester names).
- [ ] **Round 2 texts**: Beta App Description, What to Test for testers, and the beta review notes, ready to paste.
- [ ] **Green start**: `ios.yml` and the web tests pass on the commit build 1 is made from.

## The bug loop

1. **You report.** Take a screenshot (side button + volume up), then either:
   - send it to Claude with one sentence: build number (About shows `1.0.0 (N)`), where, when, what you expected,
     what happened. Example: "Build 14, Ellis and 57th, 8:40 AM: said 3 min, the bus came at 8:49."
   - or use TestFlight's own way: tap the screenshot thumbnail > Share Beta Feedback. Claude reads these with
     `asc.py feedback`. After a crash, TestFlight asks to send a report: tap Share and add a sentence.
2. **Claude fixes.** Files the issue with a severity, fixes it in iOS and also in the web app when the web has the
   same bug (parity rule in `.claude/rules/project.md`), runs `ios.yml` and the web tests.
3. **New build.** Claude starts `ios-release.yml`; you tap Review deployments > Approve (github.com works in your
   phone's browser). About 30 minutes later TestFlight installs it, if Automatic Updates is on in the TestFlight app.
4. **You re-check** the fix on the new build; Claude closes the issue.

Builds go out every 2 to 3 days with a batch of fixes, or the same day for a P0.

## Severity (from the ship checklist in `.claude/rules/project.md`)

| Level | What | Fixed |
|---|---|---|
| P0 | crash or freeze; stale or wrong times shown as live; a missing stale warning; call buttons that don't call; anything that looks official; any data leaving the phone beyond what `web/privacy.html` says | a new build the same day |
| P1 | wrong route, stop or direction; Live Activity or bus alert wrong or missing; a dead end (no way back); the sheet stuck; the first screen slower than 2 s | the next build |
| P2 | layout, wording, contrast, small visual glitches | in a batch |
| P3 | ideas and wishes | the after-launch list |

## Round 1 test script (you, internal testing)

Note the build number next to each item you pass. A once on day 1, B on every ride, C to F across the week.

**A. First launch** (10 min)
- Location prompt > Allow While Using: Current trip shows the nearest stop and its next buses with no tap.
- Turn location off (Settings > Privacy & Security > Location Services > Straight Bussing > Never): the app offers
  search instead and nothing breaks. Turn it back on.
- Settings > bus alerts on: the notification prompt appears; allow it.
- About says "unofficial", shows 773.702.8181, and the privacy and support links open.

**B. Every ride** (2 min)
- At the stop: the next bus is readable at a glance, in under 2 seconds.
- Note what the app said and when the bus came. More than 2 minutes off: report it with the stop and the time.
- Directions to where you are going > start the trip > lock the phone. The Lock Screen shows whole minutes, never
  seconds, and the Dynamic Island shows the trip (iPhone 14 Pro or later). With the app closed for over 2 minutes it
  says the data is delayed (there is no push server yet, by design); opening the app refreshes it. It ends when you
  arrive.
- A bus alert fires at the distance you set (2 stops, 1 stop or N minutes) while the app is open (alerts while locked
  need the push server, which is not built yet).

**C. Hard situations**
- Airplane Mode for a minute: the stale warning appears and no time looks live. Off again: it recovers by itself.
- Weak signal (basement, elevator): no time shown as live when it is old.
- After midnight: "No live locations right now", the scheduled routes and the call buttons (open the call sheet, then
  cancel).
- A weekend day and a day with a service alert: the alert text shows in full.
- Low Power Mode: times still update (every 20 seconds).
- Leave the app for 10 minutes and come back: it refreshes by itself and never shows old times as fresh.
- A phone call or another app during a trip: the trip and the Live Activity carry on.

**D. Look and accessibility**
- Light and dark mode (Control Center).
- Largest text (Settings > Accessibility > Display & Text Size > Larger Text, slider at the end): nothing cut off,
  every button still tappable.
- VoiceOver for 5 minutes on the main screen: every button says what it does.
- Reduce Motion on: no big animations.
- The sheet: drag between its three heights; the keyboard never hides the search results; nothing sits under the
  Dynamic Island or the home bar.

**E. Every feature once**
- Search with a typo ("chipotel"), a building and an address; Routes to station.
- Routes tab: hide and show a route, Show all, Hide all, map order.
- My Routes: create, edit, delete (it asks first); favorite a stop.
- The Alerts screen.
- Settings > Simulated buses on and off: the pill says "Simulated buses", then live buses come back.
- Contact support opens Safari with the app and build filled in (GitHub Issues until the Google Form exists).

**F. Battery**
- One 20-minute trip with the Live Activity: battery percent before and after, and Settings > Battery for the
  app's share.

## Round 2: other riders (external testing)

- Claude drafts the beta texts. You pick the feedback email (testers see it), then submit build N for Beta App Review
  (the first build only; usually about a day).
- TestFlight > External Testing > group `Riders` > public link with a tester limit (start with 30). Share it with
  people who ride. Ask for a mix of phones: one without a Dynamic Island, and one on iOS 17 if anyone still has it
  (the app supports iOS 17, and its Lock Screen layout has only been checked in the simulator).
- Testers report with Share Beta Feedback; Claude pulls the reports with `asc.py feedback`.
- One build a week to the riders; P0 fixes as soon as they are ready.

## Freeze and submit

Submit when all of these are true:
- no open P0 or P1;
- no crash reported in the last 7 days;
- on the final build, A, C, D and E pass again, and B on at least 3 rides;
- the App Store screenshots still match (Claude regenerates them if the UI changed);
- that exact build is the one you submit (checklist steps 10 to 12). After the freeze only P0 fixes go in, and each
  one restarts this check.

## Good to know

- TestFlight builds expire after 90 days. Internal testing: up to 100 testers (App Store Connect users on your team),
  no review. External testing: up to 10,000 testers, first build reviewed
  ([TestFlight](https://developer.apple.com/testflight/)).
- Every upload waits for your Approve click; that click is what protects the Admin key. Claude can start runs, never
  approve them.
- Tester feedback in App Store Connect: Apps > Straight Bussing > TestFlight > Feedback
  ([view tester feedback](https://developer.apple.com/help/app-store-connect/test-a-beta-version/view-tester-feedback/)).
