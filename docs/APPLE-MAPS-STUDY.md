# Apple Maps and Liquid Glass: a study for the second redesign

> **In the live repository (since 2026-11-05):** the website (`web/`) implements this spec; it came over from the
> experimental repository with the owner's request "Transfer the interface of the experimental build to the current main
> build of straight bussing" (docs/ARCHITECTURE.md "Glass interface on the live site"). The live iPhone app keeps its
> earlier interface (`ios/README.md`); the iPhone parts of this spec are built only in the experimental repository
> (https://github.com/blobberus/straight-bussing-experimental), where that work is paused (`docs/redesign/GLASS-IOS-PAUSED.md` there). Screenshots referred to below live
> there too: https://github.com/blobberus/straight-bussing-experimental/tree/main/docs/redesign

Status: research for the owner's request of 2026-11-03 ("Deeply study the structure of Apple Maps (all aspects
ranging from button locations to animations to be compatible with liquid glass). Based on the information you learn,
do another redesign ..."). Written 2026-11-04. The spec built from it is `docs/DESIGN-SPEC-GLASS.md` (a delta on
`docs/DESIGN-SPEC.md`). No app code here, and no copyrighted screenshots: every reference image is described in words.

How to read the evidence labels:

- **[V]** verified in a primary source (Apple's Human Interface Guidelines, Apple developer documentation, a WWDC25
  session transcript, the iPhone User Guide, apple.com), quoted or closely paraphrased, with the URL in section 9.
- **[R]** reported by a reputable secondary source (MacRumors, AppleInsider, 9to5Mac, Six Colors, NN/g, heise, a
  developer blog) but not confirmed by Apple.
- **[I]** inference or an observation I could not confirm in any source: treat it as a hypothesis to check on a real
  iPhone (owner QA) or in the CI simulator gallery before relying on it.

Version note. The owner named iOS 26. Today (November 2026) iPhones run iOS 26 or iOS 27 (released September 2026).
iOS 27 keeps the iOS 26 layout of Maps and refines the material (section 7). This app is built with Xcode 26 on CI
(`macos-26`, iOS 26 SDK) and its deployment target is iOS 17.0 (`ios/project.yml`), so every glass API below is
iOS 26+ and needs a fallback.

Contents: 1 Findings in one page, 2 Liquid Glass (the material and its rules), 3 Apple Maps on iOS 26: layout,
4 Apple Maps: sheets, place cards, search, directions, transit, navigation, 5 Motion, 6 Accessibility fallbacks,
7 iOS 27 changes, 8 What this means for a web version, 9 Sources.

---

## 1. Findings in one page

1. **Glass is the control layer, never the content layer.** "Liquid Glass forms a distinct functional layer for
   controls and navigation elements ... that floats above the content layer"; "Don't use Liquid Glass in the content
   layer" (HIG Materials) [V]. Lists and tables stay out of glass ("keep it in the content layer", WWDC25 219) [V].
2. **Use it sparingly, and never glass on glass.** "Limit these effects to the most important functional elements"
   (HIG Materials) [V]; "Always avoid glass on glass" (WWDC25 219) [V]; things on top of glass use "fills,
   transparency, and vibrancy" so they read as part of the material [V].
3. **Regular, not clear, for anything with text.** The regular variant "blurs and adjusts the luminosity of background
   content to maintain legibility"; clear is for media backgrounds and needs a dimming layer (about 35% dark over
   bright content) (HIG Materials) [V]. A map with saturated route lines is not a media background: regular it is.
4. **Color goes on the background of one primary action, not on text.** "To emphasize primary actions, apply color to
   the background rather than to symbols or text ... Refrain from adding color to the background of multiple
   controls" (HIG Color, Liquid Glass color) [V]; tinting "should only be used to bring emphasis to primary elements"
   (WWDC25 219) [V].
5. **Apple Maps moved its map controls from the top right (iOS 18) to the lower right (iOS 26).** The iPhone User
   Guide for iOS 18 says the Map Modes button is "at the top right of a map"; the iOS 26 guide says "at the lower
   right" [V]. AppleInsider describes the iOS 26 cluster: the location arrow with the folded-map Map Modes button
   above it, a 2D/3D button nearby, Look Around binoculars at the bottom left and the weather at the top left [R].
