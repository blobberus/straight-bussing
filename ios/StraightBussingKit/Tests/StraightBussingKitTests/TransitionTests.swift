import XCTest
@testable import StraightBussingKit

/// Port of web/tests/core-transition.js (the trip updates of buses that left the feed while Passio still predicts them
/// are dropped; RouteKnower E29) and the web's own answers on real feed polls (Fixtures/transition_golden.json, the same
/// file the web test reads).
final class TransitionTests: XCTestCase {
    let t0 = 1_791_997_200.0       // Wed 2026-10-14 12:00 Chicago (CDT)

    func veh(_ id: String, _ ts: Double) -> VehiclePosition { VehiclePosition.on("A", id: id, trip: "t-" + id, ts: ts) }
    func tu(_ id: String, _ t: Double) -> TripUpdate {
        TripUpdate(trip: .init(tripId: "t-" + id, routeId: "A"), vehicle: .init(id: id), stopTimeUpdates: [StopTimeUpdate(stopId: "S", arrival: t)])
    }

    /// Poll every `every` s from a to b: (t, gone ids).
    func run(_ a: Double, _ b: Double, every: Double = 10, vehicles: (Double) -> [VehiclePosition], trips: (Double) -> [TripUpdate]) -> [(Double, [String])] {
        var seen: [String: Transition.Seen] = [:], out: [(Double, [String])] = []
        var t = a
        while t <= b {
            let r = Transition.step(seen, vehicles: vehicles(t), trips: trips(t), now: t, feedTs: t)
            seen = r.seen
            out.append((t, r.gone))
            t += every
        }
        return out
    }
    func firstGone(_ rows: [(Double, [String])], _ id: String) -> Double? { rows.first { $0.1.contains(id) }?.0 }

    func testConstantsAreTheMeasuredRule() {
        XCTAssertEqual([Transition.goneS, Transition.freshS, Transition.sparseS, Transition.keepS], [900, 300, 120, 21600])
    }

    func testSilentFifteenMinutesWhilePredictedIsGoneAndBackWhenItReports() {
        let left = t0 + 600
        let rows = run(t0, t0 + 3600, vehicles: { t in [self.veh("y", t)] + (t <= left ? [self.veh("x", t)] : []) },
                       trips: { t in [self.tu("x", t + 300), self.tu("y", t + 120)] })
        XCTAssertEqual(firstGone(rows, "x"), left + Transition.goneS)
        XCTAssertTrue(rows.allSatisfy { !$0.1.contains("y") })
        let back = run(t0, t0 + 3600, vehicles: { t in [self.veh("y", t)] + (t <= left || t >= self.t0 + 2400 ? [self.veh("x", t)] : []) },
                       trips: { t in [self.tu("x", t + 300), self.tu("y", t + 120)] })
        XCTAssertEqual(back.first { $0.0 == t0 + 2400 }?.1, [])
        XCTAssertEqual(back.first { $0.0 == t0 + 2390 }?.1, ["x"])
    }

    func testWholeFeedSilenceDropsNothing() {
        let rows = run(t0, t0 + 3600, vehicles: { t in t <= self.t0 + 600 ? [self.veh("x", t), self.veh("y", t)] : [] },
                       trips: { t in [self.tu("x", t + 300), self.tu("y", t + 300)] })
        XCTAssertTrue(rows.allSatisfy { $0.1.isEmpty })
        let ghosts = run(t0, t0 + 3600, vehicles: { t in [self.veh("x", min(t, self.t0 + 600)), self.veh("y", min(t, self.t0 + 600))] },
                         trips: { t in [self.tu("x", t + 300)] })
        XCTAssertTrue(ghosts.allSatisfy { $0.1.isEmpty }, "only ghosts: the feed is not alive")
    }

    func testSparseReporterIsNeverGone() {
        let every5 = { (t: Double) in self.t0 + (((t - self.t0) / 300).rounded(.down)) * 300 }
        let rows = run(t0, t0 + 3600, vehicles: { t in [self.veh("y", t), self.veh("s", t < self.t0 + 1200 ? every5(t) : self.t0 + 900)] },
                       trips: { t in [self.tu("s", t + 300)] })
        XCTAssertTrue(rows.allSatisfy { !$0.1.contains("s") })
        let fast = run(t0, t0 + 3600, vehicles: { t in [self.veh("y", t), self.veh("s", min(t, self.t0 + 900))] }, trips: { t in [self.tu("s", t + 300)] })
        XCTAssertEqual(firstGone(fast, "s"), t0 + 900 + Transition.goneS)
    }

