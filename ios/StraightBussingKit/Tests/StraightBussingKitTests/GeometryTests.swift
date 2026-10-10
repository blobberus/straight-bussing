import XCTest
@testable import StraightBussingKit

/// Port of web/tests/map-geometry.js (alongShape; fixtures of web/tests/map-fixtures.js), a golden file the
/// JavaScript computed on real routes (Fixtures/alongshape_golden.json: same paths from the Swift port), and
/// planned bus legs drawn along the road.
final class GeometryTests: XCTestCase {
    static let U = 0.002   // ~166 m of longitude here
    static let lat0 = 41.79, lon0 = -87.6

    /// Point on a synthetic grid: x, y in units of U degrees from (lat0, lon0).
    func P(_ x: Double, _ y: Double = 0) -> LatLon { LatLon(lat: Self.lat0 + y * Self.U, lon: Self.lon0 + x * Self.U) }

    /// Square loop A(0,0) -> B(4,0) -> C(4,4) -> D(0,4) -> A, densified every unit.
    func squareLoop() -> [LatLon] {
        var pts: [LatLon] = []
        for i in 0..<4 { pts.append(P(Double(i), 0)) }
        for i in 0..<4 { pts.append(P(4, Double(i))) }
        for i in stride(from: 4, to: 0, by: -1) { pts.append(P(Double(i), 4)) }
        for i in stride(from: 4, through: 0, by: -1) { pts.append(P(0, Double(i))) }
        return pts
    }

    /// Out-and-back along y=0: x 0 -> 6 then back to 0 on the same street (exactly the same coordinates).
    func outAndBack() -> [LatLon] {
        var pts: [LatLon] = []
        for i in 0...6 { pts.append(P(Double(i))) }
        for i in stride(from: 5, through: 0, by: -1) { pts.append(P(Double(i))) }
        return pts
    }

    func stop(_ id: String, _ x: Double, _ y: Double = 0) -> Place {
        let p = P(x, y)
        return Place(id: id, name: id, lat: p.lat, lon: p.lon)
    }

    func has(_ path: [LatLon], _ pt: LatLon, _ tol: Double = 3) -> Bool { path.contains { Geometry.distM($0, pt) < tol } }
    var U_M: Double { Geometry.distM(P(0), P(1)) }      // meters per grid unit along x (longitude)
    var V_M: Double { Geometry.distM(P(0, 0), P(0, 1)) }   // meters per grid unit along y (latitude)

    func along(_ shapes: [[LatLon]]?, _ seq: [String]?, _ b: Place, _ a: Place, _ fb: [LatLon]? = []) -> [LatLon] {
        Geometry.alongShape(shapes, seq, board: b, alight: a, fallback: fb)
    }

    func assertSame(_ a: [LatLon], _ b: [LatLon], _ msg: String, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(a.count, b.count, msg, file: file, line: line)
        for (p, q) in zip(a, b) where abs(p.lat - q.lat) > 1e-9 || abs(p.lon - q.lon) > 1e-9 {
            XCTFail("\(msg): \(p) != \(q)", file: file, line: line)
        }
    }

    func testNormAndDistances() {
        XCTAssertEqual(Geometry.norm([LatLon(lat: 1, lon: 2), LatLon(lat: .nan, lon: 2), LatLon(lat: 3, lon: 4)]),
                       [LatLon(lat: 1, lon: 2), LatLon(lat: 3, lon: 4)])
        XCTAssertEqual(Geometry.norm(nil), [])
        XCTAssertEqual(Geometry.distM(LatLon(lat: .nan, lon: 0), P(0)), .infinity)
        near(Geometry.distM(LatLon(lat: 41.79, lon: -87.6), LatLon(lat: 41.8, lon: -87.6)), 1112, 3)
        near(Geometry.pathLength([P(0), P(1), P(2)]), 2 * U_M, 0.5)
    }

    func testLoopForwardRideFollowsTheShape() {
        let out = along([squareLoop()], ["A", "B", "C", "D", "A"], stop("A", 0, 0), stop("C", 4, 4))
        XCTAssertTrue(has(out, P(4, 0)), "passes corner B")
        XCTAssertFalse(has(out, P(0, 4)), "does not pass corner D")
        near(Geometry.pathLength(out), 4 * U_M + 4 * V_M, 5)
    }

    func testLoopWrapsThroughTheStart() {
        let out = along([squareLoop()], ["A", "B", "C", "D", "A"], stop("C", 4, 4), stop("B", 4, 0))
        XCTAssertTrue(has(out, P(0, 4)), "passes D")
        XCTAssertTrue(has(out, P(0, 0)), "passes A (wrap)")
        near(Geometry.pathLength(out), 8 * U_M + 4 * V_M, 5, "three sides (C-D-A-B)")
        XCTAssertEqual(out.first, P(4, 4), "starts at board stop")
        XCTAssertEqual(out.last, P(4, 0), "ends at alight stop")
    }

