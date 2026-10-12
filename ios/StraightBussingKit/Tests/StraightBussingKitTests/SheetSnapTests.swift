import XCTest
@testable import StraightBussingKit

/// Bottom sheet release (owner spec 2026-10-12): two resting states; the release goes the way the finger last moved
/// (up = expanded, down = collapsed), a finger that stopped keeps the direction of its last movement of at least 2 pt,
/// and no movement at all is a tap. Screen y grows downward.
final class SheetSnapTests: XCTestCase {
    func motion(_ ys: [Double]) -> SheetMotion {
        var m = SheetMotion()
        m.begin(at: ys[0])
        for y in ys.dropFirst() { m.track(y) }
        return m
    }

    func testUpExpandsDownCollapses() {
        XCTAssertEqual(motion([600, 560, 480, 300]).outcome, .expand)
        XCTAssertEqual(motion([200, 260, 400, 640]).outcome, .collapse)
    }

    func testTheLastMotionWinsNotTheTotal() {
        // dragged far up, then a small pull back down before letting go: collapses
        XCTAssertEqual(motion([700, 500, 300, 304]).outcome, .collapse)
        // dragged far down, then back up a little: expands
        XCTAssertEqual(motion([200, 450, 600, 590]).outcome, .expand)
    }

    func testAFingerThatStoppedKeepsItsLastDirection() {
        // moved up, then held still with sub-2 pt jitter: still up
        XCTAssertEqual(motion([600, 520, 519, 520.5, 519.5]).outcome, .expand)
        XCTAssertEqual(motion([300, 380, 381, 379.8]).outcome, .collapse)
    }

    func testJitterBelowTwoPointsDoesNotCount() {
        XCTAssertEqual(motion([400, 401, 399.5, 400.9]).outcome, .tap)
        XCTAssertEqual(motion([400, 401.9]).outcome, .tap)
        XCTAssertEqual(motion([400, 402]).outcome, .collapse, "2 pt is a movement")
        // small steps add up from the last counted point: 1 + 1 = 2 pt down
        XCTAssertEqual(motion([400, 401, 402]).outcome, .collapse)
    }

    func testNoMovementIsATap() {
        XCTAssertEqual(motion([500]).outcome, .tap)
        XCTAssertEqual(SheetMotion().outcome, .tap)
        XCTAssertEqual(SheetMotion.minStep, 2)
    }

    func testRubberBandPastTheEnds() {
        XCTAssertEqual(SheetSnap.rubberBand(400, min: 88, max: 730), 400)
        XCTAssertEqual(SheetSnap.rubberBand(830, min: 88, max: 730), 760, accuracy: 0.001)
        XCTAssertEqual(SheetSnap.rubberBand(38, min: 88, max: 730), 73, accuracy: 0.001)
    }

    func testInitialVelocityMatchesTheFinger() {
        // 642 pt left to shrink (730 -> 88), finger at 1926 pt/s down: 3 "distances" per second
        XCTAssertEqual(SheetSnap.initialVelocity(visible: 730, target: 88, velocityDown: 1926), 3, accuracy: 0.001)
        XCTAssertEqual(SheetSnap.initialVelocity(visible: 400, target: 730, velocityDown: 500), 0, "moving away: start from rest")
        XCTAssertEqual(SheetSnap.initialVelocity(visible: 89, target: 88, velocityDown: 9000), 12, "capped")
        XCTAssertEqual(SheetSnap.initialVelocity(visible: 730, target: 730, velocityDown: -900), 0)
    }
}