6. **Search lives at the bottom.** In Maps the search field is "at the top of the card" (the bottom sheet) [V];
   system-wide, iOS 26 puts search "within easy reach at the bottom of iPhone" (Apple's iOS 26 feature list) [V], and
   the HIG says "Place search at the bottom if there's room" [V]. A search tab can be a separate button at the
   trailing end of the tab bar (HIG Search fields, Tab bars) [V].
7. **Sheets float, then anchor.** "Partial height sheets are inset by default with a Liquid Glass background. At
   smaller heights, the bottom edges pull in, nesting in the curved edges of the display. When transitioning to a full
   height sheet, the glass background gradually transitions, becoming opaque and anchoring to the edge of the screen"
   (WWDC25 323) [V]; "When a half sheet expands to full height, it transitions to a more opaque appearance" (Adopting
   Liquid Glass) [V].
8. **The tab bar floats, shows a capsule behind the selected tab, and can shrink.** "The tab bar on iPhone floats
   above the content, and can be configured to minimize on scroll" (WWDC25 323) [V]; tab bars "shrink to create more
   space as you scroll, and fluidly expand ... when you scroll up or tap" (iOS 26 feature list) [V]; Apple DTS: "the
   selected capsule is the system-standard visual indicator for the active tab" (Developer Forums 821539) [V].
9. **Controls morph and materialize instead of fading.** Glass objects "materialize in and out by gradually
   modulating the light bending and lensing" (WWDC25 219) [V]; alerts "expand from the button that initiates them"
   and action sheets spring "from the action itself" (iOS 26 feature list, WWDC25 356) [V]; sheets can zoom out of the
   toolbar button that opens them (WWDC25 323) [V].
10. **Accessibility settings change the material automatically, and users can now set the amount.** Reduce
    Transparency "makes Liquid Glass frostier", Increase Contrast "makes elements predominantly black or white and
    highlights them with a contrasting border", Reduce Motion "disables any elastic properties" (WWDC25 219) [V].
    iOS 26.1 added a Clear / Tinted choice and iOS 27 a slider from "ultra clear to fully tinted" [R]. iPhone Safari
    does not expose Reduce Transparency to web pages (`prefers-reduced-transparency` is unsupported through Safari
    27.2, caniuse) [V], so a web copy must be legible at its default transparency.

---

## 2. Liquid Glass: the material and its rules

### 2.1 What it is

- A material that "combines the optical properties of glass with a sense of fluidity", that "blurs content behind
  it, reflects color and light of surrounding content, and reacts to touch and pointer interactions in real time"
  (Applying Liquid Glass to custom views) [V].
- Lensing: "this new set of materials dynamically bends, shapes, and concentrates light in real time" (WWDC25 219) [V].
- Adaptivity: "each layer continuously adapts based on what's behind it"; small elements "like navbars and tabbars"
  flip between light and dark with the content beneath, bigger elements "like menus or sidebars ... don't flip";
  shadows get stronger over text and weaker over plain light backgrounds; when glass grows (a menu from a toolbar
  button) it "simulate[s] a thicker, more substantial material" (WWDC25 219) [V].
- Color: glass "has no inherent color, and instead takes on colors from the content directly behind it"; on small
  elements "symbols and text ... follow a monochromatic color scheme, becoming darker when the underlying content is
  light, and lighter when it's dark"; larger elements are "more opaque ... to preserve legibility" (HIG Color) [V].

### 2.2 Where it goes

| Rule | Source |
|---|---|
| Controls and navigation (tab bars, toolbars, sidebars, floating buttons, sheets, menus, alerts) are glass; content (lists, cards, text, the map) is not | HIG Materials, Adopting Liquid Glass [V] |
| Exception: sliders and toggles in content take on glass only while touched | HIG Materials [V] |
| Standard components adopt it automatically; custom glass "sparingly", on "the most important functional elements" | HIG Materials, Adopting Liquid Glass [V] |
| No glass on glass; elements on top of glass use fills, transparency and vibrancy | WWDC25 219 [V] |
| Remove custom bar backgrounds and darkening; let the system draw the material and the scroll edge effect | WWDC25 323, HIG Toolbars [V] |
| "Instead of applying a solid or semi-opaque background color beneath controls, use a scroll edge effect" | HIG Layout [V] |
| Scroll edge effect: soft by default on iOS, hard for pinned headers and controls without backgrounds; "Apply one scroll edge effect per view"; not where there is no floating UI | WWDC25 356 [V] |
| Group bar items by function and frequency; never group a symbol button with a text button in one container; at most three groups | WWDC25 356, HIG Toolbars [V] |
| Primary action (Done) stays separate, tinted, "often as a blue checkmark", on the trailing side | WWDC25 356, HIG Toolbars [V] |
| Standard Back and Close are symbols, never the words "Back" or "Close" | HIG Toolbars [V] |
| Toolbar items prefer symbols without borders; text when there is no clear shorthand | HIG Toolbars, WWDC25 356 [V] |
| Shapes: fixed, capsule (radius = half the height) or concentric (parent radius minus padding); on phones "use a capsule with extra margin" near the screen edge | WWDC25 356 [V] |
| Bordered buttons are capsules by default in iOS 26; an extra-large control size exists | WWDC25 323, Adopting Liquid Glass [V] |
| Lists, tables and forms get larger rows and padding; sections get a larger corner radius; section headers are no longer forced to all caps | Adopting Liquid Glass [V] |

### 2.3 SwiftUI APIs (iOS 26.0 unless noted; this app targets iOS 17, so each needs `if #available(iOS 26, *)`)

| API | What it does | Source |
|---|---|---|
| `glassEffect(_ glass: Glass = .regular, in shape: some Shape)` | Glass behind a view; default regular in a capsule | glassEffect(_:in:) [V] |
| `Glass.regular`, `.clear`, `.identity`; `.tint(_:)`, `.interactive(_:)` | Variants; tint for prominence; interactive reacts to touch like system buttons | Glass, Applying Liquid Glass [V] |
| `GlassEffectContainer(spacing:)` | Renders several glass shapes together ("essential for visual correctness", "glass can not sample other glass") and lets them blend and morph | GlassEffectContainer, WWDC25 323 [V] |
| `glassEffectID(_:in:)`, `glassEffectTransition(.matchedGeometry / .materialize)`, `glassEffectUnion(id:namespace:)` | Morphing between glass shapes, materialize for distant shapes, one shape from several views | Applying Liquid Glass [V] |
| `.buttonStyle(.glass)`, `.buttonStyle(.glassProminent)` | Glass buttons without custom effects; prominent = tinted primary | PrimitiveButtonStyle glass / glassProminent [V] |
| `tabBarMinimizeBehavior(.automatic / .never / .onScrollDown / .onScrollUp)` | Tab bar shrinks while content scrolls under it | TabBarMinimizeBehavior [V] |
| `tabViewBottomAccessory { }` (iOS 26.0), `tabViewBottomAccessory(isEnabled:content:)` (iOS 26.1), `\.tabViewBottomAccessoryPlacement` | A persistent accessory above the tab bar, inline when minimized; for app-wide features (the Music mini player), not screen-specific actions | WWDC25 323, 356 [V] |
| `Tab(role: .search)` (iOS 18) + `.searchable` on the `TabView` | The search tab sits apart at the trailing end and turns into a search field | TabRole.search, WWDC25 323 [V] |
| `searchToolbarBehavior(.minimize)` | Bottom-toolbar search shown as a button until used | searchToolbarBehavior(_:) [V] |
| `scrollEdgeEffectStyle(_:for:)`, `scrollEdgeEffectHidden(_:for:)`, `ScrollEdgeEffectStyle.automatic / .soft / .hard` | Blur transition where content scrolls under floating controls | ScrollEdgeEffectStyle [V] |
| `safeAreaBar(edge:alignment:spacing:content:)` | A custom side bar that also extends scroll edge effects | safeAreaBar [V] |
| `backgroundExtensionEffect()` | Mirrors and blurs a view under sidebars; "with discretion", one instance | backgroundExtensionEffect() [V] |
| `presentationDetents(_:)`, `presentationBackgroundInteraction(.enabled(upThrough:))` | Sheet heights; interaction with the view behind | presentationDetents, presentationBackgroundInteraction [V] |
| `matchedTransitionSource(id:in:)` (iOS 18) + `.navigationTransition(.zoom(sourceID:in:))` | A sheet zooms out of the button that opened it | WWDC25 323 [V] |
| `ToolbarSpacer(.fixed / .flexible)`, `sharedBackgroundVisibility(.hidden)` | Split or ungroup toolbar items | ToolbarSpacer, WWDC25 323 [V] |
| `ConcentricRectangle`, `.rect(corner: .containerConcentric)` | Corners concentric with the container | ConcentricRectangle, WWDC25 323 [V] |
| `buttonSizing(_:)` | Flexible button widths | buttonSizing(_:) [V] |
| `UIDesignRequiresCompatibility` (Info.plist) | Opt out of the new look while on the new SDK; Apple warns it will stop working | Adopting Liquid Glass, Developer Forums 821539 [V] |

Performance: "Creating too many Liquid Glass effect containers and applying too many effects to views outside of
containers can degrade performance. Limit the use of Liquid Glass effects onscreen at the same time" (Applying Liquid
Glass to custom views) [V].

