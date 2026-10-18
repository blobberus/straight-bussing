import XCTest
@testable import StraightBussingKit

/// Port of web/tests/core-timeactive.js (Lines by Time, owner 2026-10-18): the same fixture and expectations.
final class TimeActiveTests: XCTestCase {
    static func day(_ spans: [[String]]) -> ServiceDay {
        ServiceDay(first: spans.first?.first, last: spans.last?.last, trips: 9, buses: Array(repeating: 1, count: 24), spans: spans)
    }
    /// N: every night 4:00 PM to 4:29 AM; D: weekdays 7:00 AM to 7:25 PM, removed on Fri Oct 23; X: no timetable.
    static let S: ServiceData = {
        let every = Dictionary(uniqueKeysWithValues: Schedule.dayKeys.map { ($0, day([["16:00", "28:29"]])) })
        let weekdays = Dictionary(uniqueKeysWithValues: ["mon", "tue", "wed", "thu", "fri"].map { ($0, day([["07:00", "19:25"]])) })
        return ServiceData(feed: .init(start: "2026-10-07", end: "2026-11-07"), routes: [
            "N": RouteService(days: every),
            "D": RouteService(days: weekdays, exceptions: [ServiceException(date: "2026-10-23", type: "removed", days: "fri", hours: nil)]),
        ])
    }()
    let ids = ["N", "D", "X"]
    func at(_ y: Int, _ m: Int, _ d: Int, _ h: Int, _ mi: Int) -> Double { TimeActive.chicagoUnix(y, m, d, h, mi) }
    func utc(_ s: String) -> Double { TS.utc(s) }
    func lines(_ t: Double) -> [String] { TimeActive.linesActiveAt(Self.S, routeIds: ids, at: t).rids }

    func testChicagoUnixAcrossDST() {
        XCTAssertEqual(at(2026, 10, 24, 21, 30), utc("2026-10-25T02:30:00Z"), "CDT is UTC-5")
        XCTAssertEqual(at(2026, 12, 1, 9, 0), utc("2026-12-01T15:00:00Z"), "CST is UTC-6")
        XCTAssertEqual(at(2026, 11, 1, 1, 30), utc("2026-11-01T06:30:00Z"), "the first 1:30 AM")
        XCTAssertEqual(at(2027, 3, 14, 3, 0), utc("2027-03-14T08:00:00Z"))
        XCTAssertEqual(at(2027, 3, 14, 2, 30), utc("2027-03-14T08:30:00Z"), "2:30 AM does not exist that night: 3:30 AM")
    }

    func testNextOccurrenceNoYear() {
        let now = at(2026, 10, 18, 12, 0)
        func occ(_ m: Int, _ d: Int, _ n: Double) -> [Int] { let o = TimeActive.nextOccurrence(m, d, now: n); return [o.y, o.m, o.d] }
        XCTAssertEqual(occ(10, 18, now), [2026, 10, 18], "today")
        XCTAssertEqual(occ(10, 17, now), [2027, 10, 17], "yesterday = next year")
        XCTAssertEqual(occ(12, 31, now), [2026, 12, 31])
        XCTAssertEqual(occ(2, 29, now), [2027, 2, 28], "2027 has no Feb 29")
        XCTAssertEqual(occ(2, 29, at(2027, 10, 1, 9, 0)), [2028, 2, 29])
        XCTAssertEqual([TimeActive.daysIn(2, 2028), TimeActive.daysIn(2, 2027), TimeActive.daysIn(4, 2026),
                        TimeActive.pickerDays(2), TimeActive.pickerDays(4), TimeActive.pickerDays(12)], [29, 28, 30, 29, 30, 31])
    }

