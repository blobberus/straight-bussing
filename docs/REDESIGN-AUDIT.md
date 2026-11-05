# Straight Bussing redesign audit (steps 1 and 2 of "Straight Bussing New Version.txt")

> **In the live repository (since 2026-11-05):** the website (`web/`) implements this spec; it came over from the
> experimental repository with the owner's request "Transfer the interface of the experimental build to the current main
> build of straight bussing" (docs/ARCHITECTURE.md "Glass interface on the live site"). The live iPhone app keeps its
> earlier interface (`ios/README.md`); the iPhone parts of this spec are built only in the experimental repository
> (https://github.com/blobberus/straight-bussing-experimental), where that work is paused (`docs/redesign/GLASS-IOS-PAUSED.md` there). Screenshots referred to below live
> there too: https://github.com/blobberus/straight-bussing-experimental/tree/main/docs/redesign

Date: 2026-11-02. Audited product: the main repository (github.com/blobberus/straight-bussing, called MAIN below) at
commit `5f43246` (web, "Beta feedback: more noticeable popup")
and the iPhone app's CI simulator gallery (https://blobberus.github.io/straight-bussing/ios/, built from `f61ee19`, one
commit behind; the only later change is the beta feedback popup and Settings card). The experimental repository's own
code is an older copy (Oct 27) and was not audited. The design that answers this audit is `docs/DESIGN-SPEC.md`.

Method: the web app was served from MAIN `web/` and driven in headless Microsoft Edge 156 over the DevTools protocol
(393 x 852 CSS px, device scale 2, touch, emulated safe areas 59 / 34 pt, light and dark via `prefers-color-scheme`,
geolocation set near the Regenstein Library stop, `?demo=1` for simulated buses, the live feed for live, alerts, failed
and delayed states). 66 web screenshots and 36 iPhone screenshots are in `docs/redesign/before/` (393 / 402 px wide,
256-color PNG; full index at the end). Design references: the skills in `.claude/skills/` (mobile-ios-design, impeccable
critique / iOS / craft floor / operate / typeset / animate, frontend-design, mapbox-cartography, mapbox-style-patterns
navigation and dark mode, swiftui-expert incl. Liquid Glass, ui-ux-pro-max pro rules, taste-skill).

Important rendering caveat: the web shots come from Windows, so the system font is Segoe UI, not SF Pro. On an iPhone the
same CSS renders in SF Pro. Spacing, color, layout and hierarchy findings hold on both; letterforms do not.

---

## 1. Inventory

### 1.1 Platforms and frameworks

| | Web (MAIN `web/`) | iPhone (MAIN `ios/`) |
|---|---|---|
| Stack | Static site, plain ES modules, no build step. 19 view modules (`js/ui/views`), shell modules in `js/ui`, logic in `js/core` | SwiftUI app, iOS 17.0 deployment target, built only on CI (`ios.yml`, `macos-26`, Xcode 26); logic in `StraightBussingKit` (ported from `web/js/core`) |
| Map | Leaflet 1.9.4 + MapLibre GL 4.7.1 through maplibre-gl-leaflet 0.1.4; OpenFreeMap vector styles `positron` (light) and `dark`, patched at runtime by `js/map/style.js` | Apple MapKit, `.mapStyle(.standard(elevation: .flat, pointsOfInterest: .excludingAll))` (`MapScreen.swift`) |
| Overlays | Route lines = Leaflet SVG polylines with casings (`map/layers.js`); stops = circle markers; buses, landmarks, favorites, labels = DOM markers (`map/layers.js`, `map/landmarks.js`, `css/map.css`) | `MapPolyline` (no casing), SwiftUI `Annotation` views for buses, stops, labels |
| Styling | 12 CSS files, 1,880 lines; tokens in `css/tokens.css` (colors, type, spacing, radii, z-index, motion) | `ios/Shared/Palette.swift` (colors, `Radius`, `PrimaryButtonStyle`, `SecondaryButtonStyle`); system text styles |
| Navigation shell | Floating search bar with clock + gear (`index.html #topbar`), status pill, context bar, locate button, bottom sheet (`ui/sheet.js`), bottom navigation (`#tabs`), router with back stack (`ui/router.js`), Settings overlay (`ui/settings-overlay.js`) | `RootView.swift`: `SearchBar`, `StatusPill`, `ContextBar`, `ToastBanner`, `LocateButton`, custom `TabBar`, `SimulatedPill`; custom `BottomSheet.swift`; Settings and Lines by Time as system sheets |