### 2.4 MapKit for SwiftUI

- Controls: `MapUserLocationButton`, `MapCompass`, `MapPitchToggle`, `MapScaleView`, usable inside `.mapControls { }`
  or standalone with `.mapScope(_:)` (MapUserLocationButton) [V]. Compass, scale and pitch toggle show and hide
  automatically; `mapControlVisibility(_:)` forces them (mapControlVisibility) [V].
- Emphasis: the default style is "fully saturated"; the muted style "presents a desaturated version of the map ...
  great if you have a lot of information-rich content that you want to stand out" (HIG Maps) [V]. This app already
  uses `.standard(elevation: .flat, emphasis: .muted, pointsOfInterest: .excludingAll)`.
- Legal: keep the Apple logo and Legal link visible; "if your app lets people pull up a custom card from the bottom of
  the screen, place the Apple logo and legal link 10 points above the lowest resting position of the card"; about 7 pt
  side and 10 pt vertical padding (HIG Maps) [V].
- Controls over a map need contrast: "Consider using a thin stroke or light drop shadow" (HIG Maps) [V].
- WWDC25 "Go further with MapKit" adds PlaceDescriptor, MapKit geocoding, cycling directions, Look Around in MapKit JS
  and one-line place cards (`mapItemDetailSelectionAccessory(.callout)`); it does not mention map controls or glass,
  and MapKit has no transit routing API for apps [V]. "Maps is a great example ... with their custom glass controls
  that gracefully float above the map content" (WWDC25 323) [V]; whether `MapUserLocationButton` and `MapCompass`
  render as glass on iOS 26 automatically is not documented [I: check in the CI gallery].

---

## 3. Apple Maps on iOS 26: layout

### 3.1 Reference description: the home screen (iPhone, portrait, light)

