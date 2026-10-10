import XCTest
@testable import StraightBussingKit

/// Port of web/tests/journey-walk.js + views-render.js catchNote (ui/views/tripinfo.js): walking is always named,
/// totals include it, leave guidance only for a live first bus.
final class TripInfoTests: XCTestCase {
    let NOW = 1_800_000_000.0
    let B = Place(id: "S1", name: "Main & 1st", lat: 41.79, lon: -87.6), A = Place(id: "S3", name: "Hospital", lat: 41.795, lon: -87.595)
    let START = Place(name: "Start", lat: 41.7879, lon: -87.6001), DEST = Place(name: "Destination", lat: 41.7962, lon: -87.5951)
    func wk(_ from: Place, _ to: Place, _ m: Double, _ min: Double) -> Leg { .walk(WalkLeg(from: from, to: to, m: m, min: min)) }
    func bus(waitLive: Bool = true) -> Leg {
        .bus(BusLeg(rid: "R1", board: B, alight: A, stopIds: [], path: [], stopsPassed: 2, wait: 4, waitLive: waitLive, ride: 8, source: .live,
                    conf: 1, boardT: NOW + 600, alightT: NOW + 1080, tripId: nil))
    }
    func option(_ legs: [Leg], _ arrive: Double) -> TripOption {
        let total = (arrive - NOW) / 60
        return TripOption(key: "k", total: total, totalMin: Int(JS.round(total)), arrive: arrive, t0: NOW, walkMin: 0, walkM: 0, meets: [], legs: legs)
    }
    var FULL: TripOption { option([wk(START, B, 240, 3), bus(), wk(A, DEST, 160, 2)], NOW + 1200) }

    func testWalkingTotalLegClocksLeaveGuidance() throws {
        let o = FULL
        XCTAssertEqual(TripInfo.walkTotal(o), 5)
        let t = try XCTUnwrap(TripInfo.legsTimes(o, now: NOW + 999)[1])
        XCTAssertEqual(t.b, NOW + 600); XCTAssertEqual(t.a, NOW + 1080)
        let lv = try XCTUnwrap(TripInfo.leaveInfo(o, now: NOW))
        XCTAssertFalse(lv.now); XCTAssertEqual(lv.by, NOW + 420, "board time minus the walk to the stop")
        XCTAssertTrue(lv.text.hasPrefix("Leave in 7 min (by "), lv.text)
        XCTAssertEqual(TripInfo.leaveInfo(o, now: NOW + 400)?.now, true)
        XCTAssertNil(TripInfo.leaveInfo(option([wk(START, B, 240, 3), bus(waitLive: false), wk(A, DEST, 160, 2)], NOW + 1200), now: NOW), "headway guess: no leave time")
        XCTAssertEqual(TripInfo.walkMins(0.3), "<1"); XCTAssertEqual(TripInfo.walkMins(2.6), "3")
        let l = try XCTUnwrap(TripInfo.optionLines(o, now: NOW))
        XCTAssertEqual(l.first, "Walk 3 min to Main & 1st · bus " + TimeFmt.clock(NOW + 600))
        XCTAssertEqual(l.second, "Leave in 7 min (by \(TimeFmt.clock(NOW + 420))) · includes 5 min walking")
        XCTAssertTrue(TripInfo.optionLabel(o, index: 0, criteria: "", routes: [:], now: NOW).contains("including 5 minutes walking"))
    }

    func testStepsNameBothWalks() {
        let s = TripInfo.steps(FULL, now: NOW, fromLabel: "Home", toLabel: "Hospital entrance")
        XCTAssertEqual(s.count, 4)
        XCTAssertEqual(s[0].plain, "Walk 3 min (240 m) to Main & 1st"); XCTAssertEqual(s[0].tag, "estimate")
        XCTAssertEqual(s[0].sub, "Leave by \(TimeFmt.clock(NOW + 420)) to catch the \(TimeFmt.clock(NOW + 600)) bus")
        XCTAssertEqual(s[1].plain, "Bus arrives at Main & 1st " + TimeFmt.clock(NOW + 600)); XCTAssertEqual(s[1].tag, "live")
        XCTAssertEqual(s[1].sub, "Wait ~4 min · Ride ~8 min to Hospital (\(TimeFmt.clock(NOW + 1080))) · 2 stops · from live bus prediction")
        XCTAssertEqual(s[2].plain, "Walk 2 min (160 m) to Hospital entrance")
        XCTAssertEqual(s[3].plain, "Arrive at Hospital entrance about " + TimeFmt.clock(NOW + 1200))
        XCTAssertEqual(s[3].sub, "About 20 min in total, including 5 min walking"); XCTAssertEqual(s[3].subTag, "est.")
    }

