import XCTest
@testable import StraightBussingKit

/// TripProgress (Google-Maps-style trip timeline + Live Activity content) on the synthetic loop network:
/// LOOP L0 -> L1 -> L2 -> L3 -> L0. The rider walks to L3 and rides L3 -> L0 -> L1.
final class TripProgressTests: XCTestCase, PlannerFixture {
    var S: StaticData {
        StaticData(routes: ["LOOP": Route(id: "LOOP", short: "LP", long: "Loop", color: "#FF0000", textColor: "#FFFFFF")],
                   stops: stops, routeStops: ["LOOP": routeStops["LOOP"]!])
    }
    func live(_ buses: [VehiclePosition], _ trips: [TripUpdate], at now: Double) -> LiveState {
        var l = LiveState()
        l.buses = buses; l.trips = trips; l.feedTs = now; l.lastOk = now; l.loaded = true
        return l
    }
    func mid(_ a: String, _ b: String) -> (Double, Double) {
        ((stops[a]!.lat + stops[b]!.lat) / 2, (stops[a]!.lon + stops[b]!.lon) / 2)
    }
    /// Bus t1v on trip t1 heading to L2 (one stop before the rider's stop L3).
    var t1: TripUpdate { PlannerTests.trip("t1", "LOOP", [("L2", T + 120), ("L3", T + 300), ("L0", T + 500), ("L1", T + 700)]) }
    var bus1: VehiclePosition {
        let p = mid("L1", "L2")
        return .on("LOOP", id: "t1v", trip: "t1", ts: T - 5, lat: p.0, lon: p.1, stopId: "L2")
    }
    func startedOption() throws -> TripOption {
        let d = data(routeStops: ["LOOP": routeStops["LOOP"]!], trips: [t1], buses: [bus1])
        return try XCTUnwrap(Planner.plan(from: near_("L3"), to: near_("L1"), now: T, data: d).options.first)
    }

    func testBeforeBoardingShowsApproachingBusAndLiveEtas() throws {
        let o = try startedOption()
        XCTAssertEqual(o.busLegs[0].tripId, "t1")
        let p = TripProgress.compute(option: o, staticData: S, live: live([bus1], [t1], at: T), now: T)
        XCTAssertEqual(p.phase, .walkToStop)
        let seg = try XCTUnwrap(p.currentSegment)
        XCTAssertEqual(seg.rows.map(\.stopId), ["L2", "L3", "L0", "L1"], "approach stop, then board ... alight")
        XCTAssertEqual(seg.rows.map(\.role), [.approach, .board, .ride, .alight])
        XCTAssertEqual(seg.stopsAway, 1)
        XCTAssertEqual(seg.busRow, 0)
        XCTAssertEqual(seg.rows.map(\.state), [.next, .upcoming, .upcoming, .upcoming])
        XCTAssertEqual(seg.rows.compactMap(\.eta), [T + 120, T + 300, T + 500, T + 700])
        XCTAssertTrue(seg.rows.allSatisfy(\.etaLive))
        XCTAssertFalse(seg.boarded)
        XCTAssertEqual(p.headline, "Bus t1v is 1 stop from L3")
        XCTAssertTrue(p.detail.contains("Walk to L3"))
        if case .walk(_, _, _, _, let done, let active) = p.steps[0] { XCTAssertFalse(done); XCTAssertTrue(active) } else { XCTFail("walk first") }

        let snap = try XCTUnwrap(p.snapshot(staticData: S))
        XCTAssertEqual(snap.routeShort, "LP")
        XCTAssertEqual(snap.boardName, "L3")
        XCTAssertEqual(snap.alightName, "L1")
        XCTAssertEqual(snap.stopsAway, 1)
        XCTAssertNil(snap.stopsLeft)
        XCTAssertEqual(snap.target, T + 300)
        XCTAssertEqual(snap.stopNames, ["L2", "L3", "L0", "L1"])
        XCTAssertEqual(snap.boardIndex, 1)
        XCTAssertEqual(snap.compactText(now: T), "1 stop · 5 min")
        XCTAssertTrue(snap.live)
    }

