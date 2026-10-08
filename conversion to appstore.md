# Conversion to App Store (playbook for a future Claude session)

Use this when the owner says "turn this website into an App Store-level app". It is the **single iPhone plan**: `docs/IOS.md` only points here, `docs/APPSTORE.md` holds costs, the 4.2 analysis and the timeline (don't repeat them here). Read `CLAUDE.md` and `docs/ARCHITECTURE.md` (v2 module contract) first. The owner works on Windows with no Node and no Mac, so every Mac/Xcode step needs CI or a cloud Mac.

**Web vs iPhone rule:** iPhone-only capabilities (Live Activities, Dynamic Island, background bus alerts, widgets, time-sensitive notifications) are built in the native layer and are **not shipped to the GitHub Pages site**. The web app only stores the preferences (`state.notify`) and alerts while the page is open. Keep shared logic in plain JS (`web/js/core/*`) so both targets use the same rules.

## 1. Goal and decision summary
- The web app in `web/` stays the free fallback (GitHub Pages PWA). Target: a native-feeling iOS app, "Straight Bussing", unofficial, no UChicago branding.
- A bare Capacitor/WKWebView wrap risks rejection under Guideline 4.2. Decision rule:
  1. Ship the PWA now. 2. Build the shared proxy + data contract (section 4) first; it serves both targets and is also the push server for section 7/8. 3. Start with Capacitor plus real native extensions (Live Activity, widget, notifications, section 9); go full SwiftUI only if review or feel demands it.
- Blockers independent of tech: written permission from UChicago Transportation/Passio (UNRESOLVED). Do not submit publicly before it. See CLAUDE.md.
- Hard rule: never hide staleness. Port `core/arrivals.js staleLevel()` (no data > 60 s, feed > 120 s/300 s old, fetch failed) to every surface, including the Live Activity and widgets.

## 2. Web vs iPhone feature map
Layer key: **JS** = shared code running in the Capacitor web view (same files as the site). **Plugin** = custom Swift Capacitor plugin (section 9). **Ext** = Widget Extension target (WidgetKit/ActivityKit). **Server** = the proxy/push service (section 4).

| Feature | Web (GitHub Pages) | iPhone app | Layer |
|---|---|---|---|
| Live map: routes, stops, buses, heading | Leaflet + OpenFreeMap vector tiles | same in web view (MapKit only in a SwiftUI rewrite) | JS |
| Map draw order, direction chevrons | yes (`routeOrder`, `map/chevrons.js`) | same | JS |
| Nearby: next bus at nearest stop | browser geolocation | `@capacitor/geolocation` (when-in-use) | JS + official plugin |
| Stale-data pill, official phone/link | yes | same, plus stale state in Live Activity/widget | JS + Ext |
| Service alerts (Nearby banner, Settings) | yes | same; optional push for new alerts later | JS (+ Server) |
| Routes list, hide/show, map order, Show all/Hide all (backlog) | yes | same | JS |
| Route detail: bus rail, hours, modified schedules, buses by hour | yes (`data/service.json`) | same; bundle `service.json`, refresh on launch | JS |
| Routes to station, station filter | yes | same | JS |
| Directions (walk + shuttle), sidewalk walking | yes (OSRM/Valhalla) | same; optionally `MKDirections` walking later | JS (+ Plugin) |
| Journey "Start" / only relevant routes | yes (map + in-sheet summary) | same, **plus starts the Live Activity** | JS + Plugin + Ext |
| My Routes: custom route sets, highlight, edit/delete | yes (localStorage) | same; store via `@capacitor/preferences`, mirror to App Group | JS + Plugin |
| Favorite stations | yes | same; mirrored to App Group for the widget | JS + Plugin |
| Settings: theme, alerts, notification prefs | yes; iPhone-only rows labeled "iPhone app" | real toggles, permission state, "Open iOS Settings" | JS + Plugin |
| Bus nearing my station (minutes, 2 stops, 1 stop) | in-app banner + browser Notification **only while open** | local + push notifications, time-sensitive | JS logic (`core/notify.js`) + Plugin + Server |
| Live trip status (lock screen, Dynamic Island) | none (in-sheet trip summary only) | Live Activity with self-ticking minute counter | Ext + Plugin (+ Server) |
| Widget: favorite stop's next arrivals | none | WidgetKit (home + lock screen) | Ext (+ Server) |
| Offline shell | `sw.js` | assets bundled in the app; drop the service worker | build config |
| Theme light/dark | yes | same; sync `StatusBar` style | JS + official plugin |
| Ground-truth collection + learned model | GitHub Actions (`monitoring.md`) | unchanged; app reads bundled/refreshed `learned.json` | Server-side |
| About/privacy text | lists what leaves the device | must add push tokens + watched stop if Server push is used | JS |

## 3. Basic transition (PWA to Capacitor wrap)
Steps (on a Mac/CI, from repo root):
1. `npm init -y && npm i @capacitor/core @capacitor/cli @capacitor/ios @capacitor/geolocation @capacitor/haptics @capacitor/status-bar @capacitor/splash-screen @capacitor/local-notifications @capacitor/push-notifications @capacitor/preferences @capacitor/app`
2. `npx cap init "Straight Bussing" <real.bundle.id> --web-dir web`; `npx cap add ios`; `npx cap sync`.
3. Bundle `web/` inside the app (no remote URL loading: a 4.2 red flag and breaks offline). Exclude `web/tests/`.
4. Set Team, `NSLocationWhenInUseUsageDescription`, signing, archive.

v2 file map:
| Web path | Role | Native-wrap notes |
|---|---|---|
| `web/index.html` | shell, tabs, sheet, settings button | `viewport-fit=cover` already; remove "Add to Home Screen" hints |
| `web/js/core/*.js` | pure logic (arrivals, planner, predict, visibility, custom, schedule, notify) | reuse as-is; candidates to port 1:1 to Swift for the extension if it must compute without the app |
| `web/js/data/*.js` | static + live loading, geocoding | swap the Passio `BASE` for the proxy URL (one constant) |
| `web/js/map/*.js` | Leaflet adapter (MapApi) | unchanged in a wrap; MapKit only in SwiftUI |
| `web/js/ui/*` | sheet, router, views, notifier | unchanged; `ui/notifier.js` gets a native branch (section 9) |
| `web/js/core/storage.js` | localStorage wrapper | back with `@capacitor/preferences` on native |
| `web/css/*` | layout | `env(safe-area-inset-*)` already used; verify the sheet clears the home indicator |
| `web/sw.js`, `manifest.webmanifest` | PWA only | unused in native; keep for web |
| `web/data/*.json` | static GTFS + `service.json` + `learned.json` | bundle a snapshot, refresh from the hosted copy on launch |
| `web/icons/` | SVG/PNG icons | 1024x1024 opaque PNG + asset catalog via `@capacitor/assets` |

Other basics: launch screen plain color + logo; haptics (light impact on stop select, success when an alert is armed); deep links via Universal Links (`apple-app-site-association`) and `straightbussing://stop/<id>`, `straightbussing://trip` (used by widget and Live Activity taps through `widgetURL`).

Add a thin platform seam (no build step): `web/js/platform/index.js` exporting `notify`, `liveActivity`, `prefs`, `geo`, chosen at runtime with `window.Capacitor?.isNativePlatform?.()`; web implementations are the current code, native ones call plugins. This keeps the GitHub Pages build free of iPhone code paths that can't work there.

## 4. Shared data contract and proxy
Static (from `tools/build_gtfs.py`, `web/data/`): `routes.json`, `stops.json`, `shapes.json`, `route_stops.json`, `stop_addresses.json`, `segments.json`, `service.json` (route hours, exceptions, buses by hour; shape in docs/ARCHITECTURE.md), `meta.json` (add `schema_version`). Live: Passio GTFS-rt JSON (`vehiclePositions`, `tripUpdates`, `serviceAlerts`).

Proxy (needed for push anyway): poll Passio every 10 s, serve `GET /v1/snapshot` (all three feeds + `fetched_at`, `upstream_ts`, `stale`) with CORS and `Cache-Control: max-age=5`. Cloudflare Cron's minimum is 1 min, so use a Durable Object alarm loop or a tiny always-on VM. The same process runs the watch loop of section 7/8. Swift mirror: `Codable` structs for the JSON; one Swift package (`FeedClient`, `Arrivals`) shared by app plugin and extension.

## 5. Complex systems (unchanged decisions)
- **Capacitor vs SwiftUI:** Capacitor reuses all v2 JS, 4.2 risk medium; SwiftUI gives MapKit feel, low 4.2 risk, 6-10 weeks part-time. Live Activities and widgets need a Swift extension either way.
- **Nearest stop/walking:** keep `core/geo.js` haversine; optional `MKDirections` walking for the top 3 stops.
- **Background refresh limits:** `BGAppRefreshTask` is opportunistic (minutes to hours). Never rely on it for live data. Widget reload budget is limited (roughly dozens per day); freshness comes from push.
- **Privacy label:** no server = "Data Not Collected". Push tokens and watched stops sent to the Server must be declared (section 10). Include `PrivacyInfo.xcprivacy` (UserDefaults is a required-reason API).
- **Accessibility:** VoiceOver labels in the extension too ("53rd St Express, 2 stops away, about 4 minutes, estimate"), Dynamic Type in widget/Live Activity, Reduce Motion, 44 pt targets.
- **Crash reporting:** MetricKit + Xcode Organizer first.

## 6. Live trip status (Live Activity)
Apple frameworks: **ActivityKit** (`ActivityAttributes`, `Activity.request(attributes:content:pushType:)`, `activity.update(_:)`, `activity.end(_:dismissalPolicy:)`, `ActivityContent(state:staleDate:)`), **WidgetKit** (`ActivityConfiguration`, `DynamicIsland`), Info.plist `NSSupportsLiveActivities = YES`.

**What it shows** (`ContentState`, kept small):
| Field | Example | Notes |
|---|---|---|
| route short/long + color | "53RD", "53rd Street Express", `#F7EB07` | text color from `routes.json text_color` |
| target stop | "Ellis & 55th" | the watched/boarding stop |
| `etaDate` | Date | countdown via `Text(timerInterval: now...etaDate, countsDown: true)` and `ProgressView(timerInterval:countsDown:)`: **ticks locally with no updates** |
| next stop of the bus | "Next: 53rd St & Kenwood" | from `core/notify.js liveStatus().nextStop` |
| stops away | 2 | from `stopsAway()` |
| source label | "est. · live" / "est. · schedule" | ETAs are estimates; always show "est." |
| `asOf` | 4:12 PM | when data was fetched |
| stale | grey + "Data delayed" | set `staleDate` = `asOf + 120 s`; the view reads `context.isStale` |

**Starts:** journey "Start" in Directions (boarding leg), or arming a bus alert in Settings / stop view (when `notify.liveActivity` is on). **Ends:** bus departs the target stop (or the alighting stop for a journey), user ends the trip/alert, ETA passes by > 5 min with no data, or the system limit. A Live Activity can stay active up to **8 hours**, then the system ends it (it may remain on the Lock Screen up to 4 more hours). Use `dismissalPolicy: .after(now + 15 min)` for a final "Arrived / Bus left" state.

**Layouts:**
| Surface | Content |
|---|---|
| Lock Screen / Notification Center banner | route chip + target stop; big countdown; "2 stops away · Next: X"; progress bar; "est. · as of 4:12 PM"; stale state |
| Dynamic Island compact | leading: route chip; trailing: countdown (`Text(timerInterval:)`) |
| Dynamic Island minimal | route color dot + minutes |
| Dynamic Island expanded | leading: route chip; trailing: countdown; center: target stop; bottom: "2 stops away · Next: X", "est. · Unofficial" |

**How it gets updated:**
| Option | How | Pros | Cons |
|---|---|---|---|
| A. In-app only | JS polls every 10 s while the app runs; plugin calls `activity.update`. Countdown keeps ticking locally when suspended; `staleDate` marks it stale. | no server, no new privacy disclosure, works offline of any backend | updates stop once iOS suspends the app (seconds after backgrounding); stops-away freezes; background location only defensible during an active walking journey |
| B. APNs push-to-update | request with `pushType: .token`; send `activity.pushTokenUpdates` + stop/route/trip to the Server; Server polls Passio (it already does, section 4) and sends `apns-push-type: liveactivity` pushes (`event: update/end`, `content-state`, `stale-date`) to topic `<bundle id>.push-type.liveactivity`. iOS 17.2+ also offers push-to-start tokens (`pushToStartTokenUpdates`) to start an activity remotely. | accurate while locked; same server sends the 2/1-stop alerts | needs a server, APNs auth key (.p8), and a disclosure: push token + watched stop leave the device |
| C. Hybrid (recommended) | Start locally (A) so it works instantly and without network to our server; register the push token; Server takes over updates (B) when available; if the Server is down, A's local countdown + `staleDate` still degrade honestly. | best accuracy, graceful failure, one code path for alerts | most work |

**Update budget:** high-priority (`apns-priority: 10`) Live Activity pushes are budgeted by the system; send priority 10 only on meaningful changes (stops-away change, ETA shift >= 1 min, end) and 5 otherwise. Add `NSSupportsLiveActivitiesFrequentUpdates = YES` only if needed (the user can turn it off). The self-ticking timer means most minutes need no push at all.

**Recommendation: C (hybrid), shipped in two steps:** first A (local start, self-ticking countdown, stale state) to prove the UI on TestFlight with no backend, then B once the proxy (P2) exists. Rationale: the proxy is already required for polite Passio access, so push adds little cost; A alone cannot keep stops-away accurate on a locked phone, which is the feature the owner asked for.

## 7. Bus nearing a station + 2-stops / 1-stop notifications
**Logic reuse:** `web/js/core/notify.js` (contract in docs/ARCHITECTURE.md): `stopsAway(state, stopId, rid?)`, `dueAlerts(state, prevFired, nowS)` (dedupe per trip + kind), `liveStatus(state, nowS)`. Run the same file in the web view (foreground) and in the Server (Node/Workers can import plain ES modules) so thresholds and wording match everywhere. Settings come from `state.notify` (`stopId`, `rids`, `twoStops`, `oneStop`, `minutes`, `liveActivity`, `inApp`).

**Why local notifications alone are not enough:** `UNUserNotificationCenter` local triggers are time-, calendar- or location-based (`UNTimeIntervalNotificationTrigger`, `UNCalendarNotificationTrigger`, `UNLocationNotificationTrigger`). "Bus is 2 stops away" depends on live positions that the app can't fetch once suspended. Scheduling at a predicted time is wrong whenever the bus runs early/late, and `BGAppRefreshTask` runs too rarely. Silent pushes (`content-available`) are throttled and not guaranteed.

**Background modes App Review will accept here (Guideline 2.5.4):** `location` only while the user is actively on a journey that uses their location (walking to the stop, Citymapper "Go" style) and with a clear purpose string; **not** to keep the app alive for a passive "notify me at home" alert. `remote-notification` is fine for push. No audio/VoIP tricks. So the reliable path for passive alerts is **Server push**:
1. User arms an alert (stop, routes, thresholds). App asks notification permission (below), gets the APNs device token via `@capacitor/push-notifications`, sends `{token, stopId, rids, thresholds, expiresAt}` to the Server (HTTPS, no account).
2. Server evaluates `dueAlerts()` every 10 s against its Passio snapshot and sends alert pushes: "53RD is 2 stops from Ellis & 55th · about 4 min (est.)", then "1 stop away". Same dedupe keys as the web.
3. Server deletes the watch when the bus passes, the user disarms, or after `expiresAt` (default 2 h). No logs of tokens beyond the watch.
4. While the app is in the foreground, the web view's `ui/notifier.js` shows in-app banners and the Server suppresses duplicates (app reports "foreground" in the watch).

**Interruption level:** set `interruption-level: time-sensitive` (APNs payload `aps.interruption-level`, `UNNotificationInterruptionLevel.timeSensitive` locally) for the 2/1-stop alerts only; requires the Time Sensitive Notifications capability (entitlement). Minutes-away and service-alert pushes stay `active`. Use a `thread-id` per trip so alerts group, and a category with "Stop alerts" / "Open map" actions.

**Permission flow:** never ask at launch. Ask when the user first arms an alert or taps journey Start: in-app explainer sheet ("Get a heads-up when your bus is 2 and 1 stops away. Times are estimates. Unofficial.") -> system prompt. If denied: Settings row shows "Notifications off" + "Open iOS Settings" (`UIApplication.openSettingsURLString` via `@capacitor/app` or the plugin). Live Activities have their own per-app switch; check `ActivityAuthorizationInfo().areActivitiesEnabled`.

**Safety wording in every notification:** route + stop + "est.", never "will arrive"; final line or category footer "Unofficial · check the official app". If data goes stale, send one "Live data delayed, times may be off" update instead of silence.

## 8. Server (proxy + push) sketch
| Piece | Choice | Notes |
|---|---|---|
| Poll loop | Durable Object alarm (10 s) or small VM | shared with `/v1/snapshot` |
| Watches | DO storage / SQLite row per watch | token, stopId, rids, thresholds, live-activity token, expiresAt |
| APNs | HTTP/2 to `api.push.apple.com` with JWT (ES256) from a .p8 key | Workers can sign with WebCrypto; keep the key in secrets |
| Logic | import `web/js/core/notify.js` + `arrivals.js` | same rules as the app |
| Cost | Workers Paid ~$5/mo (est.) or ~$5/mo VPS (est.); APNs free | see `docs/APPSTORE.md` |
| Privacy | tokens + watched stop leave the device | declare in App Privacy (Identifiers/Device ID: app functionality, not linked, not tracking); state it in About; delete on expiry |

## 9. Capacitor plugin and extension plan
- **Custom plugin `LiveTrip`** (Swift, `CAPPlugin` + `CAPBridgedPlugin`; JS `registerPlugin('LiveTrip')` from `web/js/platform/`):
  | Method | Does |
  |---|---|
  | `isSupported()` | iOS 16.1+ and `areActivitiesEnabled` |
  | `startActivity({route, stop, etaS, nextStop, stopsAway, source, asOf})` | `Activity.request(..., pushType: .token)`; returns `{id}`; emits `pushToken` events |
  | `updateActivity({id, ...state})` | `activity.update(ActivityContent(state:, staleDate:))` |
  | `endActivity({id, final?})` | `activity.end(..., dismissalPolicy:)` |
  | `scheduleLocal({id, title, body, atS, timeSensitive})` / `cancelLocal({id})` | foreground fallbacks via `UNUserNotificationCenter` |
  | `writeShared({favStops, notify, customRoutes})` | App Group `UserDefaults(suiteName:)` for the widget |
- Use official `@capacitor/push-notifications` for the APNs device token and `@capacitor/local-notifications` where it suffices; only Live Activity + App Group need custom Swift.
- **Widget Extension target** (`StraightBussingWidgets`): Live Activity UI (`ActivityConfiguration`) + favorite-stop widget (`TimelineProvider` reading the App Group + `/v1/snapshot`). The `ActivityAttributes` struct lives in a file that is a member of both the app and the extension targets (or the shared Swift package).
- **App Group** `group.<bundle id>`: favorites, notify prefs, last snapshot for widgets.
- **Needs an Apple Developer account ($99/yr):** APNs auth key, App Groups, push and Time Sensitive entitlements, TestFlight, installing on a real device beyond free 7-day provisioning. **Needs a Mac/Xcode (or cloud Mac/CI):** every build, the extension, signing. Real Dynamic Island testing needs an iPhone 14 Pro or later; Live Activities need iOS 16.1+ (push-to-start iOS 17.2+). Simulator can preview Live Activities.

## 10. App Review risk notes
- **Unofficial / naming (4.1, 5.2):** no "UChicago", "UGo", maroon or logos; "Unofficial, not affiliated" in the description, About and notification wording. Permission from UChicago Transportation/Passio still UNRESOLVED: get it in writing before public release.
- **4.2:** list native features in review notes: Live Activity + Dynamic Island, time-sensitive stop alerts, widgets, nearest stop, offline schedules, favorites/My Routes. Attach a screen recording of live buses (service hours only).
- **2.5.4 background modes:** only `remote-notification`; `location` only if a journey "Go" mode truly uses it.
- **4.5.4 push:** no marketing pushes; alerts only after explicit opt-in; app fully usable with notifications off.
- **5.1.1 privacy:** disclose push tokens/watched stops (if Server push), privacy policy URL, `PrivacyInfo.xcprivacy`.
- **Safety:** every time is "est."; stale state visible on all surfaces; official phone 773.702.8181 in About and empty/error states.

## 11. Build and release pipeline
- No Mac: Codemagic or GitHub Actions `macos-latest`; cloud Mac for debugging. Costs: `docs/APPSTORE.md`.
- Signing: App Store Connect API key (.p8) in CI secrets; fastlane `match` or Codemagic signing; never commit certs/keys (also keep the APNs .p8 only in Server secrets).
- Pipeline: tests (`python tools/run_browser_tests.py`) -> `npx cap sync ios` -> archive -> sign -> TestFlight on tag.
- TestFlight: internal testers first; external needs Beta App Review; builds expire after 90 days.
- Screenshots: 6.9" and 6.5" iPhone; show map, arrivals, Live Activity on Lock Screen, Dynamic Island, widget, a stop alert.
- Metadata: privacy policy + support URLs (GitHub Pages), category Navigation or Travel, export compliance (HTTPS only), neutral name.

## 12. Phased checklist
- [ ] P0 Prereqs: UChicago/Passio written permission; Apple Developer enrollment; bundle ID; privacy policy + support page live
- [x] P1 Refactor into ES modules (done: v2, `docs/ARCHITECTURE.md`)
- [ ] P1b Web groundwork: `state.notify`, `core/notify.js`, Settings view, `ui/notifier.js` (in-app only), iPhone-sized web layout; add `web/js/platform/` seam
- [ ] P2 Proxy: 10 s poll, `/v1/snapshot`, CORS, rate limit, stale flag; point web `BASE` at it
- [ ] P3 `tools/build_gtfs.py`: `schema_version` (service.json done in v2.1)
- [ ] P4 Capacitor beta: wrap, safe areas, icons, splash, geolocation, preferences, haptics, deep links; CI to TestFlight
- [ ] P5 Live Activity, option A: `LiveTrip` plugin + Widget Extension, local start/update/end, self-ticking countdown, stale state, Dynamic Island layouts
- [ ] P6 Notifications: permission flow, local foreground alerts, Time Sensitive entitlement, Settings rows wired to native
- [ ] P7 Server push (option B/C): watches, APNs alert pushes for 2/1 stops, Live Activity push-to-update, privacy label + About text
- [ ] P8 Widgets: favorite-stop widget (home + lock screen) via App Group
- [ ] P9 Decision gate: 4.2 feedback from TestFlight/review; SwiftUI rewrite only if needed
- [ ] P10 Quality: stale UX on all surfaces, VoiceOver/Dynamic Type in the extension, MetricKit, unit tests for `core/notify.js`
- [ ] P11 Release: screenshots, review notes + recording, privacy label, submit, handle review rounds
- [ ] P12 Post-launch: monitor proxy load and push volume, Passio contact, takedown plan, update CLAUDE.md

### When told to start, do this first
1. Read CLAUDE.md, docs/ARCHITECTURE.md, docs/APPSTORE.md, this file. Ask the owner: Mac or cloud Mac access? paid Apple account yet? permission status? OK to run a small server (needed for locked-phone bus alerts)?
2. Confirm the web app works (`docs/RUN.md`, `python tools/run_browser_tests.py`) and `web/data/meta.json` is fresh; check collection health (`monitoring.md`).
3. Do P1b and P2 first (Windows-doable, de-risk both paths). Keep iPhone-only code behind `web/js/platform/` so the GitHub Pages site never ships it.
4. Then P4 -> P5 (Live Activity with no server) -> P6 -> P7.
5. Tick boxes here and update CLAUDE.md Status as phases complete. Do not submit publicly without the owner's explicit go-ahead.