Described, not reproduced. Positions marked [V] come from the iPhone User Guide, [R] from AppleInsider's "Inside Apple
Maps in iOS 26".

```
┌────────────────────────────────────┐
│ 9:41               (Dynamic Island)│
│ (sun 18° AQI 32)                   │  weather and air quality, top left [R]
│                                    │
│        MAP, edge to edge,          │  blue dot with a translucent heading wedge [R]
│        under every control         │
│                                    │
│                              (3D)  │  2D/3D toggle near the cluster (some cities) [R]
│ (binoculars)              ┌──────┐ │  Look Around, bottom left [R]
│                           │ map  │ │  Map Modes (folded map; icon shows the mode) [V]
│                           │ ──── │ │
│                           │  ➤   │ │  location arrow, "lower right" [V]; outline when the dot is off screen [R]
│                           └──────┘ │
│ ╭────────────────────────────────╮ │  bottom sheet: a small grab bar [R], the search field "at the top
│ │             ───                │ │  of the card" [V], the profile photo "at the bottom of the screen" [V]
│ │ ( Search Maps            (mic))│ │  microphone in the field [R]
│ ╰────────────────────────────────╯ │  inset, glass, corners nested in the display corners [V: WWDC25 323]
└────────────────────────────────────┘
```

- Map Modes button: iOS 18 "at the top right of a map", iOS 26 "at the lower right", iOS 27 "at the right" (iPhone
  User Guide, three versions of "Set up Maps") [V]. Its glyph tells the current mode (Explore, Driving, Transit,
  Satellite); tapping opens a chooser closed with a Close button [V].
- Location button states: "Tracking Off" (tap to show your position), "Tracking On" (tap to show heading at the top),
  "Tracking On With Heading" (tap, or tap the Compass, to show north again) [V]. The compass appears when the map is
  rotated (two-finger twist) and resets north (AppleInsider) [R].
- Profile: "tap your user account photo at the bottom of the screen" (apple.com/maps) [V]; in iOS 27 Visited Places is
  reached by "tapping your profile picture, choosing Places" (MacRumors) [R]. The old Library is now "Places" [R].
- Expanded home sheet: Search, Siri Suggestions, Places (Home, Work, pinned), Recents, Your Guides, Profile
  (AppleInsider) [R]; "Below Places, tap Transit, then tap a nearby stop to see schedules and delays" and "Touch and
  hold a line, then tap Pin to put it at the top of the list" (iPhone User Guide, transit) [V].
- Translucency: "The search bar and navigation menu are translucent so you can see some of the Maps background behind
  it"; cards, menus and buttons are rounder; place icons larger (MacRumors) [R]. Reviewers found the change modest:
  Maps "looks similar to the iOS 18 version ... with more rounded interface elements and slightly more translucency"
  (MacRumors Liquid Glass guide) [R].
- [I] The lower-right cluster sits just above the card's top edge on the trailing side and moves with the card when it
  is dragged; it disappears when the card covers the map. Not documented; matches the HIG Maps rule that elements tied
  to the card should follow its lowest resting position. Verify on device.

### 3.2 Control inventory (Apple Maps iOS 26)

| Control | Position | Look | Evidence |
|---|---|---|---|
| Search field ("Search Maps") with microphone | Top of the bottom card | Field inside the glass card | [V] position, [R] mic |
| Profile photo | Bottom of the screen, beside the search field in the card | Circular photo | [V] "at the bottom of the screen"; [I] beside the field |
| Map Modes | Lower right | Glass, folded-map glyph that changes with the mode | [V] |
| Location (tracking) | Lower right, under Map Modes in one group | Glass, arrow; filled while following; heading variant | [V] states, [R] order |
| 2D/3D | Near the cluster where 3D data exists | Glass button | [R] |
| Compass | Appears when rotated, near the controls | Round compass | [R] |
| Look Around | Bottom left above the card (when imagery exists) | Glass binoculars button | [V] "near the bottom of a map", [R] bottom left |
| Weather + air quality | Top left | Small glass label; long press for forecast | [R] |
| Grab bar | Top of the card | Short capsule | [R] |
| Apple logo + Legal | Above the card's lowest resting position | System | [V] HIG Maps rule |

### 3.3 Light, dark and night

- Maps has light and dark map styles, and 3D landmarks "in both the day and dark mode maps" (apple.com/maps) [V].
- Glass in dark mode follows the appearance; small glass elements also flip with the content beneath them (WWDC25
  219) [V].
- Muted emphasis is the documented choice for apps that draw a lot of their own data over the map (HIG Maps) [V].

---

## 4. Apple Maps: sheets, place cards, search, directions, transit, navigation

### 4.1 The sheet (card)

