# Design audit, iPhone app (2026-10-10)

Scope: the native SwiftUI app in `ios/` (every screen, light and dark). The web audit of the same day is
`docs/DESIGN-AUDIT-2026-10-10.md`; this one mirrors the findings that apply to iOS.

- **Rules, in order:** `CLAUDE.md` ship checklist (rider safety > correct times > speed > intuitive UI > accessibility >
  privacy > portability), `docs/DESIGN.md` (its "1b. System rules": one accent, green = live data only, radius scale,
  copy, states), then Apple's Human Interface Guidelines for layout, controls and materials. The third-party taste
  skill says it is out of scope for native mobile (its section 13), so only its universal rules were applied: zero
  em / en dash separators, copy self-audit, color and shape consistency, WCAG AA contrast in light and dark, no
  wrapped primary buttons, no duplicate actions per screen, composed empty / loading / error states, no decorative
  dots, reduced motion, 44 pt targets.
- **Design read:** transit utility for UChicago riders, Apple Maps / Citymapper language, Apple HIG.
  **Dials:** VARIANCE 3, MOTION 3, DENSITY 6.

## Method

Evidence: the CI simulator screenshots on the `ios-preview` branch (build of `7055eb3`, iPhone 16 Pro simulator,
1206 x 2622, demo mode with simulated buses): 14 screens in light and dark plus 4 UI-test states. Colors were sampled
from the PNGs (sheet, buttons, text) and contrast computed with the WCAG formula. Code sweep of `App/Sources`,
`Shared`, `Widget`: every string literal (dashes, middle dots, wording), every system color (`.orange`, `.green`,
`.red`, `.blue`, `.secondary`), every literal radius, every button style and size, every accessibility modifier.
After the fixes the same screens were captured again by CI (see "Before / after").

## Status

Every finding below is fixed, except those under "Left deliberately".

| Commit | Findings |
|---|---|
| `iOS design: one palette and radius scale, AA contrast in light and dark, green only for live data` | 2.1, 3.1-3.6, 4.1-4.9, 5.1-5.3, 6.1, 7.1, 7.2, 8.1, 9.1, 9.2, 10.1-10.7, 11.1, 12.1, 12.2, 13.1, 14.1, 15.1, 15.2 |
| `iOS: "Simulated buses (demo)" switch in Settings ...` | 16.2 |
| `iOS + web: privacy policy and support pages ...` | 16.1 |
| `iOS CI preview: App Store 6.9-inch screenshot set ...` | 16.3, 16.4 |
| `iOS design: own button styles, swipe tray colors, keyboard hides the tab bar (from the CI screenshots)` | 3.7, 4.4, 4.10, 10.8, 11.1 (stop chips): found in the screenshots of the first pass |

The tokens live in `ios/Shared/Palette.swift` (app and widget extension): `Palette.text / text2 / text3 / accent /
accentFill / live / liveMark / warn / warnBg / danger / dangerFill / neutralFill / star / starBadge / sheet / card /
shadow` and `Radius.sheet / card / control / inner / badge / tag`. `primaryButtonStyle()` is the one primary button
(`PrimaryButtonStyle`: white on the accent fill); `secondaryButtonStyle(destructive:)` the secondary one
(`SecondaryButtonStyle`: accent or danger text on the neutral gray fill). Both are 44 pt tall with the 12 pt control
radius and are drawn by the app, so they look the same on the iOS 17 and iOS 26 SDKs.

### Contrast, before and after (WCAG ratio; text needs 4.5, marks 3)

