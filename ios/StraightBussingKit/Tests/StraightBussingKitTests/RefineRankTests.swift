import XCTest
@testable import StraightBussingKit

/// Port of the refineWalking part of web/tests/core-planner.js.
final class RefineTests: XCTestCase, PlannerFixture {

    /// Router that walks hav x 1.3 (or a fixed minute count) with a 3-point path.
    func fakeWalk(_ minByLeg: (@Sendable (LatLon, LatLon, Double) -> Double)? = nil) -> WalkRouter {
        { a, b in
            let m = Geo.hav(a, b) * 1.3
            return WalkResult(m: m, min: minByLeg?(a, b, m) ?? m / 80,
                              coords: [a, LatLon(lat: (a.lat + b.lat) / 2, lon: a.lon), b], source: .router)
        }
    }

    func testReplacesWalkLegsAndRecomputesTotals() async throws {
        let from = LatLon(lat: stops["L3"]!.lat + 0.002, lon: stops["L3"]!.lon)
        let to = LatLon(lat: stops["L1"]!.lat - 0.002, lon: stops["L1"]!.lon)
        let d = data()
        let o = Planner.plan(from: from, to: to, now: T, data: d).options[0]
        let r = try XCTUnwrapAsync(await Planner.refineWalking(o, walkRoute: fakeWalk(), now: T, data: d, from: from, to: to))
        let walks = r.walkLegs
        XCTAssertEqual(walks.count, 2)
        XCTAssertTrue(walks.allSatisfy { $0.source == .router && $0.coords?.count == 3 })
        near(walks[0].m, Geo.hav(from, stops["L3"]!.coord) * 1.3, 1)
        let b = r.busLegs[0]
        near(b.boardT, T + walks[0].min * 60 + b.wait * 60, 1, "headway bus re-timed after longer walk")
        near(r.arrive, b.alightT + walks[1].min * 60, 1)
        near(r.total, (r.arrive - T) / 60, 1e-6)
        near(r.total, PlannerTests.sumLegs(r), 1e-6)
        near(r.walkMin, walks[0].min + walks[1].min, 1e-9)
        XCTAssertGreaterThan(r.total, o.total)
        XCTAssertTrue(r.refined)
        XCTAssertEqual(o.walkLegs[0].source, .estimate, "input option not mutated")
    }

    func testMissedLiveBusReplansNextOne() async throws {
        let from = LatLon(lat: stops["L3"]!.lat + 0.0009, lon: stops["L3"]!.lon)   // ~100 m: estimate 1.5 min
        let to = near_("L1", 0)
        let trips = [PlannerTests.trip("t1", "LOOP", [("L3", T + 120), ("L1", T + 520)]),
                     PlannerTests.trip("t2", "LOOP", [("L3", T + 900), ("L1", T + 1300)])]
        let d = data(trips: trips)
        let o = Planner.plan(from: from, to: to, now: T, data: d).options[0]
        XCTAssertEqual(o.busLegs[0].boardT, T + 120, "estimate catches t1")
        let r = try XCTUnwrapAsync(await Planner.refineWalking(o, walkRoute: fakeWalk { _, _, _ in 5 }, now: T, data: d, from: from, to: to))
        let b = r.busLegs[0]
        XCTAssertEqual(b.boardT, T + 900)
        XCTAssertEqual(b.tripId, "t2")
        XCTAssertEqual(r.legs[0].walk?.min, 5)
        XCTAssertEqual(r.legs[0].walk?.source, .router)
        near(b.wait, (900.0 - 300) / 60, 0.01)
        XCTAssertEqual(r.arrive, T + 1300)
        XCTAssertTrue(r.replanned)
    }

    func testMissedBusNothingLaterDrops() async {
        let from = LatLon(lat: stops["L3"]!.lat + 0.0009, lon: stops["L3"]!.lon)
        let to = near_("L1", -0.0001)
        let d = data(trips: [PlannerTests.trip("t1", "LOOP", [("L3", T + 120), ("L1", T + 520)])], buses: [])
        guard let o = Planner.plan(from: from, to: to, now: T, data: d).options.first else { return XCTFail("planned with live trip") }
        let r = await Planner.refineWalking(o, walkRoute: fakeWalk { _, _, _ in 5 }, now: T, data: d, from: from, to: to)
        XCTAssertNil(r)
    }

