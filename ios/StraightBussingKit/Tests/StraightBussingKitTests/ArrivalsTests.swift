import XCTest
@testable import StraightBussingKit

/// Port of web/tests/core-arrivals.js.
final class ArrivalsTests: XCTestCase {
    let T = 1_800_000_000.0
    lazy var trips: [TripUpdate] = [
        TripUpdate(trip: .init(tripId: "t1", routeId: "R1"), vehicle: .init(id: "v1", label: "101"),
                   stopTimeUpdates: [.init(stopId: "S", arrival: T + 600), .init(stopId: "X", arrival: T + 700)]),
        TripUpdate(trip: .init(tripId: "t2", routeId: "R2"), vehicle: .init(id: "v2", label: "202"),
                   stopTimeUpdates: [.init(stopId: "S", arrival: T + 120)]),
        TripUpdate(trip: .init(tripId: "t3", routeId: "R1"), vehicle: .init(id: "v3"),
                   stopTimeUpdates: [.init(stopId: "S", departure: T - 20), .init(stopId: "S", arrival: T + 1800)]),
        TripUpdate(trip: .init(tripId: "t4", routeId: "R3"), vehicle: .init(id: "v4", label: "4"),
                   stopTimeUpdates: [.init(stopId: "S", arrival: T - 31), .init(stopId: "S")]),
        TripUpdate(trip: .init(tripId: "t5"), stopTimeUpdates: [.init(stopId: "S", arrival: T + 5)]),   // no route id
    ]

    func testArrivalsSortedKeepRecentPast() {
        let r = Arrivals.arrivalsFor(trips: trips, stopId: "S", now: T)
        XCTAssertEqual(r.map { $0.t - T }, [-20, 120, 600, 1800])
        XCTAssertEqual(r[1], Arrival(rid: "R2", t: T + 120, bus: "202", tripId: "t2"))
        XCTAssertNil(r[0].bus, "missing label -> nil")
        XCTAssertEqual(r[0].tripId, "t3")
    }

    func testArrivalsHiddenAndRouteFilter() {
        XCTAssertEqual(Arrivals.arrivalsFor(trips: trips, stopId: "S", hidden: ["R1"], now: T).map(\.rid), ["R2"])
        XCTAssertEqual(Arrivals.arrivalsFor(trips: trips, stopId: "S", routeId: "R1", hidden: ["R1"], now: T).map { $0.t - T }, [-20, 600, 1800])
        XCTAssertEqual(Arrivals.arrivalsFor(trips: [], stopId: "S", now: T), [])
    }

    /// The per-poll stop index the app reads gives exactly what arrivalsFor gives (any stop, time, filter).
    func testIndexEqualsArrivalsFor() throws {
        func check(_ trips: [TripUpdate], stops: [String], times: [Double], routes: [String], file: StaticString = #filePath, line: UInt = #line) {
            let idx = Arrivals.index(trips: trips)
            for stop in stops {
                for now in times {
                    XCTAssertEqual(Arrivals.arrivals(in: idx, stopId: stop, now: now),
                                   Arrivals.arrivalsFor(trips: trips, stopId: stop, now: now), "\(stop) @\(now)", file: file, line: line)
                    for r in routes {
                        XCTAssertEqual(Arrivals.arrivals(in: idx, stopId: stop, hidden: [r], now: now),
                                       Arrivals.arrivalsFor(trips: trips, stopId: stop, hidden: [r], now: now), "\(stop) hide \(r)", file: file, line: line)
                        XCTAssertEqual(Arrivals.arrivals(in: idx, stopId: stop, routeId: r, hidden: [r], now: now),
                                       Arrivals.arrivalsFor(trips: trips, stopId: stop, routeId: r, hidden: [r], now: now), "\(stop) only \(r)", file: file, line: line)
                    }
                }
            }
        }
        check(trips, stops: ["S", "X", "nope"], times: [T - 100, T, T + 100, T + 650, T + 5000], routes: ["R1", "R2", "R3"])
        let atS = Arrivals.index(trips: trips)["S"] ?? []
        XCTAssertFalse(atS.contains(where: { $0.t == T + 5 }), "trips without a route id are skipped")
        XCTAssertEqual(atS.map { $0.t - T }, [-31, -20, 120, 600, 1800], "the index keeps past times; the lookup filters them")

        let feed = try FeedParser.tripUpdates(TS.fixture("tripUpdates"))
        let stops = Array(Set(feed.entities.flatMap { $0.stopTimeUpdates.compactMap(\.stopId) })).sorted()
        let routes = Array(Set(feed.entities.compactMap(\.trip.routeId))).sorted()
        XCTAssertFalse(stops.isEmpty)
        check(feed.entities, stops: stops, times: [feed.timestamp - 600, feed.timestamp, feed.timestamp + 900], routes: routes)
    }

