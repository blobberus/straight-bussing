import XCTest
@testable import StraightBussingKit

/// Port of web/tests/trip-fixtures.js: a straight north-south line R (A0..A8, ~222 m apart), a loop G (B0..B3) for
/// transfers and wraps, and one scene per trip phase.
enum TripFix {
    static let NOW = 1_800_000_000.0
    static let names = ["55th & Ellis", "56th & Ellis", "57th & Ellis", "Regenstein Library", "Ratner Center", "58th & Ellis", "59th & Ellis", "Medical Center", "60th & Ellis"]
    static let stops: [String: Stop] = {
        var s: [String: Stop] = [:]
        for (i, n) in names.enumerated() { s["A\(i)"] = Stop(id: "A\(i)", name: n, lat: 41.79 + Double(i) * 0.002, lon: -87.6) }
        s["B0"] = Stop(id: "B0", name: "Ratner East", lat: 41.79 + 4 * 0.002, lon: -87.6 + 0.0005)
        s["B1"] = Stop(id: "B1", name: "Kimbark & 57th", lat: 41.79 + 4 * 0.002, lon: -87.6 + 0.006)
        s["B2"] = Stop(id: "B2", name: "Harper Court", lat: 41.79 + 3 * 0.002, lon: -87.6 + 0.012)
        s["B3"] = Stop(id: "B3", name: "Lake Park & 53rd <b>", lat: 41.79 + 2 * 0.002, lon: -87.6 + 0.006)
        return s
    }()
    static let routes: [String: Route] = [
        "R": Route(id: "R", short: "RL", long: "Red Line", color: "#C4291C", textColor: "#FFFFFF"),
        "G": Route(id: "G", short: "GL", long: "Green Loop", color: "#1E7F3C", textColor: "#FFFFFF"),
        "L": Route(id: "L", short: "L", long: "Loop", color: "#0A84FF", textColor: "#FFFFFF"),
    ]
    static let routeStops: [String: [String]] = [
        "R": ["A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8"],
        "G": ["B0", "B1", "B2", "B3", "B0"],
        "L": ["A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A0"],
    ]
    static let S = StaticData(routes: routes, stops: stops, routeStops: routeStops)

    /// Fresh live data (feed 5 s old).
    static func live(_ buses: [VehiclePosition] = [], _ trips: [TripUpdate] = [], feedTs: Double = NOW - 5) -> LiveState {
        var l = LiveState()
        l.buses = buses; l.trips = trips; l.feedTs = feedTs; l.lastOk = NOW - 5; l.loaded = true
        return l
    }
    /// A vehicle heading to `next`, `frac` of the way from `prev`.
    static func bus(_ vid: String, _ label: String, _ rid: String, _ tripId: String, _ prev: String, _ next: String, _ frac: Double = 0.5,
                    ts: Double = NOW - 5) -> VehiclePosition {
        let a = stops[prev]!, b = stops[next]!
        return VehiclePosition(vehicle: .init(id: vid, label: label), latitude: a.lat + (b.lat - a.lat) * frac, longitude: a.lon + (b.lon - a.lon) * frac,
                               bearing: 0, speed: 5, trip: .init(tripId: tripId, routeId: rid), timestamp: ts, stopId: next)
    }
    /// Trip update: [(stopId, seconds from NOW)] in stop order (stop_sequence 1..n).
    static func trip(_ tripId: String, _ rid: String, _ vid: String, _ label: String, _ list: [(String, Double)]) -> TripUpdate {
        TripUpdate(trip: .init(tripId: tripId, routeId: rid), vehicle: .init(id: vid, label: label),
                   stopTimeUpdates: list.enumerated().map { i, x in StopTimeUpdate(stopId: x.0, stopSequence: i + 1, arrival: NOW + x.1, departure: NOW + x.1 + 1) })
    }
    static func tR1(_ list: [(String, Double)]) -> TripUpdate { trip("tR1", "R", "v101", "101", list) }

    /// Walk to Ratner Center, Red Line to Medical Center, walk to the cafe.
    static func journeyR(t0: Double = NOW - 120, tripId: String? = "tR1", vehicleId: String? = nil, boardT: Double = NOW + 420,
                         alightT: Double = NOW + 720, to: String = "Medical Center Cafe", walk: Double = 4) -> TripJourney {
        TripJourney(to: to, t0: t0, legs: [
            .walk(min: walk, toName: "Ratner Center"),
            .bus(.init(rid: "R", boardId: "A4", boardName: "Ratner Center", alightId: "A7", alightName: "Medical Center", tripId: tripId,
                       vehicleId: vehicleId, boardT: boardT, alightT: alightT, source: tripId != nil ? .live : .schedule, waitLive: tripId != nil)),
            .walk(min: 3, toName: to),
        ])
    }
    /// Red Line A1 -> A4, walk to B0, Green Loop B0 -> B3.
    static func journeyXfer(t0: Double = NOW - 600) -> TripJourney {
        TripJourney(to: "Lake Park Apartments", t0: t0, legs: [
            .walk(min: 2, toName: "56th & Ellis"),
            .bus(.init(rid: "R", boardId: "A1", boardName: "56th & Ellis", alightId: "A4", alightName: "Ratner Center", tripId: "tR1",
                       boardT: NOW - 240, alightT: NOW + 180, source: .live, waitLive: true)),
            .walk(min: 1, toName: "Ratner East"),
            .bus(.init(rid: "G", boardId: "B0", boardName: "Ratner East", alightId: "B3", alightName: "Lake Park & 53rd <b>", tripId: "tG1",
                       boardT: NOW + 420, alightT: NOW + 900, source: .live, waitLive: true)),
            .walk(min: 5, toName: "Lake Park Apartments"),
        ])
    }
    static func userNear(_ id: String, _ dLat: Double = 0) -> LatLon { LatLon(lat: stops[id]!.lat + dLat, lon: stops[id]!.lon - 0.0001) }

