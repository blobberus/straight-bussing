# CTA Implementation (plan only: nothing here is built in the live app)

Owner request (2026-11-06): "Also look at some potential active hyde park cta bus routes and create an instructional
file called CTA Implementation which will include a plan and a way to add cta buses to the app (but do not actually
add them)."

This file is the plan and the how-to. The live site and the iPhone app in this repo contain **no CTA code**. A
working build is being tried on the experimental repo (github.com/blobberus/straight-bussing-experimental, started
2026-11-06, owner request there: CTA routes shown like the shuttles, CTA buses identifiable, square CTA stations, a
distinct group on the Routes menu). When that build is done, treat it as the reference implementation and port from it
using the steps below.

Read first: `.claude/rules/project.md` (ship checklist, privacy list), `docs/ARCHITECTURE.md` (data contract),
`conversion to appstore.md` (iPhone plan). Everything here was checked on 2026-11-06; section 9 lists the sources.

## 1. Summary and recommendation

**Routes.** Start with the three CTA routes that exist for the University area: **171 U. of Chicago/Hyde Park** and
**172 U. of Chicago/Kenwood** (campus circulators on the same streets as the shuttles) and **192 University of Chicago
Hospitals Express** (weekday rush, downtown stations to the medical center). Then the routes riders use to leave or
cross Hyde Park: **55, 4, X4, 6, 2, 28, 15, 10, 59**. The edge routes **47** (north edge) and **63** (south edge)
come last. The table in section 2 has hours and stops for each.

**Data.** CTA publishes everything needed, but none of it can be read straight from a browser:

1. **Schedule** (stops, shapes, timetables): CTA's GTFS zip. No key, but no CORS and 69 MB, so a daily GitHub Action
   turns it into small `web/data/cta/*.json` files, the same way `tools/build_gtfs.py` handles Passio's zip.
2. **Live buses and arrival predictions**: the CTA Bus Tracker API v3. It needs a **secret API key** and sends no CORS
   header, so it cannot be called from the website or shipped in the app. A tiny **proxy** owned by the owner (a
   Cloudflare Worker is the cheapest fit) holds the key, asks CTA at most once every 30 seconds for the whole Hyde Park
   set, and answers riders with one small JSON file in the same GTFS-realtime JSON shape the app already reads from
   Passio. Riders send nothing about themselves to it (no location, no chosen stop); the app filters on the device.
3. **Alerts**: CTA's Customer Alerts API (no key, but no CORS either), served through the same proxy.

The iPhone app uses the same proxy and the same schedule files (its daily schedule check already downloads
`web/data` from Pages). The key never ships in the website or the app.

**Rules that carry over.** Every CTA item carries a visible "CTA" tag (never color alone), every CTA time says "est."
and names its source (CTA live or CTA schedule), CTA staleness is shown on its own and never hidden behind a healthy
shuttle feed, and the app stays unofficial: no CTA logo, never "official", and a "not made or endorsed by the CTA" line
in About.

**What only the owner can do:** apply for a Bus Tracker API key on the owner's own CTA account (and accept CTA's
Developer License Agreement), create the Cloudflare account that hosts the proxy (the free plan covers the expected
traffic; the paid plan is $5 a month), and answer the open questions in section 8.

## 2. Hyde Park CTA bus routes (checked 2026-11-06)

**How this was checked.** From CTA's current GTFS zip (published 2026-09-14, timetables valid 2026-09-11 to
2026-11-30): every bus route with a stop inside 47th to 64th Street, Cottage Grove to the lake. Hours are rounded
spans of the trips that stop in Hyde Park on Monday Nov 9, Saturday Nov 7 and Sunday Nov 8, 2026. Frequencies are
from the noon hour, one direction. The route pages on transitchicago.com were read for 171, 172, 192, 2 and 10
and agree with the GTFS. CTA's own route names are operator data and are shown as CTA writes them ("U. of Chicago"
included), the same rule the app already follows for Passio alert text.

