# Conversion to App Store (playbook for a future Claude session)

Use this when the owner says "turn this website into an App Store-level app". Read `CLAUDE.md`, `docs/APPSTORE.md` (costs, 4.2 analysis, timeline: do not repeat here), `docs/IOS.md`. Owner works on Windows with no Node and no Mac, so every Mac/Xcode step needs CI or a cloud Mac.

## 1. Goal and decision summary
- The web app in `web/` is the prototype and stays the free fallback (GitHub Pages PWA). Target: a native-feeling iOS app, "Straight Bussing", unofficial, no UChicago branding.
- A bare Capacitor/WKWebView wrap risks rejection under Guideline 4.2. Decision rule:
  1. Ship the PWA now. 2. Build the shared proxy + data contract (section 4) first, it serves both targets. 3. Default to a native SwiftUI app if the owner wants "App Store-level"; use Capacitor only as a fast beta to learn what reviewers say.
- Blockers independent of tech: written permission from UChicago Transportation/Passio (UNRESOLVED), do not submit publicly before it. See CLAUDE.md.
- Hard rule: never hide staleness. Keep the stale banner behavior from `renderBanner()` (no data >60 s, feed >120 s old, no buses) in every client.

## 2. Basic transition ideas (PWA to Capacitor wrap)
Steps (on a Mac/CI, from repo root; see `docs/IOS.md`):
1. `npm init -y && npm i @capacitor/core @capacitor/cli @capacitor/ios @capacitor/geolocation @capacitor/haptics @capacitor/status-bar @capacitor/splash-screen @capacitor/local-notifications @capacitor/app`
2. `npx cap init "Straight Bussing" <real.bundle.id> --web-dir web`; `npx cap add ios`; `npx cap sync`.
3. Bundle `web/` inside the app (not remote URL loading; remote-only is a 4.2 red flag and breaks offline).
4. Set Team, usage string `NSLocationWhenInUseUsageDescription`, signing, archive.

What each web file maps to:
| Web file | Role | Native-wrap notes |
|---|---|---|
| `web/index.html` | shell, tabs, sheet | add `viewport-fit=cover`; remove "Add to Home Screen" hints |
| `web/app.js` | state `S`, poll, render | split into modules (section 4); swap `navigator.geolocation` for Capacitor Geolocation; swap `BASE` for proxy URL |
| `web/style.css` | layout | add `env(safe-area-inset-*)` padding to sheet/tabs/banner; respect dark mode |
| `web/sw.js` | caches shell only | drop in native build (assets are bundled); keep for PWA. Never cache live feeds |
| `web/manifest.webmanifest` | PWA install | unused in native; keep for web |
| `web/data/*.json` | static GTFS (routes, stops, shapes, route_stops, meta) | bundle a snapshot in the app, refresh from hosted copy on launch (daily GitHub Action `tools/build_gtfs.py` already produces it) |
| `web/icons/` | SVG icon | need 1024x1024 opaque PNG for the App Store plus asset catalog |

Other basics:
- Offline/app-shell: static JSON bundled + last-good copy in storage; live data never served from cache without a visible "last updated" label.
- Icons/splash: 1024 PNG (no alpha, no rounded corners), `LaunchScreen.storyboard` plain color + logo (Apple rejects fake-loading splash screens); use `@capacitor/assets`.
- Status bar/safe areas: `StatusBar` style by theme, bottom sheet must clear the home indicator.
- Haptics: light impact on stop select, notification-success on arrival alert set.
- Deep links: Universal Links (`apple-app-site-association` on the hosted domain) such as `/stop/8612`, plus custom scheme `straightbussing://stop/<id>`; used by widgets and notification taps.

## 3. Complex systems for a real App Store app
Capacitor vs SwiftUI:
| Concern | Capacitor wrap | Native SwiftUI |
|---|---|---|
| Reuse of web code | high | none (reuse data contract only) |
| 4.2 risk | medium-high | low |
| Map feel | Leaflet raster, janky | MapKit, smooth, clustering, annotations |
| Widgets/Live Activities | Swift extension needed anyway, bridge via App Group | first-class |
| Background/notifications | plugin limits | full control |
| Dev on Windows | partial (web edits) | needs Mac/CI for everything |
| Effort | 2-4 wks | 6-10 wks part-time |

