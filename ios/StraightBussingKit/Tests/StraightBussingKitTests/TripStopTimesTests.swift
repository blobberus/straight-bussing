import XCTest
@testable import StraightBussingKit

/// Port of the 2026-10-20 cases in web/tests/core-tripprogress.js (split predictions, stopTimes) and trip-view.js
/// (minutes to every upcoming station, counting up along the stops).
final class TripStopTimesTests: XCTestCase {
    let NOW = TripFix.NOW

    func testSplitPredictionsTheBusesNextTripLendsTheLaterStopsTheirLiveTimes() {
        // Passio: bus v101 has 2 stops left on tR1, the rest of your ride is on its next trip tR1b; another bus v999 on tR1b too
        let s = TripFix.Scene(journey: TripFix.journeyR(), live: TripFix.live([TripFix.bus("v101", "101", "R", "tR1", "A0", "A1", 0.5)], [
            TripFix.trip("tR1", "R", "v101", "101", [("A1", 90), ("A2", 200)]),
            TripFix.trip("tR1b", "R", "v101", "101", [("A3", 300), ("A4", 420), ("A5", 520), ("A6", 600), ("A7", 720)]),
            TripFix.trip("tR1b", "R", "v999", "999", [("A5", 30), ("A6", 60), ("A7", 90)]),
        ]), user: nil)
        let b = TripFix.follow(s).busLegs[0]
        XCTAssertEqual(b.stops.map(\.eta), [NOW + 90, NOW + 200, NOW + 300, NOW + 420, NOW + 520, NOW + 600, NOW + 720], "every stop has its live time")
        XCTAssertTrue(b.boardLive); XCTAssertTrue(b.alightLive); XCTAssertEqual(b.alightEta, NOW + 720, "the alighting time is live, not planned")
    }

    func leg(_ etas: [Double?], _ states: [TripFollow.StopState]? = nil, board: Int, alight: Int, vehicle: TripFollow.Vehicle? = nil,
             boardEta: Double? = nil, rideMin: Double? = nil) -> TripFollow.BusStep {
        var l = TripFollow.BusStep(rid: "R", boardId: "b", boardName: "b", alightId: "e", alightName: "e")
        let ids = ["a", "b", "c", "d", "e"]
        l.stops = etas.enumerated().map { i, e in
            TripFollow.StopRow(id: ids[i], name: ids[i], role: .ride, state: states?[i] ?? .upcoming, eta: e)
        }
        l.boardIdx = board; l.alightIdx = alight; l.vehicle = vehicle; l.boardEta = boardEta; l.boardLive = false; l.rideMin = rideMin
        return l
    }
    func veh(_ idx: Int, frac: Double = 0.5, at: Bool = false) -> TripFollow.Vehicle {
        TripFollow.Vehicle(id: "v", label: "1", tripId: nil, how: .trip, idx: idx, behind: 0, beyond: 0, frac: frac, at: at,
                           pos: Double(idx) - 1 + frac, nextId: "b", nextName: "b", prevName: nil, lat: nil, lon: nil, seen: NOW, stale: false)
    }

