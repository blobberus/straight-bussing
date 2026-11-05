# Web implementation notes (redesign, 2026-11-03)

> **In the live repository (since 2026-11-05):** the website (`web/`) implements this spec; it came over from the
> experimental repository with the owner's request "Transfer the interface of the experimental build to the current main
> build of straight bussing" (docs/ARCHITECTURE.md "Glass interface on the live site"). The live iPhone app keeps its
> earlier interface (`ios/README.md`); the iPhone parts of this spec are built only in the experimental repository
> (https://github.com/blobberus/straight-bussing-experimental), where that work is paused (`docs/redesign/GLASS-IOS-PAUSED.md` there). Screenshots referred to below live
> there too: https://github.com/blobberus/straight-bussing-experimental/tree/main/docs/redesign

How the website (`web/`) implements `docs/DESIGN-SPEC.md`, every place it deviates from the spec and why, what was
measured and what was verified. Kept separate from the spec so the iPhone engineer's edits and these notes never
conflict; the iOS counterpart is `docs/redesign/NOTES-ios.md`. Screens: `docs/redesign/after/web/`.

## Where the spec lives in the web code

| Spec | Web |
|---|---|
| 14 tokens (color light / dark, type roles, spacing, radii, icon sizes, elevation, motion) | `css/tokens.css` under the table's CSS names; old names (`--bg`, `--text`, `--accent`, `--surface`, `--fs-*`, `--d-*`) are aliases at the bottom. `--live` is now the text color and `--live-mark` the dot (the rename the spec warns about). |
| 2.2 root size, Dynamic Type, text-size classes | `css/base.css` (`html { font-size: 106.25% }`; `font: -apple-system-body` on iPhone Safari), `js/ui/frame.js initTextSize` (`html[data-text]` default / large / ax, from a 1rem probe) |
| 5 icons | `js/ui/icons.js` (Lucide, ISC; drawn walk and antenna-off; filled twins for state) |
| 7 materials, 8 elevation | `css/base.css`; the sheet, cards, Settings and dialogs are opaque |
| 10.1 to 10.7 chrome, banner, chip, sheet, bottom bar | `css/base.css`, `css/sheet.css`, `js/ui/pill.js`, `js/ui/contextbar.js`, `js/ui/sheet.js`, `js/main.js` |
| 10.8 to 10.13, 10.18 to 10.21 | `css/components.css`, `js/ui/components.js` |
| 10.14 to 10.17 | `css/views.css`, `css/journey.css`, `css/trip.css`, `views/stop.js`, `views/directions.js`, `views/tripinfo.js`, `views/tripprogress.js` |
| 11 map | `js/map/style.js`, `js/map/layers.js`, `css/map.css`, `js/map/landmarks.js` |

## Deviations from the spec, and why

1. **Words shared with the iPhone app win over the spec's examples** (parity contract 15.1: every word identical). The
   step list keeps the Kit's strings ("Walk 3 min (240 m) to X", "Bus arrives at X 3:11 PM", "Wait ~11 min, then ride
   ~10 min (10 stops) to Y, 3:21 PM · from schedule, est.") instead of 10.16's example actions ("Ride 53RD 10 stops
   to ..."), shown the way iOS StepRow shows them: body text with the place and time Semibold (not all `rowTitle`; the
   steps are long sentences), the live source line under a live bus time, the walk's source as plain detail text
   ("Sidewalk route" / "Walking estimate"). Same as NOTES-ios item 8.
2. **Option card line 4** (10.15) uses the iPhone app's words: "Leave in 10 min, bus 3:11 PM at X" with the live dot
   when the first bus is live, else "Bus about 3:11 PM at X, est." (NOTES-ios item 9).
3. **Missed bus** (13.8, O8 unanswered): the warnBg banner at the top of the next-step card carries the Kit's words,
   "Your planned bus has left. Showing the next one." (NOTES-ios item 6). `tripprogress.js missedNote()` is the one place
   to change when the owner decides.
4. **Trip header expanded** (10.6, O3): collapsed, the header shows the next-step card's own words over "Trip to X" with
   Arriving In; expanded it reads "Current trip" with no trailing value, because the next-step card right under it says
   the same in the hero size (NOTES-ios item 5).
5. **"Options updated with live times."** (13.8) is implemented on the web (a live re-plan that drops the selected
   option says so under the list). The iPhone app does not have it yet (NOTES-ios item 7); a parity gap to close there.