    func testStaleLevels() {
        func lv(_ lastOk: Double, _ failed: Bool, _ feedTs: Double) -> StaleLevel {
            Arrivals.staleLevel(lastOk: lastOk, failed: failed, feedTs: feedTs, now: T)
        }
        XCTAssertEqual(lv(0, false, 0), .err, "never ok")
        XCTAssertEqual(lv(T - 5, true, T - 5), .err, "failed")
        XCTAssertEqual(lv(T - 61, false, T - 61), .err, ">60 s since ok")
        XCTAssertEqual(lv(T - 60, false, T - 10), .fresh, "exactly 60 s ok")
        XCTAssertEqual(lv(T - 5, false, T - 301), .old)
        XCTAssertEqual(lv(T - 5, false, T - 300), .late)
        XCTAssertEqual(lv(T - 5, false, T - 121), .late)
        XCTAssertEqual(lv(T - 5, false, T - 120), .fresh)
        XCTAssertEqual(lv(T - 5, false, 0), .fresh, "no feed ts")
    }

    func testRunningCount() {
        let buses = [VehiclePosition.on("R1"), .on("R1"), .on("R2"), .on(nil)]
        XCTAssertEqual(Arrivals.runningCount(buses: buses, rid: "R1"), 2)
        XCTAssertEqual(Arrivals.runningCount(buses: buses, rid: "R9"), 0)
        XCTAssertEqual(Arrivals.runningCount(buses: [], rid: "R1"), 0)
    }

    func testActiveAlertPeriods() {
        let alerts = [
            ServiceAlert(id: "always", header: ""),
            ServiceAlert(id: "now", header: "", activePeriods: [.init(start: T - 10, end: T + 10)]),
            ServiceAlert(id: "past", header: "", activePeriods: [.init(start: T - 100, end: T - 1)]),
            ServiceAlert(id: "future", header: "", activePeriods: [.init(start: T + 1)]),
            ServiceAlert(id: "openEnd", header: "", activePeriods: [.init(start: T - 1)]),
            ServiceAlert(id: "multi", header: "", activePeriods: [.init(start: T - 100, end: T - 50), .init(end: T + 5)]),
        ]
        XCTAssertEqual(Arrivals.activeAlerts(alerts, now: T).map(\.id), ["always", "now", "openEnd", "multi"])
    }

    func testTimeHelpers() {
        XCTAssertEqual(TimeFmt.minsUntil(T + 119, from: T), 1)
        XCTAssertEqual(TimeFmt.minsUntil(T - 1, from: T), -1)
        XCTAssertEqual(TimeFmt.ago(T - 8, from: T), "8s ago")
        XCTAssertEqual(TimeFmt.ago(T - 180, from: T), "3 min ago")
        XCTAssertEqual(TimeFmt.ago(T - 7200, from: T), "2 h ago")
        XCTAssertEqual(TimeFmt.ago(T + 5, from: T), "just now")
        XCTAssertEqual(TimeFmt.ago(0, from: T), "never")
        XCTAssertEqual(TimeFmt.etaLabel(T + 30, now: T), "Now")
        XCTAssertEqual(TimeFmt.etaLabel(T + 300, now: T, stale: true), "~5 min")
        XCTAssertEqual(TimeFmt.clock(T, timeZone: Schedule.chicago, locale: Locale(identifier: "en_US")).replacingOccurrences(of: "\u{202F}", with: " "), "2:00 AM", "1.8e9 = 2027-01-15 08:00 UTC = 2 AM CST")
    }
}

