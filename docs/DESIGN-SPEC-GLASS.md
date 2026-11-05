# Straight Bussing design spec, second redesign: Apple Maps structure in Liquid Glass

> **In the live repository (since 2026-11-05):** the website (`web/`) implements this spec; it came over from the
> experimental repository with the owner's request "Transfer the interface of the experimental build to the current main
> build of straight bussing" (docs/ARCHITECTURE.md "Glass interface on the live site"). The live iPhone app keeps its
> earlier interface (`ios/README.md`); the iPhone parts of this spec are built only in the experimental repository
> (https://github.com/blobberus/straight-bussing-experimental), where that work is paused (`docs/redesign/GLASS-IOS-PAUSED.md` there). Screenshots referred to below live
> there too: https://github.com/blobberus/straight-bussing-experimental/tree/main/docs/redesign

Status: v1, 2026-11-04. A **delta on `docs/DESIGN-SPEC.md`** (the first redesign, implemented on both platforms).
Everything in DESIGN-SPEC.md still applies unless this file changes it; where they disagree, this file wins. The
evidence is `docs/APPLE-MAPS-STUDY.md` (labels [V] verified, [R] reported, [I] inference; section numbers below
written "Study 3.1"). Owner request (2026-11-03): "Deeply study the structure of Apple Maps (all aspects ranging from
button locations to animations to be compatible with liquid glass). Based on the information you learn, do another
redesign by editing the current UIUX experience without overly changing the functions that are implemented (mostly
just change how things look and button locations etc."

Direction in one line: **Apple Maps' iOS 26 layout (controls by the thumb, search at the bottom, a floating glass
card that becomes an opaque sheet), drawn with Apple's Liquid Glass rules, on both the iPhone app and the website.**
Functions, words, states, thresholds and honesty notes stay as they are; positions, shapes, materials and motion
change.

Contents: 1 What changes and why, 2 Decisions (sections, search, controls), 3 Layout and layers, 4 What moves where,
5 Materials (glass tokens, contrast, fallbacks), 6 Shapes and sizes, 7 Motion, 8 Components, 9 Screens, 10 States,
11 Accessibility, 12 Web performance plan, 13 SwiftUI API map, 14 CSS map, 15 Parity contract delta,
16 Implementation order and acceptance, 17 Open questions for the owner.

---

## 1. What changes and why (summary)

| # | Change | Why (Study section) |
|---|---|---|
| C1 | The top search bar goes away; search becomes a glass circle at the bottom right, beside the section bar | Maps keeps search in the bottom card; iOS 26 puts search "within easy reach at the bottom"; HIG "Place search at the bottom if there's room" (Study 1.6, 4.3) |
| C2 | Lines by Time and Locate become one vertical glass group at the lower right, riding on the sheet's top edge | iOS 26 Maps moved Map Modes + location from the top right to the lower right (Study 1.5, 3.1); Lines by Time is this app's Map Modes (it changes what the map shows) |
| C3 | Settings stays top right, alone, as a glass circle | It is used rarely (HIG: group by function and frequency, Study 2.2); riders already find it there; iOS 26 apps keep account/settings at the top trailing corner |
| C4 | The three sections become a floating glass tab bar (capsule with a selection capsule), search circle at its trailing end | iOS 26 tab bar (floats, capsule indicator, search tab apart at the trailing end) (Study 1.8, 2.3) |
| C5 | The collapsed sheet is an inset glass card; expanded, it is the opaque full-width sheet of today | iOS 26 sheets: inset glass at small heights, opaque and edge-anchored at full height (Study 1.7, 4.1) |
| C6 | Directions' Start / Destination fields move from the top of the screen into the top of the sheet | Maps' directions live in the card (Study 4.4); the top bar they morphed from is gone (C1) |
| C7 | Status banner, chips and Settings form the top rows; banners stay opaque | Glass is for controls, not states; a warning must read the same over any map (DESIGN-SPEC 7, Study 2.2) |
| C8 | Buttons become capsules, cards and dialogs rounder, header buttons become filled circles | iOS 26 capsule buttons, rounder sections, symbol Back / Close (Study 2.2) |
| C9 | New motion: glass press response, materialize, tab selection slide, sheet glass-to-opaque, sheets zoom out of their buttons, optional tab bar minimize | Study 5 |

Unchanged on purpose: section names and icons, every word and honesty note (except the copy list in 9.10), the two
sheet resting states (owner 2026-10-12), Back on the leading side of the sheet header, Retry on the leading side of
the status banner with its 2.5 s hold (owner 2026-11-03), green means live, ETA notation, map overlays, data, logic.

---

## 2. Decisions

### 2.1 How the three sections are presented: a floating glass tab bar (kept as a bar, restyled and moved off the sheet)

Options weighed:

| Option | For | Against |
|---|---|---|
| A. Sections inside the sheet like Apple Maps (no tab bar; Routes and My Routes as rows in the Current trip sheet) | Most literal copy of Maps, frees the bottom | Maps has one section, this app has three; Routes and My Routes would cost an extra tap (expand, then tap) and disappear from the collapsed view; every rider relearns navigation; HIG: a tab bar is the way to move between top-level sections and must stay visible (Study 1.8) |
| **B. iOS 26 floating glass tab bar, search circle apart at its trailing end (chosen)** | Same three items, names, icons and order, still one tap from anywhere; it is the iOS 26 system pattern (Music, Photos, App Store, Health use the separate search button); the bar floats over the map and the sheet like system bars | Two floating objects at the bottom (card + bar); must keep them from touching (no glass on glass) |
| C. A segmented control in the sheet header | Compact | A tab-like control that is not a tab bar; hidden when the sheet changes view; not an iOS pattern for top-level navigation |

Decision B, because it changes the look and position (owner: "mostly just change how things look and button
locations") without removing a function or adding taps, and it is the native iOS 26 idiom. The collapsed sheet card
then reads like Music's mini player above the tab bar (a persistent, app-wide summary: the next bus or the trip in
progress), which is exactly the role `tabViewBottomAccessory` describes (Study 2.3), though the app keeps its own
sheet (13.2).

### 2.2 Does the search field move into the sheet? Its entry moves to the bottom; the field itself appears in the sheet

- Entry: a 56 pt glass circle with the magnifier at the bottom right, trailing end of the tab bar row (HIG search tab
  "button appearance": "Tapping the search tab brings focus to the search field and displays the keyboard", Study
  1.6). Present in every section, as the top bar was.
- After the tap, Apple Maps' behavior: the sheet expands, and the Directions card (Start / Destination) sits at the top
  of the sheet with Destination focused and the keyboard up (Maps: "the search field (at the top of the card)",
  Study 3.1). Suggestions fill the sheet under it, as today.