    func testRouterNeverShorterThanStraightLine() async throws {
        let d = data(), from = near_("L3"), to = LatLon(lat: stops["L1"]!.lat - 0.002, lon: stops["L1"]!.lon)
        let o = Planner.plan(from: from, to: to, now: T, data: d).options[0]
        let zero: WalkRouter = { _, _ in WalkResult(m: 0, min: 0, coords: [], source: .router) }
        let r = try XCTUnwrapAsync(await Planner.refineWalking(o, walkRoute: zero, now: T, data: d, from: from, to: to))
        near(r.legs[0].walk?.min, Geo.hav(from, stops["L3"]!.coord) / 80, 1e-6, "floored at crow-flies")
        XCTAssertGreaterThan(r.total, r.busLegs[0].wait + r.busLegs[0].ride)
    }

    func testLongerTransferWalkMissesSecondBus() async throws {
        let from = near_("A0"), to = near_("B1", -0.0001), d = data(trips: xferTrips)
        let o = try XCTUnwrap(Planner.plan(from: from, to: to, now: T, data: d).options.first { $0.key == "A>B" })
        let a2 = stops["A2"]!.coord
        let walk = fakeWalk { a, _, m in abs(a.lat - a2.lat) < 1e-9 && abs(a.lon - a2.lon) < 1e-9 ? 6 : m / 80 }
        let r = try XCTUnwrapAsync(await Planner.refineWalking(o, walkRoute: walk, now: T, data: d, from: from, to: to))
        XCTAssertTrue(r.replanned)
        XCTAssertEqual(r.legs[2].walk?.min, 6)
        XCTAssertGreaterThanOrEqual(r.busLegs[1].boardT, r.busLegs[0].alightT + 6 * 60 - 1)
        near(r.total, PlannerTests.sumLegs(r), 1e-6)
    }

    func testSurvivesThrowingRouter() async throws {
        struct Boom: Error {}
        let d = data()
        let from = LatLon(lat: stops["L3"]!.lat + 0.002, lon: stops["L3"]!.lon)
        let o = Planner.plan(from: from, to: near_("L1"), now: T, data: d).options[0]
        let r = try XCTUnwrapAsync(await Planner.refineWalking(o, walkRoute: { _, _ in throw Boom() }, now: T, data: d))
        XCTAssertEqual(r.legs[0].walk?.source, .estimate)
        near(r.total, o.total, 0.01)
    }
}

func XCTUnwrapAsync<T>(_ v: T?, file: StaticString = #filePath, line: UInt = #line) throws -> T {
    try XCTUnwrap(v, file: file, line: line)
}

/// Port of web/tests/core-rank.js.
final class RankTests: XCTestCase {
    let T = 1_800_000_000.0
    func walk(_ min: Double) -> Leg {
        .walk(WalkLeg(from: Place(name: "a", lat: 0, lon: 0), to: Place(name: "b", lat: 0, lon: 0), m: JS.round(min * 80), min: min))
    }
    func bus(_ rid: String, _ wait: Double, boardT: Double? = nil) -> Leg {
        .bus(BusLeg(rid: rid, board: Place(id: rid + "b", name: "", lat: 0, lon: 0), alight: Place(id: rid + "a", name: "", lat: 0, lon: 0),
                    stopIds: [], path: [], stopsPassed: 1, wait: wait, waitLive: false, ride: 1, source: .estimate, conf: 0.3,
                    boardT: boardT ?? T + wait * 60, alightT: 0, tripId: nil, p10: nil, p90: nil))
    }
    /// Option with total walking `w` (two legs), arrival `arr` min after T, and waits.
    func opt(_ key: String, _ w: Double, _ arr: Double, _ waits: Double...) -> TripOption {
        let legs = [walk(w / 2)] + waits.enumerated().map { bus(key + String($0.offset), $0.element) } + [walk(w / 2)]
        return TripOption(key: key, total: arr, totalMin: Int(arr), arrive: T + arr * 60, t0: T, walkMin: w, walkM: 0, meets: [], legs: legs)
    }

    func testCriteriaPriority() {
        XCTAssertEqual(Criterion.allCases.map(\.rawValue), ["walk", "arrive", "wait"])
        XCTAssertEqual(Rank.criteriaText([.wait, .walk]), "Least walking, shortest wait")
        XCTAssertEqual(Rank.criteriaText([]), "")
    }

    func testOptionStatsSumsWalksAndWaits() {
        let o = TripOption(key: "o", total: 15, totalMin: 15, arrive: T + 900, t0: T, walkMin: 4, walkM: 320, meets: [],
                           legs: [walk(2), bus("A", 3), walk(1.5), bus("B", 4), walk(0.5)])
        XCTAssertEqual(Rank.optionStats(o), Rank.Stats(walk: 4, arrive: T + 900, wait: 7))
        let wt = Rank.walkTotals(o.legs)
        XCTAssertEqual(wt.walkMin, 4); XCTAssertEqual(wt.walkM, 320)
    }

