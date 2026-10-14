import Foundation

// Building and place names on the map (owner 2026-10-13: "the buildings on the maps should also have their names like
// Google maps. Not every building, but highly trafficked ones and prominent off campus locations relevant to the bus
// coverage", "UChicago dorm buildings"). The data is web/data/landmarks.json (tools/build_landmarks.py, coordinates
// from OpenStreetMap). Port of web/js/map/landmarks.js: which tiers show at a zoom, each name's size and line breaks,
// and the greedy placement in screen space (priority order; centered on its building, else one of 8 sides at 4 pt,
// else at 14 pt, never farther; never over another name or a stop; no spot = left out until you zoom in).

/// A map label (one row of web/data/landmarks.json, web data/static.js cleanLandmarks).
public struct Landmark: Hashable, Sendable, Identifiable {
    /// The label drawn on the map.
    public var name: String
    public var coord: LatLon
    /// 1 = the busiest hubs, the UChicago dorms, the stop namesakes, groceries, stations (shown from the opening camera);
    /// 2 and 3 show only closer in (`Landmarks.minZoom`).
    public var tier: Int
    /// "dorm", "library", "transit", ... (not drawn).
    public var kind: String
    /// The OpenStreetMap name of the feature (the label may be shorter).
    public var osm: String
    /// The map zoom from which the label hides (a group name, "Max Palevsky Commons", once its buildings' own names
    /// show); nil = never.
    public var until: Double?
    /// Position in the cleaned list = priority (the file is sorted by tier, then priority).
    public var rank: Int
    public var id: Int { rank }

    public init(name: String, coord: LatLon, tier: Int, kind: String = "", osm: String? = nil, until: Double? = nil, rank: Int) {
        self.name = name; self.coord = coord; self.tier = tier; self.kind = kind; self.osm = osm ?? name
        self.until = until; self.rank = rank
    }
}

/// A rectangle in screen points (y down), the placement's unit.
public struct LabelRect: Hashable, Sendable {
    public var minX: Double, minY: Double, maxX: Double, maxY: Double
    public init(minX: Double, minY: Double, maxX: Double, maxY: Double) {
        self.minX = minX; self.minY = minY; self.maxX = maxX; self.maxY = maxY
    }
    public init(x: Double, y: Double, width: Double, height: Double) {
        self.init(minX: x, minY: y, maxX: x + width, maxY: y + height)
    }
    public init(centerX: Double, centerY: Double, width: Double, height: Double) {
        self.init(x: centerX - width / 2, y: centerY - height / 2, width: width, height: height)
    }
    public var width: Double { maxX - minX }
    public var height: Double { maxY - minY }
    public var midX: Double { (minX + maxX) / 2 }
    public var midY: Double { (minY + maxY) / 2 }
    /// Overlap with a positive area (touching edges do not count), the web's `hit`.
    public func intersects(_ o: LabelRect) -> Bool { minX < o.maxX && o.minX < maxX && minY < o.maxY && o.minY < maxY }
    public func contains(_ o: LabelRect) -> Bool { o.minX >= minX && o.maxX <= maxX && o.minY >= minY && o.maxY <= maxY }
}

/// A latitude / longitude box (the visible map, from its corners).
public struct GeoBox: Hashable, Sendable {
    public var minLat: Double, maxLat: Double, minLon: Double, maxLon: Double
    public init(minLat: Double, maxLat: Double, minLon: Double, maxLon: Double) {
        self.minLat = minLat; self.maxLat = maxLat; self.minLon = minLon; self.maxLon = maxLon
    }
    /// The box around these points (nil without a valid point).
    public init?(_ pts: [LatLon]) {
        let ok = pts.filter(\.isValid)
        guard let a = ok.map(\.lat).min(), let b = ok.map(\.lat).max(), let c = ok.map(\.lon).min(), let d = ok.map(\.lon).max() else { return nil }
        self.init(minLat: a, maxLat: b, minLon: c, maxLon: d)
    }
    public func contains(_ p: LatLon) -> Bool { p.lat >= minLat && p.lat <= maxLat && p.lon >= minLon && p.lon <= maxLon }
    /// Grown by `fraction` of its size on every side (Leaflet bounds.pad).
    public func expanded(_ fraction: Double) -> GeoBox {
        let dLat = (maxLat - minLat) * fraction, dLon = (maxLon - minLon) * fraction
        return GeoBox(minLat: minLat - dLat, maxLat: maxLat + dLat, minLon: minLon - dLon, maxLon: maxLon + dLon)
    }
}

