import XCTest
@testable import StraightBussingKit

/// The long way around (owner 2026-11-06: "Fix the route recommendation to approve of taking the long way around routes to
/// reach a location given that it is the least amount of walking and long wait is ok. For instance, ... taking 53rd from
/// regenstein to vue53"). Ports of web/tests/core-rank.js "long way: ..." and web/tests/core-planner.js "long way: ...".
final class LongWayTests: XCTestCase {
    let T = 1_800_000_000.0

    // MARK: rank (web core-rank.js)

    func walk(_ min: Double) -> Leg {
        .walk(WalkLeg(from: Place(name: "a", lat: 0, lon: 0), to: Place(name: "b", lat: 0, lon: 0), m: JS.round(min * 80), min: min))
    }
    func busLeg(_ rid: String, _ wait: Double, boardT: Double) -> Leg {
        .bus(BusLeg(rid: rid, board: Place(id: rid + "b", name: "", lat: 0, lon: 0), alight: Place(id: rid + "a", name: "", lat: 0, lon: 0),
                    stopIds: [], path: [], stopsPassed: 1, wait: wait, waitLive: false, ride: 1, source: .estimate, conf: 0.3,
                    boardT: boardT, alightT: 0, tripId: nil, p10: nil, p90: nil))
    }
    /// Candidate walking `w` (two legs), arriving `arrMin` after T, one bus waiting 9 min.
    func cand(_ key: String, _ arrMin: Double, _ w: Double, xfer: Bool = false) -> PlanCandidate {
        PlanCandidate(key: key, legs: [walk(w / 2), busLeg(key, 9, boardT: T + arrMin), walk(w / 2)], arr: T + arrMin * 60, xfer: xfer)
    }
    /// Ranked-looking option walking `w`, arriving `arriveMin` after T, waiting `wait`.
    func option(_ key: String, _ arriveMin: Double, _ w: Double, wait: Double = 9) -> TripOption {
        TripOption(key: key, total: arriveMin, totalMin: Int(arriveMin), arrive: T + arriveMin * 60, t0: T, walkMin: w, walkM: Int(w * 80),
                   meets: [], legs: [walk(w), busLeg("R", wait, boardT: T + wait * 60)])
    }

    func testSavesWalkingIsFiveMinutesAndHalf() {
        XCTAssertEqual([Rank.longWaySaveMin, Rank.longWaySaveFrac, Rank.longWayMaxMin], [5, 0.5, 60])
        XCTAssertTrue(Rank.savesWalking(3.6, 15), "Regenstein to Vue53: 3.6 of 15 min")
        XCTAssertTrue(Rank.savesWalking(5, 10), "exactly 5 min and exactly half")
        XCTAssertFalse(Rank.savesWalking(10, 15), "5 min less but two thirds of the walk")
        XCTAssertFalse(Rank.savesWalking(2, 6.5), "half, but only 4.5 min less")
        XCTAssertFalse(Rank.savesWalking(0, 0) || Rank.savesWalking(.nan, 15) || Rank.savesWalking(3, .infinity), "bad input: no")
    }

    func testPickOptionsKeepsTheLeastWalkingLongWayUpToAnHour() {
        let out = Rank.pickOptions([cand("53RD", 32, 3.6), cand("FCM", 25, 13.6), cand("53RD:b", 35, 6), cand("SLOW", 61, 0.5)],
                                   t0: T, walkOnlyMin: 15)
        XCTAssertEqual(out.map(\.key), ["53RD", "FCM"], "the long way around first (least walking), the usual option after it")
        XCTAssertTrue(out[0].meets.contains(.walk) && !out[0].meets.contains(.arrive))
        XCTAssertGreaterThan(out[0].total, max(2 * 15, 15 + 15), "slower than the old limit (it was dropped before 2026-11-06)")
        XCTAssertEqual(Rank.pickOptions([cand("53RD", 58.6, 3.6)], t0: T, walkOnlyMin: 15).map(\.key), ["53RD"], "a long wait: kept")
        XCTAssertEqual(Rank.pickOptions([cand("53RD", 60.5, 3.6)], t0: T, walkOnlyMin: 15).map(\.key), [], "over an hour: too long")
        XCTAssertEqual(Rank.pickOptions([cand("DCC", 47, 0.7), cand("53RD", 25, 4.7)], t0: T, walkOnlyMin: 22).map(\.key), ["53RD"],
                       "saves under 5 min over the usual options: dropped")
        XCTAssertEqual(Rank.pickOptions([cand("X", 31, 11)], t0: T, walkOnlyMin: 15).map(\.key), [], "walks 11 of 15 min: no long way")
        let x = PlanCandidate(key: "A>B", legs: [walk(0.3), busLeg("A", 1, boardT: T + 60), walk(0.1), busLeg("B", 9, boardT: T + 600), walk(0.2)],
                              arr: T + 40 * 60, xfer: true)
        XCTAssertEqual(Rank.pickOptions([cand("53RD", 32, 3.6), cand("FCM", 25, 13.6), x], t0: T, walkOnlyMin: 15).map(\.key), ["53RD", "FCM"],
                       "the dropped transfer walks less, the 53rd is still kept")
    }

