import XCTest
@testable import StraightBussingKit

/// Port of web/tests/map-linetap.js (the pure hit test) and the closed-route rule of web/tests/route-view.js
/// (owner 2026-10-27).
final class LineTapTests: XCTestCase {
    func v(_ x: Double, _ y: Double) -> SIMD2<Double> { SIMD2(x, y) }

    func testSegDist() {
        XCTAssertEqual(LineTap.segDist(v(5, 3), v(0, 0), v(10, 0)), 3, accuracy: 1e-9)
        XCTAssertEqual(LineTap.segDist(v(13, 4), v(0, 0), v(10, 0)), 5, accuracy: 1e-9, "past the end: the end point")
        XCTAssertEqual(LineTap.segDist(v(3, 4), v(0, 0), v(0, 0)), 5, accuracy: 1e-9, "a point segment")
    }

    func testTopmostWithinReachWins() {
        let lines = [LineTap.Line(rid: "low", px: [v(0, 0), v(100, 0)], width: 6),
                     LineTap.Line(rid: "top", px: [v(0, 10), v(100, 10)], width: 6)]
        XCTAssertEqual(LineTap.lineAt(v(50, 1), lines: lines), "top", "within 14 + 3 of the top line: it wins over the closer one")
        XCTAssertEqual(LineTap.lineAt(v(50, -16), lines: lines), "low")
        XCTAssertNil(LineTap.lineAt(v(50, -40), lines: lines))
        XCTAssertEqual(LineTap.lineAt(v(50, 10 + LineTap.reach + 3), lines: lines), "top", "exactly at the reach")
        XCTAssertNil(LineTap.lineAt(v(50, 10 + LineTap.reach + 3.5), lines: lines), "just beyond")
        XCTAssertNil(LineTap.lineAt(v(50, 26), lines: [LineTap.Line(rid: "w", px: [v(0, 10), v(100, 10)], width: 6)], reach: 4))
    }

    func testOddInput() {
        XCTAssertNil(LineTap.lineAt(v(0, 0), lines: []))
        XCTAssertNil(LineTap.lineAt(v(0, 0), lines: [LineTap.Line(rid: "e", px: [], width: 5)]))
        XCTAssertEqual(LineTap.lineAt(v(1, 1), lines: [LineTap.Line(rid: "7", px: [v(0, 0)], width: 0)]), "7", "a one-point line is its point")
    }

    /// web route-view.js: R1 runs weekdays 7:00 AM to 7:25 PM (ScheduleTests fixture).
    func testRouteClosed() {
        let S = ScheduleTests.S
        let wed10am = TS.utc("2026-10-14T15:00:00Z"), wed10pm = TS.utc("2026-10-15T03:00:00Z")
        XCTAssertTrue(RouteText.closed(running: 0, service: S, rid: "R1", now: wed10pm), "no bus, not scheduled")
        XCTAssertFalse(RouteText.closed(running: 0, service: S, rid: "R1", now: wed10am), "scheduled, silent: open")
        XCTAssertFalse(RouteText.closed(running: 1, service: S, rid: "R1", now: wed10pm), "a bus outside the timetable: open")
        XCTAssertFalse(RouteText.closed(running: 1, service: S, rid: "R1", now: wed10am))
        XCTAssertTrue(RouteText.closed(running: 0, service: nil, rid: "R1", now: wed10am), "no schedule data and no bus")
        XCTAssertFalse(RouteText.closed(running: 0, service: S, rid: "R1", now: TS.utc("2026-10-15T00:20:00Z")), "7:20 PM: still on")
        XCTAssertTrue(RouteText.closed(running: 0, service: S, rid: "R1", now: TS.utc("2026-10-15T00:30:00Z")), "7:30 PM: closed")
    }
}
