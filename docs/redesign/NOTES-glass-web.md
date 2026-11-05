# Web implementation notes: the glass redesign (2026-11-04)

> **In the live repository (since 2026-11-05):** the website (`web/`) implements this spec; it came over from the
> experimental repository with the owner's request "Transfer the interface of the experimental build to the current main
> build of straight bussing" (docs/ARCHITECTURE.md "Glass interface on the live site"). The live iPhone app keeps its
> earlier interface (`ios/README.md`); the iPhone parts of this spec are built only in the experimental repository
> (https://github.com/blobberus/straight-bussing-experimental), where that work is paused (`docs/redesign/GLASS-IOS-PAUSED.md` there). Screenshots referred to below live
> there too: https://github.com/blobberus/straight-bussing-experimental/tree/main/docs/redesign

How the website (`web/`) implements `docs/DESIGN-SPEC-GLASS.md` (Apple Maps' iOS 26 layout in Liquid Glass, a delta on
`docs/DESIGN-SPEC.md`), where it deviates and why, what was measured and what was verified. The first redesign's notes
stay in `docs/redesign/NOTES-web.md`. Screens: `docs/redesign/glass/web/`. Contracts: `docs/ARCHITECTURE.md` "Glass
redesign: shell contracts". The owner's later decisions (feedback button, compact banner, Apple-like basemap, neutral
main streets, the trip chip when expanded, no nearby buses without a trip) are recorded in the spec's section 18.

## What moved (spec 4) and where it lives

| Control | Now | Code |
|---|---|---|
| Search for a destination | 56 glass circle at the trailing end of the bottom row; opens the expanded sheet with the Start / Destination card at its top, Destination focused | `#searchBar` in `#bottomrow`, `views/directions.js` (card in the view, sticky) |
| Lines by Time, Locate | one 44 x 88 glass group riding 8 above the collapsed card, hidden when expanded | `#mapctl` inside `#sheet` (`#timeBtn`, `#locateBtn`), `css/sheet.css` |
| Settings | 44 glass circle, top right (Row B) | `#topbar` / `#settingsBtn`, `css/base.css` |
| Beta feedback (Q7, owner 2026-11-04: yes) | 44 tinted glass circle 8 under Settings, badge dot, pings now and then; solid while a chip shows | `#feedbackBtn` in `#topbar`, `ui/feedback-button.js` |
| Status banner | Row A, topmost, opaque, compact (one 44 pt line), Retry / See alert slot on the leading side with the 2.5 s hold; Details opens the full sentence and Call 773.702.8181 | `#pill`, `ui/pill.js` |
| Simulated-buses chip, trip chip | glass capsules in Row B (chip) / beside Settings or in Row C (trip chip); the trip chip stays when expanded | `#pill[data-form=chip]`, `#ctxbar.glass` |
| Sections | floating glass capsule with a selection capsule; minimizes to a circle while a long list scrolls | `#tabs.tabcap`, `.tab-pill`, main.js `--tab-i`, `setTabsMin` |
| Current trip, no trip (owner 2026-11-04) | "No current trip selected" + Search for a destination, the station search, the favorites, the alert row; no nearby buses | `views/nearby.js noTripHTML` |
| Sheet | collapsed = inset glass card; expanded = opaque full-width sheet under the top rows, the bottom row floating over it with a soft scroll edge; glass to opaque by the drag progress | `css/sheet.css`, `ui/sheet.js paintP` |
| Back | 44 fill circle, chevron in label | `.back` |
| Settings, Lines by Time, feedback panel | iOS sheets from 10 below the safe area, zoom out of their button, swipe down to close; Done = checkmark, Cancel = cross | `ui/settings-overlay.js`, `css/settings.css` |
| Toast | leading, 12 above the card (clear of the group); expanded: centered above the bottom row | `.toast` |
| Map credit | 10 above the card | `MapApi.setBottomInset` |
| Basemap (owner 2026-11-04) | Apple Maps-like: green parks, clear blue water, warm land; only motorways yellow-orange | `map/style.js PALETTE`, `patchStyle` fills |

## Decisions where the spec left room, and deviations

