import XCTest
@testable import StraightBussingKit

/// Schedule by hour (owner 2026-11-09: "Every 30 minutes between x times"): port of the "headways" and "scheduleDay"
/// cases in web/tests/route-schedule.js, plus the shared golden file (Fixtures/headways_golden.json = a copy of
/// web/tests/fixtures/headways_golden.json, made from the web's answers).
final class HeadwayTests: XCTestCase {
    static func rep(_ gap: Int, _ n: Int) -> [Int] { Array(repeating: gap, count: n) }
    static func day(_ first: String, _ last: String, _ buses: [Int], dep: [Int]?) -> ServiceDay {
        ServiceDay(first: first, last: last, trips: 10, buses: buses, spans: [[first, last]], dep: dep)
    }
    /// web/tests/route-fixtures.js: North's every 15 min 4 to 11 PM then every 30 min to 4 AM; the 53rd Street Express
    /// pattern on weekdays; an extra Saturday every 20 min; Thanksgiving off.
    static let S: ServiceData = {
        var nb = Array(repeating: 0, count: 24), wb = Array(repeating: 0, count: 24)
        for h in [16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4] { nb[h] = h < 5 ? 1 : 2 }
        for h in 7...19 { wb[h] = h >= 8 && h <= 10 ? 3 : 1 }
        let night = day("16:00", "28:29", nb, dep: [960] + rep(15, 28) + rep(30, 10))
        let wk = day("07:00", "19:25", wb, dep: [420, 30, 30] + rep(15, 10) + rep(30, 15) + [60])
        let allNight = Dictionary(uniqueKeysWithValues: Schedule.dayKeys.map { ($0, night) })
        let weekdays = Dictionary(uniqueKeysWithValues: ["mon", "tue", "wed", "thu", "fri"].map { ($0, wk) })
        return ServiceData(routes: [
            "N": RouteService(days: allNight),
            "D": RouteService(days: weekdays, exceptions: [
                ServiceException(date: "2026-10-10", type: "added", days: "sat",
                                 hours: ServiceDay(first: "10:00", last: "14:00", trips: 4, spans: [["10:00", "14:00"]], dep: [600] + rep(20, 12))),
                ServiceException(date: "2026-11-26", type: "removed", days: "thu", hours: nil),
            ]),
            "R1": RouteService(days: weekdays, at: "S2"),
        ])
    }()
    func utc(_ s: String) -> Double { TS.utc(s) }
    func every(_ from: Int, _ gap: Int, _ n: Int) -> [Int] { (0..<n).map { from + gap * $0 } }
    func lines(_ deps: [Int], _ clock: (Int) -> String = Schedule.clockMin) -> [String] {
        Schedule.hourlyHeadways(deps).map { let l = Schedule.headwayLine($0, clock: clock); return "\(l.text), \(l.when)" }
    }

    func testAConstantTimetableIsOneLine() {
        XCTAssertEqual(Schedule.hourlyHeadways(every(420, 30, 7)), [.init(kind: .every, from: 420, to: 600, min: 30)])
        XCTAssertEqual(lines(every(420, 30, 7)), ["Every 30 min, 7:00 to 10:00 AM"])
        XCTAssertEqual(lines(every(390, 25, 38)), ["Every 25 min, 6:30 AM to 9:55 PM"])
        XCTAssertEqual(lines(every(1080, 60, 7)), ["Every 60 min, 6:00 PM to 12:00 AM"], "hourly is not a break")
    }