    func testUnseenPredictionStartsItsClock() {
        let rows = run(t0, t0 + 2400, vehicles: { t in [self.veh("y", t)] }, trips: { t in [self.tu("ghost", t + 300)] })
        XCTAssertEqual(firstGone(rows, "ghost"), t0 + Transition.goneS)
        let r = Transition.step([:], vehicles: [veh("y", t0), veh("old", t0 - 1200)], trips: [tu("old", t0 + 300)], now: t0, feedTs: t0)
        XCTAssertEqual(r.gone, ["old"], "a ghost counts with its own report time")
        let noId = TripUpdate(trip: .init(tripId: "q"), vehicle: .init(), stopTimeUpdates: [])
        XCTAssertEqual(Transition.step([:], vehicles: [veh("y", t0)], trips: [noId], now: t0, feedTs: t0).gone, [])
    }

    func testSeenCarriedAndPruned() {
        let old = t0 - Transition.keepS - 1
        let r = Transition.step(["a": .init(t: old, dt: 10), "b": .init(t: old, dt: 10)], vehicles: [veh("y", t0)], trips: [tu("b", t0 + 60)], now: t0, feedTs: t0)
        XCTAssertNil(r.seen["a"])
        XCTAssertNotNil(r.seen["b"])
        XCTAssertEqual(r.gone, ["b"])
        XCTAssertEqual(Transition.step(["x": .init(t: t0 - 20, dt: 10)], vehicles: [veh("x", t0)], trips: [], now: t0, feedTs: t0).seen["x"], Transition.Seen(t: t0, dt: 20))
        XCTAssertEqual(Transition.step(["x": .init(t: t0 - 999, fromPrediction: true)], vehicles: [veh("x", t0)], trips: [], now: t0, feedTs: t0).seen["x"],
                       Transition.Seen(t: t0, dt: 0))
        XCTAssertEqual(Transition.step([:], vehicles: [], trips: [], now: 0, feedTs: 0).gone, [])
    }

    /// The web's answers on real polls (shift end, break, two layovers, a bus reporting every 5 to 20 min).
    func testGoldenRealPollsMatchTheWeb() throws {
        let root = try XCTUnwrap(try JSONSerialization.jsonObject(with: TS.fixture("transition_golden")) as? [String: Any])
        let cases = try XCTUnwrap(root["cases"] as? [[String: Any]])
        var bad: [String] = [], polls = 0, goneSeen = Set<String>()
        for c in cases {
            let name = try XCTUnwrap(c["name"] as? String)
            let ps = try XCTUnwrap(c["polls"] as? [[String: Any]]), expect = try XCTUnwrap(c["expect"] as? [[String]])
            XCTAssertEqual(ps.count, expect.count)
            var seen: [String: Transition.Seen] = [:]
            for (i, p) in ps.enumerated() {
                let h = try XCTUnwrap(p["h"] as? NSNumber).doubleValue
                let v = try XCTUnwrap(p["v"] as? [[Any]]), pr = try XCTUnwrap(p["p"] as? [String])
                let vehicles = v.map { x in
                    VehiclePosition(vehicle: .init(id: x[0] as? String), latitude: 0, longitude: 0, timestamp: (x[1] as! NSNumber).doubleValue)
                }
                let trips = pr.map { TripUpdate(trip: .init(tripId: "t" + $0), vehicle: .init(id: $0), stopTimeUpdates: []) }
                let r = Transition.step(seen, vehicles: vehicles, trips: trips, now: h, feedTs: h)
                seen = r.seen
                if r.gone != expect[i] { bad.append("\(name) poll \(i): \(r.gone) vs web \(expect[i])") }
                for id in r.gone { goneSeen.insert(name + ":" + id) }
                polls += 1
            }
        }
        XCTAssertGreaterThan(polls, 500)
        XCTAssertEqual(Array(bad.prefix(10)), [], "\(bad.count) polls differ from web/js/core/transition.js")
        XCTAssertTrue(goneSeen.contains("shift_end:4317") && goneSeen.contains("break:12643"))
        XCTAssertFalse(goneSeen.contains { $0.hasPrefix("layover:") || $0 == "long_layover:4314" || $0 == "long_layover:12647" })
    }

