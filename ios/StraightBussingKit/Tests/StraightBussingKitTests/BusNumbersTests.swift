import XCTest
@testable import StraightBussingKit

/// Owner 2026-10-30: numbered buses ("Bus 1", "Bus 2") and a selected bus's own times, "Arriving In" on the collapsed
/// sheet during a trip, and walking suggested first when very close.
final class BusNumbersTests: XCTestCase {
    let NOW = TripFix.NOW

    // MARK: numbering

    func testNumbersOnlyWithTwoOrMoreBuses() {
        XCTAssertEqual(BusNumbers.numbers([]), [:])
        XCTAssertEqual(BusNumbers.numbers(["4320"]), [:], "one bus: no number")
        XCTAssertEqual(BusNumbers.numbers(["4320", "4320", nil, ""]), [:], "the same bus twice (and blanks) is still one bus")
        XCTAssertEqual(BusNumbers.numbers(["4325", "4320"]), ["4320": 1, "4325": 2])
    }

    func testNumericOrderWhenBothAreNumbers() {
        // text order would put "12644" first; numbers put it last
        XCTAssertEqual(BusNumbers.numbers(["12644", "4320", "4325"]), ["4320": 1, "4325": 2, "12644": 3])
        XCTAssertEqual(BusNumbers.numbers(["bus-b", "bus-a"]), ["bus-a": 1, "bus-b": 2], "text ids: text order")
        XCTAssertEqual(BusNumbers.numbers(["a7", "10"]), ["10": 1, "a7": 2], "mixed: text order")
        XCTAssertEqual(BusNumbers.name(2), "Bus 2")
        XCTAssertNil(BusNumbers.name(nil))
    }

    func testByRouteNumbersEachRouteOnItsOwn() {
        let b = [TripFix.bus("v102", "102", "R", "t2", "A2", "A3"), TripFix.bus("v101", "101", "R", "t1", "A0", "A1"),
                 TripFix.bus("v301", "301", "G", "t3", "B0", "B1")]
        let n = BusNumbers.byRoute(b)
        XCTAssertEqual(n["R"], ["v101": 1, "v102": 2])
        XCTAssertNil(n["G"], "a route with one bus has no numbers")
    }

    func testRouteBusWordsUseTheNumbers() {
        let b = [TripFix.bus("v102", "102", "R", "t2", "A2", "A3"), TripFix.bus("v101", "101", "R", "t1", "A0", "A1")]
        let spots = RouteText.busPositions(TripFix.S, buses: b, rid: "R", now: NOW, numbers: BusNumbers.byRoute(b)["R"] ?? [:])
        XCTAssertEqual(spots.map(\.label), ["2", "1"])
        XCTAssertEqual(spots.map(\.number), [2, 1])
        XCTAssertEqual(spots.map(\.vehicleId), ["v102", "v101"])
        XCTAssertTrue(spots[0].text.hasPrefix("Bus 2 between 57th & Ellis and Regenstein Library"), spots[0].text)
        // without numbers: the vehicle's own label, as before
        XCTAssertEqual(RouteText.busPositions(TripFix.S, buses: [b[0]], rid: "R", now: NOW).map(\.label), ["102"])
    }

    // MARK: a selected bus's own times

    func testBusTimesAreThatBusOnlyEarliestUpcomingPerStop() {
        let mine = [TripFix.trip("tR1", "R", "v101", "101", [("A3", 60), ("A4", 180)]),
                    TripFix.trip("tR2", "R", "v101", "101", [("A4", 900), ("A5", 1000), ("A0", -120)])]   // its next trip; one past time
        let other = TripFix.trip("tR3", "R", "v102", "102", [("A3", 30), ("A6", 200)])
        let otherRoute = TripFix.trip("tG1", "G", "v101", "101", [("B0", 50)])
        let t = Arrivals.busTimes(trips: mine + [other, otherRoute], vehicleId: "v101", routeId: "R", now: NOW)
        XCTAssertEqual(t, ["A3": NOW + 60, "A4": NOW + 180, "A5": NOW + 1000], "earliest per stop, split trips merged, never another bus or route")
        XCTAssertNil(t["A6"], "a stop this bus has no prediction for shows no time")
        XCTAssertEqual(Arrivals.busTimes(trips: [other], vehicleId: "v101", routeId: "R", now: NOW), [:])
    }

    // MARK: Arriving In