### 1.2 Map style (web `js/map/style.js`, iOS MapKit)

- Basemap palettes: light land `#eeefeb`, park `#d8e7d0`, water `#aecde3`, buildings `#e1e0da`, street text `#26272c`;
  dark land `#18181b`, park `#1b2620`, water `#0f2232`, roads `#37373e` / `#4b4b54`, text `#efeff4`. Shields, one-way
  arrows and most POIs hidden; street names re-drawn (no uppercase, majors bold, land-colored halo); house numbers from z17.
- 87 curated building and place names (`web/data/landmarks.json`, 3 zoom tiers) drawn as DOM labels ABOVE the route lines
  (owner decision 2026-10-13): weight 700, navy `#2c4a66` / `#bcd0e2`, a 10-shadow halo and a 50% plate.
- Route lines: weight 4 / 5 / 6 at zoom 13 / 15 / 17, opacity .92, casing weight + 3 in white (light) or `#1c1c1e` (dark);
  unfocused routes dim to .25 when a route or trip is focused. Stops: 10 px white circles with a 2.5 px route-color ring.
- Bus markers: 28 px route-colored badge, 800-weight 11.5 px short name, 2 px white border, heading notch, numbered-bus
  disc (17 px, top right) when a line has 2+ buses.
- iOS: Apple's standard basemap with POIs off; route lines without casings; same marker ideas drawn in SwiftUI.

### 1.3 Screens and states

| Screen / state | Web module | iOS view | Before shots (web / ios) |
|---|---|---|---|
| Current trip, collapsed (map first) | `views/nearby.js` | `CurrentTripView` | web/01-current-collapsed-{light,dark} |
| Current trip, expanded with location (next bus first) | `nearby.js`, `nearby-cards.js` | `CurrentTripView` | web/02-*, ios/01-current-* |
| Current trip, no location | `nearby.js` | `CurrentTripView` | web/03-*, ios/25-current-noloc-light |
| Search (Directions fields + suggestions, spelling fix, Photon) | `directions.js`, `placesearch.js`, `pick.js` | `DirectionsView`, `PlaceSearchViews` | web/04-*, web/05-*, ios/18-search-light, ios/14-place-search-light |
| Route options (ranked, walk first, steps, Start) | `directions.js`, `tripinfo.js` | `DirectionsView` | web/06-*, ios/04-directions-* |
| Trip in progress (timeline with the live bus, map with You) | `views/tripprogress.js`, `ui/tripmap.js` | `TripTimelineView`, `MapScreen` | web/07-*, ios/02-trip-*, ios/03-trip-full-light, ios/38-trip-map-* |
| Route detail (stops, buses, hours and service, closed route first) | `views/route.js` | `RouteDetailView` | web/08-*, ios/06-route-light |
| Stop detail (arrivals, routes, Directions to / from, favorite) | `views/stop.js` | `StopDetailView` | web/09-*, web/20c-*, ios/08-stop-* |
| Routes list (show / hide, Show all / running / Hide all, map order) | `views/routes.js`, `routes-drag.js` | `RoutesView` | web/10-*, ios/05-routes-* |
| My Routes (custom routes, favorites, alerts, About) | `views/myroutes*.js` | `MyRoutesView` | web/11-*, ios/07-myroutes-light |
| Settings (beta feedback, appearance, location, alerts, bus alerts, favorites, usage statistics, credits) | `views/settings.js`, `ui/settings-overlay.js` | `SettingsView` | web/12-*, ios/09-settings-light |
| Lines by Time | `views/timepick.js`, `ui/wheel.js` | `TimePickView` | web/13-*, ios/41-lines-by-time-light |
| Alerts | `views/alerts.js` | `AlertsView` | web/14-*, ios/16-alerts-light |
| Routes to station | `views/pick.js` | `PickView` | web/23-routes-to-station-light, ios/17-pick-light |
| About | `views/about.js` | `AboutView` | web/26-about-light, ios/11-about-light |
| Beta welcome popup | `ui/feedback.js` | (Settings row only) | web/22-beta-welcome-light |
| Live: next bus, service alert row | live feed | live feed | web/15-*, web/14-alerts-* |
| Feed failed (error pill, live times unavailable) | `ui/pill.js`, views | `StatusPill` | web/16-* |
| Feed delayed / out of date | `ui/pill.js` | `StatusPill` | web/17-*, ios/28-livestates-light |
| No live locations during scheduled service | `core/operating.js` | `Operating` | web/25-*, ios/26-nobus-light, ios/27 (not copied) |
| Location blocked (help, toast) | `core/lochelp.js`, `settings.js` | Settings > Location | web/18-* |
| Loading (first paint) | `index.html` skeleton | | web/19-loading-light |
| Long names | | | web/20-* |
| Larger text (web 200% default font size; iOS xxxLarge and AX3) | | | web/21-*, ios/30..34-*-text-* |
| Narrow phone (320 x 640) | | | web/24-current-320-light |
| Live Activity / Dynamic Island | iPhone only | `LiveTripViews` | ios/10-liveactivity-light |
| Rerouting (missed bus: the next bus is followed) | `core/tripprogress.js` `missed` | `TripFollow` | not rendered (needs a real bus to leave) |

