# Design-taste audit, web app (2026-10-10)

Scope: the web interface in `web/` (not `ios/`). Rules: `docs/DESIGN.md` first (it wins over generic advice), then only the
universal rules of the third-party taste skill (`.claude/skills/taste-skill/SKILL.md`). The skill says it is not for dense
product UI / native mobile (its section 13), so its landing-page rules (hero, bento, eyebrows, imagery, fonts) do not apply.

- **Design read:** transit utility for UChicago riders on phones, Apple Maps / Citymapper language, native CSS tokens; trust-first.
- **Dials:** DESIGN_VARIANCE 3, MOTION_INTENSITY 3, VISUAL_DENSITY 6.
- **Rules applied:** zero em/en-dash separators (9.G), copy self-audit (4.9), color consistency lock (one accent; route colors
  are data, not accent), shape/radius lock (documented rule), button/form contrast WCAG AA in light and dark, no CTA wraps,
  no duplicate CTA intent per screen, composed empty/loading/error states (skeletons match the layout), tactile `:active`,
  dots only for real state, no pure #000/#fff surfaces, tinted shadows, reduced motion, documented z-index scale, one icon
  family, safe areas, 44 px targets.
- **Ship-checklist order still rules** (CLAUDE.md): rider safety > correct times > speed > intuitive UI > accessibility >
  privacy > App Store portability. Nothing below trades a higher item for a lower one.

## Method

The real `index.html` was served from a scratch worktree with the e2e stubs (`web/tests/e2e-stubs.js`: synthetic live feed
built from the real static data, stubbed geolocation, an active service alert) plus a small scene driver, and captured in
headless Edge inside the desktop phone frame (393 x 852 CSS px, emulated safe areas 54 / 34 px, 2x), light and dark. 30
scenes x 2 themes: Current trip (half / full / scrolled / peek / with location / trip in progress), Routes (list, scrolled,
map-order editor), route detail (top, hours), stop, My Routes (empty, filled, swipe tray, delete confirm, custom route detail,
editor), applied custom route (context chip), Directions (empty, suggestions, planned + open option), Routes to station
dialog, Settings overlay (top, scrolled), About, Alerts, feed error, empty feed during scheduled service, loading. Plus a CSS
sweep (every literal `border-radius`, `z-index`, shadow, pure color, `:active`) and a string sweep of every view module.
Headless Edge paints vector map tiles only sometimes; the UI and map overlays always paint.

## Status

Every finding below is **fixed** except the ones under "Left deliberately". Commits (all "Design: ..." on main, 2026-10-10):

| Commit subject (abbreviated) | Findings |
|---|---|
| no dash characters or stacked middle dots in visible text; plainer copy | 1.1-1.3, 2.1-2.5, 15.1, 15.2 |
| one accent, green only for live data; red fills pass AA in dark | 3.1-3.3, 4.1, 10.1 |
| one radius scale and one z-index scale, as tokens | 5.1-5.4, 12.1 |
| off-white surfaces, tinted shadows and scrims | 11.1-11.3 |
| press feedback on every control; 44px appearance segments and official links | 9.1, 14.1, 14.2 |
| loading skeleton shaped like the rows it stands in for | 8.1 |
| one location action in Directions, no wrapped About CTA, SVG star | 6.1, 7.1, 13.1 |

The rules are now written down in `docs/DESIGN.md` "1b. System rules" (color lock, radius scale, layers, copy, states).
New regression tests: button / toggle / tag / badge / placeholder contrast in both themes (46 measurements,
`ui-shell-contrast.js`), no dash in the route view and alert period, at most one middle dot per step line and place
subline, row-shaped skeleton, one "use my location" action in Directions.

### Before / after (same scenes, light + dark)

- Route detail: "Today 4:00 PM – 4:29 AM · ●Scheduled now" (green) became "Today 4:00 PM to 4:29 AM · Scheduled now" in
  plain text; the hours card reads "Every day 4:00 PM to 4:29 AM"; buses-by-hour is four short lines instead of one line
  with three dots and en-dashes.
- Directions bus step: three middle dots became "Wait ~5 min, then ride ~4 min (2 stops) to S. Drexel Ave & E 53rd St,
  3:41 AM · from live bus prediction"; "No walk: get off at X" became "Get off at X, no walk needed".