/// Where a name sits relative to its building (web landmarks.js anchors): centered on it, or on one side.
public enum LabelAnchor: String, Sendable, CaseIterable {
    case center, below, above, right, left
    case belowRight = "below-right", belowLeft = "below-left", aboveRight = "above-right", aboveLeft = "above-left"
    /// The 8 sides in the order they are tried.
    public static let sides: [LabelAnchor] = [.below, .above, .right, .left, .belowRight, .belowLeft, .aboveRight, .aboveLeft]
    /// Horizontal side: -1 left of the point, 0 centered, 1 right.
    public var dx: Int {
        switch self {
        case .right, .belowRight, .aboveRight: return 1
        case .left, .belowLeft, .aboveLeft: return -1
        default: return 0
        }
    }
    /// Vertical side (y down): -1 above the point, 0 centered, 1 below.
    public var dy: Int {
        switch self {
        case .below, .belowRight, .belowLeft: return 1
        case .above, .aboveRight, .aboveLeft: return -1
        default: return 0
        }
    }
}

/// A placed name: what to draw and where.
public struct PlacedLandmark: Hashable, Sendable, Identifiable {
    public var landmark: Landmark
    /// The line breaks to draw exactly (the box was measured for them).
    public var lines: [String]
    /// Font size in points (bold system font).
    public var size: Double
    public var anchor: LabelAnchor
    /// Points between the point and the near edge(s) of the padded box (0 when centered; 4 or 14 on a side).
    public var gap: Double
    /// The plate behind the text: the estimated text width plus 2 by the line height times the lines (web .sb-lm).
    public var plateWidth: Double
    public var plateHeight: Double
    /// The padded box that was checked (plate plus `Landmarks.pad` around the text), in the caller's screen points.
    public var box: LabelRect
    public var id: Int { landmark.rank }
    public var text: String { lines.joined(separator: "\n") }

    /// Room between the point and the plate on the side(s) facing it: drawn with the plate anchored at the point by
    /// `anchor`, this puts the plate exactly where `box` was checked.
    public var padTop: Double { anchor.dy == 1 ? gap + (box.height - plateHeight) / 2 : 0 }
    public var padBottom: Double { anchor.dy == -1 ? gap + (box.height - plateHeight) / 2 : 0 }
    public var padLeading: Double { anchor.dx == 1 ? gap + (box.width - plateWidth) / 2 : 0 }
    public var padTrailing: Double { anchor.dx == -1 ? gap + (box.width - plateWidth) / 2 : 0 }
}

/// The pure rules of the map labels (web map/landmarks.js, data/static.js cleanLandmarks).
public enum Landmarks {
    /// First map zoom of each tier on the web (landmarks.js LANDMARK_Z, Leaflet zoom; the web opens at 15).
    public static let webZoom: [Int: Double] = [1: 14.5, 2: 16, 3: 17]
    /// First zoom of each tier on the iPhone, in the same zoom (`zoom(longitudeDelta:widthPoints:)`). As the web, except
    /// tier 1: the iPhone opens wider than the web (MapCameraModel.campus, 0.03 degrees of longitude: zoom 14.1 on a
    /// 375 pt iPhone to 14.4 at 440 pt, the web 15), and tier 1 must show at the opening camera.
    public static let minZoom: [Int: Double] = [1: 13.75, 2: 16, 3: 17]
    /// Box padding (points) around a name; two names never come closer than twice this (web LABEL.PAD).
    public static let pad = 2.0
    /// Half the side of a stop as an obstacle (web LABEL.STOP_R: a 13 pt square around the stop dot).
    public static let stopR = 6.5
    /// Line breaks at about this many ems (web LABEL.MAX_EM).
    public static let maxWidthEms = 8.5
    /// Line height in ems (web LABEL.LINE).
    public static let lineHeightEm = 1.12
    /// Gaps (points) between the point and a name on one of its sides: 4, then 14, never farther (web LABEL.GAPS).
    public static let gaps: [Double] = [4, 14]
    /// The halo drawn around the letters in the map's background color (points).
    public static let halo = 1.5

    // MARK: Data

