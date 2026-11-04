import XCTest
@testable import StraightBussingKit

/// Port of web/tests/core-offroute.js (buses not following their route for a long time are hidden; RouteKnower E27)
/// and the web's own answers on real bus reports (Fixtures/offroute_golden.json, the same file the web test reads).
final class OffRouteTests: XCTestCase {
    let noon = 1_791_997_200.0       // Wed 2026-10-14 12:00 Chicago (CDT)
    let night = 1_792_033_200.0      // Wed 22:00: route A ended at 21:00, past the 30 min pad
    let garage = LatLon(lat: 41.82, lon: -87.64)
    // A runs east-west along 41.79, B along 41.80; both 07:00 to 21:00
    let shapes: [String: [[LatLon]]] = [
        "A": [[LatLon(lat: 41.79, lon: -87.62), LatLon(lat: 41.79, lon: -87.60), LatLon(lat: 41.79, lon: -87.58)]],
        "B": [[LatLon(lat: 41.80, lon: -87.62), LatLon(lat: 41.80, lon: -87.58)]],
    ]
    var service: ServiceData {
        let d = ServiceDay(first: "07:00", last: "21:00", trips: 10, buses: Array(repeating: 1, count: 24))
        let week = Dictionary(uniqueKeysWithValues: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map { ($0, d) })
        return ServiceData(routes: ["A": RouteService(days: week), "B": RouteService(days: week)])
    }
    let routes = ["A": Route(id: "A", short: "A", aliasIds: ["38734"]), "B": Route(id: "B", short: "B")]

    func bus(_ id: String, _ rid: String, _ p: LatLon, _ ts: Double) -> VehiclePosition {
        VehiclePosition(vehicle: .init(id: id), latitude: p.lat, longitude: p.lon, trip: .init(tripId: "t-" + id, routeId: rid), timestamp: ts)
    }

    func step(_ tr: [String: OffRoute.Track], _ buses: [VehiclePosition], _ t: Double, alerts: [ServiceAlert] = [],
              nowS: Double? = nil, shapes s: [String: [[LatLon]]]? = nil) -> (tracks: [String: OffRoute.Track], hidden: [String]) {
        OffRoute.step(tr, buses: buses, shapes: s ?? shapes, service: service, alerts: alerts, routes: routes, now: nowS ?? t, feedTs: t)
    }

    /// The first poll time at which the bus is hidden (nil: never), feeding it every `every` s from t0 to t1.
    func firstHidden(_ rid: String, _ pos: (Double) -> LatLon, _ t0: Double, _ t1: Double, every: Double = 30,
                     alerts: [ServiceAlert] = []) -> (first: Double?, rows: [(Double, Bool)]) {
        var tr: [String: OffRoute.Track] = [:], rows: [(Double, Bool)] = []
        var t = t0
        while t <= t1 {
            let r = step(tr, [bus("x", rid, pos(t), t)], t, alerts: alerts)
            tr = r.tracks
            rows.append((t, r.hidden.contains("x")))
            t += every
        }
        return (rows.first { $0.1 }?.0, rows)
    }

    func testConstantsAreTheMeasuredRule() {
        XCTAssertEqual([OffRoute.offM, OffRoute.hideInS, OffRoute.hideOutS, OffRoute.hoursPadS, OffRoute.followM, OffRoute.returnM, OffRoute.gapS],
                       [300, 900, 300, 1800, 1500, 1000, 600])
    }

    func testClosestPointOnALine() throws {
        XCTAssertLessThan(try XCTUnwrap(OffRoute.closestOnLine(shapes["A"], lat: 41.79, lon: -87.61)).d, 0.5)
        let n = try XCTUnwrap(OffRoute.closestOnLine(shapes["A"], lat: 41.7945, lon: -87.61))
        XCTAssertEqual(n.d, 500, accuracy: 5)
        XCTAssertEqual(n.lat, 41.79, accuracy: 1e-6)
        XCTAssertEqual(n.lon, -87.61, accuracy: 1e-6)
        XCTAssertEqual(try XCTUnwrap(OffRoute.closestOnLine(shapes["A"], lat: 41.79, lon: -87.57)).lon, -87.58, accuracy: 1e-9)
        XCTAssertNil(OffRoute.closestOnLine(nil, lat: 41.79, lon: -87.6))
        XCTAssertNil(OffRoute.closestOnLine([[LatLon(lat: 41.79, lon: -87.6)]], lat: 41.79, lon: -87.6), "a one-point line")
    }