    func testWalkPlaceSecondUnderASavingBusFirstWhenShort() {
        let long = option("53RD", 32, 3.6), usual = option("FCM", 25, 13.6)
        func place(_ opts: [TripOption], _ w: Double) -> Rank.WalkPlace? {
            Rank.walkPlace(PlanResult(now: T, options: opts, walkOnlyM: Int(w * 80), walkOnlyMin: w))
        }
        XCTAssertEqual(place([long, usual], 15), Rank.WalkPlace(at: 1, why: .faster), "15 min walk, the 53rd walks 3.6: bus first, walking second")
        XCTAssertEqual(place([long], 8), Rank.WalkPlace(at: 0, why: .close), "8 min walk: walking first however much the bus saves")
        XCTAssertNil(place([option("53RD", 15.5, 3.6)], 15), "the bus is about as fast and walks much less: no walk card")
        XCTAssertEqual(place([usual], 15), Rank.WalkPlace(at: 0, why: .faster), "no bus saves walking: walking first")
        XCTAssertNil(place([option("A", 14, 3)], 15), "a bus arrives first: no walk card")
        XCTAssertNil(place([], 15))
        XCTAssertEqual(Rank.WalkPlace(at: 1, why: .faster).caption, "Faster to walk")
        XCTAssertEqual(Rank.WalkPlace(at: 0, why: .close).caption, "Close enough to walk")
        XCTAssertFalse(Rank.walkFirst(PlanResult(now: T, options: [long, usual], walkOnlyM: 1197, walkOnlyMin: 15)), "second is not first")
    }

    func testListedOptionsClaimOnlyWhatTheyBeatBesideTheWalk() {
        let ranked = Rank.rankOptions([option("53RD", 32, 3.6), option("FCM", 25, 13.6, wait: 0.5)])
        let listed = Rank.listedOptions(PlanResult(now: T, options: ranked, walkOnlyM: 1197, walkOnlyMin: 15))
        XCTAssertEqual(listed.map(\.key), ["53RD", "FCM"])
        XCTAssertEqual(listed[0].meets, [.walk], "least walking; not the earliest arrival (walking is) nor the shortest wait")
        XCTAssertEqual(listed[1].meets, [.wait], "the half-minute wait still counts as no wait next to the walk")
    }

    func testCriteriaLineStatesTheTradeOff() {
        let walkArrive = T + 15 * 60
        func o(_ meets: [Criterion], _ arriveMin: Double) -> TripOption { var x = option("x", arriveMin, 3.6); x.meets = meets; return x }
        XCTAssertEqual(Rank.slowerNote, "walking is faster")
        XCTAssertEqual(Rank.criteriaLine(o([.walk], 32), walkArrive: walkArrive), "Least walking \u{00B7} walking is faster")
        XCTAssertEqual(Rank.criteriaLine(o([.walk, .wait], 32), walkArrive: walkArrive), "Least walking, shortest wait \u{00B7} walking is faster")
        XCTAssertEqual(Rank.criteriaLine(o([.walk], 15.9), walkArrive: walkArrive), "Least walking", "within the 1 min arrival tolerance")
        XCTAssertEqual(Rank.criteriaLine(o([.wait], 32), walkArrive: walkArrive), "Shortest wait", "only next to a least-walking claim")
        XCTAssertEqual(Rank.criteriaLine(o([.walk], 32), walkArrive: nil), "Least walking", "no walk to compare with")
        XCTAssertEqual(Rank.criteriaLine(o([], 32), walkArrive: walkArrive), "")
    }

    // MARK: planner (web core-planner.js): the 53rd Street Express loop as in web/data (2026-11-06)

    static let s53: [(String, String, Double, Double)] = [
        ("8596", "Harper Court (NE Corner)", 41.79965, -87.588), ("8811", "53rd St & Kenwood", 41.79955, -87.59251),
        ("8628", "Kimbark Plaza (NE Corner)", 41.79953, -87.5965), ("8595", "Ellis & 53rd St.", 41.79912, -87.60138),
        ("8629", "Ellis Garage & Ratner Athletic (West)", 41.79463, -87.60148), ("138837", "Ellis Ave & 57th St", 41.79145, -87.60134),
        ("8630", "Levi Hall (W)", 41.78966, -87.6013), ("8612", "Goldblatt Pavilion", 41.78774, -87.60361),
        ("8589", "Logan Center", 41.78585, -87.60376), ("8631", "60th St. & Ellis (SE Corner)", 41.78583, -87.60109),
        ("8632", "60th St. & Woodlawn Ave (SE Corner)", 41.78594, -87.59653), ("161844", "Keller Center EB", 41.78598, -87.59403),
        ("8594", "Press Building", 41.78604, -87.59018), ("8624", "Stony Island Parking Lot", 41.78633, -87.58739),
        ("8599", "57th St. & Metra (NB)", 41.79139, -87.58659), ("8626", "Lake Park & 55th St. (SE Corner)", 41.79506, -87.58745),
    ]
    static let stops53 = Dictionary(uniqueKeysWithValues: s53.map { ($0.0, Stop(id: $0.0, name: $0.1, lat: $0.2, lon: $0.3)) })
    static let rs53 = ["4346": s53.map(\.0) + ["8596"]]
    static let predict53 = SchedulePredictor(segments: SegmentsData(routes: ["4346": .init(
        seg: [60, 60, 120, 120, 60, 60, 120, 120, 60, 60, 60, 60, 60, 120, 120, 240], dwell: 0)]), routeStops: rs53)
    let reg = LatLon(lat: 41.79216, lon: -87.59994), vue53 = LatLon(lat: 41.79981, lon: -87.59366)   // places.json
    func data53(trips: [TripUpdate] = []) -> PlannerData {
        PlannerData(stops: Self.stops53, routeStops: Self.rs53, trips: trips, buses: [.on("4346", id: "4346v")])
    }