    func testAChangeOfPaceStartsANewLine() {
        XCTAssertEqual(lines(every(600, 15, 20) + every(900, 10, 58)), ["Every 15 min, 10:00 AM to 3:00 PM", "Every 10 min, 3:00 PM to 12:30 AM"])
        let x53 = Schedule.departures(ServiceDay(dep: [420, 30, 30] + Self.rep(15, 10) + Self.rep(30, 15) + [60]))
        XCTAssertEqual(lines(x53), ["Every 30 min, 7:00 to 8:00 AM", "Every 15 min, 8:00 to 10:30 AM", "Every 30 min, 10:30 AM to 6:00 PM", "1 trip, 7:00 PM"])
        XCTAssertEqual(lines(every(420, 15, 5) + [502] + every(532, 30, 4)), ["Every 15 min, 7:00 to 8:00 AM", "Every 30 min, 8:22 to 10:22 AM"])
        XCTAssertEqual(lines(every(420, 10, 6) + [481] + every(511, 30, 4)), ["Every 10 min, 7:00 to 8:01 AM", "Every 30 min, 8:01 to 10:01 AM"])
        XCTAssertEqual(lines([420, 429, 439, 448, 458, 468, 479, 489, 500]), ["Every 10 min, 7:00 to 8:20 AM"])
    }

    func testUnevenGapsReadAboutEveryHourByHour() {
        var red = [390, 397]
        for t in stride(from: 413, through: 657, by: 20) { red += [t, t + 4] }
        XCTAssertEqual(lines(red), ["About every 10 min, 6:30 to 10:57 AM"])
        let mid = Schedule.departures(ServiceDay(dep: [341, 10, 11, 9, 12, 8, 13, 7, 14, 6, 15, 5, 16, 4, 18, 2, 19, 1, 20, 20, 1, 19, 2, 18, 3]))
        XCTAssertEqual(lines(mid), ["About every 11 min, 5:41 to 9:54 AM"], "10.5 min on average")
        XCTAssertEqual(lines([600, 610, 610, 620, 630]), ["Every 10 min, 10:00 to 10:30 AM"], "two trips at the same minute count once")
        XCTAssertEqual(lines([600, 612, 632, 652]), ["About every 17 min, 10:00 to 10:52 AM"], "17.3 min average")
        XCTAssertEqual(lines([600, 615, 635, 655]), ["About every 20 min, 10:00 to 10:55 AM"], "18.3 min average")
        XCTAssertEqual(lines([600, 612, 632, 652, 664, 684, 704]), ["About every 16 min, 10:00 to 11:04 AM", "About every 20 min, 11:04 to 11:44 AM"])
        XCTAssertEqual(lines([600, 603, 609, 612, 618, 621, 627]), ["About every 5 min, 10:00 to 10:27 AM"])
        XCTAssertEqual(lines([600, 602, 606, 608, 612, 614, 618]), ["About every 3 min, 10:00 to 10:18 AM"])
    }

    func testTidyNeighboursOfTheSamePaceReadAsOneLine() {
        XCTAssertEqual(lines([600, 604, 620, 624, 640, 644] + every(660, 10, 11)), ["About every 10 min, 10:00 AM to 12:40 PM"])
        XCTAssertEqual(lines(every(420, 10, 10) + every(517, 10, 10)), ["Every 10 min, 7:00 to 10:07 AM"])
        XCTAssertEqual(lines(every(420, 10, 10) + every(530, 10, 10)), ["About every 11 min, 7:00 to 10:20 AM"], "a hole of twice the pace is not hidden")
        XCTAssertEqual(lines([600, 606, 624, 630, 648, 654] + every(672, 10, 8)), ["About every 11 min, 10:00 AM to 12:22 PM"])
        XCTAssertEqual(lines(every(600, 10, 7) + every(673, 13, 7)), ["Every 10 min, 10:00 to 11:00 AM", "Every 13 min, 11:00 AM to 12:31 PM"])
    }

    func testTidyABurstJoinsAndAtMostSixLines() {
        XCTAssertEqual(lines(every(600, 10, 7) + [665, 670, 675, 680] + every(690, 10, 10)), ["About every 9 min, 10:00 AM to 1:00 PM"])
        var alt: [Int] = [], t = 300
        for k in 0..<8 { let gap = k % 2 == 1 ? 30 : 10; for _ in 0..<(k % 2 == 1 ? 4 : 10) { alt.append(t); t += gap } }
        alt.append(t)
        let out = Schedule.hourlyHeadways(alt)
        XCTAssertLessThanOrEqual(out.filter { $0.kind == .every || $0.kind == .about }.count, 6)
        XCTAssertEqual([out.first?.from, out.last?.to], [300, t], "the whole stretch is still covered")
        XCTAssertEqual(lines([360] + every(397, 20, 6)).first, "1 trip, 6:00 AM")
    }