    func testLoopShapeNotClosedAtTheSeamStillWraps() {
        let shp = Array(squareLoop().dropLast())   // ends one unit before A
        let out = along([shp], ["A", "B", "C", "D", "A"], stop("D", 0, 4), stop("B", 4, 0))
        XCTAssertTrue(has(out, P(4, 0)) && has(out, P(0, 1)), "goes D -> A -> B")
        XCTAssertFalse(has(out, P(4, 4)), "never via C")
    }

    func testOutAndBackPicksTheReturnPassBySequence() {
        // outbound O1(1) O2(2) turn T(6), return R2(2) R1(1): R2/O2 share a location, as do R1/O1
        let seq = ["O1", "O2", "T", "R2", "R1"], shp = outAndBack()
        near(Geometry.pathLength(along([shp], seq, stop("R2", 2), stop("R1", 1))), U_M, 5,
             "return ride is one unit, not via the turnaround")
        let out = along([shp], seq, stop("O2", 2), stop("R2", 2))
        near(Geometry.pathLength(out), 8 * U_M, 5, "O2 -> R2 goes out to the turnaround and back")
        XCTAssertTrue(has(out, P(6)), "reaches turnaround")
        near(Geometry.pathLength(along([shp], seq, stop("O1", 1), stop("T", 6))), 5 * U_M, 5)
    }

    func testStopServedInBothDirectionsUsesTheNearestForwardPair() {
        let seq = ["S", "M", "T", "M", "E"], shp = outAndBack()   // M at x=2 on both passes
        near(Geometry.pathLength(along([shp], seq, stop("T", 6), stop("M", 2))), 4 * U_M, 5, "T -> M (return pass)")
        near(Geometry.pathLength(along([shp], seq, stop("M", 2), stop("T", 6))), 4 * U_M, 5, "M -> T (outbound pass)")
        near(Geometry.pathLength(along([shp], seq, stop("M", 2), stop("E", 0))), 2 * U_M, 5, "M -> E uses the second M")
    }

    func testChoosesTheMatchingShapeLine() {
        let far = [P(0, 30), P(10, 30)]
        let out = along([far, squareLoop()], ["A", "B", "C", "D", "A"], stop("A", 0, 0), stop("B", 4, 0))
        near(Geometry.pathLength(out), 4 * U_M, 5)
    }

    func testFallbacks() {
        let fb = [P(0), P(3)]
        XCTAssertEqual(along([], ["A", "B"], stop("A", 0), stop("B", 3), fb), fb, "no shape")
        XCTAssertEqual(along(nil, nil, stop("A", 0), stop("B", 3), fb), fb, "nil inputs")
        XCTAssertEqual(along([[P(0, 40), P(5, 40)]], ["A", "B"], stop("A", 0), stop("B", 3), fb), fb, "stops far from shape")
        // open (non-loop) line driven one way: riding "backwards" is impossible
        let line = (0...6).map { P(Double($0)) }
        XCTAssertEqual(along([line], ["A", "B"], stop("B", 5), stop("A", 1), fb), fb, "backwards on open line")
        assertSame(along([line], ["A", "B"], stop("A", 1), stop("B", 5), nil), [P(1), P(2), P(3), P(4), P(5)], "forward on open line")
        XCTAssertEqual(along([], [], stop("A", 0), stop("B", 1), nil), [P(0), P(1)], "no fallback -> straight board/alight")
        XCTAssertEqual(along([line], [], Place(id: "A", name: "A", lat: .nan, lon: 0), stop("B", 1), fb), fb, "bad board")
    }

    func testProjectsOntoSegments() {
        let out = along([[P(0), P(10)]], ["A", "B"], stop("A", 2.5, 0.1), stop("B", 7.5, -0.1))
        XCTAssertEqual(out.count, 4, "board, projected board, projected alight, alight")
        near(Geometry.distM(out[1], P(2.5)), 0, 1)
        near(Geometry.distM(out[2], P(7.5)), 0, 1)
    }

    func testWrongPassIsReplacedByTheShortestPlausibleOne() {
        // two-stop sequence on an out-and-back street: the index expectation puts the alight on the return
        // pass (9 units), but the 1-unit ride on the outbound pass is the plausible one
        let out = along([outAndBack()], ["A", "B"], stop("A", 1.5), stop("B", 2.5), [P(1.5), P(2.5)])
        near(Geometry.pathLength(out), U_M, 5, "one unit, outbound")
        XCTAssertTrue(has(out, P(2)), "follows the shape vertex between the stops")
    }