| Aspect | Apple Maps / iOS 26 system sheet | Evidence |
|---|---|---|
| Detents | System sheets: medium (about half) and large, plus custom heights; Maps rests small (search only), medium and large | [V] HIG Sheets for detents; [I] Maps' three heights (long-standing behavior, not re-documented for iOS 26) |
| Grabber | "Include a grabber in a resizable sheet"; tap to cycle detents; works with VoiceOver | [V] HIG Sheets |
| Partial height | Inset from the screen edges, Liquid Glass, bottom corners nested in the display corners, content peeks around it | [V] WWDC25 323, Adopting Liquid Glass |
| Full height | Glass "gradually transitions, becoming opaque and anchoring to the edge of the screen"; "Liquid Glass subtly recedes, becoming more opaque and gently growing in size to signal a deeper level of engagement" | [V] WWDC25 323, 356 |
| Corner radius | "Sheets feature an increased corner radius"; exact value not published | [V] statement, [I] value |
| Content near corners | "check for content and controls that might appear too close to rounder sheet corners" | [V] Adopting Liquid Glass |
| Background interaction | Nonmodal sheets let people use the view behind; SwiftUI `presentationBackgroundInteraction` | [V] HIG Sheets, docs |
| Scrolling | "A resizable sheet expands when people scroll its contents or drag the grabber" | [V] HIG Sheets |
| Dismissal buttons | Single-view sheet: Cancel leading, Done trailing; never Cancel, Done and Back together; Done needs an alternative (Cancel, Back or swipe) | [V] HIG Sheets |
| Custom backgrounds | Remove `presentationBackground` and let the material show | [V] WWDC25 323 |

### 4.2 Place card

- Rich data (hours, phone, address), a row of action buttons, photos, ratings, guides (AppleInsider) [R]; in iOS 26
  "Call, Menu, and Website buttons sit more prominently at the top, and a floating directions button stays at the
  bottom right" (MacRumors) [R]; "A Share icon in the top left corner of the panel" (AppleInsider) [R].
- HIG Maps (place cards in apps): keep the location visible while the card shows; avoid duplicating information; the
  full callout style becomes a sheet on iPhone [V].
- Selected map element: "use distinct styling like an outline and color variation" (HIG Maps) [V].

### 4.3 Search and categories

- "Tap the search field and simply start typing, or tap a category below it, like Restaurants or Grocery Stores"
  (iPhone User Guide) [V]; results include attractions, restaurants and stations; recents, Find Nearby categories and
  City Guides fill the panel while searching (AppleInsider) [R]; iOS 27 adds Trending Restaurants and Local Lists [R].
- HIG Search fields: search as you type, show suggestions and recents, most relevant first, optional scope bar [V].
- iOS: "when a person taps a search field to give it focus, it slides upwards as the keyboard appears" (Adopting
  Liquid Glass) [V].

### 4.4 Directions and route options (transit)

- Entry: touch and hold the map or search, then "tap the directions button"; choose the travel mode with the Travel
  Mode button; "Tap Go or Steps for the route you want to take" (iPhone User Guide, transit) [V].
- Reference description (iPhone User Guide image text, iOS 26): "A map showing transit routes. The route card at the
  bottom provides details for the route, including estimated travel time and total cost. A Go button appears to the
  right of the details." [V]. Another: "A map showing several route options between two locations, with buttons for
  choosing other travel modes, switching the starting point and destination, and viewing directions as steps" [V].
- Options sit "below Directions": "Leave at" / "Arrive by", transit types, cash or card fares [V].
- Each transit option shows a "visual indicator of the different types of transport that will be used"; tapping an
  option gives the detailed breakdown (AppleInsider) [R].
- Route list while navigating: "Tap anywhere on the route card except the Go button" to see upcoming steps; Overview
  and Turn-by-Turn mode buttons (iPhone User Guide) [V].
- Real-time transit: "arrival and departure times, outages, current locations of buses and trains, and connections",
  "alerted when you're approaching your stop", pinned favorite lines (apple.com/maps) [V].
- [I] The Go button colour on iOS 26 (green on iOS 18) was not confirmed in a source.

### 4.5 Turn-by-turn navigation

- iOS 26: turn-by-turn directions appear in a "smaller pop-up bar" instead of covering the top of the screen;
  "arrival time, travel length, and distance are shown more prominently" (MacRumors) [R].
- "A section at the bottom will show the current ETA as well as let you exit navigation"; "Walking and public
  transport directions will give clearer instructions, rather than a full-blown satnav experience" (AppleInsider) [R].
- An incident report button sits on the right during navigation; new types: closures, traffic, roadwork (MacRumors,
  Apple iOS 26 feature list) [R], [V].
- The ETA display holds Add Stop, Share ETA and End Route (iPhone User Guide, CarPlay section) [V for CarPlay; I for
  the iPhone card].
- Rerouting: commute alerts "offer you an available alternate route, even if you didn't start navigating" (iOS 26
  feature list) [V]; the on-screen rerouting animation is not documented [I].

### 4.6 Alerts, toasts, menus

- "Alerts now expand from the button that initiates them" (iOS 26 feature list) [V]; action sheets originate from
  their source and let people interact elsewhere (Adopting Liquid Glass) [V]; menus "fluidly morph" out of buttons
  [V]. Time-boxed elements should be minimized; prefer explicit dismissal (HIG Accessibility) [V].

---

## 5. Motion