    /// One JSON value of a row (strings and numbers; anything else is `other`).
    enum Cell: Decodable {
        case string(String), number(Double), other
        init(from decoder: Decoder) throws {
            let c = try decoder.singleValueContainer()
            if let s = try? c.decode(String.self) { self = .string(s) }
            else if let d = try? c.decode(Double.self) { self = .number(d) }
            else { self = .other }
        }
        /// The web's `num`: numbers, and strings holding a number; NaN otherwise.
        var number: Double {
            switch self {
            case .number(let d): return d
            case .string(let s):
                let t = s.trimmingCharacters(in: .whitespaces)
                return t.isEmpty ? .nan : Double(t) ?? .nan
            case .other: return .nan
            }
        }
        var string: String? { if case .string(let s) = self { return s }; return nil }
    }

    struct File: Decodable { var l: [StaticLoader.Lossy<[Cell]>] }

    /// landmarks.json ({"l": [[label, lat, lon, tier, kind, osm, until?], ...]}) as landmarks in file order. Missing or
    /// bad data = an empty list, never a throw; a bad row (no label, a coordinate that is not a number or off the
    /// globe, a tier other than 1 / 2 / 3) is dropped and a bad `until` is ignored, like the web's cleanLandmarks.
    public static func parse(_ data: Data?) -> [Landmark] {
        guard let data, let f = try? JSONDecoder().decode(File.self, from: data) else { return [] }
        var out: [Landmark] = []
        for row in f.l {
            guard let r = row.value, r.count >= 4, let name = r[0].string?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !name.isEmpty else { continue }
            let lat = r[1].number, lon = r[2].number, tier = r[3].number
            guard lat.isFinite, lon.isFinite, abs(lat) <= 90, abs(lon) <= 180, [1.0, 2.0, 3.0].contains(tier) else { continue }
            let kind = r.count > 4 ? r[4].string ?? "" : ""
            let osm = r.count > 5 ? r[5].string.flatMap { $0.isEmpty ? nil : $0 } : nil
            let until = r.count > 6 ? r[6].number : .nan
            out.append(Landmark(name: name, coord: LatLon(lat: lat, lon: lon), tier: Int(tier), kind: kind, osm: osm,
                                until: until.isFinite ? until : nil, rank: out.count))
        }
        return out
    }

    // MARK: Zoom and which labels

    /// Web Mercator zoom with 256-point tiles (Leaflet's zoom, the one the web app's map reports): the world is
    /// 256 * 2^z points wide, so a map `widthPoints` wide showing `longitudeDelta` degrees is at
    /// log2(360 * widthPoints / (256 * longitudeDelta)). 0 for a degenerate input.
    public static func zoom(longitudeDelta: Double, widthPoints: Double) -> Double {
        guard longitudeDelta > 0, widthPoints > 0, longitudeDelta.isFinite, widthPoints.isFinite else { return 0 }
        return log2(360 * widthPoints / (256 * longitudeDelta))
    }

    /// The same zoom from the ground scale at the map's center (meters per point), which a rotated map keeps.
    public static func zoom(metersPerPoint: Double, latitude: Double) -> Double {
        guard metersPerPoint > 0, metersPerPoint.isFinite, latitude.isFinite else { return 0 }
        let world = 2 * Double.pi * Geo.earthRadius * cos(latitude * Geo.rad)
        return log2(world / (256 * metersPerPoint))
    }

    /// Shown at this zoom: the tier is on (`minZoom`) and the label has not handed over to its buildings (`until`).
    public static func shows(_ l: Landmark, zoom: Double) -> Bool {
        guard let z = minZoom[l.tier], zoom >= z else { return false }
        return l.until.map { zoom < $0 } ?? true
    }

    /// The labels to place at this zoom: shown (`shows`) and inside the visible box grown by `margin` of its size (a
    /// name just off the edge can still reach in; web bounds.pad(0.15)). Priority order: tier, then the file's order.
    public static func visible(_ list: [Landmark], zoom: Double, in box: GeoBox, margin: Double = 0.15) -> [Landmark] {
        let b = box.expanded(margin)
        return list.filter { shows($0, zoom: zoom) && b.contains($0.coord) }.sorted(by: priority)
    }