    func testPickerValues() {
        let now = at(2026, 10, 18, 12, 0)
        XCTAssertEqual(TimeActive.values(at(2026, 10, 24, 21, 30)), .init(month: 10, day: 24, hour12: 9, minute: 30, pm: true))
        XCTAssertEqual(TimeActive.values(at(2026, 10, 24, 0, 5)), .init(month: 10, day: 24, hour12: 12, minute: 5, pm: false))
        XCTAssertEqual(TimeActive.values(at(2026, 10, 24, 12, 0)), .init(month: 10, day: 24, hour12: 12, minute: 0, pm: true))
        XCTAssertEqual(TimeActive.pickedUnix(.init(month: 10, day: 24, hour12: 9, minute: 30, pm: true), now: now), at(2026, 10, 24, 21, 30))
        XCTAssertEqual(TimeActive.pickedUnix(.init(month: 10, day: 24, hour12: 12, minute: 5, pm: false), now: now), at(2026, 10, 24, 0, 5))
        XCTAssertEqual(TimeActive.pickedUnix(.init(month: 1, day: 2, hour12: 12, minute: 0, pm: true), now: now), at(2027, 1, 2, 12, 0))
    }

    func testLinesActiveAt() {
        XCTAssertEqual(lines(at(2026, 10, 22, 10, 0)), ["D"], "Thu 10 AM")
        XCTAssertEqual(lines(at(2026, 10, 22, 17, 0)), ["N", "D"], "routes order")
        XCTAssertEqual(lines(at(2026, 10, 24, 1, 0)), ["N"], "Sat 1 AM is Friday's night service")
        XCTAssertEqual(lines(at(2026, 10, 24, 4, 29)), [], "the tail ends at 4:29 AM")
        XCTAssertEqual(lines(at(2026, 10, 23, 10, 0)), [], "removed by the calendar")
        XCTAssertEqual(lines(at(2026, 10, 25, 10, 0)), [], "Sunday morning")
        let r = TimeActive.linesActiveAt(Self.S, routeIds: ids, at: at(2026, 10, 22, 10, 0))
        XCTAssertTrue(r.known && !r.outsideFeed && r.note.isEmpty)
        let far = TimeActive.linesActiveAt(Self.S, routeIds: ids, at: at(2026, 11, 26, 10, 0))
        XCTAssertEqual(far.rids, ["D"])
        XCTAssertTrue(far.outsideFeed && far.note.contains("outside the published timetable"))
        XCTAssertFalse(TimeActive.linesActiveAt(ServiceData(), routeIds: ids, at: at(2026, 10, 22, 10, 0)).known)
        XCTAssertFalse(TimeActive.linesActiveAt(nil, routeIds: ids, at: .nan).known)
    }

    func testCopy() {
        let l = TimeActive.label(at(2026, 10, 24, 21, 30), locale: Locale(identifier: "en_US"))
        XCTAssertEqual(l.replacingOccurrences(of: "\u{202F}", with: " "), "Sat Oct 24, 9:30 PM")
        XCTAssertEqual(TimeActive.name(at(2026, 10, 24, 21, 30), locale: Locale(identifier: "en_US")), "Lines active at " + l)
        XCTAssertEqual(TimeActive.desc, "Select a time to check when certain lines will be active. Lines that are active will be made visible on the current map.")
        for s in [TimeActive.desc, TimeActive.disclaimer, TimeActive.none, TimeActive.outsideNote] {
            XCTAssertFalse(s.contains("\u{2013}") || s.contains("\u{2014}"), s)
        }
        XCTAssertTrue(TimeActive.disclaimer.contains("holidays") && TimeActive.disclaimer.contains("unofficial"))
    }

    // MARK: the temporary custom route (Custom.applyTimeView / clearTimeView / settleTimeView)

    func base(hidden: [String] = [], custom: [CustomRoute] = [], active: String? = nil, prev: [String] = []) -> RouteState {
        RouteState(routeIds: ["a", "b", "c", "d"], hiddenRoutes: hidden, customRoutes: custom, activeCustom: active, prevHidden: prev)
    }