    func follow(_ id: String) -> TripFollow { TripFix.follow(TripFix.scene(id), now: NOW) }

    func testArrivingInBeforeBoardingAndOnBoard() {
        let walking = follow("walk")
        XCTAssertEqual(walking.phase, .walkToStop)
        XCTAssertEqual(TripText.arrivingIn(walking, now: NOW), "Arriving In: 7 min", "walking to the stop: the bus's time at the boarding stop")
        XCTAssertEqual(TripText.arrivingIn(follow("waiting"), now: NOW), "Arriving In: 4 min")
        let riding = follow("onbus")
        XCTAssertEqual(riding.phase, .onBus)
        XCTAssertEqual(TripText.arrivingIn(riding, now: NOW), "Arriving In: 3 min", "on board: the time at the stop you get off at")
    }

    func testArrivingInNowEstimateAndNoPrediction() {
        var p = follow("waiting")
        if case .bus(var b) = p.legs[p.active] { b.boardEta = NOW + 30; p.legs[p.active] = .bus(b) }
        XCTAssertEqual(TripText.arrivingIn(p, now: NOW), "Arriving In: Now")
        if case .bus(var b) = p.legs[p.active] { b.boardEta = nil; p.legs[p.active] = .bus(b) }
        XCTAssertEqual(TripText.arrivingIn(p, now: NOW), "No live bus time yet", "no time: the card's words, never a number")
        XCTAssertEqual(TripText.arrivingIn(follow("schedule"), now: NOW), "Arriving In: ~2 min", "a planned time is marked approximate")
        XCTAssertTrue(TripText.arrivingIn(follow("stale"), now: NOW).hasPrefix("Arriving In: ~"), "delayed live data is marked approximate")
    }

    func testArrivingInGivesTheWalkWhenNoBusIsAhead() {
        let done = follow("arrived")
        XCTAssertEqual(done.phase, .arrived)
        XCTAssertEqual(TripText.arrivingIn(done, now: NOW), "Walk 3 min", "after the bus: the walk to the destination")
        let walkOnly = TripFollow(to: "Cafe", label: "To Cafe", phase: .walkToStop, active: 0, arriveT: nil, arriveLive: false, live: false,
                                  stale: .fresh, legs: [.walk(.init(min: 6.2, minNow: nil, toName: "Cafe", final: true, state: .active))])
        XCTAssertEqual(TripText.arrivingIn(walkOnly, now: NOW), "Walk 6 min", "a trip without a bus: the walking time")
        let liveWalk = TripFollow(to: "Cafe", label: "To Cafe", phase: .walkToStop, active: 0, arriveT: nil, arriveLive: false, live: false,
                                  stale: .fresh, legs: [.walk(.init(min: 6, minNow: 2.4, toName: "Cafe", final: true, state: .active))])
        XCTAssertEqual(TripText.arrivingIn(liveWalk, now: NOW), "Walk 2 min", "the walking time left from your location")
    }

    // MARK: walk first

    func option(arrive: Double) -> TripOption {
        TripOption(key: "o\(Int(arrive))", total: (arrive - NOW) / 60, totalMin: Int((arrive - NOW) / 60), arrive: arrive, t0: NOW,
                   walkMin: 2, walkM: 160, meets: [], legs: [])
    }

    func testWalkFirstWhenVeryCloseOrNoSlowerThanTheBus() {
        let bus = [option(arrive: NOW + 600)]   // the best bus arrives in 10 min
        XCTAssertTrue(Rank.walkFirst(PlanResult(now: NOW, options: bus, walkOnlyM: 700, walkOnlyMin: 8.75)), "8.75 min walk: very close")
        XCTAssertTrue(Rank.walkFirst(PlanResult(now: NOW, options: bus, walkOnlyM: 800, walkOnlyMin: 10)), "10 min or less counts")
        XCTAssertTrue(Rank.walkFirst(PlanResult(now: NOW, options: [option(arrive: NOW + 900)], walkOnlyM: 960, walkOnlyMin: 12)),
                      "12 min walk arrives before the 15 min bus trip")
        XCTAssertFalse(Rank.walkFirst(PlanResult(now: NOW, options: bus, walkOnlyM: 960, walkOnlyMin: 12)), "12 min walk, 10 min bus: buses first")
        XCTAssertFalse(Rank.walkFirst(PlanResult(now: NOW, options: [], walkOnlyM: 300, walkOnlyMin: 4)), "no bus options: the walk card shows anyway")
    }
}