    func testRegensteinToVue53OffersThe53rdAroundTheLoopFirst() throws {
        let r = Planner.plan(from: reg, to: vue53, now: T, data: data53(), predict: Self.predict53)
        let w = r.walkOnlyMin
        XCTAssertTrue(w > 14 && w < 16, "walking the whole way about 15 min: \(w)")
        XCTAssertEqual(r.options.map(\.key), ["4346"])
        let o = try XCTUnwrap(r.options.first), b = o.busLegs[0]
        XCTAssertEqual([b.board.id, b.alight.id], ["138837", "8811"], "board at Ellis Ave & 57th St, get off at 53rd St & Kenwood")
        XCTAssertEqual(b.stopsPassed, 12, "12 stops the long way around")
        XCTAssertEqual(Array(b.stopIds.suffix(3)), ["8626", "8596", "8811"], "wraps around the loop's end")
        near(b.ride, 19, 0.01, "the timetable's 19 min")
        XCTAssertEqual(b.source, .schedule)
        XCTAssertFalse(b.waitLive)
        XCTAssertLessThan(o.walkMin, 4)
        XCTAssertGreaterThan(o.total, max(2 * w, w + 15), "slower than the old limit, so it used to be dropped")
        XCTAssertLessThanOrEqual(o.total, 60)
        XCTAssertEqual(o.meets, [.walk, .arrive, .wait], "the only bus option (the Kit plan has no walk option)")
        XCTAssertEqual(Rank.walkPlace(r), Rank.WalkPlace(at: 1, why: .faster), "walking second: Faster to walk")
        let listed = Rank.listedOptions(r)
        XCTAssertEqual(listed[0].meets, [.walk], "beside the walk card: Least walking (walking is the earliest arrival)")
        XCTAssertEqual(Rank.criteriaLine(listed[0], walkArrive: listed[0].t0 + w * 60), "Least walking \u{00B7} walking is faster")
    }

    func testLiveBusHeadingAwayLongWaitNeverAFullLoopNotOverAnHour() throws {
        let tu = TripUpdate.make("680994", "4346", [("138837", T + 1200), ("8630", T + 1250), ("8612", T + 1290)])
        let r = Planner.plan(from: reg, to: vue53, now: T, data: data53(trips: [tu]), predict: Self.predict53)
        let o = try XCTUnwrap(r.options.first), b = o.busLegs[0]
        XCTAssertTrue(o.key.hasPrefix("4346"), o.key)
        XCTAssertEqual(b.board.id, "138837"); XCTAssertTrue(b.waitLive); XCTAssertEqual(b.boardT, T + 1200); XCTAssertEqual(b.tripId, "680994")
        XCTAssertEqual(b.source, .schedule, "its trip update does not reach 53rd & Kenwood: the timetable ride")
        XCTAssertTrue(o.total > 40 && o.total < 45, "a long wait included: \(o.total)")
        let loop = Planner.plan(from: LatLon(lat: 41.7916, lon: -87.6012), to: LatLon(lat: 41.7948, lon: -87.6016), now: T, data: data53(),
                                predict: PlannerTests.FixedPredict { _, _, _ in RideEstimate(min: nil, source: .schedule, conf: 0) })
        for x in loop.options {
            for l in x.busLegs {
                XCTAssertLessThan(l.stopsPassed, Self.s53.count, "less than one loop")
                XCTAssertEqual(Set(l.stopIds).count, l.stopIds.count, "no stop twice")
            }
        }
        let slow = Planner.plan(from: reg, to: vue53, now: T, data: data53(),
                                predict: PlannerTests.FixedPredict { _, _, _ in RideEstimate(min: 50, source: .schedule, conf: 0.4) })
        XCTAssertEqual(slow.options.count, 0, "over an hour: no bus option")
    }

    func testShortTripGetsNoLongWay() {
        let r = Planner.plan(from: reg, to: LatLon(lat: 41.79463, lon: -87.6012), now: T, data: data53(), predict: Self.predict53)
        XCTAssertLessThan(r.walkOnlyMin, 5)
        XCTAssertEqual(r.options.count, 0, "no bus option: the no-route screen with the walk (unchanged)")
    }
}