/// Port of web/tests/core-operating.js.
final class OperatingTests: XCTestCase {
    // Wed 2026-10-07 21:40 Chicago (CDT) = 2026-10-08T02:40:00Z
    let NOW = 1791427200.0 + 2 * 3600 + 40 * 60
    let routes = ["DAY": Route(id: "DAY", short: "D"), "NIGHT": Route(id: "NIGHT", short: "N"), "X": Route(id: "X", short: "X")]
    var service: ServiceData {
        func day(_ f: String, _ l: String) -> ServiceDay { ServiceDay(first: f, last: l, trips: 10, buses: Array(repeating: 1, count: 24)) }
        func week(_ d: ServiceDay) -> [String: ServiceDay] { Dictionary(uniqueKeysWithValues: Schedule.dayKeys.map { ($0, d) }) }
        return ServiceData(routes: ["DAY": RouteService(days: week(day("07:00", "21:00"))),
                                    "NIGHT": RouteService(days: week(day("16:00", "28:29")))])
    }
    func bus(_ id: String, _ rid: String?, _ ts: Double, trip: String? = nil) -> VehiclePosition {
        .on(rid, id: id, trip: trip ?? "t-" + id, ts: ts)
    }
    func ctx(trips: [TripUpdate] = [], feedTs: Double? = nil, now: Double? = nil, staticLoaded: Bool = true) -> Operating.Context {
        Operating.Context(routes: routes, service: service, trips: trips, feedTs: feedTs ?? NOW, now: now ?? NOW, staticLoaded: staticLoaded)
    }

    func testGhostsJudgedByFeedClock() {
        XCTAssertTrue(Operating.isOperating(bus("a", "NIGHT", NOW - 30), ctx()))
        XCTAssertTrue(Operating.isOperating(bus("a", "NIGHT", NOW - Operating.staleS), ctx()), "exactly 5 min old still shown")
        XCTAssertFalse(Operating.isOperating(bus("a", "NIGHT", NOW - 30919), ctx()), "8.6 h old ghost hidden")
        XCTAssertTrue(Operating.isOperating(bus("a", "NIGHT", NOW - 30), ctx(now: NOW + 3 * 3600)), "phone clock ahead")
    }

    func testUnknownRoutesHidden() {
        XCTAssertFalse(Operating.isOperating(bus("a", "GARAGE", NOW), ctx()))
        XCTAssertFalse(Operating.isOperating(bus("a", nil, NOW), ctx()), "no route at all")
    }

    func testOutOfServiceUnlessLivePredictions() {
        XCTAssertTrue(Operating.isOperating(bus("n", "NIGHT", NOW), ctx()), "night route scheduled")
        XCTAssertFalse(Operating.isOperating(bus("d", "DAY", NOW), ctx()), "day route ended at 21:00")
        let trips = [TripUpdate.make("late", nil, [("S", NOW + 240)])]
        XCTAssertTrue(Operating.isOperating(bus("d", "DAY", NOW, trip: "late"), ctx(trips: trips)), "finishing a late last trip")
        let old = [TripUpdate.make("late", nil, [("S", NOW - 600)])]
        XCTAssertFalse(Operating.isOperating(bus("d", "DAY", NOW, trip: "late"), ctx(trips: old)), "only past predictions")
        XCTAssertTrue(Operating.isOperating(bus("x", "X", NOW), ctx()), "route without schedule data is not hidden")
    }

    func testBeforeStaticDataOnlyFreshnessCounts() {
        XCTAssertTrue(Operating.isOperating(bus("a", "GARAGE", NOW), ctx(staticLoaded: false)))
        XCTAssertFalse(Operating.isOperating(bus("a", "GARAGE", NOW - 9999), ctx(staticLoaded: false)))
        let list = [bus("1", "NIGHT", NOW), bus("2", "DAY", NOW), bus("3", "NIGHT", NOW - 99999), bus("4", "NIGHT", NOW - 5)]
        XCTAssertEqual(Operating.operatingBuses(list, ctx()).map { $0.vehicle.id }, ["1", "4"])
    }

    func testLiveMergeKeepsOnlyOperatingVehicles() {
        let S = StaticData(routes: routes, service: service)
        let S2 = StaticData(routes: routes, stops: ["S": Stop(id: "S", name: "S", lat: 41.79, lon: -87.6)], service: service)
        let poll = FeedPoll(
            vehicles: .success(Feed(timestamp: NOW, entities: [bus("ok", "NIGHT", NOW - 6), bus("ghost", "NIGHT", NOW - 30919), bus("deadhead", "DAY", NOW - 5)])),
            trips: .success(Feed(timestamp: NOW, entities: [])), alerts: .success(Feed(timestamp: NOW, entities: [])))
        XCTAssertTrue(S.isEmpty, "no stops: only freshness applies")
        let s = LiveState().applying(poll, staticData: S2, now: NOW)
        XCTAssertEqual(s.buses.map { $0.vehicle.id }, ["ok"])
        XCTAssertEqual(s.lastOk, NOW)
        XCTAssertFalse(s.failed)
        XCTAssertTrue(s.loaded)
    }
}