- Directions with no location: the "My location / Allow location access" row under the focused destination is gone; only
  "Start from my location" remains.
- My Routes delete confirm (dark): Delete was white on salmon #ff6961 (hard to read), now white on #c4291c; the swipe-tray
  Delete and the alert count badge use the same red.
- Settings: the lock-screen switch is accent blue (was green); alert period "6:20 AM to 8:20 AM".
- About: "Call 773.702.8181" and "Official transportation page" are two full-width buttons; the second no longer wraps.
- Applied custom route: the context chip has the 12 px corners of the locate button next to it.
- Loading: three gray bars became three placeholder rows (badge, two lines, ETA) on the same 56 px rhythm.

## Findings

### 1. Em-dash / en-dash ban (skill 9.G)

| # | Screen | Evidence | Fix |
|---|---|---|---|
| 1.1 | Route detail, status line and Hours card | "Today 4:00 PM – 4:29 AM", "Mon–Fri" (`core/schedule.js` `DASH`) | Clock ranges read "4:00 PM to 4:29 AM"; day ranges "Mon-Fri" |
| 1.2 | Route detail, "Scheduled buses by hour" text | "4 PM–5 PM: 2 buses · 5 PM–9 PM: 1 bus · ..." (`route.js`) | One line per group: "4 PM to 5 PM: 2 buses" (also fixes 2.2) |
| 1.3 | Settings, Service alerts | alert period "2:31 AM – 4:31 AM" (`settings.js`) | "2:31 AM to 4:31 AM" |

Feed text (alert headers, stop names) is shown as published; none of the bundled data files contain a dash character.

### 2. Middle-dot rationing (skill 9.F: max one per line)

| # | Screen | Evidence | Fix |
|---|---|---|---|
| 2.1 | Directions, open option, bus step | "Wait ~5 min · Ride ~4 min to S. Drexel Ave & E 53rd St (3:41 AM) · 2 stops · from live bus prediction" (3 dots) | "Wait ~5 min, then ride ~4 min (2 stops) to S. Drexel Ave & E 53rd St, 3:41 AM · from live bus prediction" |
| 2.2 | Route detail, buses by hour | four groups joined by " · " | list, one group per line (1.2) |
| 2.3 | Directions, option card label | "Least walking · Earliest arrival · Shortest wait" (`core/rank.js criteriaText`) | "Least walking, earliest arrival" |
| 2.4 | Place suggestions (Directions, Current trip, Routes to station) | "Library · 1100 E 57th St · 1 min walk to Regenstein Library (N)" (`data/places.js`) | "Library, 1100 E 57th St · 1 min walk to ..." |
| 2.5 | Route detail status | "4:00 PM – 4:29 AM · ●Scheduled now" (dot + middle dot, no space) | see 3.1 |

### 3. Color consistency lock (one accent; green means live)

| # | Screen | Evidence | Fix |
|---|---|---|---|
| 3.1 | Route detail | "Scheduled now" is painted `--live-text` green with a "●" (`route.css .r-sched.is-on`): schedule data dressed as live data, next to the real live dot of "1 bus running" | plain `--text`, weight 600, no dot: the words carry the state |
| 3.2 | Settings ("Trip status on lock screen"), Routes to station ("Only show the chosen station's routes") | switch "on" track is `--live` green, a second accent; green elsewhere always means live GPS data | on track = `--accent` (light 5.4:1, dark 4.9:1 against the row); the "I" mark and knob position stay |
| 3.3 | My Routes swipe tray, delete confirm, count badges | three different reds: `#d70015` (tray), `--danger` #c4291c / #ff6961 (buttons, badge) | one `--danger-fill` token for every red fill |

### 4. Button / form contrast, WCAG AA, light and dark

Measured with the token values (sheet = `--bg-solid`, cards = `--surface`):

| Pair | Light | Dark |
|---|---|---|
| Primary: white on `--accent-fill` | 4.70 | 4.70 |
| Secondary: `--accent` on `--surface` | 4.86 | 4.92 |
| Link / tab: `--accent` on sheet | 5.42 | 6.01 |
| Placeholder: `--text-2` on `--surface` | 5.94 | 5.43 |
| Warn pill: `--warn` on `--warn-bg` | 5.04 | 7.75 |
| Error pill: `--danger` on `--danger-bg` | 4.99 | 5.55 |
| **Danger button / count badge: white on `--danger`** | 5.70 | **2.82 (fail)** |

