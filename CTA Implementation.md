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
traffic; the paid plan is $5 a month), and answer the open questions in section 7.

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