    func testListedHoursWithThePad() {
        XCTAssertEqual(OffRoute.inListedHours(service, "A", noon), true)
        XCTAssertEqual(OffRoute.inListedHours(service, "A", noon + 9 * 3600 + 20 * 60), true, "21:20")
        XCTAssertEqual(OffRoute.inListedHours(service, "A", noon + 9 * 3600 + 40 * 60), false, "21:40")
        XCTAssertEqual(OffRoute.inListedHours(service, "A", noon - 5 * 3600 - 20 * 60), true, "06:40")
        XCTAssertEqual(OffRoute.inListedHours(service, "A", night), false)
        XCTAssertNil(OffRoute.inListedHours(service, "X", noon), "no schedule data")
    }

    func testDetourAlerts() {
        func al(_ text: String, _ ids: [String] = [], _ p: [ServiceAlert.Period] = []) -> ServiceAlert {
            ServiceAlert(id: text, header: text, activePeriods: p, routeIds: ids)
        }
        XCTAssertTrue(OffRoute.detourAlert([al("North Route", ["38734"])], routes: routes, rid: "A", now: noon))
        XCTAssertFalse(OffRoute.detourAlert([al("North Route", ["38734"])], routes: routes, rid: "B", now: noon))
        XCTAssertFalse(OffRoute.detourAlert([al("UGo Bus Route Assistance")], routes: routes, rid: "A", now: noon))
        XCTAssertTrue(OffRoute.detourAlert([al("Goldblatt Pavilion boarding: the shuttles will be rerouted as follows")], routes: routes, rid: "A", now: noon))
        XCTAssertFalse(OffRoute.detourAlert([al("Shuttles rerouted", [], [.init(start: noon + 3600, end: noon + 7200)])], routes: routes, rid: "A", now: noon))
    }

    func testParkedFarFromEveryLineHiddenAfter15MinShownWhenBack() {
        let g = garage
        XCTAssertEqual(firstHidden("A", { _ in g }, noon, noon + 1800).first, noon + OffRoute.hideInS)
        var tr: [String: OffRoute.Track] = [:]
        var t = noon
        while t <= noon + 1200 { tr = step(tr, [bus("g", "A", g, t)], t).tracks; t += 30 }
        let back = step(tr, [bus("g", "A", LatLon(lat: 41.7905, lon: -87.61), noon + 1230)], noon + 1230)
        XCTAssertEqual(back.hidden, [], "back on its line: shown at once")
        XCTAssertTrue(back.tracks.isEmpty, "its clock is gone")
        XCTAssertEqual(firstHidden("A", { _ in g }, night, night + 900).first, night + OffRoute.hideOutS, "outside the hours: 5 min")
    }

    func testNeverHiddenNearAnotherLineOrItsOwn() {
        XCTAssertNil(firstHidden("A", { _ in LatLon(lat: 41.8005, lon: -87.60) }, noon, noon + 3600).first, "on B's line")
        XCTAssertNil(firstHidden("A", { _ in LatLon(lat: 41.7925, lon: -87.60) }, noon, noon + 3600).first, "280 m from its line")
        XCTAssertEqual(firstHidden("A", { _ in LatLon(lat: 41.7935, lon: -87.61) }, noon, noon + 3600).first, noon + OffRoute.hideInS)
    }

    func testFollowingAndReturningAreNeverHidden() {
        let n = noon
        let along: (Double) -> LatLon = { t in LatLon(lat: 41.775, lon: -87.62 + 0.04 * min(1, (t - n) / 1500)) }
        XCTAssertNil(firstHidden("A", along, noon, noon + 2400).first, "along its route on another street")
        XCTAssertEqual(firstHidden("A", { _ in LatLon(lat: 41.775, lon: -87.60) }, noon, noon + 2400).first, noon + OffRoute.hideInS, "parked there")
        let g = garage
        let out: (Double) -> LatLon = { t in
            t < n + 1200 ? g : LatLon(lat: g.lat - 0.001 * ((t - n - 1200) / 30), lon: g.lon + 0.001 * ((t - n - 1200) / 30))
        }
        let rows = firstHidden("A", out, noon, noon + 1800).rows
        let last = rows.filter { $0.1 }.last!.0
        let d0 = OffRoute.closestOnLine(shapes["A"], lat: g.lat, lon: g.lon)!.d
        let p = out(last + 30), dAt = OffRoute.closestOnLine(shapes["A"], lat: p.lat, lon: p.lon)!.d
        XCTAssertGreaterThanOrEqual(d0 - dAt, OffRoute.returnM - 10)
        XCTAssertLessThan(d0 - dAt, OffRoute.returnM + 300)
        XCTAssertTrue(rows.filter { $0.0 > last }.allSatisfy { !$0.1 }, "stays shown while it heads back")
    }