6. **Walk-first card** keeps its Start button on the web (a trip with no bus is a web feature; iOS lacks it, NOTES-ios
   item 10). Its words follow iOS: "8 min walk", "Arrive 3:05 PM", "605 m on sidewalks" / "605 m, walking estimate".
7. **Route header** shows "2 buses", "No live location", "Status unknown" or "Not running" (10.6 plus two honest states,
   NOTES-ios item 13): never "Not running" when we cannot know.
8. **Routes, Edit map order**: in the header's trailing slot as the spec says; while editing, the header shows nothing
   and the editor keeps its own Done button in the list (iOS turns the header action into "Done"). Kept because the
   editor's Done is where the drag-and-arrow work happens; the same action either way.
9. **Routes filter** (Show all / Show running / Hide all): the button matching the current state shows a check and is
   not drawn disabled (10.12), but keeps its `disabled` / `aria-disabled` semantics (a no-op is announced as such).
10. **Trip chip** labels follow iOS TripChip: "Trip to X", "Routes to X" (a station journey), the Lines by Time name, the
    custom route's name; screen readers hear the full sentence ("Only showing routes for Trip to X"). The old scrolling
    marquee is gone (the spec has the label truncate; the marquee clipped its own text, audit defect 2).
11. **Status banner action** (10.3, owner 2026-11-03): Retry or See alert sits in a fixed 84 x 44 slot on the LEADING
    edge, held still 2.5 s after the last Retry tap, "Live data is back." when the feed answers meanwhile (the shared
    rule now written in 10.3). Consequence: with the slot, the feed-error banner can wrap to 3 lines at the default size
    at 393 pt (the spec says at most 2); the safety copy is kept whole rather than shortened.
12. **Paint containment** (7) is on the search bar, the Directions card and the locate button only: the 32 / 36 pt chips
    extend their hit areas to 44 pt outside their box, and `contain: paint` would clip those hit areas.
13. **Landmark sizes** keep the zoom-based sizes (11.5 to 14.5 px for tier 1, as the iPhone app's Kit does) in mapLandmark
    Semibold, rather than a fixed 12 px; the tier-1 list is the owner's curation and was not cut to "about 8" (the
    collision rules decide what fits). The names now also keep clear of the location dot (11.5 hierarchy).
14. **Toast** (10.19) has no icon (the iPhone app shows a bell or a check, NOTES-ios item 16): web toasts are short
    confirmations and errors, and bus alerts on the web are separate notifications or the in-app alert banner.
15. **Bus marker pulse** (old one-shot ring on every poll) is removed: live updates move without decoration (9).
16. **Corner shape**: circular arcs, not continuous squircles (15.2, a platform difference).
17. **Font**: the system stack renders SF Pro on Apple devices; the screenshots in `after/web/` come from Windows
    (Segoe UI Variable), so letterforms differ from an iPhone while spacing, color and hierarchy hold.

## Kept in step with the iPhone app during the run

- Status banner Retry rule (owner 2026-11-03, spec 10.3): leading 84 x 44 slot, 2.5 s hold, "Live data is back."
  (`ui/pill.js`; unit test and the e2e "Retry tapped again and again during a trip").
- Directions: when the sheet comes to rest collapsed, the selected option is framed again in the larger map (spec J3;
  iOS 2c80933; `directions.js onSheetRest`, the sheet's `sheet:inset` event now carries `detent`).
- The Directions field card's text caps at 1.35 x like the search bar (iOS caps DirectionsCard at xxxLarge).
- The place summary shows the whole name at accessibility sizes (spec 13.6; iOS a189b50).
- Already on the web before iOS asked: the option's routes stand out on the map while Directions shows options (the
  network is dimmed under the drawn plan), the search capsule's whole-capsule press, the stop's three place actions in
  one row (`.v-stopacts`).

Housekeeping: the redesign's edit scripts had turned 57 web files into CRLF; they are LF again (commit "Web: LF line
endings again"), so a diff against the pre-redesign build shows the real 2,700 changed lines.

## Performance (measured)

Headless Edge with SwiftShader (software GPU), 393 x 852 at DPR 2, demo mode. The unchanged build (`base/`, commit
0d1b602, served on its own port) and the redesign measured side by side and interleaved, final run on the finished
build with nothing else running (scratch scripts in the job folder: `trace.py` = a Chrome trace of a scripted sheet
drag up and down, then 5 s idle with buses gliding, median of 4 runs per build; `fcp.py` / `cpuprof.py` = load with 4x
CPU throttling). Headless rAF is not vsync-bound, so frame cost is read from the trace, not from frame intervals.