Subsystems (build in this order of value):
- **MapKit vs Leaflet:** MapKit `Map` with `MapPolyline` per route from `shapes.json`, `Annotation` for buses (rotate by bearing, animate between polls), stop clustering, no tile cost, native dark mode. Leaflet only if staying in a web view.
- **Caching proxy (Cloudflare Workers + Cron/Durable Object):** poll Passio every 10 s (Cron min is 1 min, so use a Durable Object alarm loop or a tiny VM), write one merged snapshot with `ts`, serve with `Cache-Control: max-age=5` and CORS. Clients hit the proxy, not Passio (polite, rate-limited, one swap point if Passio objects). Keep Passio attribution in responses. Costs: `docs/APPSTORE.md`.
- **GTFS-realtime protobuf:** current feeds are JSON (`.../realtime/*.json`); if Passio also serves `.pb`, decode with `gtfs-realtime-bindings` in the Worker or `SwiftProtobuf` in-app. Prefer decoding once in the proxy and emitting the stable JSON of section 4.
- **Nearest stop + walking distance:** Core Location (`whenInUse`, reduced accuracy fallback). Replace the web's crude squared-degree sort in `nearestStops()` with haversine; walking time via `MKDirections` (.walking) for top 3 only, cache results, fall back to straight-line/80 m/min. Dedup EB/WB stops by name.
- **Notifications:** local first ("bus X at stop Y in N min", scheduled from tripUpdates while app is alive); true background arrival alerts need push via proxy + APNs (store device token + stop + route; this changes the privacy label). Do not promise exact timing.
- **WidgetKit + Live Activities:** widget = favorite stop's next 3 arrivals (timeline from proxy snapshot, App Group shared favorites). Live Activity for a tracked bus (ActivityKit) updated by APNs push-to-update from the proxy (needs push-token flow); show "as of HH:MM".
- **Favorites and offline schedules:** favorites (stops, routes) in SwiftData/UserDefaults (App Group). Static GTFS stop_times (extend `tools/build_gtfs.py` to also emit `stop_times` compactly) for offline "scheduled" view clearly labeled "scheduled, not live".
- **Background refresh limits:** `BGAppRefreshTask` is opportunistic (minutes to hours, not 10 s). Never rely on it for live data; widgets get a budget of roughly 40-70 reloads/day; real-time freshness comes from push, not polling.
- **Stale-data safety UX:** port banner logic verbatim; show per-bus "updated Ns ago", grey out buses >60 s old, widgets and Live Activities show timestamps and a stale state, link to official app/phone 773.702.8181.
- **Analytics/privacy label:** prefer none or privacy-friendly aggregate (proxy request counts). If none and location stays on device: "Data Not Collected". Push tokens or logged IPs mean declaring Identifiers/Diagnostics. Include privacy manifest `PrivacyInfo.xcprivacy` (required-reason APIs such as UserDefaults).
- **Accessibility:** VoiceOver labels on every bus/stop annotation ("Route 53rd, heading north, 3 min"), list alternative to the map, Dynamic Type (no fixed font sizes), contrast of route colors (use text_color from routes.json), Reduce Motion for bus animation, 44 pt targets.
- **Localization:** String Catalog (`.xcstrings`), start with en, structure for es/zh; format times with `RelativeDateTimeFormatter`.
- **Crash reporting:** MetricKit + Xcode Organizer first (no SDK, no privacy cost); Sentry only if needed (adds to privacy label).

## 4. Architecture target (shared contract)
Principle: one data contract, thin clients. Any new client reads the same JSON.

Static (from `tools/build_gtfs.py`, `web/data/`):
- `routes.json`: `{route_id: {short, long, color, text_color}}`
- `stops.json`: `{stop_id: {name, lat, lon}}`
- `shapes.json`: `{route_id: [[[lat, lon], ...], ...]}` (polylines)
- `route_stops.json`: `{route_id: [stop_id, ...]}` (ordered loop)
- `meta.json`: `{generated_utc, source}`; proposed addition: `schema_version`.