| # | Screen | Evidence | Fix |
|---|---|---|---|
| 4.1 | My Routes delete confirm, swipe tray, "Service alerts" count badge (dark) | white text on #ff6961 = 2.82:1 | `--danger-fill` #c4291c in both themes (white 5.70:1); `--danger` stays the text color |

Inputs (filled `--surface` fields with a visible placeholder and icon, focus ring 2 px accent) pass.

### 5. Shape consistency lock (documented radius scale)

| # | Screen | Evidence | Fix |
|---|---|---|---|
| 5.1 | all | besides the four tokens (20 / 14 / 12 / 999) the CSS uses 15 literal radii: 24, 22, 16, 15, 13, 12, 11, 10, 9, 8, 7, 6, 4, 3, 2 | one documented scale (DESIGN.md "Radius scale"), every literal replaced by a token |
| 5.2 | Current trip | "Search stations" field radius 10 directly under the "Routes to station..." button radius 12 | inputs = `--r-control` (12) |
| 5.3 | Applied custom route | context chip radius 10 beside the locate button radius 12; its Clear button 7 | chip 12, nested button `--r-inner` (10) |
| 5.4 | About vs components | two segmented controls: `.themeseg` 10 / 8 and `.v-seg` 12 / 10 | both 12 outside, 10 inside |

### 6. CTA wrap ban

| # | Screen | Evidence | Fix |
|---|---|---|---|
| 6.1 | About, unofficial card | "Official transportation page" wraps to two lines in a half-width button | the two official buttons stack full width (the wording stays: it names the official page) |

### 7. No duplicate CTA intent per screen

| # | Screen | Evidence | Fix |
|---|---|---|---|
| 7.1 | Directions, no location, Destination focused | suggestion "My location / Allow location access" (for the destination) and the button "Start from my location" on the same screen | the destination list skips "My location" while the start is empty (the button covers it); the button hides while the start field's own list offers "My location" |

### 8. States (loading / empty / error)

| # | Screen | Evidence | Fix |
|---|---|---|---|
| 8.1 | Boot and every `skeleton()` (Current trip, route, Directions) | three plain gray bars; the real content is rows of route chip + two lines + ETA | row-shaped skeleton (chip, two text lines, ETA block), same 56 px rhythm; shimmer still off under reduced motion |

Empty and error states are composed (title, one plain sentence, official phone + page): kept.

### 9. Tactile `:active` feedback

| # | Screen | Evidence | Fix |
|---|---|---|---|
| 9.1 | everywhere | no press state on text buttons (`.v-link`, `.linkbtn`), icon buttons (`.v-eye`, `.v-dswap`, `.mr-ibtn`, `.v-fchip-x`), the Retry pill button, segment buttons (`.seg`, `.themeseg`, `.v-segbtn`), toggles (`.mr-fav`, `.mr-hl`, `.j-only`), the swipe tray buttons and the stop view's route chips | one shared rule set in components.css: text buttons dim, icon buttons get the pressed fill, toggles scale .97 (opacity only under reduced motion) |

### 10. Dots only for real state

| # | Screen | Evidence | Fix |
|---|---|---|---|
| 10.1 | Route detail | "●" before "Scheduled now" (`::before`) repeats what the words say | removed (3.1) |

Kept: the green dot before "1 bus running" / "Live", the trip-in-progress dot, the start / end pins (real state, always with text).

### 11. No pure #000 / #fff, tinted shadows

| # | Screen | Evidence | Fix |
|---|---|---|---|
| 11.1 | light: search bar, bottom navigation, sheet, Settings, dialogs, segment thumb, switch knobs | pure #ffffff surfaces | off-white #fcfcfd (`--bg-solid`, `--bg`, `--seg-on`, `--knob`) |
| 11.2 | sheet, floating controls, segment thumb, knobs, route-detail bus chip, trip vehicle chip, Settings card | `rgba(0,0,0,a)` shadows | one cool slate tint `--shadow-rgb` (30, 32, 45) and shadow tokens |
| 11.3 | Settings overlay scrim | hardcoded `rgba(0,0,0,.38)` | `var(--scrim)` (tinted in light) |