    struct Scene { var journey: TripJourney; var live: LiveState; var user: LatLon? = nil }
    static func scene(_ id: String) -> Scene {
        switch id {
        case "walk":
            return Scene(journey: journeyR(), live: live([bus("v101", "101", "R", "tR1", "A0", "A1", 0.5)],
                         [tR1([("A1", 90), ("A2", 200), ("A3", 300), ("A4", 420), ("A5", 520), ("A6", 600), ("A7", 720), ("A8", 800)])]),
                         user: userNear("A4", -0.0025))
        case "waiting":
            return Scene(journey: journeyR(boardT: NOW + 240, alightT: NOW + 500), live: live([bus("v101", "101", "R", "tR1", "A1", "A2", 0.6)],
                         [tR1([("A2", 60), ("A3", 150), ("A4", 240), ("A5", 330), ("A6", 400), ("A7", 500), ("A8", 580)])]), user: userNear("A4", 0.00005))
        case "onbus":
            return Scene(journey: journeyR(t0: NOW - 900, boardT: NOW - 240, alightT: NOW + 200),
                         live: live([bus("v101", "101", "R", "tR1", "A5", "A6", 0.4)], [tR1([("A6", 70), ("A7", 200), ("A8", 300)])]))
        case "arrived":
            return Scene(journey: journeyR(t0: NOW - 1200, boardT: NOW - 600, alightT: NOW - 60),
                         live: live([bus("v101", "101", "R", "tR1", "A7", "A8", 0.5)], [tR1([("A8", 60)])]))
        case "schedule":
            return Scene(journey: journeyR(t0: NOW - 300, tripId: nil, boardT: NOW + 120, alightT: NOW + 480), live: live())
        case "transfer":
            return Scene(journey: journeyXfer(), live: live([bus("v101", "101", "R", "tR1", "A2", "A3", 0.5), bus("v301", "301", "G", "tG1", "B2", "B3", 0.5)],
                         [tR1([("A3", 60), ("A4", 180), ("A5", 260)]), trip("tG1", "G", "v301", "301", [("B3", 60), ("B0", 400), ("B1", 520), ("B2", 640), ("B3", 860)])]))
        case "missed":
            return Scene(journey: journeyR(boardT: NOW - 120, alightT: NOW + 300),
                         live: live([bus("v101", "101", "R", "tR1", "A5", "A6", 0.7), bus("v102", "102", "R", "tR2", "A0", "A1", 0.3)],
                                    [tR1([("A6", 40), ("A7", 160)]), trip("tR2", "R", "v102", "102", [("A1", 100), ("A2", 220), ("A3", 330), ("A4", 450), ("A5", 540), ("A6", 620), ("A7", 740)])]),
                         user: userNear("A4", 0.00005))
        default:   // stale
            return Scene(journey: journeyR(boardT: NOW + 240, alightT: NOW + 500),
                         live: live([bus("v101", "101", "R", "tR1", "A2", "A3", 0.3, ts: NOW - 130)],
                                    [tR1([("A3", 60), ("A4", 240), ("A5", 330), ("A6", 400), ("A7", 500)])], feedTs: NOW - 420),
                         user: userNear("A4", 0.00005))
        }
    }
    static let sceneIds = ["walk", "waiting", "onbus", "arrived", "schedule", "transfer", "missed", "stale"]
    static func follow(_ s: Scene, now: Double = NOW) -> TripFollow {
        TripFollow.compute(s.journey, staticData: S, live: s.live, user: s.user, now: now)!
    }
}

/// Port of web/tests/core-tripprogress.js.
final class TripFollowTests: XCTestCase {
    let NOW = TripFix.NOW
    func prog(_ id: String, now: Double? = nil) -> TripFollow { TripFix.follow(TripFix.scene(id), now: now ?? NOW) }
    func bus(_ p: TripFollow, _ n: Int = 0) -> TripFollow.BusStep { p.busLegs[n] }
    func ids(_ b: TripFollow.BusStep) -> [String] { b.stops.map(\.id) }

    func testNilWithoutBusLeg() {
        XCTAssertNil(TripFollow.compute(TripJourney(to: "X", t0: NOW, legs: [.walk(min: 5, toName: "X")]), staticData: TripFix.S, live: TripFix.live(), user: nil, now: NOW))
        XCTAssertNotNil(TripFollow.compute(TripFix.journeyR(), staticData: StaticData(), live: LiveState(), user: nil, now: NOW), "empty state does not crash")
    }

    func testWalkToStop() {
        let p = prog("walk"), b = bus(p)
        XCTAssertEqual(p.phase, .walkToStop); XCTAssertEqual(p.to, "Medical Center Cafe")
        XCTAssertEqual(ids(b), ["A1", "A2", "A3", "A4", "A5", "A6", "A7"])
        XCTAssertEqual(b.stops.map(\.role), [.before, .before, .before, .board, .ride, .ride, .alight])
        XCTAssertEqual([b.boardIdx, b.alightIdx], [3, 6])
        XCTAssertEqual(b.vehicle?.how, .trip); XCTAssertEqual(b.vehicle?.label, "101")
        XCTAssertEqual(b.vehicle?.idx, 0); XCTAssertEqual(b.vehicle?.at, false)
        near(b.vehicle?.pos, -0.5, 0.05, "between the stop before (not listed) and A1")
        XCTAssertEqual(b.vehicle?.prevName, "55th & Ellis")
        XCTAssertEqual(b.stopsAway, 3)
        XCTAssertEqual(b.boardEta, NOW + 420); XCTAssertTrue(b.boardLive); XCTAssertEqual(b.alightEta, NOW + 720); XCTAssertTrue(b.alightLive)
        XCTAssertEqual(b.stops.map(\.state), [.next, .upcoming, .upcoming, .upcoming, .upcoming, .upcoming, .upcoming])
        XCTAssertEqual(b.stops[3].eta, NOW + 420)
        near(b.walkMin, 4.2, 0.15, "walking time from your location")
        near(b.slackMin, 7 - (b.walkMin ?? 0), 1e-6); XCTAssertEqual(b.canCatch, true)
        XCTAssertEqual(p.legs[0].walk?.state, .active); near(p.legs[0].walk?.minNow, b.walkMin ?? 0, 1e-9)
        XCTAssertEqual(p.arriveT, NOW + 720 + 180); XCTAssertTrue(p.arriveLive)
        XCTAssertEqual(p.stale, .fresh); XCTAssertTrue(p.live)
    }

    func testWaitingBusBetweenStopsByDistance() {
        let p = prog("waiting"), b = bus(p)
        XCTAssertEqual(p.phase, .waiting); XCTAssertEqual(p.legs[0].walk?.state, .done)
        XCTAssertEqual(b.vehicle?.idx, 1); near(b.vehicle?.frac, 0.6, 0.02); near(b.vehicle?.pos, 0.6, 0.02)
        XCTAssertEqual(b.stopsAway, 2)
        XCTAssertEqual(Array(b.stops.map(\.state).prefix(3)), [.passed, .next, .upcoming])
        XCTAssertNil(b.stops[0].eta, "passed stops have no ETA")
        XCTAssertEqual(b.boardEta, NOW + 240)
    }

    func testOnBus() {
        let p = prog("onbus"), b = bus(p)
        XCTAssertEqual(p.phase, .onBus)
        XCTAssertEqual(ids(b), ["A4", "A5", "A6", "A7"])
        XCTAssertEqual([b.boardIdx, b.alightIdx], [0, 3])
        XCTAssertEqual(b.vehicle?.idx, 2); near(b.vehicle?.pos, 1.4, 0.02)
        XCTAssertEqual(b.stops.map(\.state), [.passed, .passed, .next, .upcoming])
        XCTAssertEqual(b.stopsLeft, 2); XCTAssertNil(b.stopsAway)
        XCTAssertEqual(b.alightEta, NOW + 200); XCTAssertTrue(b.alightLive)
    }

    func testOnBusAtStopIsCurrent() {
        var s = TripFix.scene("onbus")
        s.live = TripFix.live([TripFix.bus("v101", "101", "R", "tR1", "A6", "A7", 0.995)], [TripFix.tR1([("A7", 10), ("A8", 120)])])
        let b = bus(TripFix.follow(s))
        XCTAssertEqual(b.vehicle?.idx, 3); XCTAssertEqual(b.vehicle?.at, true); XCTAssertEqual(b.vehicle?.pos, 3)
        XCTAssertEqual(b.stops[3].state, .current); XCTAssertEqual(b.stopsLeft, 0)
    }

    func testArrived() {
        let p = prog("arrived")
        XCTAssertEqual(p.phase, .arrived); XCTAssertEqual(bus(p).state, .done)
        XCTAssertTrue(bus(p).stops.allSatisfy { $0.state == .passed })
        let fin = p.legs.last?.walk
        XCTAssertEqual(fin?.state, .active); XCTAssertEqual(fin?.final, true); XCTAssertEqual(fin?.toName, "Medical Center Cafe")
        XCTAssertEqual(p.active, p.legs.count - 1)
        XCTAssertEqual(p.arriveT, NOW - 60 + 180)
    }

