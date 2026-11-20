import XCTest
@testable import StraightBussingKit

/// busTimes / stationTimes / scheduledAt / words (web core/eta.js). A synthetic loop R: A -> B -> C -> D -> A, one minute
/// per segment in the timetable (segments.json), so every estimate can be checked by hand.
final class StationTimesNetworkTests: XCTestCase {
    let T = 1_800_000_000.0
    lazy var S: StaticData = {
        let raw: [(String, Double, Double)] = [("A", 41.79, -87.60), ("B", 41.79, -87.59), ("C", 41.80, -87.59), ("D", 41.80, -87.60)]
        return StaticData(routes: ["R": Route(id: "R", short: "R", long: "Loop R")],
                          stops: Dictionary(uniqueKeysWithValues: raw.map { ($0.0, Stop(id: $0.0, name: "Stop " + $0.0, lat: $0.1, lon: $0.2)) }),
                          routeStops: ["R": ["A", "B", "C", "D", "A"]],
                          segments: SegmentsData(routes: ["R": .init(seg: [60, 60, 60, 60], dwell: 0)]))
    }()
    /// Halfway from A to B, heading to B.
    func bus(_ id: String, trip: String? = nil) -> VehiclePosition { .on("R", id: id, trip: trip, ts: T, lat: 41.79, lon: -87.595, stopId: "B") }
    func live(_ buses: [VehiclePosition], _ trips: [TripUpdate], transitioning: [String] = []) -> LiveState {
        var l = LiveState()
        l.buses = buses
        l.trips = StationTimes.markFiller(trips)
        l.transitioning = transitioning
        return l
    }
    func rows(_ x: [StationTimes.BusTime]) -> [String] { x.map { "\($0.stopId)\($0.idx) \(Int(($0.t - T).rounded())) \($0.kind.rawValue)" } }

    /// Live where Passio has a real time; filler between two live times is scaled between them; after the last one the
    /// timetable's ride is added; one lap from the stop it heads to (the loop's repeated A dropped).
    func testBusTimesAnchoredToLiveTimes() {
        let L = live([bus("v1", trip: "t1")], [.make("t1", "R", vid: "v1", [("B", T + 100), ("C", T + 102), ("D", T + 400)])])
        XCTAssertEqual(rows(StationTimes.busTimes(S, L, bus: L.buses[0], now: T)), ["B1 100 live", "C2 250 est", "D3 400 live", "A0 460 est"])
    }

    /// No live time: from where the bus is (half of A -> B left), then a minute per stop.
    func testBusTimesFromThePosition() {
        let L = live([bus("v2")], [])
        XCTAssertEqual(rows(StationTimes.busTimes(S, L, bus: L.buses[0], now: T)), ["B1 30 est", "C2 90 est", "D3 150 est", "A0 210 est"])
        var at = bus("v3")
        at.latitude = 41.79; at.longitude = -87.59   // at B (within 35 m): no lead
        XCTAssertEqual(rows(StationTimes.busTimes(S, live([at], []), bus: at, now: T)), ["B1 0 est", "C2 60 est", "D3 120 est", "A0 180 est"])
        // a bus whose next stop is not on its route, or a route without stops: nothing
        var lost = bus("v4")
        lost.stopId = "Z"
        XCTAssertEqual(StationTimes.busTimes(S, live([lost], []), bus: lost, now: T), [])
        let other = VehiclePosition.on("Q", id: "q", ts: T, stopId: "B")
        XCTAssertEqual(StationTimes.busTimes(S, live([other], []), bus: other, now: T), [])
    }

    /// Times never run backwards: a stop before the first live time counts back from it, never before now.
    func testBusTimesCountBackNeverBeforeNow() {
        let L = live([bus("v1", trip: "t1")], [.make("t1", "R", vid: "v1", [("D", T + 90)])])
        XCTAssertEqual(rows(StationTimes.busTimes(S, L, bus: L.buses[0], now: T)), ["B1 0 est", "C2 30 est", "D3 90 live", "A0 150 est"])
    }

    /// Another bus's trip update is never used (Passio reuses trip ids): only updates naming this vehicle.
    func testBusTimesOnlyItsOwnUpdates() {
        let L = live([bus("v1", trip: "t1"), bus("v2", trip: "t1")], [.make("t1", "R", vid: "v2", [("C", T + 500)])])
        XCTAssertEqual(rows(StationTimes.busTimes(S, L, bus: L.buses[0], now: T)), ["B1 30 est", "C2 90 est", "D3 150 est", "A0 210 est"])
        XCTAssertEqual(rows(StationTimes.busTimes(S, L, bus: L.buses[1], now: T)), ["B1 440 est", "C2 500 live", "D3 560 est", "A0 620 est"])
    }

