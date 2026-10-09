import XCTest
@testable import StraightBussingKit

/// Port of web/tests/core-planner.js (synthetic network, no network access).
/// Loop LOOP: L0 -> L1 -> L2 -> L3 -> L0. Line A: A0 -> A1 -> A2, line B: B0 -> B1 (B0 ~55 m from A2).
final class PlannerTests: XCTestCase, PlannerFixture {
    static let T = 1_800_000_000.0
    static let stops: [String: Stop] = {
        let raw: [(String, Double, Double)] = [
            ("L0", 41.79, -87.6), ("L1", 41.79, -87.59), ("L2", 41.8, -87.59), ("L3", 41.8, -87.6),
            ("A0", 41.78, -87.62), ("A1", 41.78, -87.61), ("A2", 41.78, -87.6),
            ("B0", 41.7795, -87.6), ("B1", 41.77, -87.6), ("X", 41.75, -87.6), ("Y", 41.75, -87.56),
        ]
        return Dictionary(uniqueKeysWithValues: raw.map { ($0.0, Stop(id: $0.0, name: $0.0, lat: $0.1, lon: $0.2)) })
    }()

    static func bus(_ rid: String) -> VehiclePosition { .on(rid, id: rid + "v") }
    static func trip(_ id: String, _ rid: String, _ ups: [(String, Double)]) -> TripUpdate { .make(id, rid, label: id, ups) }
    static func sumLegs(_ o: TripOption) -> Double {
        o.legs.reduce(0.0) { s, l in switch l { case .walk(let w): return s + w.min; case .bus(let b): return s + b.wait + b.ride } }
    }
    static func walkSum(_ o: TripOption) -> Double { o.walkLegs.reduce(0.0) { $0 + $1.min } }

    func testLoopWrapsWithHeadwayEstimate() throws {
        let r = Planner.plan(from: near_("L3"), to: near_("L1"), now: T, data: data())
        let o = try XCTUnwrap(r.options.first)
        XCTAssertEqual(o.key, "LOOP")
        let b = o.busLegs[0]
        XCTAssertEqual(b.board.id, "L3"); XCTAssertEqual(b.alight.id, "L1"); XCTAssertEqual(b.stopsPassed, 2)
        XCTAssertFalse(b.waitLive)
        XCTAssertEqual(b.source, .estimate)
        let cycle = (2 * hav("L0", "L1") + 2 * hav("L1", "L2")) / 300
        near(b.wait, cycle / 2, 0.01, "cycle / 1 bus / 2")
        near(b.ride, (hav("L3", "L0") + hav("L0", "L1")) / 300, 0.01, "distance at 18 km/h")
        XCTAssertEqual(b.path.count, 3)
        XCTAssertEqual(b.stopIds, ["L3", "L0", "L1"])
        let w0 = try XCTUnwrap(o.legs[0].walk, "13 m start walk kept as a step")
        near(w0.min, Geo.hav(near_("L3"), stops["L3"]!.coord) * 1.2 / 80, 1e-6, "short walk still costs time")
        near(b.boardT, T + w0.min * 60 + b.wait * 60, 1, "wait starts when you reach the stop")
        near(b.alightT, b.boardT + b.ride * 60, 1)
        near(o.arrive, T + o.total * 60, 0.01)
        XCTAssertEqual(o.totalMin, Int(JS.round(o.total)))
        XCTAssertTrue(r.walkOnlyM > 1500 && abs(r.walkOnlyMin - Double(r.walkOnlyM) / 80) < 0.02)
    }

    func testHeadwayDividedByBusesAndCapped() {
        let two = Planner.plan(from: near_("L3"), to: near_("L1"), now: T, data: data(buses: [Self.bus("LOOP"), Self.bus("LOOP")]))
        let one = Planner.plan(from: near_("L3"), to: near_("L1"), now: T, data: data())
        near(two.options[0].busLegs[0].wait, one.options[0].busLegs[0].wait / 2, 0.01)
        XCTAssertEqual(Planner.headwayCap, 30)
    }

    func testOneTransferWithin150m() throws {
        let r = Planner.plan(from: near_("A0"), to: near_("B1", -0.0001), now: T, data: data())
        let o = try XCTUnwrap(r.options.first { $0.key == "A>B" }, "transfer option: \(r.options.map(\.key))")
        XCTAssertEqual(o.legs.map { $0.isWalk ? "walk" : "bus" }, ["walk", "bus", "walk", "bus", "walk"])
        let b1 = o.busLegs[0], b2 = o.busLegs[1]
        XCTAssertEqual([b1.board.id, b1.alight.id, b2.board.id, b2.alight.id], ["A0", "A2", "B0", "B1"])
        let xw = try XCTUnwrap(o.legs[2].walk)
        XCTAssertTrue(xw.m <= 150 && xw.m > 25, "transfer walk \(xw.m)")
        XCTAssertGreaterThanOrEqual(b2.boardT, b1.alightT + xw.min * 60 - 1, "second bus after transfer walk")
        XCTAssertEqual(r.options.count, 1)
    }

