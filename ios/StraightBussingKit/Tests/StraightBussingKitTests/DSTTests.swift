import XCTest
@testable import StraightBussingKit

/// Daylight saving in Chicago, pinned before it happens: fall back on Sunday Nov 1 2026 (2:00 AM CDT becomes 1:00 AM
/// CST, so 1:00 to 1:59 happen twice) and spring forward on Sunday Mar 14 2027 (2:00 AM CST becomes 3:00 AM CDT, 2:00 to
/// 2:59 never happen). The timetable is wall-clock Chicago time (service.json "HH:MM", may be >= 24:00), so schedule
/// checks follow the wall clock, while every "minutes until" stays real elapsed minutes. Fixture: ScheduleTests.S
/// (N = every night 4:00 PM to 4:29 AM, D = weekdays 7:00 AM to 7:25 PM).
final class DSTTests: XCTestCase {
    let S = ScheduleTests.S
    let ids = ["N", "D", "R1"]
    let en = Locale(identifier: "en_US")
    func utc(_ s: String) -> Double { TS.utc(s) }
    func clock(_ t: Double) -> String { TimeFmt.clock(t, locale: en).replacingOccurrences(of: "\u{202F}", with: " ") }

    // Sunday Nov 1 2026
    lazy var t0030 = utc("2026-11-01T05:30:00Z")   // 12:30 AM CDT
    lazy var t0130a = utc("2026-11-01T06:30:00Z")  // the first 1:30 AM (CDT)
    lazy var t0130b = utc("2026-11-01T07:30:00Z")  // the second 1:30 AM (CST)
    lazy var t0230 = utc("2026-11-01T08:30:00Z")   // 2:30 AM CST

    func testFallBackWallClock() {
        let mins = [t0030, t0130a, t0130b, t0230].map { Schedule.localParts($0).min }
        XCTAssertEqual(mins, [30, 90, 90, 150], "both 1:30s read 1:30 on the clock")
        for t in [t0030, t0130a, t0130b, t0230] {
            let p = Schedule.localParts(t)
            XCTAssertEqual([p.y, p.m, p.d, p.dow], [2026, 11, 1, 6], "Sunday Nov 1")
            XCTAssertEqual(Schedule.dayKey(t), "sun")
        }
        XCTAssertEqual([t0030, t0130a, t0130b, t0230].map(clock), ["12:30 AM", "1:30 AM", "1:30 AM", "2:30 AM"])
    }

    func testFallBackNightRouteIsSaturdaysService() {
        for t in [t0030, t0130a, t0130b, t0230] {
            XCTAssertEqual(Schedule.isScheduledNow(S, "N", t), true, "Saturday's night service runs until 4:29 AM")
            let sh = Schedule.serviceHoursAt(S, "N", t)
            XCTAssertEqual(sh?.yesterday, true)
            XCTAssertEqual(sh?.dayKey, "sat")
            XCTAssertEqual(sh?.hours.label, "4:00 PM to 4:29 AM")
            XCTAssertEqual(Schedule.scheduledUntil(S, "N", t), "28:29")
            XCTAssertEqual(Schedule.isScheduledNow(S, "D", t), false)
        }
        XCTAssertEqual(Schedule.isScheduledNow(S, "N", utc("2026-11-01T10:28:00Z")), true, "4:28 AM CST")
        XCTAssertEqual(Schedule.isScheduledNow(S, "N", utc("2026-11-01T10:29:00Z")), false, "4:29 AM CST: the window has ended")
        XCTAssertEqual(Schedule.restingText(S, "D", t0130b), "Not running today")
        XCTAssertEqual(Schedule.nextStartToday(S, "N", utc("2026-11-01T16:00:00Z")), "16:00", "10 AM CST: tonight from 4 PM")
    }

