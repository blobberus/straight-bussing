import XCTest
@testable import StraightBussingKit

/// Passio filler times and a time at every station (web core/eta.js, tests/core-eta.js). The real feed is Passio's
/// tripUpdates + vehiclePositions of Fri Nov 20 2026 12:37 PM (Fixtures/eta_*.json): 53rd Street Express trip 681004 (bus
/// 134) lists 8596 in 12.5 min, then every stop of the lap 2 s after the one before.
final class StationTimesTests: XCTestCase {
    let T = 1_800_000_000.0

    func ups(_ times: [Double?], departure: Bool = false) -> TripUpdate {
        TripUpdate(trip: .init(tripId: "t", routeId: "R"), vehicle: .init(id: "v", label: "1"),
                   stopTimeUpdates: times.enumerated().map { i, t in
                       departure ? StopTimeUpdate(stopId: "S\(i)", departure: t) : StopTimeUpdate(stopId: "S\(i)", arrival: t)
                   })
    }
    func flags(_ tu: TripUpdate) -> [Bool] { StationTimes.markFiller(tu).stopTimeUpdates.map(\.filler) }

    func testFillerRule() {
        XCTAssertEqual(StationTimes.fillerS, 3)
        // the head of a run stays live; +0, +2, +3 s are filler; +4 s, earlier times and the first entry are not
        XCTAssertEqual(flags(ups([T + 600, T + 602, T + 604, T + 607, T + 611, T + 611, T + 500, T + 503])),
                       [false, true, true, true, false, true, false, true])
        // departure-only times count the same (arrival, else departure)
        XCTAssertEqual(flags(ups([T + 60, T + 62, T + 300], departure: true)), [false, true, false])
        // an entry without a time is never filler and does not break a run (web markFiller)
        XCTAssertEqual(flags(ups([T + 60, nil, T + 61, T + 63])), [false, false, true, true])
        XCTAssertEqual(flags(ups([T + 60, 0, T + 61])), [false, false, true])
        XCTAssertEqual(flags(ups([nil, T + 60, T + 300])), [false, false, false])
        // a zero arrival falls back to departure (StopTimeUpdate.time)
        let mixed = TripUpdate(trip: .init(tripId: "t", routeId: "R"), stopTimeUpdates: [
            StopTimeUpdate(stopId: "A", arrival: T + 100), StopTimeUpdate(stopId: "B", arrival: 0, departure: T + 102)])
        XCTAssertEqual(StationTimes.markFiller(mixed).stopTimeUpdates.map(\.filler), [false, true])
        XCTAssertEqual(flags(ups([])), [])
        XCTAssertEqual(flags(ups([T])), [false])
    }

    func testFillerIdempotentAndRecomputed() {
        let once = StationTimes.markFiller(ups([T + 600, T + 602, T + 900]))
        XCTAssertEqual(StationTimes.markFiller(once), once, "marking twice changes nothing")
        var wrong = ups([T + 600, T + 900])
        wrong.stopTimeUpdates[1].filler = true
        XCTAssertEqual(StationTimes.markFiller(wrong).stopTimeUpdates.map(\.filler), [false, false], "flags come from the times alone")
    }

    /// The parser marks the real feed (data/live.js parseTrips): 56 of its 86 stop times are filler.
    func testRealFeedMarkedByTheParser() throws {
        let feed = try FeedParser.tripUpdates(TS.fixture("eta_tripUpdates"))
        let all = feed.entities.flatMap(\.stopTimeUpdates)
        XCTAssertEqual(all.count, 86)
        XCTAssertEqual(all.filter(\.filler).count, 56)
        func trip(_ id: String, _ vid: String) throws -> TripUpdate {
            try XCTUnwrap(feed.entities.first { $0.trip.tripId == id && $0.vehicle.id == vid })
        }
        // 53rd Street Express (4346), bus 134: only the head 8596 is a forecast
        let x53 = try trip("681004", "4326")
        XCTAssertEqual(x53.trip.routeId, "4346")
        XCTAssertEqual(x53.stopTimeUpdates.map(\.filler), [false] + Array(repeating: true, count: 13))
        XCTAssertEqual(Array(x53.stopTimeUpdates.map { $0.time - feed.timestamp }.prefix(4)), [752, 754, 756, 758])
        // Apostolic (6126) bus 1651: real times with filler in between (+2 s at 8613, 8616, 225833)
        XCTAssertEqual(try trip("675901", "4317").stopTimeUpdates.filter(\.filler).compactMap(\.stopId), ["8613", "8616", "225833"])
        // +4 s is a real time (Apostolic/Drexel 499506 at 8616)
        XCTAssertFalse(try trip("499506", "4319").stopTimeUpdates.contains(where: \.filler))
        // the Connector reuses trip 874028 on four buses: each update is marked on its own, the heads stay live
        let dcc = feed.entities.filter { $0.trip.tripId == "874028" }
        XCTAssertEqual(dcc.count, 4)
        XCTAssertTrue(dcc.allSatisfy { !$0.stopTimeUpdates[0].filler && $0.stopTimeUpdates.dropFirst().allSatisfy(\.filler) })
    }

