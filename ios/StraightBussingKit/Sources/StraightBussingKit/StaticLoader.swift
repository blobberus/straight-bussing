import Foundation

/// Loads the bundled web/data JSON (data/static.js). Each file loads independently; a missing or bad file
/// yields an empty slice instead of failing, and the names of failed files are reported.
public enum StaticLoader {
    /// [file name, required].
    public static let files: [(String, Bool)] = [
        ("routes.json", true), ("stops.json", true), ("shapes.json", true), ("route_stops.json", true),
        ("stop_addresses.json", false), ("service.json", false), ("segments.json", false),
    ]

    public struct Loaded: Sendable {
        public var data: StaticData
        public var failed: [String]
    }

    struct RawRoute: Decodable {
        var short: String?, long: String?, color: String?, text_color: String?
    }
    struct RawStop: Decodable {
        var name: String?
        var lat: Double?
        var lon: Double?
        enum CodingKeys: String, CodingKey { case name, lat, lon }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            name = (try? c.decode(String.self, forKey: .name)) ?? (try? c.decode(Int.self, forKey: .name)).map(String.init)
            func num(_ k: CodingKeys) -> Double? {
                if let d = try? c.decode(Double.self, forKey: k) { return d }
                if let s = try? c.decode(String.self, forKey: k) { return Double(s) }
                return nil
            }
            lat = num(.lat); lon = num(.lon)
        }
    }
    struct Lossy<T: Decodable>: Decodable {
        var value: T?
        init(from decoder: Decoder) throws { value = try? T(from: decoder) }
    }

    /// Parse each file's data (nil = missing). Pure, used by `load(from:)` and tests.
    public static func parse(_ files: [String: Data]) -> Loaded {
        var failed: [String] = []
        let dec = JSONDecoder()
        func get<T: Decodable>(_ name: String, _ type: T.Type) -> T? {
            guard let d = files[name] else { failed.append(name); return nil }
            do { return try dec.decode(T.self, from: d) } catch { failed.append(name); return nil }
        }
        var routes: [String: Route] = [:]
        for (id, r) in get("routes.json", [String: Lossy<RawRoute>].self) ?? [:] {
            guard let r = r.value else { continue }
            routes[id] = Route(id: id, short: r.short ?? "", long: r.long ?? "", color: r.color ?? "", textColor: r.text_color ?? "")
        }
        var stops: [String: Stop] = [:]
        for (id, s) in get("stops.json", [String: Lossy<RawStop>].self) ?? [:] {
            guard let s = s.value, let lat = s.lat, let lon = s.lon, lat.isFinite, lon.isFinite else { continue }
            stops[id] = Stop(id: id, name: s.name ?? "Stop \(id)", lat: lat, lon: lon)
        }
        var shapes: [String: [[LatLon]]] = [:]
        for (id, lines) in get("shapes.json", [String: Lossy<[[[Double]]]>].self) ?? [:] {
            guard let lines = lines.value else { continue }
            let ok = lines.map { $0.compactMap { $0.count >= 2 ? LatLon(lat: $0[0], lon: $0[1]) : nil } }.filter { !$0.isEmpty }
            shapes[id] = ok
        }
        var routeStops: [String: [String]] = [:]
        for (id, list) in get("route_stops.json", [String: Lossy<[String]>].self) ?? [:] {
            if let list = list.value { routeStops[id] = list }
        }
        var addresses: [String: StopAddress] = [:]
        for (id, a) in get("stop_addresses.json", [String: Lossy<StopAddress>].self) ?? [:] {
            if let a = a.value, !a.address.isEmpty { addresses[id] = a }
        }
        let service = get("service.json", ServiceData.self) ?? ServiceData()
        let segments = get("segments.json", SegmentsData.self)
        let data = StaticData(routes: routes, stops: stops, shapes: shapes, routeStops: routeStops, addresses: addresses,
                              service: service, segments: segments, generated: service.generated)
        return Loaded(data: data, failed: failed)
    }

    /// Load every file from a directory (the app bundle's `data` folder). Never throws.
    public static func load(from dir: URL) -> Loaded {
        var raw: [String: Data] = [:]
        for (name, _) in files { if let d = try? Data(contentsOf: dir.appendingPathComponent(name)) { raw[name] = d } }
        return parse(raw)
    }

    /// Load places.json from a directory (nil when missing or bad).
    public static func loadPlaces(from dir: URL) -> PlaceIndex? {
        guard let d = try? Data(contentsOf: dir.appendingPathComponent("places.json")),
              let p = try? JSONDecoder().decode(PlacesData.self, from: d), !p.p.isEmpty else { return nil }
        return PlaceIndex(p)
    }
}
