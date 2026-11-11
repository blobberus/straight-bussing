import XCTest
@testable import StraightBussingKit

/// Port of web/tests/core-offroute.js "seen: ..." and "offroute: a bus off its route inside a transition window ..." and
/// web/tests/data-static.js (service_seen.json cleaned to what core/seen.js reads); owner 2026-11-11: show a bus off its
/// route in a transition time to its new line, marked "Transitioning to new line".
final class SeenTests: XCTestCase {
    let noon = 1_791_997_200.0       // Wed 2026-10-14 12:00 Chicago (CDT)
    func at(_ h: Double, _ m: Double = 0) -> Double { noon + (h - 12) * 3600 + m * 60 }
    let garage = LatLon(lat: 41.82, lon: -87.64)
    let shapes: [String: [[LatLon]]] = [
        "A": [[LatLon(lat: 41.79, lon: -87.62), LatLon(lat: 41.79, lon: -87.60), LatLon(lat: 41.79, lon: -87.58)]],
        "B": [[LatLon(lat: 41.80, lon: -87.62), LatLon(lat: 41.80, lon: -87.58)]],
    ]
    var service: ServiceData {
        let d = ServiceDay(first: "07:00", last: "21:00", trips: 10, buses: Array(repeating: 1, count: 24))
        let week = Dictionary(uniqueKeysWithValues: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map { ($0, d) })
        return ServiceData(routes: ["A": RouteService(days: week), "B": RouteService(days: week)])
    }
    let routes = ["A": Route(id: "A", short: "A"), "B": Route(id: "B", short: "B")]
    static let json = """
    {"valid_until": "2026-12-25", "about": "long text", "lines": {
      "A": {"days": [{"type": "weekday", "dows": ["mon", "tue", "wed", "thu", "fri"], "listed": {"spans": [["07:00", "21:00"]]},
        "buses": [{"bus": 1, "days": 22, "first_stop": {"p50": "07:05"}}, {"bus": 2, "days": 9, "first_stop": {"p50": "16:00"}},
                  {"bus": 3, "days": 2, "first_stop": {"p50": "12:00"}}]},
        {"type": "sat", "dows": ["sat"], "listed": {"spans": [["09:00", "17:00"]]}, "buses": []}]},
      "B": {"days": [{"type": "weekday", "dows": ["mon", "tue", "wed", "thu", "fri"], "listed": {"spans": [["07:00", "21:00"]]}, "buses": []}]},
      "bad": "x"},
     "transitions": [{"from": "A", "to": "B", "day_type": "weekday", "kind": "direct", "leave": {"p50": "17:57"}, "join": {"p50": "18:03"}},
                     {"from": "B", "to": "A", "day_type": "weekday", "kind": "after_break", "leave": {"p50": "08:30"}, "join": {"p50": "10:00"}},
                     {"from": "A", "to": "B", "day_type": "sun", "leave": {"p50": "17:57"}, "join": {"p50": "18:03"}},
                     {"from": "A", "to": "B", "day_type": "weekday"}]}
    """
    var seen: SeenData { SeenData.parse(Data(Self.json.utf8))! }

    func testConstantsAndWords() {
        XCTAssertEqual(Seen.transitionPadS, 1800)
        XCTAssertEqual(Seen.startMinDays, 3)
        XCTAssertEqual(Seen.transitionText, "Transitioning to new line")
        XCTAssertEqual(Seen.towardM, 100)
        XCTAssertFalse(Seen.transitionTimes, "its badge without its times (RouteKnower E32c)")
        XCTAssertEqual(Seen.transitionMaxM, 1000)
    }

    func testParseKeepsWhatTheAppReads() {
        let s = seen
        XCTAssertEqual(s.validUntil, "2026-12-25")
        XCTAssertEqual(s.lines["A"], [SeenData.Day(dows: ["mon", "tue", "wed", "thu", "fri"], spans: "07:00-21:00", starts: [425, 960]),
                                      SeenData.Day(dows: ["sat"], spans: "09:00-17:00", starts: [])],
                       "bus slots seen under 3 days dropped")
        XCTAssertNil(s.lines["bad"])
        XCTAssertEqual(s.transitions, [SeenData.Move(from: "A", to: "B", dows: ["mon", "tue", "wed", "thu", "fri"], leave: 1077, join: 1083),
                                       SeenData.Move(from: "B", to: "A", dows: ["mon", "tue", "wed", "thu", "fri"], leave: 510, join: 600, brk: true)],
                       "transitions without a known day type or times dropped")
        XCTAssertNil(SeenData.parse(Data("{\"lines\": {}}".utf8)), "nothing usable: nil")
        XCTAssertNil(SeenData.parse(Data("x".utf8)))
    }

