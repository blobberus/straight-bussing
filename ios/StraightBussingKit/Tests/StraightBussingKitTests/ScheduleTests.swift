import XCTest
@testable import StraightBussingKit

/// Port of web/tests/route-schedule.js (fixture = web/tests/route-fixtures.js serviceFixture).
final class ScheduleTests: XCTestCase {
    let D = "\u{2013}"

    static func day(_ first: String, _ last: String, _ buses: [Int], _ spans: [[String]]? = nil) -> ServiceDay {
        ServiceDay(first: first, last: last, trips: 10, buses: buses, spans: spans ?? [[first, last]])
    }
    static func night() -> ServiceDay {
        var b = Array(repeating: 0, count: 24)
        for h in [16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4] { b[h] = h < 5 ? 1 : 2 }
        return day("16:00", "28:29", b)
    }
    static func wk() -> ServiceDay {
        var b = Array(repeating: 0, count: 24)
        for h in 7...19 { b[h] = h >= 8 && h <= 10 ? 3 : 1 }
        return day("07:00", "19:25", b)
    }
    /// N = every-night route, D = weekday day route with calendar changes.
    static let S: ServiceData = {
        let allNight = Dictionary(uniqueKeysWithValues: Schedule.dayKeys.map { ($0, night()) })
        let weekdays = Dictionary(uniqueKeysWithValues: ["mon", "tue", "wed", "thu", "fri"].map { ($0, wk()) })
        return ServiceData(feed: .init(start: "2026-10-07", end: "2026-12-31"), routes: [
            "N": RouteService(days: allNight),
            "D": RouteService(days: weekdays, exceptions: [
                ServiceException(date: "2026-10-10", type: "added", days: "sat",
                                 hours: ServiceDay(first: "10:00", last: "14:00", trips: 4, spans: [["10:00", "14:00"]])),
                ServiceException(date: "2026-11-26", type: "removed", days: "thu", hours: nil),
            ]),
            "R1": RouteService(days: weekdays),
        ])
    }()
    var S: ServiceData { Self.S }
    func utc(_ s: String) -> Double { TS.utc(s) }

    func testLocalPartsAcrossDST() {
        let a = Schedule.localParts(utc("2026-10-08T07:00:00Z"))   // 02:00 CDT Thursday
        XCTAssertEqual([a.y, a.m, a.d, a.dow, a.min], [2026, 10, 8, 3, 120])
        let b = Schedule.localParts(utc("2026-12-01T12:30:00Z"))   // 06:30 CST Tuesday
        XCTAssertEqual([b.d, b.dow, b.min], [1, 1, 390])
        let c = Schedule.localParts(utc("2026-10-09T04:59:00Z"))   // 23:59 Thursday local
        XCTAssertEqual([c.d, c.dow, c.min], [8, 3, 1439])
        XCTAssertEqual(Schedule.dayKey(utc("2026-10-11T17:00:00Z")), "sun")
    }

    func testClock12AfterMidnight() {
        XCTAssertEqual(Schedule.clock12("28:29"), "4:29 AM")
        XCTAssertEqual(Schedule.clock12("00:00"), "12:00 AM")
        XCTAssertEqual(Schedule.clock12("12:05"), "12:05 PM")
        XCTAssertEqual(Schedule.clock12("24:25"), "12:25 AM")
        XCTAssertEqual(Schedule.clock12("bad"), "")
        XCTAssertEqual([Schedule.hourLabel(0), Schedule.hourLabel(13), Schedule.hourLabel(24)], ["12 AM", "1 PM", "12 AM"])
    }

    func testHoursOnAppliesExceptions() {
        XCTAssertEqual(Schedule.hoursOn(S, "D", utc("2026-10-08T15:00:00Z"))?.label, "7:00 AM \(D) 7:25 PM")
        let sat = Schedule.hoursOn(S, "D", utc("2026-10-10T15:00:00Z"))
        XCTAssertEqual(sat?.label, "10:00 AM \(D) 2:00 PM")
        XCTAssertEqual(sat?.exception, "added")
        let hol = Schedule.hoursOn(S, "D", utc("2026-11-26T15:00:00Z"))
        XCTAssertEqual(hol?.label, "No service")
        XCTAssertEqual(hol?.exception, "removed")
        XCTAssertNil(hol?.first)
        XCTAssertEqual(Schedule.hoursOn(S, "D", utc("2026-10-11T15:00:00Z"))?.label, "No service", "regular Sunday")
        XCTAssertEqual(Schedule.hoursOn(S, "N", utc("2026-10-08T15:00:00Z"))?.label, "4:00 PM \(D) 4:29 AM")
        XCTAssertNil(Schedule.hoursOn(S, "zz", utc("2026-10-08T15:00:00Z")))
        XCTAssertNil(Schedule.hoursOn(nil, "D", 0))
    }

