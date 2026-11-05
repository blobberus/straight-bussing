# Straight Bussing design specification (shared by the iPhone app and the website)

> **In the live repository (since 2026-11-05):** the website (`web/`) implements this spec; it came over from the
> experimental repository with the owner's request "Transfer the interface of the experimental build to the current main
> build of straight bussing" (docs/ARCHITECTURE.md "Glass interface on the live site"). The live iPhone app keeps its
> earlier interface (`ios/README.md`); the iPhone parts of this spec are built only in the experimental repository
> (https://github.com/blobberus/straight-bussing-experimental), where that work is paused (`docs/redesign/GLASS-IOS-PAUSED.md` there). Screenshots referred to below live
> there too: https://github.com/blobberus/straight-bussing-experimental/tree/main/docs/redesign

Status: v1 of the redesign spec, 2026-11-02, written from `docs/REDESIGN-AUDIT.md` (the evidence) and the owner's brief
`Straight Bussing New Version.txt`. Both implementations follow this file: the SwiftUI app (`ios/`) and the website
(`web/`). Where this file and `docs/DESIGN.md` disagree on visuals, this file wins; `docs/DESIGN.md` "Copy" rules (no em
or en dash, at most one middle dot per line, one label per intent, button labels on one line) still apply.

Direction in one line: **Google Maps' functional clarity, Apple Maps' restrained native look.** The map is the product;
everything else is quiet, consistent and readable at a glance. A returning rider finds every screen where it was; it
just looks finished.

Contents: 1 Principles, 2 Typography, 3 Spacing and layout, 4 Color, 5 Icons, 6 Corner radii, 7 Materials,
8 Elevation, 9 Motion, 10 Components, 11 Map, 12 Journey wireframes, 13 Required states, 14 Token table,
15 Parity contract, 16 Implementation notes and checks, 17 Open decisions for the owner.

---

## 1. Principles

1. **Map first.** The map gets the most pixels, the least decoration and the clearest hierarchy: you, your trip, the
   lines, then the city. Chrome floats small and consistent over it.
2. **One answer per surface.** Each sheet state has one thing to read first (the next bus, the best option, the next
   step) and one primary action. Everything else is secondary in size, weight and color.
3. **Honest, quietly.** Every estimate, stale feed and unofficial status stays visible (Ship checklist 1 and 2), written
   in one consistent notation instead of repeated chips and sentences.
4. **Native, not ported.** System font, system text styles, iOS grouped lists, system controls on iOS and faithful
   equivalents on the web. No web-shaped buttons, no Material indicators, no hand-rolled glass.
5. **Same app twice.** Tokens, components, words and states are identical on both platforms; only the parts the platform
   owns differ (section 15).

Non-negotiables carried from the Ship checklist: stale or failed feeds always flagged; ETAs from live tripUpdates; derived
numbers marked "est." with their source; the next bus in one glance with no taps; first paint under 2 s; 44 pt targets;
WCAG AA (4.5:1 text, 3:1 meaningful non-text) in light and dark; reduced motion; state never by color alone; nothing new
leaves the device; plain static JS on the web; no UChicago names, logos or maroon in the app's own UI (place names,
operator alerts verbatim and the official number 773.702.8181 are content, not branding).

---

## 2. Typography

**Family.** The system font only. iOS: SF Pro through Dynamic Type text styles (`Font.TextStyle`), never fixed point
sizes except map labels. Web: `-apple-system, BlinkMacSystemFont, system-ui, "Segoe UI Variable Text", "Segoe UI",
Roboto, "Helvetica Neue", Arial, sans-serif` (SF Pro on Apple devices, the platform UI font elsewhere). No second family:
the rounded ETA face (`ui-rounded`) is retired; weight and size carry the ETA.

**Weights.** Three only: Regular 400, Semibold 600, Bold 700. (Retire 500, 590, 650, 800.)

**Numerals.** Tabular figures for every time, count and distance (`font-variant-numeric: tabular-nums` /
`.monospacedDigit()`), so ETAs do not jitter as they update.

**Case.** Sentence case everywhere, including iOS section headers (`.textCase(nil)`). Route short names stay as
published ("53RD", "AP/DX").

### 2.1 Role scale

Sizes are the iOS defaults at the Large (default) text size; both platforms scale them with the user's text size.

| Role | Use | iOS | Size / leading | Weight | Color |
|---|---|---|---|---|---|
| `sheetTitle` | Sheet header title: tab roots, Directions, stop and route names | `.title2` | 22 / 28 | Bold | `label` |
| `heroTitle` | The one thing to read first inside a sheet: next-step instruction, place name | `.title3` | 20 / 25 | Semibold | `label` |
| `rowTitle` | First line of a list row: stop, route, option total, step action | `.headline` | 17 / 22 | Semibold | `label` |
| `body` | Paragraphs, field text, row titles that are not emphasized | `.body` | 17 / 22 | Regular | `label` |
| `button` | Button labels | `.body` | 17 / 22 | Semibold | per button |
| `rowDetail` | Second and third lines of rows: walk time, headsign, status | `.subheadline` | 15 / 20 | Regular | `label2` |
| `sectionTitle` | Label above a group of rows ("Nearby", "Running", "Stops") | `.subheadline` | 15 / 20 | Semibold | `label2` |
| `footnote` | Honesty notes, timestamps, helper text, the "est." suffix next to small numbers | `.footnote` | 13 / 18 | Regular | `label2` |
| `caption` | Small labels: "Arriving In", option criteria, tags (Board here) | `.caption` | 12 / 16 | Semibold | per use |
| `tabLabel` | Bottom bar labels | `.caption2` | 11 / 13 | Semibold | `label2` / `tint` |
| `badge` | Route short name in a 24 pt badge | `.caption` | 12 / 16 | Bold | badge text |
| `badgeSmall` | Route short name in a 20 pt badge (steps, leg strip, chips) | `.caption2` | 11 / 13 | Bold | badge text |
| `etaHero` | The next-bus or next-step numeral | `.largeTitle` | 34 / 41 | Bold, tabular | `label` |
| `etaRow` | ETA numeral in rows | `.title2` | 22 / 28 | Semibold, tabular | `label` |
| `etaUnit` | "min" after an ETA numeral, inline on the baseline | `.subheadline` after `etaRow`, `.headline` after `etaHero` | 15 or 17 | Regular after `etaRow`, Semibold after `etaHero` | `label2` |

Map labels do not follow Dynamic Type (as in Apple Maps): `mapLandmark` 12 / 14 Semibold, `mapBadge` 11 / 13 Bold,
`mapCallout` 13 / 16 Semibold, street names in the basemap style (section 11).

Rules: at most four roles visible in one card; two roles used next to each other differ in at least two of size, weight
and color;
more space above a heading than below it; body measure at most 65 characters (only About, Privacy and alert text reach it).

### 2.2 Web sizing and text scaling

- Root font size = body size: `html { font-size: 106.25%; }` (17 px at the browser default; follows the browser's text
  size and zoom). Fixes the audit defect where the root was 15 px.
- On iPhone Safari the root follows Dynamic Type, like the native app:
  `@supports (font: -apple-system-body) and (-webkit-touch-callout: none) { html { font: -apple-system-body; } }`
  (17 px at the default text size, 53 px at AX5). `body` then sets the family and `--t-body`.
- Every role is written relative to body so the ratio is exact at any root size:
  `--t-sheet-title: 700 calc(1rem * 22 / 17) / calc(1rem * 28 / 17) var(--font);` and so on (section 14).
- Spacing stays in px (as on iOS, spacing does not scale with text); heights that hold text use `min-height`, never
  `height`.
- Text-size classes for layout switches, set by `ui/frame.js` from the computed root size and updated on `resize`:
  `html[data-text="default"]` (root under 20 px), `"large"` (20 to 27 px, iOS xLarge to xxxLarge), `"ax"` (28 px and
  up, iOS accessibility sizes). iOS uses `@Environment(\.dynamicTypeSize)` and `.isAccessibilitySize` for the same
  switches.
- Chrome caps: the search bar text, status and filter chips, map buttons and tab labels stop growing at 1.35 x
  (xxxLarge): CSS `font-size: min(<role size>, <role px> * 1.35)`; iOS `.dynamicTypeSize(...DynamicTypeSize.xxxLarge)`
  plus `.accessibilityShowsLargeContentViewer()` on tab items and map buttons (long press shows the large label).
  Sheet content never caps.

---

## 3. Spacing and layout

**Scale (4 pt base).** `s1` 4, `s2` 8, `s3` 12, `s4` 16, `s5` 20, `s6` 24, `s8` 32, `s10` 40. A 2 pt hairline gap is
allowed inside composite marks (badge rows). No other values.

| Layout constant | Value | Use |
|---|---|---|
| `insetContent` | 16 | Sheet content left / right padding; card inner padding |
| `insetChrome` | 12 | Floating controls from the screen edge |
| `gapChrome` | 8 | Between floating controls (search bar to chip, chip to chip) |
| `tap` | 44 | Minimum hit area for anything tappable; visuals smaller than 44 (chips 32 to 36, End trip, filter buttons, badges) extend their hit area with padding |
| `rowMin` | 44 | One-line row; two-line rows land at about 60 with 12 pt vertical padding |
| `leadingSlot` | 40 | Width of the row's leading badge or icon column; text starts at 16 + 40 + 12 = 68 |
| `separatorInset` | 68 | Row separators start under the text, not under the badge |
| `searchHeight` | 48 | Floating search bar |
| `sheetHeader` | 56 min | Back + title + trailing; grows with text |
| `grabber` | 36 x 5, 6 from the top | Sheet grab bar (hit area = the whole header) |
| `tabBar` | 49 + bottom safe area | Bottom bar |

**Section rhythm in the sheet:** 24 above a `sectionTitle`, 8 between it and its card, 12 between cards in one section,
16 between the header and the first section. **Safe areas:** floating controls start at `safe top + 8`; the tab bar pads
the bottom safe area; nothing tappable sits under the Dynamic Island or the home indicator.

---

## 4. Color

### 4.1 Semantic tokens (light / dark)

