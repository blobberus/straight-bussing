import XCTest
@testable import StraightBussingKit

/// Port of web/tests/core-idle.js (idle buses that are not in service are hidden; RouteKnower E28) and the web's own
/// answers on real bus reports (Fixtures/idle_golden.json, the same file the web test reads).
final class IdleTests: XCTestCase {
    let noon = 1_791_997_200.0       // Wed 2026-10-14 12:00 Chicago (CDT)
    func at(_ h: Double, _ m: Double = 0) -> Double { noon + (h - 12) * 3600 + m * 60 }
    // A: 07:00 to 21:00 every day; N: the night route 16:00 to 04:29
    var service: ServiceData {
        func week(_ d: ServiceDay) -> [String: ServiceDay] {
            Dictionary(uniqueKeysWithValues: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map { ($0, d) })
        }
        return ServiceData(routes: ["A": RouteService(days: week(ServiceDay(first: "07:00", last: "21:00", trips: 10))),
                                    "N": RouteService(days: week(ServiceDay(first: "16:00", last: "28:29", trips: 10)))])
    }
    let spot = LatLon(lat: 41.79112, lon: -87.59809)   // Reynolds Club, the 57th Street stop beside Regenstein Library
    let off = LatLon(lat: 41.7860, lon: -87.6012)      // a stop on A, 600 m from the spot
    var idle: IdleData {
        IdleData(linger: [.init(route: "N", spot: "Reynolds Club", lat: spot.lat, lon: spot.lon, r: 120, after: "23:33", days: "weekday",
                                hours: ["16:00-28:29"], seen: 14)], validUntil: "2026-12-20", from: "2026-10-10", to: "2026-11-05")
    }

    func bus(_ id: String, _ rid: String, _ p: LatLon, _ ts: Double) -> VehiclePosition {
        VehiclePosition(vehicle: .init(id: id), latitude: p.lat, longitude: p.lon, trip: .init(tripId: "t-" + id, routeId: rid), timestamp: ts)
    }
    func tu(_ id: String, _ times: [Double]) -> TripUpdate {
        TripUpdate(trip: .init(tripId: "t-" + id), vehicle: .init(id: id), stopTimeUpdates: times.map { StopTimeUpdate(stopId: "S", arrival: $0) })
    }
    func step(_ tr: [String: Idle.Track], _ buses: [VehiclePosition], _ t: Double, trips: [TripUpdate] = [], nowS: Double? = nil,
              service s: ServiceData? = nil, idle i: IdleData?? = nil) -> (tracks: [String: Idle.Track], hidden: [String], why: [String: Idle.Reason]) {
        Idle.step(tr, buses: buses, trips: trips, service: s ?? service, idle: i ?? idle, now: nowS ?? t, feedTs: t)
    }

    /// First poll time at which the bus is hidden (nil: never) and why, feeding it every `every` s from t0 to t1.
    func firstHidden(_ rid: String, _ pos: LatLon, _ t0: Double, _ t1: Double, every: Double = 30,
                     trips: (Double) -> [TripUpdate] = { _ in [] }, service s: ServiceData? = nil, idle i: IdleData?? = nil) -> (Double?, Idle.Reason?) {
        var tr: [String: Idle.Track] = [:]
        var t = t0
        while t <= t1 {
            let r = step(tr, [bus("x", rid, pos, t)], t, trips: trips(t), service: s, idle: i)
            tr = r.tracks
            if r.hidden.contains("x") { return (t, r.why["x"]) }
            t += every
        }
        return (nil, nil)
    }

    func testConstantsAreTheMeasuredRule() {
        XCTAssertEqual([Idle.stillM, Idle.idleS, Idle.parkedS, Idle.lingerS, Idle.pastPadS, Idle.futureS, Idle.gapS, Idle.spotR],
                       [80, 1800, 5400, 180, 3600, 120, 600, 120])
    }

    func testServiceClock() {
        XCTAssertEqual(Idle.serviceClock(at(23, 50)), .init(min: 1430, iso: "2026-10-14", day: "wed", group: "weekday"))
        XCTAssertEqual(Idle.serviceClock(at(24, 30)), .init(min: 1470, iso: "2026-10-14", day: "wed", group: "weekday"), "00:30 Thursday")
        XCTAssertEqual(Idle.serviceClock(at(28, 30)).iso, "2026-10-15")
        XCTAssertEqual(Idle.serviceClock(at(12) + 3 * 86400).group, "sat")
        XCTAssertEqual(Idle.serviceClock(at(24, 30) + 4 * 86400), .init(min: 1470, iso: "2026-10-18", day: "sun", group: "sun"))
    }