    func testNoLiveDataFollowsThePlanClock() {
        let st = TripFix.scene("schedule")
        let p = TripFix.follow(st), b = bus(p)
        XCTAssertEqual(p.phase, .waiting, "t0 + 4 min walk is past")
        XCTAssertEqual(ids(b), ["A4", "A5", "A6", "A7"], "no stops before the boarding stop without a live bus")
        XCTAssertNil(b.vehicle); XCTAssertFalse(b.live); XCTAssertTrue(b.byTime); XCTAssertEqual(b.boardEta, NOW + 120); XCTAssertFalse(b.boardLive)
        XCTAssertEqual(b.alightEta, NOW + 480); XCTAssertFalse(b.alightLive)
        var early = st; early.journey = TripFix.journeyR(t0: NOW - 60, tripId: nil, boardT: NOW + 120, alightT: NOW + 480)
        XCTAssertEqual(TripFix.follow(early).phase, .walkToStop)
        XCTAssertEqual(TripFix.follow(st, now: NOW + 300).phase, .onBus, "after the planned boarding time")
        XCTAssertEqual(bus(TripFix.follow(st, now: NOW + 300)).stops[0].state, .passed)
        XCTAssertEqual(TripFix.follow(st, now: NOW + 600).phase, .arrived)
        var atStop = st; atStop.user = LatLon(lat: TripFix.stops["A4"]!.lat, lon: TripFix.stops["A4"]!.lon)
        XCTAssertEqual(TripFix.follow(atStop, now: NOW + 300).phase, .waiting, "your location says you are still at the stop")
    }

    func testNoTripIdFollowsNextOperatingBus() {
        var s = TripFix.Scene(journey: TripFix.journeyR(tripId: nil),
                              live: TripFix.live([TripFix.bus("v7", "7", "R", "t7", "A2", "A3", 0.5)],
                                                 [TripFix.trip("t6", "R", "v6", "6", [("A4", 60)]), TripFix.trip("t7", "R", "v7", "7", [("A3", 50), ("A4", 200), ("A7", 500)])]),
                              user: LatLon(lat: TripFix.stops["A4"]!.lat, lon: TripFix.stops["A4"]!.lon))
        let b = bus(TripFix.follow(s))
        XCTAssertEqual(b.vehicle?.how, .next); XCTAssertEqual(b.vehicle?.label, "7", "t6 has no operating bus: skipped")
        XCTAssertEqual(b.stopsAway, 1); XCTAssertEqual(b.boardEta, NOW + 200); XCTAssertEqual(b.alightEta, NOW + 500)
        s.live.trips = []
        let n = bus(TripFix.follow(s))
        XCTAssertEqual(n.vehicle?.label, "7"); XCTAssertEqual(n.vehicle?.how, .next); XCTAssertEqual(n.stopsAway, 1)
        XCTAssertNil(n.boardEta, "no predictions: no invented time")
    }

    func testWalkingSkipsBusYouCannotReach() {
        let far = LatLon(lat: TripFix.stops["A4"]!.lat - 0.0108, lon: TripFix.stops["A4"]!.lon)
        let j = TripFix.journeyR(t0: NOW - 30, tripId: nil, boardT: NOW + 1500, alightT: NOW + 1800, walk: 18)
        var s = TripFix.Scene(journey: j, live: TripFix.live([TripFix.bus("v7", "7", "R", "t7", "A2", "A3", 0.5)], []), user: far)
        var p = TripFix.follow(s), b = bus(p)
        XCTAssertEqual(p.phase, .walkToStop)
        XCTAssertNil(b.vehicle); XCTAssertTrue(b.byTime); XCTAssertEqual(b.boardEta, NOW + 1500); XCTAssertFalse(b.boardLive)
        s.live = TripFix.live([TripFix.bus("v7", "7", "R", "t7", "A2", "A3", 0.5), TripFix.bus("v8", "8", "R", "t8", "A0", "A1", 0.2)],
                              [TripFix.trip("t7", "R", "v7", "7", [("A3", 40), ("A4", 120)]), TripFix.trip("t8", "R", "v8", "8", [("A1", 700), ("A4", 1300), ("A7", 1700)])])
        p = TripFix.follow(s); b = bus(p)
        XCTAssertEqual(b.vehicle?.label, "8"); XCTAssertEqual(b.boardEta, NOW + 1300); XCTAssertTrue(b.boardLive)
        XCTAssertEqual(b.canCatch, true, "the followed bus is catchable on foot")
        s.user = LatLon(lat: TripFix.stops["A4"]!.lat, lon: TripFix.stops["A4"]!.lon)
        XCTAssertEqual(bus(TripFix.follow(s)).vehicle?.label, "7", "at the stop you can take the bus 1 stop away")
    }

    func testPlannedTripIsTheVehiclesNextTrip() {
        let j = TripJourney(to: "X", t0: NOW - 30, legs: [
            .walk(min: 1, toName: "Ratner Center"),
            .bus(.init(rid: "L", boardId: "A4", boardName: "Ratner Center", alightId: "A6", alightName: "59th & Ellis", tripId: "next1",
                       boardT: NOW + 500, alightT: NOW + 620, source: .live, waitLive: true)),
            .walk(min: 2, toName: "X"),
        ])
        let s = TripFix.Scene(journey: j, live: TripFix.live([TripFix.bus("v9", "9", "L", "prev1", "A6", "A7", 0.5)],
                                                             [TripFix.trip("prev1", "L", "v9", "9", [("A7", 30), ("A8", 90)]),
                                                              TripFix.trip("next1", "L", "v9", "9", [("A0", 200), ("A1", 260), ("A2", 330), ("A3", 400), ("A4", 500), ("A5", 560), ("A6", 620)])]),
                              user: LatLon(lat: TripFix.stops["A4"]!.lat, lon: TripFix.stops["A4"]!.lon))
        let p = TripFix.follow(s), b = bus(p)
        XCTAssertEqual(p.phase, .waiting, "not arrived the moment the trip starts")
        XCTAssertEqual(b.vehicle?.label, "9"); XCTAssertEqual(b.vehicle?.how, .trip); XCTAssertEqual(b.vehicle?.idx, -1)
        XCTAssertEqual(b.boardEta, NOW + 500); XCTAssertTrue(b.boardLive); XCTAssertEqual(b.alightEta, NOW + 620)
    }

    func testMissedBusFollowsTheNextOne() {
        let p = prog("missed"), b = bus(p)
        XCTAssertEqual(p.phase, .waiting); XCTAssertTrue(b.missed)
        XCTAssertEqual(b.vehicle?.label, "102"); XCTAssertEqual(b.vehicle?.how, .next); XCTAssertEqual(b.stopsAway, 3)
        XCTAssertEqual(b.boardEta, NOW + 450)
        var noLoc = TripFix.scene("missed"); noLoc.user = nil
        let q = TripFix.follow(noLoc)
        XCTAssertEqual(q.phase, .onBus); XCTAssertEqual(bus(q).vehicle?.label, "101"); XCTAssertFalse(bus(q).missed, "planned bus assumed to carry you")
    }