    func testSingleTripsTwoTripsAndBreaks() {
        XCTAssertEqual(lines([1380]), ["1 trip, 11:00 PM"])
        XCTAssertEqual(lines([1380, 1420]), ["2 trips, 11:00 and 11:40 PM"])
        XCTAssertEqual(lines([690, 760]), ["2 trips, 11:30 AM and 12:40 PM"])
        XCTAssertEqual(lines([1380, 1410, 1440]), ["Every 30 min, 11:00 PM to 12:00 AM"])
        XCTAssertEqual(lines([1380, 1420, 1445]), ["About every 35 min, 11:00 PM to 12:05 AM"])
        XCTAssertEqual(lines(every(341, 10, 26) + every(941, 10, 19)), ["Every 10 min, 5:41 to 9:51 AM", "No service, 9:51 AM to 3:41 PM", "Every 10 min, 3:41 to 6:41 PM"])
        XCTAssertEqual(Schedule.headwayBreakMin, 90)
        XCTAssertEqual(lines([600, 689]).count, 1)
        XCTAssertEqual(lines([600, 690]), ["1 trip, 10:00 AM", "No service, 10:00 to 11:30 AM", "1 trip, 11:30 AM"])
        XCTAssertEqual(lines([360] + every(397, 20, 6)), ["1 trip, 6:00 AM", "Every 20 min, 6:37 to 8:17 AM"])
    }

    func testAfterMidnightTheNightRouteKeepsItsServiceDay() {
        let north = Schedule.departures(Self.S.routes["N"]!.days["mon"]!)
        XCTAssertEqual([north.first, north.last], [960, 1680])
        XCTAssertEqual(lines(north), ["Every 15 min, 4:00 to 11:00 PM", "Every 30 min, 11:00 PM to 4:00 AM"])
        XCTAssertEqual(lines(every(1410, 30, 4)), ["Every 30 min, 11:30 PM to 1:00 AM"])
        XCTAssertEqual([Schedule.clockMin(1470), Schedule.clockMin(0), Schedule.clockMin(720), Schedule.clockMin(-30)], ["12:30 AM", "12:00 AM", "12:00 PM", "11:30 PM"])
    }

