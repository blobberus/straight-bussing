import Foundation

/// A coordinate. Port of the web's `{lat, lon}` objects (web/js/core/geo.js).
public struct LatLon: Codable, Hashable, Sendable {
    public var lat: Double
    public var lon: Double
    public init(lat: Double, lon: Double) { self.lat = lat; self.lon = lon }
    /// Both values finite (the web's `okPt`).
    public var isValid: Bool { lat.isFinite && lon.isFinite }
}

/// Geographic helpers (web/js/core/geo.js). Pure.
public enum Geo {
    static let earthRadius = 6_371_000.0
    static let rad = Double.pi / 180

    /// Walking pace in meters per minute (shared by planner and walk estimate).
    public static let walkMetersPerMin = 80.0
    /// Straight-line to street-distance factor for walking estimates.
    public static let walkDetour = 1.2

    /// Great-circle (haversine) distance in meters.
    public static func hav(_ a: LatLon, _ b: LatLon) -> Double {
        let dLa = (b.lat - a.lat) * rad, dLo = (b.lon - a.lon) * rad
        let x = pow(sin(dLa / 2), 2) + cos(a.lat * rad) * cos(b.lat * rad) * pow(sin(dLo / 2), 2)
        return 2 * earthRadius * asin(min(1, x.squareRoot()))
    }

    /// Walking minutes for a distance (meters / 80).
    public static func walkMin(_ meters: Double) -> Double { meters / walkMetersPerMin }

    /// Initial bearing from a to b in degrees, 0 = north, clockwise, [0, 360).
    public static func bearing(_ a: LatLon, _ b: LatLon) -> Double {
        let la1 = a.lat * rad, la2 = b.lat * rad, dLo = (b.lon - a.lon) * rad
        let y = sin(dLo) * cos(la2)
        let x = cos(la1) * sin(la2) - sin(la1) * cos(la2) * cos(dLo)
        return (atan2(y, x) / rad + 360).truncatingRemainder(dividingBy: 360)
    }

    /// A stop with its distance from a point (result of `nearestStops`).
    public struct NearStop: Hashable, Sendable {
        public var id: String
        public var name: String
        public var lat: Double
        public var lon: Double
        public var d: Double
    }

    /// Nearest stops to a point by straight-line distance.
    /// - Parameters:
    ///   - max: result count (default 3); maxM: radius in meters
    ///   - routeStops: if given, only stops that appear on at least one route are returned.
    public static func nearestStops(_ stops: [String: Stop], _ point: LatLon, max: Int = 3,
                                    maxM: Double = .infinity, routeStops: [String: [String]]? = nil) -> [NearStop] {
        guard point.isValid else { return [] }
        var served: Set<String>? = nil
        if let routeStops { served = Set(routeStops.values.flatMap { $0 }) }
        var out: [NearStop] = []
        for (id, s) in stops {
            guard s.coord.isValid else { continue }
            if let served, !served.contains(id) { continue }
            let d = hav(point, s.coord)
            if d <= maxM { out.append(NearStop(id: id, name: s.name, lat: s.lat, lon: s.lon, d: d)) }
        }
        out.sort { $0.d < $1.d || ($0.d == $1.d && $0.id < $1.id) }
        return Array(out.prefix(max))
    }
}

/// Straight-line x 1.2 walking estimate (web/js/core/walk.js `walkEstimate`).
public struct WalkResult: Hashable, Sendable {
    public enum Source: String, Codable, Sendable { case router, estimate }
    public var m: Double
    public var min: Double
    public var coords: [LatLon]
    public var source: Source
    public init(m: Double, min: Double, coords: [LatLon], source: Source) {
        self.m = m; self.min = min; self.coords = coords; self.source = source
    }

    /// Straight line x 1.2 at 80 m/min. `m` is rounded like the web; `min` uses the unrounded distance.
    public static func estimate(_ a: LatLon, _ b: LatLon) -> WalkResult {
        let m = Geo.hav(a, b) * Geo.walkDetour
        return WalkResult(m: JS.round(m), min: Geo.walkMin(m), coords: [a, b], source: .estimate)
    }
}

/// Small helpers that reproduce JavaScript semantics the web logic relies on.
public enum JS {
    /// `Math.round`: halves round toward +infinity.
    public static func round(_ x: Double) -> Double { (x + 0.5).rounded(.down) }

    /// Is this key an "array index" that `Object.keys` lists first, in numeric order?
    static func isIndexKey(_ k: String) -> Bool {
        guard !k.isEmpty, k.count <= 10, k.allSatisfy({ $0.isASCII && $0.isNumber }) else { return false }
        if k.count > 1 && k.hasPrefix("0") { return false }
        guard let v = UInt64(k) else { return false }
        return v < 4_294_967_295
    }

    /// The order `Object.keys` would give for a JSON object parsed in the browser: integer-like keys in
    /// ascending numeric order first, then the other keys (lexicographic here, since Foundation's JSON
    /// parser does not keep insertion order). All GTFS route ids are numeric, so this matches the web.
    public static func keyOrder<S: Sequence>(_ keys: S) -> [String] where S.Element == String {
        let all = Array(keys)
        let idx = all.filter(isIndexKey).sorted { UInt64($0)! < UInt64($1)! }
        let rest = all.filter { !isIndexKey($0) }.sorted()
        return idx + rest
    }
}

extension Array {
    /// Stable sort (ties keep input order), like `Array.prototype.sort` in modern JavaScript.
    func stableSorted(by less: (Element, Element) -> Bool) -> [Element] {
        enumerated().sorted { a, b in
            if less(a.element, b.element) { return true }
            if less(b.element, a.element) { return false }
            return a.offset < b.offset
        }.map(\.element)
    }
}