### 1.4 Reusable components

| Component | Web | iOS |
|---|---|---|
| Route chip / badge | `ui/components.js routeChip` (`.chip`, `.lt` / `.dk` rings) | `Components.swift` route chip |
| ETA numeral + unit, "Now", stale "~" | `components.js` ETA helper | `Components.swift` |
| Empty state, skeleton rows | `components.js emptyState`, `skeleton` | `ContentUnavailable`-style views in each screen |
| Bottom sheet (2 resting states, drag, slider a11y) | `ui/sheet.js` | `BottomSheet.swift` (+ Kit `SheetMotion`) |
| Status pill (5 states with icons) | `ui/pill.js` | `RootView.StatusPill` |
| Context bar (custom route / trip filter) | `ui/contextbar.js` | `RootView.ContextBar` |
| Confirm dialog, toast | `ui/confirm.js`, `#toast` | system `confirmationDialog`, `ToastBanner` |
| Wheel picker | `ui/wheel.js` | system wheel `Picker` |
| Trip timeline | `views/tripprogress.js` | `TripTimelineView` |
| Option card + steps | `views/tripinfo.js` | `DirectionsView` |
| Buttons | `.v-btn--primary`, `.v-btn--secondary`, text links | `PrimaryButtonStyle`, `SecondaryButtonStyle` |

### 1.5 Current tokens and where web and iOS already disagree

| Token | Web (`tokens.css`) | iOS (`Palette.swift`) | Note |
|---|---|---|---|
| Accent text | `#0066D6` / `#409CFF` | `#0060CC` / `#64B0FF` | passes on today's web surfaces, but would fall to 3.8:1 on the iOS-style control fill the redesign adopts; the iOS value passes on both |
| Live text | `#17803B` / `#32D74B` | `#157A38` / `#32D74B` | web light is 4.49:1 on the gray `#F2F2F7` cards where "Live" appears (just under AA) |
| Danger text | `#C4291C` / `#FF6961` | `#B8261A` / `#FF8C85` | same as the accent: 3.8:1 on the iOS-style control fill; the iOS value passes |
| Sheet / cards | sheet `#FCFCFD` at 86% + blur, cards `#F2F2F7` | sheet `#F2F2F7`, cards `#FCFCFD` | surfaces are inverted between the two apps (web/02 vs ios/01) |
| Warning pill | pale `#FFF4E0` with brown text | system yellow fill with dark text | same state, two looks (web/17 vs ios/26) |
| Search bar | capsule (999 px) | rounded rectangle | |
| Tab indicator | tinted capsule behind the selected icon (Material style) | none, tint + filled symbol (iOS style) | |
| Section headers | sentence case ("Also nearby") | uppercase ("ALSO NEARBY", "STOPS", "ARRIVALS") | |
| Type | 6 size tokens + 11 literal sizes, weights 400 / 500 / 590 / 600 / 650 / 700 / 800 | system styles, mostly `.subheadline` (89 uses) and `.caption` (86), `.body` 5 | |
| Radii | pill 999, sheet 20, card 14, control 12, inner 10, badge 9, tag 6 | same scale | 7 values |

---

## 2. The five biggest contributors to an unfinished or generic look

