import Foundation
import XCTest
@testable import StraightBussingKit
#if canImport(CoreText)
import CoreText
#endif

/// Map labels (Kit `Landmarks`; web data/static.js cleanLandmarks, web/js/map/landmarks.js and tests/map-landmarks.js).
final class LandmarksTests: XCTestCase {
    static let real = StaticLoader.loadLandmarks(from: TS.webData)

    func mk(_ name: String, _ tier: Int, _ rank: Int, lat: Double = 41.79, lon: Double = -87.6, until: Double? = nil) -> Landmark {
        Landmark(name: name, coord: LatLon(lat: lat, lon: lon), tier: tier, until: until, rank: rank)
    }

    // MARK: Data

    func testRealBundledFile() {
        let l = Self.real
        XCTAssertEqual(l.count, 87)
        XCTAssertEqual(l.filter { $0.tier == 1 }.count, 27)
        XCTAssertEqual(l.filter { $0.tier == 2 }.count, 33)
        XCTAssertEqual(l.filter { $0.tier == 3 }.count, 27)
        XCTAssertEqual(l.map(\.rank), Array(0..<87))
        XCTAssertEqual(l.map(\.tier), l.map(\.tier).sorted(), "the file is sorted by tier")
        XCTAssertEqual(l.first?.name, "Regenstein Library")
        XCTAssertEqual(l.first?.osm, "Joseph Regenstein Library")
        XCTAssertEqual(Set(l.map(\.name)).count, 87, "no name twice")
        // every UChicago dorm is named (owner: "Other locations that need naming is UChicago dorm buildings")
        let dorms = l.filter { $0.kind == "dorm" }
        XCTAssertGreaterThanOrEqual(dorms.count, 10)
        for n in ["Campus North", "Woodlawn Commons", "Granville-Grossman Commons", "Burton-Judson Courts", "International House",
                  "Snell-Hitchcock Halls", "Max Palevsky Commons", "Max Palevsky East", "Max Palevsky Central", "Max Palevsky West"] {
            XCTAssertTrue(dorms.contains { $0.name == n }, n)
        }
        // the group name hands over to its buildings at 15.5 (the only `until`)
        let group = l.first { $0.name == "Max Palevsky Commons" }
        XCTAssertEqual(group?.tier, 1)
        XCTAssertEqual(group?.until, 15.5)
        XCTAssertEqual(l.filter { $0.until != nil }.count, 1)
        XCTAssertEqual(l.first { $0.name == "Max Palevsky East" }?.tier, 2)
        for m in l {
            XCTAssertFalse(m.name.contains("\u{2013}") || m.name.contains("\u{2014}"), "no en or em dash: \(m.name)")
            // the network: campus to the Gleacher Center downtown (11 km)
            XCTAssertLessThan(Geo.hav(m.coord, LatLon(lat: 41.7915, lon: -87.599)), 15_000, m.name)
        }
    }

    func testBadRowsDropped() {
        let json = """
        {"v": 1, "l": [["A", 41.79, -87.6, 1, "hub", "A in OSM"], ["", 41.79, -87.6, 1], [null, 41.79, -87.6, 1],
          ["No lat", "x", -87.6, 1], ["Tier 4", 41.79, -87.6, 4], ["Strings", " 41.8 ", "-87.59", "2", "dorm", "S", "15.5"],
          ["Bool", true, -87.6, 1], "not a row", ["Short", 41.79], ["Off the globe", 95, -87.6, 1],
          ["Half tier", 41.79, -87.6, 1.5], ["B", 41.78, -87.61, 3, null, "", null], ["C", 41.78, -87.61, 3, "x", "y", "soon"]]}
        """
        let l = Landmarks.parse(Data(json.utf8))
        XCTAssertEqual(l.map(\.name), ["A", "Strings", "B", "C"])
        XCTAssertEqual(l.map(\.rank), [0, 1, 2, 3], "rank = position in the cleaned list")
        XCTAssertEqual(l[0].osm, "A in OSM")
        XCTAssertEqual(l[0].kind, "hub")
        XCTAssertNil(l[0].until, "no 7th element: never hides")
        XCTAssertEqual(l[1].tier, 2)
        XCTAssertEqual(l[1].until, 15.5)
        near(l[1].coord.lat, 41.8, 1e-12)
        near(l[1].coord.lon, -87.59, 1e-12)
        XCTAssertEqual(l[2].osm, "B", "an empty OSM name falls back to the label")
        XCTAssertEqual(l[2].kind, "")
        XCTAssertNil(l[2].until)
        XCTAssertNil(l[3].until, "a bad until is ignored, the row kept")
        // missing or bad file: no labels, never a crash
        XCTAssertEqual(Landmarks.parse(nil), [])
        XCTAssertEqual(Landmarks.parse(Data("[]".utf8)), [])
        XCTAssertEqual(Landmarks.parse(Data("{\"l\": 5}".utf8)), [])
        XCTAssertEqual(Landmarks.parse(Data("not json".utf8)), [])
        XCTAssertEqual(StaticLoader.loadLandmarks(from: URL(fileURLWithPath: "/nonexistent-straight-bussing")), [])
    }