    func testHoursKey() {
        XCTAssertEqual(Idle.hoursKey(service, "N", iso: "2026-10-14", day: "wed"), "16:00-28:29")
        let d = ServiceDay(first: "05:40", last: "18:55", spans: [["05:40", "11:55"], ["15:30", "18:55"]])
        let sv = ServiceData(routes: ["M": RouteService(days: ["wed": d, "thu": d, "fri": d],
                                                        exceptions: [ServiceException(date: "2026-11-26", type: "removed", hours: nil),
                                                                     ServiceException(date: "2026-11-27", type: "added", hours: ServiceDay(first: "08:00", last: "12:00"))])])
        XCTAssertEqual(Idle.hoursKey(sv, "M", iso: "2026-10-14", day: "wed"), "05:40-11:55,15:30-18:55")
        XCTAssertEqual(Idle.hoursKey(sv, "M", iso: "2026-11-26", day: "thu"), "")
        XCTAssertEqual(Idle.hoursKey(sv, "M", iso: "2026-11-27", day: "fri"), "08:00-12:00")
        XCTAssertNil(Idle.hoursKey(sv, "X", iso: "2026-10-14", day: "wed"))
        XCTAssertNil(Idle.hoursKey(nil, "N", iso: "2026-10-14", day: "wed"))
    }

    func testLingerSpots() {
        func at(_ lat: Double, _ lon: Double, _ t: Double, idle i: IdleData? = nil, service s: ServiceData? = nil) -> Bool {
            Idle.lingerAt(i ?? idle, s ?? service, rid: "N", lat: lat, lon: lon, t: t) != nil
        }
        XCTAssertTrue(at(spot.lat, spot.lon, self.at(23, 40)))
        XCTAssertTrue(at(spot.lat, spot.lon, self.at(24, 20)))
        XCTAssertFalse(at(spot.lat, spot.lon, self.at(23, 20)), "before the learned time")
        XCTAssertNil(Idle.lingerAt(idle, service, rid: "A", lat: spot.lat, lon: spot.lon, t: self.at(23, 40)), "another route")
        XCTAssertFalse(at(41.7926, -87.5981, self.at(23, 40)), "160 m away")
        XCTAssertTrue(at(41.7920, -87.5981, self.at(23, 40)), "100 m away")
        XCTAssertFalse(at(spot.lat, spot.lon, self.at(23, 40) + 3 * 86400), "a Saturday")
        let sv2 = ServiceData(routes: ["N": RouteService(days: Dictionary(uniqueKeysWithValues: Schedule.dayKeys.map { ($0, ServiceDay(first: "16:00", last: "26:00")) }))])
        XCTAssertFalse(at(spot.lat, spot.lon, self.at(23, 40), service: sv2), "a new timetable")
        XCTAssertFalse(at(spot.lat, spot.lon, self.at(23, 40), service: ServiceData()), "no schedule data")
        var old = idle; old.validUntil = "2026-10-13"
        XCTAssertFalse(at(spot.lat, spot.lon, self.at(23, 40), idle: old), "past valid_until")
        var noHours = idle; noHours.linger[0].hours = []
        XCTAssertFalse(at(spot.lat, spot.lon, self.at(23, 40), idle: noHours))
        var daily = idle; daily.linger[0].days = "daily"
        XCTAssertTrue(at(spot.lat, spot.lon, self.at(23, 40) + 3 * 86400, idle: daily))
        XCTAssertNil(Idle.lingerAt(nil, service, rid: "N", lat: spot.lat, lon: spot.lon, t: self.at(23, 40)))
    }

    func testIdleDataParse() throws {
        let json = #"{"valid_until":"2026-12-20","linger":[{"route":"r1","spot":"One","lat":41.79,"lon":-87.6,"r":120,"after":"23:33","days":"weekday","hours":["07:00-19:00"],"seen":14},{"route":"r1","lat":41.79,"lon":-87.6,"after":"23:33","days":"weekday","hours":[]},{"route":"r1","lat":"x","lon":-87.6,"after":"23:33","days":"weekday","hours":["07:00-19:00"]},{"route":"r1","lat":41.79,"lon":-87.6,"after":"late","days":"weekday","hours":["07:00-19:00"]},{"route":"r1","lat":41.79,"lon":-87.6,"after":"23:33","days":"holidays","hours":["07:00-19:00"]},"junk"]}"#
        let d = try XCTUnwrap(IdleData.parse(Data(json.utf8)))
        XCTAssertEqual(d.validUntil, "2026-12-20")
        XCTAssertEqual(d.linger, [.init(route: "r1", spot: "One", lat: 41.79, lon: -87.6, r: 120, after: "23:33", days: "weekday", hours: ["07:00-19:00"], seen: 14)])
        XCTAssertNil(IdleData.parse(Data("[]".utf8)))
        XCTAssertFalse(try XCTUnwrap(TS.real.data.idle).linger.isEmpty, "the real web/data/idle.json")
        for e in TS.real.data.idle!.linger { XCTAssertNotNil(TS.real.data.routes[e.route], e.route) }
    }