    func testNoTransferWhenStopsFarApart() {
        var far = stops
        far["B0"] = Stop(id: "B0", name: "B0", lat: 41.778, lon: -87.6)   // ~222 m from A2
        let r = Planner.plan(from: near_("A0"), to: near_("B1", -0.0001), now: T, data: data(stops: far))
        XCTAssertFalse(r.options.contains { $0.key == "A>B" })
        for o in r.options {
            XCTAssertEqual(o.key, "A")
            XCTAssertTrue(o.legs.last!.walk!.m > 800 && o.total < r.walkOnlyMin, "long end walk counted, still faster")
        }
    }

    func testLiveWaitAndSameTripRide() {
        let trips = [Self.trip("t1", "LOOP", [("L3", T + 300), ("L0", T + 500), ("L1", T + 700)])]
        let r = Planner.plan(from: near_("L3"), to: near_("L1"), now: T, data: data(trips: trips))
        let b = r.options[0].busLegs[0]
        XCTAssertTrue(b.waitLive)
        near(b.wait, 5 - r.options[0].legs[0].walk!.min, 1e-6, "wait counted from when you reach the stop")
        XCTAssertEqual(b.boardT, T + 300)
        XCTAssertEqual(b.alightT, T + 700)
        near(b.ride, 400.0 / 60, 0.01)
        XCTAssertEqual(b.source, .live)
        XCTAssertEqual(b.tripId, "t1")
    }

    func testArrivalBeforeYouReachTheStopIsSkipped() {
        let trips = [Self.trip("t1", "LOOP", [("L3", T + 5)]), Self.trip("t2", "LOOP", [("L3", T + 900)])]
        let from = LatLon(lat: stops["L3"]!.lat + 0.002, lon: stops["L3"]!.lon)   // ~222 m -> 3.3 min walk
        let r = Planner.plan(from: from, to: near_("L1"), now: T, data: data(trips: trips))
        XCTAssertEqual(r.options[0].busLegs[0].boardT, T + 900)
        XCTAssertTrue(r.options[0].legs[0].isWalk)
    }

    struct FixedPredict: RidePredictor {
        var f: @Sendable (String, String, String) -> RideEstimate
        func rideMinutes(rid: String, from: String, to: String, when: Double) throws -> RideEstimate { f(rid, from, to) }
    }
    struct Boom: Error {}
    struct ThrowingPredict: RidePredictor {
        func rideMinutes(rid: String, from: String, to: String, when: Double) throws -> RideEstimate { throw Boom() }
    }

    func testPredictorUsedWithoutLiveSameTrip() {
        let predict = FixedPredict { _, _, _ in RideEstimate(min: 3, source: .learned, conf: 0.7, p10: 2, p90: 5) }
        let b = Planner.plan(from: near_("L3"), to: near_("L1"), now: T, data: data(), predict: predict).options[0].busLegs[0]
        XCTAssertEqual(b.ride, 3); XCTAssertEqual(b.source, .learned); XCTAssertEqual(b.conf, 0.7)
        XCTAssertEqual(b.p10, 2); XCTAssertEqual(b.p90, 5)
        let bad = Planner.plan(from: near_("L3"), to: near_("L1"), now: T, data: data(), predict: ThrowingPredict())
        XCTAssertEqual(bad.options[0].busLegs[0].source, .estimate)
    }

    func testAbsurdlySlowOptionsDropped() {
        XCTAssertEqual(Planner.plan(from: near_("L1"), to: near_("L0"), now: T, data: data()).options.count, 1)
        let slow = Planner.plan(from: near_("L1"), to: near_("L0"), now: T, data: data(),
                                predict: FixedPredict { _, _, _ in RideEstimate(min: 60, source: .schedule, conf: 0.4) })
        XCTAssertEqual(slow.options.count, 0)
        XCTAssertGreaterThan(slow.walkOnlyMin, 10)
    }