| Priority | Route | CTA name | Connects | Service at Hyde Park stops (Nov 2026) | Key Hyde Park stops |
|---|---|---|---|---|---|
| 1 | 171 | U. of Chicago/Hyde Park | 60th & University to Shoreland (54th & South Shore), through campus and east Hyde Park | Weekdays 6:15 AM to 7:30 PM (every 30 min midday, 15 min at 5 PM); Saturday 8:00 AM to 6:20 PM; no Sunday. Runs early September to mid-June; summer is weekday rush only | 60th & University, 5800 S Ellis, University & 57th, S Hyde Park & 53rd / 54th / 55th, 55th & Lake Park, Shoreland Dorm |
| 1 | 172 | U. of Chicago/Kenwood | 60th & University to Hyde Park/East End (E Hyde Park Blvd & Lake Shore Dr) via Ellis and Woodlawn | Weekdays 6:15 AM to 7:35 PM (every 15 min); Saturday and Sunday 8:00 AM to 6:20 PM (every 30 min). Same September to June season | 60th & University, 1111 E 60th, 60th & Ellis, Woodlawn & 58th, Ellis & 55th, Ellis & 53rd, E Hyde Park & Blackstone, E Hyde Park & Lake Shore Dr. Reroute Nov 5 to 20, 2026: northbound via 59th, Cottage Grove and Hyde Park Blvd |
| 1 | 192 | University of Chicago Hospitals Express | Ogilvie and Union Station (boarding on Clinton at Madison and at Jackson) to the medical center, nonstop from Roosevelt; southbound in the morning, northbound in the afternoon only | Weekdays only: southbound trips reach Hyde Park 6:25 to 9:35 AM, northbound trips leave 3:45 to 7:30 PM. Northbound trips end at Jefferson & Washington during a reroute running since Dec 15, 2025 | Cottage Grove & 57th, 59th & Ellis, 59th & Drexel, 850 E 59th |
| 2 | 55 | Garfield | Midway Orange Line to the Museum of Science and Industry along Garfield / 55th | 24 hours, 7 days; about every 9 min midday | 55th & Cottage Grove, 55th & University, 55th & Kimbark, 55th & Lake Park, S Hyde Park & 55th / 56th, Museum of Science & Industry |
| 2 | 4 | Cottage Grove | Downtown (Columbus & Randolph) to the 115th Street Metra station along Cottage Grove | 24 hours, 7 days; about every 9 min midday | Cottage Grove & 51st, 54th, 56th, 57th, 59th, 62nd |
| 2 | X4 | Cottage Grove Express | Downtown to 95th & State, limited stops on Cottage Grove | Weekdays only, rush periods: about 5:45 to 10:30 AM and 1:55 to 7:05 PM; no weekends | Cottage Grove & 47th, 51st, 55th, 58th, 61st, 63rd (Green Line) |
| 2 | 6 | Jackson Park Express | Downtown (Columbus & South Water) to 79th & Lake Shore Dr via Lake Park, Hyde Park Blvd and Stony Island | Daily about 4:15 AM to 1:20 AM; about every 12 min midday | Lake Park & 48th, 5000 S Lake Park, Lake Park & E Hyde Park Blvd, E Hyde Park & Cornell, Stony Island & 57th to 63rd |
| 2 | 2 | Hyde Park Express | A Hyde Park loop (Midway Plaisance & Cottage Grove) to Navy Pier, express on Lake Shore Dr | Weekday rush only: about 6:00 to 10:10 AM and 3:40 to 8:00 PM | 60th & University, Cottage Grove & 57th / 58th, E Hyde Park & Ellis / Kimbark, Lake Park & 48th, Lake Park & E Hyde Park Blvd |
| 2 | 28 | Stony Island | Lake Park & 47th terminal to 103rd & Stony Island | Daily about 4:20 AM to 12:30 AM; about every 15 min midday | Lake Park & 47th, Lake Park & E Hyde Park Blvd, Stony Island & 57th, 59th, 60th, 62nd, 63rd |
| 2 | 15 | Jeffery Local | 47th Red Line to 103rd & Stony Island via 51st, E Hyde Park Blvd, Stony Island and Jeffery | Daily about 4:30 AM to 1:10 AM; about every 15 min midday | 51st & Cottage Grove, E Hyde Park & Ellis / Woodlawn / Kimbark / Dorchester / Blackstone, Stony Island stops |
| 2 | 10 | Obama Presidential Center/Museum of Science & Industry Express | North Michigan Ave (Chestnut) to the Museum of Science and Industry and the Obama Presidential Center, express | Daily about 9:15 AM to 6:15 PM; about every 30 min | Museum of Science & Industry, Stony Island & 57th Dr, 58th, 59th, 60th, 62nd |
| 2 | 59 | 59th/61st | Midway Orange Line to 60th & Stony Island via 59th and 61st | Weekdays 5:30 AM to 8:45 PM, Saturday 7:30 AM to 8:45 PM, no Sunday; about every 20 min | 61st & Cottage Grove, 61st & Ellis, 61st & University, 61st & Kenwood, Dorchester & 61st, 60th & Stony Island |
| 3 | 47 | 47th | Midway Orange Line to Lake Park & 47th along 47th St (north edge of Kenwood) | Daily about 3:50 AM to 1:30 AM; about every 9 min midday | 47th & Cottage Grove, Drexel, Ellis, Woodlawn, Lake Park |
| 3 | 63 | 63rd | Midway Orange Line to Stony Island & 63rd / 64th along 63rd St (south edge, Woodlawn) | 24 hours, 7 days; about every 8 min midday | 63rd & Woodlawn, University, Kimbark, Kenwood, Stony Island & 63rd / 64th |

**Holidays.** CTA runs Sunday schedules on New Year's Day, Memorial Day, Independence Day, Labor Day, Thanksgiving and
Christmas. The GTFS already encodes this (Thanksgiving 2026 uses Sunday trips), so the build gets it for free.

**Checked and left out** (no stop inside Hyde Park):
- J14 Jeffery Jump and 26 South Shore Express: nearest stop Jeffery & 67th, about 2.5 km from the Main Quad; both run
  express on Lake Shore Drive past Hyde Park.
- 51 51st: nearest stop Wentworth & 51st, about 3 km west.
- 3 King Drive: nearest stop King Dr & 59th, about 1.4 km west, across Washington Park.
- X28, X3, X20, 5 and 14 are not in the current CTA feed.
- The Green Line's Cottage Grove (63rd) station is rail, out of scope for "CTA buses".

**Could not verify (ask before relying on it):**
- Whether 171, 172 and 192 skip the University's breaks. The GTFS shows full weekday service on Friday Nov 27, 2026
  (the day after Thanksgiving); CTA's page only says "early September through mid-June". The app should show what the
  GTFS and live feed say and never guess from the academic calendar.
- Whether route 10 stays daily after Nov 30, 2026 (the end of the current timetable). Its page lists no season limit.
- Fares and student passes: out of scope; the app should not say anything about fares.

## 3. Data sources compared (checked 2026-11-06)

"CORS: none" means a request sent with `Origin: https://blobberus.github.io` came back without an
`Access-Control-Allow-Origin` header, so a browser page on GitHub Pages cannot read the answer.