    func testWeekSummaryGroupsEqualDays() {
        XCTAssertEqual(Schedule.weekSummary(S, "D"), [.init(days: "Mon\(D)Fri", label: "7:00 AM \(D) 7:25 PM"), .init(days: "Sat\(D)Sun", label: "No service")])
        XCTAssertEqual(Schedule.weekSummary(S, "N"), [.init(days: "Every day", label: "4:00 PM \(D) 4:29 AM")])
        XCTAssertEqual(Schedule.weekSummary(S, "zz"), [])
    }

    func testIsScheduledNowIncludesYesterdaysTail() {
        XCTAssertEqual(Schedule.isScheduledNow(S, "N", utc("2026-10-08T07:00:00Z")), true, "2 AM Thu = Wed night service")
        XCTAssertEqual(Schedule.isScheduledNow(S, "N", utc("2026-10-08T15:00:00Z")), false, "10 AM")
        XCTAssertEqual(Schedule.isScheduledNow(S, "N", utc("2026-10-08T22:00:00Z")), true, "5 PM")
        XCTAssertEqual(Schedule.isScheduledNow(S, "D", utc("2026-10-08T15:00:00Z")), true)
        XCTAssertEqual(Schedule.isScheduledNow(S, "D", utc("2026-11-26T16:00:00Z")), false, "holiday removed")
        XCTAssertNil(Schedule.isScheduledNow(S, "zz", 0))
    }

    func testBusesByHourAndGroups() {
        let n = Schedule.busesByHour(S, "N", "mon")
        XCTAssertEqual(n.first, .init(hour: 16, buses: 2))
        XCTAssertEqual(n.last, .init(hour: 4, buses: 1))
        XCTAssertEqual(n.count, 13)
        XCTAssertEqual(Schedule.groupHours(n), [.init(from: 16, to: 24, buses: 2), .init(from: 0, to: 5, buses: 1)])
        XCTAssertEqual(Schedule.busesByHour(S, "D", "sat"), [])
        XCTAssertEqual(Schedule.groupHours(Schedule.busesByHour(S, "D", "tue")).map(\.buses), [1, 3, 1])
    }

    func testUpcomingChanges() {
        let now = utc("2026-10-08T15:00:00Z")
        XCTAssertEqual(Schedule.upcomingChanges(S, "D", now), [.init(date: "2026-10-10", label: "Sat, Oct 10", text: "Extra service: 10:00 AM \(D) 2:00 PM")])
        let far = Schedule.upcomingChanges(S, "D", now, horizonDays: 60)
        XCTAssertEqual(far.map(\.text), ["Extra service: 10:00 AM \(D) 2:00 PM", "No service"])
        XCTAssertEqual(far[1].label, "Thu, Nov 26")
        XCTAssertEqual(Schedule.upcomingChanges(S, "D", utc("2026-11-27T15:00:00Z")), [], "past changes dropped")
        XCTAssertEqual(Schedule.upcomingChanges(S, "N", now), [])
    }

    func testRealServiceJsonWellFormed() throws {
        let svc = TS.real.data.service
        XCTAssertFalse(svc.routes.isEmpty, "routes present")
        let feed = try XCTUnwrap(svc.feed)
        XCTAssertEqual(feed.start.count, 10)
        for rid in svc.routes.keys {
            for w in Schedule.weekSummary(svc, rid) {
                XCTAssertTrue(w.label == "No service" || w.label.range(of: #"\d:\d\d [AP]M \x{2013} \d"#, options: .regularExpression) != nil,
                              "\(rid) label \(w.label)")
            }
            for d in svc.routes[rid]!.days.values { XCTAssertEqual(d.buses?.count, 24, "\(rid) buses[24]") }
        }
    }
}