    // MARK: Zoom and tiers

    func testZoomMatchesLeaflet() {
        // Leaflet zoom 15 on a 400 pt map shows 400 / (256 * 2^15) of the world's 360 degrees
        near(Landmarks.zoom(longitudeDelta: 400.0 / (256 * pow(2, 15)) * 360, widthPoints: 400), 15, 1e-9)
        XCTAssertEqual(Landmarks.zoom(longitudeDelta: 0, widthPoints: 400), 0)
        XCTAssertEqual(Landmarks.zoom(longitudeDelta: 0.01, widthPoints: 0), 0)
        // the ground scale gives the same zoom (what the app measures, rotation-proof)
        for (w, d) in [(402.0, 0.012), (375.0, 0.03), (440.0, 0.005)] {
            let mpp = Geo.hav(LatLon(lat: 41.79, lon: -87.6), LatLon(lat: 41.79, lon: -87.6 + d)) / w
            near(Landmarks.zoom(metersPerPoint: mpp, latitude: 41.79), Landmarks.zoom(longitudeDelta: d, widthPoints: w), 0.002)
        }
        // the follow camera's own scale (AppModel.frameRegion: zoom 17 is about 0.89 m per point here)
        near(Landmarks.zoom(metersPerPoint: 0.8905, latitude: 41.79), 17, 0.01)
    }

    func testOpeningCameraShowsTier1() {
        // MapCameraModel.campus (0.03 degrees of longitude) on every iPhone width: tier 1 on with room to spare, the
        // group name "Max Palevsky Commons" instead of its three buildings, tiers 2 and 3 off
        XCTAssertEqual(Landmarks.minZoom[2], Landmarks.webZoom[2])
        XCTAssertEqual(Landmarks.minZoom[3], Landmarks.webZoom[3])
        for w in [375.0, 393, 402, 430, 440] {
            let z = Landmarks.zoom(longitudeDelta: 0.03, widthPoints: w)
            XCTAssertGreaterThanOrEqual(z, Landmarks.minZoom[1]! + 0.25, "\(w) pt")
            XCTAssertLessThan(z, Landmarks.minZoom[2]!, "\(w) pt")
        }
    }

    func testTierThresholdsUntilAndOrder() {
        let l = [mk("C", 3, 2), mk("B2", 2, 5), mk("A", 1, 1), mk("B", 2, 0), mk("Group", 1, 3, until: 15.5)]
        let box = GeoBox(minLat: 41.7, maxLat: 41.9, minLon: -87.7, maxLon: -87.5)
        XCTAssertEqual(Landmarks.visible(l, zoom: 13.7, in: box).map(\.name), [])
        XCTAssertEqual(Landmarks.visible(l, zoom: 13.75, in: box).map(\.name), ["A", "Group"])
        XCTAssertEqual(Landmarks.visible(l, zoom: 15.4, in: box).map(\.name), ["A", "Group"])
        XCTAssertEqual(Landmarks.visible(l, zoom: 15.5, in: box).map(\.name), ["A", "B", "B2"], "the group hands over at 15.5; tier, then the file's order")
        XCTAssertEqual(Landmarks.visible(l, zoom: 16.4, in: box).map(\.name), ["A", "B", "B2"])
        XCTAssertEqual(Landmarks.visible(l, zoom: 16.5, in: box).map(\.name), ["A", "B", "B2", "C"])
        XCTAssertEqual(Landmarks.visible([mk("X", 4, 0)], zoom: 20, in: box).map(\.name), [], "unknown tier never shows")
        // inside the box or within its margin (15% of its size by default, the web's bounds.pad(0.15))
        let small = GeoBox(minLat: 41.78, maxLat: 41.80, minLon: -87.61, maxLon: -87.59)
        let edge = [mk("in", 1, 0, lat: 41.79, lon: -87.6), mk("margin", 1, 1, lat: 41.802, lon: -87.6), mk("out", 1, 2, lat: 41.81, lon: -87.6)]
        XCTAssertEqual(Landmarks.visible(edge, zoom: 15, in: small).map(\.name), ["in", "margin"])
        XCTAssertEqual(Landmarks.visible(edge, zoom: 15, in: small, margin: 0).map(\.name), ["in"])
        XCTAssertNil(GeoBox([]))
    }

