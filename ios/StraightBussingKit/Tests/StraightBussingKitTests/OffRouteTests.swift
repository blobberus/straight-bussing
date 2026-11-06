import XCTest
@testable import StraightBussingKit

/// Port of web/tests/core-offroute.js (buses more than a block off their route are hidden, still tracked; RouteKnower
/// E27b) and the web's own answers on real bus reports (Fixtures/offroute_golden.json, the same file the web test reads).
final class OffRouteTests: XCTestCase {
    let noon = 1_791_997_200.0       // Wed 2026-10-14 12:00 Chicago (CDT)
    let night = 1_792_033_200.0      // Wed 22:00: route A ended at 21:00, past the 30 min pad
    let garage = LatLon(lat: 41.82, lon: -87.64)
    let onA = LatLon(lat: 41.7902, lon: -87.61)
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

    /// The first poll time at which the bus is hidden (nil: never), feeding it a new report every `every` s from t0 to t1.
    func firstHidden(_ rid: String, _ pos: (Double) -> LatLon, _ t0: Double, _ t1: Double, every: Double = 15,
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
        XCTAssertEqual([OffRoute.blockM, OffRoute.confirmS, OffRoute.hoursPadS, OffRoute.gapS], [250, 45, 1800, 600])
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

    func testGarageBoundBusHiddenAfter45sStillTrackedShownWhenBack() {
        let g = garage
        let rows = firstHidden("A", { _ in g }, noon, noon + 600).rows
        XCTAssertEqual(rows.first { $0.1 }?.0, noon + OffRoute.confirmS, "hidden at 45 s (the fourth report)")
        XCTAssertTrue(rows.filter { $0.0 >= noon + OffRoute.confirmS }.allSatisfy { $0.1 }, "and stays hidden")
        XCTAssertEqual(firstHidden("A", { _ in g }, night, night + 600).first, night + OffRoute.confirmS, "outside the hours: the same")
        var tr: [String: OffRoute.Track] = [:]
        var t = noon
        while t <= noon + 300 { tr = step(tr, [bus("g", "A", g, t)], t).tracks; t += 15 }
        XCTAssertEqual(tr["g"], OffRoute.Track(rid: "A", since: noon, last: noon + 300, n: 21), "still tracked while hidden")
        let back = step(tr, [bus("g", "A", onA, noon + 310)], noon + 310)
        XCTAssertEqual(back.hidden, [], "back within a block: shown on that report")
        XCTAssertTrue(back.tracks.isEmpty, "its clock is gone")
        XCTAssertEqual(step(back.tracks, [bus("g", "A", g, noon + 320)], noon + 320).hidden, [], "off again: a new clock")
    }

    func testABlockIsMeasuredFromTheBusesOwnLineOnly() {
        XCTAssertNil(firstHidden("A", { _ in LatLon(lat: 41.7920, lon: -87.60) }, noon, noon + 3600).first, "222 m from its line")
        XCTAssertEqual(firstHidden("A", { _ in LatLon(lat: 41.7925, lon: -87.61) }, noon, noon + 600).first, noon + OffRoute.confirmS, "278 m")
        XCTAssertEqual(firstHidden("A", { _ in LatLon(lat: 41.8005, lon: -87.60) }, noon, noon + 600).first, noon + OffRoute.confirmS, "on B's line, filed under A")
        XCTAssertNil(firstHidden("B", { _ in LatLon(lat: 41.8005, lon: -87.60) }, noon, noon + 3600).first, "on its own line B")
    }

    func testOneBadFixNeverHidesABus() {
        let n = noon, far = LatLon(lat: 41.7945, lon: -87.61), on = onA
        XCTAssertNil(firstHidden("A", { $0 == n + 100 ? far : on }, noon, noon + 400, every: 10).first, "a single spike")
        XCTAssertNil(firstHidden("A", { $0 >= n + 100 && $0 <= n + 130 ? far : on }, noon, noon + 400, every: 10).first, "four far fixes over 30 s")
        var tr: [String: OffRoute.Track] = [:]
        var h = noon
        while h <= noon + 300 {
            let r = OffRoute.step(tr, buses: [bus("r", "A", garage, noon)], shapes: shapes, service: service, alerts: [], routes: routes, now: h, feedTs: h)
            tr = r.tracks
            XCTAssertEqual(r.hidden, [], "the same report repeated at \(h - noon) s")
            h += 10
        }
        XCTAssertEqual(tr["r"]?.n, 1, "counted once")
    }

    func testFollowingOnAnotherStreetIsHiddenNowADetourAlertKeepsItShownInsideTheHours() {
        let n = noon
        let along: (Double) -> LatLon = { t in LatLon(lat: 41.775, lon: -87.62 + 0.04 * min(1, (t - n) / 1500)) }
        XCTAssertEqual(firstHidden("A", along, noon, noon + 2400).first, noon + OffRoute.confirmS, "no alert: hidden")
        let detour = [ServiceAlert(id: "d", header: "Detour", description: "Shuttles are on a detour around 59th St")]
        XCTAssertNil(firstHidden("A", along, noon, noon + 2400, alerts: detour).first, "a detour alert: shown")
        let named = [ServiceAlert(id: "n", header: "North Route", routeIds: ["38734"])]
        XCTAssertNil(firstHidden("A", along, noon, noon + 2400, alerts: named).first, "an alert naming A by Passio's id")
        XCTAssertEqual(firstHidden("B", along, noon, noon + 2400, alerts: named).first, noon + OffRoute.confirmS, "naming another route")
        let g = garage
        XCTAssertEqual(firstHidden("A", { _ in g }, night, night + 600, alerts: detour).first, night + OffRoute.confirmS, "outside the hours")
    }

    func testGapsRouteChangesMissingPollsAndThePhoneClock() {
        var tr = step([:], [bus("g", "A", garage, noon)], noon).tracks
        tr = step(tr, [bus("g", "A", garage, noon + 600)], noon + 600).tracks
        XCTAssertEqual(tr["g"]?.since, noon, "a 10 min gap continues")
        XCTAssertEqual(tr["g"]?.n, 2)
        tr = step(tr, [bus("g", "A", garage, noon + 1201)], noon + 1201).tracks
        XCTAssertEqual(tr["g"]?.since, noon + 1201, "a longer gap: a new clock")
        XCTAssertEqual(tr["g"]?.n, 1)
        tr = step(tr, [bus("g", "B", garage, noon + 1231)], noon + 1231).tracks
        XCTAssertEqual(tr["g"]?.since, noon + 1231, "a route change: a new clock")
        let missing = step(tr, [], noon + 1500)
        XCTAssertEqual(missing.tracks["g"]?.since, noon + 1231, "missing from one poll: kept")
        XCTAssertEqual(missing.hidden, [])
        XCTAssertTrue(step(tr, [], noon + 1231 + OffRoute.gapS + 1).tracks.isEmpty, "dropped after gapS")
        var t2: [String: OffRoute.Track] = [:]
        var t = noon
        while t <= noon + 30 { t2 = step(t2, [bus("g", "A", garage, t)], t, nowS: t + 3 * 3600).tracks; t += 15 }
        XCTAssertEqual(step(t2, [bus("g", "A", garage, noon + 40)], noon + 40, nowS: noon + 3 * 3600 + 900).hidden, [], "report times, not the phone's")
    }

    func testNothingHiddenWithoutLinesOrVehicleIds() {
        var tr: [String: OffRoute.Track] = [:]
        var t = noon
        while t <= noon + 600 {
            let r = step(tr, [bus("g", "A", garage, t), VehiclePosition(latitude: garage.lat, longitude: garage.lon, trip: .init(routeId: "A"), timestamp: t)],
                         t, shapes: [:])
            tr = r.tracks
            XCTAssertEqual(r.hidden, [])
            t += 15
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

    func testAwayBusesCountsAndTheRoutePageWords() {
        let buses = [bus("1", "A", garage, noon), bus("2", "A", onA, noon), bus("3", "B", garage, noon), bus("4", "A", garage, noon)]
        XCTAssertEqual(OffRoute.awayBuses(buses, hidden: ["4", "1"]).map(\.vehicle.id), ["1", "4"], "input order")
        XCTAssertEqual(OffRoute.awayBuses(buses, hidden: []), [])
        let away = OffRoute.awayBuses(buses, hidden: ["1", "3", "4"])
        XCTAssertEqual([OffRoute.awayCount(away, rid: "A"), OffRoute.awayCount(away, rid: "B"), OffRoute.awayCount(away, rid: "C")], [2, 1, 0])
        XCTAssertEqual(RouteText.awayText(0), "")
        XCTAssertEqual(RouteText.awayText(1), "1 bus is away from the route and hidden from the map.")
        XCTAssertEqual(RouteText.awayText(2), "2 buses are away from the route and hidden from the map.")
        XCTAssertEqual(RouteText.noLiveNote(away: 0), "No bus on this route is sending its location, so we can't confirm it's running. Call 773.702.8181 before you rely on it.")
        XCTAssertEqual(RouteText.noLiveNote(away: 1), "No bus is on this route right now, so we can't confirm it's running. Call 773.702.8181 before you rely on it.")
    }

    /// data/live.js parity: the merge drops a bus 45 s more than a block off, and its trip updates, keeps it in
    /// `awayBuses`; back within a block = back.
    func testLiveMergeDropsTheBusKeepsItAwayAndBringsItBack() {
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
        while t < noon + OffRoute.confirmS { s = s.applying(poll(t), staticData: stat, now: t); t += 10 }
        XCTAssertEqual(s.buses.map(\.vehicle.id), ["g", "ok"], "40 s: still shown")
        XCTAssertEqual(s.awayBuses, [])
        s = s.applying(poll(t), staticData: stat, now: t)
        XCTAssertEqual(s.buses.map(\.vehicle.id), ["ok"], "45 s: hidden")
        XCTAssertEqual(s.trips.map(\.vehicle.id), ["ok"], "its arrival times go with it")
        XCTAssertEqual(s.awayBuses.map(\.vehicle.id), ["g"], "still tracked")
        pos = LatLon(lat: 41.7902, lon: -87.605)
        t += 10
        s = s.applying(poll(t), staticData: stat, now: t)
        XCTAssertEqual(s.buses.map(\.vehicle.id), ["g", "ok"], "back within a block: shown at once")
        XCTAssertEqual(s.trips.map(\.vehicle.id), ["g", "ok"])
        XCTAssertEqual(s.awayBuses, [])
    }

    /// The web's answers on real bus reports, poll by poll (DC-022 garage runs, a bus parked at the garage, buses on their
    /// line, a GPS spike, the Downtown Campus Connector detour off Lake Shore Drive, the Apostolic 8 AM Metra run, a North
    /// bus off its line under an operator alert naming North).
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
            // the case's operator alerts (web core-offroute.js feedAlerts)
            let alerts: [ServiceAlert] = ((c["alerts"] as? [[String: Any]]) ?? []).map { a in
                ServiceAlert(id: a["id"] as? String ?? "", header: a["header"] as? String ?? "", description: a["description"] as? String ?? "",
                             activePeriods: [.init(start: (a["start"] as? NSNumber)?.doubleValue, end: (a["end"] as? NSNumber)?.doubleValue)],
                             routeIds: a["routes"] as? [String] ?? [])
            }
            var tr: [String: OffRoute.Track] = [:]
            for (i, p) in ps.enumerated() {
                let h = try XCTUnwrap(p["h"] as? NSNumber).doubleValue
                let v = try XCTUnwrap(p["v"] as? [[Any]])
                let buses = v.map { x in
                    VehiclePosition(vehicle: .init(id: x[0] as? String), latitude: (x[2] as! NSNumber).doubleValue, longitude: (x[3] as! NSNumber).doubleValue,
                                    trip: .init(routeId: x[1] as? String), timestamp: (x[4] as! NSNumber).doubleValue)
                }
                let r = OffRoute.step(tr, buses: buses, shapes: shapes, service: service, alerts: alerts, routes: routes, now: h, feedTs: h)
                tr = r.tracks
                if r.hidden != expect[i] { bad.append("\(name) poll \(i): \(r.hidden) vs web \(expect[i])") }
                for id in r.hidden { hiddenSeen.insert(name + ":" + id) }
                polls += 1
            }
        }
        XCTAssertGreaterThan(polls, 1000)
        XCTAssertEqual(Array(bad.prefix(10)), [], "\(bad.count) polls differ from web/js/core/offroute.js")
        XCTAssertEqual(hiddenSeen, ["dc022:4313", "dc022:4325", "dc022:4327", "garage:4324", "apostolic:4328",
                                    "dcc:12642", "dcc:12645", "dcc:12649", "dcc:4314", "dcc:4320"],
                       "never the buses on their line, the GPS spike or the North bus under its route's alert")
    }
}