    func testOnBoardShowsPassedNextUpcomingAndStopsLeft() throws {
        let o = try startedOption()
        let now = T + 400
        let p0 = mid("L3", "L0")
        let bus = VehiclePosition.on("LOOP", id: "t1v", trip: "t1", ts: now - 5, lat: p0.0, lon: p0.1, stopId: "L0")
        let trip = PlannerTests.trip("t1", "LOOP", [("L0", T + 500), ("L1", T + 700)])
        let p = TripProgress.compute(option: o, staticData: S, live: live([bus], [trip], at: now), now: now)
        XCTAssertEqual(p.phase, .riding)
        let seg = try XCTUnwrap(p.currentSegment)
        XCTAssertEqual(seg.rows.map(\.stopId), ["L3", "L0", "L1"])
        XCTAssertTrue(seg.boarded)
        XCTAssertEqual(seg.stopsLeft, 1)
        XCTAssertEqual(seg.busRow, 1)
        XCTAssertEqual(seg.busFrac, 0.5, accuracy: 0.05, "bus halfway between L3 and L0")
        XCTAssertEqual(seg.rows.map(\.state), [.passed, .next, .upcoming])
        XCTAssertEqual(seg.alightEta, T + 700)
        XCTAssertEqual(p.headline, "1 stop to L1")
        let snap = try XCTUnwrap(p.snapshot(staticData: S))
        XCTAssertEqual(snap.stopsLeft, 1)
        XCTAssertEqual(snap.target, T + 700)
        XCTAssertEqual(snap.busPosition ?? -9, 0.5, accuracy: 0.05)
        XCTAssertEqual(snap.compactText(now: now), "1 left · 5 min")
    }

    func testMissedTripFollowsTheNextBus() throws {
        let o = try startedOption()
        let now = T + 360
        // t1 already left L3 (only L0, L1 ahead) and the rider is not on it; t2 reaches L3 at T + 900.
        let gone = PlannerTests.trip("t1", "LOOP", [("L0", T + 500), ("L1", T + 700)])
        let t2 = PlannerTests.trip("t2", "LOOP", [("L1", T + 500), ("L2", T + 700), ("L3", T + 900), ("L0", T + 1100), ("L1", T + 1300)])
        let p1 = mid("L0", "L1")
        let b2 = VehiclePosition.on("LOOP", id: "t2v", trip: "t2", ts: now - 5, lat: p1.0, lon: p1.1, stopId: "L1")
        let seg = try XCTUnwrap(TripProgress.compute(option: o, staticData: S, live: live([b2], [gone, t2], at: now), now: now).currentSegment)
        XCTAssertEqual(seg.tripId, "t2")
        XCTAssertEqual(seg.vehicleLabel, "t2v")
        XCTAssertEqual(seg.stopsAway, 2)
        XCTAssertEqual(seg.rows.map(\.stopId), ["L1", "L2", "L3", "L0", "L1"])
        XCTAssertEqual(seg.boardEta, T + 900)
    }

    func testFarBusListsOnlyTheLastApproachStops() throws {
        let rs = ["R": ["S0", "S1", "S2", "S3", "S4", "S5", "S6", "S7"]]
        var st: [String: Stop] = [:]
        for (i, id) in rs["R"]!.enumerated() { st[id] = Stop(id: id, name: id, lat: 41.7 + Double(i) * 0.003, lon: -87.6) }
        let data = PlannerData(stops: st, routeStops: rs, trips: [PlannerTests.trip("r1", "R", [("S1", T + 60), ("S6", T + 600), ("S7", T + 700)])],
                               buses: [.on("R", id: "rv", trip: "r1", ts: T, lat: 41.7015, lon: -87.6, stopId: "S1")])
        let o = try XCTUnwrap(Planner.plan(from: LatLon(lat: st["S6"]!.lat, lon: -87.6001), to: LatLon(lat: st["S7"]!.lat, lon: -87.6001),
                                           now: T, data: data).options.first)
        let S2 = StaticData(stops: st, routeStops: rs)
        var l = LiveState(); l.buses = data.buses; l.trips = data.trips; l.lastOk = T; l.feedTs = T
        let seg = try XCTUnwrap(TripProgress.compute(option: o, staticData: S2, live: l, now: T).currentSegment)
        XCTAssertEqual(seg.stopsAway, 5)
        XCTAssertEqual(seg.hiddenBefore, 1)
        XCTAssertEqual(seg.rows.prefix(4).map(\.stopId), ["S2", "S3", "S4", "S5"])
        XCTAssertEqual(seg.busRow, 0)
        XCTAssertEqual(seg.busFrac, 0)
    }

    func testAfterTheRideWalkThenArrived() throws {
        let o = try startedOption()
        let later = o.arrive + 3600
        let p = TripProgress.compute(option: o, staticData: S, live: live([], [], at: later), now: later)
        XCTAssertEqual(p.phase, .arrived)
        XCTAssertTrue(p.segments.allSatisfy(\.pastAlight))
        XCTAssertEqual(p.headline, "You have arrived")
        XCTAssertTrue(p.segments[0].rows.allSatisfy { $0.state == .passed })
    }