    func testFontSizesLikeTheWeb() {
        // web tests/map-landmarks.js: [labelSize(1, 14.5), labelSize(1, 18), labelSize(2, 15.5), labelSize(3, 19)]
        XCTAssertEqual([Landmarks.fontSize(tier: 1, zoom: 14.5), Landmarks.fontSize(tier: 1, zoom: 18),
                        Landmarks.fontSize(tier: 2, zoom: 15.5), Landmarks.fontSize(tier: 3, zoom: 19)], [11.5, 14.5, 11, 14])
        XCTAssertGreaterThan(Landmarks.fontSize(tier: 1, zoom: 16), Landmarks.fontSize(tier: 1, zoom: 15), "grows as you zoom in")
        XCTAssertEqual(Landmarks.fontSize(tier: 1, zoom: 14), 11.5, "held below its first zoom (the iPhone's wider opening view)")
        XCTAssertEqual(Landmarks.fontSize(tier: 1, zoom: 21), 14.5)
        XCTAssertEqual(Landmarks.fontSize(tier: 2, zoom: 17.25), 12.5)
        for z in stride(from: 13.0, through: 20.0, by: 0.1) {
            let s = Landmarks.fontSize(tier: 2, zoom: z)
            XCTAssertEqual(s * 2, (s * 2).rounded(), "to the half point")
        }
    }

    // MARK: Text boxes

    func testLineBreaks() {
        let w = { (s: String) in Landmarks.textWidth(s, size: 12) }
        XCTAssertEqual(Landmarks.lines("Target", size: 12), ["Target"])
        XCTAssertEqual(Landmarks.lines("  ", size: 12), [])
        XCTAssertEqual(Landmarks.lines("Law School", size: 12), ["Law School"])
        XCTAssertEqual(Landmarks.lines("Museum of Science and Industry", size: 11.5), ["Museum of", "Science and", "Industry"])
        XCTAssertEqual(Landmarks.lines("Regenstein Library", size: 11.5), ["Regenstein", "Library"])
        XCTAssertEqual(Landmarks.lines("Reynolds Club", size: 11.5), ["Reynolds Club"])
        // a word wider than the line keeps a line of its own, never broken
        XCTAssertEqual(Landmarks.lines("Supercalifragilisticexpialidocious Hall", size: 12), ["Supercalifragilisticexpialidocious", "Hall"])
        // every real label at every size: words kept in order, every line of two or more words within 8.5 ems
        for m in Self.real {
            for size in [11.0, 12.5, 14.5, 18.0] {
                let ls = Landmarks.lines(m.name, size: size)
                XCTAssertEqual(ls.joined(separator: " "), m.name.split(separator: " ").joined(separator: " "))
                for line in ls where line.contains(" ") {
                    XCTAssertLessThanOrEqual(Landmarks.textWidth(line, size: size), Landmarks.maxWidthEms * size + 1e-9, "\(m.name) at \(size)")
                }
            }
        }
        let t = Landmarks.textSize(["Regenstein", "Library"], size: 12)
        XCTAssertEqual(t.width, w("Regenstein").rounded(.up))
        XCTAssertEqual(t.height, (2 * 12 * Landmarks.lineHeightEm).rounded(.up))
    }

