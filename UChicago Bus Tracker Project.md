# UChicago Bus Tracker Project

As of 6 October 2026 · Author: Nathan

> **Note for the model reading this:** This file is a project brief. The goal is a free, unofficial student app that shows UChicago shuttle locations live. The sections up to "Sources" match the shared project doc. The "Technical reference" appendix at the end adds the implementation details found during research. Every feed URL below returned live data on 6 October 2026.

The goal is a free, student-built app that shows UChicago's UGo and NightRide shuttles live, as a simpler alternative to the official Passio GO! app. The bus data the app needs is already public.

## The goal

Build a free app that answers one question fast: where is my shuttle, and when will it get here? It is for UChicago students, staff and visitors who ride the UGo daytime shuttles and the NightRide evening routes.

- **Why now:** UChicago switched shuttle tracking from TransLoc to Passio GO! on 1 August 2024. In February 2026 it added Citymapper as a second option, after a survey showed riders were unhappy with Passio GO!.
- **What it is not:** it does not replace or compete with the university's service. It reads the same live data and shows it in a simpler way.
- **Cost to riders:** free, with no ads and no account needed.

## What we found

Passio, the company that runs UGo tracking, already publishes UChicago's shuttle data in GTFS, the standard format Google Maps, Transit and Citymapper read. Anyone can download it with no login and no key. A check on the evening of 6 October 2026 showed 16 buses live.