    func testDeparturesDecodeAndJunk() throws {
        XCTAssertEqual(Schedule.departures(ServiceDay(dep: [420, 30, 30])), [420, 450, 480])
        XCTAssertEqual(Schedule.departures(ServiceDay(dep: [0, 15])), [0, 15])
        XCTAssertEqual(Schedule.departures(ServiceDay(dep: [420, -5])), [])
        XCTAssertEqual(Schedule.departures(ServiceDay(dep: [420, 9999])), [])
        XCTAssertEqual(Schedule.departures(ServiceDay()), [])
        XCTAssertEqual(Schedule.departures(nil), [])
        XCTAssertEqual(Schedule.hourlyHeadways([450, 420, 480, 480, -3, 510]), Schedule.hourlyHeadways([420, 450, 480, 510]))
        XCTAssertEqual(Schedule.hourlyHeadways([]), [])
        // junk in service.json never costs the day its hours: dep alone decodes to nil
        let json = #"{"days":{"mon":{"first":"07:00","last":"19:25","spans":[["07:00","19:25"]],"dep":[420,"x",2.5]}},"exceptions":[],"at":"S2"}"#
        let r = try JSONDecoder().decode(RouteService.self, from: Data(json.utf8))
        XCTAssertEqual(r.days["mon"]?.first, "07:00")
        XCTAssertNil(r.days["mon"]?.dep)
        XCTAssertEqual(r.at, "S2")
        let ok = try JSONDecoder().decode(RouteService.self, from: Data(#"{"days":{"mon":{"first":"07:00","last":"08:00","dep":[420,30]}},"at":""}"#.utf8))
        XCTAssertEqual(ok.days["mon"]?.dep, [420, 30])
        XCTAssertNil(ok.at, "an empty reference stop is none")
    }

    func testWordsForVoiceOverAndThe12Or24HourClock() {
        let seg = Schedule.Headway(kind: .every, from: 420, to: 600, min: 30)
        XCTAssertEqual(Schedule.headwayLine(seg), .init(text: "Every 30 min", when: "7:00 to 10:00 AM", say: "Every 30 minutes, 7:00 to 10:00 AM"))
        XCTAssertEqual(Schedule.headwayLine(.init(kind: .about, from: 600, to: 610, min: 1)).say, "About every 1 minute, 10:00 to 10:10 AM")
        XCTAssertEqual(Schedule.headwayLine(.init(kind: .trips, from: 1380, to: 1380, n: 1)), .init(text: "1 trip", when: "11:00 PM", say: "1 trip, 11:00 PM"))
        XCTAssertEqual(Schedule.headwayLine(.init(kind: .none, from: 594, to: 941)).say, "No service, 9:54 AM to 3:41 PM")
        let h24: (Int) -> String = { String(format: "%02d:%02d", ($0 / 60) % 24, $0 % 60) }
        XCTAssertEqual(Schedule.headwayLine(seg, clock: h24).when, "07:00 to 10:00", "24-hour clocks have no AM / PM to share")
        let nnbsp: (Int) -> String = { Schedule.clockMin($0).replacingOccurrences(of: " ", with: "\u{202F}") }
        XCTAssertEqual(Schedule.headwayLine(seg, clock: nnbsp).when, "7:00 to 10:00\u{202F}AM")
        // the app's clock: the device's 12 / 24 hour style, never shifted by a zone or daylight saving
        let us = TimeFmt.clockOfDay(420, locale: Locale(identifier: "en_US"))
        XCTAssertTrue(us.hasPrefix("7:00") && us.hasSuffix("AM"), us)
        XCTAssertEqual(TimeFmt.clockOfDay(1170, locale: Locale(identifier: "en_GB")), "19:30")
        XCTAssertEqual(TimeFmt.clockOfDay(1470, locale: Locale(identifier: "en_US")), TimeFmt.clockOfDay(30, locale: Locale(identifier: "en_US")))
    }

    func testScheduleDayIsTheServiceDayWithCalendarChanges() throws {
        let S = Self.S
        let wed = try XCTUnwrap(Schedule.scheduleDay(S, "D", utc("2026-10-14T15:00:00Z")))   // Wed 10 AM
        XCTAssertEqual([wed.key, "\(wed.today)", "\(wed.yesterday)"], ["wed", "true", "false"]); XCTAssertNil(wed.exception)
        let night = try XCTUnwrap(Schedule.scheduleDay(S, "N", utc("2026-10-08T07:00:00Z")))   // Thu 2 AM = Wednesday's
        XCTAssertEqual([night.key, "\(night.today)", "\(night.yesterday)"], ["wed", "true", "true"])
        let extra = try XCTUnwrap(Schedule.scheduleDay(S, "D", utc("2026-10-10T15:00:00Z")))
        XCTAssertEqual([extra.key, "\(extra.today)", extra.exception ?? ""], ["sat", "true", "added"])
        XCTAssertEqual(lines(Schedule.departures(extra.day)), ["Every 20 min, 10:00 AM to 2:00 PM"])
        XCTAssertEqual(Schedule.hourBuses(extra.day), [], "no bus counts for that day: no bars")
        let hol = try XCTUnwrap(Schedule.scheduleDay(S, "D", utc("2026-11-26T16:00:00Z")))   // Thanksgiving off
        XCTAssertEqual([hol.key, "\(hol.today)"], ["thu", "false"]); XCTAssertNil(hol.exception)
        let sun = try XCTUnwrap(Schedule.scheduleDay(S, "D", utc("2026-10-11T15:00:00Z")))
        XCTAssertEqual([sun.key, "\(sun.today)"], ["mon", "false"])
        XCTAssertEqual(Schedule.hourBuses(sun.day), Schedule.busesByHour(S, "D", "mon"))
        XCTAssertNil(Schedule.scheduleDay(S, "zz", 0))
        XCTAssertNil(Schedule.scheduleDay(ServiceData(routes: ["E": RouteService(days: [:])]), "E", 0))
    }

    func testRouteTextHeadwaysForTheRoutePage() throws {
        let stops = ["S2": Stop(id: "S2", name: "Library", lat: 41.792, lon: -87.6)]
        let h = try XCTUnwrap(RouteText.headways(Self.S, rid: "R1", now: utc("2026-10-14T15:00:00Z"), stops: stops, clock: Schedule.clockMin))
        XCTAssertEqual(h.when, "today")
        XCTAssertEqual(h.lines.map(\.say), ["Every 30 minutes, 7:00 to 8:00 AM", "Every 15 minutes, 8:00 to 10:30 AM", "Every 30 minutes, 10:30 AM to 6:00 PM", "1 trip, 7:00 PM"])
        XCTAssertEqual(h.note, "Timetable only, times at Library. Buses often don't keep to this schedule, so go by the live times when buses are running.")
        XCTAssertEqual(RouteText.headwayNote(nil), "Timetable only. Buses often don't keep to this schedule, so go by the live times when buses are running.")
        XCTAssertEqual(RouteText.headways(Self.S, rid: "D", now: utc("2026-11-26T16:00:00Z"), stops: stops)?.when, "Thursdays")
        XCTAssertEqual(RouteText.headways(Self.S, rid: "N", now: utc("2026-10-08T07:00:00Z"), stops: stops)?.when, "Wednesday")
        XCTAssertEqual(RouteText.busesChart(Self.S, rid: "D", now: utc("2026-11-26T16:00:00Z"))?.when, "Thursdays", "the bars show the same day")
        var old = Self.S
        old.routes["R1"]?.days["wed"]?.dep = nil   // a schedule file from before dep
        XCTAssertNil(RouteText.headways(old, rid: "R1", now: utc("2026-10-14T15:00:00Z"), stops: stops))
        XCTAssertNotNil(RouteText.busesChart(old, rid: "R1", now: utc("2026-10-14T15:00:00Z")), "the bars still show")
    }

    func testSharedGoldenFileMatchesTheWeb() throws {
        struct Case: Decodable { let name: String; let dep: [Int]?; let deps: [Int]; let segs: [Schedule.Headway]; let lines: [Schedule.HeadwayLine] }
        struct Golden: Decodable { let cases: [Case] }
        let g = try JSONDecoder().decode(Golden.self, from: TS.fixture("headways_golden"))
        XCTAssertGreaterThan(g.cases.count, 20)
        for c in g.cases {
            if let dep = c.dep { XCTAssertEqual(Schedule.departures(ServiceDay(dep: dep)), c.deps, c.name) }
            let segs = Schedule.hourlyHeadways(c.deps)
            XCTAssertEqual(segs, c.segs, c.name)
            XCTAssertEqual(segs.map { Schedule.headwayLine($0) }, c.lines, c.name)
        }
    }

    func testRealServiceJsonCarriesDepartures() {
        let svc = TS.real.data.service
        var n = 0
        for (rid, r) in svc.routes {
            if let at = r.at { XCTAssertNotNil(TS.real.data.stops[at], "\(rid) reference stop") }
            for d in r.days.values where d.dep != nil {
                XCTAssertFalse(Schedule.hourlyHeadways(Schedule.departures(d)).isEmpty, rid)
                n += 1
            }
        }
        XCTAssertGreaterThan(n, 0)
    }
}