    #if canImport(CoreText)
    /// The estimate must hold every name drawn in the real bold system font (SF Pro), and not by so much that names
    /// are left out for nothing. CoreText on the macOS runner measures the same font the iPhone draws.
    func testWidthEstimateIsConservative() throws {
        func width(_ s: String, _ font: CTFont) -> Double {
            let attr = NSAttributedString(string: s, attributes: [NSAttributedString.Key(kCTFontAttributeName as String): font])
            return CTLineGetTypographicBounds(CTLineCreateWithAttributedString(attr), nil, nil, nil)
        }
        var tightest = 0.0, loosest = 10.0, tightName = "", sum = 0.0, n = 0.0
        for size in [11.0, 12.5, 14.5, 18.0] {
            let font = try XCTUnwrap(CTFontCreateUIFontForLanguage(.emphasizedSystem, CGFloat(size), nil))
            for m in Self.real {
                for line in Landmarks.lines(m.name, size: size) {
                    let r = width(line, font) / Landmarks.textWidth(line, size: size)
                    if r > tightest { tightest = r; tightName = "\(line) at \(size)" }
                    loosest = min(loosest, r)
                    sum += r; n += 1
                }
            }
        }
        let font = try XCTUnwrap(CTFontCreateUIFontForLanguage(.emphasizedSystem, 12, nil))
        let fontName = CTFontCopyFullName(font) as String
        let lineEm = Double(CTFontGetAscent(font) + CTFontGetDescent(font) + CTFontGetLeading(font)) / 12
        print("LANDMARK-WIDTH font \(fontName): real / estimate from \(loosest) to \(tightest) (\(tightName)), mean \(sum / n); line \(lineEm) em")
        XCTAssertLessThanOrEqual(tightest, 1.0, "a name wider than its box: \(tightName)")
        XCTAssertGreaterThan(loosest, 0.72, "the estimate is far too wide")
    }
    #endif

    // MARK: Placement (web tests/map-landmarks.js placeLabels)

    let view = LabelRect(minX: 0, minY: 0, maxX: 400, maxY: 600)
    func C(_ x: Double, _ y: Double, w: Double = 60, h: Double = 14) -> Landmarks.Box { .init(x: x, y: y, w: w, h: h) }

    func testPlacementOrderCenterFirstThenASide() {
        // the second takes a free side (every side at 4 pt still touches the first: 14 pt below)
        var p = Landmarks.placeBoxes([C(200, 300), C(205, 302)], obstacles: [], view: view)
        XCTAssertEqual(p.map { $0?.anchor }, [.center, .below])
        XCTAssertEqual(p[1]?.gap, 14)
        // room right under it: 4 pt
        p = Landmarks.placeBoxes([C(200, 300), C(200, 312)], obstacles: [], view: view)
        XCTAssertEqual(p[1]?.anchor, .below)
        XCTAssertEqual(p[1]?.gap, 4)
        // a stop under the center: moved off it, covering no stop
        let stop = LabelRect(x: 195, y: 295, width: 13, height: 13)
        p = Landmarks.placeBoxes([C(200, 300)], obstacles: [stop], view: view)
        XCTAssertNotEqual(p[0]?.anchor, .center)
        XCTAssertFalse(p[0]!.box.intersects(stop))
        // boxed in on every side within 14 pt: left out (it shows when you zoom in)
        var wall: [LabelRect] = []
        for x in stride(from: 0.0, to: 400, by: 10) { for y in stride(from: 250.0, to: 350, by: 10) { wall.append(LabelRect(x: x, y: y, width: 10, height: 10)) } }
        XCTAssertNil(Landmarks.placeBoxes([C(200, 300)], obstacles: wall, view: view)[0])
        // stays inside the view
        XCTAssertEqual(Landmarks.placeBoxes([C(395, 300)], obstacles: [], view: view)[0]?.anchor, .left)
        // a junk point never places
        XCTAssertNil(Landmarks.placeBoxes([C(.nan, 300)], obstacles: [], view: view)[0])
    }

