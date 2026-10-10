import XCTest
@testable import StraightBussingKit

/// Port of the silent-service tests in web/tests/core-operating.js (rider safety, 2026-10-10): a fresh feed
/// with no vehicles while the schedule has routes in service is never "no shuttles running".
final class SilentServiceTests: XCTestCase {
    // Thu 2026-10-08 00:20 Chicago (CDT): the NIGHT route's after-midnight tail; DAY ended at 21:00.
    let NOW = 1791427200.0 + 2 * 3600 + 40 * 60
    let ids = ["DAY", "NIGHT", "X"]   // X has no schedule data

    static func day(_ f: String, _ l: String) -> ServiceDay {
        ServiceDay(first: f, last: l, trips: 10, buses: Array(repeating: 1, count: 24))
    }
    static func week(_ d: ServiceDay) -> RouteService {
        RouteService(days: Dictionary(uniqueKeysWithValues: Schedule.dayKeys.map { ($0, d) }))
    }
    var service: ServiceData {
        ServiceData(routes: ["DAY": Self.week(Self.day("07:00", "21:00")), "NIGHT": Self.week(Self.day("16:00", "28:29"))])
    }
    func bus(_ rid: String) -> VehiclePosition { .on(rid, id: "b-" + rid, trip: "t-" + rid, ts: NOW) }

    func testScheduledRoutesAndSilentService() {
        XCTAssertEqual(Operating.scheduledRoutes(ids, service: service, now: NOW), ["NIGHT"], "DAY ended; X has no data")
        XCTAssertEqual(Operating.scheduledRoutes(ids, service: service, now: NOW, hidden: ["NIGHT"]), [])
        XCTAssertEqual(Operating.scheduledRoutes(ids, service: service, now: NOW, among: ["DAY", "NIGHT"]), ["NIGHT"])
        XCTAssertTrue(Operating.silentService(loaded: true, buses: [], level: .fresh, routeIds: ids, service: service, now: NOW))
        XCTAssertTrue(Operating.silentService(loaded: true, buses: [], level: .late, routeIds: ids, service: service, now: NOW), "delayed feed")
        XCTAssertFalse(Operating.silentService(loaded: true, buses: [bus("NIGHT")], level: .fresh, routeIds: ids, service: service, now: NOW),
                       "a bus is reporting")
        XCTAssertFalse(Operating.silentService(loaded: true, buses: [], level: .err, routeIds: ids, service: service, now: NOW),
                       "feed outage has its own wording")
        XCTAssertFalse(Operating.silentService(loaded: false, buses: [], level: .fresh, routeIds: ids, service: service, now: NOW),
                       "first poll pending")
        XCTAssertFalse(Operating.silentService(loaded: true, buses: [], level: .fresh, routeIds: ids, service: service, now: NOW + 5 * 3600),
                       "5:20 AM: nothing scheduled = honestly no service")
    }

    func testPerRouteStatus() {
        XCTAssertTrue(Operating.scheduledNoLive("NIGHT", buses: [], service: service, now: NOW))
        XCTAssertFalse(Operating.scheduledNoLive("NIGHT", buses: [bus("NIGHT")], service: service, now: NOW), "has a bus")
        XCTAssertFalse(Operating.scheduledNoLive("DAY", buses: [], service: service, now: NOW), "not scheduled now")
        XCTAssertFalse(Operating.scheduledNoLive("X", buses: [], service: service, now: NOW), "no schedule data")
        XCTAssertEqual(Operating.noLiveStatus("NIGHT", buses: [], service: service, now: NOW), "Scheduled until 4:29 AM, no live location")
        XCTAssertNil(Operating.noLiveStatus("DAY", buses: [], service: service, now: NOW))
        XCTAssertEqual(Schedule.scheduledUntil(service, "NIGHT", NOW), "28:29")
        XCTAssertNil(Schedule.scheduledUntil(service, "DAY", NOW))
        XCTAssertNil(Schedule.scheduledUntil(service, "X", NOW))
    }

    func testScheduledUntilMatchesWeb() {
        // web/tests/route-schedule.js "scheduledUntil" (ScheduleTests.S = web serviceFixture)
        let S = ScheduleTests.S
        XCTAssertEqual(Schedule.scheduledUntil(S, "N", TS.utc("2026-10-08T07:00:00Z")), "28:29", "2 AM Thu: Wed night service")
        XCTAssertEqual(Schedule.scheduledUntil(S, "N", TS.utc("2026-10-08T22:00:00Z")).map { Schedule.clock12($0) }, "4:29 AM")
        XCTAssertEqual(Schedule.scheduledUntil(S, "D", TS.utc("2026-10-08T15:00:00Z")), "19:25")
        XCTAssertEqual(Schedule.scheduledUntil(S, "D", TS.utc("2026-10-10T16:00:00Z")), "14:00", "added Saturday service")
        XCTAssertNil(Schedule.scheduledUntil(S, "N", TS.utc("2026-10-08T15:00:00Z")), "10 AM")
        XCTAssertNil(Schedule.scheduledUntil(S, "D", TS.utc("2026-11-26T16:00:00Z")), "holiday removed")
    }

    func testSilentTextNamesRoutesEndTimesAndPhone() {
        let routes = ["N1": Route(id: "N1", long: "North"), "S1": Route(id: "S1", long: "South"),
                      "E1": Route(id: "E1", long: "East"), "M": Route(id: "M", short: "M")]
        let svc = ServiceData(routes: ["N1": Self.week(Self.day("16:00", "28:29")), "S1": Self.week(Self.day("16:00", "28:25")),
                                       "E1": Self.week(Self.day("16:00", "28:29")), "M": Self.week(Self.day("16:00", "28:29"))])
        XCTAssertEqual(Operating.silentText(["N1"], routes: routes, service: svc, now: NOW, phone: "773.702.8181"),
                       "The schedule shows the North route in service until 4:29 AM, but no bus is sending its location, so we can't confirm it's running. Call 773.702.8181 before you rely on it.")
        XCTAssertEqual(Operating.silentText(["N1", "S1", "E1"], routes: routes, service: svc, now: NOW, phone: "773.702.8181"),
                       "The schedule shows the North and East routes in service until 4:29 AM and the South route until 4:25 AM, but no bus is sending its location, so we can't confirm they're running. Call 773.702.8181 before you rely on them.")
        XCTAssertEqual(Operating.silentText(["N1", "S1", "E1", "M"], routes: routes, service: svc, now: NOW),
                       "The schedule shows 4 routes in service now, but no bus is sending its location, so we can't confirm they're running.")
        XCTAssertEqual(Operating.silentText([], routes: routes, service: svc, now: NOW),
                       "Some hidden routes are scheduled now, but no bus is sending its location, so we can't confirm they're running.")
    }
}
