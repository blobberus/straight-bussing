import XCTest
@testable import StraightBussingKit

/// Route colors on the dark map (owner 2026-11-06), the same answers as the web's tests/core-routecolor.js
/// (web/js/core/routecolor.js): the golden file is a copy of web/tests/fixtures/routecolor_golden.json.
final class RouteColorTests: XCTestCase {
    struct Golden: Decodable {
        struct Dark: Decodable { let color: String; let name: String; let out: String; let text: String; let land: Double; let street: Double }
        struct Lift: Decodable { let color: String; let bg: [String]; let min: Double; let out: String }
        let land: String, street: String, min: Double, badgeTextMin: Double
        let dark: [Dark], lift: [Lift]
    }

    func golden() throws -> Golden { try JSONDecoder().decode(Golden.self, from: TS.fixture("routecolor_golden")) }

    func testGoldenAnswersMatchTheWeb() throws {
        let g = try golden()
        XCTAssertEqual(g.land, RouteColor.darkLand)
        XCTAssertEqual(g.street, RouteColor.darkStreet)
        XCTAssertEqual(g.min, RouteColor.lineMinContrast)
        XCTAssertEqual(g.badgeTextMin, RouteColor.badgeTextMin)
        XCTAssertGreaterThan(g.dark.count, 20)
        for x in g.dark {
            let out = RouteColor.darkRouteColor(x.color)
            XCTAssertEqual(out, x.out, "\(x.name) \(x.color)")
            XCTAssertEqual(RouteColor.textOn(out), x.text, "\(x.name) badge text")
            XCTAssertEqual(RouteColor.contrast(out, RouteColor.darkLand), x.land, accuracy: 0.001, "\(x.name) land")
            XCTAssertEqual(RouteColor.contrast(out, RouteColor.darkStreet), x.street, accuracy: 0.001, "\(x.name) street")
        }
        for x in g.lift {
            XCTAssertEqual(RouteColor.liftForDark(x.color, bg: x.bg, min: x.min), x.out, "\(x.color) on \(x.bg) at \(x.min)")
        }
    }

    func testEveryRealRouteReadsOnTheDarkMap() throws {
        let routes = TS.real.data.routes
        XCTAssertFalse(routes.isEmpty)
        for (rid, r) in routes {
            let c = RouteColor.safe(r.color), d = RouteColor.mapColor(r.color, dark: true)
            XCTAssertEqual(RouteColor.mapColor(r.color, dark: false), c, "light map: published (\(rid))")
            XCTAssertGreaterThanOrEqual(RouteColor.contrast(d, RouteColor.darkLand), 3, "\(rid) \(c) -> \(d) on the land")
            guard d != c else { continue }
            XCTAssertLessThan(RouteColor.contrast(c, RouteColor.darkLand), 3, "\(rid): only a color under 3:1 changes")
            XCTAssertGreaterThanOrEqual(RouteColor.contrast(d, RouteColor.darkStreet), 3, "\(rid) on the street fill")
            XCTAssertTrue(RouteColor.badgeTextOk(d), "\(rid) badge text AA")
            XCTAssertGreaterThan(RouteColor.oklab(d).L, RouteColor.oklab(c).L, "\(rid) lighter")
        }
    }

    func testBasics() {
        XCTAssertEqual(RouteColor.safe(" 0e5700 "), "#0E5700")
        XCTAssertEqual(RouteColor.safe("#12345"), "#555555")
        XCTAssertEqual(RouteColor.safe("javascript:alert(1)"), "#555555")
        XCTAssertEqual(RouteColor.safe(nil), "#555555")
        XCTAssertEqual(RouteColor.liftForDark("#F7EB07"), "#F7EB07", "already 3:1: unchanged")
        XCTAssertEqual(RouteColor.liftForDark("#000000", bg: ["#FFFFFF"]), "#000000")
        XCTAssertEqual(RouteColor.liftForDark("#808080", bg: ["#FFFFFF"], min: 21), "#FFFFFF", "an impossible ratio ends at white")
        XCTAssertEqual(RouteColor.textOn("#FF9900"), RouteColor.textDark)
        XCTAssertEqual(RouteColor.textOn("#393B79"), RouteColor.textLight)
        XCTAssertEqual(RouteColor.mapColor("#393B79", dark: true), RouteColor.mapColor("#393B79", dark: true), "cached answer is stable")
    }
}