Live (today GTFS-rt JSON from Passio; proxy should re-emit the same field names plus `fetched_at`):
- `vehiclePositions`: `{header:{timestamp}, entity:[{vehicle:{trip:{route_id}, vehicle:{id,label}, position:{latitude,longitude,bearing}}}]}`
- `tripUpdates`: `entity[].trip_update:{trip:{route_id}, vehicle:{label}, stop_time_update:[{stop_id, arrival:{time}, departure:{time}}]}`
- `serviceAlerts`: `entity[].alert:{active_period:[{start,end}], header_text/description_text:{translation:[{text}]}}`
- Proposed proxy endpoint `GET /v1/snapshot` returning all three plus `fetched_at`, `upstream_ts`, `stale:boolean`.

Module boundaries (refactor `web/app.js` into ES modules, no build step needed):
- `data/api.js` (fetch + freshness), `data/model.js` (state S, `arrivalsFor`, `nearestStops`, pure and testable), `ui/*` (banner, sheet, panels), `map/*` (Leaflet adapter behind an interface: setBuses, setRoutes, setStops, panTo), `platform/*` (storage, geolocation, haptics, notifications: web impl vs Capacitor impl). Pure logic in `model.js` should be unit-tested in Python-free JS-in-browser or ported 1:1 to Swift. Keep `BASE` configurable via one constant.
- Swift mirror: `Codable` structs matching the JSON above; one `FeedClient` and one `Arrivals` module shared by app, widget, and Live Activity targets (Swift package).

## 5. Build and release pipeline
- Windows owner, no Mac: use Codemagic (free minutes) or GitHub Actions `macos-latest`; cloud Mac for debugging. Costs: `docs/APPSTORE.md`.
- Signing: App Store Connect API key (.p8) in CI secrets; use fastlane `match` or Codemagic automatic signing; never commit certs/keys.
- Pipeline: lint/test -> `npx cap sync ios` (or `xcodebuild archive`) -> sign -> upload to TestFlight (`fastlane pilot` / `xcrun altool`/`notarytool` successors) on tag.
- TestFlight: internal testers first (no review), external needs Beta App Review; builds expire in 90 days.
- App Review notes against 4.2: list native features (Core Location nearest stop and walking time, notifications, widget, Live Activity, offline schedules, favorites), attach screen recording, state no login is required, state "unofficial, data from public Passio feed, permission from <name/date>", give a test hint (shuttles run only on service hours, so include video of live buses).
- Screenshots: 6.9" and 6.5" iPhone required (iPad only if supported); show map, arrivals, widget, alert.
- Metadata: privacy policy URL and support URL (GitHub Pages pages under `web/` or `docs/`), category Navigation or Travel, age rating, export compliance (HTTPS only: exempt), neutral name and "unofficial" in description.

## 6. Phased checklist
- [ ] P0 Prereqs: UChicago/Passio written permission; Apple Developer enrollment; bundle ID chosen; privacy policy + support page live
- [ ] P1 Refactor `web/app.js` into modules per section 4 with no behavior change; verify in browser
- [ ] P2 Proxy: Worker/Durable Object polling every 10 s, `/v1/snapshot`, CORS, rate limit, stale flag; point web `BASE` at it
- [ ] P3 Extend `tools/build_gtfs.py` (stop_times, schema_version) and its Action
- [ ] P4 Capacitor beta: wrap, safe areas, icons, splash, Geolocation, haptics, deep links; CI build to TestFlight
- [ ] P5 Decision gate: native-feature depth vs 4.2; go SwiftUI if weak (MapKit, widgets, Live Activities)
- [ ] P6 Native features: nearest stop and walking distance, favorites, local notifications, WidgetKit
- [ ] P7 Push: APNs via proxy, Live Activity, update privacy label
- [ ] P8 Quality: stale UX everywhere, VoiceOver, Dynamic Type, localization, MetricKit, unit tests for arrivals logic
- [ ] P9 Release: screenshots, review notes + recording, privacy label, submit, handle review rounds
- [ ] P10 Post-launch: monitor proxy load, Passio contact, takedown plan, update CLAUDE.md status

### When told to start, do this first
1. Read CLAUDE.md, docs/APPSTORE.md, docs/IOS.md; ask the owner: Mac access? paid Apple account yet? permission status? Capacitor beta or straight to SwiftUI?
2. Confirm web app still works (`docs/RUN.md`), check `web/data/meta.json` freshness.
3. Do P1 (module refactor) and P2 (proxy) first; they are Windows-doable and de-risk both paths.
4. Update the Status section in CLAUDE.md and tick boxes in this file as phases complete.
5. Do not commit or submit publicly without the owner's explicit go-ahead.