    func testDetourAlertKeepsItShownInsideTheHoursOnly() {
        let alerts = [ServiceAlert(id: "d", header: "Detour", description: "Shuttles are on a detour around 59th St")]
        let g = garage
        XCTAssertNil(firstHidden("A", { _ in g }, noon, noon + 1800, alerts: alerts).first)
        XCTAssertEqual(firstHidden("A", { _ in g }, night, night + 900, alerts: alerts).first, night + OffRoute.hideOutS)
    }

    func testGapsRouteChangesMissingPollsAndThePhoneClock() {
        var tr = step([:], [bus("g", "A", garage, noon)], noon).tracks
        tr = step(tr, [bus("g", "A", garage, noon + 600)], noon + 600).tracks
        XCTAssertEqual(tr["g"]?.since, noon, "a 10 min gap continues")
        tr = step(tr, [bus("g", "A", garage, noon + 1201)], noon + 1201).tracks
        XCTAssertEqual(tr["g"]?.since, noon + 1201, "a longer gap: a new clock")
        tr = step(tr, [bus("g", "B", garage, noon + 1231)], noon + 1231).tracks
        XCTAssertEqual(tr["g"]?.since, noon + 1231, "a route change: a new clock")
        XCTAssertEqual(step(tr, [], noon + 1500).tracks["g"]?.since, noon + 1231, "missing from one poll: kept")
        XCTAssertTrue(step(tr, [], noon + 1231 + OffRoute.gapS + 1).tracks.isEmpty, "dropped after gapS")
        var t2: [String: OffRoute.Track] = [:]
        var t = noon
        while t <= noon + 840 { t2 = step(t2, [bus("g", "A", garage, t)], t, nowS: t + 3 * 3600).tracks; t += 60 }
        XCTAssertEqual(step(t2, [bus("g", "A", garage, noon + 870)], noon + 870, nowS: noon + 870 + 3 * 3600).hidden, [], "report times, not the phone's")
    }

    func testNothingHiddenWithoutLinesOrVehicleIds() {
        var tr: [String: OffRoute.Track] = [:]
        var t = noon
        while t <= noon + 1800 {
            let r = step(tr, [bus("g", "A", garage, t), VehiclePosition(latitude: garage.lat, longitude: garage.lon, trip: .init(routeId: "A"), timestamp: t)],
                         t, shapes: [:])
            tr = r.tracks
            XCTAssertEqual(r.hidden, [])
            t += 60
        }
    }

    func testDropHiddenRemovesTheBusAndItsOwnTripUpdatesOnly() {
        let buses = [bus("1", "A", garage, noon), bus("2", "A", LatLon(lat: 41.79, lon: -87.6), noon)]
        let trips = [TripUpdate(trip: .init(tripId: "shared"), vehicle: .init(id: "1"), stopTimeUpdates: []),
                     TripUpdate(trip: .init(tripId: "shared"), vehicle: .init(id: "2"), stopTimeUpdates: []),
                     TripUpdate(trip: .init(tripId: "x"), stopTimeUpdates: [])]
        let d = OffRoute.dropHidden(buses: buses, trips: trips, hidden: ["1"])
        XCTAssertEqual(d.buses.map(\.vehicle.id), ["2"])
        XCTAssertEqual(d.trips.map(\.vehicle.id), ["2", nil])
    }