| Behavior | Detail | Evidence |
|---|---|---|
| Materialize | Glass appears and disappears by modulating lensing, not by fading | [V] WWDC25 219 |
| Morph | Glass shapes in one container blend when closer than its spacing and morph during transitions (`glassEffectID`, matchedGeometry; materialize for distant shapes) | [V] Applying Liquid Glass |
| Interactive response | Glass "responds to direct touch interaction with greater emphasis ... more subdued ... with a trackpad" | [V] HIG Motion |
| Toolbar items | "During navigation transitions, these items can even morph" | [V] WWDC25 256 |
| Tab bar | Floats; minimizes on scroll and re-expands on reverse scroll or tap; with an accessory, the accessory moves inline | [V] WWDC25 323, iOS 26 feature list |
| Tab selection | A capsule behind the selected tab; it slides to the new tab and swells into a lens while moving, can be dragged under a finger (third-party measurements of iOS 26.2 put the landing magnification near 1.16x) | [V] capsule (DTS); [R] lens and drag (GitHub reimplementations, Ryan Wesley) |
| Sheet | Grows and turns opaque as it rises; at small heights inset and glass | [V] WWDC25 323, 356 |
| Sheet from a button | Zoom transition out of the presenting toolbar item | [V] WWDC25 323 |
| Search field | Slides up with the keyboard | [V] Adopting Liquid Glass |
| Alerts, action sheets, menus | Spring out of their source button | [V] iOS 26 feature list, WWDC25 356 |
| Controls (sliders, toggles) | The knob turns into glass while dragged | [V] Adopting Liquid Glass |
| General | Purposeful, brief, cancellable; avoid motion on frequent interactions | [V] HIG Motion |

Reduce Motion (HIG Accessibility) [V]: tighten springs to reduce bounce, track gestures directly, avoid z-axis depth
animation, replace x / y / z transitions with fades, avoid animating into and out of blurs. For glass specifically,
Reduce Motion "decreases the intensity of some effects and disables any elastic properties" (WWDC25 219) [V].

---

## 6. Accessibility fallbacks

| Setting | System glass | Web equivalent | Evidence |
|---|---|---|---|
| Reduce Transparency | "frostier", "obscures more of the content behind it" | `prefers-reduced-transparency: reduce`: Chrome / Edge 118+, Samsung Internet 25+; **not Safari or iOS Safari through 27.2**; Firefox off by default | [V] WWDC25 219, caniuse, MDN |
| Increase Contrast | "predominantly black or white", "contrasting border" | `prefers-contrast: more`: Safari 14.1+, iOS Safari 14.5+, Chrome 96+, Firefox 101+ | [V] WWDC25 219, caniuse |
| Reduce Motion | Less intense effects, no elasticity | `prefers-reduced-motion: reduce` | [V] |
| Bright effects | iOS 26.4 "Reduce Bright Effects" tones down highlights and flashing on press | none | [R] AppleInsider via search |
| User glass level | iOS 26.1 Clear / Tinted; iOS 27 slider from "ultra clear to fully tinted" | none (a site cannot read it) | [R] MacRumors, 9to5Mac |
| Contrast | 4.5:1 up to 17 pt, 3:1 at 18 pt or bold; check light and dark; offer higher contrast under Increase Contrast if the default falls short | WCAG 2.x | [V] HIG Accessibility |
| Targets | at least 44 x 44 pt | same | [V] HIG Buttons |
| Labels | "Provide an accessibility label for every icon" | `aria-label` | [V] Adopting Liquid Glass |

Usability criticism worth designing against: NN/g found floating glass controls that "blend in with the images in the
background", a pale search that "tends to fade into the background", cramped tab bars "squeezed to make room for the
ever present search button", and controls that appear and disappear (NN/g) [R]; Six Colors noted distortion of text
under glass and inconsistent application [R]. heise reports iOS 27 "corrected some distracting transparency effects"
in Maps [R].

---

## 7. iOS 27 changes (shipping since September 2026)

- Material: "more effectively diffuses complex content"; a darkened edge around glass elements and brighter specular
  highlights (MacRumors) [R]; legible "even at maximum transparency" (9to5Mac) [R].
- A Liquid Glass slider in Settings, "ultra clear to fully tinted" [R].
- "A uniform toolbar now appears across the top" when content scrolls under floating bars, adjustable with the
  existing scroll edge effect APIs [R].
- Apps already using Liquid Glass get the improvements without recompiling [R].
- Maps: layout largely unchanged ("doesn't look drastically different", 9to5Mac) [R]; the User Guide's wording moves
  from "lower right" to "at the right" for the Map Modes button [V] (whether the cluster moved is not documented [I]).

Consequence for this app: a design that follows the system rules (regular glass on controls only, opaque content,
color on one primary background) inherits iOS 27's refinements for free on iPhone. The web copy cannot follow the
user's slider and must pick one fixed, legible level.

---

## 8. What this means for a web version (summary of the reasoning used in the spec)

- True lensing needs an SVG displacement filter inside `backdrop-filter: url(...)`, which only Chromium supports;
  Safari does not, so a lensing web copy would differ between iPhone Safari and Android. Use blur + saturation + a
  static specular rim instead (`box-shadow: inset ...`).
- `backdrop-filter` costs GPU time per blurred surface per frame whenever the map under it changes (panning, buses
  gliding). Keep blurred surfaces few and small, never blur an element that moves every frame (swap to a solid fill
  while it moves), and measure against the current build with the existing trace harness
  (`docs/redesign/NOTES-web.md` "Performance").