    /// Tier first, then the file's order.
    public static func priority(_ a: Landmark, _ b: Landmark) -> Bool { a.tier != b.tier ? a.tier < b.tier : a.rank < b.rank }

    /// Font size (points) of a tier at a zoom, before Dynamic Type (web labelSize): tier 1 11.5 at zoom 14.5 to 14.5 at
    /// 18, tiers 2 and 3 11 at their first zoom to 14 at 19, linear, held at the ends, to the half point.
    public static func fontSize(tier: Int, zoom: Double) -> Double {
        let (z0, s0, z1, s1) = tier == 1 ? (14.5, 11.5, 18.0, 14.5) : (webZoom[tier] ?? 16, 11.0, 19.0, 14.0)
        let k = min(1, max(0, (zoom - z0) / (z1 - z0)))
        return ((s0 + (s1 - s0) * k) * 2).rounded() / 2
    }

    // MARK: Text boxes (estimated, conservative)

    /// Advance widths (1/1000 em) of printable ASCII in a bold grotesque (Helvetica Bold's metrics; digits and the hyphen
    /// widened to SF Pro's, which draws them wider: "55th-56th-57th" measured 6% over Helvetica's), from U+0020.
    static let asciiWidths: [Double] = [
        278, 333, 474, 556, 556, 889, 722, 278, 333, 333, 389, 584, 278, 400, 278, 278,   // space ! " # $ % & ' ( ) * + , - . /
        680, 680, 680, 680, 680, 680, 680, 680, 680, 680, 333, 333, 584, 584, 584, 611,   // 0-9 : ; < = > ?
        975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,   // @ A-O
        667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,   // P-Z [ \ ] ^ _
        333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,   // ` a-o
        611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,        // p-z { | } ~
    ]
    /// The table times this is the estimate: a little wider than the bold system font (SF Pro) at map sizes, so a drawn
    /// name never spills out of its box (LandmarksTests measures every label with CoreText and checks it).
    public static let widthFactor = 1.12

    /// Width of one character in ems (estimate).
    static func em(_ u: Unicode.Scalar) -> Double {
        let v = Int(u.value)
        if v >= 0x20 && v < 0x20 + asciiWidths.count { return asciiWidths[v - 0x20] / 1000 * widthFactor }
        if v == 0x2019 || v == 0x2018 { return 0.278 * widthFactor }   // curly apostrophes
        if v >= 0x2E80 { return 1.0 * widthFactor }                    // CJK and wider
        return 0.72 * widthFactor                                      // accented letters and the rest: a wide letter
    }

    /// Estimated width (points) of one line of bold text at `size`.
    public static func textWidth(_ s: String, size: Double) -> Double {
        s.unicodeScalars.reduce(0) { $0 + em($1) } * size
    }

    /// Greedy word wrap at `maxWidthEms` (web wrapLines): words never broken, a word wider than that on a line of its own.
    public static func lines(_ name: String, size: Double) -> [String] {
        let maxW = maxWidthEms * size
        var out: [String] = [], cur = ""
        for w in name.split(whereSeparator: { $0 == " " || $0 == "\n" || $0 == "\t" }).map(String.init) {
            let t = cur.isEmpty ? w : cur + " " + w
            if cur.isEmpty || textWidth(t, size: size) <= maxW { cur = t } else { out.append(cur); cur = w }
        }
        if !cur.isEmpty { out.append(cur) }
        return out
    }

    /// The text box of these lines at `size` (web: the widest line and lines x size x 1.12, both rounded up).
    public static func textSize(_ lines: [String], size: Double) -> (width: Double, height: Double) {
        ((lines.map { textWidth($0, size: size) }.max() ?? 0).rounded(.up), (Double(lines.count) * size * lineHeightEm).rounded(.up))
    }

    // MARK: Placement

    /// A label to place: its screen point and its text box (before padding), in priority order.
    public struct Box: Sendable {
        public var x: Double, y: Double, w: Double, h: Double
        public init(x: Double, y: Double, w: Double, h: Double) { self.x = x; self.y = y; self.w = w; self.h = h }
    }

    /// The spots tried, in order: centered, then the 8 sides at 4 pt, then at 14 pt (never farther: a name stays by
    /// its building).
    public static let spots: [(anchor: LabelAnchor, gap: Double)] = {
        var out: [(anchor: LabelAnchor, gap: Double)] = [(anchor: .center, gap: 0)]
        for g in gaps { for a in LabelAnchor.sides { out.append((anchor: a, gap: g)) } }
        return out
    }()