    /// data/live.js parity: the merge drops a bus 15 min off its route, and its trip updates; back on its line = back.
    func testLiveMergeDropsTheBusAndItsTripUpdates() {
        let stat = StaticData(routes: routes, stops: ["S": Stop(id: "S", name: "S", lat: 41.79, lon: -87.61)], shapes: shapes,
                              routeStops: ["A": ["S"]], service: service)
        var pos = garage
        func poll(_ t: Double) -> FeedPoll {
            let vs = [bus("g", "A", pos, t), bus("ok", "A", LatLon(lat: 41.79, lon: -87.61), t)]
            let ts = [TripUpdate(trip: .init(tripId: "t", routeId: "A"), vehicle: .init(id: "g"), stopTimeUpdates: [StopTimeUpdate(stopId: "S", arrival: t + 300)]),
                      TripUpdate(trip: .init(tripId: "t", routeId: "A"), vehicle: .init(id: "ok"), stopTimeUpdates: [StopTimeUpdate(stopId: "S", arrival: t + 600)])]
            return FeedPoll(vehicles: .success(Feed(timestamp: t, entities: vs)), trips: .success(Feed(timestamp: t, entities: ts)),
                            alerts: .success(Feed(timestamp: t, entities: [])))
        }
        var s = LiveState(), t = noon
        while t < noon + OffRoute.hideInS { s = s.applying(poll(t), staticData: stat, now: t); t += 60 }
        XCTAssertEqual(s.buses.map(\.vehicle.id), ["g", "ok"], "14 min: still shown")
        s = s.applying(poll(t), staticData: stat, now: t)
        XCTAssertEqual(s.buses.map(\.vehicle.id), ["ok"], "15 min: hidden")
        XCTAssertEqual(s.trips.map(\.vehicle.id), ["ok"], "its arrival times go with it")
        pos = LatLon(lat: 41.7902, lon: -87.605)
        t += 10
        s = s.applying(poll(t), staticData: stat, now: t)
        XCTAssertEqual(s.buses.map(\.vehicle.id), ["g", "ok"], "back on its line: shown at once")
        XCTAssertEqual(s.trips.map(\.vehicle.id), ["g", "ok"])
    }

    /// The web's answers on real bus reports, poll by poll (DC-022 garage runs, the Downtown Campus Connector detour off
    /// Lake Shore Drive, the Apostolic 8 AM Metra run, a bus parked at the garage).
    func testGoldenRealReportsMatchTheWeb() throws {
        let root = try XCTUnwrap(try JSONSerialization.jsonObject(with: TS.fixture("offroute_golden")) as? [String: Any])
        let shapesRaw = try XCTUnwrap(root["shapes"] as? [String: [[[Double]]]])
        let shapes = shapesRaw.mapValues { lines in lines.map { line in line.map { LatLon(lat: $0[0], lon: $0[1]) } } }
        let service = try JSONDecoder().decode(ServiceData.self, from: JSONSerialization.data(withJSONObject: try XCTUnwrap(root["service"])))
        let routesRaw = try XCTUnwrap(root["routes"] as? [String: [String: Any]])
        let routes = Dictionary(uniqueKeysWithValues: routesRaw.map { ($0.key, Route(id: $0.key, aliasIds: ($0.value["alias_ids"] as? [String]) ?? [])) })
        let cases = try XCTUnwrap(root["cases"] as? [[String: Any]])
        var bad: [String] = [], polls = 0, hiddenSeen = Set<String>()
        for c in cases {
            let name = try XCTUnwrap(c["name"] as? String)
            let ps = try XCTUnwrap(c["polls"] as? [[String: Any]]), expect = try XCTUnwrap(c["expect"] as? [[String]])
            XCTAssertEqual(ps.count, expect.count)
            var tr: [String: OffRoute.Track] = [:]
            for (i, p) in ps.enumerated() {
                let h = try XCTUnwrap(p["h"] as? NSNumber).doubleValue
                let v = try XCTUnwrap(p["v"] as? [[Any]])
                let buses = v.map { x in
                    VehiclePosition(vehicle: .init(id: x[0] as? String), latitude: (x[2] as! NSNumber).doubleValue, longitude: (x[3] as! NSNumber).doubleValue,
                                    trip: .init(routeId: x[1] as? String), timestamp: (x[4] as! NSNumber).doubleValue)
                }
                let r = OffRoute.step(tr, buses: buses, shapes: shapes, service: service, alerts: [], routes: routes, now: h, feedTs: h)
                tr = r.tracks
                if r.hidden != expect[i] { bad.append("\(name) poll \(i): \(r.hidden) vs web \(expect[i])") }
                for id in r.hidden { hiddenSeen.insert(name + ":" + id) }
                polls += 1
            }
        }
        XCTAssertGreaterThan(polls, 300)
        XCTAssertEqual(Array(bad.prefix(10)), [], "\(bad.count) polls differ from web/js/core/offroute.js")
        XCTAssertEqual(hiddenSeen, ["dc022:4313", "dc022:4325", "dc022:4327", "garage:4324"], "never the detour or the Metra run")
    }
}