    func testTransfer() {
        let p = prog("transfer"), b1 = bus(p, 0), b2 = bus(p, 1)
        XCTAssertEqual(p.phase, .onBus); XCTAssertEqual(p.active, 1)
        XCTAssertEqual(ids(b1), ["A1", "A2", "A3", "A4"]); XCTAssertEqual(b1.stopsLeft, 2)
        XCTAssertEqual(b2.state, .upcoming); XCTAssertEqual(b2.phase, .upcoming)
        XCTAssertEqual(ids(b2), ["B0", "B1", "B2", "B3"])
        XCTAssertEqual(b2.vehicle?.idx, -1); XCTAssertEqual(b2.vehicle?.behind, 1, "bus heading to B3 on its previous lap")
        XCTAssertEqual(b2.stopsAway, 1)
        XCTAssertEqual(b2.stops.map(\.eta), [NOW + 400, NOW + 520, NOW + 640, NOW + 860], "ETAs matched in order")
        XCTAssertEqual(p.legs[2].walk?.state, .upcoming); XCTAssertEqual(p.legs[2].walk?.toName, "Ratner East")
        XCTAssertEqual(p.arriveT, NOW + 860 + 300)
    }

    func testLoopWraps() {
        let j = TripJourney(to: "X", t0: NOW, legs: [.bus(.init(rid: "G", boardId: "B2", boardName: "Harper Court", alightId: "B0", alightName: "Ratner East",
                                                               boardT: NOW + 300, alightT: NOW + 700))])
        let live = TripFix.live([TripFix.bus("vg", "5", "G", "tg", "B0", "B1", 0.5)], [TripFix.trip("tg", "G", "vg", "5", [("B1", 60), ("B2", 200), ("B3", 400), ("B0", 600)])])
        let p = TripFollow.compute(j, staticData: TripFix.S, live: live, user: nil, now: NOW)!
        let b = bus(p)
        XCTAssertEqual(ids(b), ["B1", "B2", "B3", "B0"])
        XCTAssertEqual(b.stops.map(\.role), [.before, .board, .ride, .alight])
        XCTAssertEqual(b.vehicle?.how, .next); XCTAssertEqual(b.vehicle?.idx, 0); XCTAssertEqual(b.stopsAway, 1)
        XCTAssertEqual(b.boardEta, NOW + 200); XCTAssertEqual(b.alightEta, NOW + 600)
        XCTAssertEqual(p.phase, .waiting, "no walk before the first bus")
        XCTAssertEqual(ids(bus(TripFollow.compute(j, staticData: TripFix.S, live: TripFix.live(), user: nil, now: NOW)!)), ["B2", "B3", "B0"])
    }

    func testStaleFlagged() {
        let p = prog("stale"), b = bus(p)
        XCTAssertEqual(p.stale, .old)
        XCTAssertEqual(b.vehicle?.stale, true); XCTAssertEqual(b.vehicle?.seen, NOW - 130)
    }

    func testPlannedTripGoneLongAfterArrival() {
        let s = TripFix.Scene(journey: TripFix.journeyR(t0: NOW - 3600, boardT: NOW - 2400, alightT: NOW - 1800), live: TripFix.live())
        XCTAssertEqual(TripFix.follow(s).phase, .arrived)
        let later = TripFix.Scene(journey: TripFix.journeyR(t0: NOW - 3600, tripId: "gone", boardT: NOW - 2400, alightT: NOW - 1800),
                                  live: TripFix.live([TripFix.bus("v9", "9", "R", "t9", "A5", "A6", 0.5)], []))
        XCTAssertEqual(TripFix.follow(later).phase, .arrived, "another bus between the stops is not mistaken for yours")
    }

    func testTransferKeepsWalkNamesAndOrder() {
        let p = TripFollow.compute(TripFix.journeyXfer(), staticData: TripFix.S, live: TripFix.live(), user: nil, now: NOW)!
        XCTAssertEqual(p.legs.map { $0.bus == nil ? "walk" : "bus" }, ["walk", "bus", "walk", "bus", "walk"])
        XCTAssertEqual(p.legs[4].walk?.final, true)
    }

    /// QA 2026-10-09: Passio gives several buses one trip_id; the planned VEHICLE is followed, and the planner records it.
    func testSharedTripIdFollowsThePlannedVehicle() throws {
        let buses = [TripFix.bus("v101", "101", "R", "tS", "A6", "A7", 0.5), TripFix.bus("v102", "102", "R", "tS", "A0", "A1", 0.5)]
        let trips = [TripFix.trip("tS", "R", "v101", "101", [("A7", 60), ("A8", 160)]), TripFix.trip("tS", "R", "v102", "102", [("A1", 90), ("A4", 420), ("A7", 720)])]
        let s = TripFix.Scene(journey: TripFix.journeyR(tripId: "tS", vehicleId: "v102", boardT: NOW + 420, alightT: NOW + 720),
                              live: TripFix.live(buses, trips), user: LatLon(lat: TripFix.stops["A4"]!.lat - 0.0025, lon: TripFix.stops["A4"]!.lon))
        let p = TripFix.follow(s), b = bus(p)
        XCTAssertEqual(b.vehicle?.label, "102"); XCTAssertEqual(b.boardEta, NOW + 420); XCTAssertEqual(b.alightEta, NOW + 720)
        XCTAssertEqual(p.phase, .walkToStop, "bus 102 and ITS predictions, not bus 101 past the stop")
        let r = Planner.plan(from: TripFix.stops["A4"]!.coord, to: LatLon(lat: TripFix.stops["A7"]!.lat, lon: TripFix.stops["A7"]!.lon + 0.0005), now: NOW,
                             data: PlannerData(stops: TripFix.stops, routeStops: ["R": TripFix.routeStops["R"]!], trips: trips, buses: buses))
        let leg = try XCTUnwrap(r.options.flatMap(\.busLegs).first { $0.tripId == "tS" })
        XCTAssertEqual(leg.vehicleId, "v102", "bus leg carries the vehicle whose prediction it used")
        let journey = try XCTUnwrap(TripJourney.plan(try XCTUnwrap(r.options.first { !$0.busLegs.isEmpty }), to: "Cafe"))
        XCTAssertEqual(journey.rids, ["R"]); XCTAssertEqual(journey.label, "To Cafe")
        if case .bus(let jb) = journey.legs.first(where: { if case .bus = $0 { return true }; return false })! { XCTAssertEqual(jb.vehicleId, "v102") }
    }

    // MARK: - Edge cases (2026-10-11 sweep; expected values from running web/js/core/tripprogress.js, except
    // the two fixed on iOS first: a planned vehicle on a new trip id while you ride a loop, and another bus's
    // update standing in for the planned vehicle's own)

    /// The planned trip id is gone from the feed and you should be aboard: the bus between your stops is followed.
    func testOnboardFallbackWhenPlannedTripIsGone() {
        let s = TripFix.Scene(journey: TripFix.journeyR(t0: NOW - 900, tripId: "gone", boardT: NOW - 240, alightT: NOW + 200),
                              live: TripFix.live([TripFix.bus("v9", "9", "R", "t9", "A5", "A6", 0.4)],
                                                 [TripFix.trip("t9", "R", "v9", "9", [("A6", 70), ("A7", 200)])]))
        let p = TripFix.follow(s), b = bus(p)
        XCTAssertEqual(p.phase, .onBus)
        XCTAssertEqual(b.vehicle?.how, .onboard); XCTAssertEqual(b.vehicle?.label, "9"); XCTAssertEqual(b.vehicle?.tripId, "t9")
        XCTAssertEqual(ids(b), ["A4", "A5", "A6", "A7"]); XCTAssertEqual(b.vehicle?.idx, 2); near(b.vehicle?.pos, 1.4, 0.02)
        XCTAssertEqual(b.stops.map(\.state), [.passed, .passed, .next, .upcoming])
        XCTAssertEqual(b.stopsLeft, 2); XCTAssertNil(b.boardEta); XCTAssertEqual(b.alightEta, NOW + 200); XCTAssertTrue(b.alightLive)
        XCTAssertFalse(b.byTime); XCTAssertEqual(p.arriveT, NOW + 380)
    }