    func testShortWalksStillMentionedNoWalkEndsSaid() throws {
        let short = option([wk(START, B, 30, 0.4), bus(), wk(A, DEST, 26, 0.3)], NOW + 1100)
        let s = TripInfo.steps(short, now: NOW, fromLabel: "Home", toLabel: "Hospital entrance")
        XCTAssertEqual(s[0].plain, "Walk <1 min (30 m) to Main & 1st")
        XCTAssertEqual(s[2].plain, "Walk <1 min (26 m) to Hospital entrance")
        XCTAssertTrue(try XCTUnwrap(TripInfo.optionLines(short, now: NOW)).first.hasPrefix("Walk <1 min to Main & 1st"))
        let busOnly = option([bus(waitLive: false)], NOW + 1080)
        let l = try XCTUnwrap(TripInfo.optionLines(busOnly, now: NOW))
        XCTAssertTrue(l.first.hasPrefix("No walk: board at Main & 1st")); XCTAssertEqual(l.second, "No walking")
        let bs = TripInfo.steps(busOnly, now: NOW, fromLabel: "Main & 1st", toLabel: "Hospital entrance").map(\.plain)
        XCTAssertEqual(bs.first, "No walk: start at Main & 1st")
        XCTAssertTrue(bs.contains("No walk: get off at Hospital, Hospital entrance is right there"))
        XCTAssertFalse(bs.joined().contains("Leave"), "no leave time without a live bus")
    }

    func testCatchNote() {
        XCTAssertEqual(TripInfo.catchNote(NOW + 120, walkMin: 4, now: NOW).kind, .miss)
        XCTAssertEqual(TripInfo.catchNote(NOW + 120, walkMin: 4, now: NOW).text, "Leaves before you can walk there, est.")
        XCTAssertEqual(TripInfo.catchNote(NOW + 150, walkMin: 2, now: NOW).text, "Leave now, est.")
        let c = TripInfo.catchNote(NOW + 600, walkMin: 4, now: NOW)
        XCTAssertEqual(c.kind, .later); XCTAssertEqual(c.text, "Leave in 6 min, est."); XCTAssertTrue(c.aria.contains("estimate"))
        XCTAssertEqual(TripInfo.stopWalkMin(400), 6, accuracy: 1e-9)
        XCTAssertEqual(TripInfo.walkText(400), "6 min walk · 400 m")
    }
}

/// Status pill, live labels, freshness footer, alert windows, station search, route words.
final class LiveTextTests: XCTestCase {
    let NOW = 1_800_000_000.0

    func testStatusPill() {
        func pill(_ l: StaleLevel, lastOk: Double = 1, feedTs: Double = 0, buses: Int = 3, silent: Bool = false) -> LiveText.Pill? {
            LiveText.pill(level: l, polled: true, lastOk: lastOk, feedTs: feedTs, loaded: true, busCount: buses, silent: silent)
        }
        XCTAssertEqual(pill(.err, lastOk: 0)?.text, "Can't reach the shuttle feed. Don't rely on these times; call 773.702.8181.")
        XCTAssertEqual(pill(.err)?.text, "Can't reach the shuttle feed. Retrying. Showing last known data.")
        XCTAssertEqual(pill(.err)?.retry, true)
        XCTAssertEqual(pill(.old, feedTs: NOW)?.text, "Live data is out of date (last update \(TimeFmt.clock(NOW))). Times are approximate.")
        XCTAssertEqual(pill(.late)?.text, "Live data delayed. Times may be off.")
        XCTAssertNil(pill(.fresh))
        XCTAssertEqual(pill(.fresh, buses: 0)?.text, "No shuttles running right now")
        XCTAssertEqual(pill(.fresh, buses: 0, silent: true)?.text, "No shuttles are reporting live locations")
        XCTAssertEqual(pill(.fresh, buses: 0, silent: true)?.kind, .warn)
        XCTAssertNil(LiveText.pill(level: .err, polled: false, lastOk: 0, feedTs: 0, loaded: false, busCount: 0, silent: false), "first poll pending")
    }