Rule written down: white is allowed only as text / icon on a saturated fill (accent, danger, route color) and as map
marker rings.

### 12. z-index scale

| # | Evidence | Fix |
|---|---|---|
| 12.1 | raw numbers 0 / 1000 / 1010 / 1090 / 1100 / 1105 / 1140 / 1150 / 1200 / 1300 / 5000 in five files, documented only in a settings.css comment | `--z-*` tokens in tokens.css, used by base / sheet / components / settings css; table in DESIGN.md |

### 13. Icons

One family already: inline 24 px outline SVGs (Feather / Lucide style, round caps, stroke 2; search 2.2 and back chevron
2.4 are deliberate optical weights). Kept.

| # | Screen | Evidence | Fix |
|---|---|---|---|
| 13.1 | Current trip, Favorites card (station with no upcoming bus) | text glyph "★" while the stop view and My Routes use the SVG star | reuse the existing SVG star |

### 14. 44 px targets

| # | Screen | Evidence | Fix |
|---|---|---|---|
| 14.1 | About / Settings, Appearance | `.v-segbtn` buttons are 40 px tall | 44 px hit area (`::after`, like `.seg`) |
| 14.2 | empty / error states using `.official` | phone and page links are 24 px tall | padded to a 44 px hit area without moving the text |

### 15. Copy self-audit (4.9)

| # | Screen | Evidence | Fix |
|---|---|---|---|
| 15.1 | Directions card + steps | "No walk: board at X", "No walk: start at X", "No walk: get off at X" read like a log line | "Board at X, no walk · bus 3:37 AM", "Start at X, no walk needed", "Get off at X, no walk needed" |
| 15.2 | Stop not found | button "Back to Nearby"; the tab has been "Current trip" since v2.4 | "Back to Current trip" |

Every other string was re-read (309 strings in the view modules, shell and operating rules); they are plain and specific.

### 16. Checked, no finding

- Reduced motion: the global rule in base.css plus per-file rules stop the shimmer, marquee, bus glide, pulse, sheet spring.
- Safe areas: search bar, chips, locate button, toast, sheet content, bottom navigation, dialogs and Settings all use
  `env(safe-area-inset-*)` (the desktop frame emulates 54 / 34 px and nothing collides).
- Theme lock: one theme for the whole page; the map style follows it.
- Rider safety copy: stale / error / silent-feed pills, "est." tags, official phone and page are present on every state captured.

## Left deliberately (and why)

- **Next bus below the fold at the half detent (CLAUDE.md item 3).** On Current trip the alert banner, "No trip in progress"
  card, "Routes to station..." and the location / search controls come before "Arriving soon" or the nearest stop, so at the
  half detent the first ETA needs a scroll. This is the owner's v2.4 layout (ARCHITECTURE "nearby"), an information-architecture
  call, not a taste fix. Recommendation: fold the "No trip in progress" hint into one line, or put the next-bus card first
  when no trip is running.
- **Map accent #0a84ff** (user dot, selection rings; `css/map.css`) differs slightly from the UI fill #0071e3. map.css belongs
  to the map work running in parallel; one-line change for later.
- **Favorite gold** (`--warn` hue on stars, gold map badges): one consistent "favorite" color, always a star shape, never
  alone as state.
- **Start / end pins green / red** in Directions mirror the map pins (map convention, always next to "Start" / "Destination").
- **White on route colors** (`textOn()`), **map marker rings**, the desktop frame's black Dynamic Island: data legibility and
  hardware emulation, allowed by the written rule above.
- **Wide route badge** ("Move In Charter") pushes that row's name right in the Routes list: the badge is the route's published
  short name; truncating it would hide the route's identity.
- **"Use my location" + the locate button** on Current trip: map chrome versus content, the Apple Maps pattern.
- **"↻" before "Loop: continues to ..."**: there is no loop icon in the set and the rule is not to hand-draw new paths.
- **Directions note** "They will get more accurate as we collect more ride data.": contract text (ARCHITECTURE "directions").
- **iOS** (`ios/`, other agent): `Schedule.swift` formats ranges with an en-dash too; same change recommended there for parity.