    /// The planned vehicle drops out of the feed: another bus to the boarding stop (web parity), then the plan clock.
    func testFeedDropsThePlannedVehicle() {
        let j = TripFix.journeyR(t0: NOW - 900, tripId: "tR1", vehicleId: "v101", boardT: NOW - 240, alightT: NOW + 200)
        let tR1 = TripFix.tR1([("A6", 70), ("A7", 260)])
        var s = TripFix.Scene(journey: j, live: TripFix.live([TripFix.bus("v102", "102", "R", "tR2", "A1", "A2", 0.5)],
            [tR1, TripFix.trip("tR2", "R", "v102", "102", [("A2", 60), ("A3", 150), ("A4", 240), ("A7", 500)])]))
        var p = TripFix.follow(s), b = bus(p)
        XCTAssertEqual(p.phase, .waiting); XCTAssertEqual(b.vehicle?.label, "102"); XCTAssertEqual(b.vehicle?.how, .next)
        XCTAssertEqual(b.stopsAway, 2); XCTAssertEqual(b.boardEta, NOW + 240); XCTAssertTrue(b.boardLive); XCTAssertFalse(b.missed)
        s.live = TripFix.live([], [tR1])
        p = TripFix.follow(s); b = bus(p)
        XCTAssertEqual(p.phase, .onBus); XCTAssertNil(b.vehicle); XCTAssertTrue(b.byTime); XCTAssertFalse(b.live)
        XCTAssertEqual(b.stops.map(\.state), [.passed, .upcoming, .upcoming, .upcoming])
        XCTAssertEqual(b.alightEta, NOW + 200, "planned time"); XCTAssertFalse(b.alightLive)
        XCTAssertEqual(p.arriveT, NOW + 380); XCTAssertFalse(p.arriveLive)
    }

    /// Loops roll the trip id at their start stop. Riding A6 -> A1 across it, the planned vehicle now reports lapB:
    /// you are on it, it is not "5 stops away" on its previous lap (fixed on iOS 2026-10-11; web still reads the lap).
    func testLoopTripIdChangeWhileRiding() {
        func journey(_ vid: String?) -> TripJourney {
            TripJourney(to: "X", t0: NOW - 400, legs: [
                .bus(.init(rid: "L", boardId: "A6", boardName: "59th & Ellis", alightId: "A1", alightName: "56th & Ellis", tripId: "lapA",
                           vehicleId: vid, boardT: NOW - 300, alightT: NOW + 180, source: .live, waitLive: true)),
                .walk(min: 2, toName: "X"),
            ])
        }
        let live = TripFix.live([TripFix.bus("v9", "9", "L", "lapB", "A0", "A1", 0.5)],
                                [TripFix.trip("lapB", "L", "v9", "9", [("A1", 60), ("A2", 150), ("A3", 240), ("A4", 330), ("A5", 420), ("A6", 510), ("A7", 600)])])
        for vid in [nil, "v9"] {
            let p = TripFollow.compute(journey(vid), staticData: TripFix.S, live: live, user: nil, now: NOW)!, b = bus(p)
            XCTAssertEqual(p.phase, .onBus, "vehicle \(vid ?? "none")"); XCTAssertEqual(b.vehicle?.how, .onboard)
            XCTAssertEqual(b.vehicle?.label, "9"); XCTAssertEqual(b.stopsLeft, 1)
            XCTAssertEqual(ids(b), ["A6", "A7", "A8", "A0", "A1"]); XCTAssertEqual(b.alightEta, NOW + 60); XCTAssertTrue(b.alightLive)
            XCTAssertFalse(TripText.busWords(b, now: NOW).status.contains("stops away"))
        }
    }

    /// The planned vehicle on a new trip id on a line route: still followed as the bus you ride.
    func testPlannedVehicleOnANewTripLineRoute() {
        let s = TripFix.Scene(journey: TripFix.journeyR(t0: NOW - 900, tripId: "tR1", vehicleId: "v101", boardT: NOW - 240, alightT: NOW + 200),
                              live: TripFix.live([TripFix.bus("v101", "101", "R", "tR9", "A5", "A6", 0.4)],
                                                 [TripFix.trip("tR9", "R", "v101", "101", [("A6", 70), ("A7", 200)])]))
        let p = TripFix.follow(s), b = bus(p)
        XCTAssertEqual(p.phase, .onBus)
        XCTAssertEqual(b.vehicle?.label, "101"); XCTAssertEqual(b.vehicle?.tripId, "tR9"); XCTAssertEqual(b.vehicle?.how, .onboard)
        XCTAssertEqual(b.vehicle?.idx, 2); XCTAssertEqual(b.stopsLeft, 2); XCTAssertEqual(b.alightEta, NOW + 200); XCTAssertTrue(b.alightLive)
    }

    /// Passio reuses trip ids: the planned trip id is now run by ONE other bus. The planned vehicle keeps its own
    /// predictions, never bus 103's times next to bus 102's position (fixed on iOS 2026-10-11).
    func testPlannedTripIdNowRunByOneOtherVehicle() {
        let j = TripFix.journeyR(tripId: "tS", vehicleId: "v102", boardT: NOW + 420, alightT: NOW + 720)
        let tX = TripFix.trip("tX", "R", "v102", "102", [("A2", 60), ("A3", 150), ("A4", 240), ("A7", 500)])
        var s = TripFix.Scene(journey: j, live: TripFix.live([TripFix.bus("v102", "102", "R", "tX", "A1", "A2", 0.5)],
            [TripFix.trip("tS", "R", "v103", "103", [("A4", 100), ("A7", 400)]), tX]),
            user: LatLon(lat: TripFix.stops["A4"]!.lat, lon: TripFix.stops["A4"]!.lon))
        var b = bus(TripFix.follow(s))
        XCTAssertEqual(b.vehicle?.label, "102"); XCTAssertEqual(b.vehicle?.how, .trip); XCTAssertEqual(b.stopsAway, 2)
        XCTAssertEqual(b.boardEta, NOW + 240, "bus 102's own prediction"); XCTAssertEqual(b.alightEta, NOW + 500)
        s.live.trips.insert(TripFix.trip("tS", "R", "v104", "104", [("A4", 900)]), at: 1)
        b = bus(TripFix.follow(s))
        XCTAssertEqual(b.boardEta, NOW + 240, "bus 102's own trip update"); XCTAssertEqual(b.alightEta, NOW + 500)
    }