| Source | What it gives | Address | Key | CORS | Freshness | Limits | Use it for |
|---|---|---|---|---|---|---|---|
| CTA GTFS (static) | All CTA bus and rail routes, stops, shapes, timetables, calendar, transfers | `https://www.transitchicago.com/downloads/sch_data/google_transit.zip` | None | None | "Generally, once every week or two"; one package at a time, about two months ahead. Today's zip: Last-Modified 2026-09-14, calendar 2026-09-11 to 2026-11-30 | 69 MB zip; `stop_times.txt` is 367 MB unzipped, `shapes.txt` 54 MB | Build time only (GitHub Action), never in the browser |
| CTA Bus Tracker API v3 | Vehicle positions, arrival predictions (about the next 30 min), patterns (shapes), stops, directions, detours | `https://www.ctabustracker.com/bustime/api/v3/<call>?key=...&format=json` | Yes, secret; one per CTA Bus Tracker account | None | About every 30 s | 100,000 requests a day per key by default (raised from 50,000 in April 2024; more on request); at most 10 routes, vehicles or stops per call | Live buses and predictions, through the proxy |
| CTA GTFS-realtime (beta) | VehiclePositions, TripUpdates, ServiceAlerts in `.pb` and `.json` | `https://transitdata.transitchicago.com/GtfsRealtime/VehiclePositions.json?key=...` (also `TripUpdates`, `ServiceAlerts`) | Yes ("Register through the CTA Developer Center"; the page does not say which key) | None seen (only the no-key error answer could be tested) | Not stated | Not stated | Later: the same format as Passio, but labeled "Beta Testing" and bus coverage not confirmed |
| CTA Customer Alerts API | Route status and full alert text | `https://www.transitchicago.com/api/1.0/alerts.aspx?routeid=171,172&activeonly=true&outputType=JSON` (also `routes.aspx`) | None | None | Answers are cached 30 s | Not stated | Alerts for the chosen routes, through the proxy |
| CTA Train Tracker API | 'L' train arrivals only | `/developers/traintracker/` | Yes (50,000 a day) | n/a | n/a | n/a | Not needed for buses |
| Metra GTFS-realtime | Metra positions, trip updates, alerts (protobuf) | `gtfspublic.metrarr.com` with an `api_token` key, updated every 30 s | Yes | Not checked | 30 s | Not stated | A later idea only: the Metra Electric line stops in Hyde Park (51st/53rd, 55th-56th-57th, 59th) |

### What each source looks like in practice

- **GTFS static.** Standard files: agency, calendar, calendar_dates, frequencies, routes, shapes, stop_times, stops,
  transfers, trips, plus `developers_license_agreement.htm`. No `feed_info.txt`. `route_id` is the public route
  number as text ("4", "171", "X4", "J14") and is the same value Bus Tracker calls `rt`. `trips.txt` has a readable
  `direction` (North, South, East, West) besides `direction_id`. 132 routes in all (rail included, with ids such as
  `Red` and `G`). CTA's `route_color` values are generic (express red `#b71234`, locals grey `#99999C` / `#414145`),
  so they do not identify a route.
- **Bus Tracker v3 calls we would use.** `getvehicles` (`rt=` up to 10 routes), `getpredictions` (`stpid=` up to 10
  stops, or `vid=` up to 10 vehicles; `top=` caps the count), `getpatterns` (`rt=` one route, or `pid=` up to 10),
  `getstops` (`rt` + `dir`), `getdetours`, `gettime`. Times are Chicago local `YYYYMMDD HH:MM` unless `unixTime=true`
  (milliseconds) is sent; `tmres=s` gives seconds. `prdctdn` is minutes or `DUE`. Prediction fields worth honoring:
  `dly` (delayed), `dyn` (1 canceled, 4 expressed = drop-off only, 16 and 17 invalidated: CTA says these must not be
  shown to the public), `psgld` (crowding). Errors arrive inside a normal 200 answer, for example
  `{"bustime-response": {"error": [{"msg": "Invalid API access key supplied"}]}}` and "Transaction limit for current
  day has been exceeded."
- **Why predictions need the schedule too.** Bus Tracker only predicts about 30 minutes ahead (CTA says so on the
  developer page). Anything later must come from the GTFS timetable and be labeled as a scheduled time.
- **Detours are common.** Two of the priority routes had reroutes on the day of checking (172 northbound, Nov 5 to 20;
  192 northbound since Dec 2025). Bus Tracker v3 marks detour patterns with a `dtrid`, and the Alerts API carries the
  text. The plan shows the alert text verbatim, like the shuttle alerts.

### Terms that apply (CTA Developer License Agreement and "CTA Trademarks & You")

- Using any CTA data or API means accepting the Developer License Agreement (`/developers/terms/`; a copy also ships
  inside the GTFS zip). CTA may change it, cut access or disable apps at any time; on termination the data must be
  deleted.
- Use is limited to "the sole purpose of assisting mass transportation (i.e., bus or rail) riders". Caching is allowed
  ("You may cache CTA Data ... to improve your application's user experience") as long as it is kept reasonably
  current. CTA data may not be sold apart from the app.
- **No endorsement:** "You and your application must not express or imply any affiliation or relationship with or
  sponsorship or endorsement by CTA." Never "official" or "authorized" next to a CTA mark.
- **No CTA logo** of any kind, current or past. The Bus Tracker icon may appear only next to live Bus Tracker data,
  unmodified, black, white or grey, with the line "CTA Bus Tracker (SM) logo icon is a trademark of the Chicago
  Transit Authority." Simplest: do not use the icon at all.
- The app name must not start with "CTA" or name a CTA service. "Straight Bussing" is fine as is; do not rename it to
  include CTA.
- Attribution is optional ("the option, but not the obligation, to credit CTA"). We should credit anyway, in the
  words CTA suggests: "Data provided by CTA", plus "Straight Bussing is not made or endorsed by the CTA."
- Official 'L' line colors may be used; there are no official bus route colors to borrow.

## 4. Architecture options and trade-offs