| What it holds | Updates | Link |
| --- | --- | --- |
| Routes, stops, map lines, timetables (15 routes) | About once a day | [google_transit.zip](https://passio3.com/chicago/passioTransit/gtfs/google_transit.zip) |
| Where each bus is right now | Every few seconds | [vehiclePositions.json](https://passio3.com/chicago/passioTransit/gtfs/realtime/vehiclePositions.json) |
| Predicted arrival time at each stop | Every few seconds | [tripUpdates.json](https://passio3.com/chicago/passioTransit/gtfs/realtime/tripUpdates.json) |
| Service alerts, such as NightRide changes | As posted | [serviceAlerts.json](https://passio3.com/chicago/passioTransit/gtfs/realtime/serviceAlerts.json) |

The [Mobility Database](https://mobilitydatabase.org/feeds/gtfs/tld-4472), a public catalog of transit feeds, lists the schedule file as the University of Chicago's official feed. For CTA city buses such as the #171 and #172, the CTA runs its own [free developer API](https://www.transitchicago.com/developers/bustracker/).

## How it works

One server reads the public feed and serves every phone:

```
[UGo shuttles]  -->  [Passio feed]     -->  [Our server]          -->  [Student app]
GPS on each bus      public, no key         fetches every ~10 s        live map, arrivals
reports its spot     GTFS standard          one copy for all           NightRide alerts
```

Each bus reports its GPS position to Passio, and Passio publishes it as a public feed. Our server reads that feed every ~10 seconds and passes one copy to every phone, so a thousand riders cost Passio one request instead of a thousand. The app joins the live positions to the daily schedule file to name each route and draw it on the map.

## The approach

Build small, test with students, then launch.

1. **Build a prototype.** Make a simple map that loads routes and stops from the schedule file and moves bus icons every 10–15 seconds from the live feed.
2. **Add arrival times and alerts.** Show the next arrivals at the nearest stop, plus NightRide alerts.
3. **Add a small server.** One server fetches Passio's feed every ~10 seconds and passes it to every phone. That keeps the load on Passio low, and if a URL changes, the fix goes on the server and no App Store update is needed.
4. **Test with students.** Run a small beta, for example through TestFlight on iPhone, and compare the app's times against the buses on the street.
5. **Launch.** Publish with a clear note that the app is unofficial and a link to the university's own service.

## Risks and open questions

- **No stated license.** Neither UChicago nor Passio publishes terms for this feed. Passio's "Terms and conditions" link opens a [privacy policy](https://passio3.com/www/mapGetData.php?terms=1) (last edited April 2022) that says nothing about reusing the data. Public does not mean licensed, 
- **The feed could change.** Passio could add keys or limits, or move URLs, without notice. The server in step 4 limits the damage.
- **Rider safety.** NightRide is a safety service. The app must say plainly when bus data is stale, and always point riders to the official app and phone line.
- **Naming.** Avoid university names and logos, such as "UGo", unless UChicago approves them.
- **Still unknown:** whether UChicago's contract with Passio limits redistribution, and whether the feed has rate limits. Only UChicago or Passio can answer these.

## Sources

- [Passio GO! for UGo Shuttle Tracking](https://safety-security.uchicago.edu/news-alerts/2024-03-21-passio-go-for-ugo-shuttle-tracking): UChicago Safety & Security, 21 March 2024
- [University Partners With Citymapper Navigation App to Provide Shuttle Tracking Information](https://chicagomaroon.com/50513/news/university-partners-with-citymapper-navigation-app-to-provide-shuttle-tracking-information/): Chicago Maroon, 3 February 2026
- [Citymapper at UChicago](https://safety-security.uchicago.edu/Transportation/CityMapper): UChicago Safety & Security
- [University of Chicago GTFS feed](https://mobilitydatabase.org/feeds/gtfs/tld-4472): Mobility Database
- [Passio GO! terms and conditions page](https://passio3.com/www/mapGetData.php?terms=1): Passio Technologies
- [CTA Bus Tracker API](https://www.transitchicago.com/developers/bustracker/): Chicago Transit Authority
- [UChicago Transportation](https://safety-security.uchicago.edu/Transportation): contact page
- Live feed checks: the four Passio links in "What we found", opened 6 October 2026

---

## Appendix: Technical reference

These details come from direct checks of the feeds on 6 October 2026, around 7:45 pm Central.

**Identifiers.** UChicago's Passio system ID is `1068` and its username is `chicago`. The username is the `chicago` segment in the feed URLs, and the alerts use `agency_id` `1068`.

**Formats.** Each realtime feed comes in two forms:

- Passio's JSON form, at the URLs ending `.json`.
- The standard GTFS-Realtime protobuf, at the same URLs without `.json`, for example `.../gtfs/realtime/vehiclePositions`. To decode it, use Google's [gtfs-realtime.proto](https://github.com/google/transit/tree/master/gtfs-realtime/proto) with any protobuf library, such as [swift-protobuf](https://github.com/apple/swift-protobuf) on iOS.

None of the feeds needs a key. A cross-origin browser `fetch()` of `vehiclePositions.json` succeeded, so a browser-only web app can read the feed directly.

**Observed JSON shapes.** These are trimmed from live responses:

```json
// vehiclePositions.json
{"header":{"gtfs_realtime_version":"2.0","incrementality":0,"timestamp":1791333702},
 "entity":[{"id":"1","vehicle":{
   "vehicle":{"id":"4313","label":"1647"},
   "position":{"latitude":41.8024575,"longitude":-87.5891941,"speed":5.8,"bearing":270},
   "occupancy_status":1,"current_stop_sequence":16,"stop_id":"140009",
   "timestamp":1791333701,
   "trip":{"trip_id":"501597","route_id":"1075"}}}]}

// tripUpdates.json
{"entity":[{"id":"1","trip_update":{
   "vehicle":{"id":"4313","label":"1647"},
   "trip":{"trip_id":"501597","route_id":"1075"},
   "stop_time_update":[{"stop_id":"140009","stop_sequence":6,
      "arrival":{"time":1791334042,"datetime":"2026-10-06 19:47:22"},
      "departure":{"time":1791334043,"datetime":"2026-10-06 19:47:23"}}]}}]}

// serviceAlerts.json
{"entity":[{"id":"2","alert":{"informed_entity":[{"agency_id":"1068"}],
   "header_text":{"translation":[{"text":"Nightride Route Alert "}]},
   "description_text":{"translation":[{"text":"All evening NightRide routes will be running every 30 minutes..."}]},
   "active_period":[{"start":1791320880,"end":1791349234}]}}]}
```

**Joining live data to names and colours.** The `route_id` on each live bus matches `route_id` in `routes.txt` inside `google_transit.zip`, which gives `route_short_name`, `route_long_name` and `route_color`. Stop names and coordinates come from `stops.txt`, and the map lines come from `shapes.txt`.

**Minimal fetch (Swift, untested sketch).**

```swift
struct Feed: Decodable { let entity: [Entity] }
struct Entity: Decodable { let vehicle: Vehicle? }
struct Vehicle: Decodable { let vehicle: Info; let position: Position; let trip: Trip? }
struct Info: Decodable { let id: String; let label: String? }
struct Position: Decodable { let latitude: Double; let longitude: Double; let bearing: Double? }
struct Trip: Decodable { let route_id: String? }

let busURL = URL(string: "https://passio3.com/chicago/passioTransit/gtfs/realtime/vehiclePositions.json")!

func fetchBuses() async throws -> [Vehicle] {
    let (data, _) = try await URLSession.shared.data(from: busURL)
    return try JSONDecoder().decode(Feed.self, from: data).entity.compactMap(\.vehicle)
}
```

**Backup: Passio's internal web API.** The passiogo.com website uses this API. It is undocumented, versioned and could change without notice, so use it only for fields GTFS lacks, such as route colour or passenger load.

- Systems list: `GET https://passiogo.com/mapGetData.php?getSystems=2&sortMode=1&credentials=1`
- Live buses: `POST https://passiogo.com/mapGetData.php?getBuses=2` with the form field `json={"s0":"1068","sA":1}`. It returned HTTP 200 with fields `bus`, `latitude`, `longitude`, `route`, `routeId`, `paxLoad` and `outOfService`.
- Its route IDs (for example `38737`, "Central") do **not** match the GTFS `route_id` values (for example `1075`). Never mix the two ID spaces.
- An unofficial MIT-licensed Python wrapper documents it: [athuler/PassioGo](https://github.com/athuler/PassioGo) and [passiogo on PyPI](https://pypi.org/project/passiogo/).

**CTA fallback.** The [CTA Bus Tracker API](https://www.transitchicago.com/developers/bustracker/) is free with a key, which you request from a Bus Tracker account. The default limit is 100,000 calls a day, and use requires accepting CTA's Terms of Service.
