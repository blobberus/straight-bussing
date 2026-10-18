import XCTest
@testable import StraightBussingKit

/// Port of web/tests/map-track.js (buses stay on their route line; fixtures of web/tests/map-fixtures.js) and a golden
/// file the JavaScript computed on real bus reports (Fixtures/bustrack_golden.json: the same answers from the Swift port).
final class BusTrackTests: XCTestCase {
    static let U = 0.002
    static let lat0 = 41.79, lon0 = -87.6
    func P(_ x: Double, _ y: Double = 0) -> LatLon { LatLon(lat: Self.lat0 + y * Self.U, lon: Self.lon0 + x * Self.U) }

    func squareLoop() -> [LatLon] {
        var pts: [LatLon] = []
        for i in 0..<4 { pts.append(P(Double(i), 0)) }
        for i in 0..<4 { pts.append(P(4, Double(i))) }
        for i in stride(from: 4, to: 0, by: -1) { pts.append(P(Double(i), 4)) }
        for i in stride(from: 4, through: 0, by: -1) { pts.append(P(0, Double(i))) }
        return pts
    }
    /// East 3 units (~500 m), then north 3 units (~667 m).
    func ell() -> [LatLon] { [P(0, 0), P(3, 0), P(3, 3)] }
    /// East on a street, then back west on it.
    func outBack() -> [LatLon] { [0, 1, 2, 3, 4].map { P(Double($0)) } + [3, 2, 1, 0].map { P(Double($0), 0.0001) } }
    /// A GPS fix a little north of a point.
    func nudge(_ p: LatLon, _ dLat: Double) -> LatLon { LatLon(lat: p.lat + dLat, lon: p.lon) }

    /// Meters from a point to the nearest point of a polyline.
    func offLine(_ line: [LatLon], _ p: LatLon) -> Double {
        let s = BusTrack.prepare([line])[0]
        var best = Double.infinity, x = 0.0
        while x <= s.length { best = min(best, Geometry.distM(BusTrack.pointAt(s.line, s.cum, x), p)); x += 1 }
        return best
    }
    func at(_ s: BusTrack.Line, _ pos: Double) -> LatLon { BusTrack.pointAt(s.line, s.cum, pos) }

    func testPrepareCleansAndFindsLoops() {
        let lines = [[P(0, 0), P(0, 0), P(2, 0), LatLon(lat: .nan, lon: 1)], [P(1, 1)], squareLoop()]
        let prep = BusTrack.prepare(lines)
        XCTAssertEqual(prep.count, 2, "repeats, junk and one-point lines dropped")
        XCTAssertEqual(prep[0].line.count, 2)
        XCTAssertTrue(!prep[0].closed && prep[1].closed, "open line and loop")
        XCTAssertEqual(BusTrack.prepare(nil).count, 0)
    }

    func testWalkGoesThroughTheCornerBackwardsAndRoundALoop() {
        let s = BusTrack.prepare([ell()])[0], corner = s.cum[1]
        let path = BusTrack.walk(s, corner - 100, 200)
        XCTAssertTrue(path.contains { Geometry.distM($0, P(3, 0)) < 0.01 }, "the corner vertex is on the way")
        near(Geometry.distM(path.last!, at(s, corner + 100)), 0, 0.01)
        let back = BusTrack.walk(s, corner + 50, -100)
        XCTAssertTrue(back.contains { Geometry.distM($0, P(3, 0)) < 0.01 }, "backwards through the corner too")
        let sq = BusTrack.prepare([squareLoop()])[0]
        let wrap = BusTrack.walk(sq, sq.length - 30, 80)
        XCTAssertTrue(wrap.contains { Geometry.distM($0, P(0, 0)) < 0.01 }, "a loop continues through its start")
        near(BusTrack.advance(sq, sq.length - 30, 80), 50, 1e-6)
        near(BusTrack.advance(s, 10, -50), 0, 1e-6, "open lines clamp")
    }