The app is a static site with no build step and no server (ship checklist 7), and the iPhone app is a native port of
the same logic. CTA data needs two things the app does not have for Passio: a conversion step for a schedule file the
browser cannot download (the repo already has one, as a GitHub Action) and a place to keep a secret key for live data
(new).

### 4.1 Schedule (stops, shapes, timetables)

| Option | How | Verdict |
|---|---|---|
| A. Build-time conversion | A daily GitHub Action runs `tools/build_cta.py`: download the zip (skip when `Last-Modified` / `ETag` did not change), stream `stop_times.txt` once, keep only the chosen routes, write small `web/data/cta/*.json`, commit, deploy with Pages. Same pattern as `tools/build_gtfs.py` and `pages.yml` | **Recommended.** No key, no server, works offline (service worker precache), the iPhone app gets the same files |
| B. Bus Tracker `getpatterns` / `getstops` at build time | Same Action, key stored as a repository secret | Gives shapes and stops but no timetable, and spends key quota. Use GTFS instead |
| C. Browser downloads the zip | | Impossible: no CORS, 69 MB |

Keep the output small, because Hyde Park routes are long (route 4 runs from downtown to 115th Street, 122 stops). Store
each distinct stop pattern once (stop ids plus minutes from the first stop) and each trip as `[pattern, start minute,
service]`. Rough size for the 14 routes: well under 200 KB uncompressed, loaded after first paint, never blocking it
(ship checklist 3).

### 4.2 Live buses, predictions and alerts

| Option | How | Verdict |
|---|---|---|
| A. Direct calls from the page or the app | The page fetches `ctabustracker.com/bustime/api/v3/...?key=...` itself | **Not possible.** No CORS header, so browsers refuse to read the answer. The key would be public (anyone could copy it from the site or the app binary, burn the daily quota or get it revoked). Each rider would spend quota on their own (section 6.3) |
| B. Scheduled GitHub Action snapshot | An Action polls CTA and commits a JSON file that Pages serves | **Too slow for live.** Cron runs at most every 5 minutes and GitHub often fires it late (this repo saw 4 to 5 hour gaps, DC-013); Pages adds a deploy delay. Times would be minutes old and the stale pill would show "late" or "old" most of the time. Fine for the schedule, not for buses |
| C. Tiny proxy that holds the key | A Cloudflare Worker (or similar) with the key as a secret. One public read-only endpoint, for example `GET /cta/v1/live.json`, answers every rider from a 25 s cache; on a miss it makes the CTA calls for the whole Hyde Park set and converts them | **Recommended.** Key stays secret, CTA quota no longer grows with riders, the Worker adds the CORS header for the Pages origin, and the iPhone app uses the same URL |
| D. CTA's GTFS-realtime (beta) behind the same proxy | The Worker reads `VehiclePositions.json` and `TripUpdates.json` (whole city) and keeps our routes | **Later.** Fewer calls (2 per refresh) and already GTFS-realtime, but it is a beta, its bus coverage and key type are not confirmed, and filtering a whole-city file every 30 s may need more than the free plan's 10 ms of CPU per request. Design C's output so the source behind it can switch to D without an app change |

**Proxy contract (option C).** One JSON answer with the three feeds in the GTFS-realtime JSON shape `data/live.js`
already parses for Passio (`{vehiclePositions, tripUpdates, serviceAlerts}`, each `{header:{timestamp}, entity:[...]}`),
plus `{source:'cta-bustracker-v3', generated, ok, errors:[]}`. Every id is namespaced: route `cta:171`, stop
`cta:14020`, vehicle `cta:8123`, trip `cta:<tatripid>`. Bus Tracker fields map as: `vid` to the vehicle id,
`lat` / `lon` / `hdg` to the position, `tmstmp` to the vehicle timestamp (Chicago local time converted to unix seconds,
or ask with `unixTime=true`), `prdtm` to `stop_time_update.arrival.time`, `dyn` 1 (canceled) and 4 (drop-off only) to a
flag the app shows, `dyn` 16 and 17 (invalidated) dropped. Alerts keep CTA's text verbatim and get
`informed_entity.route_id = cta:<rt>`. The request carries nothing from the rider: no location, no stop, no route
choice. Every rider gets the same answer and the filtering happens on the device.

**Worker behavior.**
- Cache the converted answer for 25 s (CTA refreshes about every 30 s); send `Cache-Control: max-age=15`.
- On a CTA failure keep serving the last good answer with `ok:false` and its real `generated` time, so the app's stale
  rules flag it. Never put a fresh timestamp on old data.
- Daily budget guard: count CTA calls; above 80,000 in a day stop calling CTA and answer `ok:false, errors:['budget']`.
- `Access-Control-Allow-Origin` only for `https://blobberus.github.io` (the live site and the experimental test site
  share that origin); no cookies; GET only.
- No request logging (Cloudflare Workers Logs off), so no IP address or request time is kept (section 5.8).
- Fetch alerts every 2 minutes, not on every refresh.

**Other hosts.** Deno Deploy, Netlify or Vercel functions, or a small VPS work the same way. A Google Apps Script web
app (the owner already runs one for usage statistics) could proxy too, but its URL Fetch quota and slow cold answers
make it a poor fit for a 30 s live feed. Cloudflare's free plan (100,000 Worker requests a day, cached answers
included) covers about 5,000 ten-minute visits a day when the app polls every 30 s (section 6.3); the paid plan ($5 a month, 10 million
requests a month) covers far more. Deploying a Worker normally uses `wrangler` (Node), which this PC does not have:
paste the script in the Cloudflare dashboard, or deploy from a GitHub Action with `cloudflare/wrangler-action`.

### 4.3 The iPhone app