    func testRealDetourBetweenCloseStopsKeepsTheShape() {
        // up 10, across 1, down 10: stops 1 unit apart, 18 units of street between them, one pass each
        let u = [P(0, 0), P(0, 10), P(1, 10), P(1, 0)]
        let out = along([u], ["A", "B"], stop("A", 0, 1), stop("B", 1, 1), [P(0, 1), P(1, 1)])
        XCTAssertTrue(has(out, P(0, 10)) && has(out, P(1, 10)), "drives around the top")
        near(Geometry.pathLength(out), 18 * V_M + U_M, 5)
    }

    // MARK: Real data (web/data, the files the app bundles)

    func place(_ id: String, _ s: StaticData, withId: Bool = true) -> Place {
        let st = s.stops[id]!
        return Place(id: withId ? id : nil, name: st.name, lat: st.lat, lon: st.lon)
    }

    /// Stop ids from index i to j in travel order (wrapping on loops).
    static func forward(_ seq: [String], _ i: Int, _ j: Int, _ loop: Bool) -> [String] {
        var ids: [String] = [], k = i
        while true {
            ids.append(seq[k])
            if k == j || ids.count > seq.count { break }
            k = loop ? (k + 1) % seq.count : k + 1
        }
        return ids
    }

    func testRealDataAdjacentStopsFollowTheRoad() {
        let S = TS.real.data
        var n = 0, good = 0
        for (rid, seq) in S.routeStops where seq.count > 1 {
            for i in 0..<(seq.count - 1) {
                guard let a = S.stops[seq[i]], let b = S.stops[seq[i + 1]], seq[i] != seq[i + 1] else { continue }
                let fb = [a.coord, b.coord]
                let out = Geometry.alongShape(S.shapes[rid], seq, board: place(seq[i], S), alight: place(seq[i + 1], S), fallback: fb)
                n += 1
                XCTAssertGreaterThanOrEqual(out.count, 2, "\(rid) \(i) empty")
                if out.count > 2 && Geometry.pathLength(out) < 3 * Geo.hav(a.coord, b.coord) + 400 { good += 1 }
            }
        }
        XCTAssertGreaterThan(n, 50, "enough pairs")
        XCTAssertGreaterThan(Double(good) / Double(max(1, n)), 0.85, "road-following for \(good)/\(n) adjacent pairs")
    }

    func testRealDataEveryForwardStopPairFollowsTheShape() {
        let S = TS.real.data
        var n = 0
        var straight: [String] = []
        for (rid, raw) in S.routeStops where S.shapes[rid] != nil {
            let loop = raw.count > 2 && raw.first == raw.last
            let seq = (loop ? Array(raw.dropLast()) : raw).filter { S.stops[$0] != nil }
            for i in seq.indices {
                for j in seq.indices where i != j && (loop || j > i) {
                    let fb = Self.forward(seq, i, j, loop).map { S.stops[$0]!.coord }
                    let out = Geometry.alongShape(S.shapes[rid], raw, board: place(seq[i], S), alight: place(seq[j], S), fallback: fb)
                    n += 1
                    if out == fb { straight.append("\(rid) \(seq[i])>\(seq[j])") }
                }
            }
        }
        XCTAssertGreaterThan(n, 500, "enough pairs")
        XCTAssertEqual(straight, [], "stop pairs drawn as straight stop-to-stop lines")
    }