    func testPredictsAhead() {
        let t = at(12)
        XCTAssertTrue(Idle.predictsAhead([tu("1", [t + Idle.futureS])], id: "1", t: t))
        XCTAssertFalse(Idle.predictsAhead([tu("1", [t + 60, t - 30])], id: "1", t: t), "only 'due now'")
        XCTAssertFalse(Idle.predictsAhead([tu("2", [t + 900])], id: "1", t: t), "another bus")
        XCTAssertTrue(Idle.predictsAhead([TripUpdate(trip: .init(), vehicle: .init(id: "1"), stopTimeUpdates: [StopTimeUpdate(stopId: nil, departure: t + 600)])], id: "1", t: t))
    }

    func testIdleAndParked() {
        let none = firstHidden("A", off, at(12), at(13, 40))
        XCTAssertEqual(none.0, at(12) + Idle.idleS); XCTAssertEqual(none.1, .idle)
        let ahead = firstHidden("A", off, at(12), at(13, 40), trips: { [self.tu("x", [$0 + 600])] })
        XCTAssertEqual(ahead.0, at(12) + Idle.parkedS); XCTAssertEqual(ahead.1, .parked)
        XCTAssertEqual(firstHidden("A", off, at(12), at(12, 40), trips: { [self.tu("x", [$0 + 30])] }).0, at(12) + Idle.idleS, "'now' does not count")
    }

    func testPastTheListedHours() {
        let ahead: (Double) -> [TripUpdate] = { [self.tu("x", [$0 + 600])] }
        XCTAssertEqual(firstHidden("A", off, at(22, 5), at(22, 30)).0, at(22, 5) + Idle.lingerS)
        XCTAssertEqual(firstHidden("A", off, at(22, 5), at(22, 30)).1, .past)
        XCTAssertNil(firstHidden("A", off, at(21, 20), at(21, 55), trips: ahead).0, "within the hour")
        XCTAssertNil(firstHidden("A", off, at(6, 10), at(6, 50), trips: ahead).0, "within an hour before the start")
        XCTAssertEqual(firstHidden("A", off, at(5, 40), at(5, 50)).0, at(5, 43))
    }

    func testLingerRule() {
        let late = firstHidden("N", spot, at(23, 46), at(24, 0), trips: { _ in [self.tu("x", [self.at(24, 0), self.at(24, 29)])] })
        XCTAssertEqual(late.0, at(23, 46) + Idle.lingerS); XCTAssertEqual(late.1, .linger)
        XCTAssertNil(firstHidden("N", spot, at(23, 15), at(23, 29), trips: { _ in [self.tu("x", [self.at(23, 30)])] }).0, "the 23:15 layover")
    }

    func testMovingAndJitter() {
        var tr: [String: Idle.Track] = [:]
        var t = at(12)
        while t <= at(12, 31) { tr = step(tr, [bus("a", "A", off, t)], t).tracks; t += 60 }
        XCTAssertEqual(step(tr, [bus("a", "A", off, at(12, 32))], at(12, 32)).hidden, ["a"])
        XCTAssertEqual(step(tr, [bus("a", "A", LatLon(lat: off.lat + 0.0006, lon: off.lon), at(12, 32))], at(12, 32)).hidden, ["a"], "67 m: still")
        let moved = step(tr, [bus("a", "A", LatLon(lat: off.lat + 0.0009, lon: off.lon), at(12, 32))], at(12, 32))
        XCTAssertEqual(moved.hidden, [], "100 m: moved")
        XCTAssertEqual(moved.tracks["a"]?.since, at(12, 32))
    }