    func testApplyTimeView() {
        var s = base(hidden: ["d"])
        s.routeFilter = RouteFilter(ids: ["a"], label: "x")
        let p = Custom.applyTimeView(s, at: 123, name: "Lines active at Sat Oct 24, 9:30 PM", rids: ["b", "c", "zz"])
        XCTAssertEqual(p.hiddenRoutes, ["a", "d"])
        XCTAssertEqual(p.timeView??.rids, ["b", "c"])
        XCTAssertEqual(p.timeView??.name, "Lines active at Sat Oct 24, 9:30 PM")
        XCTAssertEqual(p.timeView??.before, TimeView.Before(hiddenRoutes: ["d"], activeCustom: nil, prevHidden: []))
        XCTAssertEqual(p.routeFilter, .some(nil))
        XCTAssertTrue(Custom.applyTimeView(s, at: 1, name: "x", rids: ["zz"]).isEmpty, "no known line: no change")
        s.apply(p)
        let p2 = Custom.applyTimeView(s, at: 9, name: "Lines active at later", rids: ["a"])
        XCTAssertEqual(p2.timeView??.before.hiddenRoutes, ["d"], "a second time keeps the first before")
    }

    func testClearTimeViewRestoresCustomRoute() {
        let cr = [CustomRoute(id: "x", name: "X", rids: ["a"])]
        var s = base(hidden: ["b", "c", "d"], custom: cr, active: "x", prev: ["d"])
        s.apply(Custom.applyTimeView(s, at: 1, name: "Lines active at 1", rids: ["b"]))
        XCTAssertEqual([s.activeCustom ?? "nil"], ["nil"])
        XCTAssertEqual(s.hiddenRoutes, ["a", "c", "d"])
        var cleared = s
        cleared.apply(Custom.clearTimeView(cleared))
        XCTAssertNil(cleared.timeView)
        XCTAssertEqual(cleared.activeCustom, "x")
        XCTAssertEqual(cleared.hiddenRoutes, ["b", "c", "d"])
        XCTAssertEqual(cleared.prevHidden, ["d"])
        var gone = s
        gone.customRoutes = []
        gone.apply(Custom.clearTimeView(gone))
        XCTAssertNil(gone.activeCustom)
        XCTAssertEqual(gone.hiddenRoutes, ["d"], "the custom route was deleted: the routes from before it")
        XCTAssertTrue(Custom.clearTimeView(base()).isEmpty)
    }

    func testSettleTimeViewDeselectDropsTheName() {
        var s = base()
        s.apply(Custom.applyTimeView(s, at: 1, name: "Lines active at 1", rids: ["a", "b"]))
        XCTAssertTrue(Custom.settleTimeView(s).isEmpty)
        s.apply(Custom.toggleHidden(s, "b"))
        XCTAssertEqual(Custom.settleTimeView(s), StatePatch(timeView: .some(nil)))
        s.apply(Custom.settleTimeView(s))
        XCTAssertNil(s.timeView)
        XCTAssertEqual(s.hiddenRoutes, ["c", "d", "b"], "the remaining selection stays")
        XCTAssertTrue(Custom.settleTimeView(base()).isEmpty)
    }

    func testOtherActionsEndIt() {
        var s = base(hidden: ["d"])
        s.apply(Custom.applyTimeView(s, at: 1, name: "Lines active at 1", rids: ["a"]))
        for p in [Custom.showAll(s), Custom.hideAll(s), Custom.showRunning(s, operating: ["a"]), Custom.saveVisibleAsCustom(s, name: "Mine").patch] {
            XCTAssertEqual(p.timeView, .some(nil))
        }
        s.customRoutes = [CustomRoute(id: "y", name: "Y", rids: ["b"])]
        let p = Custom.applyCustom(s, "y")
        XCTAssertEqual(p.timeView, .some(nil))
        XCTAssertEqual(p.prevHidden, ["d"], "clearing Y later gives the routes from before the time")
    }
}