| Token | Light | Dark | Role |
|---|---|---|---|
| `bgSheet` | `#F2F2F7` | `#1C1C1E` | The sheet, the tab bar, Settings and Lines by Time backgrounds (iOS grouped background) |
| `bgCard` | `#FCFCFD` | `#2C2C2E` | Grouped cards and rows on the sheet, option cards, dialogs (never pure `#FFF`) |
| `bgChrome` | `rgba(252,252,253,.86)` + blur | `rgba(44,44,46,.86)` + blur | Floating controls over the map (section 7) |
| `bgChromeSolid` | `#FCFCFD` | `#2C2C2E` | The same without blur (fallbacks, reduced transparency) |
| `bgInverse` | `#2C2C2E` | `#F2F2F7` | Toasts |
| `fill` | `rgba(118,118,128,.12)` | `rgba(118,118,128,.24)` | Secondary buttons, fields inside the sheet, segmented track, skeletons (= iOS `tertiarySystemFill`) |
| `fillPressed` | `rgba(118,118,128,.20)` | `rgba(118,118,128,.36)` | Pressed rows and buttons |
| `label` | `#111114` | `#F5F5F7` | Primary text |
| `label2` | `#5C5C63` | `#AEAEB2` | Secondary text, placeholders, section titles |
| `label3` | `#8E8E93` | `#8D8D93` | Decorative marks only (row chevrons, separators in leg strips); never information |
| `labelInverse` | `#F5F5F7` | `#111114` | Text on `bgInverse` |
| `separator` | `rgba(60,60,67,.29)` | `rgba(84,84,88,.60)` | Row separators, header hairline (iOS `separator`) |
| `tint` | `#0060CC` | `#64B0FF` | The one accent: links, selection, back, switches, selected tab |
| `tintFill` | `#0071E3` | `#0071E3` | Primary button fill, user location dot, walking path |
| `tintBg` | `#D9E7F8` | `#223042` | Tinted surfaces: Board here tag, the beta card, a selected option's header |
| `onFill` | `#FFFFFF` | `#FFFFFF` | Text and marks on `tintFill`, `dangerFill` and dark route colors |
| `live` | `#157A38` | `#32D74B` | Live data as text ("Now", "Live") |
| `liveMark` | `#1E9E4A` | `#32D74B` | Live data as a mark (the 8 pt live dot) |
| `warn` | `#A35400` | `#FFB340` | Delayed data, warnings, favorite star (always with the star shape) |
| `warnBg` | `#FFF4E0` | `#3A2A10` | Warning banners and the service-alert row |
| `danger` | `#B8261A` | `#FF8C85` | Error and destructive text |
| `dangerBg` | `#FDECEB` | `#3A1A18` | Feed-error banner |
| `dangerFill` | `#C4291C` | `#C4291C` | Red fills under white text (Delete, count badge) |
| `scrim` | `rgba(20,22,32,.40)` | `rgba(8,8,12,.55)` | Behind dialogs and the Settings card |
| `shadowRGB` | `30, 32, 45` | `8, 8, 12` | Cool slate shadows, never pure black |

Changes from today: web dark `tint` `#409CFF` becomes `#64B0FF`, web `danger` takes the iOS values, web light `live`
becomes `#157A38`, dark `label2` lifts from `#A1A1A8` to `#AEAEB2`, `separator` takes Apple's opacity. The web sheet
becomes opaque `bgSheet` and its cards `bgCard` (the iOS arrangement), ending the surface inversion.

### 4.2 Contrast (computed, WCAG 2.x)

| Text | on `bgSheet` | on `bgCard` | on `fill` over card | on `fill` over sheet | on own tint bg |
|---|---|---|---|---|---|
| `label` light / dark | 16.9 / 15.6 | 18.4 / 12.8 | 16.0 / 9.8 | 14.8 / 11.7 | |
| `label2` light / dark | 5.9 / 7.7 | 6.5 / 6.3 | 5.6 / 4.8 | 5.2 / 5.8 | `tintBg` 5.3 / 6.1 |
| `tint` light / dark | 5.3 / 7.5 | 5.8 / 6.1 | 5.0 / 4.7 | 4.6 / 5.6 | `tintBg` 4.7 / 5.9 |
| `live` light / dark | 4.9 / 8.9 | 5.3 / 7.3 | not allowed | not allowed | |
| `warn` light / dark | | 5.4 / 7.8 | | | `warnBg` 5.0 / 7.8 |
| `danger` light / dark | 5.7 / 7.6 | 6.2 / 6.2 | 5.3 / 4.7 | 4.9 / 5.7 | `dangerBg` 5.5 / 7.0 |
| `onFill` on `tintFill` / `dangerFill` | 4.7 / 5.7 | | | | |

Rules: `live` text never sits on a fill (only on sheet or card). `label3` never carries information. Every new pair is
added to the web contrast test (`tests/ui-shell-contrast.js`) and the iOS audit table.

### 4.3 Route colors

Route colors come from GTFS `route_color` and are data, never decoration. They appear in exactly four places: the route
badge, the line on the map, the rail of that route in timelines, and the bus marker. Never as text on the sheet, never as
a card or row background, never as a button color.

- **Badge text** is whichever of `#FFFFFF` and `#111114` has the higher contrast on the route color (ignore GTFS
  `route_text_color` when it is lower; e.g. RED `#D62728`: white 5.0:1 vs black 3.8:1).
- **Badge ring**: when the route color is under 3:1 against the surface it sits on, the badge gets a 1 pt inside ring,
  `rgba(17,17,20,.22)` on light surfaces, `rgba(245,245,247,.30)` on dark ones (53RD yellow on `bgCard` is 1.2:1; RE
  navy on dark `bgCard` 1.4:1). Every badge has the same shape whether ringed or not.
- **Map line casing**: removed 2026-11-04 (owner: "Remove the outlines for the lines"); route lines are drawn without
  an edge, so a few route colors sit under 3:1 on the land (section 11.3).

### 4.4 Status color rule: green means live data, and nothing else

Kept, because (1) Apple Maps and Google Maps both show real-time departures in green, so riders already read it that
way, (2) riders of this app have learned it since v2, and (3) it is always paired with the word "Live" and a dot shape,
so it never relies on color alone. Consequences: switches and selection are `tint` blue, not green (iOS Toggles get
`.tint(Palette.tint)`); "Scheduled" is `label2` with no dot; stale data loses the green (hollow ring + "Last known");
no other green anywhere in the chrome. The brand teal of the app icon (`#00A894`) stays in the icon and never in the UI:
next to live green it would blur the rule.

---

## 5. Icons

iOS uses SF Symbols. The web uses **Lucide** (ISC license; SF Symbols may not be used outside Apple platforms), drawn on
its 24 grid with a 2 px stroke, round caps and joins, shown at the sizes below (a 2 px stroke at 20 px reads like SF
Symbols Regular). Gaps in Lucide (walking figure, antenna with slash) are drawn on the same grid and stroke, kept in one
file (`web/js/ui/icons.js`). No emoji, no mixed stroke widths (today 2, 2.2 and 2.4 are mixed). One glyph per meaning.

| Meaning | SF Symbol (iOS) | Web (Lucide or drawn) | Size |
|---|---|---|---|
| Search | `magnifyingglass` | `search` | 20 |
| Lines by Time | `clock` | `clock` | 20 |
| Settings | `gearshape` | `settings` | 20 |
| My location (button, "Use my location", Location row) | `location` / `location.fill` while following | `navigation` (outline / filled) | 20 |
| Current trip (tab) | `bus` / `bus.fill` selected | `bus-front` (outline / filled body) | 24 |
| Routes (tab) | `point.topleft.down.to.point.bottomright.curvepath` / `.fill` | `route` | 24 |
| My Routes (tab) | `bookmark` / `bookmark.fill` | `bookmark` (outline / filled) | 24 |
| Back | `chevron.backward` (semibold) | `chevron-left` (2.5 px stroke) | 17 |
| Row disclosure | `chevron.forward` (semibold, `label3`) | `chevron-right` | 13 |
| Swap Start / Destination | `arrow.up.arrow.down` | `arrow-up-down` | 20 |
| Walk | `figure.walk` | drawn walking figure | 15 inline, 20 in steps |
| Station result | `bus` | `bus-front` | 20 |
| Place result | `mappin` | `map-pin` | 20 |
| Directions (to here) | `arrow.turn.up.right` | `corner-up-right` | 17 |
| Favorite | `star` / `star.fill` (`warn`) | `star` (outline / filled) | 17 |
| Service alert, warning | `exclamationmark.triangle.fill` | `triangle-alert` | 17 |
| Info | `info.circle` | `info` | 17 |
| Feed error | `wifi.slash` | `wifi-off` | 17 |
| Live data delayed | `clock.badge.exclamationmark` | `clock-alert` | 17 |
| No live locations | `antenna.radiowaves.left.and.right.slash` | drawn (radio waves + slash) | 17 |
| No shuttles running | `bus` | `bus-front` | 17 |
| Simulated buses | `flask` | `flask-conical` | 17 |
| Show / hide route | `eye` / `eye.slash` | `eye` / `eye-off` | 20 |
| Reorder | `line.3.horizontal` | `menu` | 20 |
| Call | `phone.fill` | `phone` | 17 |
| External link | `arrow.up.right.square` | `square-arrow-out-up-right` | 15 |
| More | `ellipsis` | `ellipsis` | 20 |
| Add | `plus` | `plus` | 17 |
| Clear field | `xmark.circle.fill` (`label3`) | `circle-x` | 17 |
| Done / selected | `checkmark` | `check` | 17 |

Sizes in pt / px: `iconInline` 15 (beside `rowDetail` / `footnote`), `iconRow` 17 to 20, `iconTab` 24. Icons beside
text are hidden from assistive tech; standalone icon buttons carry a label (`accessibilityLabel` / `aria-label`).
Selected tab = filled variant + `tint`; everywhere else outline. Icon color follows its text (`label`, `label2` or
`tint`); status icons take their status color.

---

## 6. Corner radii

Five values (today seven). iOS draws every rounded rectangle with `style: .continuous`; the web uses plain
`border-radius` (no squircle on the web, a documented platform difference).