- iPhone Safari cannot report Reduce Transparency, so the default glass fill must pass WCAG AA by itself. The spec
  computes the minimum fill opacity over the worst possible backdrop with no blur (pure black under light glass, pure
  white under dark glass): primary text needs 50% (light) / 66% (dark), a darker secondary text 67% / 80%, accent
  icons at 3:1 74% / 76%; today's `label2` and accent text need 86 to 90%. Hence the spec's 80% glass fill with
  primary text, a glass-only secondary color and no accent-colored text on glass.
- `prefers-contrast: more` works on iPhone Safari: use it for solid glass with a border.

---

## 9. Sources

Primary (Apple). HIG pages were read through their public URLs' DocC data on 2026-11-03/04.

- HIG Materials: https://developer.apple.com/design/human-interface-guidelines/materials
- HIG Color (Liquid Glass color): https://developer.apple.com/design/human-interface-guidelines/color
- HIG Layout: https://developer.apple.com/design/human-interface-guidelines/layout
- HIG Sheets: https://developer.apple.com/design/human-interface-guidelines/sheets
- HIG Toolbars: https://developer.apple.com/design/human-interface-guidelines/toolbars
- HIG Tab bars: https://developer.apple.com/design/human-interface-guidelines/tab-bars
- HIG Search fields: https://developer.apple.com/design/human-interface-guidelines/search-fields
- HIG Buttons: https://developer.apple.com/design/human-interface-guidelines/buttons
- HIG Maps: https://developer.apple.com/design/human-interface-guidelines/maps
- HIG Motion: https://developer.apple.com/design/human-interface-guidelines/motion
- HIG Accessibility: https://developer.apple.com/design/human-interface-guidelines/accessibility
- Liquid Glass overview: https://developer.apple.com/documentation/technologyoverviews/liquid-glass
- Adopting Liquid Glass: https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass
- Applying Liquid Glass to custom views: https://developer.apple.com/documentation/swiftui/applying-liquid-glass-to-custom-views
- glassEffect(_:in:): https://developer.apple.com/documentation/swiftui/view/glasseffect(_:in:)
- Glass: https://developer.apple.com/documentation/swiftui/glass
- GlassEffectContainer: https://developer.apple.com/documentation/swiftui/glasseffectcontainer
- glassEffectID(_:in:): https://developer.apple.com/documentation/swiftui/view/glasseffectid(_:in:)
- glassEffectTransition(_:): https://developer.apple.com/documentation/swiftui/view/glasseffecttransition(_:)
- glassEffectUnion(id:namespace:): https://developer.apple.com/documentation/swiftui/view/glasseffectunion(id:namespace:)
- Button style glass: https://developer.apple.com/documentation/swiftui/primitivebuttonstyle/glass
- Button style glassProminent: https://developer.apple.com/documentation/swiftui/primitivebuttonstyle/glassprominent
- tabBarMinimizeBehavior(_:): https://developer.apple.com/documentation/swiftui/view/tabbarminimizebehavior(_:)
- TabBarMinimizeBehavior: https://developer.apple.com/documentation/swiftui/tabbarminimizebehavior
- tabViewBottomAccessory(isEnabled:content:): https://developer.apple.com/documentation/swiftui/view/tabviewbottomaccessory(isenabled:content:)
- TabRole.search: https://developer.apple.com/documentation/swiftui/tabrole/search
- searchToolbarBehavior(_:): https://developer.apple.com/documentation/swiftui/view/searchtoolbarbehavior(_:)
- ScrollEdgeEffectStyle: https://developer.apple.com/documentation/swiftui/scrolledgeeffectstyle
- scrollEdgeEffectStyle(_:for:): https://developer.apple.com/documentation/swiftui/view/scrolledgeeffectstyle(_:for:)
- safeAreaBar(edge:alignment:spacing:content:): https://developer.apple.com/documentation/swiftui/view/safeareabar(edge:alignment:spacing:content:)
- backgroundExtensionEffect(): https://developer.apple.com/documentation/swiftui/view/backgroundextensioneffect()
- presentationDetents(_:): https://developer.apple.com/documentation/swiftui/view/presentationdetents(_:)
- presentationBackgroundInteraction(_:): https://developer.apple.com/documentation/swiftui/view/presentationbackgroundinteraction(_:)
- matchedTransitionSource(id:in:): https://developer.apple.com/documentation/swiftui/view/matchedtransitionsource(id:in:)
- ToolbarSpacer: https://developer.apple.com/documentation/swiftui/toolbarspacer
- ConcentricRectangle: https://developer.apple.com/documentation/swiftui/concentricrectangle
- buttonSizing(_:): https://developer.apple.com/documentation/swiftui/view/buttonsizing(_:)
- MapUserLocationButton: https://developer.apple.com/documentation/mapkit/mapuserlocationbutton
- mapControlVisibility(_:): https://developer.apple.com/documentation/swiftui/view/mapcontrolvisibility(_:)
- WWDC25 219 Meet Liquid Glass: https://developer.apple.com/videos/play/wwdc2025/219/
- WWDC25 356 Get to know the new design system: https://developer.apple.com/videos/play/wwdc2025/356/
- WWDC25 323 Build a SwiftUI app with the new design: https://developer.apple.com/videos/play/wwdc2025/323/
- WWDC25 256 What's new in SwiftUI: https://developer.apple.com/videos/play/wwdc2025/256/
- WWDC25 204 Go further with MapKit: https://developer.apple.com/videos/play/wwdc2025/204/
- iPhone User Guide, Set up Maps, iOS 18: https://support.apple.com/guide/iphone/set-your-location-and-map-view-iph10d7bdf26/18/ios/18
- iPhone User Guide, Set up Maps, iOS 26: https://support.apple.com/guide/iphone/set-your-location-and-map-view-iph10d7bdf26/26/ios/26
- iPhone User Guide, Set up Maps, iOS 27: https://support.apple.com/guide/iphone/set-up-maps-iph10d7bdf26/27/ios/27
- iPhone User Guide, Get transit directions (iOS 26 / 27): https://support.apple.com/guide/iphone/get-transit-directions-ipha44f57caa/26/ios/26
- iPhone User Guide, Get walking directions: https://support.apple.com/guide/iphone/get-walking-directions-iph8eae299d1/27/ios/27
- iPhone User Guide, Find nearby: https://support.apple.com/guide/iphone/find-nearby-attractions-restaurants-services-iphbaf51b2c0/27/ios/27
- iPhone User Guide, Route overview / list of turns: https://support.apple.com/guide/iphone/view-a-route-overview-or-a-list-of-turns-iph1b3553719/27/ios/27
- iPhone User Guide, Get started with Maps: https://support.apple.com/guide/iphone/get-started-with-maps-iph6ef6ef377/ios
- iPhone User Guide, CarPlay turn-by-turn: https://support.apple.com/guide/iphone/get-turn-by-turn-directions-iph215b053f6/27/ios/27
- apple.com Maps: https://www.apple.com/maps/
- New features available with iOS 26 (PDF): https://www.apple.com/os/pdf/All_New_Features_iOS_26_Sept_2025.pdf
- Apple Developer Forums 821539 (tab bar capsule): https://developer.apple.com/forums/thread/821539

