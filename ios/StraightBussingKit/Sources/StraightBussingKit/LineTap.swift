import Foundation

/// A tap on a route line on the map (owner 2026-10-27: "the uppermost line on the layers ... should open as if the
/// user clicked the specific route"). Port of web map/geometry.js `segDistPx` / `lineAt`: the TOPMOST drawn line within
/// `reach` points of the tap, plus half its drawn width, wins, even where a line below it passes closer. Pure: the app
/// projects the route shapes to screen points (MapReader) and gives them bottom to top, in the map's draw order.
public enum LineTap {
    /// Finger-sized reach beyond a line's edge, in points (web `LINE_TAP_PX`).
    public static let reach: Double = 14

    /// One drawn polyline: its route, its points on screen (the tap's coordinate space) and its drawn width.
    public struct Line: Sendable {
        public let rid: String
        public let px: [SIMD2<Double>]
        public let width: Double
        public init(rid: String, px: [SIMD2<Double>], width: Double) {
            self.rid = rid
            self.px = px
            self.width = width
        }
    }

    /// Distance from `p` to the segment a-b (a zero-length segment is its point).
    public static func segDist(_ p: SIMD2<Double>, _ a: SIMD2<Double>, _ b: SIMD2<Double>) -> Double {
        let d = b - a, l2 = d.x * d.x + d.y * d.y
        let t = l2 > 0 ? max(0, min(1, ((p.x - a.x) * d.x + (p.y - a.y) * d.y) / l2)) : 0
        let q = a + t * d
        return ((q.x - p.x) * (q.x - p.x) + (q.y - p.y) * (q.y - p.y)).squareRoot()
    }

    /// The route under a tap: the topmost of `lines` (bottom to top) passing within `reach` + width / 2 of `pt`.
    public static func lineAt(_ pt: SIMD2<Double>, lines: [Line], reach: Double = reach) -> String? {
        for l in lines.reversed() where !l.px.isEmpty {
            let lim = reach + l.width / 2
            if l.px.count == 1 {
                if segDist(pt, l.px[0], l.px[0]) <= lim { return l.rid }
                continue
            }
            for j in 1..<l.px.count where segDist(pt, l.px[j - 1], l.px[j]) <= lim { return l.rid }
        }
        return nil
    }
}
