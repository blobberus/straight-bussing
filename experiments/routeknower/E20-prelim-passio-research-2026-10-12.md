# How Passio makes far-ahead predictions, and how they reach its app and ours (research, 2026-10-12)

Track 1 of the owner's request. Sources first, then the Passio GO! data path, a live side-by-side of the Passio GO!
app's ETA and the GTFS-Realtime time our app uses (with the real arrivals), and conclusions with confidence.
**Stated** = a source says it. **Observed** = we measured it today. **Inferred** = our reading; not confirmed.

## 1. Sources and what each says

| Source | What it says (about ETAs) |
|---|---|
| Passio, Real-Time Passenger Information (https://passiotech.com/real-time-passenger-information/) | Stated: Passio GO! shows "what time the bus is coming"; displays and AVA announcements are GPS driven. **No word on how ETAs are computed.** |
| Passio, Get Passio GO (https://passiotech.com/get-passio-go/), App Store listing (https://apps.apple.com/us/app/passio-go/id1203861956) | Stated: real-time locations and ETAs "for select agencies"; agencies may show or hide schedules; release notes mention a workflow for riders to "submit feedback on ETA quality". No method. |
| Passio, ETA Text Back blog (https://passiotech.com/blog/eta-text-back-takes-customer-service-to-new-heights/) | Stated: riders can text a stop code to get the next vehicle's ETA, an add-on to Passio GO!. No method. |
| Google Patents searches (Passio Technologies as assignee) | No arrival-prediction patent found for Passio. Unrelated patents (e.g. US6374176B1, US9020754B2) are not Passio's. |
| UChicago Safety & Security, Passio GO! page (https://safety-security.uchicago.edu/en/transportation/passiogo) and 2024 news (https://safety-security.uchicago.edu/en/news-alerts/2024-03-21-passio-go-for-ugo-shuttle-tracking) | Stated: real-time vehicle locations, alerts; app, website and lobby monitors. No ETA method or accuracy statement. |
| Chicago Maroon: TransLoc replaced by Passio GO! (https://chicagomaroon.com/43122/news/university-replaces-shuttle-tracking-app-transloc-with-passio-go/); Citymapper partnership (https://chicagomaroon.com/50513/news/university-partners-with-citymapper-navigation-app-to-provide-shuttle-tracking-information/) | Stated: migration in 2024; a survey found users dissatisfied with the app's features and real-time information; the University added Citymapper for live UGo tracking. No method. |
| GTFS-Realtime spec (https://gtfs.org/documentation/realtime/feed-entities/trip-updates/) | Stated: a format, not a predictor; arrivals may be absolute times or delays. Passio's feed uses absolute times only (observed). |
| `athuler/PassioGo` (https://github.com/athuler/PassioGo, docs https://passiogo.readthedocs.io/en/main/api/) | Stated in code: POST `https://passiogo.com/mapGetData.php?getRoutes=N` (`systemSelected0`), `?getStops=2` (`s0`, `sA`), `?getBuses=2` (`s0`, `sA`; fields busId, latitude, longitude, calculatedCourse, routeId, speed, paxLoad100, outOfService, tripId), alerts via `goServices.php?getAlertMessages=1`, live positions over the WebSocket `wss://passio3.com/` (`{"subscribe":"location", ...}`). **No ETA call** ("Live Timings: Not Yet Supported"). |
| `Parallactic/transit-kiosk`, UChicago section (https://github.com/Parallactic/transit-kiosk, `agencies.py`) | Stated (reverse-engineered from passiogo.com/index.js `queryStopEta`): GET `mapGetData.php?eta=3&stopIds=&userId=`. **Two code paths**: without `routeId` "a raw live-GPS-projection estimate that's frequently way off" (entries flagged e.g. "Probably, bus is in detour / on yard", "No valid GPS from the bus"); with `routeId` "a pre-computed 'solid' ETA, the same number passiogo.com's own site displays". Batching several stopIds breaks the solid path. UChicago is Passio system **1068**. |
| `rabeesr/uchicago-shuttle-eta` (https://github.com/rabeesr/uchicago-shuttle-eta, `apps/worker/src/passio/rest.ts`, `CLAUDE.md`) | Stated: eta=3 response `{"ETAs": {"<stopId>": [{secondsSpent (86400 = no bus), eta (display text), routeId, busName, outOfService, eta_note: "solid" or "got from schedule" ...}]}}`; calls Passio's ETA "a black box", "imprecise, laggy, sometimes way off"; builds its own (polyline projection + EWMA speed). |
| `younghyopark/mit-shuttles` (https://github.com/younghyopark/mit-shuttles, `src/api.js`) | Stated: eta=3 serves a **"solid" shape** ("Passio's DB-backed prediction": busName, secondsSpent, eta, etaR, solid:1, updatedSecAgo, scheduleTimes) and, when the solid DB lookup fails, a **"live" shape** (busId, routePointPosition, busProjectionLatlng, arrivalTimestamp, speed). One stop per request. They read `updatedSecAgo` as GPS staleness; our data says it is the age of the solid record (section 3). |
| `nhausspiegel/busbus` (Brown; via search snippet), `rheagupta31/Rutgers-Bus-Network-Optimization` README | Stated: private endpoints are POST with a JSON body except `schedule=4` and `eta=3` (GET); ETAs "update approximately every 10 seconds"; `getBuses=2` includes the driver's name (do not show or store it). |
| passiogo.com web client `index.js` (fetched once, 2026-10-12) | Observed in code: `queryStopEta` sends `mapGetData.php?eta=3&deviceId=..&stopIds=..&routeId=..&position=..&userId=..&routeIds=..`, optional `forceSolid=1`, `timelineIsActive=1&timelineDatetime=..` (predictions for a chosen future time), `debug2=1`; renders `etta.eta` (text), `etta.etaR` (minutes), `etta.secondsSpent`, `etta.scheduleTimes` ("Schedule: ..."), `etta.error`; marks solid ETAs with a dot titled **"eta cache"**; shows up to 3 buses (6 "for Chicago"); refreshes an open ETA every **10 s**; bus positions come from `getBuses` or the WebSocket. **All prediction math is server-side.** |

Not found: any public Passio description of its ETA model (historical run times, speed, schedule), any Passio
job posting describing an ETA engine, any Reddit thread with technical detail.

## 2. How data reaches the Passio GO! app (and ours)

```
bus GPS (about 1 report/s on board)  ->  Passio servers
   Passio GO! app / passiogo.com:   getBuses (REST) or wss://passio3.com (positions)
                                    eta=3 (GET, one stop + route per call) -> cached "solid" ETA rows, every 10 s
   Straight Bussing (web + iOS):    GTFS-Realtime JSON, passio3.com/chicago/passioTransit/gtfs/realtime/
                                    tripUpdates (stop_time_update arrival.time per stop), vehiclePositions, serviceAlerts
```
- **eta=3 entry fields (observed today, UChicago):** busName, driver (*a person's name: never stored or shown*), eta
  ("11 min", "3-4 min", "less than 1 min"), etaR, goShowSchedule, paxLoadS, scheduleNotEmpty, scheduleTimes,
  secondsSpent, solid (1), **solidEta** {id, busId = the GTFS-RT vehicle id, updated / updatedUtc, arrival /
  arrivalUtc, tripId, tripIndex, routeStopId, stopId, routeId (Passio id), routeGroupId (= GTFS route id), deviceId,
  scheduledArrival / scheduledDeparture (null in all 25 entries), arrivalActual (null), etaVersionId "1", duration =
  secondsSpent}, **updatedSecAgo** (age of the solid row).
- **GTFS-RT trip_update (observed):** trip {trip_id, route_id}, vehicle {id, label}, timestamp (refreshes about once
  a minute), stop_time_update [{stop_id, stop_sequence, arrival {time, datetime}, departure}]; **no delay, no
  uncertainty, no schedule_relationship**. Each bus on a timetabled route carries **two** trip_updates: the rest of
  its current trip and its whole next trip (e.g. bus 4324: trip 501471 to ~10 min ahead, 501472 from ~11 to 23 min);
  the Downtown Campus Connector (one frequency trip id, 874028) lists stops up to about 60 min ahead per bus.
- **Ids:** Passio route ids differ from GTFS route ids (East 38736 vs 1077; Midway Metra has two Passio ids, 38731
  and 38809, for GTFS 5703); `solidEta.routeGroupId` carries the GTFS route id; stop ids are shared; `solidEta.busId`
  equals the GTFS-RT `vehicle.id`; `busName` equals `vehicle.label`.

## 3. Same moment, same bus, same stop: Passio GO! app vs GTFS-RT (2026-10-12, 13:46 and 13:48 CDT)

16 requests to passiogo.com in total (1 web client fetch, 1 route list, 14 ETA calls, 4 s apart, random device id,
no owner data). Each ETA call was followed at once by a GTFS-RT tripUpdates fetch.

Error = predicted - actual (negative = the bus came later than shown). Actual = the collector's arrival of that bus
at that stop nearest the prediction (30 s to 1 h after the query). Cache age = `updatedSecAgo` (age of the solid row).

| query (CDT) | route | stop | bus | app says (min) | cache age s | GTFS-RT says (min) | actual (min) | app error s | GTFS-RT error s |
|---|---|---|---|---:|---:|---:|---:|---:|---:|
| 13:46:01 | Downtown Campus Connector | 8591 | 2207 | 10.6 | 2787 | 26.0 | - | - | - |
| 13:46:01 | Downtown Campus Connector | 8591 | 2201 | 16.9 | 55 | 16.8 | 24.6 | -461 | -468 |
| 13:46:01 | Downtown Campus Connector | 8591 | 2205 | 24.1 | 55 | 24.0 | 33.1 | -541 | -549 |
| 13:46:06 | 53rd Street Express | 8595 | 2203 | 9.3 | 362 | 17.3 | 18.1 | -528 | -44 |
| 13:46:10 | Friend Center/Metra | 8613 | 1661 | 11.0 | 283 | 14.8 | - | - | - |
| 13:46:14 | Apostolic/Drexel | 8613 | 1658 | 14.6 | 9 | 14.5 | - | - | - |
| 13:46:14 | Apostolic/Drexel | 8613 | 1657 | 29.6 | 9 | - | 29.9 | -17 | - |
| 13:46:19 | 53rd Street Express | 8596 | 2203 | 6.8 | 375 | 8.2 | 13.2 | -385 | -296 |
| 13:46:23 | Downtown Campus Connector | 132967 | 2201 | 0.9 | 18 | - | 2.0 | -61 | - |
| 13:46:23 | Downtown Campus Connector | 132967 | 2207 | 3.5 | 18 | 8.2 | - | - | - |
| 13:46:23 | Downtown Campus Connector | 132967 | 2205 | 7.9 | 18 | 7.1 | - | - | - |
| 13:46:27 | Apostolic/Drexel | 8612 | 1658 | 7.6 | 22 | 6.1 | 8.4 | -43 | -136 |
| 13:46:27 | Apostolic/Drexel | 8612 | 1657 | 16.2 | 22 | 15.4 | 17.2 | -59 | -112 |
| 13:46:32 | Red Line/Arts Block | 138836 | 1665 | 2.8 | 650 | 6.1 | - | - | - |
| 13:47:56 | Downtown Campus Connector | 8591 | 2207 | 8.6 | 2901 | 18.6 | - | - | - |
| 13:47:56 | Downtown Campus Connector | 8591 | 2201 | 16.6 | 51 | 15.9 | 22.7 | -369 | -408 |
| 13:47:56 | Downtown Campus Connector | 8591 | 2205 | 25.6 | 51 | 22.9 | 31.2 | -334 | -499 |
| 13:48:02 | 53rd Street Express | 8595 | 2203 | 7.3 | 478 | 15.4 | 16.1 | -527 | -44 |
| 13:48:09 | Friend Center/Metra | 8613 | 1661 | 9.1 | 402 | 12.8 | - | - | - |
| 13:48:13 | Red Line/Arts Block | 138836 | 1665 | 1.1 | 751 | 4.8 | - | - | - |
| 13:48:17 | Apostolic/Drexel | 8613 | 1658 | 12.6 | 13 | 12.5 | - | - | - |
| 13:48:17 | Apostolic/Drexel | 8613 | 1657 | 27.5 | 13 | 27.5 | 27.8 | -16 | -19 |
| 13:48:23 | Downtown Campus Connector | 132967 | 2207 | 1.6 | 19 | 1.5 | - | - | - |
| 13:48:23 | Downtown Campus Connector | 132967 | 2205 | 7.8 | 19 | 8.2 | - | - | - |
| 13:48:23 | Downtown Campus Connector | 132967 | 2202 | 17.1 | 19 | 16.1 | 23.5 | -383 | -443 |

Matched with a real arrival: 13 app predictions (11 with a GTFS-RT time for the same visit); no arrival logged for the other 12 within the hour (bus not detected at that stop, or the visit was beyond the window).

## 4. What the far predictions can be based on (structure only)

- **Server-side, not in the app** (stated by the client code). The app only formats `secondsSpent`.
- **Two Passio paths** (stated by two independent projects): a cached "solid" prediction (the normal path; the
  client labels it "eta cache") and a live GPS projection along the route shape (fallback).
- **Schedule anchoring for the next trip** (observed in the GTFS-RT snapshot of 13:50 vs `google_transit.zip`):
  a bus's *next* trip is predicted to reach its first stop early (5 to 12 min before the timetable, i.e. it ends the
  current trip early), then the later stops sit within about 1 min of the timetable: e.g. bus 12643, trip 681007,
  stop offsets vs timetable -4.9, +0.2, +0.3, -0.6, -0.5, -0.8, -1.1, -0.9 min. **Inferred:** beyond the current
  trip Passio predicts "leave the terminal at the scheduled time, then roughly scheduled run times". The current
  trip carries the live delay (12643, trip 681006: +3.5, +3.3, +3.0, +2.3, 0.0 min along the trip), shrinking toward
  the terminal, so it is not simply timetable + constant delay. The solid rows' `scheduledArrival` is null and some
  entries carry `eta_note: "got from schedule"` (rabeesr), so at least some solid ETAs are timetable-derived.
- **Frequency trip (DCC):** no timetable times exist (stop_times are frequency-based), so its long predictions must
  come from run times, not a schedule.

## 5. Conclusions (confidence)

(Written by the parent from sections 1 to 4 after the research run stopped early.)

- **All prediction math is on Passio's servers** (high): passiogo.com's client only formats `secondsSpent`; our app reads
  the GTFS-Realtime feed, which comes from the same servers with the same bus and stop ids.
- **The official app and our feed agree when the app's cached row is fresh** (medium): with a cache age under about a
  minute the two were within about a minute; with a cache 5 to 48 minutes old they differed by up to 8 minutes (53rd
  Street Express at 8595: app 9.3 min, feed 17.3, actual 18.1). 25 queries, 13 matched with a real arrival, one
  afternoon.
- **Both lean the same way** (medium): in all 13 matched app predictions the bus came later than shown, as in the
  feed (see `E20-prelim-passio-far-2026-10-12.md`).
- **Two Passio paths** (medium, stated by independent projects): a stored "solid" ETA and a live GPS projection
  fallback; some answers are "got from schedule".
- **How Passio learns run times, whether it uses traffic or history** (low): no public source; our measurements show
  fixed run times without dwell on the current trip and timetable anchoring for the next trip.
- Data protection note: the app's ETA rows include a driver name field; it was never stored or shown.