    func testOffTheLineStaysNearItIsDrawnOnIt() {
        let prep = BusTrack.prepare([ell()])
        let far = nudge(P(1, 0), 100 / 111195)
        let r = BusTrack.follow(prep, from: nil, at: nil, far)
        XCTAssertTrue(r.to == nil && !r.along, "off the line")
        XCTAssertEqual(r.path.last, far)
        let r2 = BusTrack.follow(prep, from: nil, at: nil, nudge(P(1, 0), 20 / 111195))
        XCTAssertLessThan(Geometry.distM(r2.to!.pt, P(1, 0)), 1, "projected onto the street")
        XCTAssertTrue(BusTrack.locate(prep, nudge(P(1, 0), (BusTrack.onM + 5) / 111195)).isEmpty, "just past onM is off")
    }

    func testAMoveRoundTheCornerFollowsTheStreet() throws {
        let prep = BusTrack.prepare([ell()]), s = prep[0], corner = s.cum[1]
        let from = BusTrack.OnLine(li: 0, pos: corner - 150)
        let fix = nudge(at(s, corner + 200), 0.00008)
        let r = BusTrack.follow(prep, from: from, at: at(s, from.pos), fix, dt: 12)
        XCTAssertTrue(r.along, "along the line")
        near(r.f, 350, 15)
        XCTAssertTrue(r.path.contains { Geometry.distM($0, P(3, 0)) < 0.01 }, "through the corner, not across the block")
        for p in r.path { XCTAssertLessThan(offLine(ell(), p), 1.5, "every point of the way is on the line") }
        near(BusTrack.headingAt(s, corner + 200), 0, 1, "heading north after the corner")
        let j = BusTrack.follow(prep, from: .init(li: 0, pos: 300), at: at(s, 300), at(s, 290), dt: 10)
        XCTAssertTrue(j.along && j.f < 0 && j.f > -15, "GPS jitter back stays on the line")
    }

    func testAnOutAndBackStreetKeepsThePassTheBusIsOn() {
        let prep = BusTrack.prepare([outBack()]), s = prep[0], half = s.length / 2
        let out = BusTrack.follow(prep, from: .init(li: 0, pos: 100), at: at(s, 100), at(s, 150), dt: 10)
        XCTAssertTrue(out.along && abs(out.f - 50) < 3, "outbound continues outbound")
        let back = BusTrack.follow(prep, from: .init(li: 0, pos: half + 100), at: at(s, half + 100), at(s, half + 150), dt: 10)
        XCTAssertTrue(back.along && abs(back.f - 50) < 3, "inbound continues inbound (not back to the outbound pass)")
        let east = BusTrack.follow(prep, from: nil, at: nil, at(s, 200), bearing: 90)
        let west = BusTrack.follow(prep, from: nil, at: nil, at(s, 200), bearing: 270)
        XCTAssertTrue(east.to!.pos < half && west.to!.pos > half, "a new badge takes the pass heading the feed's way")
    }

    func testAfterAGapTheCatchUpIsAlongTheLineAnImpossibleJumpIsNot() {
        let sq = BusTrack.prepare([squareLoop()]), s = sq[0]
        let from = BusTrack.OnLine(li: 0, pos: 50), fix = at(s, 1700)
        XCTAssertFalse(BusTrack.follow(sq, from: from, at: at(s, 50), fix, dt: 10).along, "1.65 km in 10 s is no drive")
        let gap = BusTrack.follow(sq, from: from, at: at(s, 50), fix, dt: 300)
        XCTAssertTrue(gap.along && abs(gap.f - 1650) < 5, "after 5 min without data: along the loop")
        XCTAssertTrue(gap.path.contains { Geometry.distM($0, P(4, 0)) < 0.01 } && gap.path.contains { Geometry.distM($0, P(4, 4)) < 0.01 },
                      "round both corners")
        let wrap = BusTrack.follow(sq, from: .init(li: 0, pos: s.length - 40), at: at(s, s.length - 40), at(s, 60), dt: 10)
        XCTAssertTrue(wrap.along && abs(wrap.f - 100) < 3, "through the loop start")
    }