    /// Arrivals skip filler (web core/arrivals.js arrivalsFor; `filler: true` keeps them). Levi Hall (8630) in the real
    /// feed: Apostolic bus 1651 in 13 min is a forecast; the 53rd Street Express and the other Apostolic bus only carry
    /// filler there.
    func testArrivalsSkipFiller() throws {
        let feed = try FeedParser.tripUpdates(TS.fixture("eta_tripUpdates"))
        let now = feed.timestamp, trips = feed.entities
        XCTAssertEqual(Arrivals.arrivalsFor(trips: trips, stopId: "8630", now: now).map { $0.t - now }, [778])
        XCTAssertEqual(Arrivals.arrivalsFor(trips: trips, stopId: "8630", now: now, filler: true).map { $0.t - now }, [195, 758, 778])
        XCTAssertEqual(Arrivals.arrivalsFor(trips: trips, stopId: "8811", routeId: "4346", now: now), [], "53rd Express: only filler at 8811")
        XCTAssertEqual(Arrivals.arrivalsFor(trips: trips, stopId: "8596", routeId: "4346", now: now).map { $0.t - now }, [752], "the head stays")
        let idx = Arrivals.index(trips: trips), all = Arrivals.index(trips: trips, filler: true)
        for stop in ["8630", "8811", "8596", "8591", "8612"] {
            XCTAssertEqual(Arrivals.arrivals(in: idx, stopId: stop, now: now), Arrivals.arrivalsFor(trips: trips, stopId: stop, now: now), stop)
            XCTAssertEqual(Arrivals.arrivals(in: all, stopId: stop, now: now),
                           Arrivals.arrivalsFor(trips: trips, stopId: stop, now: now, filler: true), stop)
        }
    }
}

/// The planner and the bus alerts take no time from Passio's filler (web core/planner.js, core/notify.js), on the
/// planner tests' network.
final class FillerConsumerTests: XCTestCase, PlannerFixture {
    /// Boarding at the head of a run is a live wait; the alighting stop's filler time is no live ride: the ride is estimated.
    func testPlannerRidesNotFromFiller() {
        let trips = StationTimes.markFiller([PlannerTests.trip("t1", "LOOP", [("L3", T + 300), ("L0", T + 302), ("L1", T + 304)])])
        let r = Planner.plan(from: near_("L3"), to: near_("L1"), now: T, data: data(trips: trips))
        let b = r.options[0].busLegs[0]
        XCTAssertTrue(b.waitLive, "the head is a forecast")
        XCTAssertEqual(b.boardT, T + 300)
        XCTAssertEqual(b.source, .estimate, "no live ride from a filler time")
        near(b.ride, (hav("L3", "L0") + hav("L0", "L1")) / 300, 0.01, "distance at 18 km/h, never 4 s")
        // boarding where only filler is listed: no live wait (the headway estimate)
        let fromL0 = Planner.plan(from: near_("L0"), to: near_("L2"), now: T, data: data(trips: trips))
        XCTAssertFalse(fromL0.options[0].busLegs[0].waitLive)
        // unmarked, the same times were taken as live (the bug)
        let raw = [PlannerTests.trip("t1", "LOOP", [("L3", T + 300), ("L0", T + 302), ("L1", T + 304)])]
        XCTAssertEqual(Planner.plan(from: near_("L3"), to: near_("L1"), now: T, data: data(trips: raw)).options[0].busLegs[0].source, .live)
    }

    /// "2 stops away" still fires (the bus position), without minutes from filler.
    func testBusAlertsNoMinutesFromFiller() {
        let S = StaticData(routes: ["LOOP": Route(id: "LOOP", long: "Loop")], stops: stops, routeStops: ["LOOP": routeStops["LOOP"]!])
        var l = LiveState()
        l.buses = [.on("LOOP", id: "b1", trip: "t1", ts: T, stopId: "L1")]
        l.trips = StationTimes.markFiller([PlannerTests.trip("t1", "LOOP", [("L1", T + 60), ("L2", T + 62), ("L3", T + 64)])])
        l.lastOk = T; l.feedTs = T
        let away = Notify.stopsAway(staticData: S, live: l, stopId: "L3", now: T)
        XCTAssertEqual(away.map(\.stopsAway), [2])
        XCTAssertNil(away[0].etaS, "64 s is filler, not a forecast")
        XCTAssertEqual(Notify.stopsAway(staticData: S, live: l, stopId: "L1", now: T)[0].etaS, T + 60, "the head stays")
        var prefs = NotifyPrefs(); prefs.stopId = "L3"
        let due = Notify.dueAlerts(prefs: prefs, staticData: S, live: l, hidden: [], fired: [], now: T)
        XCTAssertEqual(due.alerts.map(\.kind), [.twoStops])
        XCTAssertFalse(due.alerts[0].body.contains("min"), due.alerts[0].body)
    }
}