- **Live:** the same proxy URL. `FeedClient` gets a second source (CTA) beside Passio, with the same ephemeral session
  and no background polling. The key is never in the app: strings in an app binary can be extracted, and all installs
  would share one daily quota.
- **Schedule:** the bundled `web/data` copy plus the existing daily `ScheduleUpdate` check, with `cta/*.json` added to
  its file list and its validity checks (ids match across files, stops near Hyde Park).
- Apple's transit data in MapKit has no public API for live CTA vehicles or predictions, so it cannot replace the
  proxy.

### 4.4 Recommended shape

```
CTA GTFS zip --(daily Action: tools/build_cta.py)--> web/data/cta/*.json --(Pages)--> website, iPhone app (bundled + daily check)
CTA Bus Tracker v3 + Alerts --(Worker: key secret, 25 s cache, budget guard)--> /cta/v1/live.json --> website (CORS), iPhone app
Passio feeds --(unchanged)--> website, iPhone app
```

The two live sources stay separate end to end: separate fetch, separate stale state, separate failure. A CTA outage
must never mark the shuttles stale, and a healthy shuttle feed must never hide a stale CTA feed.

## 5. Step-by-step implementation plan

Order matters: each step leaves the app working, and the shuttles never depend on anything CTA. Build it on the
experimental repo first (the owner's process), then port to the live repo. File names below follow the live repo's
layout; where the experimental build chose a different name, use its name and update this file.

### 5.1 Owner steps first (nothing live works without them)

1. **Bus Tracker key.** Sign in to (or create and activate) a CTA Bus Tracker account at ctabustracker.com, open
   **My Account**, follow the **Developer API** link and apply. One key per account; CTA emails it after approval.
   Use an account the owner controls long term (the project's own email, not a shared or school account).
2. **Terms.** Read and accept the CTA Developer License Agreement (`/developers/terms/`). Save the approval email and
   a PDF of the terms as accepted: App Review may ask for proof of permission (section 6.2).
3. **Proxy host.** Create a free Cloudflare account, a Worker (for example `straight-bussing-cta`), and add the key as
   the secret `CTA_KEY`. Turn off Workers Logs. Note the Worker URL for `CTA_LIVE_URL` (step 5.4).
4. **Optional, later.** Ask CTA (through the Developer Center contact) which key the GTFS-realtime beta uses and
   whether it covers buses.
5. Answer the open questions in section 8.

### 5.2 Schedule build: `tools/build_cta.py` and its workflow

`tools/build_cta.py` (Python 3.11, standard library only, like `tools/build_gtfs.py`):

- **Route list** in one editable file, `tools/cta_routes.json` (phase by phase: `["171","172","192"]` first).
- **Download** with a conditional GET; keep the zip's `Last-Modified` / `ETag` in `web/data/cta/meta.json` and exit
  early when nothing changed (the zip is 69 MB and changes every week or two).
- **Stream** `stop_times.txt` once with `csv.reader` (367 MB unzipped), keeping only trips of the chosen routes. Times
  past 24:00 belong to the previous service day, as in the Passio build.
- **Write** to `web/data/cta/` (every id with the `cta:` prefix):
  - `routes.json`: `{"cta:171": {short:"171", long:"U. of Chicago/Hyde Park", color, text_color, agency:"cta", url}}`
    with our own colors (section 5.5), not CTA's greys.
  - `stops.json`: `{"cta:14020": {name, lat, lon, code}}`, only stops of the chosen routes.
  - `shapes.json`: the main shape per direction (at most 2, like `MAX_SHAPES_PER_DIR`), simplified to about 5 m.
  - `route_stops.json`: `{"cta:171": {"North": [...], "South": [...]}}`. CTA routes are two-direction lines, not the
    Passio loops (`first == last`), so this is a new shape; core code must not assume a loop for `cta:` routes.
  - `service.json`: day spans in the same format as the Passio `service.json`, so `core/schedule.js`,
    "Hours & service" and Lines by Time work unchanged.
  - `timetable.json`: patterns (stop ids + minutes from the first stop) and trips (`[pattern, start, service]`) plus
    the service calendar, for times beyond Bus Tracker's 30-minute horizon.
  - `links.json`: CTA stop to Passio stop pairs within 60 m (same corner), for "also served by" lines (section 5.5).
  - `meta.json`: `generated_utc`, `source`, `last_modified`, `calendar_start`, `calendar_end`.
- **Safety** (as in `build_gtfs.py`): build everything first, then write; an empty or broken zip never replaces good
  files. Fail the run when `calendar_end` is less than 7 days away (CTA's zip of 2026-09-14 ends 2026-11-30), and the
  app must stop showing CTA schedule times past `calendar_end` instead of guessing.

Workflow: a step in `pages.yml` (which already refreshes the Passio GTFS daily) or a separate `cta.yml`, daily around
5 AM Chicago time, committing `web/data/cta/` only when it changed. Keep it independent of the Passio step
(`continue-on-error`, a line in the run summary), so a CTA server problem never blocks the shuttle refresh.

### 5.3 The proxy: `tools/cta-proxy/`

- `tools/cta-proxy/transform.js`: pure functions (no fetch, no globals) that turn Bus Tracker answers into the GTFS-
  realtime JSON of section 4.2. Being a plain ES module, the browser test runner tests it like any `core/` file.
- `tools/cta-proxy/worker.js`: the Cloudflare module Worker (about 150 lines): routes `GET /cta/v1/live.json` and
  `GET /cta/v1/health` (counts only: last refresh, calls today, last CTA error); everything else 404.
- **Calls per refresh** (all with `format=json&tmres=s&unixTime=true`): `getvehicles?rt=` in groups of 10 routes, then
  `getpredictions?vid=` in groups of 10 for the vehicles within about 3 km of Hyde Park (at most 6 calls). Predictions
  by vehicle give each bus its whole list of upcoming stops, which trip following ("Get off in 2 stops") needs;
  predictions by stop would cover only 10 stops a call. Alerts from `alerts.aspx?routeid=...&activeonly=true&outputType=JSON`
  every 2 minutes (no key needed, no quota used). Patterns and detours (`getpatterns`, `getdetours`) every 10 minutes,
  only to mark a route as detoured.
- **One refresh for everyone.** A single Durable Object holding the cache and the call counter gives one CTA refresh
  for all Cloudflare locations and an exact daily count (check that Durable Objects are on the current free plan; if
  not, the per-location Cache API plus the design bound in section 6.3 is enough).
- **Errors.** CTA answers errors inside a 200 response; map "Transaction limit for current day has been exceeded" to
  `ok:false, errors:['cta-limit']` and any other error to `ok:false` with the message, always with the last good data
  and its real time.
- **Deploy** from the Cloudflare dashboard (paste) or a `cta-proxy.yml` Action with `cloudflare/wrangler-action`
  (Node runs in CI only). Keep the deployed copy identical to the repo file.

### 5.4 Web data layer

- `web/js/data/static.js`: after the Passio files load and first paint is done, load `data/cta/*.json` (idle time) and
  add them to the store. Missing or broken CTA files mean "no CTA", never an error for the shuttles.
- `web/js/data/cta.js` (the experimental build calls it `cta-live.js`): `startCtaLive(store, {url, intervalMs:30000})`
  polls the proxy, parses with the same `parseBuses` / `parseTrips` / `parseAlerts` that `data/live.js` exports,
  applies the CTA operating rule, and writes **separate** store keys: `ctaBuses`, `ctaTrips`, `ctaAlerts`,
  `ctaFeedTs`, `ctaLastOk`, `ctaFailed`. It pauses when the page is hidden and polls on return, like `live.js`.
  Polling faster than 30 s buys nothing (CTA refreshes every 30 s).
- One constant `CTA_LIVE_URL` (like `USAGE_URL`); empty means phase 0, schedule only, no request to any proxy.
- Keeping CTA in its own keys means nothing that reads `buses` / `trips` today (the collector's assumptions, bus
  numbering, off-route hiding, Passio alert mapping) picks up CTA by accident. Code that should show both asks for
  both through small helpers (`allBuses(state)`, `allTrips(state)`) in `core/agency.js`.

### 5.5 Core logic for a second agency

- **Ids.** New `core/agency.js`: `CTA = 'cta:'`, `isCta(id)`, `agencyOf(id)`, `ctaId(raw)`, `rawId(id)`. Route, stop,
  trip and vehicle ids carry the prefix everywhere: in the store, in saved settings (hidden routes, favorites, custom
  routes), in URLs. Passio ids stay as they are and keep joining Passio's `routes.txt` only; CTA's numeric stop ids
  (for example `1529`) would otherwise collide with Passio's. `alertRouteIds` (Passio's shape-id aliases) never
  applies to CTA.
- **Colors and shapes.** CTA's `route_color` values are generic greys, and grey means "hidden" or "faded" in this
  app. Give CTA routes their own colors from a fixed set that differs from every Passio color and passes contrast in
  light and dark (docs/DESIGN.md "1b"), square stop markers, a distinct bus badge, and a "CTA" text tag on every row,
  so agency is never shown by color alone.
- **Stops are linked, never merged.** `links.json` pairs nearby stops. A shuttle station page shows "CTA here: 171,
  172" with the walk; a CTA stop page shows the shuttles there. The records stay apart (different ids, names and
  arrival sources). The planner does not need the links: its 150 m transfer walk already connects them.
- **Operating rule** (`core/operating.js`): a CTA vehicle counts when its timestamp is at most 5 minutes older than
  the proxy's `generated`, its route is a known `cta:` route, and the route is in the configured list. CTA buses skip
  `core/offroute.js` at first: Bus Tracker reports detours itself, and a detoured CTA bus is a real bus.
- **Arrivals** (`core/arrivals.js`): arrivals carry `agency` and `source`: `cta-live` (a Bus Tracker prediction) or
  `cta-schedule` (the timetable, used only past the predictions or when the proxy is down). Canceled (`dyn` 1) shows
  as "Canceled", drop-off only (`dyn` 4) as "Drop-off only"; invalidated trips never reach the app.
- **Staleness.** `staleLevel` runs per source. The status pill shows the worst state among the sources on screen; when
  only CTA is behind it says so ("CTA times delayed"). A failed proxy shows CTA rows as unavailable or "Scheduled",
  never as live.
- **Schedule** (`core/schedule.js`, `core/timeactive.js`): reuse with `cta/service.json`; Lines by Time lists CTA
  routes in their own group.
- **Visibility** (`core/visibility.js`): hidden CTA routes persist like any route; the default (shown or hidden) is an
  owner question.
- **Bus numbers** (`core/busnum.js`): number CTA buses within a CTA route only; whether to show CTA's own bus numbers
  instead is an owner question.
- **Planner** (`core/planner.js`, phase 3): CTA bus legs board and alight at CTA stops; ride time from same-trip
  predictions, else the timetable, else distance at 18 km/h; wait from predictions within 30 minutes, else the
  timetable. Each `BusLeg` gets `agency` and `source` (`cta-live` / `cta-schedule`) and every number stays "est.".
  Transfers between agencies use the existing transfer walk rule. No fares. Keep planning under 50 ms on a phone with
  the extra stops (limit CTA candidates to the walking radius, as today). `core/coverage.js` keeps measuring distance
  to the campus shuttle routes unless the owner decides CTA should widen coverage.
- **Words** (`core/text.js`, iOS `Wording`): "CTA 171", "CTA live", "CTA schedule", "est.", "Data provided by CTA",
  "Not made or endorsed by the CTA". No dash characters in UI text (docs/DESIGN.md).
- **Trip alerts** (`core/tripyou.js`, `core/notify.js`): work for CTA legs through the same trip evaluation, as long as
  the leg has a CTA trip id and vehicle predictions; notifications keep "Unofficial."

### 5.6 Map and screens

- **Map** (`map/layers.js`, `map/landmarks.js` untouched): CTA bus badge with its own shape and the route number,
  square CTA stops, CTA lines drawn under the shuttle lines by default (map order is user-editable as today), thinner
  at low zoom so long routes do not crowd campus.
- **Routes list** (`ui/views/routes.js`): a separate "CTA buses" group below the shuttles, every row tagged "CTA",
  the group footer "Data provided by CTA. Not made or endorsed by the CTA."
- **Route page** (`ui/views/route.js`): North / South (or East / West) instead of a loop rail; CTA alerts verbatim;
  contact for CTA routes: CTA Customer Service 1-888-YOURCTA (1-888-968-7282) and the route's transitchicago.com
  page. 773.702.8181 stays wherever the shuttles or rider safety are concerned.
- **Station page** (`ui/views/stop.js`): one time-sorted list, each row tagged by agency and source.
- **Route search** (`core/routesearch.js`): "171", "cta 4", "cottage grove" find CTA routes.

### 5.7 iPhone app (Kit ports first)

Mirror every core change in `ios/StraightBussingKit` and add a row to the parity matrix in `ios/README.md`:
`Agency.swift` (ids), `StaticModels` / `StaticLoader` (CTA files optional), `LiveModels` / `FeedClient` (the CTA source
with its own stale state), `Operating`, `Arrivals`, `Schedule`, `Planner` / `PlannerRefine`, `TripFollow`,
`BusNumbers`, `Wording`, `ScheduleUpdate` (file list and checks). Tests use the **same JSON fixtures** as the web
(recorded proxy answers and a small `cta/*.json` set) and compare with results produced by the web JS, the way
`Geometry` uses golden paths. App side: square CTA stops and the CTA bus badge in `MapScreen`, the CTA group in
Routes, Credits and About lines, "CTA 171" in the Live Activity. Built and tested only in CI (`ios.yml`; no Mac here).

### 5.8 Privacy page, About and Credits

- `web/privacy.html`, "What leaves your device": add, in plain words, "CTA bus data. The app downloads CTA bus
  positions, arrival predictions and alerts for the Hyde Park routes from <proxy address>, a small service run for
  Straight Bussing that gets them from the CTA. The request contains nothing about you: no location, no stop, no
  search. Like any web server it sees your IP address to answer, and it keeps no log." Update the effective date.
- The same words in About (`ui/views/about.js`), iOS About and Settings, and the privacy line of ship checklist 6 in
  `.claude/rules/project.md` (all four must match).
- App Privacy label: stays "Data Not Collected" only while the proxy keeps nothing (Apple counts data as collected
  when it is kept longer than needed to answer the request). Check again before submitting.
- Settings > Credits: "CTA bus data: Data provided by CTA (Chicago Transit Authority). Straight Bussing is not made or
  endorsed by the CTA." (Crediting CTA is fine; the Credits rule only excludes UChicago.)
- `web/js/data/usage.js`: no change. Never add CTA choices to usage rows without a new owner decision.

### 5.9 Service worker

Precache `web/data/cta/*.json` with the rest of `data/` (`tools/test_precache.py` must pass), bump `sb-v2-<n>` in the
commit that adds the files, and never cache the proxy (cross-origin answers are already never cached). The daily CTA
refresh then behaves like today's daily Passio refresh.

### 5.10 Tests

- **Python:** `tools/test_build_cta.py` with a tiny fixture zip (3 stops, 2 trips, a 25:10 time, a `calendar_dates`
  removal, a holiday on Sunday service) checked against expected JSON; run it in `collector-tests.yml` or a new job.
- **Browser** (`tools/run_browser_tests.py`), new files: `core-agency.js` (a Passio stop `1529` and `cta:1529` never
  mix; saved settings keep prefixes), `cta-transform.js` (Bus Tracker fixtures to GTFS-realtime JSON: times, `dyn` 16
  and 17 dropped, `dyn` 1 flagged, an error answer becomes `ok:false` with the old time), `data-cta-live.js` (proxy
  down: `ctaFailed` true and the Passio state untouched; old `generated`: "old"), plus cases in the existing arrivals,
  planner, visibility, routes and route view tests (CTA tag text, contact line, schedule fallback labeled), and an e2e
  test with a stubbed proxy.
- **Demo mode** (`?demo=1`): simulate CTA buses from `cta/timetable.json` the way `data/demo.js` does for the
  shuttles, never mixed with live data.
- **iOS:** Kit tests mirroring the above, in CI.
- **Before every ship:** headless Edge screenshots in light and dark, the full browser suite, `test_precache.py`.

## 6. Terms, App Store and rate limits

### 6.1 CTA terms and attribution checklist (tick before CTA ships)

- [ ] The key is approved on the owner's account, the owner accepted the Developer License Agreement, and the email
      and a PDF of the terms are saved.
- [ ] "Data provided by CTA" in Settings > Credits and in the Routes "CTA buses" group footer.
- [ ] "Straight Bussing is not made or endorsed by the CTA." in About, `privacy.html` and the App Store description.
- [ ] No CTA logo (current or past), no Bus Tracker icon, no CTA map or brochure copied into the app (link to
      transitchicago.com instead). "CTA" appears only as a plain-text tag ("CTA 171"), never first in any name, never
      next to "official" or "authorized".
- [ ] CTA data kept current: the daily schedule build, the 25 s live cache, and no CTA schedule times past
      `calendar_end`.
- [ ] If CTA ends the license: remove `web/data/cta/`, disable the Worker, ship an update without CTA (the shuttles
      keep working because nothing depends on CTA).
- [ ] The app stays free; CTA data is never sold or offered apart from the app.

### 6.2 App Store notes

- **Guideline 5.2.2** (third-party services): an app that shows content from a third-party service must be allowed to
  by that service's terms, and must show the authorization on request. Put the CTA license acceptance and the key
  approval in the App Review notes, next to the existing written permission from UChicago Transportation / Passio.
- **Guideline 5.2.1** (third-party trademarks): no CTA logos or anything that suggests CTA endorses the app. Keep
  "CTA" out of the app name and subtitle; the description may say "Also shows CTA buses near campus. Data provided by
  CTA. Straight Bussing is not made or endorsed by the CTA."
- **Accurate metadata (2.3):** show CTA in screenshots only from the build that has it.
- **Reviewers may open the app at night or while the proxy is down.** The CTA rows must then read clearly as
  unavailable or scheduled, and the shuttles must work as before. Mention in the review notes that demo mode simulates
  CTA buses too (once it does).
- **App Privacy label:** unchanged ("Data Not Collected") as long as the proxy keeps nothing; the privacy policy page
  must name the proxy (section 5.8).
- When CTA ships, add these points to the review notes in `docs/APPSTORE-SUBMIT.md`.

### 6.3 Rate-limit budget

Two separate budgets: **CTA calls** (100,000 a day per key) and **Worker requests** (100,000 a day on Cloudflare's
free plan, cached answers included).

**CTA calls through the proxy do not grow with riders.** Worst case: all 14 routes, service around the clock, a refresh
every 25 s (3,456 refreshes a day):

| CTA call | Calls per refresh | Calls a day (worst case) |
|---|---|---|
| `getvehicles` (14 routes, 10 per call) | 2 | 6,912 |
| `getpredictions` by vehicle (up to 60 buses near Hyde Park, 10 per call) | up to 6 | up to 20,736 |
| `getdetours` / `getpatterns` (every 10 minutes) | about 2 per 10 min | about 288 |
| Customer Alerts API (every 2 minutes) | no key, not counted | 0 |
| **Total** | | **about 28,000 (28% of the key)** |

Without a single shared cache (section 5.3) each Cloudflare location refreshes on its own; Chicago riders mostly reach
one or two, so the worst case is about 56,000. Phase 1 (171, 172, 192; 3 calls per refresh, 6 AM to 8 PM) needs about
6,000 calls a day. Real use is lower still: no rider in 25 s means no call, and most routes do not run all night.
CTA's own limit answer ("Transaction limit for current day has been exceeded") is reported as `ok:false` and the app
shows CTA times as unavailable.

**Why riders must not call CTA themselves** (besides the public key and the missing CORS header):
calls a day = riders x minutes open x polls a minute x calls a poll.

| Riders a day | Minutes open | Polling | Calls a poll | CTA calls a day |
|---|---|---|---|---|
| 300 | 10 | every 30 s (2 a minute) | 8 | 48,000 |
| 300 | 10 | every 10 s, like the Passio poll (6 a minute) | 8 | 144,000 (over the limit) |

At 10 s polling the key would run out at about 210 riders a day.

**Worker requests do grow with riders.** The app polls the proxy every 30 s while it is open and visible (hidden tabs
pause; the iPhone app polls only in the foreground): 20 requests per 10-minute visit, so the free plan's 100,000 a day
covers about 5,000 such visits. Past that, the paid plan ($5 a month, 10 million requests a month, about 330,000 a day)
covers far more. A Cloudflare rate-limiting rule per IP address (check what the plan includes) keeps one copied
script from using up the budget.

## 7. Phased rollout

Every phase: experimental repo first, owner review there, then the live repo with the ship checklist ticked, the
service worker cache name bumped, and iOS CI green.

| Phase | What ships | Needs from the owner | Done when |
|---|---|---|---|
| **0. Schedule only** | `tools/build_cta.py` + daily Action; 171, 172, 192 on the map (square stops, own colors), a "CTA buses" group in Routes, route pages with Hours & service and scheduled times labeled "CTA schedule" and "est.", Lines by Time. No bus markers, no live times, no proxy, no new party in the privacy page (files come from Pages) | Nothing (no key needed) | Build tests and browser suite green, headless shots light + dark, schedule stops at `calendar_end` |
| **1. Live 171 and 172 (and 192)** | The proxy, `data/cta.js`, live CTA buses and predictions, CTA staleness on its own, canceled / drop-off-only labels, CTA alerts verbatim, privacy page + About + Credits updated in the same release, App Review notes | Key, terms, Cloudflare account, the default shown/hidden choice | A week on the experimental site with the proxy's health page showing calls well under budget and no stale data shown as live |
| **2. All Hyde Park routes** | The rest of section 2: 55, 4, X4, 6, 2, 28, 15, 10, 59, then 47 and 63. Long routes drawn thin at low zoom (or clipped to the area, owner choice); performance check: first paint still under 2 s on a phone | Route list approval | First paint and planner timing unchanged within noise; map readable at the default zoom |
| **3. Planner** | CTA legs in Directions, shuttle to CTA transfers, Current trip and trip alerts on CTA legs, iPhone Live Activity for CTA legs; decide whether CTA widens the 800 m coverage note | Coverage decision | Planner tests with mixed trips; every CTA number labeled with its source and "est." |
| Later | CTA's GTFS-realtime (beta) as the proxy's source; Metra Electric (separate key and terms); logging CTA arrivals for learning, only if the owner asks | | |