    func testEqualWalkingEarliestArrivalOrdersMax4Meets() {
        let rs = ["P1": ["X", "Y"], "P2": ["X", "Y"], "P3": ["X", "Y"], "P4": ["X", "Y"]]
        let mins = ["P1": 9.0, "P2": 3, "P3": 6, "P4": 12]
        let r = Planner.plan(from: near_("X"), to: near_("Y"), now: T,
                             data: data(routeStops: rs, order: ["P1", "P2", "P3", "P4"], buses: ["P1", "P2", "P3", "P4"].map(Self.bus)),
                             predict: FixedPredict { rid, _, _ in RideEstimate(min: mins[rid]!, source: .schedule, conf: 0.4) })
        XCTAssertEqual(r.options.map(\.key), ["P2", "P3", "P1", "P4"])
        XCTAssertTrue(r.options.allSatisfy { $0.meets.contains(.walk) })
        XCTAssertTrue(r.options[0].meets.contains(.arrive) && !r.options[1].meets.contains(.arrive))
    }

    func testNothingRunningAndBadInput() {
        let r = Planner.plan(from: near_("L3"), to: near_("L1"), now: T, data: data(buses: []))
        XCTAssertEqual(r.options, [])
        XCTAssertGreaterThan(r.walkOnlyM, 0)
        XCTAssertEqual(Planner.plan(from: nil, to: near_("L1"), now: T, data: data()).options, [])
        XCTAssertEqual(Planner.plan(from: near_("L3"), to: near_("L1"), now: T, data: nil).options, [])
        let holes = Planner.plan(from: near_("L3"), to: near_("L1"), now: T,
                                 data: data(routeStops: ["LOOP": ["L0", "GONE", "L1", "L2", "L3", "L0"]]))
        XCTAssertEqual(holes.options[0].busLegs[0].alight.id, "L1", "unknown stop ids skipped")
    }

    func testFarFromAnyStop() {
        XCTAssertEqual(Planner.plan(from: LatLon(lat: 41.9, lon: -87.7), to: near_("L1"), now: T, data: data()).options, [])
    }

    func testDestinationFarFromStopStillGetsBusWithWalk() throws {
        let to = LatLon(lat: stops["Y"]!.lat + 0.0108, lon: stops["Y"]!.lon)   // ~1.2 km north of Y
        XCTAssertGreaterThan(Geo.hav(to, stops["Y"]!.coord) * 1.2, Planner.maxWalk)
        let r = Planner.plan(from: near_("X"), to: to, now: T, data: data(routeStops: ["P": ["X", "Y"]], buses: [Self.bus("P")]))
        XCTAssertEqual(r.options.count, 1, "bus + long walk beats walking")
        let o = r.options[0], last = try XCTUnwrap(o.legs.last?.walk)
        XCTAssertEqual(o.key, "P")
        XCTAssertEqual(last.to.name, "Destination")
        near(last.m, Geo.hav(stops["Y"]!.coord, to) * 1.2, 1)
        near(last.min, Geo.hav(stops["Y"]!.coord, to) * 1.2 / 80, 1e-6)
        near(o.arrive, o.busLegs[0].alightT + last.min * 60, 1e-6, "arrive includes the final walk")
        near(o.total, Self.sumLegs(o), 1e-6)
        near(o.walkMin, Self.walkSum(o), 1e-9)
        XCTAssertGreaterThan(o.walkM, 1400)
        XCTAssertLessThan(o.total, r.walkOnlyMin)
    }

    func testLongEndWalksOnlyWhenNothingWithin800() {
        let r = Planner.plan(from: near_("X"), to: near_("Y"), now: T, data: data(routeStops: ["P": ["X", "Y"]], buses: [Self.bus("P")]))
        XCTAssertTrue(r.options[0].walkLegs.allSatisfy { $0.m <= 800 })
    }

    func testTotalsAndWaitAfterWalk() {
        let from = LatLon(lat: stops["L3"]!.lat + 0.004, lon: stops["L3"]!.lon)
        let to = LatLon(lat: stops["L1"]!.lat - 0.003, lon: stops["L1"]!.lon)
        let o = Planner.plan(from: from, to: to, now: T, data: data()).options[0]
        let b = o.busLegs[0], w0 = o.legs[0].walk!
        near(w0.min, Geo.hav(from, stops["L3"]!.coord) * 1.2 / 80, 1e-6)
        near(b.boardT, T + (w0.min + b.wait) * 60, 1e-6)
        near(o.total, Self.sumLegs(o), 1e-6)
        near(o.arrive, T + o.total * 60, 1e-6)
        XCTAssertEqual(Double(o.walkM), o.walkLegs.reduce(0.0) { $0 + $1.m })
    }