    /// The JavaScript's own answers on frozen copies of 4 routes (North with its 5 km detour, East, Red Line /
    /// Arts Block with its 1 km Garfield Blvd step, Midway Metra with two shape lines): every forward stop
    /// pair with ids, and every adjacent pair without ids (the unknown-sequence branch).
    func testGoldenPathsMatchTheWebImplementation() throws {
        let root = try XCTUnwrap(try JSONSerialization.jsonObject(with: TS.fixture("alongshape_golden")) as? [String: Any])
        let shapesRaw = try XCTUnwrap(root["shapes"] as? [String: [[[Double]]]])
        let routeStops = try XCTUnwrap(root["routeStops"] as? [String: [String]])
        let stopsRaw = try XCTUnwrap(root["stops"] as? [String: [String: Double]])
        let cases = try XCTUnwrap(root["cases"] as? [[Any]])
        let shapes = shapesRaw.mapValues { lines in lines.map { line in line.map { LatLon(lat: $0[0], lon: $0[1]) } } }
        let stops = stopsRaw.mapValues { LatLon(lat: $0["lat"] ?? .nan, lon: $0["lon"] ?? .nan) }
        XCTAssertGreaterThan(cases.count, 500)
        var bad: [String] = []
        for c in cases {
            guard c.count == 7, let rid = c[0] as? String, let i = c[1] as? Int, let j = c[2] as? Int, let known = c[3] as? Int,
                  let count = c[4] as? Int, let len = (c[5] as? NSNumber)?.doubleValue, let sum = (c[6] as? NSNumber)?.doubleValue,
                  let raw = routeStops[rid] else { XCTFail("bad case \(c)"); continue }
            let loop = raw.count > 2 && raw.first == raw.last
            let seq = (loop ? Array(raw.dropLast()) : raw).filter { stops[$0] != nil }
            let ids = known == 1 ? Self.forward(seq, i, j, loop) : [seq[i], seq[j]]
            let fb = ids.map { stops[$0]! }
            let bp = stops[seq[i]]!, ap = stops[seq[j]]!
            let b = Place(id: known == 1 ? seq[i] : nil, name: "", lat: bp.lat, lon: bp.lon)
            let a = Place(id: known == 1 ? seq[j] : nil, name: "", lat: ap.lat, lon: ap.lon)
            let p = Geometry.alongShape(shapes[rid], raw, board: b, alight: a, fallback: fb)
            let s = p.reduce(0.0) { $0 + $1.lat + $1.lon }, l = Geometry.pathLength(p)
            if p.count != count || abs(l - len) > 0.02 || abs(s - sum) > 2e-6 {
                bad.append("\(rid) \(i)>\(j)\(known == 1 ? "" : " (no ids)"): \(p.count) pts \(l) m, web \(count) pts \(len) m")
            }
        }
        XCTAssertEqual(bad, [], "paths that differ from web/js/map/geometry.js")
    }

    func testPlannedBusLegsAreDrawnAlongTheRoad() throws {
        let S = TS.real.data
        let reg = try XCTUnwrap(S.stops.values.filter { $0.name.hasPrefix("Regenstein") }.min { $0.id < $1.id })
        let buses = S.routeStopIds.map { VehiclePosition.on($0, id: "v" + $0) }   // headway waits on every route
        let data = PlannerData(stops: S.stops, routeStops: S.routeStops, routeOrder: S.routeStopIds, buses: buses)
        var legs: [BusLeg] = []
        // Regenstein Library to Harper Court, to the Midway Plaisance south side and to East Hyde Park
        for to in [LatLon(lat: 41.7995, lon: -87.5880), LatLon(lat: 41.7856, lon: -87.5960), LatLon(lat: 41.7930, lon: -87.5800)] {
            let r = Planner.plan(from: LatLon(lat: reg.lat + 0.0003, lon: reg.lon), to: to, now: PlannerTests.T, data: data)
            legs += r.options.flatMap(\.busLegs)
        }
        XCTAssertFalse(legs.isEmpty, "some shuttle options")
        for l in legs {
            let road = l.roadPath(shapes: S.shapes, routeStops: S.routeStops)
            XCTAssertNotEqual(road, l.path, "\(l.rid) \(l.board.name) > \(l.alight.name) drawn along the shape, not stop to stop")
            XCTAssertGreaterThanOrEqual(road.count, 3)
            XCTAssertEqual(road.first, l.board.coord)
            XCTAssertLessThan(Geometry.distM(road.last ?? LatLon(lat: .nan, lon: 0), l.alight.coord), 0.1, "ends at the alight stop")
            XCTAssertEqual(l.path.count, l.stopsPassed + 1, "path stays the stop list")
            XCTAssertGreaterThan(Geometry.pathLength(road) + 1, Geo.hav(l.board.coord, l.alight.coord))
        }
    }

    func testRoadPathFallsBackToTheStopPathWithoutAShape() {
        let b = stop("A", 0), a = stop("B", 3)
        let leg = BusLeg(rid: "R", board: b, alight: a, stopIds: ["A", "M", "B"], path: [b.coord, P(1.5, 1), a.coord],
                         stopsPassed: 2, wait: 1, waitLive: false, ride: 3, source: .estimate, conf: 0.3, boardT: 0, alightT: 180,
                         tripId: nil, p10: nil, p90: nil)
        XCTAssertEqual(leg.roadPath(shapes: [:], routeStops: [:]), leg.path)
        let along = leg.roadPath(shapes: ["R": [(0...6).map { P(Double($0)) }]], routeStops: ["R": ["A", "M", "B"]])
        XCTAssertTrue(has(along, P(1)) && has(along, P(2)), "follows the shape when there is one")
        XCTAssertFalse(has(along, P(1.5, 1)), "not via the stop-to-stop detour")
    }
}