    /// The alighting stop is not on the route: no bus is placed, planned times only.
    func testAlightingStopNotOnTheRoute() {
        var s = TripFix.scene("waiting")
        s.journey = TripJourney(to: "Medical Center Cafe", t0: NOW - 120, legs: [
            .walk(min: 4, toName: "Ratner Center"),
            .bus(.init(rid: "R", boardId: "A4", boardName: "Ratner Center", alightId: "Z9", alightName: "Nowhere", tripId: "tR1",
                       boardT: NOW + 240, alightT: NOW + 500, source: .live, waitLive: true)),
            .walk(min: 3, toName: "Medical Center Cafe"),
        ])
        var p = TripFix.follow(s), b = bus(p)
        XCTAssertEqual(p.phase, .waiting); XCTAssertNil(b.vehicle); XCTAssertFalse(b.live); XCTAssertFalse(b.byTime)
        XCTAssertEqual(ids(b), ["A4", "Z9"]); XCTAssertEqual(b.stops.map(\.name), ["Ratner Center", "Nowhere"])
        XCTAssertEqual([b.boardIdx, b.alightIdx], [0, 1])
        XCTAssertEqual(b.boardEta, NOW + 240); XCTAssertFalse(b.boardLive); XCTAssertEqual(b.alightEta, NOW + 500); XCTAssertFalse(b.alightLive)
        XCTAssertEqual(TripText.whereLine(b, now: NOW), "No live position for this bus")
        s.user = nil
        p = TripFix.follow(s); b = bus(p)
        XCTAssertEqual(p.phase, .walkToStop); XCTAssertTrue(b.byTime)
        XCTAssertEqual(b.walkMin, 4); XCTAssertEqual(b.slackMin, 0); XCTAssertEqual(b.canCatch, true)
    }

    /// "Missed" needs the planned bus more than 250 m past the stop (it may still be pulling away).
    func testMissedNeedsTheBusMoreThan250mAway() {
        var s = TripFix.scene("missed")
        s.live.buses[0] = TripFix.bus("v101", "101", "R", "tR1", "A4", "A5", 0.3)
        s.live.trips[0] = TripFix.tR1([("A5", 20), ("A7", 160)])
        var p = TripFix.follow(s), b = bus(p)
        XCTAssertFalse(b.missed); XCTAssertEqual(p.phase, .onBus); XCTAssertEqual(b.vehicle?.label, "101"); XCTAssertEqual(b.vehicle?.how, .trip)
        XCTAssertEqual(b.stopsLeft, 3); XCTAssertEqual(b.alightEta, NOW + 160)
        s.live.buses[0] = TripFix.bus("v101", "101", "R", "tR1", "A5", "A6", 0.3)
        s.live.trips[0] = TripFix.tR1([("A6", 40), ("A7", 160)])
        p = TripFix.follow(s); b = bus(p)
        XCTAssertTrue(b.missed); XCTAssertEqual(p.phase, .waiting); XCTAssertEqual(b.vehicle?.label, "102"); XCTAssertEqual(b.stopsAway, 3)
        XCTAssertEqual(b.boardEta, NOW + 450)
    }

    /// The missed note never promises a next bus that is not there, and shows on the walk to the stop too (iOS).
    func testMissedWordingEdges() {
        var s = TripFix.scene("missed")
        s.live.buses.removeLast(); s.live.trips.removeLast()
        var p = TripFix.follow(s), b = bus(p)
        XCTAssertTrue(b.missed); XCTAssertNil(b.vehicle); XCTAssertEqual(p.phase, .waiting); XCTAssertNil(b.boardEta); XCTAssertFalse(b.live)
        let c = TripText.nowCard(p, routes: TripFix.routes, now: NOW)
        XCTAssertEqual(c.prim, "Waiting for the bus")
        XCTAssertEqual(c.sec, ["Board at Ratner Center", "Your planned bus has left.", "No live bus position right now."])
        s = TripFix.scene("missed"); s.user = LatLon(lat: TripFix.stops["A4"]!.lat + 0.0008, lon: TripFix.stops["A4"]!.lon)
        p = TripFix.follow(s); b = bus(p)
        XCTAssertTrue(b.missed); XCTAssertEqual(p.phase, .walkToStop); XCTAssertEqual(b.vehicle?.label, "102")
        let w = TripText.nowCard(p, routes: TripFix.routes, now: NOW)
        XCTAssertEqual(w.prim, "Walk 1 min to Ratner Center")
        XCTAssertEqual(w.sec, ["Leave in 6 min, est.", "Bus 102 is 3 stops away", "Your planned bus has left. Showing the next one."])
    }

    /// At the alighting stop the ride is done, even without a live bus.
    func testAtTheAlightingStopTheRideIsDone() {
        var s = TripFix.Scene(journey: TripFix.journeyR(t0: NOW - 900, boardT: NOW - 240, alightT: NOW + 200), live: TripFix.live(),
                              user: LatLon(lat: TripFix.stops["A7"]!.lat, lon: TripFix.stops["A7"]!.lon))
        var p = TripFix.follow(s)
        XCTAssertEqual(p.phase, .arrived); XCTAssertEqual(bus(p).state, .done); XCTAssertTrue(bus(p).byTime); XCTAssertEqual(bus(p).doneT, NOW)
        XCTAssertEqual(p.arriveT, NOW + 180); XCTAssertEqual(p.legs.last?.walk?.state, .active)
        s.user = nil
        p = TripFix.follow(s)
        XCTAssertEqual(p.phase, .onBus); XCTAssertEqual(bus(p).alightEta, NOW + 200)
    }

    /// A vehicle whose stop id is off the route is placed by its trip update's next stop, else ignored.
    func testVehicleStopIdNotOnTheRoute() {
        var s = TripFix.scene("waiting")
        s.live.buses[0].stopId = "ZZ"
        var b = bus(TripFix.follow(s))
        XCTAssertEqual(b.vehicle?.nextId, "A2"); XCTAssertEqual(b.vehicle?.idx, 1); XCTAssertEqual(b.stopsAway, 2)
        XCTAssertEqual(b.boardEta, NOW + 240); XCTAssertTrue(b.boardLive)
        s.live.trips = []
        let p = TripFix.follow(s); b = bus(p)
        XCTAssertEqual(p.phase, .waiting); XCTAssertNil(b.vehicle); XCTAssertFalse(b.live); XCTAssertFalse(b.byTime)
        XCTAssertEqual(ids(b), ["A4", "A5", "A6", "A7"]); XCTAssertEqual(b.boardEta, NOW + 240); XCTAssertFalse(b.boardLive)
        XCTAssertTrue(TripText.nowCard(p, routes: TripFix.routes, now: NOW).sec.contains("No live bus position right now."))
    }

    /// The planned bus is followed even when you cannot walk there in time, and the card says so.
    func testPlannedBusYouCannotReachOnFoot() {
        var s = TripFix.scene("walk"); s.user = LatLon(lat: TripFix.stops["A4"]!.lat - 0.0108, lon: TripFix.stops["A4"]!.lon)
        let p = TripFix.follow(s), b = bus(p)
        XCTAssertEqual(p.phase, .walkToStop); XCTAssertEqual(b.vehicle?.label, "101"); XCTAssertEqual(b.vehicle?.how, .trip)
        near(b.walkMin, 18.014, 0.01); near(b.slackMin, -11.014, 0.01); XCTAssertEqual(b.canCatch, false)
        let c = TripText.nowCard(p, routes: TripFix.routes, now: NOW)
        XCTAssertEqual(c.prim, "Walk 18 min to Ratner Center")
        XCTAssertEqual(c.sec, ["Leaves before you can walk there, est.", "Bus 101 is 3 stops away"])
    }