| Measure | Before | After | Change |
|---|---|---|---|
| Sheet drag: GPU / raster time per presented frame | 5.80 ms | 4.69 ms | -19% |
| Sheet drag: GPU time, whole drag | 1,596 ms | 984 ms | -38% |
| Sheet drag: paint + pre-paint, whole drag | 18.0 ms | 11.0 ms | -39% |
| Sheet drag: main thread per frame (BeginMainFrame) | 0.33 ms | 0.30 ms | -9% |
| Sheet drag: style recalculation, whole drag | 24.0 ms | 25.4 ms | +6% |
| Idle 5 s with buses gliding: style recalculation | 35.4 ms | 14.6 ms | -59% |
| Idle 5 s: paint + pre-paint | 31.8 ms | 17.0 ms | -47% |
| Idle 5 s: frames presented / GPU time | 374 / 1,578 ms | 30 / 142 ms | far fewer frames (see below) |
| Load, 4x CPU: boot() main-thread time (CPU profile, 3 runs) | 54 ms | 53 ms | same (was 87 ms before the boot fix) |
| Load, 4x CPU: first contentful paint, third parties blocked (8 runs) | 374 to 406 ms | 466 to 500 ms | +90 ms, see below |

No long tasks in either build during the drag or idle. Why the drag and idle are cheaper: the sheet is opaque (no 24 px
blur and saturate 1.8 layer moving under the finger), blur is limited to four small controls at 20 px / 1.2, the bus
pulse animation is gone, and `will-change` is set only while dragging. The idle frame count differs a lot (the
pre-redesign build kept presenting frames continuously); buses glide in both builds (a check sampled every bus marker
every 500 ms for 15 s: 28 and 30 of 30 samples moved).

First paint: two redesign additions read layout synchronously at boot (the text-size class and the collapsed sheet
height) and cost about 45 ms of main-thread time at 4x CPU; both now read in the first frame (commit "Web boot: no
forced style or layout pass"), which brought boot() back to the old 53 ms. The remaining first-paint gap in headless
Edge on Windows is in text rendering: with every font forced to Arial the two builds paint at the same time (324 vs
314 ms), with every weight forced to Regular the gap is about 55 ms, with the family forced to system-ui about 30 ms.
The redesign uses the system stack with three weights (400 / 600 / 700, spec 2.1) and tabular figures; on an iPhone the
system font is always resident, so this is not expected there (not measured on a device). Both builds stay far under the
2 s budget.

## Verified (headless Edge, 393 x 852 at DPR 2 with emulated safe areas, unless noted)

The curated set is `docs/redesign/after/web/` (97 PNGs, file names as in `before/web/`). Looked at, light and dark:
Current trip collapsed / expanded / scrolled, search open, results, no matches, place card with options, selected option
with steps, trip in progress (expanded, scrolled, collapsed with the trip map), route detail (collapsed and expanded),
stop detail (expanded and collapsed), Routes, My Routes (with routes and empty), the custom route editor, saved toast,
detail and delete confirmation, Settings (top, scrolled, Credits open), Lines by Time (menu, applied, Routes bar),
Alerts, About, Routes to station, the beta welcome popup. States: no location, blocked location (card and Settings help),
feed unreachable (collapsed and expanded), live data delayed and out of date, no live locations with the operator's
alert, loading, long names (results, options, stop), the missed-bus card (rendered from the trip fixtures in
`tests/trip.test.html`: demo buses could not be staged into that state), a toast, the desktop phone frame (1280 x 800).
200% browser text (32 px default): Current trip collapsed / expanded, options, route, trip in progress, stop, Routes,
Settings, feed unreachable. 320 x 640: Current trip, trip in progress, Routes, route, Settings, options, feed unreachable.
Fixed from these screens during the run: route badges clipped at 200% text, the trip header squeezed beside End trip at
accessibility sizes, the Directions field card growing past the chrome cap, a blank list when nothing matched.
The browser suite: 741 tests before the redesign, 756 now, all passing.

## Not verified

Real iPhone Safari (SF Pro rendering, Dynamic Type at AX5 through `-apple-system-body`, safe areas, the sheet's touch
feel, momentum and rubber band), VoiceOver and Increase Contrast on a device, keyboard-up states, the landscape panel,
Reduce Transparency, the missed-bus banner inside the running app (unit-tested and rendered from fixtures only), the
experimental test site on a phone.

Known wording shared with iOS, left for the owner: the Routes list says "Only showing routes for To Trader Joe's" (both
apps put the journey label "To X" after "for"; the trip chip already says "Trip to X").