    func testLiveLabelAndUpdated() {
        XCTAssertEqual(LiveText.liveLabel(.fresh).text, "Live")
        XCTAssertEqual(LiveText.liveLabel(.late).text, "Live, delayed")
        XCTAssertEqual(LiveText.liveLabel(.err).text, "Last known")
        XCTAssertEqual(LiveText.updatedText(lastOk: 0, failed: true, level: .err, now: NOW), "Can't reach the shuttle feed. Retrying.")
        XCTAssertEqual(LiveText.updatedText(lastOk: 0, failed: false, level: .err, now: NOW), "Waiting for live data")
        XCTAssertEqual(LiveText.updatedText(lastOk: NOW - 100, failed: true, level: .err, now: NOW), "Last live update \(TimeFmt.clock(NOW - 100)). Retrying.")
        XCTAssertEqual(LiveText.updatedText(lastOk: NOW - 8, failed: false, level: .fresh, now: NOW), "Updated 8s ago")
    }

    func testAlertWindowAndBanner() {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "America/Chicago")!
        let a = ServiceAlert(id: "a", header: "Detour on 55th", activePeriods: [.init(start: NOW - 600, end: NOW + 1800)])
        XCTAssertEqual(LiveText.alertWindow(a, now: NOW, calendar: cal), "Until " + TimeFmt.clock(NOW + 1800, timeZone: cal.timeZone))
        XCTAssertTrue(LiveText.isSevere(a))
        XCTAssertEqual(LiveText.alertWindow(ServiceAlert(id: "b", header: "x"), now: NOW, calendar: cal), "")
        XCTAssertEqual(LiveText.alertBanner([a])?.head, "Service alert")
        let b = LiveText.alertBanner([a, ServiceAlert(id: "c", header: ""), ServiceAlert(id: "d", header: "Y")])
        XCTAssertEqual(b?.head, "3 service alerts"); XCTAssertEqual(b?.line, "Detour on 55th and 2 more")
        XCTAssertEqual(LiveText.alertBanner([ServiceAlert(id: "c", header: "")])?.line, "Service change")
        XCTAssertNil(LiveText.alertBanner([]))
    }

    func testStationSearch() {
        let stops = ["1": Stop(id: "1", name: "57th St. & Metra (NB)", lat: 41.79, lon: -87.59), "2": Stop(id: "2", name: "Regenstein Library (N)", lat: 41.79, lon: -87.6),
                     "3": Stop(id: "3", name: "Garage (no routes)", lat: 41.79, lon: -87.6), "4": Stop(id: "4", name: "Ellis & 57th", lat: 41.79, lon: -87.6)]
        let sr = ["1": ["R"], "2": ["R"], "4": ["R"]]
        XCTAssertEqual(StationSearch.match(stops, stopRoutes: sr, "57th metra").map(\.id), ["1"], "every typed word starts a word")
        XCTAssertEqual(StationSearch.match(stops, stopRoutes: sr, "57th").map(\.id), ["1", "4"], "name starts with it first")
        XCTAssertEqual(StationSearch.match(stops, stopRoutes: sr, "").count, 3, "served stations only")
        XCTAssertEqual(StationSearch.settings(stops, stopRoutes: sr, "lib").map(\.name), ["Regenstein Library (N)"])
        XCTAssertEqual(StationSearch.settings(stops, stopRoutes: sr, ""), [])
    }

    func testRouteWordsAndDefaultName() {
        let S = TripFix.S
        let b = TripFix.bus("v101", "101", "R", "tR1", "A1", "A2", 0.6, ts: TripFix.NOW - 130)
        let spots = RouteText.busPositions(S, buses: [b], rid: "R", now: TripFix.NOW)
        XCTAssertEqual(spots.count, 1)
        XCTAssertEqual(spots[0].next, 2); XCTAssertEqual(spots[0].prev, 1); XCTAssertEqual(spots[0].frac, 0.6, accuracy: 0.02)
        XCTAssertEqual(spots[0].text, "Bus 101 between 56th & Ellis and 57th & Ellis, heading to 57th & Ellis, location from 2 min ago")
        XCTAssertEqual(RouteText.stopOrder(["a", "b", "c", "a"]), ["a", "b", "c"])
        var s = RouteState(routeIds: ["R"])
        XCTAssertEqual(Custom.defaultName(s), "My route 1")
        s.customRoutes = [CustomRoute(id: "x", name: "My route 2", rids: ["R"])]
        XCTAssertEqual(Custom.defaultName(s), "My route 3", "never suggest a name already taken")
        XCTAssertEqual(RouteText.exceptionNote(Schedule.Hours(first: "07:00", last: "09:00", label: "", exception: "removed")), " (reduced schedule)")
    }
}