    func testWindowsOnlyOnTheLearnedTimetableAndBeforeValidUntil() {
        let s = seen
        XCTAssertEqual(Seen.transitionAt(s, service: service, rid: "A", t: at(17, 30)),
                       Seen.Window(kind: "transition", from: "A", to: "B", a: 1047, b: 1113), "30 min before the leave")
        XCTAssertEqual(Seen.transitionAt(s, service: service, rid: "B", t: at(18, 33))?.kind, "transition", "the new line too")
        XCTAssertNil(Seen.transitionAt(s, service: service, rid: "A", t: at(18, 34)), "past it")
        XCTAssertEqual(Seen.transitionAt(s, service: service, rid: "A", t: at(16, 20)), Seen.Window(kind: "start", from: nil, to: nil, a: 930, b: 990))
        XCTAssertNil(Seen.transitionAt(s, service: service, rid: "A", t: at(12, 10)), "a slot seen on 2 days only")
        XCTAssertNil(Seen.transitionAt(s, service: service, rid: "A", t: at(12)), "midday: none")
        var changed = service
        let d8 = ServiceDay(first: "08:00", last: "21:00", trips: 10, buses: Array(repeating: 1, count: 24))
        changed.routes["A"] = RouteService(days: Dictionary(uniqueKeysWithValues: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map { ($0, d8) }))
        XCTAssertNil(Seen.transitionAt(s, service: changed, rid: "A", t: at(17, 30)), "today's listed hours differ: off")
        var old = s
        old.validUntil = "2026-10-13"
        XCTAssertNil(Seen.transitionAt(old, service: service, rid: "A", t: at(17, 30)), "past valid_until: off")
        XCTAssertNil(Seen.transitionAt(s, service: service, rid: "A", t: at(17, 30) + 3 * 86400), "Saturday: no windows")
        XCTAssertNil(Seen.transitionAt(nil, service: service, rid: "A", t: noon), "no file: off")
        XCTAssertNil(Seen.transitionAt(s, service: service, rid: "B", t: at(9)), "after a break: not while it goes on its break")
        XCTAssertEqual(Seen.transitionAt(s, service: service, rid: "A", t: at(9, 45)), Seen.Window(kind: "transition", from: "B", to: "A", a: 570, b: 630))
    }

    func testOffRouteBusHeadingBackInsideAWindowStaysShownMarked() {
        // 1.2 km north of A heading back to it (about 280 m nearer every 15 s, then 390 m off), or parked there
        func run(_ t0: Double, _ s: SeenData?, moving: Bool = true, from p: LatLon = LatLon(lat: 41.801, lon: -87.61)) -> (hidden: [String], transitioning: [String]) {
            var tr: [String: OffRoute.Track] = [:], last: (hidden: [String], transitioning: [String]) = ([], [])
            var t = t0
            while t <= t0 + 90 {
                let lat = moving ? p.lat - 0.0025 * min(3, (t - t0) / 15) : p.lat
                let b = VehiclePosition(vehicle: .init(id: "x"), latitude: lat, longitude: p.lon, trip: .init(tripId: "t-x", routeId: "A"), timestamp: t)
                let r = OffRoute.stepMarked(tr, buses: [b], shapes: shapes, service: service, alerts: [], routes: routes, seen: s, now: t, feedTs: t)
                tr = r.tracks
                last = (r.hidden, r.transitioning)
                t += 15
            }
            return last
        }
        let a = run(at(17, 40), seen)
        XCTAssertEqual(a.hidden, [])
        XCTAssertEqual(a.transitioning, ["x"], "17:40, heading back toward its line in its usual window: shown, marked")
        XCTAssertEqual(run(at(17, 40), seen, moving: false).hidden, ["x"], "parked off its line in the window: hidden")
        XCTAssertEqual(run(at(17, 40), seen, from: garage).hidden, ["x"], "heading back but over 1 km off (transitionMaxM): hidden")
        XCTAssertEqual(run(at(12), seen).hidden, ["x"], "noon: hidden")
        XCTAssertEqual(run(at(17, 40), nil).hidden, ["x"], "without the file: hidden (E27b)")
    }

    /// The bundled web/data/service_seen.json parses (the daily schedule download carries it too).
    func testRealFileParses() {
        XCTAssertNotNil(TS.real.data.seen)
        XCTAssertFalse(TS.real.data.seen?.transitions.isEmpty ?? true)
    }
}