    func testGapsRouteChangesMissingPollsAndThePhoneClock() {
        var tr = step([:], [bus("a", "A", off, at(12))], at(12)).tracks
        tr = step(tr, [bus("a", "A", off, at(12, 10))], at(12, 10)).tracks
        XCTAssertEqual(tr["a"]?.since, at(12))
        tr = step(tr, [bus("a", "A", off, at(12, 20) + 1)], at(12, 20) + 1).tracks
        XCTAssertEqual(tr["a"]?.since, at(12, 20) + 1)
        tr = step(tr, [bus("a", "N", off, at(12, 21))], at(12, 21)).tracks
        XCTAssertEqual(tr["a"]?.since, at(12, 21))
        XCTAssertEqual(step(tr, [], at(12, 25)).tracks["a"]?.since, at(12, 21))
        XCTAssertTrue(step(tr, [], at(12, 21) + Idle.gapS + 1).tracks.isEmpty)
        var t2: [String: Idle.Track] = [:]
        var t = at(23, 46)
        while t <= at(23, 48) { t2 = step(t2, [bus("n", "N", spot, t)], t, nowS: t + 3 * 3600).tracks; t += 30 }
        XCTAssertEqual(step(t2, [bus("n", "N", spot, at(23, 48) + 30)], at(23, 48) + 30, nowS: at(23, 48) + 30 + 3 * 3600).hidden, [])
    }

    func testNothingHiddenWithoutIdsAndOnlyByTimeWithoutStaticData() {
        var tr: [String: Idle.Track] = [:]
        var t = at(12)
        while t <= at(12, 40) {
            let r = step(tr, [VehiclePosition(latitude: off.lat, longitude: off.lon, trip: .init(routeId: "A"), timestamp: t),
                              VehiclePosition(vehicle: .init(id: "q"), latitude: off.lat, longitude: off.lon, trip: .init(), timestamp: t)],
                         t, service: ServiceData(), idle: .some(nil))
            tr = r.tracks
            XCTAssertEqual(r.hidden, [])
            t += 60
        }
        XCTAssertEqual(firstHidden("A", off, at(22, 5), at(22, 40), service: ServiceData(), idle: .some(nil)).0, at(22, 5) + Idle.idleS)
    }

    /// data/live.js parity: the merge drops a bus still at the linger spot after its time, and its trip updates.
    func testLiveMergeDropsTheIdleBusAndItsTripUpdates() {
        let stat = StaticData(routes: ["N": Route(id: "N", short: "N")], stops: ["S": Stop(id: "S", name: "S", lat: off.lat, lon: off.lon)],
                              routeStops: ["N": ["S"]], service: service, idle: idle)
        var pos = spot
        func poll(_ t: Double) -> FeedPoll {
            let vs = [bus("n", "N", pos, t), bus("ok", "N", off, t)]
            let ts = [TripUpdate(trip: .init(tripId: "t", routeId: "N"), vehicle: .init(id: "n"), stopTimeUpdates: [StopTimeUpdate(stopId: "S", arrival: at(24, 0))]),
                      TripUpdate(trip: .init(tripId: "t", routeId: "N"), vehicle: .init(id: "ok"), stopTimeUpdates: [StopTimeUpdate(stopId: "S", arrival: t + 600)])]
            return FeedPoll(vehicles: .success(Feed(timestamp: t, entities: vs)), trips: .success(Feed(timestamp: t, entities: ts)),
                            alerts: .success(Feed(timestamp: t, entities: [])))
        }
        var s = LiveState(), t = at(23, 40)
        for _ in 0..<6 { s = s.applying(poll(t), staticData: stat, now: t); t += 30 }
        XCTAssertEqual(s.buses.map(\.vehicle.id), ["n", "ok"], "2.5 min: shown")
        s = s.applying(poll(t), staticData: stat, now: t)
        XCTAssertEqual(s.buses.map(\.vehicle.id), ["ok"], "3 min: hidden")
        XCTAssertEqual(s.trips.map(\.vehicle.id), ["ok"])
        pos = LatLon(lat: spot.lat + 0.002, lon: spot.lon)
        t += 10
        s = s.applying(poll(t), staticData: stat, now: t)
        XCTAssertEqual(s.buses.map(\.vehicle.id), ["n", "ok"], "moved: shown at once")
        XCTAssertEqual(s.trips.map(\.vehicle.id), ["n", "ok"])
    }