    /// Boarding at a loop's start stop: the bus that just left reads as its previous lap only while you are at the stop.
    func testBoardingAtTheLoopStart() {
        let j = TripJourney(to: "X", t0: NOW - 60, legs: [
            .bus(.init(rid: "G", boardId: "B0", boardName: "Ratner East", alightId: "B3", alightName: "Lake Park & 53rd <b>", tripId: "tG1",
                       boardT: NOW - 20, alightT: NOW + 400, source: .live, waitLive: true)),
            .walk(min: 2, toName: "X"),
        ])
        var s = TripFix.Scene(journey: j, live: TripFix.live([TripFix.bus("v301", "301", "G", "tG1", "B0", "B1", 0.2)],
            [TripFix.trip("tG1", "G", "v301", "301", [("B0", -20), ("B1", 60), ("B2", 180), ("B3", 400), ("B0", 600)])]))
        var p = TripFix.follow(s), b = bus(p)
        XCTAssertEqual(p.phase, .waiting); XCTAssertEqual(b.vehicle?.idx, -1); XCTAssertEqual(b.vehicle?.behind, 3); XCTAssertEqual(b.stopsAway, 3)
        XCTAssertEqual(b.boardEta, NOW - 20); XCTAssertTrue(b.boardLive); XCTAssertEqual(b.alightEta, NOW + 400)
        p = TripFix.follow(s, now: NOW + 60); b = bus(p)
        XCTAssertEqual(p.phase, .onBus); XCTAssertEqual(b.vehicle?.idx, 1); XCTAssertEqual(b.stopsLeft, 3); XCTAssertEqual(b.alightEta, NOW + 400)
        s.user = LatLon(lat: TripFix.stops["B0"]!.lat, lon: TripFix.stops["B0"]!.lon + 0.0008)
        p = TripFix.follow(s, now: NOW + 60); b = bus(p)
        XCTAssertEqual(p.phase, .waiting); XCTAssertEqual(b.stopsAway, 3); XCTAssertEqual(b.boardEta, NOW + 600)
        XCTAssertEqual(b.alightEta, NOW + 1020); XCTAssertFalse(b.alightLive)
    }

    func testFeedLevelsReachTheTrip() {
        var l = TripFix.live(); l.failed = true
        XCTAssertEqual(TripFollow.compute(TripFix.journeyR(), staticData: TripFix.S, live: l, user: nil, now: NOW)?.stale, .err)
        l = TripFix.live(feedTs: NOW - 200)
        XCTAssertEqual(TripFollow.compute(TripFix.journeyR(), staticData: TripFix.S, live: l, user: nil, now: NOW)?.stale, .late)
        l = TripFix.live(); l.lastOk = 0
        XCTAssertEqual(TripFollow.compute(TripFix.journeyR(), staticData: TripFix.S, live: l, user: nil, now: NOW)?.stale, .err)
    }

    /// Without stop sequences, predictions are matched in time order (the loop's B3 at both ends included).
    func testEtasWithoutStopSequenceUseTimeOrder() {
        var s = TripFix.scene("transfer")
        s.live.trips[1] = TripUpdate(trip: .init(tripId: "tG1", routeId: "G"), vehicle: .init(id: "v301", label: "301"),
            stopTimeUpdates: [("B0", 400.0), ("B3", 860), ("B1", 520), ("B2", 640), ("B3", 60)].map { StopTimeUpdate(stopId: $0.0, arrival: NOW + $0.1, departure: NOW + $0.1 + 1) })
        let b2 = bus(TripFix.follow(s), 1)
        XCTAssertEqual(b2.stops.map(\.eta), [NOW + 400, NOW + 520, NOW + 640, NOW + 860]); XCTAssertEqual(b2.vehicle?.behind, 1)
    }