    /// HELD (owner 2026-11-11, web tests "transition: HELD keeps a hidden bus's times off ..."): a bus a rule hid keeps its
    /// times off after it stops reporting, until it reports again and no rule hides it.
    func testHeldKeepsAHiddenBusTimesOffUntilItReportsUnhidden() {
        var r = Transition.held([:], operating: [veh("x", t0), veh("y", t0)], hidden: ["x"], trips: [tu("x", t0 + 300)], now: t0, feedTs: t0)
        XCTAssertEqual(r.ids, [], "hidden now: the rule drops it")
        XCTAssertEqual(r.held, ["x": t0], "held from its report time")
        r = Transition.held(r.held, operating: [veh("y", t0 + 400)], hidden: [], trips: [tu("x", t0 + 700)], now: t0 + 400, feedTs: t0 + 400)
        XCTAssertEqual(r.ids, ["x"], "silent 6 min: no longer operating, no rule sees it: its times stay off")
        r = Transition.held(r.held, operating: [veh("y", t0 + 2000)], hidden: [], trips: [tu("x", t0 + 2300)], now: t0 + 2000, feedTs: t0 + 2000)
        XCTAssertEqual(r.ids, ["x"], "past GONE too: still off")
        let again = Transition.held(r.held, operating: [veh("x", t0 + 2010), veh("y", t0 + 2010)], hidden: ["x"], trips: [], now: t0 + 2010, feedTs: t0 + 2010)
        XCTAssertEqual(again.ids, [])
        XCTAssertEqual(Array(again.held.keys), ["x"], "reports again but a rule still hides it: held")
        let free = Transition.held(r.held, operating: [veh("x", t0 + 2010), veh("y", t0 + 2010)], hidden: [], trips: [], now: t0 + 2010, feedTs: t0 + 2010)
        XCTAssertEqual(free.ids, [])
        XCTAssertEqual(free.held, [:], "reports again and no rule hides it: its times are back")
        let old = t0 - Transition.keepS - 1
        r = Transition.held(["old": old, "kept": old], operating: [veh("y", t0)], hidden: [], trips: [tu("kept", t0 + 60)], now: t0, feedTs: t0)
        XCTAssertEqual(r.ids, ["kept"], "forgotten after keepS unless still predicted")
    }

    /// LiveState.applying keeps a bus hidden off its route out of `trips` after it goes silent (web tests "live: a bus
    /// hidden off its route that goes silent keeps its times off (E32 offroute_then_silent)").
    func testLiveStateKeepsAHiddenBusTimesOffAfterItGoesSilent() {
        let quiet = t0 + 60
        let shapes: [String: [[LatLon]]] = ["A": [[LatLon(lat: 41.79, lon: -87.61), LatLon(lat: 41.79, lon: -87.59)]]]
        let stat = StaticData(routes: ["A": Route(id: "A", short: "A")], stops: ["S": Stop(id: "S", name: "S", lat: 41.79, lon: -87.6)],
                              shapes: shapes, routeStops: ["A": ["S"]])
        func poll(_ now: Double) -> FeedPoll {
            var vs = [VehiclePosition.on("A", id: "y", trip: "t-y", ts: now, lat: 41.79, lon: -87.6)]
            if now - quiet <= 400 { vs.append(VehiclePosition.on("A", id: "x", trip: "t-x", ts: min(now, quiet), lat: 41.79, lon: -87.58)) }
            return FeedPoll(vehicles: .success(Feed(timestamp: now, entities: vs)),
                            trips: .success(Feed(timestamp: now, entities: [tu("x", now + 300), tu("y", now + 120)])),
                            alerts: .success(Feed(timestamp: now, entities: [])))
        }
        var s = LiveState()
        for t in [t0, t0 + 10, t0 + 60] { s = s.applying(poll(t), staticData: stat, now: t) }
        XCTAssertEqual(s.trips.compactMap(\.vehicle.id), ["y"], "hidden off its route (FAST): its times are off")
        s = s.applying(poll(quiet + 360), staticData: stat, now: quiet + 360)
        XCTAssertEqual(s.trips.compactMap(\.vehicle.id), ["y"], "silent 6 min: its times stay off (they came back here before)")
        XCTAssertEqual(s.heldIds, ["x"])
    }

    /// LiveState.applying drops a gone bus's trip updates (web tests "live: a gone bus's trip updates leave store.trips").
    func testLiveStateDropsGoneTripUpdates() {
        let left = t0 + 60
        func poll(_ now: Double) -> FeedPoll {
            FeedPoll(vehicles: .success(Feed(timestamp: now, entities: [veh("y", now), veh("x", min(now, left))])),
                     trips: .success(Feed(timestamp: now, entities: [tu("x", now + 300), tu("y", now + 120)])),
                     alerts: .failure(FeedError.skipped))
        }
        var s = LiveState().applying(poll(t0), staticData: nil, now: t0)
        XCTAssertEqual(s.trips.compactMap(\.vehicle.id), ["x", "y"])
        var now = left + Transition.goneS - 10
        s = s.applying(poll(now), staticData: nil, now: now)
        XCTAssertEqual(s.trips.compactMap(\.vehicle.id), ["x", "y"], "silent 14 min 50 s: kept")
        now = left + Transition.goneS
        s = s.applying(poll(now), staticData: nil, now: now)
        XCTAssertEqual(s.trips.compactMap(\.vehicle.id), ["y"], "silent 15 min: its arrival times are gone")
        XCTAssertEqual(s.goneIds, ["x"])
    }
}