1. **Trip chip placement.** The spec's diagram puts the trip chip in Row C, under the simulated-buses chip. When there is
   no simulated-buses chip (every real ride), Row B's leading side is empty, so the trip chip sits there, beside
   Settings (its max width already leaves room for the circle, 8.3); with the chip it moves to Row C. The full detent
   and the Retry slot are unaffected (the trip chip hides when expanded). The feedback circle sits in Row C's trailing
   place, so the two never overlap (a test checks it).
2. **Status banner motion.** mBanner slides 8 px while fading in. The Retry e2e test caught the slot half a pixel off
   mid-slide in the parallel suite, and a rider tapping in the banner's first 250 ms would see it move: the owner's
   rule (Retry never shifts) wins, the banner only fades in.
3. **Compact banner (owner 2026-11-04, spec 18 D2).** One line in the footnote role (13 at the default size, capped at
   1.35 x): the short line always says the times can't be relied on ("Live data lost. Times may be off.", "No live
   data. Don't rely on times.", "Last update 1:23 PM. Times approximate.", "Live data delayed. Times may be off.", "No
   shuttles reporting locations", "No shuttles running right now"); the full sentence stays in `#pillText` (the live
   region, so screen readers hear it whole) and shows with "Call 773.702.8181" when Details is open. The Retry slot is
   still an 84 x 44 target at the leading edge (its capsule is drawn 4 inside it, so the banner can be 44 tall). The
   line never moves when the details open or close (the banner grows downward), so fast taps on it can never land on
   the trip chip's Show all (e2e test). Two lines at 200% text and on a 320 pt screen (beside the 84 slot there is room
   for about 23 characters at 320). Wording differs from the iPhone app's Kit `LiveText.pill` (iOS paused).
4. **Header insets.** The collapsed card is inset 12, so the header text sits 12 + 16 from the screen edges; it keeps
   that inset when expanded (content cards keep 16). Changing it at the settle would make the title jump 12 px.
5. **Text on the collapsed card.** The header's secondary text uses labelGlass2 and its text actions (Edit map order,
   New) use label while the card is glass (5.3: no tint text on glass); they return to tint on the opaque sheet.
   Switched at the settle (`data-rest`), never per frame.
6. **mSheetGlass at the settle.** While the finger drives the sheet, the opaque layer, content and group follow the
   progress p exactly (opaque by p .35, group gone by p .30). After release CSS transitions take them from where they
   were to the resting state over the sheet's settle time, which is close to, not exactly, the p ramp.
7. **Budget with chips.** With a chip on the map (simulated buses, a trip, a filter) the feedback circle turns solid
   tint, and with both chips the simulated-buses chip turns solid too, so at most 6 surfaces blur (12.1).
8. **Keyboard hiding.** The bottom row steps away while a text field in the sheet has focus on touch screens
   (`pointer: coarse`); with a mouse and keyboard there is no on-screen keyboard to make room for.
9. **Settings sheet.** A grab bar on top shows that it can be swiped down; Set time is a 44 pt tall capsule (the spec
   gives no height; 44 keeps the target rule without an invisible hit area). The feedback panel uses the same sheet
   (kind "feedback", title "Beta feedback") and, like Settings, leaves the app's sheet where it was.
10. **Loading.** The spec asks for solid glass until the first paint. The first paint already shows the glass (system
    fonts, no web font, no image under it), so no solid-to-glass step was added; a step would itself flash.
11. **Tab bar minimize (8.9, Q3 default yes).** Same numbers as the iPhone app: down past 24 px, a 16 px turn either
    way; reset by the top, a tap on the circle, a new page or tab, a collapse, or keyboard focus on the bar. The
    capsule crossfades into a separate glass circle while the selected button slides into it (transform), rather than
    the capsule's own background shrinking (a scaled capsule would distort its corners). A script or assistive tech
    activating a hidden section still switches. Screen readers cannot be detected on the web, so unlike iOS it also
    minimizes while one runs; the circle is named "<section>, show all sections".
12. **Scroll edge (8.8).** The 24 px bgSheet fade sits above the bar and continues at 90% behind it to the screen's
    edge (the spec's gradient "behind the bar" left rows visible through the gap between the capsule and the search
    circle); content padding is the bar row + 24 so the last row ends where the fade starts (spec: + 20).