    /// Junk feed numbers never crash the poll: a NaN or huge stop sequence, a time past the year 5000.
    func testOddFeedNumbersNeverTrap() throws {
        let json = #"{"entity":[{"trip_update":{"trip":{"trip_id":"t","route_id":"R"},"vehicle":{"id":"v"},"stop_time_update":[{"stop_id":"A1","stop_sequence":"nan","arrival":{"time":1800000060}},{"stop_id":"A2","stop_sequence":1e19,"arrival":{"time":1800000120}},{"stop_id":"A3","arrival":{"time":"inf"}},{"stop_id":"A4","arrival":{"time":1e21}}]}}]}"#
        let f = try FeedParser.tripUpdates(Data(json.utf8))
        let ups = try XCTUnwrap(f.entities.first?.stopTimeUpdates)
        XCTAssertEqual(ups.map(\.stopId), ["A1", "A2", "A3", "A4"])
        XCTAssertEqual(ups.map(\.stopSequence), [nil, nil, nil, nil])
        XCTAssertEqual(ups.map(\.time), [1_800_000_060, 1_800_000_120, 0, 0], "infinite and far-future times are missing, not live")
        let vp = try FeedParser.vehicles(Data(#"{"entity":[{"vehicle":{"current_stop_sequence":1e300,"timestamp":"nan","position":{"latitude":41.79,"longitude":-87.6}}}]}"#.utf8))
        XCTAssertEqual(vp.entities.count, 1); XCTAssertNil(vp.entities.first?.currentStopSequence); XCTAssertEqual(vp.entities.first?.timestamp, 0)
        var s = TripFix.scene("waiting")
        s.live.trips = [TripFix.tR1([("A2", 60), ("A4", 1e21)])]
        let p = TripFix.follow(s)
        XCTAssertNotEqual(bus(p).boardEta, NOW + 1e21, "a far-future time is not a live prediction")
        _ = TripText.nowCard(p, routes: TripFix.routes, now: NOW)
        _ = TripText.arriveLine(p, now: NOW)
        XCTAssertEqual(TimeFmt.minsUntil(1e30, from: 0), 1_000_000_000)
        XCTAssertEqual(TimeFmt.minsUntil(.nan, from: 0), 0)
        XCTAssertEqual(TimeFmt.minsUntil(-.infinity, from: 0), -1_000_000_000)
        XCTAssertFalse(TimeFmt.ago(1e300, from: NOW).isEmpty)
    }
}

/// Port of the wording checks in web/tests/trip-view.js (ui/views/tripprogress.js) plus the Live Activity content.
final class TripTextTests: XCTestCase {
    let NOW = TripFix.NOW
    func card(_ id: String) -> TripText.NowCard { TripText.nowCard(TripFix.follow(TripFix.scene(id)), routes: TripFix.routes, now: NOW) }

    /// web trip-view.js: no trip id and an empty feed -> the plan's clock, said as an estimate.
    func testNoTripIdEmptyFeed() {
        let p = TripFollow.compute(TripFix.journeyR(tripId: nil), staticData: TripFix.S, live: TripFix.live(), user: nil, now: NOW)!
        let c = TripText.nowCard(p, routes: TripFix.routes, now: NOW)
        XCTAssertEqual(c.prim, "Walk 4 min to Ratner Center")
        XCTAssertEqual(c.sec, ["Leave in 3 min, est.", "RL planned in 7 minutes, est.", "No live bus data: following the plan's times (estimate)."])
        XCTAssertTrue(c.etaApprox)
    }

    func testWalkingToTheStop() {
        let p = TripFix.follow(TripFix.scene("walk"))
        let c = card("walk")
        XCTAssertEqual(c.prim, "Walk 4 min to Ratner Center")
        XCTAssertEqual(c.sec, ["Leave in 2 min, est.", "Bus 101 is 3 stops away"])
        XCTAssertEqual(TripText.walkRow(p, 0, now: NOW).head, "Walk 4 min to Ratner Center")
        XCTAssertEqual(TripText.walkRow(p, 0, now: NOW).sub, "Leave in 2 min, est.")
        let lead = TripText.leadRow(p.busLegs[0])
        XCTAssertEqual(lead?.text, "55th & Ellis"); XCTAssertEqual(lead?.passed, true, "the stop the bus just left, passed")
        XCTAssertEqual(TripText.arriveLine(p, now: NOW), "Arrive about \(TimeFmt.clock(NOW + 900)) · 15 min")
        var far = TripFix.scene("walk")
        var b = TripFix.bus("v101", "101", "R", "tR1", "A0", "A1", 0.1)
        b.stopId = "A0"; b.latitude = TripFix.stops["A0"]!.lat - 0.001; b.longitude = TripFix.stops["A0"]!.lon
        far.live.buses = [b]
        let fp = TripFix.follow(far)
        XCTAssertEqual(TripText.leadRow(fp.busLegs[0])?.text, "1 more stop before 56th & Ellis")
        XCTAssertEqual(TripText.busWords(fp.busLegs[0], now: NOW).status, "Bus 101 is 4 stops away")
    }

    func testWaiting() {
        let p = TripFix.follow(TripFix.scene("waiting")), leg = p.busLegs[0]
        let c = card("waiting")
        XCTAssertEqual(c.prim, "Bus 101 is 2 stops away")
        XCTAssertEqual(c.sec.first, "Board at Ratner Center in 4 minutes")
        XCTAssertEqual(TripText.stopEta(leg.stops[0], leg, now: NOW, late: false).text, "Passed", "not color alone")
        XCTAssertEqual(TripText.busPill(leg.stops[1], k: 1, leg), "Bus 101 heading here")
        XCTAssertTrue(TripText.stopSay(leg.stops[0], k: 0, leg, now: NOW, late: false).contains("the bus has passed this stop"))
        XCTAssertTrue(TripText.stopSay(leg.stops[1], k: 1, leg, now: NOW, late: false).contains("the bus is heading here"))
        XCTAssertEqual(TripText.whereLine(leg, now: NOW), "Bus 101 is between 56th & Ellis and 57th & Ellis")
    }

    func testOnBusArrivedSchedule() {
        XCTAssertEqual(card("onbus").prim, "Get off in 2 stops: Medical Center", "the same words as the map and the trip alerts")
        XCTAssertTrue(card("onbus").sec[0].hasPrefix("Get off at Medical Center about "))
        let ar = TripFix.follow(TripFix.scene("arrived"))
        XCTAssertEqual(card("arrived").prim, "Walk 3 min to Medical Center Cafe")
        XCTAssertEqual(TripText.walkRow(ar, 0, now: NOW).head, "Walked to Ratner Center")
        let sc = TripFix.follow(TripFix.scene("schedule")), leg = sc.busLegs[0]
        XCTAssertTrue(card("schedule").sec.contains("No live bus data: following the plan's times (estimate)."))
        XCTAssertTrue(card("schedule").prim.hasPrefix("Bus planned for"))
        let e = TripText.stopEta(leg.stops[leg.boardIdx], leg, now: NOW, late: false)
        XCTAssertEqual(e.text, "~" + TimeFmt.clock(NOW + 120)); XCTAssertTrue(e.est, "planned clock + est. tag")
        XCTAssertTrue(TripText.footnote(sc).hasPrefix("No live data for this bus right now"))
    }

    func testStaleMissedTransfer() {
        let st = TripFix.follow(TripFix.scene("stale"))
        XCTAssertTrue(TripText.whereLine(st.busLegs[0], now: NOW).hasSuffix("location from 2 min ago"))
        XCTAssertEqual(TripText.etaText(NOW + 300, now: NOW, late: true), "~5 min")
        XCTAssertTrue(card("missed").sec.contains("Your planned bus has left. Showing the next one."))
        XCTAssertEqual(card("missed").prim, "Bus 102 is 3 stops away")
        let tr = TripFix.follow(TripFix.scene("transfer"))
        XCTAssertEqual(TripText.walkRow(tr, 2, now: NOW).head, "Walk 1 min to Ratner East to change")
        XCTAssertTrue(TripText.whereLine(tr.busLegs[1], now: NOW).hasPrefix("Next bus at "))
        XCTAssertEqual(TripText.etaText(NOW + 20, now: NOW, late: false), "Now")
        XCTAssertEqual(TripText.etaText(nil, now: NOW, late: false), "")
    }

    func testEveryPhaseLabelsBoardingAndEstimates() {
        for id in TripFix.sceneIds {
            let p = TripFix.follow(TripFix.scene(id))
            XCTAssertTrue(p.busLegs.allSatisfy { $0.stops.contains { $0.role == .board } && $0.stops.contains { $0.role == .alight } }, id)
            XCTAssertTrue(TripText.footnote(p).hasSuffix("Every time here is an estimate."), id)
        }
    }

    func testLiveActivitySnapshot() throws {
        let walk = try XCTUnwrap(TripFix.follow(TripFix.scene("walk")).snapshot(staticData: TripFix.S, now: NOW))
        XCTAssertEqual(walk.routeShort, "RL"); XCTAssertEqual(walk.boardName, "Ratner Center"); XCTAssertEqual(walk.alightName, "Medical Center")
        XCTAssertEqual(walk.stopsAway, 3); XCTAssertNil(walk.stopsLeft)
        XCTAssertEqual(walk.target, NOW + 420)
        XCTAssertEqual(walk.headline, "Bus 101 is 3 stops away"); XCTAssertNil(walk.headlineLead)
        XCTAssertEqual(walk.stopNames.count, 6); XCTAssertEqual(walk.boardIndex, 3)
        XCTAssertEqual(walk.busPosition ?? 9, -0.5, accuracy: 0.05)
        XCTAssertEqual(walk.compactText(now: NOW), "3 stops · 7 min")
        XCTAssertTrue(walk.live)
        let on = try XCTUnwrap(TripFix.follow(TripFix.scene("onbus")).snapshot(staticData: TripFix.S, now: NOW))
        XCTAssertEqual(on.stopsLeft, 2); XCTAssertEqual(on.target, NOW + 200); XCTAssertEqual(on.headline, "Get off in 2 stops: Medical Center")
        XCTAssertEqual(on.busPosition ?? 9, 1.4, accuracy: 0.05)
        let sc = try XCTUnwrap(TripFix.follow(TripFix.scene("schedule")).snapshot(staticData: TripFix.S, now: NOW))
        XCTAssertEqual(sc.headlineLead, "Next RL at Ratner Center", "the widget adds a ticking timer to this")
        XCTAssertEqual(sc.headline, "Next RL at Ratner Center in about 2 min")
        XCTAssertFalse(sc.live)
        let ar = try XCTUnwrap(TripFix.follow(TripFix.scene("arrived")).snapshot(staticData: TripFix.S, now: NOW))
        XCTAssertEqual(ar.headline, "Walk 3 min to Medical Center Cafe")
        let later = try XCTUnwrap(TripFix.follow(TripFix.scene("walk"), now: NOW + 2).snapshot(staticData: TripFix.S, now: NOW + 2))
        XCTAssertTrue(walk.sameContent(as: later), "only asOf differs")
    }
}
