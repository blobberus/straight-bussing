# Straight Bussing: UI Design Spec

> v2 note: file names below (`style.css`, `app.js`, `theme.js`, `mapstyle.js`) are the v1 files this spec was written against (tag `v1-final`). In v2 the same rules live in `web/css/*.css`, `web/js/ui/theme.js` and `web/js/map/style.js`; see `docs/ARCHITECTURE.md`.

## Taste notes (research summary)

- Sources: taste-skill (third-party, reference only), Apple HIG Maps, Eleken bottom-sheet guide, UXPin map UI, OpenFreeMap docs/styles. Web search returned little Citymapper-specific detail; its patterns below come from general knowledge, unverified.
- Taken from taste-skill: one accent, one radius scale, real states (loading/empty/error), tactile :active, 100dvh, contrast checks. Ignored: landing-page rules (hero, eyebrows, bento, Tailwind/React stack, marketing motion); they do not fit a mobile map tool.
- Apple Maps: non-modal bottom sheet over a map that stays interactive; the map reframes when the sheet moves; labels fade by importance as zoom changes.
- Citymapper: the line color is the identity; dense but quiet chrome; big ETA numerals; the map shows only what the task needs.
- Map labels: contrast against the land matters more than size; a 2px halo in the land color keeps text readable over casings; minor streets appear only from z14+, house numbers from z16.5.
- OpenFreeMap: styles at tiles.openfreemap.org/styles/{positron,bright,liberty,dark} (OpenMapTiles schema, glyphs "Noto Sans Regular/Bold/Italic" only; no Medium). positron and dark have NO house numbers or POIs and dark's street names are near-invisible (#504e4e on black), so we patch them at runtime (see "Map style changes"). bright/liberty are busier (POI icons, 3D); not used.
- Theme: Auto/Light/Dark via theme.js; CSS honors [data-theme] first, then prefers-color-scheme.
- Nothing installed; no other design-taste skills were adopted.

Direction: Apple Maps / Citymapper. The map is the product; chrome is quiet, white-space heavy, one accent. No gradients, no glow, no emoji icons, no card-in-card. Route colors are the only saturated color on screen. Unofficial: never use UChicago names/logos/maroon as a brand cue.

## 1. Tokens (put in `:root` / `@media (prefers-color-scheme: dark)` in style.css)

| Token | Light | Dark |
|---|---|---|
| --bg (sheet) | #FCFCFD at 86% + blur(24px) saturate(1.8) | #1C1C1E at 82% + same blur |
| --bg-solid (fallback, no backdrop-filter) | #FCFCFD (off-white, never pure #FFF) | #1C1C1E |
| --surface (rows, chips) | #F2F2F7 | #2C2C2E |
| --text | #111114 | #F5F5F7 |
| --text-2 | #5C5C63 (6.4:1) | #A1A1A8 (6.9:1) |
| --hairline | rgba(60,60,67,.18) | rgba(84,84,88,.55) |
| --accent (actions, location dot) | #0A84FF -> use #0066D6 for text on light (5.6:1) | #409CFF |
| --live (real-time pulse/ETA "Now"; ONLY live data) | #1E9E4A | #32D74B |
| --warn (stale, alerts) | #B25E00 on #FFF4E0 | #FFB340 on #3A2A10 |
| --danger (error text) | #C4291C | #FF6961 |
| --danger-fill (red fills: Delete, count badge; white text 5.7:1) | #C4291C | #C4291C |

Route colors come from GTFS `route_color`. Guarantee label contrast: pick white or #111 text by luminance; if a route color is under 3:1 against the sheet, draw its chip with a 1.5px --text-2 ring.

Type: `font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, "Segoe UI", Roboto, sans-serif; font-variant-numeric: tabular-nums` on all times. Use `"SF Pro Rounded"` ui-rounded only for the big ETA numeral.