    func testWalkLegsUseWalkEstimateModel() {
        let from = LatLon(lat: stops["L3"]!.lat + 0.004, lon: stops["L3"]!.lon), to = LatLon(lat: stops["L1"]!.lat - 0.003, lon: stops["L1"]!.lon)
        let r = Planner.plan(from: from, to: to, now: T, data: data())
        near(r.walkOnlyMin, WalkResult.estimate(from, to).min, 1e-6)
        for l in r.options[0].walkLegs { near(l.min, WalkResult.estimate(l.from.coord, l.to.coord).min, 1e-6) }
        XCTAssertEqual(Geo.walkDetour, 1.2); XCTAssertEqual(Geo.walkMetersPerMin, 80)
    }

    func testTransferSecondWaitAfterTransferWalk() throws {
        let r = Planner.plan(from: near_("A0"), to: near_("B1", -0.0001), now: T, data: data(trips: xferTrips))
        let o = try XCTUnwrap(r.options.first { $0.key == "A>B" })
        let b1 = o.busLegs[0], b2 = o.busLegs[1], xw = o.legs[2].walk!
        XCTAssertEqual(b1.boardT, T + 60); XCTAssertEqual(b1.alightT, T + 300)
        XCTAssertGreaterThan(b1.alightT + xw.min * 60, T + 320 + Planner.graceS, "tb1 is not catchable")
        XCTAssertEqual(b2.tripId, "tb2"); XCTAssertEqual(b2.boardT, T + 600); XCTAssertEqual(b2.alightT, T + 900)
        near(b2.wait, (600 - 300 - xw.min * 60) / 60, 1e-6)
        near(o.total, Self.sumLegs(o), 1e-6)
        near(o.arrive, T + 900 + o.legs[4].walk!.min * 60, 1e-6)
    }

    func testRealNetworkPlansQuickly() throws {
        let S = TS.real.data
        let rid = try XCTUnwrap(S.routeStopIds.max { (S.routeStops[$0]?.count ?? 0) < (S.routeStops[$1]?.count ?? 0) })
        let list = S.routeStops[rid]!.filter { S.stops[$0] != nil }
        let a = S.stops[list[0]]!, z = S.stops[list[min(6, list.count - 2)]]!
        let d = PlannerData(stops: S.stops, routeStops: S.routeStops, routeOrder: S.routeStopIds, buses: S.routeStopIds.map(Self.bus))
        let t0 = Date()
        let r = Planner.plan(from: LatLon(lat: a.lat + 0.0003, lon: a.lon), to: LatLon(lat: z.lat - 0.0003, lon: z.lon), now: T, data: d)
        let ms = Date().timeIntervalSince(t0) * 1000
        XCTAssertLessThan(ms, 1500, "plan took \(Int(ms)) ms")
        XCTAssertTrue((1...4).contains(r.options.count), "options \(r.options.count)")
        for o in r.options {
            XCTAssertTrue(o.total.isFinite && o.total > 0 && o.arrive > T)
            for l in o.busLegs { XCTAssertTrue(l.boardT >= T && l.alightT > l.boardT && l.path.count == l.stopsPassed + 1) }
        }
    }
}

/// Shared synthetic network helpers (PlannerTests and RefineTests).
protocol PlannerFixture {}
extension PlannerFixture {
    var T: Double { PlannerTests.T }
    var stops: [String: Stop] { PlannerTests.stops }
    var routeStops: [String: [String]] { ["LOOP": ["L0", "L1", "L2", "L3", "L0"], "A": ["A0", "A1", "A2"], "B": ["B0", "B1"]] }
    func near_(_ id: String, _ dLat: Double = 0.0001) -> LatLon { LatLon(lat: stops[id]!.lat + dLat, lon: stops[id]!.lon) }
    func data(stops: [String: Stop]? = nil, routeStops rs: [String: [String]]? = nil, order: [String]? = nil,
              trips: [TripUpdate] = [], buses: [VehiclePosition] = [PlannerTests.bus("LOOP"), PlannerTests.bus("A"), PlannerTests.bus("B")]) -> PlannerData {
        PlannerData(stops: stops ?? self.stops, routeStops: rs ?? routeStops, routeOrder: order ?? (rs == nil ? ["LOOP", "A", "B"] : nil),
                    trips: trips, buses: buses)
    }
    func hav(_ a: String, _ b: String) -> Double { Geo.hav(stops[a]!.coord, stops[b]!.coord) }
    var xferTrips: [TripUpdate] {
        [PlannerTests.trip("ta", "A", [("A0", T + 60), ("A1", T + 180), ("A2", T + 300)]),
         PlannerTests.trip("tb1", "B", [("B0", T + 320), ("B1", T + 620)]),   // leaves before you can walk over
         PlannerTests.trip("tb2", "B", [("B0", T + 600), ("B1", T + 900)])]
    }
}