    func testStopTimesLiveElseScaledOrAddedScheduleRideNeverBackInTime() {
        let ix = ["a": 0, "b": 1, "c": 2, "d": 3, "e": 4]
        let ride: (String, String) -> Double? = { x, y in Double(ix[y]! - ix[x]!) }   // 1 min a stop
        let out = TripFollow.stopTimes(leg([nil, NOW + 60, nil, NOW + 300, nil], [.passed, .next, .upcoming, .upcoming, .upcoming],
                                           board: 1, alight: 4, vehicle: veh(1), rideMin: 8), now: NOW, ride: ride)
        XCTAssertNil(out[0], "passed")
        XCTAssertEqual(out[1], .init(t: NOW + 60, est: false, src: .live))
        XCTAssertEqual(out[2], .init(t: NOW + 180, est: true, src: .schedule), "between two live times: scaled by the scheduled ride")
        XCTAssertEqual(out[3], .init(t: NOW + 300, est: false, src: .live))
        XCTAssertEqual(out[4], .init(t: NOW + 360, est: true, src: .schedule), "after the last live time: plus the ride from there")
        let back = TripFollow.stopTimes(leg([nil, NOW + 300], board: 0, alight: 1), now: NOW, ride: ride)
        XCTAssertEqual(back[0], .init(t: NOW + 240, est: true, src: .schedule), "before the first live time: counted back from it")
        let pos = TripFollow.stopTimes(leg([nil, nil, nil], board: 1, alight: 2, vehicle: veh(1)), now: NOW, ride: ride)
        XCTAssertEqual(pos.map { $0?.t }, [nil, NOW + 30, NOW + 90], "no live time: from where the bus is (half way to its next stop)")
        let plan = TripFollow.stopTimes(leg([nil, nil, nil], board: 0, alight: 2, boardEta: NOW + 120, rideMin: 6), now: NOW)
        XCTAssertEqual(plan.map { $0?.t }, [NOW + 120, NOW + 300, NOW + 480], "no live bus, no schedule: the plan's boarding time plus its minutes per stop")
        XCTAssertEqual(plan[1]?.src, .plan)
        let unknown = TripFollow.stopTimes(leg([nil, nil, nil], board: 0, alight: 2, boardEta: NOW + 120, rideMin: 6), now: NOW, ride: { _, _ in nil })
        XCTAssertEqual(unknown.map { $0?.t }, [NOW + 120, NOW + 300, NOW + 480], "a route without schedule data (ride nil) falls back to the plan, never 0 min")
        let never = TripFollow.stopTimes(leg([NOW - 100, nil], board: 0, alight: 1), now: NOW, ride: { _, _ in 0 })
        XCTAssertEqual(never.map { $0?.t }, [NOW, NOW], "never earlier than now or the stop before")
        XCTAssertEqual(TripFollow.stopTimes(leg([nil, nil], board: 0, alight: 1), now: NOW).map { $0?.t }, [nil, nil], "nothing to go on: nothing shown")
    }

    /// "N min" / "Now" / "~N min" (web trip-view.js /^(Now|~?\d+ min)$/).
    func minutes(_ s: String) -> Int? {
        if s == "Now" { return 0 }
        guard s.hasSuffix(" min") else { return nil }
        return Int(s.dropLast(4).drop { $0 == "~" })
    }

    func testMinutesToEveryUpcomingStationRightOfItsNameCountingUp() {
        for id in ["walk", "waiting", "onbus", "schedule", "stale"] {
            let p = TripFix.follow(TripFix.scene(id))
            let late = p.stale != .fresh
            for leg in p.busLegs where leg.state != .done {
                let shown = TripText.shownStops(leg).stops, tm = TripText.stopTimes(leg, now: NOW)
                XCTAssertEqual(tm.count, shown.count, id)
                for (k, s) in shown.enumerated() {
                    let e = TripText.stopEta(s, tm[k], now: NOW, late: late)
                    if s.state == .passed { XCTAssertEqual(e.text, "Passed", id) }
                    else { XCTAssertNotNil(minutes(e.text), "\(id): \(s.name) shows minutes (\(e.text))") }
                }
            }
        }
        let walk = TripFix.follow(TripFix.scene("walk")).busLegs[0], wt = TripText.stopTimes(walk, now: NOW)
        XCTAssertTrue(zip(walk.stops, wt).allSatisfy { s, t in s.state == .passed || t?.est == false }, "live times carry no est. tag")
        let sc = TripFix.follow(TripFix.scene("schedule")).busLegs[0], st = TripText.stopTimes(sc, now: NOW)
        let m = zip(sc.stops, st).compactMap { s, t -> Int? in
            s.state == .passed ? nil : minutes(TripText.stopEta(s, t, now: NOW, late: false).text)
        }
        XCTAssertTrue(st.allSatisfy { $0?.est != false }, "plan times are estimates")
        XCTAssertTrue(zip(m, m.dropFirst()).allSatisfy { $0 < $1 }, "minutes count up along the stops: \(m)")
        XCTAssertEqual(TripText.estText(NOW + 10, now: NOW), "~1 min", "an estimate never says Now")
    }
}