    func testFallBackMinutesAreRealMinutes() {
        XCTAssertEqual(TimeFmt.minsUntil(t0130b, from: t0130a), 60, "an hour passes between the two 1:30s")
        XCTAssertEqual(TimeFmt.etaLabel(t0230, now: t0030), "180 min", "the clock says 2 h, the bus is 3 h away")
        XCTAssertEqual(TimeFmt.ago(t0130a, from: t0130b), "1 h ago")
    }

    func testFallBackLinesByTime() {
        let v = TimeActive.values(t0130b)
        XCTAssertEqual(v, TimeActive.Values(month: 11, day: 1, hour12: 1, minute: 30, pm: false))
        XCTAssertEqual(TimeActive.label(t0130b, locale: en).replacingOccurrences(of: "\u{202F}", with: " "), "Sun Nov 1, 1:30 AM")
        let saturdayNoon = utc("2026-10-31T17:00:00Z")
        XCTAssertEqual(TimeActive.pickedUnix(v, now: saturdayNoon), t0130a, "a picked 1:30 AM is the first one (CDT)")
        XCTAssertEqual(TimeActive.linesActiveAt(S, routeIds: ids, at: t0130b).rids, ["N"])
        XCTAssertEqual(TimeActive.pickedUnix(TimeActive.Values(month: 11, day: 1, hour12: 2, minute: 30, pm: false), now: saturdayNoon), t0230)
    }

    func testWeekdayRouteAcrossTheChange() {
        XCTAssertEqual(Schedule.isScheduledNow(S, "D", utc("2026-10-30T12:00:00Z")), true, "Fri 7:00 AM CDT")
        XCTAssertEqual(Schedule.isScheduledNow(S, "D", utc("2026-10-30T11:59:00Z")), false, "Fri 6:59 AM CDT")
        XCTAssertEqual(Schedule.isScheduledNow(S, "D", utc("2026-11-02T13:00:00Z")), true, "Mon 7:00 AM CST")
        XCTAssertEqual(Schedule.isScheduledNow(S, "D", utc("2026-11-02T12:59:00Z")), false, "Mon 6:59 AM CST")
        XCTAssertEqual(Schedule.hoursOn(S, "D", utc("2026-11-02T13:00:00Z"))?.label, "7:00 AM to 7:25 PM")
        XCTAssertEqual(clock(utc("2026-11-02T13:00:00Z")), "7:00 AM")
    }

    func testSpringForward() {
        let a = utc("2027-03-14T07:30:00Z")   // 1:30 AM CST
        let b = utc("2027-03-14T08:30:00Z")   // 3:30 AM CDT (2:30 never happens)
        XCTAssertEqual([Schedule.localParts(a).min, Schedule.localParts(b).min], [90, 210])
        XCTAssertEqual([clock(a), clock(b)], ["1:30 AM", "3:30 AM"])
        XCTAssertEqual(TimeFmt.minsUntil(b, from: a), 60, "the clock jumps 2 h, an hour passes")
        XCTAssertEqual(Schedule.isScheduledNow(S, "N", a), true)
        XCTAssertEqual(Schedule.isScheduledNow(S, "N", b), true, "Saturday's service still runs at 3:30 AM")
        XCTAssertEqual(Schedule.serviceHoursAt(S, "N", b)?.dayKey, "sat")
        XCTAssertEqual(TimeActive.values(b), TimeActive.Values(month: 3, day: 14, hour12: 3, minute: 30, pm: false))
        // Monday Mar 15 2027 (CDT)
        XCTAssertEqual(Schedule.isScheduledNow(S, "D", utc("2027-03-15T12:00:00Z")), true, "7:00 AM CDT")
        XCTAssertEqual(Schedule.isScheduledNow(S, "D", utc("2027-03-15T11:59:00Z")), false, "6:59 AM CDT")
        XCTAssertEqual(Schedule.nextStartToday(S, "D", utc("2027-03-15T11:00:00Z")), "07:00", "6:00 AM CDT")
    }
}