/// QA 2026-10-09 (web b924f89): Passio reuses one trip id for several buses; trip AND vehicle must match.
final class SharedTripIdTests: XCTestCase {
    let T = 1_800_000_000.0

    func testTwoBusesOnTheSameTripIdEachGetTheirOwnEtaAndAlert() {
        let rs = ["R1": ["S1", "S2", "S3", "S4"]]
        var st: [String: Stop] = [:]
        for (i, id) in rs["R1"]!.enumerated() { st[id] = Stop(id: id, name: id, lat: 41.79 + Double(i) * 0.003, lon: -87.6) }
        let S = StaticData(routes: ["R1": Route(id: "R1", long: "Route One")], stops: st, routeStops: rs)
        var l = LiveState()
        l.buses = [.on("R1", id: "v1", trip: "t1", ts: T, stopId: "S1"), .on("R1", id: "v9", trip: "t1", ts: T, stopId: "S2")]
        l.buses[0].vehicle.label = "101"; l.buses[1].vehicle.label = "109"
        l.trips = [TripUpdate(trip: .init(tripId: "t1", routeId: "R1"), vehicle: .init(id: "v1", label: "101"), stopTimeUpdates: [.init(stopId: "S3", arrival: T + 600)]),
                   TripUpdate(trip: .init(tripId: "t1", routeId: "R1"), vehicle: .init(id: "v9", label: "109"), stopTimeUpdates: [.init(stopId: "S3", arrival: T + 150)])]
        l.lastOk = T; l.feedTs = T; l.loaded = true
        let away = Notify.stopsAway(staticData: S, live: l, stopId: "S3", rids: ["R1"], now: T)
        XCTAssertEqual(away.map(\.label), ["109", "101"])
        XCTAssertEqual(away.map(\.stopsAway), [1, 2])
        XCTAssertEqual(away.map { ($0.etaS ?? 0) - T }, [150, 600])
        var prefs = NotifyPrefs(); prefs.stopId = "S3"; prefs.rids = ["R1"]
        let due = Notify.dueAlerts(prefs: prefs, staticData: S, live: l, hidden: [], fired: [], now: T)
        XCTAssertEqual(due.alerts.map(\.kind.rawValue).sorted(), ["oneStop", "twoStops"], "both buses alert")
    }

    func testOperatingIgnoresAnotherBussPrediction() {
        let svc = ServiceData(routes: ["DAY": RouteService(days: Dictionary(uniqueKeysWithValues: Schedule.dayKeys.map { ($0, ServiceDay(first: "07:00", last: "08:00")) }))])
        // Thu 2026-10-08 00:20 Chicago: DAY is not scheduled
        let now = 1791427200.0 + 2 * 3600 + 40 * 60
        let ctx = { (trips: [TripUpdate]) in Operating.Context(routes: ["DAY": Route(id: "DAY")], service: svc, trips: trips, feedTs: now, now: now, staticLoaded: true) }
        let bus = VehiclePosition.on("DAY", id: "d", trip: "late", ts: now)
        let other = TripUpdate(trip: .init(tripId: "late", routeId: "DAY"), vehicle: .init(id: "other"), stopTimeUpdates: [.init(stopId: "S", arrival: now + 240)])
        XCTAssertFalse(Operating.isOperating(bus, ctx([other])), "shared trip id, other bus's prediction")
        var mine = other; mine.vehicle = .init(id: "d")
        XCTAssertTrue(Operating.isOperating(bus, ctx([mine])), "its own prediction: finishing a late last trip")
    }

    func testArrivalsCarryVehicleId() {
        let tu = TripUpdate(trip: .init(tripId: "t2", routeId: "R2"), vehicle: .init(id: "v2", label: "202"), stopTimeUpdates: [.init(stopId: "S", arrival: T + 120)])
        XCTAssertEqual(Arrivals.arrivalsFor(trips: [tu], stopId: "S", now: T), [Arrival(rid: "R2", t: T + 120, bus: "202", tripId: "t2", vehicleId: "v2")])
    }
}