    /// The padded box of a text box (w x h) at a spot (web boxAt).
    public static func boxAt(_ x: Double, _ y: Double, _ a: LabelAnchor, gap g: Double, w: Double, h: Double) -> LabelRect {
        let left: Double = a.dx == 0 ? x - w / 2 : a.dx > 0 ? x + g : x - g - w
        let top: Double = a.dy == 0 ? y - h / 2 : a.dy > 0 ? y + g : y - g - h
        return LabelRect(x: left, y: top, width: w, height: h)
    }

    /// Greedy placement (web placeLabels without its basemap-text rule): in the given order each label takes the first
    /// spot (`spots`) whose padded box fits inside `view` and covers no label already placed and no obstacle; a label
    /// with no such spot is left out. Returns, per candidate, its spot and padded box, or nil.
    public static func placeBoxes(_ cands: [Box], obstacles: [LabelRect], view: LabelRect) -> [(anchor: LabelAnchor, gap: Double, box: LabelRect)?] {
        var taken: [LabelRect] = []
        return cands.map { c -> (anchor: LabelAnchor, gap: Double, box: LabelRect)? in
            guard c.x.isFinite, c.y.isFinite, c.w.isFinite, c.h.isFinite else { return nil }
            let w = c.w + 2 * pad, h = c.h + 2 * pad
            for s in spots {
                let box = boxAt(c.x, c.y, s.anchor, gap: s.gap, w: w, h: h)
                guard view.contains(box), !taken.contains(where: { $0.intersects(box) }),
                      !obstacles.contains(where: { $0.intersects(box) }) else { continue }
                taken.append(box)
                return (s.anchor, s.gap, box)
            }
            return nil
        }
    }

    /// A landmark at its point on screen.
    public struct Candidate: Sendable {
        public var landmark: Landmark
        public var x: Double
        public var y: Double
        public init(landmark: Landmark, x: Double, y: Double) { self.landmark = landmark; self.x = x; self.y = y }
    }

    /// The names to draw: sized for the zoom (`fontSize` times the Dynamic Type `scale`, which the caller caps),
    /// wrapped, then placed (`placeBoxes`) in priority order (tier, then the file's order) inside `viewport`, clear of
    /// each other and of the `obstacles` (stop dots, and on the iPhone also the trip's stop labels, you, the
    /// destination and the locate button).
    public static func place(_ candidates: [Candidate], zoom: Double, scale: Double = 1, viewport: LabelRect,
                             obstacles: [LabelRect] = []) -> [PlacedLandmark] {
        struct Sized { var c: Candidate; var size: Double; var lines: [String]; var w: Double; var h: Double }
        let sized: [Sized] = candidates.sorted { priority($0.landmark, $1.landmark) }.compactMap { c -> Sized? in
            let size = Landmarks.fontSize(tier: c.landmark.tier, zoom: zoom) * max(0.5, scale)
            let ls = Landmarks.lines(c.landmark.name, size: size)
            guard !ls.isEmpty else { return nil }
            let t = Landmarks.textSize(ls, size: size)
            return Sized(c: c, size: size, lines: ls, w: t.width, h: t.height)
        }
        let placed = placeBoxes(sized.map { Box(x: $0.c.x, y: $0.c.y, w: $0.w, h: $0.h) }, obstacles: obstacles, view: viewport)
        var out: [PlacedLandmark] = []
        for (s, p) in zip(sized, placed) {
            guard let p else { continue }
            out.append(PlacedLandmark(landmark: s.c.landmark, lines: s.lines, size: s.size, anchor: p.anchor, gap: p.gap,
                                      plateWidth: s.w + 2, plateHeight: s.h, box: p.box))
        }
        return out
    }
}

extension StaticLoader {
    /// landmarks.json from a directory (the app bundle's `data` folder). Missing or bad = no labels; never throws.
    /// Bundled only: the names are curated (tools/landmarks.json) and change with an app update, not with the daily
    /// schedule download (`ScheduleUpdater.files` does not include it).
    public static func loadLandmarks(from dir: URL) -> [Landmark] {
        Landmarks.parse(try? Data(contentsOf: dir.appendingPathComponent("landmarks.json")))
    }
}