    /// The web's answers on real bus reports, poll by poll (the Nov 5 buses beside Regenstein and their layovers, a bus
    /// parked 9 h, a bus still an hour with no prediction, a bus past its listed hours, a wait that then served).
    func testGoldenRealReportsMatchTheWeb() throws {
        let root = try XCTUnwrap(try JSONSerialization.jsonObject(with: TS.fixture("idle_golden")) as? [String: Any])
        let service = try JSONDecoder().decode(ServiceData.self, from: JSONSerialization.data(withJSONObject: try XCTUnwrap(root["service"])))
        let idle = try XCTUnwrap(IdleData.parse(JSONSerialization.data(withJSONObject: try XCTUnwrap(root["idle"]))))
        let cases = try XCTUnwrap(root["cases"] as? [[String: Any]])
        var bad: [String] = [], polls = 0, hiddenSeen = Set<String>()
        for c in cases {
            let name = try XCTUnwrap(c["name"] as? String)
            let ps = try XCTUnwrap(c["polls"] as? [[String: Any]]), expect = try XCTUnwrap(c["expect"] as? [[String]])
            XCTAssertEqual(ps.count, expect.count)
            var tr: [String: Idle.Track] = [:]
            for (i, p) in ps.enumerated() {
                let h = try XCTUnwrap(p["h"] as? NSNumber).doubleValue
                let v = try XCTUnwrap(p["v"] as? [[Any]]), pr = try XCTUnwrap(p["p"] as? [[Any]])
                let buses = v.map { x in
                    VehiclePosition(vehicle: .init(id: x[0] as? String), latitude: (x[2] as! NSNumber).doubleValue, longitude: (x[3] as! NSNumber).doubleValue,
                                    trip: .init(routeId: x[1] as? String), timestamp: (x[4] as! NSNumber).doubleValue)
                }
                let trips = pr.compactMap { x -> TripUpdate? in
                    let t = (x[1] as! NSNumber).doubleValue
                    guard t != 0, let veh = x[0] as? String else { return nil }
                    return TripUpdate(trip: .init(tripId: "t" + veh), vehicle: .init(id: veh), stopTimeUpdates: [StopTimeUpdate(stopId: "s", arrival: t)])
                }
                let r = Idle.step(tr, buses: buses, trips: trips, service: service, idle: idle, now: h, feedTs: h)
                tr = r.tracks
                if r.hidden != expect[i] { bad.append("\(name) poll \(i): \(r.hidden) vs web \(expect[i])") }
                for id in r.hidden { hiddenSeen.insert(name + ":" + id) }
                polls += 1
            }
        }
        XCTAssertGreaterThan(polls, 500)
        XCTAssertEqual(Array(bad.prefix(10)), [], "\(bad.count) polls differ from web/js/core/idle.js")
        XCTAssertEqual(hiddenSeen, ["regenstein:4328", "regenstein:4538", "regenstein:4313", "regenstein:4318", "regenstein:12645",
                                    "parked:12647", "idle:4317", "past:4325"], "never the East bus that served, nor the wait that served")
    }

    /// Planner parity (web core-planner.js): past its listed hours a route is offered only for its own live times.
    func testPlannerNoHeadwayPastTheListedHours() {
        let stops = ["L0": Stop(id: "L0", name: "L0", lat: 41.79, lon: -87.6), "L1": Stop(id: "L1", name: "L1", lat: 41.79, lon: -87.59),
                     "L2": Stop(id: "L2", name: "L2", lat: 41.8, lon: -87.59), "L3": Stop(id: "L3", name: "L3", lat: 41.8, lon: -87.6)]
        let rs = ["LOOP": ["L0", "L1", "L2", "L3", "L0"]]
        let buses = [VehiclePosition(vehicle: .init(id: "v"), latitude: 41.79, longitude: -87.6, trip: .init(routeId: "LOOP"), timestamp: 0)]
        let open = ServiceData(routes: ["LOOP": RouteService(days: Dictionary(uniqueKeysWithValues: Schedule.dayKeys.map { ($0, ServiceDay(first: "00:00", last: "23:59")) }))])
        let closed = ServiceData(routes: ["LOOP": RouteService(days: [:])])
        let from = LatLon(lat: 41.8001, lon: -87.6), to = LatLon(lat: 41.7901, lon: -87.59), T = 1_800_000_000.0
        func keys(_ s: ServiceData?, trips: [TripUpdate] = []) -> [String] {
            Planner.plan(from: from, to: to, now: T, data: PlannerData(stops: stops, routeStops: rs, trips: trips, buses: buses, service: s))
                .options.map(\.key)
        }
        XCTAssertTrue(keys(open).contains("LOOP"), "inside its hours: estimated")
        XCTAssertFalse(keys(closed).contains { $0.hasPrefix("LOOP") }, "outside: not offered")
        let live = [TripUpdate(trip: .init(tripId: "x", routeId: "LOOP"), vehicle: .init(id: "xv"),
                               stopTimeUpdates: [StopTimeUpdate(stopId: "L3", arrival: T + 300), StopTimeUpdate(stopId: "L0", arrival: T + 400), StopTimeUpdate(stopId: "L1", arrival: T + 500)])]
        XCTAssertTrue(keys(closed, trips: live).contains("LOOP"), "outside with a live time: offered")
        XCTAssertTrue(keys(nil).contains("LOOP"), "no schedule data: as before")
    }
}
