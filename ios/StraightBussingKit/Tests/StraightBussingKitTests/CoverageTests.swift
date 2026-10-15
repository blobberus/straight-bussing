import XCTest
@testable import StraightBussingKit

/// Directions covers destinations within 800 m of a served stop (owner 2026-10-15; the web's core/coverage.js).
final class CoverageTests: XCTestCase {
    static let ellis = Stop(id: "S1", name: "Ellis & 57th", lat: 41.7915, lon: -87.6015)
    static let unserved = Stop(id: "S2", name: "Old stop", lat: 41.7700, lon: -87.6015)
    static let stops = [ellis.id: ellis, unserved.id: unserved]
    static let stopRoutes = ["S1": ["R1"]]

    /// `m` meters due north of a stop.
    func north(of s: Stop, _ m: Double) -> LatLon { LatLon(lat: s.lat + m / 111_195, lon: s.lon) }

    func testAStopIsAlwaysCovered() {
        XCTAssertTrue(Coverage.covered(Self.unserved.coord, stopId: "S2", stops: Self.stops, stopRoutes: Self.stopRoutes),
                      "a stop endpoint needs no distance check")
    }

    func testWithin800mOfAServedStop() {
        let p = north(of: Self.ellis, 500)
        XCTAssertEqual(Geo.hav(p, Self.ellis.coord), 500, accuracy: 2)
        XCTAssertEqual(Coverage.nearestStopMeters(p, stops: Self.stops, stopRoutes: Self.stopRoutes) ?? 0, 500, accuracy: 2)
        XCTAssertTrue(Coverage.covered(p, stops: Self.stops, stopRoutes: Self.stopRoutes))
        XCTAssertTrue(Coverage.covered(Self.ellis.coord, stops: Self.stops, stopRoutes: Self.stopRoutes), "at the stop itself")
    }

    func testFartherThan800mIsNotCovered() {
        let p = north(of: Self.ellis, 900)
        XCTAssertEqual(Geo.hav(p, Self.ellis.coord), 900, accuracy: 2)
        XCTAssertFalse(Coverage.covered(p, stops: Self.stops, stopRoutes: Self.stopRoutes))
    }

    func testAStopNoRouteServesDoesNotCount() {
        // 100 m from the unserved stop, about 2.3 km from the served one
        let p = north(of: Self.unserved, 100)
        XCTAssertFalse(Coverage.covered(p, stops: Self.stops, stopRoutes: Self.stopRoutes))
        XCTAssertGreaterThan(Coverage.nearestStopMeters(p, stops: Self.stops, stopRoutes: Self.stopRoutes) ?? 0, 2000)
        // no stop -> route table at all: every stop counts
        XCTAssertTrue(Coverage.covered(p, stops: Self.stops, stopRoutes: [:]))
    }

    func testNoStopsYetNeverBlocks() {
        XCTAssertNil(Coverage.nearestStopMeters(LatLon(lat: 41.9, lon: -87.6), stops: [:], stopRoutes: [:]))
        XCTAssertTrue(Coverage.covered(LatLon(lat: 41.9, lon: -87.6), stops: [:], stopRoutes: [:]), "schedule not loaded")
        XCTAssertTrue(Coverage.covered(LatLon(lat: 41.9, lon: -87.6), in: StaticData()), "empty StaticData")
    }

    func testStaticDataOverloadUsesItsStopRoutes() {
        let S = StaticData(stops: Self.stops, routeStops: ["R1": ["S1"]])
        XCTAssertEqual(S.stopRoutes["S1"], ["R1"])
        XCTAssertTrue(Coverage.covered(north(of: Self.ellis, 500), in: S))
        XCTAssertFalse(Coverage.covered(north(of: Self.unserved, 100), in: S), "S2 is on no route")
    }

    func testText() {
        XCTAssertEqual(Coverage.meters, 800)
        XCTAssertTrue(Coverage.text.contains("800 m"))
        XCTAssertFalse(Coverage.text.contains("\u{2013}") || Coverage.text.contains("\u{2014}"), "no en or em dash")
        XCTAssertFalse(Coverage.text.contains("UGo"), "no operator brand in the app's own words")
        // owner 2026-10-15 (later): the note goes on, then the trip options as usual
        XCTAssertEqual(Coverage.advice, "Straight Bussing recommends changing to another mode of transportation after arriving at the closest destination.")
        XCTAssertFalse(Coverage.advice.contains("\u{2013}") || Coverage.advice.contains("\u{2014}"), "no en or em dash")
    }
}