13. **Feedback circle (8.5).** Tinted glass = tintBg at 85% with the glass filter (`--glass-tint-fill`); its tint icon
    and badge keep 3:1 over pure black / white with no blur (tested). Hidden at the full detent (the expanded sheet
    starts under Row B, where it sits). Focus goes to Settings when it disappears.
14. **Basemap (owner 2026-11-04, spec 18.1).** OpenFreeMap's positron and dark styles never drew city parks (OpenMapTiles
    landcover class grass), so `patchStyle` adds green fills for them, sports fields, cemeteries and a faint campus
    tint, below water. The casing flip first went from 55% to 75% so mid-tone route colors kept a 3:1 edge on the more
    colorful map; later the same day the casings were removed altogether and the lines made thinner (owner: "Remove the
    outlines for the lines but make the lines themselves thinner", another engineer's change; see ARCHITECTURE), so a
    few route colors now sit under 3:1 on the land. `--map-land` and the dark bus ring follow the new land colors.
15. **Not built.** The compass (the web map does not rotate), the tab selection lens (spec: not required on the web),
    the row More popover (8.14: My Routes uses a swipe tray, not a menu).
16. **Map framing.** Fits and the trip follow camera add the lower-right group's height (+ 8) to the bottom inset while
    collapsed (3: the visible rectangle excludes it); the credit keeps sitting 10 above the card.
17. **Trip chip material (bug found in the run).** The glass shell styled `.ctxbar` as a capsule but never gave it the
    glass material: "Trip to X  Show all" sat on the map as bare text. Fixed (`#ctxbar.glass`) and tested.
18. **Trip chip when expanded (owner 2026-11-04, spec 18 D5).** It stays above the expanded sheet like Settings (the spec
    hid it). Beside Settings (every real ride) nothing moves; under the simulated-buses chip (demo mode, Row C) the
    expanded sheet starts 8 below it, so only the full detent moves when a trip starts or ends there.
19. **Main streets (owner 2026-11-04, spec 18 D4).** Only motorways and motorway bridges are yellow-orange; primary,
    secondary, tertiary and trunk roads are white (light) / gray (dark), so no street reads as a bus line. Tested on the
    fixtures and the live OpenFreeMap styles.
20. **Current trip with no trip (owner 2026-11-04, spec 18 D6).** No nearby buses without a trip: the alert row, "No current
    trip selected" with how to start and a Search for a destination button (a second way into Directions besides the
    search circle, so the empty screen is never a dead end), the station search with its links, and the favorites;
    the collapsed card says "No current trip selected" in the two-line header style the trip uses. This departs from the
    ship checklist's "next bus in one glance" by the owner's choice; the next-bus block still follows a trip in progress.

## Performance (measured)

Same harness as the first redesign (`trace.py`, `fcp.py`: headless Edge, SwiftShader WebGL, 393 x 852 at DPR 2, demo
mode), the first redesign's build (71e33bc) against this one (measured at a402803, before the later same-day map changes),
4 interleaved runs, medians. One run per build presented
about 1,000 frames with no main-thread frames (a different compositor mode in headless) and is left out.

| Measure (spec 12.2) | First redesign | Glass | Change | Budget | Met |
|---|---|---|---|---|---|
| Sheet drag: GPU / raster time per frame | 4.89 ms | 6.59 ms | +35% | +10% | no |
| Sheet drag: main thread per frame | 0.36 ms | 0.42 ms | +17% | +10% | no |
| Sheet drag: style recalculation, whole drag | 35.3 ms | 43.1 ms | +22% | n/a | |
| Idle 5 s with buses gliding: GPU time per frame | 4.97 ms | 7.04 ms | +42% | +15% | no |
| Idle 5 s: style recalculation | 22.0 ms | 19.6 ms | -11% | +10% | yes |
| First contentful paint, 4x CPU, third parties blocked (6 runs) | 530 ms | 534 ms | +1% | < 700 ms | yes |
| Long tasks | none seen | none seen | | none | yes |