- Not chosen: a permanent "Search for a destination" field in the collapsed Current trip card (Maps' literal layout).
  The collapsed card must carry the next bus in one glance (ship checklist 3) and would grow by a whole row in every
  section. The typed-search entry also stays in the expanded Current trip content ("Type an address or place",
  "Search stations", "Routes to station…"), so a rider who looks for words finds them.
- Risk and mitigation: an icon-only button is less self-explanatory than a labeled bar (NN/g, Study 6). The circle
  carries the accessibility name "Search for a destination", the Destination field keeps that placeholder, and the
  "what moves where" table goes into the release notes; a one-time pointer is open question Q2.

### 2.3 Map controls: Apple Maps' lower-right group

- One vertical glass capsule, 44 x 88, at the trailing edge just above the collapsed card: Lines by Time (clock) on
  top, in Maps' Map Modes slot; Locate (arrow) below, in Maps' location slot (Study 3.2).
- It rides on the sheet: it is attached to the sheet's top edge, moves with it during a drag and fades out as the
  sheet expands; at the expanded state it is hidden (today the locate button also hides at full). [I: Maps' riding
  behavior is unverified; the HIG asks map chrome tied to a card to follow its lowest resting position, Study 2.4.]
- The compass (iPhone app only; the web map does not rotate) appears as a 44 pt glass circle 8 above the group while
  the map is rotated, and resets north on tap.

---

## 3. Layout and layers (portrait phone, 393 x 852 pt reference; numbers in pt = CSS px)

```
┌───────────────────────────────────────┐
│ 9:41                    (island)       │
│ ┌──────────────────────────────────┐   │  Row A, only for a feed state: status banner, opaque,
│ │[Retry] Can't reach the shuttle...│   │  full width, Retry slot on the LEADING side (kept)
│ └──────────────────────────────────┘   │
│ (flask Simulated buses i)        (⚙)   │  Row B: demo chip (demo only) leading; Settings circle 44 trailing
│ ([53RD] Trip to Trader Joe's Show all) │  Row C: trip chip leading (hidden when the sheet is expanded)
│                                        │
│          MAP, edge to edge, under      │  the map draws under every glass element
│          every control                 │
│                                  (◷)   │  lower-right group (glass 44 x 88): Lines by Time
│ (i)                              (➤)   │  over Locate; map credit (i) bottom left, 10 above the card
│ ╭────────────────────────────────────╮ │
│ │                ───                 │ │  collapsed sheet: inset glass card, radius 28
│ │ Current trip          [E] 4 min ●  │ │  header: title + the next bus (kept, DESIGN-SPEC 10.6)
│ ╰────────────────────────────────────╯ │
│ ╭──────────────────────────────╮ ╭──╮ │  bottom row: tab bar capsule 56 (selection capsule behind
│ │ (▣)Current trip  Routes  My R.│ │⌕ │ │  the selected item) + search circle 56
│ ╰──────────────────────────────╯ ╰──╯ │
└───────────────────────────────────────┘
```

Measures:

| Item | Value |
|---|---|
| Side inset of all floating chrome (`insetChrome`) | 12 (kept) |
| Gap between floating elements (`gapChrome`) | 8 (kept) |
| Top rows start | safe top + 8 |
| Bottom row bottom edge (`bottomRowInset`) | max(12, safe bottom - 12): 22 on Face ID iPhones (clears the home indicator), 12 without a safe area [I: approximates iOS 26's floating bar; check against a real iPhone] |
| Tab bar capsule | height 56, from leading 12 to (search circle - 8); radius 28 |
| Search circle | 56 x 56, trailing 12 |
| Collapsed card | 12 from both sides, bottom edge 8 above the bottom row, height = 16 + measured header (kept rule), radius 28 on all four corners |
| Expanded sheet | full width, from 8 below the lowest visible top row (Row A or Row B) to the screen bottom; top corners 28; the bottom row floats over it |
| Lower-right group | 44 x 88, trailing 12, bottom edge 8 above the collapsed card's top edge |
| Map credit / Apple logo + Legal | bottom left, 10 above the collapsed card's top edge (HIG Maps, Study 2.4) |

Layer order (bottom to top): map and its overlays (DESIGN-SPEC 11.1) → map credit → sheet (card or expanded) with the
lower-right group attached to it → top rows (banner, chips, Settings) → bottom row (tab bar, search) → toast →
overlays (Settings, Lines by Time, dialogs) with their scrim.

Map framing: the map's visible rectangle for camera moves (`MapRects` on iOS, `sheet:inset` / map padding on the web)
excludes the top rows, the collapsed card, the lower-right group and the bottom row; the follow camera keeps the rider
inside it (kept behavior, new numbers).

Phone landscape and wide short screens (web panel mode, iOS landscape if enabled): the sheet is the floating leading
panel it is today (opaque, radius 28, 12 from the edges); the tab bar and search circle sit at the bottom of the panel
column, glass, over the map; the lower-right group sits at the map's bottom right; Settings at the map's top right.

---

## 4. What moves where

| Control | Today (DESIGN-SPEC) | Glass redesign | Apple Maps equivalent | Function |
|---|---|---|---|---|
| Search for a destination | Full-width capsule at the top | 56 glass circle, bottom right, beside the tab bar; tap = expanded sheet with the Directions card at its top | Search field in the bottom card | Same (opens Directions) |
| Lines by Time (clock) | Inside the top search bar, trailing | Top slot of the lower-right glass group | Map Modes button (lower right) | Same |
| Settings (gear) | Inside the top search bar, trailing | 44 glass circle, top right (Row B) | Profile photo (in the card) | Same |
| Locate | 44 circle under the search bar, right | Bottom slot of the lower-right group | Location button (lower right) | Same (follow, re-center, help when denied) |
| Compass (iOS) | MapKit default, top trailing | 44 glass circle above the lower-right group, only while rotated | Compass near the controls | Same |
| Status banner | Under the search bar | Row A, the topmost element; Retry slot still leading | none (Maps shows no feed state) | Same, hold rule kept |
| Demo chip | Under the search bar, leading | Row B, leading | Weather label (top left) position | Same |
| Trip / filter chip | Under the search bar | Row C, leading (hidden when expanded, as today) | none | Same (Show all / Clear) |
| Map feedback button (main repo only; not yet in this repo) | Under the locate button | 44 tinted glass circle under Settings, top right (keeps rare and attention-seeking controls out of the thumb zone) | none | Same, if adopted (Q7) |
| Sections bar | Opaque full-width bar attached under the sheet | Floating glass capsule, bottom; selection capsule behind the selected item | System tab bar (Maps has none) | Same three sections, one tap |
| Sheet, collapsed | Opaque, full width, sits on the bar | Inset glass card floating above the tab bar | Inset glass card | Same two states, same drag |
| Sheet, expanded | Opaque, below the search bar | Opaque, full width, below the top rows; tab bar floats over its bottom | Opaque full-height sheet | Same |
| Directions Start / Destination | Card at the top of the screen (morph from the search bar) | Card at the top of the expanded sheet, under the header | Directions card in the sheet | Same (swap, clear, My location default) |
| Sheet Back | Tint chevron, leading | 44 circle with a `fill` background, chevron in `label`, leading | Standard back symbol | Same |
| Settings "Done" | Text button in the overlay header | Tinted checkmark circle, trailing (name "Done"); swipe down, scrim tap and Escape also close | iOS 26 Done = tinted checkmark | Same |
| Toast | Centered above the collapsed sheet | Leading, 12 above the collapsed card, never under the lower-right group; expanded: centered above the tab bar | none | Same |
| Map credit (web) / Apple logo + Legal (iOS) | Above the sheet | 10 above the collapsed card, bottom left | Same HIG rule | Same |

---

## 5. Materials

### 5.1 Rule (replaces DESIGN-SPEC 7 "translucency only for small controls")

Glass is for the control layer floating over the map, and only there:

| Surface | Material |
|---|---|
| Tab bar capsule, search circle, Settings circle, lower-right group, compass, demo chip, trip chip, collapsed sheet card (header only), feedback circle | **Glass** (regular) |
| Expanded sheet, everything inside the sheet (cards, rows, option cards, step lists), Settings and Lines by Time sheets' content, dialogs' content, toasts | **Solid** (DESIGN-SPEC tokens `bgSheet`, `bgCard`, `bgInverse`) |
| Status banners (warn, danger) | **Solid** `warnBg` / `dangerBg` (a state reads the same over any map) |
| Controls on top of glass (the selection capsule, header buttons on the collapsed card, chip actions) | **Fill** (`fill`), never glass on glass (Study 1.2) |

No clear glass anywhere (Study 1.3). Color on glass only as the background of one control (Study 1.4); this app uses
none at rest (the feedback circle is the only tinted glass, if adopted).

### 5.2 Glass tokens (new; web values, iOS uses system glass and these as fallbacks and for parity checks)

| Token | CSS | Swift | Light | Dark |
|---|---|---|---|---|
| glassFill | `--glass-fill` | `Palette.glassFill` (fallback only) | `rgba(250,250,252,.80)` | `rgba(38,38,42,.80)` |
| glassSolid | `--glass-solid` | `Palette.glassSolid` | `#FAFAFC` | `#26262A` |
| glassFilter | `--glass-filter` | system | `blur(14px) saturate(1.4)` | same |
| glassRim (inner highlight) | `--glass-rim` | system | `inset 0 1px 0 rgba(255,255,255,.65), inset 0 0 0 .5px rgba(255,255,255,.40)` | `inset 0 1px 0 rgba(255,255,255,.16), inset 0 0 0 .5px rgba(255,255,255,.10)` |
| glassEdge (outer, iOS 27's darker edge) | `--glass-edge` | `Palette.glassEdge` | `0 0 0 .5px rgba(17,17,20,.10)` | `0 0 0 .5px rgba(0,0,0,.50)` |
| glassShadow | `--glass-shadow` | `.elevation(.floating)` | `0 1px 2px rgba(30,32,45,.08), 0 6px 20px rgba(30,32,45,.12)` | none |
| labelGlass2 (secondary text on glass) | `--label-glass-2` | `Palette.labelGlass2` | `#3C3C43` | `#C7C7CC` |

`--bg-chrome` and `--blur-chrome` become aliases of `--glass-fill` and `--glass-filter` until every stylesheet moves.

### 5.3 Contrast on glass: how glass still passes AA

iPhone Safari cannot tell a site that Reduce Transparency is on (Study 6), and iOS 27 lets riders make system glass
clearer, so the web glass must be legible on its own. Computed with WCAG 2.x, compositing the fill over the worst
possible backdrop **with no blur at all** (pure black under light glass, pure white under dark glass; blur only makes
real cases better):

| Foreground on glass | Needs | Minimum fill opacity light / dark | At 0.80 light / dark |
|---|---|---|---|
| `label` (primary text, ETAs, titles, icons) | 4.5:1 | 0.50 / 0.66 | 11.3 / 7.3 |
| `labelGlass2` (secondary text, placeholders, "est.") | 4.5:1 | 0.67 / 0.80 | 6.6 / 4.7 |
| `tint` as an icon (selected tab glyph) | 3:1 | 0.74 / 0.76 | 3.5 / 3.5 |
| `label2` as text | 4.5:1 | 0.86 / 0.87 | fails: not allowed on glass |
| `tint` as text | 4.5:1 | 0.90 / 0.88 | fails: not allowed on glass |

Rules that follow: on glass, text is `label` or `labelGlass2` only; `tint` appears only as an icon or as the filled
background of a control (with `onFill` text, 4.7:1 by itself); `live` green appears only as the 8 pt dot with a 1.5 pt
`glassSolid` ring plus the word in `label` ("Live"), never as green text on glass; route badges keep their own
contrast rule (DESIGN-SPEC 4.3). Over the realistic worst map colors (the navy and pure blue routes under light glass,
the yellow route under dark glass, opacity 0.80, no blur) every allowed pair is at least 5.1:1 for text and 3.7:1
for icons. Add every pair,
with this composite formula and both backdrops, to `tests/ui-shell-contrast.js` and the iOS audit table.

On iOS 26+ the system glass adapts on its own (small glass flips light / dark with the content, Study 2.1). Use the
hierarchical styles (`.primary`, `.secondary`) for text on glass so they follow the flip; never a fixed custom color
for text on glass. Selection is never shown by `tint` alone (selection capsule + filled glyph), so a flip that lowers
tint contrast never hides state.

### 5.4 Fallbacks

| Condition | iOS | Web |
|---|---|---|
| iOS 17 to 25 | `.regularMaterial` in the same shapes + `glassEdge` stroke | n/a |
| No `backdrop-filter` | n/a | `--glass-fill: var(--glass-solid)`, no filter |
| Reduce Transparency | automatic (frostier) | `@media (prefers-reduced-transparency: reduce)`: solid (Chrome, Edge, Samsung; not iPhone Safari, hence 5.3) |
| Increase Contrast | automatic (black / white + border) | `@media (prefers-contrast: more)`: solid, no filter, `--glass-rim: inset 0 0 0 1px rgba(17,17,20,.55)` light / `rgba(245,245,247,.55)` dark, plus DESIGN-SPEC 14.1 contrast colors |
| Element moving (sheet drag or settle, group riding, minimize) | system | `#app.is-moving` swaps the moving glass to `--glass-solid` at 0.96 opacity, no filter, restored at rest (12) |
| Slow device | system | `html.glass-lite` (12.4): solid glass for the session |

---

## 6. Shapes and sizes (changes to DESIGN-SPEC 3 and 6)

| Token | Old | New | Use |
|---|---|---|---|
| `rGlass` (new) | | 28 | Collapsed card (all corners), expanded sheet top corners, tab bar capsule ends (56 / 2), dialogs, Settings / Lines by Time sheets on the web |
| `rCard` | 14 | 20 | Grouped cards, option cards, in-sheet banners, place summary, status banner (iOS 26 sections are rounder, Study 2.2; exact system value [I]) |
| `rControl` | 12 | 12 | Fields inside the sheet and the wheel band only |
| Buttons | `rControl` 12 | `rCapsule` | Primary, Secondary, destructive, filter buttons (iOS 26 bordered buttons are capsules) |
| `rSheet` | 20 | retired, use `rGlass` | |
| `searchHeight` | 48 | retired (no top bar) | |
| `tabBar` | 49 + safe area | `tabBarH` 56, floating | |
| `searchButton` (new) | | 56 | Search circle |
| `chromeButton` (new) | | 44 | Settings circle, group buttons, compass, feedback |
| `bottomRowInset` (new) | | max(12, safe bottom - 12) | |

Concentric rule (kept, Study 2.2): the selection capsule sits 4 inside the 56 tab bar, so its radius is 24; the
Directions card's fields sit 10 inside a 20 card, radius 10.

---

## 7. Motion (additions to DESIGN-SPEC 9; every existing token stays)

| Token | Value | Use | Reduced motion |
|---|---|---|---|
| `mGlassPress` | iOS `.interactive()` glass; web 160 ms ease-out to `scale(1.06)` and back, inner highlight opacity +0.15 | Press on any glass control | opacity .6 only |
| `mMaterialize` | enter 220 ms `mStandard` curve, `scale(.85)` + opacity 0 to 1; exit 160 ms `mExit` | Glass elements appearing or leaving (chips, compass, group, search circle when the keyboard rises) | 150 ms fade |
| `mTabPill` | iOS `.spring(response: 0.35, dampingFraction: 0.78)`; web 320 ms `cubic-bezier(0.34, 1.25, 0.64, 1)` on `transform` | Selection capsule slides to the new tab (it may stretch to `scaleX(1.12)` mid-way; optional) | jumps, no slide |
| `mSheetGlass` | follows the drag progress `p` (no duration) | Card to sheet: glass to opaque, inset to edge (8.10) | same (it tracks the finger) |
| `mRide` | follows the sheet (same transform) | Lower-right group rides the card; opacity 1 to 0 between p 0.10 and 0.30 | same |
| `mZoomSheet` | iOS zoom navigation transition from the button; web 340 ms `cubic-bezier(0.32, 0.72, 0, 1)`, `transform-origin` at the button, `scale(.6)` + opacity to 1 | Settings and Lines by Time open out of their buttons and shrink back | 150 ms fade |
| `mMinimize` | 280 ms `mStandard` | Optional tab bar minimize (8.9) | crossfade |
| `mBanner` | enter 250 ms slide 8 down + fade, exit `mExit` | Status banner (Row A) | fade |

Haptics (iOS, kept): selection on detent snaps and tab changes; light impact on Start.

---

## 8. Components

Each: **Maps** (the Apple Maps / iOS 26 equivalent), **Where / look**, **Material**, **Motion**, **Web**, **iOS**.
Words, states and behavior not mentioned are as in DESIGN-SPEC.

### 8.1 Status banner (DESIGN-SPEC 10.3)

- Maps: none; iOS uses opaque or glass banners for system states. Kept opaque on purpose (5.1).
- Where / look: Row A, the topmost element, full width (12 insets), `rCard` 20, `warnBg` / `dangerBg`, `glassShadow`;
  icon, text and the 84 x 44 action slot on the **leading** side exactly as specified on 2026-11-03 (fixed slot,
  progress in place, 2.5 s hold, "Live data is back.", taps absorbed). Under it, Row B / Row C keep their place during
  the hold, so the trip chip (whose Show all ends the trip) never slides under a tapping finger; a stray tap lands on
  the chip's leading badges, never on its trailing action.
- Material: solid. Motion: `mBanner`. Web: `ui/pill.js` unchanged logic, `#pill` moves to the top of `#topbar`.
  iOS: `StatusBanner` unchanged logic, first child of the top VStack. Tests: `testRepeatedRetryDuringATripKeepsTheTrip`
  and the e2e "Retry tapped again and again during a trip" must pass unchanged.

### 8.2 Settings button

- Maps: profile photo in the card. Here: top right because it is rare and riders know it there (C3).
- Where / look: Row B trailing, 44 glass circle, `gearshape` 20 in `label`. Material: glass. Motion: `mGlassPress`;
  Settings opens with `mZoomSheet` from the button.
- Web: `#settingsBtn` keeps its id and `data-action="settings:open"`, moves out of the search bar into the top rows.
  iOS: `Button` with `.buttonStyle(.glass)` + `.buttonBorderShape(.circle)` on iOS 26, `ChromePressStyle` +
  material on 17 to 25; `.matchedTransitionSource(id: "settings", in: ns)` (iOS 18+).

### 8.3 Demo chip and trip chip (DESIGN-SPEC 10.3 chip, 10.5)

- Where / look: demo chip Row B leading; trip chip Row C leading, max width = screen - 24 - 44 - 8. Glass capsules 32
  / 36 tall (44 hit areas kept). Text `label` Semibold; route badges kept; the trailing "Show all" / "Clear" becomes a
  `fill` capsule button with `label` text (not tint text: 5.3; and not prominent, because Show all ends a trip).
  Demo chip's info glyph in `label`.
- Hidden when the sheet is expanded (trip chip, as today); `mMaterialize` in and out.
- Web: `#ctxbar`, `#pill[data-form="chip"]` move into the top rows. iOS: `TripChip`, `DemoChip` with `sbGlass`.

### 8.4 Lower-right group: Lines by Time, Locate, compass

- Maps: Map Modes over location, lower right (Study 3.2).
- Where / look: 44 x 88 glass capsule (radius 22), attached to the sheet's top trailing corner, 8 above it; top button
  `clock` 20, bottom button `location` / `location.fill` while following (DESIGN-SPEC 10.4 states kept, denied = opens
  the location help), a `separator` hairline between them inset 8. Compass circle 8 above when rotated (iOS).
- Motion: `mRide` (moves with the sheet, fades out by p 0.30, hidden and unfocusable at expanded), `mGlassPress`;
  Lines by Time opens with `mZoomSheet` from the clock.
- Web: a child of `#sheet` positioned above its top edge (`bottom: 100%`), so the sheet's transform carries it with
  no extra script; the sheet root must not clip (`overflow` / `contain: paint` move to the content container).
  `#timeBtn` and `#locateBtn` keep their ids. While `#app.is-moving`, the group uses `--glass-solid`.
- iOS: an overlay of `BottomSheet`'s header anchored `.topTrailing` with `offset(y: -(88 + 8))`, inside the same
  `GlassEffectContainer(spacing: 8)` as the card's glass (glass cannot sample glass across containers, Study 2.3);
  `MapCompass(scope:)` with `.mapScope(mapNS)` placed above it; `.mapControls { }` left empty so MapKit draws no
  second compass.

### 8.5 Map feedback button (only if the owner adopts it here, Q7)

The main repo's button (`#feedbackBtn`, ping, panel) keeps its behavior; look: 44 circle, tinted glass
(`glassEffect(.regular.tint(Palette.tintBg))` / web `tintBg` at 0.85 with the glass filter), speech bubble in `tint`
(3:1 icon on its own tint), badge dot; position: under Settings, top right; it pauses and hides with the same rules as
today (full detent, trips, overlays).

### 8.6 Bottom row: tab bar (three sections)

- Maps: none; iOS 26 system tab bar (Study 2.3).
- Look: glass capsule 56 tall, radius 28, three equal items (Current trip, Routes, My Routes, icons and names kept),
  icon 24 over `tabLabel` (11 Semibold, capped at 1.35 x). Selected: a `fill` capsule 48 tall, radius 24, behind the
  item; filled glyph in `tint`; label in `label` Semibold. Unselected: outline glyph and label in `labelGlass2`.
  This replaces DESIGN-SPEC 10.7's "no capsule indicator": iOS 26 made the capsule the system indicator (Study 1.8).
- Behavior kept: tap a tab = that section's sheet (collapsed stays collapsed, the header changes); tap the selected
  tab again = expand / collapse as today; never disabled or hidden (HIG); hidden only while the keyboard is up and
  under overlays.
- Motion: `mTabPill`, `mGlassPress`.
- Web: `#tabs` (`<nav>`, `aria-current="page"`) restyled as the capsule, with one `.tab-pill` element moved by
  `transform: translateX()`. iOS: custom `TabBar` kept (the map must stay one shared view behind all sections, which
  a system `TabView` does not give), drawn with `sbGlass(in: Capsule())`, the pill a `Capsule().fill(Palette.fill)`
  with `matchedGeometryEffect(id: "tabPill", in: ns)`; buttons keep `.isSelected` and
  `accessibilityShowsLargeContentViewer()`.

### 8.7 Bottom row: search circle

- Look: 56 glass circle, `magnifyingglass` 22 in `label`, accessibility name "Search for a destination" (the old
  placeholder), 8 to the right of the tab bar.
- Tap: Directions opens (route `dir:open`, Destination focused), the sheet expands with `mSheet`, the keyboard rises
  and the bottom row leaves with `mMaterialize` (today the bar also steps aside for the keyboard); Back or collapsing
  brings it back.
- Web: `#searchBar` keeps its id, `data-action="dir:open"` and `data-focus="to"` (fewer test changes) but becomes the
  circle inside `#tabs`' row. iOS: `.buttonStyle(.glass)`, `.buttonBorderShape(.circle)`, inside the bottom row's
  `GlassEffectContainer` with the tab bar.

### 8.8 Bottom sheet (DESIGN-SPEC 10.6)

- Maps: inset glass card at small heights, opaque and edge-anchored at full height (Study 4.1). Two resting states
  kept (owner 2026-10-12): collapsed and expanded; drag, velocity, rubber band, tap to toggle, Escape, keyboard slider
  and the measured collapsed height unchanged.
- Collapsed: the card of section 3; grab bar 36 x 5 in `labelGlass2` at 60%; header text on glass follows 5.3
  (`sheetTitle` and ETAs in `label`, details and "est." in `labelGlass2`, live dot ringed). Header buttons on the
  card (Back, Close) are 44 circles with `fill`, glyph in `label` (fills on glass, never glass on glass).
- Expanded: opaque `bgSheet`, full width, top corners 28, `e2`; content bottom padding = tab bar row + 8 + 12 so the
  last row scrolls clear of the floating bar; a soft scroll edge under the bar (iOS 26
  `scrollEdgeEffectStyle(.soft, for: .bottom)`; web a 24 px gradient from `bgSheet` at 0 to 0.9 behind the bar, no
  blur); the header hairline when scrolled (kept).
- Transition (`mSheetGlass`, p = 0 collapsed to 1 expanded):

| p | Card background | Width | Body (below the header) |
|---|---|---|---|
| 0 | glass | inset 12 per side | transparent, not hit-testable |
| 0 to 0.35 | an opaque `bgSheet` layer fades in over the glass (opacity p / 0.35) | background scales from (W - 24) / W to 1 | opaque layer fades in with the same opacity |
| 0.35 to 1 | opaque | full | opaque |

  Web: two background layers on `#sheet` (`::before` = the glass plate, header height; `::after` = the opaque body),
  driven by a `--p` custom property set with the existing drag variable; only `opacity` and `transform: scaleX()`
  change per frame; while dragging or settling the glass plate uses `--glass-solid` (5.4); content keeps 16 + 12 side
  padding so the scaled background never touches text; the body has `pointer-events: none` at p = 0 so the map and the
  tab bar stay tappable around the card. iOS: in `BottomSheet`, the header background is `sbGlass(in: .rect(cornerRadius:
  28))` with `Palette.bgSheet.opacity(min(1, p / 0.35))` over it, the background `scaleEffect(x:)` by the same rule;
  content padding unchanged.
- Corners: 28 at every height; the expanded bottom corners sit off screen.

### 8.9 Tab bar minimize (optional, phase 3; Q3)

While the expanded sheet's content scrolls down more than 24, the tab capsule shrinks to a 56 glass circle showing the
selected section's filled glyph at the leading side; the search circle stays at the trailing side; scrolling up, or
tapping the circle, restores it (`mMinimize`). Web: animate `transform` of the capsule's background layer and the
labels' opacity, never `width`. iOS 18+ (needs scroll offset; iOS 17 never minimizes).

### 8.10 Sheet header buttons, titles, trailing slot

- Back: 44 circle with `fill`, `chevron.backward` 17 Semibold in `label` (HIG: the standard symbol, no word), leading.
- Close (where a view closes rather than goes back: none today; reserved).
- Title, two-line rule, trailing summary or action, and the accessibility-size stacking are unchanged.

### 8.11 Buttons, segmented control, switches (DESIGN-SPEC 10.11 to 10.13)

- Primary, Secondary, Secondary destructive, Destructive confirm: same colors and heights (50 full width, 44 inline),
  now `rCapsule`. iOS 26: `.buttonStyle(.borderedProminent)` / `.bordered` with `.buttonBorderShape(.capsule)` and
  `.controlSize(.large)`, tinted with `Palette.tintFill`; iOS 17 to 25: the existing `PrimaryButtonStyle` /
  `SecondaryButtonStyle` with `Capsule()`. Web: `border-radius: var(--r-capsule)`. `.glassProminent` is used nowhere
  in the sheet (content layer); system toolbars in Settings / Lines by Time get their glass from iOS.
- Segmented: capsule track and capsule thumb (radius 18 in a 36 track; thumb 2 inside, radius 16). iOS: system
  `Picker(.segmented)`.
- Switch: web knob stretches to `scaleX(1.15)` while pressed (iOS 26 knob turns to glass, Study 2.2); off under
  reduced motion. iOS: system `Toggle`.
- Routes filter (Show all / Show running / Hide all): capsules, as specified.

### 8.12 Cards, rows, section titles (DESIGN-SPEC 10.8)

`rCard` 20; rows, separators, leading slot and accessibility-size layouts unchanged; section titles stay sentence
case (iOS 26 no longer forces capitals, which this app never wanted).

### 8.13 Toast (DESIGN-SPEC 10.19)

Look unchanged (`bgInverse` capsule). Position: collapsed, leading 12, bottom 12 above the card's top edge, max width
= screen - 24 - 44 - 8 so it never covers the lower-right group (it may cover the map credit for its 3 s, which the
HIG allows); expanded, centered 12 above the tab bar row. Never over Row A (a state must stay visible).

### 8.14 Dialogs and menus (DESIGN-SPEC 10.13)

- iOS: `.confirmationDialog` attached to the button that triggers it (iOS 26 anchors it to the source, Study 4.6);
  alerts are system.
- Web: confirm dialog card `rGlass` 28, `bgCard`, `e3`, over the scrim; buttons as capsules side by side (stacked when
  a label would wrap); opens with `mZoomSheet` from the triggering button (`transform-origin` at its center), fade
  under reduced motion. Menus (row More): popover card `rCard`, 44 rows, scale from the source.

---

## 9. Screens

### 9.1 Current trip, no trip (J1)

Collapsed card: "Current trip" + the next bus (badge, `etaRow`, live dot), on glass (5.3). Expanded: unchanged content
(alert row, nearest stop card with up to three arrivals, Search stations, Type an address or place / Routes to
station…, Nearby, footnote, "No trip in progress"). Maps: the home card. Nothing moves inside the sheet.

### 9.2 Search and results (J2)

Search circle → expanded sheet: header "Directions" with Back; the Directions card (DESIGN-SPEC 10.2 anatomy: Start
ring in `tint`, Destination dot in `dangerFill`, swap 44, clear) is the first element of the sheet content, solid
`bgCard` (it is in the content layer now, not glass), pinned while results scroll; Destination focused, keyboard up,
bottom row hidden. Results card, spelling line, privacy footnote and the no-results state unchanged. Maps: search
field at the top of the expanded card, results below.

### 9.3 Place summary and route options (J3, J4)

Unchanged anatomy (DESIGN-SPEC 10.14, 10.15) with `rCard` 20 and capsule buttons. Start stays `tintFill` blue (Maps'
Go has been green; green means live here, DESIGN-SPEC 4.4). Collapsed Directions: card header "Directions" + the best
option "29 min est."; the selected option on the map (focused lines, destination pin); the Directions card is not
visible until the sheet expands (as in Maps).

### 9.4 Trip in progress (J5, J6; DESIGN-SPEC 10.17)

- Maps: navigation shows the instruction in a small bar and ETA + End at the bottom (Study 4.5). Here the collapsed
  card keeps today's two lines (current step over "Trip to X") and "Arriving In 12 min" (owner wording), which already
  puts what to do and when to arrive in one place by the thumb; a separate top instruction bar would stack a third
  element over the trip chip and the banner. Not adopted.
- Expanded: trip header with End trip (Secondary destructive, now a capsule), next-step card with `etaHero`, steps,
  Nearby: unchanged. Missed bus banner unchanged (13.8 words pending O8).
- Map: trip lines focused, walking dots, Board here / Get off callouts, You ring, follow camera inside the new visible
  rectangle (3).

### 9.5 Route detail, stop detail

Header with the Back circle; title rules kept; stop action row (Directions Primary, From here, Favorite) as capsules
in one row (stacked at accessibility sizes). Maps' iOS 26 floating Directions button at the bottom right is not
copied: that corner is the search circle's, and one Directions button per screen is the rule.

### 9.6 Routes, My Routes and the editor

Unchanged content; capsule buttons; `rCard` 20; swipe actions and the delete confirmation (anchored dialog on iOS).
Edit map order stays in the header's trailing slot.

### 9.7 Alerts

In-sheet alert row `warnBg` `rCard` 20; Alerts page cards `rCard` 20; verbatim text and call links unchanged.

### 9.8 Settings (sheet)

- iOS: system sheet (`.sheet`, `.presentationDetents([.large])`), opens with the zoom transition from the gear (iOS
  18+), toolbar `.confirmationAction` "Done" (iOS 26 draws a tinted checkmark), no `presentationBackground` (let iOS
  26 draw it); content the existing `Form`.
- Web: the Settings overlay restyled as an iOS sheet: a card from 10 below the safe top to the bottom, top corners 28,
  `bgSheet`, over the scrim; header title centered, trailing 44 `tintFill` circle with a white checkmark, accessible
  name "Done"; swipe down on the header, scrim tap and Escape also close (HIG: Done needs an alternative); opens with
  `mZoomSheet` from the gear. Content unchanged.

### 9.9 Lines by Time (sheet)

Same container as Settings, from the clock; header: leading Cancel (44 `fill` circle with `xmark`, name "Cancel"),
trailing "Set time" as a `tintFill` capsule (a text label: no clear symbol shorthand, Study 2.2); wheels, count,
chips, disclaimer and the official link unchanged. iOS: the system sheet keeps today's detents; on iOS 26 any
partial height is drawn as inset glass by the system.

### 9.10 Copy changes (all small; everything else is today's text)

| Where | Today | New |
|---|---|---|
| Search entry | Visible "Search for a destination" bar | Icon only; "Search for a destination" becomes its accessibility name and the Destination placeholder |
| Settings close | Visible "Done" | Checkmark with the accessible name "Done" |
| Lines by Time cancel | Visible "Cancel" | `xmark` with the accessible name "Cancel" |

---

## 10. States (changes to DESIGN-SPEC 13 only)

| State | Glass layout |
|---|---|
| Loading | First paint: map land color, Settings circle, tab bar, search circle, collapsed card with "Current trip" and a skeleton ETA; glass elements are solid until the first frame paints (avoid a blur flash); no layout shift when the feed lands |
| Feed error, delayed, out of date, no live locations, no shuttles | Row A banner (topmost, opaque); the expanded sheet starts under it; in-sheet notices unchanged |
| Stale numbers | unchanged notation ("~", hollow ring, "Last known"); on the glass card the hollow ring uses `label` at 60% |
| Denied location | The Locate button stays in the lower-right group; tap opens the help card (kept); the help never appears as a toast over Row A |
| Empty | unchanged components inside cards |
| Long names | Card header 2 lines then ellipsis (kept); trip chip truncates only its label; tab labels one line, may shrink to 90% before truncating |
| Larger text | Chrome caps at 1.35 x (kept: tab labels, chips, banner text grows with the banner); at accessibility sizes, or under 360 pt width with `large` text, tab labels hide (icons only, names in accessibility labels, iOS large content viewer on long press) and the tab bar keeps 56; the card header grows instead of clipping |
| Rerouting / missed bus | unchanged (warnBg note in the next-step card); Directions re-plan footnote unchanged |
| Keyboard up | bottom row hidden (`mMaterialize`), lower-right group hidden, sheet expanded |
| Demo | demo chip in Row B; never a banner (kept) |
| Offline | feed-unreachable banner + offline page (kept) |
| Overlay open (Settings, Lines by Time, dialog) | tab bar, search circle and toast hidden under the scrim; focus trapped in the overlay (kept) |

---

## 11. Accessibility (ship checklist 5, additions)

- Targets: every glass control is at least 44 x 44 (tab items about 95 x 56, search 56, group buttons 44, chips with
  44 hit areas). Gaps of 8 between floating controls.
- Contrast: 5.3, tested for both themes and both worst backdrops; Increase Contrast turns all glass solid with a
  border; Reduce Transparency solid where the platform reports it.
- Reduced motion: section 7's column; no press scaling, no overshoot, no lens, no minimize animation; state changes
  stay visible as fades.
- VoiceOver / screen readers, focus order: Row A banner, Row B (demo chip, Settings), Row C trip chip, the sheet header
  (grab bar slider, title), sheet content, the lower-right group (Lines by Time, Show my location), the tab bar
  (Current trip, Routes, My Routes, with selected state), Search for a destination. Web: DOM order matches; iOS:
  `.accessibilitySortPriority` on the containers. The group and the search circle are hidden from assistive tech when
  visually hidden (expanded sheet, keyboard).
- State never by color alone: selection capsule + filled glyph; live = dot + word; stale = ring + words.
- No time-limited controls added; the Retry hold only absorbs taps.

---

## 12. Web performance plan (no lag on a mid-range phone)

### 12.1 Rules

1. **Blur budget at rest: at most 6 blurred surfaces, together at most 22% of the viewport** (393 x 852: card about
   369 x 72, tab bar about 305 x 56, search 56 x 56, Settings 44 x 44, group 44 x 88, one chip about 260 x 36, roughly
   18% in total). Banners, toasts, the expanded sheet and all sheet content are never blurred.
2. **Never blur an element that moves every frame.** `#app.is-moving` (set on drag start, cleared after the settle) swaps
   the card plate and the riding group to `--glass-solid`; the tab bar and the top rows do not move and keep their blur.
3. **Only `transform` and `opacity` animate** (sheet progress, tab pill, ride, materialize, minimize, zoom sheets).
   `will-change` only during the motion (kept rule).
4. **Filter cost:** `blur(14px) saturate(1.4)` (down from 20 px). No SVG displacement or `url()` backdrop filters
   (Chromium-only lensing would split iPhone and Android and costs more).
5. **Static highlight:** the rim and edge are box-shadows, painted once.
6. `contain: paint` and `isolation: isolate` on glass controls whose hit area does not overflow (Settings, search,
   group); chips keep overflowing hit areas (NOTES-web item 12).
7. Map under glass keeps animating (bus glide, pans): each blurred surface re-composites per frame there; that is why
   the count and area are capped.

### 12.2 Measured acceptance (same harness and method as `docs/redesign/NOTES-web.md`: `trace.py`, `perf.py`, headless
Edge, 393 x 852 DPR 2, demo mode, median of 4, interleaved with the current build)

| Measure | Budget |
|---|---|
| Sheet drag: GPU / raster time per frame | no worse than the current build (4.67 ms) + 10% |
| Sheet drag: main-thread time per frame | no worse than current (0.28 ms) + 10% |
| Idle 5 s with buses gliding: GPU time per frame | no worse than current (5.47 ms) + 15% |
| Idle 5 s: style recalculation | no worse than current (8.3 ms) + 10% |
| First contentful paint, 4x CPU throttle | under 700 ms (current 556 ms; budget 2 s) |
| Long tasks | none |

### 12.3 Real-device check (owner QA, not automatable here)

On the owner's iPhone in Safari and on one mid-range Android Chrome: drag the sheet up and down ten times with buses
moving, pan the map for 10 s, switch tabs; any visible stutter fails the build. Record results separately from
headless numbers (DESIGN-SPEC 16).

### 12.4 Safety valve: `glass-lite`

`ui/frame.js` measures frame times during the first 10 s of map interaction; if more than 20% of frames exceed 24 ms,
it sets `html.glass-lite` for the session: every glass surface uses `--glass-solid`, no filter. Same look in shape and
layout, no blur. Nothing is stored or sent.

---

## 13. SwiftUI API map (deployment target iOS 17.0, `ios/project.yml`; CI builds with the iOS 26 SDK)

### 13.1 One helper for all glass

```swift
// ios/Shared (or App/Sources/Views/Styles.swift)
extension View {
    @ViewBuilder
    func sbGlass<S: Shape>(in shape: S, interactive: Bool = false) -> some View {
        if #available(iOS 26, *) {
            glassEffect(interactive ? .regular.interactive() : .regular, in: shape)
        } else {
            background(.regularMaterial, in: shape)
                .overlay(shape.stroke(Palette.glassEdge, lineWidth: 0.5))
        }
    }
}
```

Never `.clear`, never `.tint` except the feedback circle; text on glass uses `.foregroundStyle(.primary / .secondary)`.

### 13.2 Per component

| Component | iOS 26 | iOS 17 to 25 fallback |
|---|---|---|
| Top rows (banner, chips, Settings) | `StatusBanner` (solid, unchanged); chips `sbGlass(in: Capsule())`; Settings `Button { } label: { Image(systemName: "gearshape") }.buttonStyle(.glass).buttonBorderShape(.circle)` + `.matchedTransitionSource(id:in:)` | material circle, `ChromePressStyle` |
| Lower-right group | `VStack(spacing: 0) { clock; Divider; locate }.sbGlass(in: Capsule(), interactive: true)` inside `GlassEffectContainer(spacing: 8)` shared with the card header; `MapCompass(scope: mapNS)` above; `.mapScope(mapNS)` on the root; `.mapControls { }` | material capsule; `MapCompass(scope:)` works from iOS 17 |
| Collapsed card / expanded sheet | custom `BottomSheet` kept (owner's two states, parity with the web, the tab bar must stay above it); header background `sbGlass(in: .rect(cornerRadius: 28))` + `Palette.bgSheet.opacity(min(1, p / 0.35))`; body `Palette.bgSheet.opacity(min(1, p / 0.35))`; `.scrollEdgeEffectStyle(.soft, for: .bottom)` on the content scroll view; content `.safeAreaPadding(.bottom, tabRowH + 20)` | material header, same opacity ramp; no scroll edge effect (iOS 17 to 25 draw the 24 pt gradient instead) |
| Tab bar | custom `TabBar` in a `GlassEffectContainer(spacing: 8)` with the search circle; capsule `sbGlass(in: Capsule())`; pill `Capsule().fill(Palette.fill).matchedGeometryEffect(id: "tabPill", in: ns)`; optional minimize with `glassEffectID` per element and `onScrollGeometryChange` (iOS 18+) | material capsule, same pill; no minimize on iOS 17 |
| Search circle | `.buttonStyle(.glass).buttonBorderShape(.circle)`, frame 56; `.glassEffectTransition(.materialize)` when the keyboard hides it | material circle |
| Header Back | `Button` with `Circle().fill(Palette.fill)` background, `chevron.backward` (fills on glass) | same |
| Buttons in sheets | `.buttonStyle(.borderedProminent)` / `.bordered`, `.buttonBorderShape(.capsule)`, `.controlSize(.large)`, `.tint(Palette.tintFill)` | existing styles with `Capsule()` |
| Settings / Lines by Time | `.sheet` + `.navigationTransition(.zoom(sourceID:in:))` (iOS 18+); `ToolbarItem(placement: .confirmationAction)`, `.cancellationAction`; remove `presentationBackground` | default sheet transition |
| Confirmation dialog | `.confirmationDialog` attached to the Delete button | same API |
| Not used | `TabView` + `Tab(role: .search)` (would split the shared map per tab), system `.sheet` as the main sheet (covers the custom tab bar, one sheet at a time), `backgroundExtensionEffect` (no sidebar), `UIDesignRequiresCompatibility` (keep Liquid Glass) | |

Live Activity, Dynamic Island, widgets: unchanged (system frames).

---

## 14. CSS map (web, no build step, no new library)

| Component | Approach |
|---|---|
| Glass base | `.glass { background: var(--glass-fill); -webkit-backdrop-filter: var(--glass-filter); backdrop-filter: var(--glass-filter); box-shadow: var(--glass-rim), var(--glass-edge), var(--glass-shadow); }`; `#app.is-moving .glass--moves, html.glass-lite .glass { background: var(--glass-solid); -webkit-backdrop-filter: none; backdrop-filter: none; }`; fallbacks in 5.4 via `@supports not`, `prefers-reduced-transparency`, `prefers-contrast` |
| Top rows | `#topbar` becomes a column: `#pill` (Row A), a row with `#pill[data-form=chip]` + `#settingsBtn`, then `#ctxbar`; positions from `env(safe-area-inset-top)` |
| Lower-right group | `<div id="mapctl" class="glass glass--moves">` inside `#sheet` with `#timeBtn`, a hairline, `#locateBtn`; `position: absolute; bottom: calc(100% + 8px); right: 12px`; `opacity: calc(1 - clamp(0, (var(--p) - .1) / .2, 1))` |
| Sheet | `#sheet::before` (glass plate, header height, radius 28, `transform: scaleX(calc(1 - (24 / var(--vw)) * (1 - min(1, var(--p) / .35))))`), `#sheet::after` (opaque body, `opacity: min(1, var(--p) / .35)`); `--p` written by `ui/sheet.js` beside its drag variable; content padding-bottom = tab row + 20 |
| Tab bar + search | `#tabs` as `display: flex` row: `.tabcap.glass` (56, radius 28) with three buttons and `.tab-pill` (`transform: translateX(calc(var(--i) * 100%))`, transition `mTabPill`), then `#searchBar.glass` 56 circle |
| Press | `.glass:active { transform: scale(1.06); }` 160 ms; reduced motion: opacity |
| Materialize | `[data-enter]` / `[data-exit]` classes with `transform: scale(.85)` + `opacity` transitions |
| Zoom sheets | Settings / Lines by Time / dialogs: set `transform-origin` from the trigger's `getBoundingClientRect()` before opening; animate `transform: scale(.6) → 1` + opacity |
| Scroll edge under the tab bar | a 24 px `linear-gradient` from transparent to `bgSheet` at .9 on a non-blurred pseudo-element behind the bar, only while expanded |
| Tokens | `css/tokens.css` additions in 5.2 and 6; `--bg-chrome`, `--blur-chrome`, `--r-sheet`, `--search-h`, `--tab-h` kept as aliases until removed |
| Service worker | bump the cache name in `web/sw.js`; run `tools/test_precache.py` |

Keep every element id and `data-action` that tests and handlers use (`#searchBar`, `#timeBtn`, `#settingsBtn`,
`#locateBtn`, `#tabs`, `#pill`, `#pillRetry`, `#ctxbar`, `#sheet`, `#grab`, `#back`, `#title`, `#titleRight`); only
their place in the DOM and their CSS change.

---

## 15. Parity contract delta (DESIGN-SPEC 15)

Must be identical (added): positions and sizes of section 3; the "what moves where" table; glass vs solid per surface
(5.1); text-on-glass rules (5.3); shapes (6); motion tokens and reduced-motion behavior (7); focus order (11).

May differ (added):

| Area | iOS | Web |
|---|---|---|
| Glass rendering | Real Liquid Glass on iOS 26+ (lensing, light / dark flip, follows the user's iOS 26.1 setting or iOS 27 slider, Reduce Transparency); material on iOS 17 to 25 | Fixed 80% frosted fill with blur and a static rim; no lensing, no flip; solid under Increase Contrast, under Reduce Transparency where the browser reports it, while moving, and in `glass-lite` |
| Tab selection drag lens | system-like only if cheap; not required | not required |
| Compass | yes (MapKit rotates) | no (the map does not rotate) |
| Scroll edge effect | `scrollEdgeEffectStyle(.soft)` | gradient, no blur |
| Zoom sheets | navigation zoom transition (iOS 18+) | transform-origin scale |

---

## 16. Implementation order and acceptance

Order (each step shippable on the experimental site, tested before the next; "large chunks" per the owner):

1. Tokens (5.2, 6, 7) and the `glass` helpers (`sbGlass`, `.glass`), with the contrast pairs added to the tests.
2. Bottom row: tab bar capsule with the pill, search circle (ids kept), keyboard and overlay hiding.
3. Top rows: banner to Row A (Retry rule and tests unchanged), chips, Settings circle.
4. Lower-right group attached to the sheet (ride, fade, hidden expanded), compass (iOS), map framing and credit / legal
   positions.
5. Sheet: collapsed glass card, progress ramp, expanded edge sheet, content padding, scroll edge.
6. Directions card into the sheet (search circle → expanded Directions; collapse shows the option on the map).
7. Global restyle: capsule buttons, `rCard` 20, header circles, dialogs, Settings and Lines by Time sheets.
8. Motion polish: press, materialize, tab pill, zoom sheets; then optional minimize (Q3).
9. States pass (section 10) and accessibility pass (section 11) in light and dark; performance measurement (12.2).

Acceptance (in addition to DESIGN-SPEC 16):

- Every view of DESIGN-SPEC 16 rendered in light and dark, default and large text, 320 pt wide, demo / live / delayed /
  unreachable / no live locations, with the sheet collapsed and expanded; web via headless Edge, iOS via the CI
  gallery; plus the map under the glass in a busy spot (lines and buses under the card and the group).
- Glass count and area at rest within 12.1 (a script check on the rendered DOM: count elements with a non-`none`
  computed `backdrop-filter` and sum their visible areas).
- No text in `label2` or `tint` on a glass surface (a DOM check over `.glass` descendants on the web; a code review
  rule on iOS).
- The Retry tests, the e2e suite (748 tests at the last count) and the iOS UI tests pass; no element id used by tests
  removed.
- The 12.2 budgets met; owner's device check (12.3) reported separately.
- Ship checklist (`.claude/rules/project.md`) ticked: stale and failed feeds still flagged at the top (1); times and
  "est." unchanged (2); the next bus on the collapsed card, first paint under 2 s (3); one primary action per screen,
  Back always works, no dead ends (4); section 11 (5); nothing new leaves the device (6); plain static JS and CSS, Kit
  untouched (7); no UChicago names, logos or maroon in the app's own UI.

---

## 17. Open questions for the owner

| # | Question | Default in this spec |
|---|---|---|
| Q1 | Search entry: an icon-only glass circle at the bottom right (Apple Maps and iOS 26 put search at the bottom), or keep a labeled "Search for a destination" bar at the top in glass? | Bottom circle (2.2) |
| Q2 | Show a one-time pointer after the update ("Search moved here", on the circle) for current riders? It is a small new element. | No; the release notes carry the "what moves where" table |
| Q3 | Tab bar shrinks to a circle while you scroll a long list (iOS 26 behavior)? | Yes, built last; drop it if it feels busy |
| Q4 | Keep two sheet states, or add Apple Maps' middle height so a route stays visible above the options? (reverses 2026-10-12) | Two states |
| Q5 | Settings at the top right (today's place, iOS 26 convention), or inside the Current trip card like Maps' profile photo? | Top right |
| Q6 | Web glass strength: 80% frosted (always legible, chosen by contrast math), or clearer like iOS at the cost of legibility over busy spots? A website cannot read the iPhone's transparency setting. | 80% |
| Q7 | Bring the main app's map feedback button into this redesign (under Settings, top right)? | Yes, when the two repos meet |
| Q8 | Keep Start blue (green stays for live data) although Apple Maps' Go button has been green? | Blue |
| Q9 | Raise the iPhone app's minimum to iOS 26 so every rider sees the glass (iOS 17 to 25 get the frosted material)? | No, keep iOS 17 |

---

## 18. Owner decisions after v1 (2026-11-04)

| # | Owner's words | Decision | Web | iOS |
|---|---|---|---|---|
| D1 | "Remove the give feedback notification when the user logs onto the app. Keep the one overlayed on the map" | The beta welcome popup is gone; Q7 is yes: the map feedback button, 44 tinted glass circle under Settings (8.5) | done | paused (GLASS-IOS-PAUSED.md) |
| D2 | "Reduce the size of the reconnecting notification." | The status banner (8.1) is one 44 pt line in the footnote role: [Retry / See alert slot, unchanged] [icon] [a short line that still says the times can't be relied on + chevron]; the line is a Details button that opens the full sentence and "Call 773.702.8181" under it; screen readers always hear the full sentence; the line never moves | done | paused |
| D3 | "Change the background map to resemble something closer to apple maps", "the current map should make green spaces like parks actually green" | Replaces DESIGN-SPEC 11.2's "nothing colored except water and parks, both desaturated" with the palette below | done | MapKit already draws Apple's map: drop `emphasis: .muted` (one line) |
| D4 | "Do not make the main streets yellow. The highways being yellow is ok. This coloring of roads can confuse the user to think it is a bus line." | Only motorways are yellow-orange; main streets are white (light) / gray (dark) with a soft edge; a test checks no other road has a yellow or orange hue | done | MapKit's own colors |
| D5 | "When the menu is expanded, the current trip showing at the top of the screen should still show (same way as the settings button)." | The trip chip (8.3) stays visible above the expanded sheet like the Settings circle (replaces "hidden when the sheet is expanded"); with the simulated-buses chip in Row B it sits in Row C and the expanded sheet starts 8 below it | done | paused |
| D6 | "In the current trip menu, if a current trip is not selected, don't display nearby routes, rather, just show that no current trip is selected. Keep the favorites and search station bar. Also keep the alerts." | With no trip in progress Current trip shows the alert row, "No current trip selected" with how to start one (a Search for a destination button), the station search with its links, and the favorites; no nearest stop, no Arriving soon / Also nearby, no "Use my location"; the collapsed card says "No current trip selected" instead of the next bus. **The owner's choice, a deliberate departure from the ship checklist's "Nearby shows the next bus in one glance, no taps" (item 3) and from the 2026-10-11 decision that put the next bus first.** During a trip the next-bus block stays under the trip. Location still works from the locate button and Settings; feed problems still show in the status banner | done | paused (GLASS-IOS-PAUSED.md) |
| D7 | "change the color of favorite station icons to yellow instead of brown as it is now." (2026-11-05) | Favorite stars are yellow everywhere: the map badge is a `#FFCC00` (light) / `#FFD60A` (dark) disc with a `#1C1C1E` star (11:1), the ring as before, plus on light a 1 px `rgba(28,28,30,.6)` edge (4.3:1 on the land; the yellow alone is 1.4:1); the sheet's stars (Current trip favorites, the stop's Favorited button) the same yellow with that edge on light. A deeper gold than 53rd Street's lemon `#F7EB07` (hue 48 vs 57) so a star never reads as a 53rd stop. Replaces DESIGN-SPEC 11.4's "white on a #A35400 disc" and `warn` as the star color (tokens `--fav-mark`, `--fav-ink`, `--fav-edge`) | done | paused (GLASS-IOS-PAUSED.md: `Palette.starBadge`, the Favorite button star) |
| D8 | "Routes that come up in searching for my routes should appear right under the search bar above the phone numbers and other information." (2026-11-05) | While the Routes search field has text, the matches (or "No routes match" + Clear search) come first, directly under the field; the station filter chip, the feed notice, the operator's alerts, Other routes, the bulk capsules and the calls / official page follow, all still on the page. With a station filter the heading names it. Empty field: unchanged | done | paused |

### 18.1 Basemap palette (replaces DESIGN-SPEC 11.2's table; structure, zooms and label rules unchanged)

| Layer | Light | Dark |
|---|---|---|
| Land (`background`, `--map-land`) | `#F5F3EE` warm off-white | `#202124` neutral dark gray |
| Parks, lawns, recreation grounds, gardens (landcover grass, added) / nature reserves | `#C2E5AE` | `#1F3C28` |
| Woods / sports fields (landuse pitch, playground, added) | `#AED79B` / `#B5DDA0` | `#1B3523` / `#234430` |
| Cemetery / campus tint (landuse university, college, school, added) | `#D4E6C8` / `#EFE9DC` | `#25332A` / `#28272B` |
| Water / water text | `#A3D0F2` / `#2B6596` | `#1B3A5A` / `#8FB8DC` |
| Buildings / outline | `#E8E4DC` / `#D6D0C5` | `#2B2C30` / `#36373C` |
| Minor road / casing | `#FFFFFF` / `#D9D5CC` | `#3A3B40` / `#141416` |
| Major road / casing (primary, secondary, tertiary, trunk) | `#FFFFFF` / `#C9C4BA` (never yellow, D4) | `#4D4E55` / `#141416` |
| Motorway (and motorway bridges) / casing | `#F8C967` yellow-orange / `#D9A23A` | `#6A5A36` muted amber / `#141416` |
| Street names minor / major, place names | `#4F4F54` / `#2C2C2E` Bold, `#646469` | `#C7C7CC` / `#E5E5EA` Bold, `#A8A8AD` |

The green fills sit below the water layer (lagoons inside a park stay blue). Route lines: the casing flip
(`--map-casing-contrast`) is now 75% instead of 55%, so every route color keeps a 3:1 edge over land, parks, woods,
sports fields, campus and water in both themes (mid-tone lines such as East `#54BD00` and Apostolic/Drexel `#EA7948`
were under 3:1 with either edge before); the dark casing and bus ring follow the new land (`#202124`). Tests:
`tests/map-style.js` (parks green, water blue, land warm / neutral, only motorways yellow-orange (D4), every route edge >= 3:1).
**2026-11-04:** the route line casing and its flip are removed and the lines are thinner (owner: "Remove the outlines for
the lines but make the lines themselves thinner"), and with it the route edge test; the `--map-casing*` tokens stay for
the paused iPhone work (docs/redesign/GLASS-IOS-PAUSED.md).