    func testWalkThenArrivalThenWait() {
        let r = Rank.rankOptions([opt("S", 6, 20, 1), opt("A", 8, 10, 6), opt("W", 1, 30, 9)])
        XCTAssertEqual(r.map(\.key), ["W", "A", "S"])
        XCTAssertEqual(r.map(\.meets), [[.walk], [.arrive], [.wait]])
    }

    func testMoreCriteriaFirstWithinTopCriterion() {
        let r = Rank.rankOptions([opt("W1", 2, 30, 9), opt("A", 9, 12, 5), opt("W2", 2.3, 31, 1)])
        XCTAssertEqual(r.map(\.key), ["W2", "W1", "A"])
        XCTAssertEqual(r[0].meets, [.walk, .wait])
    }

    func testTolerancesAndNoneLast() {
        let r = Rank.rankOptions([opt("c", 9, 25, 8), opt("b", 4.4, 10.8, 2.9), opt("a", 4, 10, 2)])
        XCTAssertEqual(r.map(\.key), ["a", "b", "c"])
        XCTAssertEqual(r[1].meets, [.walk, .arrive, .wait])
        XCTAssertEqual(r[2].meets, [])
        XCTAssertEqual(Rank.rankOptions([]), [])
    }

    func testPickOptions() {
        func leg(_ rid: String, _ boardT: Double) -> Leg { bus(rid, 2, boardT: boardT) }
        func c(_ key: String, _ arrMin: Double, _ legs: [Leg], _ xfer: Bool = false) -> PlanCandidate {
            PlanCandidate(key: key, legs: legs, arr: T + arrMin * 60, xfer: xfer)
        }
        // Board/alight ids are per-route in this fixture ("Ab"/"Aa"), like the web's fixed "s"/"t".
        let out = Rank.pickOptions([
            c("A", 12, [walk(3), leg("A", T + 300), walk(1)]),
            c("A:dup", 12, [walk(3), leg("A", T + 300), walk(1)]),
            c("B", 15, [walk(0.5), leg("B", T + 120), walk(0.2)]),
            c("SLOW", 200, [walk(1), leg("S", T + 60)]),
            c("A>B", 11.5, [walk(1), leg("A", T + 60), walk(1), leg("B", T + 400)], true),
        ], t0: T, walkOnlyMin: 40, max: 4)
        XCTAssertEqual(out.map(\.key), ["B", "A"], "duplicate, slow and weak transfer dropped")
        XCTAssertEqual(out[0].meets, [.walk, .wait])
        XCTAssertEqual(out[1].meets, [.arrive, .wait])
        XCTAssertEqual(Rank.pickOptions([c("A", 12, [leg("A", T)]), c("B", 13, [leg("B", T + 1)]), c("C", 14, [leg("C", T + 2)])],
                                        t0: T, walkOnlyMin: 40, max: 2).count, 2, "cap")
    }

    func testLeastWalkingPairIsItsOwnOption() {
        let stops = ["Q0": Stop(id: "Q0", name: "Q0", lat: 41.7, lon: -87.6), "Q1": Stop(id: "Q1", name: "Q1", lat: 41.7045, lon: -87.56),
                     "Q2": Stop(id: "Q2", name: "Q2", lat: 41.7, lon: -87.5601)]
        let r = Planner.plan(from: LatLon(lat: 41.7001, lon: -87.6), to: LatLon(lat: 41.7, lon: -87.56), now: T,
                             data: PlannerData(stops: stops, routeStops: ["Q": ["Q0", "Q1", "Q2"]], buses: [.on("Q", id: "q")]),
                             predict: PlannerTests.FixedPredict { _, _, b in RideEstimate(min: b == "Q2" ? 25 : 5, source: .schedule, conf: 0.4) })
        XCTAssertEqual(r.options.map { $0.busLegs[0].alight.id }, ["Q2", "Q1"])
        XCTAssertTrue(r.options[0].meets.contains(.walk) && !r.options[0].meets.contains(.arrive))
        XCTAssertTrue(r.options[1].meets.contains(.arrive) && !r.options[1].meets.contains(.walk))
        XCTAssertTrue(r.options[0].walkMin < r.options[1].walkMin && r.options[0].arrive > r.options[1].arrive)
        XCTAssertEqual(Set(r.options.map(\.key)).count, r.options.count, "unique keys")
    }
}
