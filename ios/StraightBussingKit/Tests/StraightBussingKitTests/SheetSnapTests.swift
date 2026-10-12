import XCTest
@testable import StraightBussingKit

/// Bottom sheet release (owner request 2026-10-12, Google-Maps-like): slow drags settle at the nearest detent, a
/// quick flick goes all the way (full -> peek collapses entirely), any flick moves at least one detent in its
/// direction and never against it. Heights of a 6.1-inch iPhone (BottomSheet.height): peek 132, half 350, full 730.
final class SheetSnapTests: XCTestCase {
    let H = [132.0, 350.0, 730.0]

    func testProjectionIsUIScrollViewDeceleration() {
        XCTAssertEqual(SheetSnap.projectionSeconds, 0.499, accuracy: 0.0005)
        XCTAssertEqual(SheetSnap.project(visible: 730, velocityDown: 1000), 730 - 499, accuracy: 0.5)
    }

    func testSlowDragSettlesAtTheNearest() {
        XCTAssertEqual(SheetSnap.target(heights: H, visible: 560, velocityDown: 0), 2)   // nearer full
        XCTAssertEqual(SheetSnap.target(heights: H, visible: 500, velocityDown: 0), 1)   // nearer half
        XCTAssertEqual(SheetSnap.target(heights: H, visible: 200, velocityDown: 0), 0)
        XCTAssertEqual(SheetSnap.target(heights: H, visible: 350, velocityDown: 150), 1, "a slow drift stays put")
    }

    func testQuickFlickGoesAllTheWay() {
        XCTAssertEqual(SheetSnap.target(heights: H, visible: 700, velocityDown: 1600), 0, "full -> peek: collapses entirely")
        XCTAssertEqual(SheetSnap.target(heights: H, visible: 150, velocityDown: -1600), 2, "peek -> full")
    }

    func testModerateFlickGoesOneDetent() {
        XCTAssertEqual(SheetSnap.target(heights: H, visible: 720, velocityDown: 600), 1, "full -> half")
        XCTAssertEqual(SheetSnap.target(heights: H, visible: 140, velocityDown: -500), 1, "peek -> half")
    }

    func testAFlickNeverGoesAgainstItsDirection() {
        // dragged just above half, then a gentle downward flick: never back up to full (it projects past half)
        XCTAssertNotEqual(SheetSnap.target(heights: H, visible: 380, velocityDown: 450), 2)
        XCTAssertEqual(SheetSnap.target(heights: H, visible: 380, velocityDown: 450), 0)
        // dragged just below full, then a gentle upward flick: back to full, never down
        XCTAssertEqual(SheetSnap.target(heights: H, visible: 700, velocityDown: -420), 2)
        // a flick down from (almost) peek stays at peek; up from full stays at full
        XCTAssertEqual(SheetSnap.target(heights: H, visible: 132, velocityDown: 3000), 0)
        XCTAssertEqual(SheetSnap.target(heights: H, visible: 730, velocityDown: -3000), 2)
        // at least one detent: from half a just-above-threshold flick up reaches full
        XCTAssertEqual(SheetSnap.target(heights: H, visible: 350, velocityDown: -410), 2)
    }

    func testRubberBandPastTheEnds() {
        XCTAssertEqual(SheetSnap.rubberBand(400, min: 132, max: 730), 400)
        XCTAssertEqual(SheetSnap.rubberBand(830, min: 132, max: 730), 760, accuracy: 0.001)
        XCTAssertEqual(SheetSnap.rubberBand(32, min: 132, max: 730), 102, accuracy: 0.001)
    }

    func testInitialVelocityMatchesTheFinger() {
        // 600 pt left to shrink, finger at 1800 pt/s down: 3 "distances" per second
        XCTAssertEqual(SheetSnap.initialVelocity(visible: 732, target: 132, velocityDown: 1800), 3, accuracy: 0.001)
        XCTAssertEqual(SheetSnap.initialVelocity(visible: 400, target: 730, velocityDown: 500), 0, "moving away: start from rest")
        XCTAssertEqual(SheetSnap.initialVelocity(visible: 351, target: 350, velocityDown: 9000), 12, "capped")
        XCTAssertEqual(SheetSnap.initialVelocity(visible: 350, target: 350, velocityDown: 900), 0)
    }
}
