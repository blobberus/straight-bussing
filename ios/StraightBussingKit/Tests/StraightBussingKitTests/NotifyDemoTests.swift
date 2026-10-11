import XCTest
@testable import StraightBussingKit

/// Live Activity content checks shared by every trip (the trip itself: TripFollowTests).
final class LiveTripSnapshotTests: XCTestCase {
    func testShortNamesAndCompactText() {
        XCTAssertEqual(LiveTripSnapshot.shortName("55th Street & University Avenue"), "55th St & University Ave")
        let s = LiveTripSnapshot(routeShort: "LP", routeName: "Loop", routeColor: "#FF0000", routeTextColor: "#FFFFFF", boardName: "A",
                                 alightName: "B", phase: "on-bus", headline: "1 stop to B", stopsAway: nil, stopsLeft: 1, target: 1_000_300,
                                 stopNames: ["A", "B"], busPosition: 0.5, boardIndex: 0, alightIndex: 1, live: true, asOf: 1_000_000)
        XCTAssertEqual(s.compactText(now: 1_000_000), "1 left · 5 min")
        var t = s; t.target += 15
        XCTAssertTrue(s.sameContent(as: t), "a prediction moving 15 s is not worth an update")
        t.target += 30
        XCTAssertFalse(s.sameContent(as: t), "45 s is")
        t = s; t.busPosition = 1
        XCTAssertFalse(s.sameContent(as: t), "the bus moved on the progress bar")
        t = s; t.target = 1_000_319; var u = s; u.target = 1_000_321   // 1_000_320 is a whole minute
        XCTAssertFalse(t.sameContent(as: u), "2 s that change the Lock Screen's clock (6:37 PM -> 6:38 PM) are an update")
    }

    /// The Lock Screen never shows seconds: whole minutes, "Now" under a minute, and a redraw (staleDate) at the
    /// moment the last minute starts, the one redraw the system makes while the app is not running.
    func testWholeMinutesDueAndStaleDate() {
        var s = LiveTripSnapshot(routeShort: "RL", routeName: "Red Line", routeColor: "#FF0000", routeTextColor: "#FFFFFF", boardName: "A",
                                 alightName: "B", phase: "waiting", headline: "Next RL at A in about 4 min", stopsAway: 2, stopsLeft: nil,
                                 target: 1_000_272, stopNames: ["A", "B"], busPosition: nil, boardIndex: 0, alightIndex: 1, live: true,
                                 asOf: 1_000_000, headlineLead: "Next RL at A")
        XCTAssertEqual(s.minutes(now: 1_000_000), 4, "4:32 left reads 4 min, floored like every ETA in the app")
        XCTAssertFalse(s.isDue(now: 1_000_000))
        XCTAssertFalse(s.isDue(now: 1_000_200), "72 s left: 1 min")
        XCTAssertTrue(s.isDue(now: 1_000_212), "60 s left: Now")
        XCTAssertTrue(s.isDue(now: 1_000_300), "past the target: still Now, never a negative count")
        XCTAssertEqual(s.minutes(now: 1_000_300), 0)
        XCTAssertEqual(s.staleDate(), 1_000_120, "4 min away: stale after 120 s like every live time")
        s.target = 1_000_100
        XCTAssertEqual(s.staleDate(), 1_000_040, "1:40 away: redrawn when the last minute starts")
        s.target = 1_000_030
        XCTAssertEqual(s.staleDate(), 1_000_120, "already under a minute: Now from the start, stale after 120 s")
        s.target = .nan
        XCTAssertEqual(s.staleDate(), 1_000_120, "junk target")
        XCTAssertEqual(s.minutes(now: 1_000_000), 0, "junk never traps")
        s.target = 1_000_272
        let asOf = TimeFmt.clock(1_000_000)
        XCTAssertEqual(s.minutesAsOfText, "4 min as of \(asOf)")
        s.target = 1_000_030
        XCTAssertEqual(s.minutesAsOfText, "Now as of \(asOf)")
        XCTAssertEqual(s.clock, TimeFmt.clock(1_000_030))
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

    /// Like the web's `||`: an empty stop name falls back to "your station" / the stop id.
    func testEmptyStopNamesFallBackLikeTheWeb() {
        var st = stops
        for id in ["L1", "L3"] { st[id] = Stop(id: id, name: "", lat: stops[id]!.lat, lon: stops[id]!.lon) }
        let S = StaticData(routes: ["LOOP": Route(id: "LOOP", long: "Loop")], stops: st, routeStops: ["LOOP": routeStops["LOOP"]!])
        var l = LiveState()
        l.buses = [.on("LOOP", id: "b1", trip: "t1", ts: T, stopId: "L1")]
        l.trips = [PlannerTests.trip("t1", "LOOP", [("L1", T + 60), ("L2", T + 200), ("L3", T + 400)])]
        l.lastOk = T; l.feedTs = T
        var prefs = NotifyPrefs(); prefs.stopId = "L3"
        XCTAssertEqual(Notify.dueAlerts(prefs: prefs, staticData: S, live: l, hidden: [], fired: [], now: T).alerts.map(\.body),
                       ["Bus b1 to your station. Next stop: L1. Arrives in about 6 min (est.)."])
    }

    /// Rider safety (web settings-notify.js): out-of-date data never alerts; delayed data says so.
    func testOldDataSilencesAlertsAndLateDataIsLabeled() {
        let S = StaticData(routes: ["LOOP": Route(id: "LOOP", long: "Loop")], stops: stops, routeStops: ["LOOP": routeStops["LOOP"]!])
        var l = LiveState()
        l.buses = [.on("LOOP", id: "b1", trip: "t1", ts: T, stopId: "L2")]
        l.trips = [PlannerTests.trip("t1", "LOOP", [("L2", T + 60), ("L3", T + 200)])]
        l.lastOk = T
        var prefs = NotifyPrefs(); prefs.stopId = "L3"
        l.feedTs = T - 400
        XCTAssertEqual(Notify.dueAlerts(prefs: prefs, staticData: S, live: l, hidden: [], fired: [], now: T).alerts, [])
        l.feedTs = T - 150
        let a = Notify.dueAlerts(prefs: prefs, staticData: S, live: l, hidden: [], fired: [], now: T).alerts
        XCTAssertEqual(a.map(\.title), ["Loop: 1 stop away"])
        XCTAssertEqual(a.map(\.body), ["Bus b1 to L3. Next stop: L2. Arrives in about 3 min (est.). Live data is delayed."])
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
        XCTAssertTrue(la.alerts.isEmpty, "simulated buses never come with a made-up operator alert")
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
        let j = try XCTUnwrap(TripJourney.plan(o, to: "Chipotle"))
        let p = try XCTUnwrap(TripFollow.compute(j, staticData: S, live: live, user: Self.origin, now: now))
        XCTAssertNotNil(p.currentBus?.vehicle, "demo bus followed on the timeline")
        XCTAssertNotNil(p.snapshot(staticData: S, now: now))
    }
}