Blur at rest (spec 12.1, measured on the running app at 393 x 852 with the sheet collapsed and settled; the e2e
"glass budget" test and tests/feedback-button.js check the same rule on every run): demo mode 6 surfaces on 17.4% of the
screen (simulated-buses chip, Settings, the card's plate, the lower-right group, tab bar, search circle); live mode 6 on
16.3% (the feedback circle instead of the chip); a trip in progress 6 on 17.7% (the trip chip blurs, the feedback circle
and the simulated-buses chip turn solid). Budget: at most 6 on at most 22%. Expanded and settled, the plate and the
group stop blurring.

Why the GPU numbers miss: in this headless setup WebGL and compositing run in SwiftShader, a CPU rasterizer, so every
blurred surface over the moving map (the map redraws while buses glide and while the sheet moves) costs CPU time that a
phone's GPU spends in a fraction of it. The first redesign blurred four small controls at 20 px; this one blurs up to six
surfaces at 14 px, about 17% of the screen, and that difference is what the numbers show (the previous engineer's
earlier glass run measured the same gap: +31% drag, +52% idle). The spec's own mitigations are all in: no blur on
anything that moves (`#app.is-moving` turns the card plate and the group solid while the sheet drags or settles), only
transform and opacity animate, the rim and edge are static shadows, paint containment on the circles, and
`html.glass-lite` turns all glass solid for the session when more than 20% of frames take over 24 ms in the first 10 s of
use. A real iPhone and a mid-range Android (spec 12.3) are the only meaningful judges of the GPU budgets; if either
stutters, glass-lite should catch it, and the next step would be dropping the chips' blur (solid chips) before touching
the card or the tab bar. The long trace runs were slow on this PC (one attempt took 12 minutes per run and was stopped).

## Verified

The curated set is `docs/redesign/glass/web/` (phone size, 256 colors), shot in headless Edge with emulated touch and
safe areas on the build at 258ab96 (experimental main, sw sb-v2-93; it includes the other engineers' same-day map
changes: no route outlines, thinner lines, faded buses, off-route buses hidden). Looked at, light and dark unless
noted: Current trip collapsed and expanded with no trip ("No current trip selected"), search open, results, no matches,
place card with route options, the option with the bus and its steps, trip in progress (demo chip + trip chip in Row C
over the expanded sheet; live mode with the trip chip beside Settings), the trip collapsed on the map, route detail
collapsed / expanded, stop detail expanded / collapsed, Routes, My Routes, the custom route editor and its delete
confirmation, Settings and Credits, Lines by Time (sheet and applied), Alerts, About, the feedback circle and its panel,
the tab bar minimized, the basemap zoomed out (parks green, water blue, only motorways yellow). States: feed
unreachable (compact banner closed and open with Call 773.702.8181), live data delayed, out of date (open), no live
locations with See alert, loading, location blocked, long names, the missed-bus card, a toast, the desktop phone frame.
200% browser text: Current trip collapsed / expanded, trip in progress, Settings, the feed banner closed and open.
320 x 640: Current trip, trip in progress, route options, the feed banner closed and open.

Bug run: 128 screens on the first push's build, 77 on each later build. Found and fixed: the trip chip with no glass
material. The owner's later requests (compact banner, feedback circle, basemap, neutral main streets, trip chip when
expanded, no nearby buses without a trip) were each checked in light, dark, 200% text and 320 px before their push.
Harness notes: a few scenarios timed out once and passed on a rerun; once the demo feed stalled in a long 200% scenario
(the app correctly showed the feed-error banner; a rerun was clean); the CDP mouse-wheel event hung in dark mode only,
so the zoomed-out map shots use a script wheel event.

Browser suite: 763 tests when this work started, 800 now (with the other engineers' additions), all passing;
`tools/test_precache.py` 6/6. Pushed to experimental main in three steps, every Pages run green: 41877943201 (the
glass shell, feedback circle, compact banner, minimize, basemap), 41923292489 (neutral main streets, trip chip when
expanded), 41955239262 (no nearby buses without a trip); the test site served the matching cache name each time.

## Not verified

Real iPhone Safari and a mid-range Android (spec 12.3: ten sheet drags with buses moving, a 10 s map pan, tab switches),
SF Pro rendering under glass, the touch feel of the sheet, the minimize and the banner's Details, VoiceOver focus order
on a device, Reduce Transparency (iPhone Safari cannot report it), Increase Contrast on a device, keyboard-up states,
the landscape panel, the basemap on a phone's GPU (headless Edge renders WebGL through SwiftShader).