    func testNoVehicleUsesPlannedTimes() throws {
        let o = try startedOption()
        let p = TripProgress.compute(option: o, staticData: S, live: live([], [], at: T), now: T)
        let seg = try XCTUnwrap(p.currentSegment)
        XCTAssertNil(seg.busRow)
        XCTAssertFalse(seg.live)
        XCTAssertEqual(seg.rows.count, 3, "no approach rows without a located bus")
        XCTAssertEqual(seg.boardEta, o.busLegs[0].boardT)
        XCTAssertTrue(p.headline.hasPrefix("Next LP at L3"))
    }
}

/// core/notify.js stopsAway / dueAlerts on the same network.
final class NotifyTests: XCTestCase, PlannerFixture {
    func testStopsAwayAndAlerts() {
        let S = StaticData(routes: ["LOOP": Route(id: "LOOP", long: "Loop")], stops: stops, routeStops: ["LOOP": routeStops["LOOP"]!])
        var l = LiveState()
        l.buses = [.on("LOOP", id: "b1", trip: "t1", ts: T, stopId: "L1"), .on("LOOP", id: "b2", trip: "t2", ts: T - 999, stopId: "L3")]
        l.trips = [PlannerTests.trip("t1", "LOOP", [("L1", T + 60), ("L2", T + 200), ("L3", T + 400)])]
        l.lastOk = T; l.feedTs = T
        let away = Notify.stopsAway(staticData: S, live: l, stopId: "L3", now: T)
        XCTAssertEqual(away.map(\.stopsAway), [2], "stale b2 ignored")
        XCTAssertEqual(away[0].etaS, T + 400)
        XCTAssertEqual(away[0].nextStopName, "L1")
        var prefs = NotifyPrefs(); prefs.stopId = "L3"
        let due = Notify.dueAlerts(prefs: prefs, staticData: S, live: l, hidden: [], fired: [], now: T)
        XCTAssertEqual(due.alerts.map(\.kind), [.twoStops])
        XCTAssertEqual(due.alerts[0].title, "Loop: 2 stops away")
        XCTAssertTrue(due.alerts[0].body.contains("about 6 min (est.)"))
        XCTAssertEqual(Notify.dueAlerts(prefs: prefs, staticData: S, live: l, hidden: [], fired: due.fired, now: T).alerts, [], "fired once")
        l.failed = true
        XCTAssertEqual(Notify.dueAlerts(prefs: prefs, staticData: S, live: l, hidden: [], fired: [], now: T).alerts, [], "no alerts on bad data")
    }
}

/// The demo feed behind the simulator screenshots: deterministic, all buses operating, plannable trips.
final class DemoFeedTests: XCTestCase {
    /// Same constants as the app's demo mode (App/Sources/Model/DemoConfig.swift).
    static let origin = LatLon(lat: 41.7905, lon: -87.5990)
    static let destination = LatLon(lat: 41.7997, lon: -87.588)

    func testDeterministicAndOperating() {
        let S = TS.real.data
        let now = 1_791_480_000.0
        let a = DemoFeed.poll(staticData: S, now: now, epoch: now - 30), b = DemoFeed.poll(staticData: S, now: now, epoch: now - 30)
        let la = LiveState().applying(a, staticData: S, now: now), lb = LiveState().applying(b, staticData: S, now: now)
        XCTAssertEqual(la, lb)
        XCTAssertGreaterThan(la.buses.count, 12)
        XCTAssertEqual(la.buses.count, (try? a.vehicles.get().entities.count) ?? -1, "every demo bus counts as operating")
        XCTAssertEqual(la.staleLevel(now: now), .fresh)
        XCTAssertEqual(la.alerts.first?.header, DemoFeed.alertHeader)
        XCTAssertTrue(la.buses.allSatisfy { $0.coord.isValid && S.routes[$0.trip.routeId!] != nil })
    }

    func testDemoTripHasOptionsAndProgress() throws {
        let S = TS.real.data
        let now = 1_791_480_000.0
        let live = LiveState().applying(DemoFeed.poll(staticData: S, now: now, epoch: now), staticData: S, now: now)
        let d = PlannerData(stops: S.stops, routeStops: S.routeStops, routeOrder: S.routeStopIds, trips: live.trips, buses: live.buses)
        let r = Planner.plan(from: Self.origin, to: Self.destination, now: now, data: d,
                             predict: SchedulePredictor(segments: S.segments, routeStops: S.routeStops))
        XCTAssertGreaterThanOrEqual(r.options.count, 2, "options: \(r.options.map(\.key))")
        let o = try XCTUnwrap(r.options.first { !$0.busLegs.isEmpty })
        let p = TripProgress.compute(option: o, staticData: S, live: live, now: now)
        let seg = try XCTUnwrap(p.currentSegment)
        XCTAssertTrue(seg.located, "demo bus located on the timeline")
        XCTAssertNotNil(p.snapshot(staticData: S))
    }
}