    func testSpotsAndBoxes() {
        // centered, then the 8 sides at 4, then at 14: never farther
        XCTAssertEqual(Landmarks.spots.count, 17)
        XCTAssertEqual(Landmarks.spots.first?.anchor, .center)
        XCTAssertEqual(Landmarks.spots[1...8].map { $0.anchor }, LabelAnchor.sides)
        XCTAssertEqual(Landmarks.spots[9...].map { $0.anchor }, LabelAnchor.sides)
        XCTAssertEqual(Set(Landmarks.spots[1...8].map { $0.gap }), [4])
        XCTAssertEqual(Set(Landmarks.spots[9...].map { $0.gap }), [14])
        // web boxAt
        XCTAssertEqual(Landmarks.boxAt(100, 100, .center, gap: 0, w: 40, h: 10), LabelRect(x: 80, y: 95, width: 40, height: 10))
        XCTAssertEqual(Landmarks.boxAt(100, 100, .below, gap: 4, w: 40, h: 10), LabelRect(x: 80, y: 104, width: 40, height: 10))
        XCTAssertEqual(Landmarks.boxAt(100, 100, .above, gap: 4, w: 40, h: 10), LabelRect(x: 80, y: 86, width: 40, height: 10))
        XCTAssertEqual(Landmarks.boxAt(100, 100, .right, gap: 14, w: 40, h: 10), LabelRect(x: 114, y: 95, width: 40, height: 10))
        XCTAssertEqual(Landmarks.boxAt(100, 100, .left, gap: 14, w: 40, h: 10), LabelRect(x: 46, y: 95, width: 40, height: 10))
        XCTAssertEqual(Landmarks.boxAt(100, 100, .belowLeft, gap: 4, w: 40, h: 10), LabelRect(x: 56, y: 104, width: 40, height: 10))
        XCTAssertEqual(Landmarks.boxAt(100, 100, .aboveRight, gap: 4, w: 40, h: 10), LabelRect(x: 104, y: 86, width: 40, height: 10))
    }

    func testPlaceKeepsTheHigherPriorityAndThePlateGeometry() {
        let a = mk("Alpha Hall", 1, 3), b = mk("Beta Hall", 2, 0)
        // same point, given in the wrong order: tier 1 centered, tier 2 on a side
        let p = Landmarks.place([.init(landmark: b, x: 200, y: 300), .init(landmark: a, x: 200, y: 300)], zoom: 16, viewport: view)
        XCTAssertEqual(p.map(\.landmark.name), ["Alpha Hall", "Beta Hall"])
        XCTAssertEqual(p.map(\.anchor), [.center, .below])
        XCTAssertFalse(p[0].box.intersects(p[1].box))
        // within a tier, the file's order
        let c = mk("Gamma", 1, 0), d = mk("Delta", 1, 1)
        XCTAssertEqual(Landmarks.place([.init(landmark: d, x: 200, y: 300), .init(landmark: c, x: 200, y: 300)], zoom: 16, viewport: view).first?.landmark.name, "Gamma")
        // the plate sits in its box: text box + 2 wide, padded by 2 all round (web .sb-lm and LABEL.PAD)
        let q = p[1]
        XCTAssertEqual(q.gap, 14)
        XCTAssertEqual(q.box.width, q.plateWidth + 2)
        XCTAssertEqual(q.box.height, q.plateHeight + 4)
        XCTAssertEqual(q.padTop, 14 + 2, "below at 14 pt: the plate starts 16 pt under the point")
        XCTAssertEqual([q.padBottom, q.padLeading, q.padTrailing], [0, 0, 0])
        XCTAssertEqual(q.box.minY, 300 + 14)
        // a name right of its point: the plate starts gap + 1 to its right
        let r = Landmarks.place([.init(landmark: a, x: 395, y: 300)], zoom: 16, viewport: view)
        XCTAssertEqual(r.first?.anchor, .left)
        XCTAssertEqual(r.first?.padTrailing, 4 + 1)
        XCTAssertEqual(p[0].padTop + p[0].padBottom + p[0].padLeading + p[0].padTrailing, 0, "centered: no padding")
        // Dynamic Type scales the text and its box
        let big = Landmarks.place([.init(landmark: a, x: 200, y: 300)], zoom: 16, scale: 1.25, viewport: view)
        XCTAssertEqual(big[0].size, p[0].size * 1.25)
        XCTAssertGreaterThan(big[0].box.width, p[0].box.width)
    }