    /// A station: each bus's live row, else its estimate; a live row out of its own travel order gives way.
    func testStationTimes() {
        let L = live([bus("v1", trip: "t1"), bus("v2")], [.make("t1", "R", vid: "v1", [("B", T + 100), ("C", T + 102), ("D", T + 400)])])
        func at(_ stop: String, _ l: LiveState? = nil) -> [String] {
            StationTimes.stationTimes(S, l ?? L, stopId: stop, now: T).map { "\($0.vehicleId ?? "-") \(Int(($0.t - T).rounded())) \($0.kind.rawValue)" }
        }
        XCTAssertEqual(at("C"), ["v2 90 est", "v1 250 est"], "filler at C: both estimated")
        XCTAssertEqual(at("D"), ["v2 150 est", "v1 400 live"])
        XCTAssertEqual(at("B"), ["v2 30 est", "v1 100 live"])
        XCTAssertEqual(StationTimes.stationTimes(S, L, stopId: "D", hidden: ["R"], now: T), [], "hidden route")
        XCTAssertEqual(StationTimes.stationTimes(S, L, stopId: "D", routeId: "R", hidden: ["R"], now: T).count, 2, "routeId wins over hidden")
        XCTAssertEqual(StationTimes.stationTimes(S, L, stopId: "D", routeId: "Q", now: T), [])
        // precomputed laps give the same rows
        XCTAssertEqual(StationTimes.stationTimes(S, L, stopId: "C", now: T, laps: StationTimes.laps(S, L, now: T)),
                       StationTimes.stationTimes(S, L, stopId: "C", now: T))
        // Passio lists D (50 s) before B (100 s): along the lap D comes after B, so D's 50 s gives way to the estimate
        let odd = live([bus("v3", trip: "t3")], [.make("t3", "R", vid: "v3", [("D", T + 50), ("B", T + 100)])])
        XCTAssertEqual(at("D", odd), ["v3 220 est"])
        // a bus shown without its times (transitioning to a new line) gives none, live or estimated
        let tr = live([bus("v1", trip: "t1")], [.make("t1", "R", vid: "v1", [("D", T + 400)])], transitioning: ["v1"])
        XCTAssertEqual(StationTimes.busTimes(S, tr, bus: tr.buses[0], now: T), [])
        XCTAssertEqual(at("D", tr), [])
        // a row keeps the bus label and trip for bus numbers
        let r = StationTimes.stationTimes(S, L, stopId: "D", now: T)[1]
        XCTAssertEqual(r.arrival, Arrival(rid: "R", t: T + 400, bus: nil, tripId: "t1", vehicleId: "v1"))
    }

    /// The next timetable time at a stop (scheduledAt), within 4 hours, from a synthetic timetable: trips leave A at
    /// 12:30 and 1:00 PM every day and reach B 2 min, C 5 min later.
    func testScheduledAt() {
        let tt = TimetableData(services: ["wk": .init(days: "1111111")],
                               routes: ["R": [.init(stops: ["A", "B", "C"], t: [0, 120, 300], starts: ["wk": [12.5 * 3600, 13 * 3600]])]])
        let now = TimeActive.chicagoUnix(2026, 11, 20, 12, 37)
        XCTAssertEqual(StationTimes.scheduledAt(tt, rid: "R", stopId: "A", now: now), TimeActive.chicagoUnix(2026, 11, 20, 13, 0))
        XCTAssertEqual(StationTimes.scheduledAt(tt, rid: "R", stopId: "B", now: now), TimeActive.chicagoUnix(2026, 11, 20, 13, 2))
        XCTAssertEqual(StationTimes.scheduledAt(tt, rid: "R", stopId: "C", now: now), TimeActive.chicagoUnix(2026, 11, 20, 13, 5))
        XCTAssertEqual(StationTimes.scheduledAt(tt, rid: "R", stopId: "C", now: TimeActive.chicagoUnix(2026, 11, 20, 12, 34)),
                       TimeActive.chicagoUnix(2026, 11, 20, 12, 35))
        XCTAssertNil(StationTimes.scheduledAt(tt, rid: "R", stopId: "Z", now: now), "stop not on the route")
        XCTAssertNil(StationTimes.scheduledAt(tt, rid: "Q", stopId: "A", now: now), "route not in the timetable")
        XCTAssertNil(StationTimes.scheduledAt(nil, rid: "R", stopId: "A", now: now), "timetable not loaded")
        XCTAssertNil(StationTimes.scheduledAt(tt, rid: "R", stopId: "A", now: TimeActive.chicagoUnix(2026, 11, 20, 8, 0)), "more than 4 h ahead")
        let inst = StationTimes.scheduledInstances(tt, rid: "R", now: now)
        XCTAssertEqual(StationTimes.scheduledAt(tt, rid: "R", stopId: "B", now: now, instances: inst),
                       StationTimes.scheduledAt(tt, rid: "R", stopId: "B", now: now))
    }