Secondary.

- AppleInsider, Inside Apple Maps in iOS 26: https://appleinsider.com/inside/apple-maps/tips/inside-apple-maps---how-to-get-the-most-out-of-your-iphones-navigation-app
- MacRumors, Apple Maps in iOS 26: https://www.macrumors.com/guide/ios-26-maps/
- MacRumors, iOS 26 Liquid Glass guide: https://www.macrumors.com/guide/ios-26-liquid-glass/
- MacRumors, How Liquid Glass is changing in iOS 27: https://www.macrumors.com/2026/06/10/how-liquid-glass-is-changing-in-ios-27/
- MacRumors, iOS 27 Maps: https://www.macrumors.com/guide/ios-27-maps/
- 9to5Mac, Everything new for Apple Maps in iOS 26: https://9to5mac.com/2025/09/18/heres-everything-new-for-apple-maps-in-ios-26/
- 9to5Mac, Everything new for Apple Maps in iOS 27: https://9to5mac.com/2026/09/24/heres-everything-new-for-apple-maps-in-ios-27/
- 9to5Mac, iOS 27 fixes Liquid Glass: https://9to5mac.com/2026/06/12/ios-27-fixes-liquid-glass-and-not-just-with-a-slider/
- heise, Apple Maps in iOS 27: https://www.heise.de/en/news/Apple-Maps-UI-Overhaul-and-New-Features-in-iOS-27-macOS-27-and-More-11332422.html
- Six Colors, iOS 26 review: https://sixcolors.com/post/2025/09/ios-26-review-through-a-glass-liquidly/
- NN/g, Liquid Glass Is Cracked: https://www.nngroup.com/articles/liquid-glass/
- Donny Wals, Exploring tab bars on iOS 26: https://www.donnywals.com/exploring-tab-bars-on-ios-26-with-liquid-glass/
- Nil Coalescing, Presenting Liquid Glass sheets: https://nilcoalescing.com/blog/PresentingLiquidGlassSheetsInSwiftUI/
- Ryan Wesley, My beef with the iOS 26 tab bar: https://ryanwesley.com/ios-26-tab-bar-beef/
- GitHub cuappdev/resell-ios PR 130 (sliding lens modeled on the system bar): https://github.com/cuappdev/resell-ios/pull/130
- caniuse, prefers-reduced-transparency: https://caniuse.com/mdn-css_at-rules_media_prefers-reduced-transparency
- caniuse, prefers-contrast: https://caniuse.com/mdn-css_at-rules_media_prefers-contrast
- caniuse, backdrop-filter: https://caniuse.com/css-backdrop-filter
- MDN, prefers-reduced-transparency: https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-transparency

Not found in any source (left as [I] above): exact sheet corner radii and insets, the tab bar height, whether Maps'
cluster rides the card, the Go button colour on iOS 26, Maps' transit navigation card layout, and whether MapKit's
SwiftUI controls are glass by default.
