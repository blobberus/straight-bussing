import XCTest
@testable import StraightBussingKit

/// The heading cone (owner 2026-10-14), the same numbers as the web's tests/map-compass.js (ui/compass.js spreadFor /
/// turn, map/geometry.js unwrapDeg).
final class HeadingConeTests: XCTestCase {
    func testNormAndTurn() {
        XCTAssertEqual(HeadingCone.norm(370), 10)
        XCTAssertEqual(HeadingCone.norm(-10), 350)
        XCTAssertEqual(HeadingCone.norm(360), 0)
        XCTAssertEqual(HeadingCone.turn(350, 10), 20)
        XCTAssertEqual(HeadingCone.turn(10, 350), -20)
        XCTAssertEqual(HeadingCone.turn(0, 180), 180)
        XCTAssertEqual(HeadingCone.turn(90, 90), 0)
    }

    func testUnwrapTurnsTheShortWay() {
        XCTAssertEqual(HeadingCone.unwrap(nil, 370), 10)
        XCTAssertEqual(HeadingCone.unwrap(350, 10), 370, "across north: 20 deg on, not 340 back")
        XCTAssertEqual(HeadingCone.unwrap(370, 5), 365)
        XCTAssertEqual(HeadingCone.unwrap(10, 350), -10)
        XCTAssertEqual(HeadingCone.unwrap(0, 180), 180)
        XCTAssertEqual(HeadingCone.unwrap(720, 90), 810)
    }

    func testSpreadNeverInventsPrecision() {
        XCTAssertEqual(HeadingCone.spread(accuracy: nil), HeadingCone.spreadDefault)
        XCTAssertEqual(HeadingCone.spread(accuracy: .nan), HeadingCone.spreadDefault)
        XCTAssertEqual(HeadingCone.spread(accuracy: -1), HeadingCone.spreadMax)
        XCTAssertEqual(HeadingCone.spread(accuracy: 5), HeadingCone.spreadMin, "never narrower than the minimum")
        XCTAssertEqual(HeadingCone.spread(accuracy: 25), 50)
        XCTAssertEqual(HeadingCone.spread(accuracy: 90), HeadingCone.spreadMax)
    }

    func testReadingFromCoreLocation() {
        XCTAssertEqual(HeadingCone.reading(trueHeading: 45, magneticHeading: 48, accuracy: 10),
                       HeadingCone.Reading(deg: 45, spread: 40), "true heading first")
        XCTAssertEqual(HeadingCone.reading(trueHeading: -1, magneticHeading: 48, accuracy: 25),
                       HeadingCone.Reading(deg: 48, spread: 50), "no true heading yet: magnetic")
        XCTAssertNil(HeadingCone.reading(trueHeading: 45, magneticHeading: 48, accuracy: -1), "negative accuracy = no heading")
        XCTAssertNil(HeadingCone.reading(trueHeading: -1, magneticHeading: -1, accuracy: 10))
        XCTAssertEqual(HeadingCone.reading(trueHeading: 360, magneticHeading: 0, accuracy: 10)?.deg, 0)
    }
}