    func testWords() {
        let en = Locale(identifier: "en_US")
        func w(_ dt: Double, _ k: StationTimes.Kind, stale: Bool = false) -> StationTimes.Shown {
            StationTimes.words(t: T + dt, kind: k, now: T, stale: stale, locale: en)
        }
        XCTAssertEqual(w(299, .est).text, "~4 min")
        XCTAssertEqual(w(299, .est).tag, "est.")
        XCTAssertEqual(w(299, .est).say, "in about 4 min, estimated")
        XCTAssertEqual(w(10, .est).text, "~1 min", "an estimate says at least 1 min, never Now")
        XCTAssertEqual(w(30, .live).text, "Now")
        XCTAssertTrue(w(30, .live).now)
        XCTAssertEqual(w(30, .live).say, "now")
        XCTAssertEqual(w(180, .live).text, "3 min")
        XCTAssertEqual(w(180, .live).tag, "")
        XCTAssertEqual(w(180, .live).say, "in 3 min")
        XCTAssertEqual(w(180, .live, stale: true).text, "~3 min")
        XCTAssertEqual(w(180, .live, stale: true).say, "in about 3 min")
        let c = TimeFmt.clock(T + 900, locale: en)
        XCTAssertEqual(w(900, .sched).text, c)
        XCTAssertEqual(w(900, .sched).tag, "Scheduled")
        XCTAssertEqual(w(900, .sched).say, "scheduled \(c), not live")
        XCTAssertEqual(StationTimes.Words.est, "est.")
        XCTAssertEqual(StationTimes.Words.sched, "Scheduled")
        XCTAssertEqual(StationTimes.Notes.est, "est. = estimated from where the bus is and the timetable's travel times.")
        XCTAssertEqual(StationTimes.Notes.sched, "Scheduled = the timetable, not live.")
    }

    /// The real feed of Nov 20 12:37 PM: every station of 53rd Street Express gets a time from bus 134 (it heads to
    /// 8629; Passio's only forecasts are 8596 in 12.5 min and 8595 in 26 min), in order, never before now.
    func testRealFeedEveryStationATime() throws {
        let vp = try FeedParser.vehicles(TS.fixture("eta_vehiclePositions")), tu = try FeedParser.tripUpdates(TS.fixture("eta_tripUpdates"))
        var L = LiveState()
        L.buses = vp.entities
        L.trips = tu.entities
        let now = tu.timestamp, S = TS.real.data
        let b134 = try XCTUnwrap(L.buses.first { $0.vehicle.id == "4326" })
        let lap = StationTimes.busTimes(S, L, bus: b134, now: now)
        let order = Notify.routeOrder(S.routeStops["4346"]).order
        XCTAssertEqual(lap.count, order.count, "one lap")
        XCTAssertEqual(lap.first?.stopId, "8629")
        XCTAssertEqual(Set(lap.map(\.stopId)), Set(order))
        XCTAssertEqual(lap.filter { $0.kind == .live }.map { "\($0.stopId) \(Int(($0.t - now).rounded()))" }, ["8596 752", "8595 1586"])
        XCTAssertTrue(zip(lap, lap.dropFirst()).allSatisfy { $0.t <= $1.t }, "in order")
        XCTAssertTrue(lap.allSatisfy { $0.t >= now }, "never before now")
        // Levi Hall: Apostolic bus 1651's real 13 min, plus an estimate from each other bus of a route serving it
        let levi = StationTimes.stationTimes(S, L, stopId: "8630", now: now)
        XCTAssertEqual(Set(levi.compactMap(\.vehicleId)), ["4317", "4318", "4326"])
        XCTAssertEqual(levi.filter { $0.kind == .live }.map { "\($0.vehicleId ?? "") \(Int(($0.t - now).rounded()))" }, ["4317 778"])
        XCTAssertTrue(levi.allSatisfy { $0.t >= now - 30 })
    }
}