    func testMoveTiming() {
        XCTAssertEqual(BusTrack.timing(along: true, length: 120, dt: 10, reduce: false), .init(dur: 9, ease: false),
                       "a normal poll glides at constant speed")
        let c = BusTrack.timing(along: true, length: 1500, dt: 300, reduce: false)
        XCTAssertTrue(c.ease && c.dur >= 0.9 && c.dur <= 2.6, "a catch-up eases in at most 2.6 s")
        XCTAssertEqual(c.dur, 1.9, accuracy: 1e-9, "700 ms + 0.8 ms per m")
        XCTAssertTrue(BusTrack.timing(along: true, length: 120, dt: 120, reduce: false).ease, "a short move after a long gap catches up too")
        XCTAssertEqual(BusTrack.timing(along: true, length: 120, dt: nil, reduce: false).dur, 9, "unknown gap: a normal glide")
        XCTAssertEqual(BusTrack.timing(along: false, length: 80, dt: 10, reduce: false).dur, 9, "off the line: a short straight glide")
        XCTAssertEqual(BusTrack.timing(along: false, length: 400, dt: 10, reduce: false).dur, 0, "off the line: a long move jumps")
        XCTAssertEqual(BusTrack.timing(along: true, length: 120, dt: 10, reduce: true).dur, 0, "reduced motion: at once")
        XCTAssertEqual(BusTrack.easeInOut(0), 0)
        XCTAssertEqual(BusTrack.easeInOut(0.5), 0.5, accuracy: 1e-12)
        XCTAssertEqual(BusTrack.easeInOut(1), 1)
    }

    /// The web's answers on real bus reports, step by step (each starts where the previous answer put the badge).
    func testGoldenRealReportsMatchTheWeb() throws {
        let root = try XCTUnwrap(try JSONSerialization.jsonObject(with: TS.fixture("bustrack_golden")) as? [String: Any])
        let shapesRaw = try XCTUnwrap(root["shapes"] as? [String: [[[Double]]]])
        let cases = try XCTUnwrap(root["cases"] as? [[String: Any]])
        let shapes = shapesRaw.mapValues { lines in lines.map { line in line.map { LatLon(lat: $0[0], lon: $0[1]) } } }
        var bad: [String] = [], steps = 0
        for c in cases {
            let rid = try XCTUnwrap(c["rid"] as? String)
            let fixes = try XCTUnwrap(c["fixes"] as? [[Any]]), expect = try XCTUnwrap(c["expect"] as? [[NSNumber]])
            XCTAssertEqual(fixes.count, expect.count)
            let prep = BusTrack.prepare(shapes[rid])
            var to: BusTrack.Place? = nil, atPt: LatLon? = nil
            for (i, f) in fixes.enumerated() {
                let pt = LatLon(lat: (f[0] as! NSNumber).doubleValue, lon: (f[1] as! NSNumber).doubleValue)
                let brg = (f[2] as? NSNumber)?.doubleValue, dt = (f[3] as? NSNumber)?.doubleValue
                let r = BusTrack.follow(prep, from: to.map { .init(li: $0.li, pos: $0.pos) }, at: atPt, pt, bearing: brg, dt: dt)
                let e = expect[i].map(\.doubleValue)
                let len = Geometry.pathLength(r.path), sum = r.path.reduce(0.0) { $0 + $1.lat + $1.lon }
                if Double(r.to?.li ?? -1) != e[0] || abs((r.to?.pos ?? 0) - e[1]) > 0.01 || (r.along ? 1.0 : 0.0) != e[2]
                    || abs(r.f - e[3]) > 0.01 || Double(r.path.count) != e[4] || abs(len - e[5]) > 0.02 || abs(sum - e[6]) > 2e-6 {
                    bad.append("\(rid) step \(i): \(r.to?.li ?? -1) \(r.to?.pos ?? 0) along \(r.along) f \(r.f) \(r.path.count) pts \(len) m; web \(e)")
                }
                to = r.to
                atPt = r.to?.pt ?? pt
                steps += 1
            }
        }
        XCTAssertGreaterThan(steps, 1000)
        XCTAssertEqual(Array(bad.prefix(10)), [], "\(bad.count) steps differ from web/js/map/track.js")
    }
}