| Role | Size/line | Weight | Tracking |
|---|---|---|---|
| Large title (sheet header) | 28/34 | 700 | -0.02em |
| Title (stop name) | 20/25 | 650 | -0.01em |
| ETA numeral | 34/36 | 700 (rounded, tabular) | -0.02em |
| Row primary | 17/22 | 590 | 0 |
| Body / secondary | 15/20 | 400, --text-2 | 0 |
| Caption / chip | 12/16 | 600 | +0.01em |

Max 3 sizes per screen. No all-caps labels except chips.

Spacing: 4pt grid: 4, 8, 12, 16, 20, 24. Sheet side padding 16. Row height min 56. Radii: see "Radius scale" below. Shadows: sheet `0 -8px 32px`, floating controls `0 2px 10px`, plus the small component shadows (segment thumb, switch knob, timeline bus chip, Settings card), all tinted with `--shadow-rgb` (cool slate 30, 32, 45; never `rgba(0,0,0)`) through the `--shadow-*` tokens; dark mode swaps the sheet / floating shadows for a 1px --hairline border. No other shadows.

Motion: durations 120 (press/fade), 220 (content swap), 320 (sheet settle). Easing: `cubic-bezier(.2,.8,.2,1)` for enters, `cubic-bezier(.4,0,1,1)` exits; sheet release uses a spring approximation `cubic-bezier(.32,.72,0,1)` 320ms. Animate only `transform` and `opacity`. Press state: scale(.98) + --surface darken. Live pulse on bus dot: one 2s ring, off under reduced motion.

## 1b. System rules (set by the taste audit, docs/DESIGN-AUDIT-2026-10-10.md; `css/tokens.css` holds the values)

**Color lock.** One accent (`--accent` text / `--accent-fill` fills) for every action, selection and switch. Green (`--live`)
means live GPS / prediction data and nothing else (no green switches, no green "Scheduled now"). Route colors are data,
never decoration or accent. Red fills use `--danger-fill`; `--danger` is for error text. Gold (the `--warn` hue) is also the
favorite star, always with the star shape. No pure #000 / #fff surfaces or shadows: light surfaces are #FCFCFD, shadows and
scrims use `--shadow-rgb`. White is allowed only as text / marks on a saturated fill (accent, danger, route color) and as map
marker rings. Every button, toggle, tag and placeholder is >= 4.5:1 in light and dark (`tests/ui-shell-contrast.js`).

**Radius scale** (tokens; never a literal radius in a component, focus rings follow their element):

| Token | px | Used for |
|---|---|---|
| `--r-pill` | 999 | search bar, nav indicator, toggles (Favorite, Highlight), switches, count badges, pills, grabber |
| `--r-sheet` | 20 | sheet, Settings card, dialogs |
| `--r-card` | 14 | cards, option cards, alert banners |
| `--r-control` | 12 | buttons, inputs, segmented controls, locate button, status pill, context chip |
| `--r-inner` | 10 | a control nested 2-3 px inside a 12 px control: segment thumb, Clear, Retry |
| `--r-badge` | 9 | route badge, the same shape as the bus marker (route identity) |
| `--r-tag` | 6 | est. / live / sidewalk route tags, small route chips, bus chips on timelines |