| Token | Value | Used for |
|---|---|---|
| `rTag` | 6 | Route badges (24 and 20 pt), small tags, skeleton bars; the map bus marker uses 7 at 26 pt tall (same proportion) |
| `rControl` | 12 | Buttons, fields inside the sheet, segmented control track, wheel selection band, menus |
| `rCard` | 14 | Grouped cards, option cards, in-sheet banners, place summary |
| `rSheet` | 20 | Sheet top corners, dialogs, Settings and Lines by Time cards, the Directions field card |
| `rCapsule` | full | Everything floating over the map (search bar, map buttons as circles, status and filter chips), toggles, count badges, callouts, the toast |

Concentric rule: a shape nested inside another with inset `i` gets `outer radius - i` (segmented thumb in a 12 track
with 2 inset = 10; Directions fields inside the 20 card with 10 inset = 10). These derived values are not tokens.

---

## 7. Materials and translucency

Rule: **translucency only for small controls floating over the map.** Nothing that holds reading content is translucent.

| Surface | Treatment |
|---|---|
| Search bar, Directions field card, locate button, status chip (info), demo chip, trip / filter chip | `bgChrome` + blur. iOS: `.regularMaterial` in the shape (`Capsule()` / `RoundedRectangle(cornerRadius: 20, style: .continuous)`). Web: `background: var(--bg-chrome); backdrop-filter: blur(20px) saturate(1.2)` |
| Sheet, tab bar, cards, Settings, Lines by Time, dialogs, toasts | Opaque (`bgSheet`, `bgCard`, `bgInverse`) |
| Warning and error banners over the map | Opaque status backgrounds (`warnBg`, `dangerBg`): a state must read the same over any map |

Why opaque sheet: the audit shows the blurred sheet picking up route colors as smears (audit contributor 3); an opaque
sheet gives text its full contrast, matches the iOS app's grouped sheet, and removes the most expensive paint on the web
(a large blurred layer moving under a finger).

Liquid Glass: the iOS app is built with Xcode 26, so on iOS 26 the system's own surfaces (keyboard, alerts,
confirmation dialogs, menus, system-presented sheets such as Settings and Lines by Time, their toolbar buttons) render
in Liquid Glass automatically. Keep that; do not set `UIDesignRequiresCompatibility`. Do not hand-roll `glassEffect` on
the app's own chrome in this round: parity with the web, contrast control over saturated lines and performance come
first (open decision O2).

Web performance rules: at most four blurred elements on screen; blur radius 20 and saturate 1.2 (the current 1.8 is what
makes route colors bleed); never blur an element that moves every frame; `contain: paint` on blurred chrome; the fill is
86% opaque so text stays AA even where blur is unavailable. Solid `bgChromeSolid` when `@supports not (backdrop-filter:
blur(1px))`, under `prefers-reduced-transparency: reduce`, and under `prefers-contrast: more`. iOS honors Reduce
Transparency automatically through system materials.

---

## 8. Elevation and shadows

| Level | Use | Light | Dark |
|---|---|---|---|
| `e0` | Everything inside the sheet (cards separate by surface color, not shadow) | none | none |
| `e1` | Floating controls over the map | `0 1px 2px rgba(30,32,45,.10), 0 4px 14px rgba(30,32,45,.12)` | no shadow; 0.5 px inside border `rgba(255,255,255,.10)` |
| `e2` | Sheet | `0 -1px 0 rgba(60,60,67,.12), 0 -8px 28px rgba(30,32,45,.10)` | 0.5 px top border `rgba(255,255,255,.10)` |
| `e3` | Dialogs, menus, toast | `0 10px 40px rgba(30,32,45,.22)` | `0 10px 40px rgba(8,8,12,.5)` + 0.5 px border `rgba(255,255,255,.10)` |

iOS equivalents: `e1` = `.shadow(color: Palette.shadow.opacity(0.10), radius: 1, y: 1)` +
`.shadow(color: Palette.shadow.opacity(0.12), radius: 7, y: 4)`; dark uses an `.overlay` stroke instead. Map markers
use their own small shadow (section 11.4). No colored glows, no zero-offset halos, no other shadows.

---

## 9. Motion

Motion explains state and continuity, nothing else. Routine changes are fast; there is no page-load choreography.

| Token | Duration / curve | Use |
|---|---|---|
| `mPress` | 100 ms ease-out | Press feedback: opacity .6 for text and icon buttons; rows and filled buttons take `fillPressed` / opacity .85 and scale .98 |
| `mQuick` | 150 ms ease-out | Toggles, chip state, small crossfades, skeleton to content |
| `mStandard` | 250 ms `cubic-bezier(0.2, 0, 0, 1)` | Content swap in the sheet; push to a sub view (16 pt slide from the trailing edge + fade in), back reverses |
| `mExit` | 200 ms `cubic-bezier(0.4, 0, 1, 1)` | Things leaving: chips, toasts, dialogs (exits are faster than entrances) |
| `mSheet` | iOS `.spring(response: 0.38, dampingFraction: 0.88)` started at the finger's velocity; web 360 ms `cubic-bezier(0.32, 0.72, 0, 1)` scaled by distance and velocity (`ui/sheet.js settleMs`, kept) | Sheet settle |
| `mMorph` | 300 ms `mStandard` curve | Search bar into the Directions card and back (FLIP on the web, matched geometry on iOS) |
| `mCamera` | 600 ms ease-in-out | Map camera moves to a selection |
| Bus glide | linear over the poll interval (kept: `map/track.js`, `BusMotion`) | Buses on their line |

- Live numbers (ETAs, stop counts) change without animation: calm, and the same on both platforms.
- Haptics (iOS only): `.sensoryFeedback(.selection)` on a detent snap and on segmented / wheel changes; `.impact(weight:
  .light)` on Start; none for live updates.
- **Reduced motion** (`prefers-reduced-motion` / `accessibilityReduceMotion`): pushes and the morph become 150 ms
  crossfades; the sheet settles with a 150 ms ease and no overshoot; the camera jumps; no pulse rings; press feedback is
  opacity only. Meaningful state changes still show (a crossfade is not removed).
- Animate only transform and opacity on the web; `will-change: transform` on the sheet only while it is dragged.

---

## 10. Components

Each component lists anatomy, sizes, states and platform notes. "Text" names refer to section 2 roles; colors to 4.1.

### 10.1 Floating search bar

- Capsule, 48 tall, `insetChrome` from both edges, top at `safe top + 8`, `bgChrome` + `e1`.
- Leading `search` icon 20 `label2`, 16 from the edge; placeholder "Search for a destination" in `body` `label2`, one
  line, ellipsis.
- Trailing two 44 x 44 icon buttons, `clock` (Lines by Time) and `gearshape` (Settings), icons 20 `label`, no dividers.
- Press: the capsule takes `fillPressed` over its material for `mPress`. Tap: morph into the Directions field card
  (`mMorph`); the sheet expands with suggestions.
- Text caps at 1.35 x (2.2). At accessibility sizes the placeholder shortens to "Search" rather than wrapping.

### 10.2 Directions field card

- Takes the search bar's place: `rSheet` card, `bgChrome` + `e1`, 10 inner inset.
- Two fields stacked, each 44 tall, `fill`, radius 10 (concentric: 20 - 10): a 10 pt hollow `tint` ring (Start; today a
  green ring, which breaks the green-means-live rule) and a 10 pt `dangerFill` dot (Destination, the map convention for
  a destination pin, matching the destination pin on the map) as leading marks, `body` text, `xmark.circle.fill` clear
  button when focused.
- Swap button 44 x 44 at the trailing edge, centered between the fields, `arrow.up.arrow.down` 20 `tint`.
- Default Start "My location" when location is granted. Collapsing the sheet hides the keyboard; leaving Directions
  morphs back.

### 10.3 Status chip and status banner (over the map, under the search bar)

Same words, icons and actions as today (`ui/pill.js`, iOS `StatusPill`); two forms by severity:

| Form | States | Look |
|---|---|---|
| Chip | Simulated buses (demo) | Capsule 32 tall, sized to content, leading-aligned under the search bar, `bgChrome` + `e1`; `flask` 15 + `footnote` Semibold `label`; trailing `info` 15 `tint`; whole chip is the button |
| Banner | Live data delayed; out of date; no live locations; no shuttles running; feed unreachable | Full width (`insetChrome`), `rCard`, opaque `warnBg` (delayed, out of date, no live locations, no shuttles) or `dangerBg` (unreachable), `e1`; status icon 17 in `warn` / `danger`; text `rowDetail` in `label`, at most 2 lines at default size (first sentence Semibold); the action ("Retry", "See alert") on the LEADING side in a fixed slot (84 x 44 pt, a `bgCard` capsule with `tint` text, top-leading corner of the banner) that never moves (see the Retry rule below) |

- Exact copy is kept, e.g. "Can't reach the shuttle feed." (Semibold) + "Don't rely on these times; call 773.702.8181."
- **Retry never shifts (owner 2026-11-03):** "move the retry button to the left side of the notification so if the user
  spams it while on a route, it doesn't shift and accidentally cancel their current trip." The slot keeps its size and
  place whatever the text or state; while a Retry poll runs it shows progress in place and further taps do nothing but
  keep the banner; when the feed comes back right after a tap, the banner keeps its height and place for 2.5 s after the
  last tap ("Live data is back.", a check mark, taps absorbed), so the trip chip (whose Show all ends the trip) and the
  sheet never slide up under the finger; a stray tap on the leading side lands on the chip's label, never on its
  trailing action. iOS: Kit `RetryHold` (unit-tested) and the UI test `testRepeatedRetryDuringATripKeepsTheTrip`.
  Web: `ui/pill.js` (`RETRY_HOLD_MS` 2500, `BACK_MSG`; repeated taps join the running poll, `data/live.js pollNow`), the
  unit test in `tests/ui-shell-pill.js` and the e2e test "Retry tapped again and again during a trip" in `tests/e2e.js`.
- One banner at a time (priority: unreachable > out of date > delayed > no live locations > no shuttles), plus the demo
  chip if both apply (chip first). Never iOS system yellow fills (audit: one state, one look).