    /// Mercator projection in points (256-point tiles), like MapKit's flat map.
    func project(_ p: LatLon, center: LatLon, zoom: Double, size: (Double, Double) = (402, 790)) -> (Double, Double) {
        let scale = 256 * pow(2, zoom)
        func x(_ lon: Double) -> Double { (lon + 180) / 360 * scale }
        func y(_ lat: Double) -> Double { let s = sin(lat * .pi / 180); return (0.5 - log((1 + s) / (1 - s)) / (4 * .pi)) * scale }
        return (size.0 / 2 + x(p.lon) - x(center.lon), size.1 / 2 + y(p.lat) - y(center.lat))
    }

    func layout(center: LatLon, zoom z: Double, view v: LabelRect) -> (placed: [PlacedLandmark], stops: [LabelRect]) {
        let cands = Self.real.filter { Landmarks.shows($0, zoom: z) }.map { m -> Landmarks.Candidate in
            let (x, y) = project(m.coord, center: center, zoom: z)
            return .init(landmark: m, x: x, y: y)
        }
        var served = Set<String>()
        for list in TS.real.data.routeStops.values { served.formUnion(list) }
        let stops = served.sorted().compactMap { TS.real.data.stops[$0] }.map { s -> LabelRect in
            let (x, y) = project(s.coord, center: center, zoom: z)
            return LabelRect(centerX: x, centerY: y, width: 2 * Landmarks.stopR, height: 2 * Landmarks.stopR)
        }
        return (Landmarks.place(cands, zoom: z, viewport: v, obstacles: stops), stops)
    }

    /// The real data on the iPhone's opening camera (campus, zoom 14.2 on a 402 pt iPhone, the map above the collapsed
    /// sheet), every real stop an obstacle: tier 1 names on campus, none over another or over a stop.
    func testRealDataAtTheOpeningCamera() {
        let v = LabelRect(minX: 8, minY: 130, maxX: 394, maxY: 660)
        let z = Landmarks.zoom(longitudeDelta: 0.03, widthPoints: 402)
        let (p, stops) = layout(center: LatLon(lat: 41.7920, lon: -87.5960), zoom: z, view: v)
        print("LANDMARK-OPENING zoom \(z): \(p.count) names: " + p.map { "\($0.landmark.name) (\($0.anchor.rawValue) \($0.gap))" }.joined(separator: ", "))
        XCTAssertGreaterThanOrEqual(p.count, 5)
        XCTAssertTrue(p.allSatisfy { $0.landmark.tier == 1 })
        XCTAssertFalse(p.contains { $0.landmark.name.hasPrefix("Max Palevsky ") && $0.landmark.name != "Max Palevsky Commons" })
        for (i, a) in p.enumerated() {
            XCTAssertTrue(v.contains(a.box))
            for s in stops { XCTAssertFalse(a.box.intersects(s), "\(a.landmark.name) over a stop") }
            for b in p[(i + 1)...] { XCTAssertFalse(a.box.intersects(b.box), "\(a.landmark.name) over \(b.landmark.name)") }
        }
        // closer in (zoom 16.75 on the Main Quad): all three tiers can show, the three Max Palevsky buildings named
        let (p2, _) = layout(center: LatLon(lat: 41.7905, lon: -87.5995), zoom: 16.75, view: v)
        print("LANDMARK-QUAD zoom 16.75: \(p2.count) names: " + p2.map(\.landmark.name).joined(separator: ", "))
        XCTAssertTrue(p2.contains { $0.landmark.tier == 3 })
        XCTAssertFalse(p2.contains { $0.landmark.name == "Max Palevsky Commons" })
    }

    /// 87 labels with 100 obstacles, laid out on every camera end: cheap even in a debug build.
    func testPlaceIsCheap() {
        let cands = Self.real.enumerated().map { i, m in Landmarks.Candidate(landmark: m, x: Double(i % 9) * 45, y: Double(i / 9) * 60) }
        let obstacles = (0..<100).map { i in LabelRect(centerX: Double(i % 10) * 40, centerY: Double(i / 10) * 60, width: 13, height: 13) }
        let t0 = Date()
        for _ in 0..<20 { _ = Landmarks.place(cands, zoom: 17, viewport: view, obstacles: obstacles) }
        XCTAssertLessThan(Date().timeIntervalSince(t0) / 20, 0.02, "one layout under 20 ms even in a debug build")
    }
}