| Pair | Before | After |
|---|---|---|
| Secondary text on the light sheet / card (system secondary label) | 3.29 / 3.44 | 5.94 / 6.47 (`text2` #5C5C63) |
| Secondary text, dark (on #1C1C1E / #2C2C2E) | 5.94 | 6.63 / 5.43 (`text2` #A1A1A8) |
| Links and text buttons, light (AccentColor #0A84FF on white) | 3.65 | 5.78 (#0060CC); 4.63 on the gray of a bordered button |
| Links, dark (#0A84FF on the bordered gray #39393D) | 3.6 | 4.66 (#64B0FF) |
| Primary button text, white on #0A84FF (Start, Call, Use my location) | 3.65 | 4.70 (`accentFill` #0071E3, both themes) |
| "Now" in system green on white | 2.22 | 4.86 (`live` #157A38); dark #32D74B 7.27 |
| Warnings in system orange on white ("Live data delayed", "1 active") | 2.20 | 5.35 (`warn` #A35400); dark #FFB340 7.81 |
| Error / destructive text, system red on white / on the bordered gray ("End trip") | 3.55 / 3.0 | 5.34 / 4.93 (`danger` #B8261A); dark #FF8C85 4.74 |
| Swipe Delete, alert count badge: white on system red (light / dark) | 3.55 / 3.41 | 5.70 (`dangerFill` #C4291C) |
| Swipe Edit: white on system orange | 2.20 | 4.70 (accent fill) |
| Swipe Details: white on system gray | 3.26 | 6.63 (`neutralFill` #5C5C63) |
| Favorite star, system orange on white (mark) | 2.14 | 5.35 (`star` #A35400); map badge white star on #A35400 5.3 |
| Feed-error pill, white on #B81C1C | 6.4 | 5.70 (same red as every red fill) |
| Delayed-data pill, black on yellow | 12.5 | 12.5 (kept, see "Left deliberately") |

## Findings

### 1. Em-dash / en-dash ban

| # | Screen | Evidence | Fix |
|---|---|---|---|
| 1.1 | Routes rows, route detail, hours | the brief named "Not running · Today 7:00 AM – 11:30 PM"; the Kit already formats ranges with "to" and "Mon-Fri" since `894ec30` (`Schedule.dayRange = "-"`) | verified: zero "–" / "—" in any Swift string of `App`, `Shared`, `Widget` (the one en dash in `Places.swift` is a search separator, never shown) |

### 2. Middle-dot rationing (max one per line)

| # | Screen | Evidence | Fix |
|---|---|---|---|
| 2.1 | Routes to station | rows "2 min walk · 119 m · North, South, East, RE" (two dots; `TripInfo.walkText` + " · ") | "2 min walk (119 m) · North, South, East, RE" (`PickView.walkShort`). The web's pick.js has the same two dots (for the web agent) |

Checked, one dot each: "Live · Leave in 3 min, est.", "Walk 2 min to X · bus 1:47 PM", "5 stops · ~5 min ride, est.",
"Today 4:00 PM to 4:29 AM · Scheduled now", "Shuttle stop · N, E", "Showing on the map · 3 routes", "53RD · 4 min",
"est. from live data · as of 1:44 PM", "Version 0.1.0 (1) · Schedule data from ...". The Lock Screen's "Data delayed ·
times may be off" became "Data delayed, times may be off".

### 3. Color lock (one accent; green means live)

| # | Screen | Evidence | Fix |
|---|---|---|---|
| 3.1 | Settings (Trip status on Lock Screen, bus alert routes, 2 stops / 1 stop, in-app alerts), Routes to station ("Only show the chosen station's routes") | switches on in system green, a second accent; green elsewhere means live GPS data | `.tint(Palette.accent)` at the root and on Settings: every switch is the accent |
| 3.2 | Trip timeline stop rows | "Now" painted green also when the time is a schedule estimate (`eta.est`) or the feed is late | green only for a live, fresh prediction; otherwise plain text |
| 3.3 | Directions | start pin a green dot; trip bar dot green (a trip in progress is not live data) | start = hollow ring (the destination keeps the map's red pin); trip bar dot accent |
| 3.4 | everywhere | system orange for warnings and stars, system red for errors, system blue for walk icons next to AccentColor #0A84FF (two blues) | one token each: `warn`, `danger` / `dangerFill`, `accent`; `star` for favorites |
| 3.5 | Route detail, "where the buses are" | a route-colored dot before every bus sentence: decoration repeating the route color of the page | a small bus symbol in the secondary color |
| 3.6 | Live Activity preview | blue-purple gradient behind the Lock Screen card (no gradients in the design) | flat dark backdrop standing in for the wallpaper |
| 3.7 | Custom route editor (second round) | route names in the accent: `.foregroundStyle(.primary)` inside a default-styled list button resolves to the tint, so a list of choices looked like a list of links | every `.primary` text is `Palette.text` |

### 4. Contrast, WCAG AA, light and dark

| # | Screen | Evidence | Fix |
|---|---|---|---|
| 4.1 | every screen | secondary text in the system secondary label: 3.3:1 on the light sheet | `Palette.text2` everywhere in the app's own views, list headers and footers included (the Lock Screen keeps the system vibrancy) |
| 4.2 | every link and text button | AccentColor #0A84FF: 3.65:1 on white | AccentColor asset light #0060CC, dark #64B0FF, plus Increase Contrast variants |
| 4.3 | Start, Call 773.702.8181, Use my location, Save, Show on map | white on #0A84FF 3.65:1 (dark mode tint would be worse with the lighter accent) | `primaryButtonStyle()`: white on #0071E3, 4.7:1 in both themes |
| 4.4 | My Routes swipe tray | Delete white on red 3.55, Edit white on orange 2.20, Details white on gray 3.26 | `dangerFill`, `accentFill`, `neutralFill` |
| 4.5 | My Routes "Service alerts" count badge | white on system red 3.55 (light) / 3.41 (dark) | `dangerFill` (5.7) |
| 4.6 | End trip (timeline, trip bar), Delete (custom route detail), Turn off bus alerts, Delete custom route | system destructive red on the bordered gray or on a white row: 3.0 to 3.6 | `.tint(Palette.danger)` instead of the system role color |
| 4.7 | Warnings ("Live data delayed. Bus times may be off.", "Alerts may be out of date", "1 active", stale bus lines) | system orange text 2.2:1 | `warn` (5.35 / 7.81) |
| 4.8 | Favorite stars (stop header, favorites card, My Routes, map) | system orange 2.1:1 as a mark | gold `star` (5.35); map badge white star on dark gold |
| 4.9 | Trip timeline "Bus 1617 heading here" pill | always white text, unreadable on a yellow route | text by route color luminance (`Color.textOn`) |
| 4.10 | every secondary button (second round) | once the whole app had the accent tint, system bordered buttons drew a tinted fill instead of the neutral gray (sampled #E9E9EB before), a pair whose contrast was not measured, and `.controlSize(.large)` made them 50 pt and wider (the trip card's "Arrive about ..." line wrapped) | `SecondaryButtonStyle`: the measured gray fill (`tertiarySystemFill`), 44 pt, 12 pt radius |

### 5. Shape lock (one radius scale)

| # | Screen | Evidence | Fix |
|---|---|---|---|
| 5.1 | all | literal radii 16 (sheet), 14, 12, 7 (bus marker), 5 (route chip), 4 (est. tag), 2, and capsules for the context bar, tags, timeline bus chips | `Radius.*` tokens; continuous corners; data marks (chart bars) and the Lock Screen / Dynamic Island preview frames keep their own |
| 5.2 | Map | locate button a circle next to the 12 pt context bar and status pill | rounded square, `Radius.control`, like Apple Maps' map controls |
| 5.3 | Route chips | a yellow chip (53RD) has no edge on the light card (1.2:1), dark blue (AP) none on the dark card | a thin ring when the route color is under 3:1 against the card (DESIGN.md section 1) |

### 6. CTA wrap ban

| # | Screen | Evidence | Fix |
|---|---|---|---|
| 6.1 | Stop detail | "Directions to here" wraps to two lines in a half-width primary button | "Directions" / "From here" on one line each (VoiceOver: "Directions to <stop>", "Directions from <stop>"); `ViewThatFits` stacks them at large text sizes instead of wrapping |

### 7. No duplicate action per screen

| # | Screen | Evidence | Fix |
|---|---|---|---|
| 7.1 | My Routes | a "Settings" row while the Settings gear is on screen in the search bar | row removed (matches the web) |
| 7.2 | Routes list during a journey or a custom route | the map context bar ("Only showing routes for ... Show all", "My route ... Clear") and the list's own bar with the same button, both visible at the half detent | the context bar is hidden on the Routes list; the list bar stays |

### 8. States

| # | Screen | Evidence | Fix |
|---|---|---|---|
| 8.1 | Current trip (nearest stop cards, Arriving soon), stop detail | loading is a line of text, "Loading live data..." | row-shaped placeholders (route chip, two lines, ETA) on the 52 pt row rhythm; static, so nothing moves under Reduce Motion; VoiceOver reads "Loading live data" |

Empty and error states were already composed (title, one sentence, official phone and page); kept.

### 9. Surfaces

| # | Screen | Evidence | Fix |
|---|---|---|---|
| 9.1 | the sheet in dark mode | `systemGroupedBackground` = pure #000000 (sampled), cards #1C1C1E | sheet #1C1C1E, cards and list rows #2C2C2E: the elevated colors a system sheet gets |
| 9.2 | cards and list rows in light mode | pure #FFFFFF | #FCFCFD; shadows tinted slate instead of black |

### 10. Dynamic Type (no truncated key information)

| # | Screen | Evidence | Fix |
|---|---|---|---|
| 10.1 | all | the space above the sheet was a fixed sum (64 + 46 per status pill + 50 per context bar); a pill that wraps to three lines at large text slid under the full sheet | the chrome stack is measured (`onGeometryChange`), the sheet's full detent stays below it |
| 10.2 | Status pill | `lineLimit(3)`: the feed-error text could be cut at accessibility sizes | no line limit (safety text); the pill stops growing at AX2 |
| 10.3 | Sheet title | one line shrunk to 70 %: long stop names truncated | two lines, 85 % at most |
| 10.4 | Route detail stop rail, trip timeline stop rows | fixed 44 pt rail, names on one line | rail height scales with the text style (`@ScaledMetric`), names wrap to two lines |
| 10.5 | Arrival, favorite and "Arriving soon" rows | the ETA could be squeezed by a long route name | ETA `fixedSize` + layout priority; the route name wraps to two lines |
| 10.6 | Route chips | fixed 13 pt text, did not follow the text size | scale with Dynamic Type up to 1.8x |
| 10.7 | Tab bar, search bar, context bar | grew without bound and could cover the map | tab bar stops at XXL with the Large Content Viewer (touch and hold), like the system tab bar; search and context bar at XXXL |
| 10.8 | Directions and every search field (second round) | the tab bar stayed above the keyboard (`18-search`): 56 pt less room for suggestions | the tab bar hides while the keyboard is up, like Apple Maps |

### 11. 44 pt targets

| # | Screen | Evidence | Fix |
|---|---|---|---|
| 11.1 | context bar Show all / Clear (36), status pill Retry (32), Edit map order and the My Routes header New / Edit (text height), stop route chips ("N" 24 wide), small bordered buttons (Show, Show all / Hide all, Cancel / Save, Update, Save as new, End trip: 34) | below 44 | 44 pt frames with content shapes; the secondary buttons are 44 pt tall (`SecondaryButtonStyle`, see 4.10); stop route chips get 10 pt of padding each, so the gaps stay even |

### 12. VoiceOver

| # | Screen | Evidence | Fix |
|---|---|---|---|
| 12.1 | Tab bar | buttons were an SF Symbol plus a label (the symbol name could be read) | explicit label per tab, selected trait kept |
| 12.2 | About | the "bullet" glyph before each privacy line was read | hidden from VoiceOver |

Kept: one-sentence rows (arrivals, favorites, route stops, trip stops), the adjustable sheet, live-region pill.

### 13. Reduce Motion

| # | Screen | Evidence | Fix |
|---|---|---|---|
| 13.1 | Map | camera flights (fit a route, fly to a stop or to your location) animated even with Reduce Motion on | they snap (`AppModel.fit` / `flyTo`) |

Already right: sheet spring, toast, bus glide, timeline bus chip.

### 14. Lock Screen

| # | Screen | Evidence | Fix |
|---|---|---|---|
| 14.1 | Live Activity on the Lock Screen | the card sits on a black tint but used the system color scheme: in light mode secondary text was dark gray on dark | dark scheme and white text, like the in-app preview |

### 15. Copy self-audit

| # | Screen | Evidence | Fix |
|---|---|---|---|
| 15.1 | Settings > Privacy | "Your location stays on this iPhone; only the start and end of a walking route ... go to Apple Maps": the web's 15.3 contradiction | "Your live location is never sent anywhere; the only location data that leaves this iPhone is the start and end of a walking leg, rounded to about 10 m, sent to Apple Maps for sidewalk directions." |
| 15.2 | Live Activity preview | a disabled button "Live Activity running" (gray on gray, 2:1) | a status line "Live Activity running on the Lock Screen" with a check; the button only when it can act |

Every other visible string was re-read (Views, Shared, Widget, the Kit wording modules); they are plain and specific.

### 16. App Store prep (docs/APPSTORE-SUBMIT.md gaps 2 to 5)

| # | Item | Done |
|---|---|---|
| 16.1 | 5.1.1(i) privacy policy in the app | `web/privacy.html` and `web/support.html` on Pages; About has "Privacy policy" and "Help and bug reports", Settings > Privacy has "Privacy policy". The policy repeats the About statements: nothing collected, what stays on the device, what leaves it (Passio feeds, typed text to photon.komoot.io only below 5 local matches, rounded walking-leg endpoints to Apple Maps on iOS and routing.openstreetmap.de / valhalla1 on the web, map requests, GitHub Pages for the web app and, since `2c7a87a`, the iPhone app's daily schedule-update check on blobberus.github.io), retention, deletion, contact = GitHub issues |
| 16.2 | 2.1 reviewer may see no buses | Settings > Demo > "Simulated buses (demo)": off by default, never saved (and off after 15 minutes in the background), "Demo mode: simulated buses / Not real shuttles. Times are made up." with Turn off on every screen while on, never mixed with live data (feed state reset, in-flight poll dropped, trip ended, bus alerts paused, Live Activity labeled "Simulated (demo)") |
| 16.3 | 6.9-inch screenshots | CI `store/` set from an iPhone 17 / 16 Pro Max simulator: 1320 x 2868, light, alpha removed, sizes checked |
| 16.4 | complete preview | gallery gains custom route detail, custom route editor, Edit map order, Settings at the Demo switch, two simulated-buses UI test shots; the tour opens Alerts |

## Before / after

Same CI scenes, before = `ios-preview` of `7055eb3`, after = the scratch-branch runs of this work (artifact
`ios-simulator-preview`), then the `main` preview.

- **Every screen (demo build):** a "Demo mode: simulated buses / Not real shuttles. Times are made up." banner sits under
  the search bar (Directions: at the top), in Settings and in the Live Activity preview; before, only the Current trip
  alert card said so.
- **Dark mode:** the sheet was pure black under #1C1C1E cards; now #1C1C1E under #2C2C2E cards, as in a system sheet.
- **Settings:** every switch was green; now the accent blue. "1 ACTIVE" was system orange; now gold #A35400 (light).
  New at the bottom: Demo > Simulated buses (demo) with its footer, Privacy > Privacy policy.
- **Directions:** the start pin was a green dot, now a hollow ring; Start was white on #0A84FF, now on #0071E3.
- **Stop:** "Directions to here" wrapped onto two lines in its half-width button; now "Directions" and "From here" each
  fit on one line. The header star was system orange, now gold. Route chips sit at an even gap.
- **Route detail:** the bus sentences had a green (route color) dot each; now a small bus symbol.
- **Routes to station:** "2 min walk · 119 m · North, South, East, RE" became "2 min walk (119 m) · North, South, East, RE".
- **Routes / trip card:** secondary buttons (Show all / Hide all, End trip, From here, Routes to station...) are 44 pt
  with the neutral gray fill and 12 pt corners; the first pass's tinted 50 pt buttons are gone, and "Arrive about
  6:43 PM · 10 min" fits on one line again.
- **My Routes swipe tray (UI test):** Details gray / Edit orange / Delete red with white text (2.2 to 3.6:1) became
  #5C5C63 / #0071E3 / #C4291C (4.7 to 6.6:1).
- **Custom route editor (new gallery screen):** route names were accent-blue like links; now body text.
- **Place search:** the tab bar no longer floats above the keyboard.
- **Live Activity preview:** the gradient card is a flat dark card; the gray disabled "Live Activity running" button is a
  status line with a check; with simulated buses the footer reads "Simulated buses (demo), not real".
- **App Store set (new):** six 1320 x 2868 light-mode PNGs from an iPhone 17 Pro Max simulator: arrivals, Directions,
  trip, Live Activity, route, stop.

## Left deliberately (and why)

- **Delayed-data pill stays system yellow** with dark text (12.5:1) instead of the web's gold tint: over the map it is
  the loudest warning in the app, which ship checklist item 1 wants. The feed-error pill uses the shared danger fill.
- **System components keep system colors**: the delete confirmation dialog's "Delete", the long-press menu's Delete
  (system destructive red), the Settings and Live Activity preview sheets' grouped cells (system white in light mode).
  They are Apple's controls in Apple's sheets (HIG); the custom swipe-tray colors were changed.
- **Map conventions**: walking legs are the system blue dashed line and the destination is the red pin, as in Apple
  Maps; stop dots and bus badges keep white rings (marker rings are allowed by the color rule).
- **Lock Screen and Dynamic Island preview frames** keep the system's 22 / 40 pt radii: they imitate system surfaces.
- **Next bus below the fold at the half detent** on Current trip and the several search entries there (search bar,
  station field, "Type an address or place"): the owner's v2.4 layout, same as the web audit's note.
- **App Store screenshots show simulated buses with their "Demo mode" labels.** Honest and identical to the app, but a
  reviewer could read "Demo" as a demo build (guideline 2.2). If the owner prefers clean shots, they need real
  service (an iPhone on campus) or an owner decision to hide the labels for marketing frames only.
- **Real-device checks** (VoiceOver pass, Dynamic Type on hardware, Lock Screen look in light and dark) need an iPhone.

## For the web agent

- `web/js/ui/views/pick.js` `walkText` + " · " makes two middle dots per row ("4 min walk · 320 m · N, E"); iOS reads
  "4 min walk (320 m) · N, E".
- The web About has the privacy statements but no link to `privacy.html` / `support.html`.