Data marks (chart bars, the 8 px legend square, the switch's on mark) and the desktop phone frame keep their own radii.

**Layers** (z-index tokens; a component may use 1 / 2 locally):

| Token | z | Layer |
|---|---|---|
| `--z-map` | 0 | map (Leaflet panes stack inside it) |
| `--z-sheet` | 1000 | bottom sheet |
| `--z-nav` | 1010 | bottom navigation |
| `--z-chip` | 1090 | map context chip |
| `--z-float` | 1100 | status pill, locate button |
| `--z-search` | 1105 | floating search bar |
| `--z-overlay-scrim` / `--z-overlay` | 1140 / 1150 | Settings scrim / card |
| `--z-dialog` | 1200 | `#dlg` scrim + card |
| `--z-demo` | 1250 | demo-mode banner (`?demo=1` only; above dialogs and Settings so it is on every screen) |
| `--z-toast` | 1300 | toast |
| `--z-frame` | 5000 | desktop phone frame decorations (never take taps) |

**Copy.** No em dash or en dash anywhere in visible text: clock ranges read "4:00 PM to 4:29 AM", compact day ranges
"Mon-Fri". At most one middle dot per line; more parts become a sentence (commas) or separate lines. Plain functional
sentences; name tabs by their current label ("Current trip"). One label per intent on a screen (one "use my location"
action, not a suggestion plus a button). Button labels fit on one line at 393 px; stack buttons instead of wrapping a label.

**States and feedback.** Loading skeletons have the shape of the rows they stand in for (`skeleton()`: route badge, two
lines, ETA). Every control has a press state: text buttons dim, icon buttons take the pressed fill, buttons / rows / toggles /
segments scale .97-.98 (opacity only under reduced motion). Every target is >= 44 px (extend small ones with `::after`).

## 2. Map

- Basemap (CARTO raster now needs a key, superseded): OpenFreeMap vector tiles through `web/mapstyle.js` (positron light / dark), see "Map style changes". OSM raster is only an emergency fallback (heavy use is against OSM tile policy). If traffic grows, self-host (Protomaps PMTiles).
- Zoom 13-18, start 15 on user or campus center. Disable Leaflet zoom control (pinch only); add one 44px locate button (floating, top-right under safe-area, 12 radius, --bg-solid) and nothing else.
- Route lines: weight 5 at z15 (4 at z13, 6 at z17), round caps/joins, opacity .9, 2px white casing underneath (weight+3, light rgba(255,255,255,.9), dark rgba(28,28,30,.9)). Overlapping routes: offset not needed; draw selected route last, dim others to .25 when a route is selected.
- Stops: 10px circle, white fill, 2.5px stroke in route color (neutral --text-2 when multi-route); hidden below z14; selected stop = 16px with accent ring and name label. Tap target extended to 44px with a transparent halo (`L.circleMarker` radius 22, fillOpacity 0).
- Buses: 28px rounded-square badge (radius 9) in route color, white bold route short name (12px), 2px white border, shadow-sm, small heading triangle (8px) on the edge that rotates with bearing. Move smoothly: interpolate between polls via CSS `transition: transform 9s linear` on marker. Stale bus (>60s old): 50% opacity, gray border.
- User location: 14px --accent dot, 3px white ring, soft accuracy circle at 12% accent.
- Map padding: when sheet is at half detent, `map.fitBounds(..., {paddingBottomRight:[0, sheetHeight]})` so selection stays visible.

## 3. Bottom sheet

- Three detents (of visual viewport height minus top safe-area): **peek** 112px + safe-bottom (grabber, search/title line, nearest-stop one-liner), **half** 46%, **full** top = safe-top + 56px (map still peeks, 20 radius).
- Grabber 36x5, radius 3, --hairline-strong, centered, 8px from top; its hit area is the full 44px header.
- Drag via Pointer Events on header (any area when content scrollTop is 0); set `touch-action: none` on header, `overscroll-behavior: contain` on content. Content scrolls only at full detent. Move with `transform: translateY()`, no layout thrash.
- Release: project velocity (px/ms * 200) onto position, snap to nearest detent; flick >0.5 px/ms goes one detent in that direction. Rubber-band 0.3 resistance past ends. Tap on peek expands to half. Back/Escape steps down one detent.
- Selecting a stop or route: sheet goes to half, map flies to it. Closing returns to prior detent.
- Safe areas: `padding-bottom: max(16px, env(safe-area-inset-bottom))`, top controls `top: calc(env(safe-area-inset-top) + 12px)`; viewport `viewport-fit=cover`; use `100dvh`. Landscape / width >=768: sheet becomes a 380px left floating panel (radius 20, 12px inset), no detents.
- Navigation: replace the current tab panels with a 3-item segmented control inside the sheet header at half/full only (Nearby, Routes, Alerts, with a numeric badge on Alerts). "About" moves to a small "i" row at the bottom of Alerts. No bottom tab bar.

## 4. Screens

**Home (Nearby)**. Peek: "Nearest stop" name 17/590 plus walking time and next ETA numeral right-aligned. Half: nearest-stop card (stop name, distance, up to 3 departures as rows), then "Also nearby" 2 more stops as compact rows. No location permission: show a single "Use my location" accent button and the campus stops list sorted alphabetically.
**Stop detail**. Header: stop name (title), back chevron, route chips. List of arrivals sorted by time: row = route chip (28px badge), headsign (17/590), "Live" dot or "Scheduled" label (--text-2), ETA right-aligned: "4" numeral 34pt with "min" 12pt beneath; "Now" in --live; under 1 min "Arriving". Divider hairline inset 60px. Tap row highlights that bus on the map. Footer: "Last updated 8s ago".
**Routes**. List of routes: color chip, long name, and "N buses running" or "Not running". Group Running above Not running. Search field (44px, --surface, radius 12) only at full detent.
**Route detail**. Chip + name header, status line, then vertical stop timeline: 4px colored line, stop dots, stop names, per-stop next ETA right-aligned, bus icons inline where buses are between stops. Map shows only this route; "Show all" chip to reset.
**Alerts**. Rows: severity icon (SVG), title 17/590, 2-line body, relative time. Unread/active tint --warn background at 8%. Same alerts show as a single dismissible banner pill at top of map (max 1 line) only when affecting a route that is running.

## 5. States

- Loading: skeleton rows (--surface, 1.2s shimmer opacity .6-1; static under reduced motion). Never a spinner on a blank sheet.
- Empty (no service): "No shuttles running right now" + next service start time if known + link "Official schedule". Show the route list dimmed. Only when the schedule agrees: if the feed is fresh but empty while a route is scheduled, say "No live locations right now" / "Scheduled, no live location" and name the scheduled routes and end times instead (`docs/ARCHITECTURE.md` "2026-10-10").
- No arrivals at stop: "No upcoming arrivals" with the last scheduled time.
- Stale (feed >60s old): amber pill under header: "Live data delayed. Times may be off." ETAs switch to --text-2 and gain "~". After 5 min: replace live badges with "Scheduled" and show "Last live update 6:42 PM".
- Status pill icons (2026-10-10, iOS parity): feed error = wifi off, delayed / out of date = clock with an alert mark, no live locations while routes are scheduled = antenna off, no shuttles running = bus. Always with the words.
- Demo mode (`?demo=1`): a solid `--warn` strip with `--bg-solid` text above the search bar on every screen, "Demo mode: simulated buses" + Exit demo; the layout moves down by `--demo-h`.
- Offline/error: sheet keeps last good data, shows --danger-tinted banner "Can't reach the shuttle feed. Retrying" with Retry button (44px). Never clear lists on a failed poll.
- Permission denied (location): inline, one line, explains how to enable; app stays fully usable.
- Footer everywhere in About: "Unofficial. Not affiliated with the University. Official app / 773.702.8181."

## 6. Accessibility

- Text contrast >= 4.5:1, UI/graphics >= 3:1 in both themes (values above checked). Never convey status by color alone: pair with text ("Live", "Scheduled") or shape.
- Touch targets >= 44x44 (chips can be 28px visually with padded hit area). 8px min gap.
- `@media (prefers-reduced-motion: reduce)`: remove pulse, shimmer, bus glide; sheet snaps with 120ms fade only.
- Sheet is `role="dialog"` non-modal; the grabber is an adjustable control (2026-10-10, iOS parity): `role="slider"`, `aria-label="Resize panel"`, values Collapsed / Half / Expanded (`aria-valuetext`); arrows and Page Up / Down step, Home = Collapsed, End = Expanded, Enter / Space and taps cycle. Visible `:focus-visible` 2px accent outline offset 2.
- ETA rows: single `aria-label`, e.g. "Route 6, to Campus North, arrives in 4 minutes, live". `aria-live="polite"` only on the stale/error banner, not on ETA updates.
- Support Dynamic Type via `rem` sizes; layout must hold at 200% text. Respect `prefers-contrast: more` (hairline -> solid, drop blur).

## 7. Implementation checklist (priority order)

1. **style.css tokens**: add the `:root` + dark variables, system font stack, tabular-nums; replace all hardcoded colors/radii. (P0)
2. **Basemap** (app.js line ~12): swap Voyager for Positron/Dark Matter with matchMedia listener; keep attribution. (P0)
3. **Markers** (`drawStatic`, `drawBuses`): route casing + widths, stop circle with 44px halo, bus badge with heading, glide transition, stale styling. (P0)
4. **index.html**: add `viewport-fit=cover`, `theme-color` meta for both schemes; restructure `#sheet` into header (grabber + title/peek line + segmented control) and scrolling content; keep ids used by app.js. (P0)
5. **Sheet behavior**: new `initSheet()` in app.js with pointer-event drag, three detents, velocity snapping, `--sheet-y` CSS var; remove tab-bar styling. (P0)
6. **Arrivals UI** (`renderArrivals`, `fmtEta`): ETA numeral + unit, Live/Scheduled label, route badge rows, nearest-stop card in `nearestStops(n)`. (P1)
7. **Stop detail + selection** (`selectStop`): half detent, flyTo with padding, highlight bus on row tap. (P1)
8. **Routes list + route detail** (`renderRoutes`): running/not-running groups, stop timeline, dim others on selection. (P1)
9. **States**: skeletons, empty, stale amber pill (`renderBanner`), error banner preserving last data, location-denied copy. (P1)
10. **Alerts** (`renderAlerts`): row design, badge count in `#alertCount`, map banner only for running routes. (P2)
11. **A11y pass**: aria labels, focus rings, reduced-motion media query, 200% text check, contrast spot-check with devtools. (P2)
12. **Tablet/landscape** floating side panel at >=768px; bump `sw.js` cache version so new CSS ships. (P2)
13. Final QA on iPhone Safari standalone mode: safe areas, rubber-banding, address bar collapse, dark mode toggle. (P2)

## Map style changes (web/mapstyle.js)

Fetches the OpenFreeMap style (`positron` or `dark`), deep-clones it and patches by layer id (cached per theme; an empty background-only style shows until it loads):
- `background`, `water`, `park`, `building`: muted palette per theme (light land #eef0ec, dark #161618); building outline stronger.
- `highway_minor`: wider (z13 1.5 -> z18 12px), round caps; NEW `sb_minor_casing` layer beneath it for road/land contrast.
- `highway_major_casing`, `highway_major_inner`, `highway_path`: recolored, wider, higher-contrast casing.
- `highway-name-*` (positron) / `highway_name_other` (dark): size 10.5-15 by zoom, majors Noto Sans Bold, no uppercase, text #2f3036 / #e8e8ee, 2px halo in land color, minzoom 14 minor, 12.5 major, 16 path, denser spacing. Motorway refs untouched.
- `highway-shield-*`, `road_shield_us`: hidden (clutter).
- NEW `sb_housenumber` (source-layer `housenumber`, z16.5+, size 10-14) and `sb_poi_campus` (source-layer `poi`, z15.5+, only college/school/hospital/library/stadium/museum/theatre, text only, bold). Both are inserted below the street-name layers so street names win collisions.
- Raster fallback (no maplibre): OSM tiles, CSS-inverted in dark (`.tiles-dark`).
Limitation: headless Edge does not paint WebGL tiles, so legibility was not confirmed visually; the patched style loads in maplibre 4.7.1 with no style errors.

## Integration for app.js

index.html already loads theme.js and mapstyle.js before app.js. Replace the `dark`/`setTiles` block with:
```js
let tiles = MapStyle.create(map, Theme.isDark());
tiles.addTo(map);
Theme.onChange((isDark) => MapStyle.update(tiles, isDark));
```
`Theme.onChange` fires for system changes while in Auto and for manual Light/Dark. Settings UI: `Theme.mount(someElement)` renders a `.themeseg` control (styled in style.css). `Theme.get()` returns "auto" | "light" | "dark". Also add theme.js and mapstyle.js to SHELL in sw.js and bump the cache version.