Ranked by how much of the screen they touch and how often a rider sees them.

### 1. The map has no visual hierarchy

<img src="redesign/before/web/01-current-collapsed-light.png" width="190"> <img src="redesign/before/web/01-current-collapsed-dark.png" width="190"> <img src="redesign/before/web/07c-trip-collapsed-map-light.png" width="190"> <img src="redesign/before/ios/36-map-light.png" width="190">

What we see: on the home screen all 14 lines draw at the same weight and full saturation, every stop is the same white dot,
the curated building names are bold navy text sitting above the route lines (owner rule: above the lines), street names
compete with both, and bus badges carry a number disc that overlaps the badge and its neighbors. In `web/01-*` the
Apostolic/Drexel badge reads "AP/D" (the short name is cut) and two badges overlap at Midway Plaisance.

Measured: route colors against the basemap land color. 53RD yellow `#F7EB07` on the light land is **1.08:1**, so the
line and its white casing nearly vanish (`web/07c-trip-collapsed-map-light`: the trip's own line is the faintest thing on
the map). On the dark basemap RE navy `#393B79` is **1.75:1**, DCC green `#0E5700` **2.01:1**, AP blue `#0000FF`
**2.06:1**. A line's casing is always white (light) or near-black (dark), whatever the line's color, so the casing helps
dark lines on light maps and hurts light lines on light maps.

Why it reads unfinished: the map is the product and the first thing a rider sees, but nothing on it says what matters.
mapbox-cartography's hierarchy (user location and routes first, landmarks second, streets third, land last) is
inverted: landmarks are the boldest text on screen. Apple Maps and Google Maps keep the basemap quiet and let one or two
colored lines carry the screen.

Direction (spec section 11): muted basemap with lighter labels; a casing that switches to a dark or light edge when the
route color is too close to the land; two emphasis levels (network vs focused); landmark names at regular weight in a
gray, not bold navy; bus markers that never cut their own name; numbered buses shown inside the marker.

### 2. Floating chrome is heavy, stacked and speaks three shape languages

<img src="redesign/before/web/01-current-collapsed-light.png" width="190"> <img src="redesign/before/web/16-feed-failed-collapsed-light.png" width="190"> <img src="redesign/before/web/07c-trip-collapsed-map-light.png" width="190"> <img src="redesign/before/web/18-location-denied-light.png" width="190">

Measured on the collapsed home screen (393 x 852, `web/01-current-collapsed-light`): search capsule 48 px (y 69 to
117), status card 44 px (y 125 to 169), locate button 44 x 44 with a 12 px radius next to it, collapsed sheet header
72 px (y 684 to 756), bottom navigation 92 px including the 34 px home indicator area. From the status bar down to the
map band: 110 pt; from the sheet's top edge down to the home indicator: 134 pt. That is 244 of the 759 usable points
(32%) covered while the sheet is collapsed, before any trip chip appears.

Shapes: a capsule search bar, 12 px rounded rectangles for the status card and the locate button, a tinted capsule
behind the selected tab (a Material Design indicator, not an iOS one), 20 px sheet corners. Icons: the same paper-plane
arrow means "Current trip" (tab) and "Show my location" (button); "Use my location" uses a third glyph, a crosshair.

Breakages: the trip filter chip clips its own text ("for: To Trader Joe's  Only sh", `web/07c`); the feed-error card
grows to three lines of red over the map (`web/16`); the location toast lands on top of the sheet title (`web/18`).
On iOS the same states use a saturated yellow bar (`ios/26-nobus-light`), on the web a pale card: one state, two looks.

Why it reads unfinished: stacked floating cards of different shapes are the clearest "assembled from parts" signal
(impeccable iOS slop test: reinvented bars). Apple Maps floats one search field and one small control stack; status
lives in a compact, consistent element.

Direction (spec 10.1 to 10.6): one capsule language for everything floating over the map (search bar, round map
buttons, compact status and filter chips); warnings as one 2-line banner with solid status color; tab bar to iOS
metrics without the capsule indicator; one glyph per meaning.

### 3. The translucent sheet muddies everything under it, and the two apps use inverted surfaces

<img src="redesign/before/web/02-current-expanded-dark.png" width="190"> <img src="redesign/before/web/07-trip-progress-light.png" width="190"> <img src="redesign/before/web/02-current-expanded-light.png" width="190"> <img src="redesign/before/ios/01-current-light.png" width="190">