- Announce changes politely: web `role="status"` with `aria-live="polite"` (kept); iOS posts one accessibility
  announcement when the state changes, never on every poll.

### 10.4 Locate button

- 44 circle, `bgChrome` + `e1`, top trailing under the search bar (beside the chip, or under the banner).
- `location` 20 `tint`; `location.fill` while the map follows you; tap while following re-centers. Denied: stays
  visible, tap opens the location help (13.3). Never the same glyph as a tab.

### 10.5 Trip and filter chip

- Replaces today's context bar. Capsule 36 tall, `bgChrome` + `e1`, under the search bar.
- Content: route badges (`badgeSmall`, up to 3, then "+2"), the label in `footnote` Semibold `label` (e.g. "Trip to
  Trader Joe's", "Morning commute", "Lines active at 4:00 PM"), trailing "Show all" (or "Clear") as a 44 pt `tint` text
  button.
- Only the label truncates (ellipsis); badges and the action never clip (audit defect 2).

### 10.6 Bottom sheet and detents

- Opaque `bgSheet`, `rSheet` top corners, `e2`. Grab bar 36 x 5 `label3` at 60%, 6 from the top; the whole header is the
  drag area (kept).
- **Two resting states, as decided by the owner (2026-10-12):** collapsed (grab bar + header) and expanded (top edge 8
  below the search bar, or below the status banner while one shows). Drag, velocity, rubber band, tap to toggle, Escape
  and keyboard slider behavior unchanged (`ui/sheet.js`, `BottomSheet.swift`).
- Collapsed height = 16 + the header's measured height (grows with text; never cuts the title, audit defect 5).
- Header row (min 56, `insetContent` sides): optional back button 44 x 44 (`chevron.backward` 17 Semibold `tint`),
  `sheetTitle` (up to 2 lines, then ellipsis; full text in the accessibility label), trailing slot for one summary or one
  action.
- **The collapsed header carries the one-line answer**, so the main tasks work with the map visible:

| View | Collapsed header |
|---|---|
| Current trip, no trip | "Current trip" + trailing: route badge 20 + `etaRow` "4 min" + live dot (the next bus at the nearest stop) |
| Current trip, trip in progress | Two lines: `rowTitle` current step ("Walk to Ellis Ave & 57th St"), `rowDetail` "Trip to Trader Joe's"; trailing `caption` "Arriving In" over `etaRow` "12 min" (owner wording; "Walk 2 min" on walking legs) |
| Directions with results | "Directions" + trailing best option "29 min" `etaRow` + "est." |
| Stop | Stop name + trailing next arrival (badge + ETA) |
| Route | Route name + trailing "2 buses" / "Not running" `rowDetail` |
| Routes, My Routes | Title + trailing action ("Edit map order", "New") |

- Content scrolls only when expanded. When content scrolls under the header, a `separator` hairline appears under the
  header (no blur, no shadow).

### 10.7 Bottom bar (sections)

- Three items, equal width: Current trip, Routes, My Routes (names kept). 49 + bottom safe area, opaque `bgSheet` (it
  reads as the sheet's base), `separator` hairline on top.
- Item: icon 24 over `tabLabel`; selected = filled glyph + `tint` for both icon and label; unselected = outline +
  `label2`. **No capsule indicator** (a Material pattern). Whole column is the hit area (at least 44 x 49).
- Web: `<nav>` with `aria-current="page"`; iOS: buttons with `.isSelected` trait. Labels cap at 1.35 x with the large
  content viewer on iOS.

### 10.8 Section titles, grouped cards, rows

- **Section title:** `sectionTitle` (`label2`, sentence case), aligned with card content (16 + 16 from the screen edge
  on cards), optional trailing action in `subheadline` Semibold `tint` ("Edit", "All favorites").
- **Grouped card:** `bgCard`, `rCard`, `insetContent` from the sheet edges, rows separated by `separator` at
  `separatorInset`, no shadow, no border.
- **Row:** min 44; 12 vertical, 16 horizontal padding; `leadingSlot` 40 (route badge or 20 icon centered), 12 gap,
  text column (`rowTitle` + up to 2 lines `rowDetail`), trailing (ETA, value, toggle or `chevron.forward`).
  Pressed: `fillPressed`. Tappable rows are buttons with one combined accessibility label ("East, to Campus North,
  arrives in 4 minutes, live").
- **Metadata:** at most one middle dot per line; prefer a comma or a second line ("2 min walk, 146 m").
- **Accessibility sizes (`ax`):** the leading badge moves above the title; the trailing ETA moves under the text,
  left-aligned; chevrons stay trailing.
- Cards never nest. A card inside a card becomes a section.

### 10.9 Route badge

- Rounded rectangle `rTag` (6), route color fill, text by the contrast rule (4.3), ring when needed.
- Sizes: **24** tall (rows; `badge` text, min width 32, 6 horizontal padding) and **20** tall (inline in steps, leg
  strips, chips; `badgeSmall`, min width 28, 5 padding). The short name is never truncated: longer names widen the badge;
  over 5 characters drops to 10 pt.
- Hidden route: same badge at 40% opacity with "Hidden" in the row text (never color alone).

### 10.10 ETA and estimate notation

One notation everywhere (Current trip, stop, route, trip, Directions, Live Activity):

| Case | Shows | Source mark (under the row title or after the number) |
|---|---|---|
| Live prediction | `etaRow` numeral + inline `etaUnit` " min" ("4 min"); "Now" in `live` Semibold under 1 min; clock time ("4:12 PM", `rowTitle`) at 60 min or more | `liveMark` 8 pt dot + "Live" in `live` (`rowDetail`) |
| Scheduled | same numeral | "Scheduled" in `label2`, no dot |
| Stale (late / out of date) | "~" + numeral in `label2` | hollow 8 pt ring + "Last known" in `label2` |
| Derived numbers (leave by, wait, ride, total, walk-to-catch) | the number, then the text suffix "est." in `label2` at the unit's size ("Leave in 9 min, est.", "29 min est.") | its source in words where the checklist requires it ("from live bus prediction", "from schedule") |

- The unit sits on the numeral's baseline, never stacked under it (audit contributor 4).
- "est." is **text, not a filled chip**. Small gray tags ("est.", "live", "sidewalk route") are retired; "sidewalk route"
  becomes plain detail text.
- ETA column: trailing, right-aligned, min width 64 so rows align; at `ax` it moves under the text.
- `etaHero` (34 Bold + "min" 17 Semibold `label2`) appears once per screen at most: the next bus or the next step.

### 10.11 Buttons

| Kind | Look | Use |
|---|---|---|
| Primary | `tintFill`, `onFill` `button` text, 50 tall when full width, 44 inline, `rControl` | The one primary action of a screen: Start, Use my location, Directions (stop), Set time, Give feedback |
| Secondary | `fill`, `tint` `button` text, same sizes | From here, How to allow location, Retry (in sheet), Cancel in dialogs |
| Secondary destructive | `fill`, `danger` text | End trip, Delete (before confirmation) |
| Destructive confirm | `dangerFill`, `onFill` text | The confirm button of a delete dialog only |
| Text | `tint` `button` text, no fill, 44 tall hit area | Header actions (Edit, New, Done, Cancel), inline links |
| Icon | 44 x 44, icon 20; no fill in the sheet, `bgChrome` circle over the map | Swap, more, map buttons |

- **One primary per screen**; a second action of equal weight uses Secondary. Equal-height buttons in one row share the
  width. Labels on one line at 393 pt; stack the buttons rather than wrap a label.
- Press `mPress`; disabled = 45% opacity and not focusable. iOS: `PrimaryButtonStyle` / `SecondaryButtonStyle`
  updated to these values (50 pt full width, radius 12, continuous).
- The outlined pill button ("Favorite" today) is retired: Favorite becomes a Secondary button with the star icon
  ("Favorite" / "Favorited", `star.fill` in `warn` when on).

### 10.12 Segmented control and filter buttons

- **Segmented** (Appearance: Auto / Light / Dark; Directions options if added): track `fill`, `rControl`, 36 tall; thumb
  `bgCard`, radius 10, shadow `0 1px 3px rgba(30,32,45,.15)`; labels `rowDetail` Semibold `label`. iOS: the system
  `Picker(.segmented)`.
- **Routes visibility filter** (Show all / Show running / Hide all) is three actions, not a segmented state: a row of
  three Secondary capsule buttons, 36 tall (44 hit area), `rCapsule`; the one that matches the current state shows `checkmark` 15 and
  `label` text; none is drawn as disabled (today "Show all" looks disabled when all routes show).

### 10.13 Switches, pickers, menus, dialogs

- Switch: iOS system `Toggle` with `.tint(Palette.tint)`; web 51 x 31 track, on = `tintFill`, knob `bgCard` with
  `0 1px 3px rgba(30,32,45,.3)`, 150 ms.
- Wheel pickers (Lines by Time): iOS system wheels; web `ui/wheel.js` with the selection band in `fill`, radius 10,
  rows `body` (selected `rowTitle` Semibold).
- Menus (row "More", custom route actions): iOS `Menu` / swipe actions; web a popover card `bgCard`, `rControl`, `e3`,
  44 pt rows.
- Dialogs: iOS `.confirmationDialog` / `.alert`; web centered card `bgCard`, `rSheet`, `e3`, over `scrim`; title
  `rowTitle`, message `rowDetail`; buttons side by side (Cancel Secondary, confirm Primary or Destructive confirm), or
  stacked when a label would wrap.

### 10.14 Place details card

Two uses, one anatomy.

**Stop (place details for a station)** (`views/stop.js`, `StopDetailView`):

```
[<]  Reynolds Club                                 sheetTitle, 2 lines max
     South University Avenue, 1 min walk           rowDetail
     [N] [E] [CEN] [SLS]                           badges 24, wrap, 8 gap
     [  Directions  ] [ From here ] [ Favorite ]   Primary + Secondary + Secondary, 44 tall, one row
Arrivals                                           sectionTitle
 ┌────────────────────────────────────────────┐
 │ [CEN] Central                      3 min    │   row: badge, rowTitle, ETA
 │       • Live, Bus 1624                       │   source mark
 ├────────────────────────────────────────────┤
 │ [E]   East                         4 min    │
 └────────────────────────────────────────────┘
Updated just now                                   footnote
```

Button labels follow the iPhone app ("Directions", "From here", "Favorite"); the web's "Directions to here" shortens so
the three fit one row at 393 pt (copy change, O8). At `ax` the three buttons stack, Primary first.

**Destination (place details inside Directions)**: a compact card above the options, so the "place details" step costs
no extra tap:

```
 ┌────────────────────────────────────────────┐
 │ (pin)  Trader Joe's                          │  36 circle tintBg + map-pin 17 tint; heroTitle (2 lines max)
 │        Grocery, 1528 E 55th St               │  rowDetail
 │        2 min walk to Hyde Park Shopping      │  rowDetail
 │        Center (N)                            │
 └────────────────────────────────────────────┘
```

Far destination: the coverage note (owner wording kept) sits inside this card as a `warnBg` inline note with
`exclamationmark.triangle.fill`.

### 10.15 Route option card

- One `bgCard` card per option, `rCard`, 16 padding, 12 between cards; up to four options (kept, `core/rank.js`).
- Collapsed option (four lines):
  1. `caption` `label2` criteria ("Least walking", "Earliest arrival"), sentence case. Not accent-colored.
  2. `heroTitle` total "29 min" + `footnote` "est." on the left; `rowTitle` "Arrive 3:28 PM" on the right.
  3. Leg strip: walk icon 15 + "2" `footnote` Semibold, `chevron.forward` 11 `label3`, badge 20, chevron, walk + "3".
  4. `rowDetail` one line: "Leave in 10 min, bus 3:11 PM at Ellis Ave & 57th St" + live dot when that bus time is live.
- Selected option: 2 pt `tint` border drawn inside (no layout shift), then a separator, the step list (10.16), the
  Primary button "Start" full width, and the `footnote` "Shows only this trip's routes on the map. Follow the bus stop by
  stop in Current trip." Only the selected card shows steps.
- Walk-first card (kept, "Close enough to walk"): walk icon in a 36 `tintBg` circle, "8 min walk" `heroTitle`,
  "Arrive 3:05 PM", `rowDetail` "605 m on sidewalks". Start works without a bus (kept).
- The "Bus times are estimates..." note appears once, after the last option, in `footnote`.
- At `ax`: line 2 stacks (total, then arrival), the leg strip wraps, the total and its unit never split (audit defect 5).

### 10.16 Step list (Directions and the trip timeline)

A vertical timeline with a 24 pt rail column:

- Walk legs: dotted rail (3 pt dots, 6 pt gap, `tintFill`), node = walk icon 15 in a 24 `tintBg` circle.
- Bus legs: 4 pt rail in the route color; intermediate stops 10 pt circles (`bgCard` fill, 2.5 pt route-color stroke);
  boarding and alighting stops 14 pt solid route color with a 2 pt `bgCard` ring.
- Step text: action in `rowTitle` ("Walk 2 min to Ellis Ave & 57th St", "Ride 53RD 10 stops to Lake Park & 55th St."),
  detail in `rowDetail` ("Leave by 3:09 PM to catch the 3:11 PM bus, est."), source in words.
- "Board here" and "Get off here": `caption` Semibold `tint` on a `tintBg` capsule, 20 tall, after the stop name.
- The live bus: a route-colored chip 20 tall (`badgeSmall`, bus icon + number) sitting on the rail between stops; passed
  stops at `label2` with "Passed".
- Collapsed stop runs ("3 more stops before Kimbark Plaza"): one `rowDetail` line with a disclosure, as today.

### 10.17 Trip in progress (active navigation)

Expanded Current trip while a trip runs, top to bottom:

```
Trip to Trader Joe's                     [ End trip ]   heroTitle + Secondary destructive (36 visual, 44 hit)
Arrive about 3:28 PM, 29 min est.                       rowDetail
 ┌──────────────────────────────────────────────────┐
 │ (walk)  Walk 2 min to Ellis Ave & 57th St   12 min │  next-step card: 40 icon circle, heroTitle,
 │         Leave in 9 min, est.                       │  etaHero trailing; rowDetail lines
 │         Bus 1631 is 6 stops away                   │
 └──────────────────────────────────────────────────┘
Steps                                                    sectionTitle
 (step list 10.16, starting at the next step)
Nearby                                                   the existing Current trip content follows
```

- The collapsed header shows the current step and Arriving In (10.6), so a rider can follow the trip on the map.
- The map shows the trip (focused lines 11.3, callouts and walking dots 11.4); the trip chip under the search bar names
  it and offers "Show all".
- Missed bus / re-plan: a `warnBg` inline banner at the top of the next-step card (13.8).

### 10.18 In-sheet alert row

- Service alerts on Current trip and stop pages: `warnBg`, `rCard`, min 44, 12 / 16 padding,
  `exclamationmark.triangle.fill` 17 `warn`, `rowDetail` "Service alert: " Semibold + title, one line with ellipsis,
  `chevron.forward`. Opens Alerts. Same component in `dangerBg` for the in-sheet feed-error notice.
- Alerts page: one card per alert, `rowTitle` title, `body` text verbatim (phone numbers as call links), `footnote`
  "Until Jan 31".

### 10.19 Toast

- Capsule, `bgInverse`, `labelInverse` `rowDetail` Semibold, 44 min height, max width 360, `e3`, up to 2 lines.
- Placed centered 12 above the sheet's top edge (collapsed) or 12 above the tab bar (expanded); never over the search
  bar, the sheet title or Settings (audit defect 3). 3 s, or 6 s when it contains an action; `role="status"` / an
  accessibility announcement.

### 10.20 Empty state and skeleton

- Empty state inside a card: 28 icon `label3`, `rowTitle` title, `rowDetail` text, optional Secondary action; centered
  in the card, never loose on the sheet. Copy kept ("No upcoming arrivals", "Nothing is predicted at this stop right now.").
- Skeleton rows have the row's shape (badge 32 x 24, two text bars, ETA bar) in `fill`, `rTag`; opacity 0.6 to 1 over
  1.2 s; static under reduced motion. Never a spinner on a blank sheet.

### 10.21 Footnotes (honesty notes)

`footnote` `label2`, placed once at the end of the section they explain, 12 above the next section. Keep every existing
note; never repeat a note on the same screen.

---

## 11. Map

### 11.1 Layer order (bottom to top)

Basemap land, water, parks, buildings, roads, street names → route lines of the network (unfocused) → focused route lines
→ walking path → stops → landmark names (owner rule: above the lines) → favorites → bus markers → trip callouts ("Board
here", "Get off") → user location and heading cone. Floating chrome sits above the map.

### 11.2 Basemap (web `js/map/style.js` palettes; iOS MapKit)

Quiet, low-contrast land; streets readable; nothing colored except water and parks, both desaturated.

| Layer | Light | Dark |
|---|---|---|
| Land (`background`) | `#F1F2EE` | `#18191C` |
| Park / wood | `#DCE9D5` / `#E2EADC` | `#1C2621` / `#1A221D` |
| Water / water text | `#B7D3E6` / `#4A6E8C` | `#10202D` / `#86A9C6` |
| Buildings / outline | `#E4E3DE` / `#CFCDC6` | `#232327` / `#303036` |
| Minor road / casing | `#FFFFFF` / `#D3D5CF` | `#33343A` / `#0B0B0D` |
| Major road / casing | `#FFFFFF` / `#B3B7B0` | `#45464E` / `#0B0B0D` |
| Street names minor / major | `#4A4C53` Regular / `#2E3036` Bold | `#C9CAD2` Regular / `#E2E3EA` Bold |
| Name halo | land color, 1.5 px | land color, 1.5 px |

Keep the existing patch structure (hidden shields, one-way arrows and POIs; street names from z14 minor, z12.5 major;
house numbers from z17). Roads in dark stay neutral gray (mapbox-cartography: color is reserved for data layers).

iOS: `.mapStyle(.standard(elevation: .flat, emphasis: .muted, pointsOfInterest: .excludingAll))`. MapKit's basemap
cannot be recolored, so iOS parity is on the overlays (11.3 to 11.6), not the basemap.

### 11.3 Route lines

- Width by map zoom (Leaflet zoom on the web): z13 2, z14 2.25, z15 3, z16 4, z17 5, z18 6 since 2026-11-04 (owner:
  "Remove the outlines for the lines but make the lines themselves thinner"; was 3, 3.5, 4.5, 5.5, 6.5, 8). Round caps
  and joins. The line tap still measures from the old widths plus the old casing (hit width = old casing width + 14 px).
- **No casing since 2026-11-04**: the casing and its contrast switch below are gone on the web (route lines, planned bus
  legs, walking dots); kept here for the record. Weakest without an edge: 53RD yellow on the light map, RE navy on the
  dark map.
- **Network state** (nothing focused): every visible line at 0.9 opacity.
- **Focused state** (a route page, a trip, a stop, a custom route): focused lines +2 width, opacity 1; others 0.2;
  stops of unfocused routes hidden; buses of unfocused routes faded with them (2026-11-04: smaller, see-through, no
  tap). A trip in progress draws only the trip's lines and buses (a walk: none).
- **Casing**: 1.5 per side (line width + 3). Default casing: light map `rgba(255,255,255,.95)`, dark map
  `rgba(24,25,28,.9)`. **Contrast switch**: when the route color is under 3:1 against the default casing, the casing
  flips to the opposite edge, light map `rgba(17,17,20,.55)`, dark map `rgba(245,245,247,.55)`, so every line keeps a
  visible edge. With today's colors that flips 53RD (1.24:1), SLS (1.95), CEN (2.12), East (2.41) and AP/DX (2.84) on
  the light map, and RE (1.74), DCC (1.99), AP (2.05), Move In Charter (2.25) and FCM (2.50) on the dark map. Computed
  from the route color at runtime, never a hard-coded list.
- iOS: draw each line twice with `MapPolyline` (casing first, then the colored line) using the same widths and rule.
- Line tap opens the route (kept; hit width = casing width + 14 px).

### 11.4 Markers

| Marker | Spec |
|---|---|
| Stop | Circle with `bgCard` fill and route-color stroke: hidden below z14; z14 to 15 radius 4, stroke 2; z16 and up radius 5, stroke 2.5. Multi-route stops: neutral `label2` stroke. Selected stop: 16 pt, 3 pt `tint` ring, name label (`mapCallout`). Hit area 44 pt (kept). |
| Bus | Rounded rectangle 26 tall, min width 32, radius 7, route color fill, short name in `mapBadge` (11 Bold, never truncated; over 5 characters 10 pt), 2 pt ring (`#FFFFFF` light, `#18191C` dark), shadow `0 1px 3px rgba(30,32,45,.30)`. Heading: an 8 pt notch in the route color on the ring edge, turning with the bearing (kept). **Numbered buses** (owner 2026-10-30): the number sits inside the marker after a 1 pt divider in the text color at 40% ("AP/DX │ 2"), never as an overlapping disc. Picked bus: 3 pt `tint` outline at 3 pt offset. Stale bus: 50% opacity and the text "Last known" in the sheet. |
| User location | 18 pt dot `tintFill`, 3 pt white ring, shadow `0 1px 3px rgba(30,32,45,.3)`; accuracy circle `tintFill` at 10% with a 1 pt 25% edge; heading cone: wedge from the dot, `tintFill` 35% fading to 0, width 2 x the compass error (40 to 120 degrees, kept). |
| Walking path | Round dots 4 pt, 7 pt apart, `tintFill` (Apple Maps style), above the lines. |
| Trip callouts | "Board here", "Get off": capsule 24 tall, `tintFill`, `onFill` `mapCallout` text, 6 pt pointer toward the stop. |
| Favorite stops | `star.fill` white on a 20 pt `#A35400` disc (5.3:1), as today. |

### 11.5 Labels

- Hierarchy: user location and trip callouts > bus markers > landmark names > street names > place names of the basemap.
- Landmark names (`web/data/landmarks.json`, iOS `Landmarks`): keep the curation, tiers and collision rules; restyle to
  `mapLandmark` (12 / 14 Semibold, was 700), color `#565C66` light / `#B4B9C2` dark (6.0:1 and 8.9:1 on the land, 5.2:1 on buildings), a
  1.5 px halo in the land color (four-way, was ten shadows), no plate unless the label sits on a line. At the default
  zoom show at most about 8 tier-1 names. They stay above the lines (owner rule) but no longer outweigh them.
- Easter-egg nicknames: unchanged behavior, same style as landmarks.

### 11.6 Night style

Dark basemap (11.2), route lines at full color (no casing since 2026-11-04), bus marker rings `#18191C`, landmark text
`#B4B9C2`, user dot unchanged. Follows the app appearance (Auto / Light / Dark), not the clock.

---

## 12. Journey wireframes: search, place details, route selection, active navigation

All frames 393 x 852 pt, light; dark mirrors with the dark tokens.

**J1. Home, collapsed (where is my bus)**

```
┌───────────────────────────────────────┐
│ 9:41                      status bar  │
│ ( Search for a destination  clk gear) │  search capsule 48, bgChrome
│ (flask Simulated buses  i)     (loc)  │  demo chip (demo only), locate 44
│                                       │
│        MAP: quiet basemap, lines      │
│        at network state, you, buses   │
│                                       │
│ ╭───────────────────────────────────╮ │
│ │               ───                 │ │  grab bar
│ │ Current trip        [E] 4 min  *  │ │  sheetTitle; badge, etaRow, live dot
│ ╰───────────────────────────────────╯ │
│  (bus)        (route)     (bookmark)  │  bottom bar: icons 24, no indicator
│ Current trip   Routes     My Routes   │  tabLabel; selected one in tint
└───────────────────────────────────────┘
```

Expanded (tap the header or the tab): service alert row, nearest stop card with up to 3 arrivals (no scrolling,
owner 2026-10-11), "Search stations" field, Type an address or place / Routes to station (Secondary text buttons in one
row), Nearby section, footnote, "No trip in progress" quiet line.

**J2. Search**

```
┌───────────────────────────────────────┐
│ ╭───────────────────────────────────╮ │  Directions field card (rSheet, bgChrome)
│ │ o My location                 <>  │ │  Start mark, swap button
│ │ * trader joe|                 (x) │ │  Destination mark, clear
│ ╰───────────────────────────────────╯ │
│ ╭───────────────────────────────────╮ │  sheet expanded
│ │ <  Directions                     │ │
│ │ ┌─────────────────────────────┐   │ │  results card
│ │ │(pin) Trader Joe's           │   │ │  rowTitle
│ │ │      Grocery, 1528 E 55th St│   │ │  rowDetail: category, address, walk
│ │ ├─────────────────────────────┤   │ │
│ │ │(bus) Hyde Park Shopping Ce..│   │ │  station results use the bus icon
│ │ └─────────────────────────────┘   │ │
│ │ Places near campus are searched   │ │  footnote (privacy, kept)
│ │ on your device...                 │ │
└───────────────────────────────────────┘
```

Spelling fix: a `rowDetail` line "Showing results for Regenstein" above the card and a text button "Search for
"regnstien" instead" (kept). No results: the empty state component (10.20) in the card, with today's wording.

**J3. Place details + route options** (after choosing a result)

```
┌───────────────────────────────────────┐
│ ╭───────────────────────────────────╮ │
│ │ <  Directions       29 min est.   │ │  collapsed header: best option
│ │ ┌─────────────────────────────┐   │ │
│ │ │(pin) Trader Joe's           │   │ │  place summary (10.14)
│ │ │      Grocery, 1528 E 55th St│   │ │
│ │ └─────────────────────────────┘   │ │
│ │ ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓   │ │  option 1, selected (tint border)
│ │ ┃ Least walking               ┃   │ │  caption, label2
│ │ ┃ 29 min est.  Arrive 3:28 PM ┃   │ │  heroTitle + est.; rowTitle
│ │ ┃ (w)2 > [53RD] > (w)3        ┃   │ │  leg strip
│ │ ┃ Leave in 10 min, bus 3:11 * ┃   │ │  rowDetail + live dot
│ │ ┃ ─────────────────────────── ┃   │ │
│ │ ┃ steps (10.16)               ┃   │ │
│ │ ┃ [          Start          ] ┃   │ │  the one primary action
│ │ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛   │ │
│ │ ┌ option 2 (4 lines) ─────────┐   │ │
```

("(w)" stands for the drawn walk icon.) Collapsing the sheet shows the selected option drawn on the
map with the destination pin and the header "Directions, 29 min est.".

**J4. Route selected** (another option tapped): that card takes the border and steps; the map redraws the option
(`mStandard` crossfade of lines); the list does not jump (the selected card keeps its scroll position).

**J5. Active navigation, collapsed** (after Start; the sheet switches to Current trip, kept)

```
┌───────────────────────────────────────┐
│ ( Search for a destination  clk gear) │
│ ([53RD] Trip to Trader Joe's Show all)│  trip chip (10.5)
│                                       │
│   MAP: trip lines focused, others at  │
│   0.2; walking dots; "Board here"     │
│   callout; you and heading cone       │
│ ╭───────────────────────────────────╮ │
│ │               ───                 │ │
│ │ Walk to Ellis Ave &  Arriving In  │ │  rowTitle; caption
│ │ 57th St                  12 min   │ │  etaRow
│ │ Trip to Trader Joe's              │ │  rowDetail
│ ╰───────────────────────────────────╯ │
```

**J6. Active navigation, expanded**: 10.17 (trip header with End trip, next-step card with `etaHero`, steps, then
Nearby).

**J7. Arrival and end**: unchanged behavior (End trip returns to Current trip without a trip; the trip chip disappears;
lines return to the network state with `mStandard`).

---

## 13. Required states

Copy below is today's copy unless marked "new".

### 13.1 Loading

First paint shows the map area in the land color (no spinner), the search bar, the collapsed header with "Current trip",
and skeleton rows in the expanded sheet (10.20). The map style loads progressively; no layout shift when the first poll
lands (rows replace skeletons in place, `mQuick`). Never block on the geocoder, walking routes or learned data.

### 13.2 Errors

- Feed unreachable: status banner (10.3, `dangerBg`, "Can't reach the shuttle feed. Don't rely on these times; call
  773.702.8181." + Retry); in-sheet: "Live times unavailable" empty state with the official service line (kept); last good
  data stays (kept).
- Place search failure: under the results, "Couldn't search places right now. Station names still work." (kept,
  `directions.js`; Routes to station keeps "Could not search places right now") as a `footnote` hint, no modal.
- Walking route failure: steps fall back to the straight-line walking estimate, still labeled "est." (kept).

### 13.3 Denied or unavailable location

- Current trip: an in-sheet card first: `rowTitle` "Location is blocked for this site." + `rowDetail` explanation (kept,
  `core/lochelp.js`), Secondary "How to allow location" (opens Settings > Location with the exact steps), text button
  "Try location again"; then "Search stations" so the app stays usable.
- Locate button stays; tapping shows the same help. The "Tried at ..." feedback appears inside the card, not as a toast
  over the title (audit defect 3).
- iOS: "Change in iOS Settings" opens the app's Settings page.

### 13.4 Stale or failed feed

| Feed age / state | Banner | Numbers |
|---|---|---|
| fresh | none | live notation |
| 120 to 300 s old | `warnBg` "Live data delayed. Times may be off." | "~" + `label2`, "Live, delayed" source line |
| over 300 s old | `warnBg` "Live data is out of date (last update 2:59 PM). Times are approximate." | "~", "Last known" with a hollow ring |
| unreachable / over 60 s without a good poll | `dangerBg` banner (13.2) | live unknown: "Live times unavailable" |

Thresholds unchanged (`core/arrivals.js`: 60 / 120 / 300 s).

### 13.5 Empty

- No live locations during scheduled service (kept wording): warning banner "No shuttles are reporting live locations"
  + "See alert"; in-sheet: "No live locations right now" empty state naming the scheduled routes and end times, then
  "From the shuttle operator" with the alert verbatim, then "Call bus route help: <number>" (Primary) and "Safety or
  urgent: 773.702.8181" (Secondary) (owner order 2026-10-11).
- No shuttles running: banner with the bus icon; in-sheet "No shuttles running right now" + next service start + "Official
  schedule" link; the routes list dimmed (kept).
- No arrivals at a stop, no favorites, no custom routes, no alerts ("No active alerts. Service changes will show up
  here."): empty state component inside the relevant card.

### 13.6 Long place names

- `sheetTitle` wraps to 2 lines, then ellipsis; the full name is the accessibility label and appears in full in the place
  summary.
- Row titles wrap to 2 lines; `rowDetail` to 2 lines; route badges and ETAs never truncate and never wrap.
- Search field and chips: one line with ellipsis; the trip chip truncates only its label (10.5).
- Long names tested: "Max Palevsky Residential Commons (NE Corner)", "Ellis Garage & Ratner Athletic Center (East)",
  "Polsky Exchange North", "Institute for Study of Ancient Cultures", "S Lake Park Ave & E Hyde Park Blvd".

### 13.7 Larger text and zoom

- iOS: every role is a Dynamic Type style; test xSmall, Large, xxxLarge, AX3, AX5. Web: browser default font 16 to 32 px
  and page zoom to 200%; iPhone Safari follows Dynamic Type (2.2).
- At `large`: layouts hold; option totals stay on one line with their unit.
- At `ax`: rows stack (10.8), option line 2 stacks, button rows stack vertically, the collapsed header grows instead of
  clipping, chrome caps at 1.35 x with the large content viewer on iOS, the sheet's expanded state scrolls.
- Words never break mid-word (no "Regen- stein"): use `hyphens: none` / no `.hyphenation` and let the line wrap at spaces.

### 13.8 Rerouting (missed bus) and re-planning

- The app does not give turn-by-turn walking directions, so "rerouting" here means: the followed bus left before the rider
  reached the stop (`core/tripprogress.js missed`, Kit `TripFollow`), or Directions re-planned on new live data.
- Missed bus: a `warnBg` inline banner at the top of the next-step card, `rowDetail`: "You missed the 3:11 PM bus.
  Following the next one, 3:21 PM, est." (new wording for the existing missed note); the step list and Arriving In update
  in place; a trip alert follows the existing alert rules; no modal.
- Directions re-plan (every 8 s at most, kept): the selected card keeps its place; changed numbers update without
  animation; if the selected option disappears, a `footnote` under the list says "Options updated with live times." (new).
- Off the planned walking path: not detected today; out of scope for this redesign.

### 13.9 Demo and offline

- Demo: the demo chip (10.3) on every screen; never a banner; Settings changes not saved (kept).
- Offline (no network): the feed-unreachable state plus the offline support page for navigations (kept).

---

## 14. Token table (CSS custom property and Swift name)

Web values go in `web/css/tokens.css` (light in `:root`, dark in the `prefers-color-scheme` block and
`[data-theme="dark"]`); Swift values in `ios/Shared/Palette.swift` (`Palette.dynamic(light, dark)`), a new
`ios/Shared/Typography.swift` (`Typo`) and `ios/Shared/Metrics.swift` (`Space`, `Radius`, `Elevation`, `Motion`,
`IconSize`). Old web names (`--bg`, `--text`, `--text-2`, `--accent`, ...) stay as aliases until every stylesheet moves.
Careful with one rename: today's web `--live` is the mark color and `--live-text` the text color; after migration
`--live` is the text color (like iOS `Palette.live`) and `--live-mark` the mark.

### 14.1 Color

| Token | CSS | Swift | Light | Dark |
|---|---|---|---|---|
| bgSheet | `--bg-sheet` | `Palette.bgSheet` | `#F2F2F7` | `#1C1C1E` |
| bgCard | `--bg-card` | `Palette.bgCard` | `#FCFCFD` | `#2C2C2E` |
| bgChrome | `--bg-chrome` | `Palette.chrome` (= `.regularMaterial`) | `rgba(252,252,253,.86)` | `rgba(44,44,46,.86)` |
| bgChromeSolid | `--bg-chrome-solid` | `Palette.chromeSolid` | `#FCFCFD` | `#2C2C2E` |
| bgInverse | `--bg-inverse` | `Palette.bgInverse` | `#2C2C2E` | `#F2F2F7` |
| fill | `--fill` | `Palette.fill` (= `Color(.tertiarySystemFill)`) | `rgba(118,118,128,.12)` | `rgba(118,118,128,.24)` |
| fillPressed | `--fill-pressed` | `Palette.fillPressed` | `rgba(118,118,128,.20)` | `rgba(118,118,128,.36)` |
| label | `--label` | `Palette.label` | `#111114` | `#F5F5F7` |
| label2 | `--label-2` | `Palette.label2` | `#5C5C63` | `#AEAEB2` |
| label3 | `--label-3` | `Palette.label3` | `#8E8E93` | `#8D8D93` |
| labelInverse | `--label-inverse` | `Palette.labelInverse` | `#F5F5F7` | `#111114` |
| separator | `--separator` | `Palette.separator` | `rgba(60,60,67,.29)` | `rgba(84,84,88,.60)` |
| tint | `--tint` | `Palette.tint` | `#0060CC` | `#64B0FF` |
| tintFill | `--tint-fill` | `Palette.tintFill` | `#0071E3` | `#0071E3` |
| tintBg | `--tint-bg` | `Palette.tintBg` | `#D9E7F8` | `#223042` |
| onFill | `--on-fill` | `Palette.onFill` | `#FFFFFF` | `#FFFFFF` |
| live | `--live` | `Palette.live` | `#157A38` | `#32D74B` |
| liveMark | `--live-mark` | `Palette.liveMark` | `#1E9E4A` | `#32D74B` |
| warn | `--warn` | `Palette.warn` | `#A35400` | `#FFB340` |
| warnBg | `--warn-bg` | `Palette.warnBg` | `#FFF4E0` | `#3A2A10` |
| danger | `--danger` | `Palette.danger` | `#B8261A` | `#FF8C85` |
| dangerBg | `--danger-bg` | `Palette.dangerBg` | `#FDECEB` | `#3A1A18` |
| dangerFill | `--danger-fill` | `Palette.dangerFill` | `#C4291C` | `#C4291C` |
| scrim | `--scrim` | `Palette.scrim` | `rgba(20,22,32,.40)` | `rgba(8,8,12,.55)` |
| shadowRGB | `--shadow-rgb` | `Palette.shadow` | `30, 32, 45` | `8, 8, 12` |
| mapLandmark | `--map-landmark` | `Palette.mapLabel` | `#565C66` | `#B4B9C2` |
| mapCasing | `--map-casing` | `Palette.mapCasing` | `rgba(255,255,255,.95)` | `rgba(24,25,28,.9)` |
| mapCasingContrast | `--map-casing-contrast` | `Palette.mapCasingContrast` | `rgba(17,17,20,.55)` | `rgba(245,245,247,.55)` |
| badgeRing | `--badge-ring` | `Palette.badgeRing` | `rgba(17,17,20,.22)` | `rgba(245,245,247,.30)` |

Increase Contrast / `prefers-contrast: more`: `label2` = `#3C3C43` / `#C7C7CC`, `tint` = `#004A9E` / `#8AC4FF`,
separators opaque (`#C6C6C8` / `#38383A`), chrome solid (already in `Palette` for text and accent; extend to the rest).

### 14.2 Typography

CSS shorthand values use `calc(1rem * size / 17)` (root = body, 2.2). Swift `Typo` returns `Font`.

| Role | CSS | Swift | Definition |
|---|---|---|---|
| sheetTitle | `--t-sheet-title` | `Typo.sheetTitle` | `.title2.bold()` / `700 calc(1rem*22/17)/calc(1rem*28/17)` |
| heroTitle | `--t-hero-title` | `Typo.heroTitle` | `.title3.weight(.semibold)` / `600 calc(1rem*20/17)/calc(1rem*25/17)` |
| rowTitle | `--t-row-title` | `Typo.rowTitle` | `.headline` / `600 1rem/calc(1rem*22/17)` |
| body | `--t-body` | `Typo.body` | `.body` / `400 1rem/calc(1rem*22/17)` |
| button | `--t-button` | `Typo.button` | `.body.weight(.semibold)` / `600 1rem/calc(1rem*22/17)` |
| rowDetail | `--t-row-detail` | `Typo.rowDetail` | `.subheadline` / `400 calc(1rem*15/17)/calc(1rem*20/17)` |
| sectionTitle | `--t-section` | `Typo.sectionTitle` | `.subheadline.weight(.semibold)` / `600 calc(1rem*15/17)/calc(1rem*20/17)` |
| footnote | `--t-footnote` | `Typo.footnote` | `.footnote` / `400 calc(1rem*13/17)/calc(1rem*18/17)` |
| caption | `--t-caption` | `Typo.caption` | `.caption.weight(.semibold)` / `600 calc(1rem*12/17)/calc(1rem*16/17)` |
| tabLabel | `--t-tab` | `Typo.tabLabel` | `.caption2.weight(.semibold)` / `600 min(calc(1rem*11/17), 14.85px)/1.18` |
| badge | `--t-badge` | `Typo.badge` | `.caption.bold()` / `700 calc(1rem*12/17)/calc(1rem*16/17)` |
| badgeSmall | `--t-badge-sm` | `Typo.badgeSmall` | `.caption2.bold()` / `700 calc(1rem*11/17)/calc(1rem*13/17)` |
| etaHero | `--t-eta-hero` | `Typo.etaHero` | `.largeTitle.bold().monospacedDigit()` / `700 2rem/calc(1rem*41/17)` + tabular |
| etaRow | `--t-eta-row` | `Typo.etaRow` | `.title2.weight(.semibold).monospacedDigit()` / `600 calc(1rem*22/17)/calc(1rem*28/17)` + tabular |
| etaUnit | `--t-eta-unit` | `Typo.etaUnit` | `.subheadline` / `400 calc(1rem*15/17)/1` |
| mapLandmark | `--t-map-landmark` | `Typo.mapLandmark` | `.system(size: 12, weight: .semibold)` / `600 12px/14px` (fixed) |
| mapBadge | `--t-map-badge` | `Typo.mapBadge` | `.system(size: 11, weight: .bold)` / `700 11px/13px` (fixed) |
| mapCallout | `--t-map-callout` | `Typo.mapCallout` | `.system(size: 13, weight: .semibold)` / `600 13px/16px` (fixed) |
| font family | `--font` | system | `-apple-system, BlinkMacSystemFont, system-ui, "Segoe UI Variable Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` |

### 14.3 Spacing, layout, radius, icon size

| Token | CSS | Swift | Value |
|---|---|---|---|
| s1 ... s10 | `--s-1` `--s-2` `--s-3` `--s-4` `--s-5` `--s-6` `--s-8` `--s-10` | `Space.s1` ... `Space.s10` | 4, 8, 12, 16, 20, 24, 32, 40 |
| insetContent | `--inset-content` | `Space.insetContent` | 16 |
| insetChrome | `--inset-chrome` | `Space.insetChrome` | 12 |
| gapChrome | `--gap-chrome` | `Space.gapChrome` | 8 |
| tap | `--tap` | `Space.tap` | 44 |
| leadingSlot | `--leading-slot` | `Space.leadingSlot` | 40 |
| separatorInset | `--separator-inset` | `Space.separatorInset` | 68 |
| searchHeight | `--search-h` | `Space.searchHeight` | 48 |
| sheetHeader | `--sheet-header-min` | `Space.sheetHeaderMin` | 56 |
| tabBar | `--tab-h` | `Space.tabBar` | 49 (+ safe area) |
| rTag | `--r-tag` | `Radius.tag` | 6 |
| rControl | `--r-control` | `Radius.control` | 12 |
| rCard | `--r-card` | `Radius.card` | 14 |
| rSheet | `--r-sheet` | `Radius.sheet` | 20 |
| rCapsule | `--r-capsule` | `Capsule()` | 999 |
| iconInline | `--i-inline` | `IconSize.inline` | 15 |
| iconRow | `--i-row` | `IconSize.row` | 20 |
| iconTab | `--i-tab` | `IconSize.tab` | 24 |

Retired: `--r-inner` (derived, 6), `--r-badge` (9, now `rTag`), `--r-chip` (alias), `--font-rounded`, `--fs-*` / `--lh-*`
after migration.

### 14.4 Elevation and motion

| Token | CSS | Swift | Value |
|---|---|---|---|
| e1 | `--e-1` | `.elevation(.floating)` | section 8 |
| e2 | `--e-2` | `.elevation(.sheet)` | section 8 |
| e3 | `--e-3` | `.elevation(.overlay)` | section 8 |
| mPress | `--m-press` | `Motion.press` | 100 ms ease-out |
| mQuick | `--m-quick` | `Motion.quick` | 150 ms ease-out |
| mStandard | `--m-standard` + `--ease-standard` | `Motion.standard` | 250 ms `cubic-bezier(0.2,0,0,1)` / `.timingCurve(0.2, 0, 0, 1, duration: 0.25)` |
| mExit | `--m-exit` + `--ease-exit` | `Motion.exit` | 200 ms `cubic-bezier(0.4,0,1,1)` |
| mSheet | `--m-sheet` + `--ease-sheet` | `Motion.sheet` | 360 ms `cubic-bezier(0.32,0.72,0,1)` / `.spring(response: 0.38, dampingFraction: 0.88)` |
| mMorph | `--m-morph` | `Motion.morph` | 300 ms standard curve |
| mCamera | `--m-camera` | `Motion.camera` | 600 ms ease-in-out |

The z-index scale in `tokens.css` (`--z-*`) stays as it is.

---

## 15. Parity contract

### 15.1 Must be identical (web = iOS)

- Every token value in section 14 (colors, type roles and their relative sizes, spacing, radii, elevation intent, motion
  durations and curves).
- Information architecture: the three sections, their names and icons, the search bar contents, sheet states, back
  behavior, which view opens from where.
- Component anatomy and order: rows, badges, ETA notation, option cards, step list, place summary, banners, chips,
  trip header.
- Every word: titles, buttons, empty states, honesty notes, status texts, the "est." placement, the official number.
- State rules and thresholds: stale levels, demo, no live locations, missed bus, walk first, Arriving In.
- Map overlays: line widths by zoom, casing rule, focus and dim levels, marker shapes and text, label tiers and style,
  user dot and heading cone.
- Accessibility: 44 pt targets, AA pairs, labels, reduced-motion behavior, accessibility-size layouts.

### 15.2 May differ (platform owns it)

| Area | iOS | Web |
|---|---|---|
| Font | SF Pro on every device | SF Pro on Apple devices, Segoe UI / Roboto elsewhere |
| Text scaling | Dynamic Type | browser text size and zoom; Dynamic Type on iPhone Safari (2.2) |
| Basemap | Apple MapKit standard, muted | OpenFreeMap patched style (11.2) |
| Corner shape | continuous (squircle) | circular arcs |
| System surfaces | system sheets, alerts, menus, keyboard, swipe actions (Liquid Glass on iOS 26) | drawn equivalents (10.13) |
| Controls | system `Toggle`, `Picker(.segmented)`, wheel `Picker`, `Menu`, `confirmationDialog` | drawn to the same metrics |
| Materials | `.regularMaterial` | `backdrop-filter` approximation, solid fallback |
| Haptics, Live Activity, Dynamic Island, lock screen | yes | no (web: in-page alerts only while open) |
| Back gesture | edge swipe (kept alive) | browser back and the Back button |
| Large content viewer | yes (tab bar, map buttons) | capped chrome text instead |
| Desktop | n/a | the 393 x 852 phone frame on wide screens (kept) |

---

## 16. Implementation notes and acceptance checks

Order (lowest risk, highest visual return first, taste-skill redesign levers): 1 tokens and the root font fix; 2
typography roles; 3 surfaces (opaque sheet, grouped cards, tab bar); 4 floating chrome; 5 components (rows, badges, ETA,
buttons, option cards, steps, trip header); 6 map style and markers; 7 states pass; 8 accessibility-size layouts.

Web files: `css/tokens.css` (new tokens + aliases), `css/base.css` (root font, chrome, toast), `css/sheet.css` (opaque
sheet, header), `css/components.css` (rows, badges, buttons, ETA), `css/views.css` / `journey.css` / `trip.css` /
`routes.css` / `route.css` / `myroutes.css` / `settings.css`, `css/map.css` (markers, landmark labels), `js/map/style.js`
(palettes 11.2), `js/map/layers.js` (widths, casing rule, bus marker), `js/ui/icons.js` (new, one icon set),
`js/ui/frame.js` (text-size classes), `js/ui/pill.js` (chip vs banner), `js/ui/contextbar.js` (trip chip). Bump the
cache name in `web/sw.js`; `tools/test_precache.py` for the new icons file.

iOS files: `Shared/Palette.swift` (14.1), new `Shared/Typography.swift`, new `Shared/Metrics.swift`, `Views/RootView.swift`
(search bar capsule, status chip / banner, trip chip, toast, tab bar without indicator), `Views/BottomSheet.swift`
(opaque, header hairline), `Views/Components.swift` (badge, ETA, rows), `Views/DirectionsView.swift`,
`Views/TripTimelineView.swift`, `Views/CurrentTripView.swift`, `Views/StopDetailView.swift`, `Views/RoutesView.swift`,
`Views/MapScreen.swift` (`emphasis: .muted`, casing polylines, markers), section headers `.textCase(nil)`.

Performance budget: first paint under 2 s on a mid phone (unchanged path: no new fonts, no new libraries); sheet drag at
60 fps (no blurred layer under the finger); at most four blurred elements; no layout work during the sheet spring
(kept: content insets change after settle); map markers update without re-creating DOM nodes (kept).

Acceptance per view (Current trip, Directions with results, trip in progress, stop, route, Routes, My Routes, Settings,
Lines by Time, Alerts, About):

- Rendered in light and dark; at default text, 200% browser text / iOS AX3, and 320 pt wide; with a long name; in demo,
  live, delayed, unreachable and no-live-locations states. Web via the headless Edge harness used for the audit; iOS via
  the CI gallery (add AX5 and dark large-text shots).
- Contrast pairs added to `tests/ui-shell-contrast.js` pass; no text pair under 4.5:1.
- One primary button per screen (web test already counts `.v-btn--primary`).
- No literal color, radius, font size or weight outside the token files (grep check).
- Reduced motion: no slide or spring remains; state still visible.
- Report what was verified on real hardware separately from simulator and headless results.

---

## 17. Open decisions for the owner

| # | Question | Default in this spec |
|---|---|---|
| O1 | Add a middle sheet state for Directions results and trips so the route stays visible above the options (Apple Maps has three)? This reverses the 2026-10-12 "no midway stop" decision. | Keep two states; the collapsed header carries the answer (10.6) |
| O2 | Custom Liquid Glass on the floating search bar and map buttons on iOS 26? | No; system materials on iOS, matching blur on the web (7) |
| O3 | During a trip, the collapsed header shows the current step ("Walk to Ellis Ave & 57th St") instead of the title "Current trip" (tab name unchanged). | Yes |
| O4 | Where a number shows "est.", drop the "~" in front of it ("29 min est." instead of "~29 min est."); keep "~" for stale times. | Yes |
| O5 | Landmark names stay above the route lines (owner rule 2026-10-13) but lighter, or move below the lines (cartography default)? | Stay above, lighter (11.5) |
| O6 | Current trip tab icon: bus instead of the location arrow (the arrow then only means "my location"). | Yes |
| O7 | iPhone section headers in sentence case like the web (drop the uppercase). | Yes |
| O8 | Copy changes: missed-bus banner "You missed the 3:11 PM bus. Following the next one, 3:21 PM, est.", "Options updated with live times.", web "Directions to here" becomes "Directions" (iPhone wording). | Proposed (13.8, 10.14) |