What we see: the web sheet is `rgba(252, 252, 253, .86)` (dark `rgba(28, 28, 30, .82)`) with
`backdrop-filter: blur(24px) saturate(1.8)`. Over saturated route lines the blur turns into colored smears: red and
green washes behind "Current trip" in dark mode (`web/02-current-expanded-dark`), a yellow cloud behind the trip card in
light mode (`web/07-trip-progress-light`). The colors move as the map moves, so the sheet looks dirty rather than glassy,
and a large blurred layer is costly to repaint while the sheet is dragged (not profiled in this audit).

Surfaces are inverted across platforms: the web puts gray cards (`#F2F2F7`) on a near-white sheet, the iPhone app puts
near-white cards (`#FCFCFD`) on a gray sheet (`web/02` vs `ios/01`, sampled pixels). Inside the sheet there is no
consistent elevation: selected option cards get a 2 px accent outline, the beta card a blue tint, alert rows a warm tint,
nearby cards a gray fill, all at the same level.

And when expanded, the sheet covers the map up to the search bar (two resting states, owner 2026-10-12), so in every
reading state the map, which should stay dominant, is gone.

Why it reads unfinished: translucency used everywhere stops being a signal (impeccable craft floor: "glass and blur as
decoration"). Apple's own sheets are opaque or use a thick system material that neutralises color; Apple Maps keeps the
saturated map out of its text surfaces.

Direction (spec 7 and 8): opaque sheet and tab bar; translucency only on small floating controls; the iOS grouped
convention on both (gray sheet, near-white cards); three elevation levels; the collapsed header carries the one-line
answer so the map stays visible for the main tasks (detent question left to the owner, spec 17).

### 4. Typography has no role system

<img src="redesign/before/web/06b-route-option-bus-light.png" width="190"> <img src="redesign/before/web/21c-text-200-options-light.png" width="190"> <img src="redesign/before/web/21-text-200-collapsed-light.png" width="190"> <img src="redesign/before/ios/01-current-light.png" width="190">

Measured in the web CSS: 17 distinct font-size values (6 tokens plus 11 literals such as `.875rem`, `10px`, `1.375rem`,
`.8125rem`), 7 weights (400, 500, 590, 600 x 56 rules, 650 x 17, 700, 800). Almost everything is semibold, so weight no
longer separates title from detail.

A root bug: `html { font: 400 var(--fs-body)/... }` sets the root font size to 15 px, so every `rem` token renders at
15/16 of its value. Measured: the sheet title is 26.25 px instead of 28, row titles 15.94 px instead of 17, body 14.06 px
instead of 15, captions 11.25 px instead of 12. The web is smaller than the iPhone app at the same "size".

On iOS the code leans on small styles: `.subheadline` 89 uses and `.caption` 86 uses against `.body` 5, so most text is
12 to 15 pt. Casing differs by platform (iOS section headers uppercase, web sentence case). Metadata is chained with
middle dots ("2 min walk · 146 m", "Live · Leave in 10 min, est."). The ETA unit "min" is stacked under the numeral,
which costs a line and breaks the reading order.

At 200% browser text the web layout breaks: the option card puts "8" and "min" on different lines with a tag between
them (`web/21c`), the collapsed "Current trip" title is cut by the bottom navigation (`web/21`), tab labels crowd the
bar (`web/21b`). The iPhone app reflows better at AX3 but wraps titles mid-word ("Regen- stein", `ios/31-trip-text-ax3`).

Why it reads unfinished: no named roles means each screen sets its own sizes; adjacent roles at 600 vs 650 weight read as
the same; the result looks like default HTML with bold sprinkled on. impeccable operate: one family, fixed role scale,
1.125 to 1.2 steps, roles that are recognisable without reading the copy.

Direction (spec 2): 10 named roles mapped to Dynamic Type styles, three weights (400, 600, 700), sentence case, root
font size fixed and tied to Dynamic Type on iPhone Safari, explicit accessibility-size layouts.

### 5. Route and trip information is not glanceable

<img src="redesign/before/web/06b-route-option-bus-light.png" width="190"> <img src="redesign/before/web/07-trip-progress-light.png" width="190"> <img src="redesign/before/web/09-stop-detail-light.png" width="190"> <img src="redesign/before/web/10-routes-light.png" width="190">

What we see in one route option (`web/06b`): the same trip told three times (leg strip, then "Walk 2 min to Ellis Ave
& 57th St · bus 3:11 PM", then "Leave in 10 min (by 3:09 PM) · includes 5 min walking", then the steps), with 2 "est."
chips, 2 "sidewalk route" chips and a "live" chip in a single card, each a gray filled tag. The trip in progress
(`web/07`) stacks a "Trip to" header, a hero card and a timeline that repeats the hero's first step. A stop page
(`web/09`) has four button styles at once: filled blue, gray, outlined pill ("Favorite"), and text. The Routes filter is
three bare text buttons, the first looking disabled (`web/10`). Explanatory footnotes ("Leave times use a walking
estimate (80 m a minute) and live bus times. Allow extra time.", "Places near campus are searched on your device...")
sit at nearly the weight of the content on many screens.

Why it reads unfinished: honesty is a strength of this app (ship checklist items 1 and 2), but it is expressed as
repeated chips and sentences instead of a consistent, quiet notation, so every card looks like a log. The checklist goal
"Nearby shows the next bus in one glance" is met in content but not in form: the eye has no single place to land.

Direction (spec 10.9 to 10.16): one ETA notation (numeral + inline unit + source mark), "est." as quiet text after the
number it qualifies instead of a filled chip, option cards limited to four lines until selected, one primary action per
screen with one secondary style, honesty notes in the footnote role at the end of a section.

---

## 3. Defects found while auditing (fix during implementation; not design choices)

1. Root font size is 15 px (`css/base.css` `html, body { font: ... }`), shrinking every rem value by 6.25%.
2. Trip filter chip clips its text instead of truncating the label (`web/07c-trip-collapsed-map-*`).
3. Toast overlaps the sheet title and stays over Settings (`web/18-location-denied-light`, `web/18b-*`).
4. Bus marker cuts long short names ("AP/D" for AP/DX) and its number disc overlaps neighbors (`web/01-*`).
5. 200% text: collapsed title cut by the tab bar, option total split across lines, tab labels crowd (`web/21*`).
6. Light live text `#17803B` is 4.49:1 on the gray cards it sits on (just under AA). Dark accent `#409CFF` and dark
   danger `#FF6961` pass on today's web surfaces but drop to 3.8:1 on the control fill both apps will share. The iOS
   values already pass everywhere; the web should take them.
7. Location glyph used for two meanings (tab and locate) and a third glyph for the same meaning ("Use my location").

## 4. What already works and must be kept

- **Navigation structure** (owner decisions): floating search bar that morphs into the Start / Destination card; three
  sections in a bottom bar (Current trip, Routes, My Routes); clock (Lines by Time) and gear (Settings) inside the search
  bar; sheet with two resting states and drag from the whole header; back stack with "line replaces line"; Settings as an
  overlay with Done; Lines by Time with Cancel / Set time.
- **Honesty system**: status states each with icon and words, "est." on derived numbers, "Live" vs schedule source,
  "~" and muted color for stale times, "Last known", the operator's alert verbatim with its number as the first call and
  773.702.8181 second, "Unofficial" wording, no UChicago branding in the app's own chrome. Error states keep last data.
- **Route color as identity**, the badge shape repeated on the bus marker, route colors used only as data.
- **One accent and green-means-live**: already consistent and contrast-tested (`tests/ui-shell-contrast.js`).
- **Accessibility groundwork**: 44 px targets, keyboard-operable sheet (slider role), reduced motion paths, contrast tests,
  `prefers-contrast` handling, VoiceOver labels on iOS, Dynamic Type reflow on iOS up to AX sizes.
- **Map engineering**: OpenFreeMap vector basemap with legible street names, buses that ride their route line, heading
  cone, curated landmarks with collision rules, line tap to open a route, the trip map with "Board here".
- **Content design**: Arriving In, walk first when close, trip timeline with the live bus on the rail (Google Maps
  style), skeletons shaped like rows, the wheel picker in Lines by Time, the iOS grouped lists and system sheets.
- **iPhone-only features**: Live Activity and Dynamic Island in whole minutes.

## 5. Not rendered or not verified

- Real iPhone Safari and the native app on a device (fonts, safe areas, sheet gestures, haptics, Dynamic Island). The web
  shots use Segoe UI and emulated safe areas; motion and drag physics cannot be judged from stills.
- Rerouting / missed-bus state (needs a followed bus to leave while the rider is near the stop); the iOS gallery has none.
- Keyboard-up states (headless has no on-screen keyboard), landscape panel, desktop phone frame, web custom route editor,
  web delete confirmation, Credits expanded, Usage statistics section.
- "No shuttles running" (no service scheduled) on the web; the iPhone gallery shows the related no-bus state
  (`ios/26-nobus-light`). The web "no live locations" state was produced by emptying the live feed in the page.
- VoiceOver / screen reader passes; Increase Contrast; iOS dark mode at large text.
- Live-mode content depends on the feed at 15:00 on a Monday (buses running, one operator alert).

## 6. Screenshot index (`docs/redesign/before/`)

Web (`web/`, 393 px wide; `-light` / `-dark` = appearance):

| File | State |
|---|---|
| 01-current-collapsed-{light,dark} | Home, sheet collapsed, demo buses, location granted |
| 02-current-expanded-{light,dark}, 02b-*-scrolled-* | Current trip expanded: nearest stop, nearby buses |
| 03-current-noloc-collapsed-light, 03b-*-expanded-light | No location: Use my location first |
| 04-search-open-{light,dark} | Search bar morphed into Start / Destination |
| 05-search-results-{light,dark} | Place results for "trader joe" |
| 06-route-options-{light,dark} | Route options as ranked |
| 06b-route-option-bus-{light,dark}, 06c-route-steps-* | Bus option selected, steps, Start |
| 07-trip-progress-{light,dark}, 07b-*-scrolled-* | Trip in progress, timeline |
| 07c-trip-collapsed-map-{light,dark} | Trip map with You, Board here, trip chip |
| 08-route-detail-collapsed-*, 08b-route-detail-* | Route detail (East, not running now) |
| 09-stop-detail-{light,dark} | Stop detail (Reynolds Club) |
| 10-routes-{light,dark} | Routes list |
| 11-myroutes-{light,dark} | My Routes with two custom routes and two favorites |
| 12-settings-{light,dark}, 12b-settings-scrolled-light | Settings overlay |
| 13-lines-by-time-{light,dark} | Lines by Time |
| 14-alerts-{light,dark} | Alerts (live operator alert) |
| 15-live-collapsed-light, 15b-live-expanded-light | Live feed, service alert row |
| 16-feed-failed-collapsed-{light,dark}, 16b-*-expanded-* | Feed unreachable |
| 17-feed-delayed-collapsed-light, 17b-*, 17c-feed-out-of-date-expanded-light | Feed 200 s and 420 s old |
| 18-location-denied-light, 18b-location-denied-settings-light | Location blocked: help and toast |
| 19-loading-light | First paint at 450 ms |
| 20-long-name-results-light, 20b-*-options-*, 20c-long-stop-name-light | Long place names |
| 21-text-200-collapsed-light, 21b-*-expanded, 21c-*-options, 21d-*-route | Browser default font 32 px (200%) |
| 22-beta-welcome-light | Beta welcome popup |
| 23-routes-to-station-light | Routes to station |
| 24-current-320-light | 320 x 640 phone |
| 25-no-live-locations-collapsed-light, 25b-*-expanded-light | Empty live feed during scheduled service |
| 26-about-light | About |

iPhone (`ios/`, from the CI gallery, 402 px wide): 01-current-{light,dark}, 02-trip-{light,dark}, 03-trip-full-light,
04-directions-{light,dark}, 05-routes-{light,dark}, 06-route-light, 07-myroutes-light, 08-stop-{light,dark},
09-settings-light, 10-liveactivity-light, 11-about-light, 14-place-search-light, 15-trip-started-light, 16-alerts-light,
17-pick-light, 18-search-light, 25-current-noloc-light, 26-nobus-light, 28-livestates-light, 30-current-text-ax3,
31-trip-text-ax3, 32-stop-text-ax3, 33-directions-text-ax3, 34-routes-text-xxxl, 36-map-{light,dark},
37-map-near-light, 38-trip-map-{light,dark}, 41-lines-by-time-light, store-01-arrivals-light.
