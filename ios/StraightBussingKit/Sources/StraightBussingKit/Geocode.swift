import Foundation

/// Address and place search beyond the on-device index (web/js/data/geocode.js): Photon (photon.komoot.io,
/// OpenStreetMap data), asked ONLY when the local index has fewer than 5 matches, or when the user asks for an
/// exact search. Privacy: Photon gets only the typed text (or its spelling correction, when results are shown for
/// it) plus fixed constants (Hyde Park bias point, Illinois bounding box), never the user's location. Results:
/// Illinois only, re-ranked toward UChicago / Hyde Park, labeled with their distance from campus beyond 3 km.
public enum Photon {
    /// API endpoint.
    public static let endpoint = "https://photon.komoot.io/api/"
    /// UChicago / Hyde Park: the bias point and the origin for client-side ranking.
    public static let home = LatLon(lat: 41.7886, lon: -87.5987)
    /// Approximate Illinois bounding box [minLon, minLat, maxLon, maxLat].
    public static let ilBBox = [-91.52, 36.97, -87.49, 42.51]
    /// Results shown (normal search) / for "search exactly" (local + Photon).
    public static let limit = 5
    public static let limitExact = 8
    /// Local score below this = matched only a category or an address, not a name.
    static let weak = 75
    public static let timeout: TimeInterval = 8
    static let tiers = [3.0, 20.0, 80.0]
    static let tierStep = 8.0
    static let kmPerPoint = 5.0
    static let kmCap = 20.0
    static let maxExtraWords = 3
    static let farKm = 3.0
    static let settlements: Set<String> = ["city", "town", "village"]
    static let major: Set<String> = ["railway:station", "aeroway:aerodrome", "aeroway:terminal", "building:train_station",
        "amenity:university", "amenity:college", "amenity:library", "amenity:hospital", "amenity:bus_station",
        "tourism:museum", "tourism:zoo", "tourism:attraction", "leisure:park", "leisure:stadium",
        "place:city", "place:town", "place:village", "place:suburb", "place:neighbourhood"]
    static let minor: Set<String> = ["amenity:parking", "amenity:parking_entrance", "amenity:bicycle_rental",
        "highway:bus_stop", "public_transport:platform", "public_transport:stop_position", "railway:stop",
        "railway:platform", "railway:subway_entrance"]
    /// Cook County townships that lie inside Chicago; Photon often reports these instead of the city.
    static let chicagoTownships: Set<String> = ["hyde park township", "lake township", "jefferson township",
        "north chicago township", "west chicago township", "south chicago township", "lake view township",
        "rogers park township"]

    /// One Photon GeoJSON feature: coordinates + string properties (numbers kept as text).
    public struct Feature: Hashable, Sendable {
        public var lon: Double
        public var lat: Double
        public var props: [String: String]
        public init(lon: Double, lat: Double, props: [String: String]) { self.lon = lon; self.lat = lat; self.props = props }
    }

    struct FeatureEntity: Decodable {
        var value: Feature?
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: AnyKey.self)
            var lon: Double? = nil, lat: Double? = nil
            if let g = c.obj("geometry"), var u = g.list("coordinates") {
                lon = try? u.decode(Double.self)
                lat = try? u.decode(Double.self)
            }
            var props: [String: String] = [:]
            if let p = c.obj("properties") {
                for k in p.allKeys { if let v = p.str(k.stringValue) { props[k.stringValue] = v } }
            }
            if let lon, let lat, lon.isFinite, lat.isFinite { value = Feature(lon: lon, lat: lat, props: props) } else { value = nil }
        }
    }

    struct Envelope: Decodable {
        var features: LossyList<FeatureEntity>
    }

    /// Features of a Photon response; throws when it is not a FeatureCollection.
    public static func parse(_ data: Data) throws -> [Feature] {
        try JSONDecoder().decode(Envelope.self, from: data).features.items.compactMap(\.value)
    }

    /// Request URL for a query: text + fixed bias + Illinois bbox (never the user's location).
    public static func url(_ query: String) -> URL {
        // encodeURIComponent's unreserved set: everything else is percent-encoded
        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.!~*'()")
        let q = query.addingPercentEncoding(withAllowedCharacters: allowed) ?? ""
        return URL(string: endpoint + "?q=" + q + "&limit=15&lang=en&lat=41.7886&lon=-87.5987&zoom=10&location_bias_scale=0.2"
                   + "&bbox=-91.52,36.97,-87.49,42.51")!
    }

    /// Distance in km (equirectangular; fine at state scale).
    static func km(_ lat1: Double, _ lon1: Double, _ lat2: Double, _ lon2: Double) -> Double {
        let r = Double.pi / 180
        let x = (lon2 - lon1) * r * cos(((lat1 + lat2) / 2) * r)
        return 6371 * (x * x + pow((lat2 - lat1) * r, 2)).squareRoot()
    }

    /// Locality for the sub line: city, or "Chicago" for Chicago townships, else district / county.
    static func locality(_ p: [String: String]) -> String {
        let city = p["city"] ?? ""
        if !city.isEmpty && chicagoTownships.contains(city.lowercased()) { return "Chicago" }
        if !city.isEmpty && !city.lowercased().hasSuffix(" township") { return city }
        if let d = p["district"], !d.isEmpty { return d }
        if !city.isEmpty { return city }
        if let c = p["county"], !c.isEmpty { return c.lowercased().hasSuffix("county") ? c : c + " County" }
        return ""
    }

    /// A suggestion for one feature: `sub` shows street, city and state.
    public static func featureToPlace(_ f: Feature, _ q: String) -> PlaceHit {
        let p = f.props
        let name = p["name"] ?? ""
        let road = p["street"] ?? "", number = p["housenumber"] ?? ""
        let street = road.isEmpty ? "" : (number.isEmpty ? "" : number + " ") + road
        let loc = locality(p)
        let st = p["state"] ?? ""
        let state = st.isEmpty ? "" : (st.lowercased() == "illinois" ? "IL" : st)
        let label = !name.isEmpty ? name : !street.isEmpty ? street : !loc.isEmpty ? loc : q
        let sub = [name.isEmpty ? "" : street, loc == label ? "" : loc, state].filter { !$0.isEmpty }.joined(separator: ", ")
        return PlaceHit(label: label, sub: sub.isEmpty ? "Place" : sub, lat: f.lat, lon: f.lon, walk: 0, stop: "", score: 0, local: false)
    }

    /// Illinois-only rule: drop non-US; if a state is given it must be Illinois; else the point must be in the bbox.
    public static func inIllinois(_ f: Feature) -> Bool {
        let p = f.props
        if let cc = p["countrycode"], !cc.isEmpty, cc.uppercased() != "US" { return false }
        if (p["countrycode"] ?? "").isEmpty, let c = p["country"], !c.isEmpty, !c.lowercased().hasPrefix("united states") { return false }
        if let s = p["state"], !s.isEmpty {
            let t = s.trimmingCharacters(in: .whitespaces).lowercased()
            return t == "illinois" || t == "il"
        }
        return f.lon >= ilBBox[0] && f.lon <= ilBBox[2] && f.lat >= ilBBox[1] && f.lat <= ilBBox[3]
    }

    /// Lowercase words, apostrophes dropped (geocode.js `words`).
    static func words(_ s: String?) -> [String] {
        let t = (s ?? "").lowercased().replacingOccurrences(of: "'", with: "").replacingOccurrences(of: "\u{2019}", with: "")
        return t.split(whereSeparator: { !($0.isLetter || $0.isNumber) }).map(String.init)
    }

    /// Filter to Illinois, dedupe, and re-rank Photon features toward campus (lower score is better): Photon rank
    /// + 8 per distance tier (3 / 20 / 80 km) + 1 per 5 km (max 4) + 1 per name word not in the query (max 3),
    /// -2 for major kinds, +3 for by-products; an exact-name city / town / village is pinned first.
    public static func rankPlaces(_ features: [Feature], _ query: String) -> [PlaceHit] {
        let qw = words(query), qn = qw.joined(separator: " ")
        var scored: [(place: PlaceHit, score: Double, d: Double)] = []
        for (i, f) in features.enumerated() {
            guard inIllinois(f) else { continue }
            let place = featureToPlace(f, query)
            let p = f.props
            let d = km(home.lat, home.lon, place.lat, place.lon)
            let tier = Double(tiers.filter { d > $0 }.count)
            let nw = words(p["name"])
            let extra = min(maxExtraWords, nw.filter { w in !qw.contains { w.hasPrefix($0) } }.count)
            let kind = (p["osm_key"] ?? "undefined") + ":" + (p["osm_value"] ?? "undefined")
            var score = Double(i) + tierStep * tier + min(d, kmCap) / kmPerPoint + Double(extra)
                + (major.contains(kind) ? -2 : minor.contains(kind) ? 3 : 0)
            if p["osm_key"] == "place", let v = p["osm_value"], settlements.contains(v), nw.joined(separator: " ") == qn { score = -100 }
            scored.append((place, score, d))
        }
        scored = scored.stableSorted { a, b in a.score != b.score ? a.score < b.score : a.d < b.d }
        var out: [PlaceHit] = []
        for s in scored {
            // same name within 300 m (stops, entrances, duplicates), or same name and sub line within 2 km (a street
            // split into segments), is the same place: keep the better-ranked one
            let dup = out.contains { o in o.label == s.place.label && km(o.lat, o.lon, s.place.lat, s.place.lon) < (o.sub == s.place.sub ? 2 : 0.3) }
            if !dup { out.append(s.place) }
            if out.count >= limit { break }
        }
        for i in out.indices {
            let d = km(home.lat, home.lon, out[i].lat, out[i].lon)
            if d > farKm {
                let dist = d < 10 ? String(format: "%.1f", d) : String(Int(JS.round(d)))
                out[i].sub = (out[i].sub.isEmpty ? "" : out[i].sub + " · ") + "\(dist) km from campus"
            }
        }
        return out
    }

    /// Local results first (all within a 30-minute walk of a campus stop), then Photon results that are not the same
    /// place (within 150 m and one name contains the other), at most `limit`. Local results that only matched a
    /// category or an address (score < 75) go after Photon's.
    public static func mergePlaces(_ local: [PlaceHit], _ remote: [PlaceHit], limit: Int = Photon.limit) -> [PlaceHit] {
        let weakOnes = local.filter { $0.score < weak }
        var out = Array(local.filter { !($0.score < weak) }.prefix(limit))
        func same(_ o: PlaceHit, _ r: PlaceHit) -> Bool {
            let on = PlaceIndex.norm(o.label), rn = PlaceIndex.norm(r.label)
            return (on.contains(rn) || rn.contains(on)) && km(o.lat, o.lon, r.lat, r.lon) < 0.15
        }
        for r in remote {
            if out.count >= limit { break }
            let twin = weakOnes.first { same($0, r) }
            if !out.contains(where: { same($0, r) }) { out.append(twin ?? r) }
        }
        for w in weakOnes where out.count < limit && !out.contains(w) { out.append(w) }
        return out
    }
}

/// One place search outcome (data/geocode.js searchPlaces): items, an optional spelling assumption, and an error
/// ('timeout' | 'network' | 'http <status>' | 'bad response') when Photon failed and nothing was found.
public struct PlaceSearchResult: Hashable, Sendable {
    public var items: [PlaceHit]
    public var assumed: SearchAssumption?
    public var error: String?
    /// Photon was asked (false = answered on the device: nothing was sent).
    public var remote: Bool
    public init(items: [PlaceHit], assumed: SearchAssumption? = nil, error: String? = nil, remote: Bool = false) {
        self.items = items; self.assumed = assumed; self.error = error; self.remote = remote
    }
}

/// Local index first, Photon only when it has fewer than 5 matches (or for an exact search); results cached in
/// memory (30 queries). An actor so the app can call it from any task; cancellation is honored.
public actor PlaceSearcher {
    public let loader: HTTPDataLoader
    static let cacheMax = 30
    private var cache: [String: PlaceSearchResult] = [:]
    private var cacheOrder: [String] = []

    public init(loader: HTTPDataLoader = URLSession.shared) { self.loader = loader }

    /// Local results only, synchronously (on-device; never sends anything).
    public static func local(_ q: String, index: PlaceIndex?, exact: Bool = false) -> LocalPlaces {
        index?.find(q, limit: Photon.limit, exact: exact) ?? LocalPlaces(items: [])
    }

    /// Would `search` ask Photon for this query? (false = fully answered on the device)
    public static func needsRemote(_ q: String, local: LocalPlaces, exact: Bool) -> Bool {
        let query = q.trimmingCharacters(in: .whitespacesAndNewlines)
        if PlaceIndex.norm(query).count < 2 || query.utf16.count < 3 { return false }
        return exact || local.items.count < Photon.limit
    }

    /// Search places by free text. Never throws. Max 5 (8 exact): local first, then Photon (Illinois only, nearest
    /// to UChicago first) when the local index has fewer than 5 matches. When a spelling correction was assumed,
    /// Photon gets the corrected text.
    public func search(_ q: String, index: PlaceIndex?, exact: Bool = false) async -> PlaceSearchResult {
        let query = q.trimmingCharacters(in: .whitespacesAndNewlines)
        if PlaceIndex.norm(query).count < 2 { return PlaceSearchResult(items: []) }
        let key = (exact ? "=" : "") + query.lowercased()
        if let hit = cache[key] { return hit }
        let local = Self.local(query, index: index, exact: exact)
        if !Self.needsRemote(query, local: local, exact: exact) {
            let r = PlaceSearchResult(items: local.items, assumed: local.assumed)
            remember(key, r)
            return r
        }
        let remote = await photon(local.assumed?.to ?? query)
        if Task.isCancelled { return PlaceSearchResult(items: [], error: "aborted", remote: true) }
        let items = Photon.mergePlaces(local.items, remote.items, limit: exact ? Photon.limitExact : Photon.limit)
        if items.isEmpty, let e = remote.error { return PlaceSearchResult(items: [], error: e, remote: true) }
        let r = PlaceSearchResult(items: items, assumed: local.assumed, remote: true)
        if remote.error == nil { remember(key, r) }
        return r
    }

    private func remember(_ key: String, _ r: PlaceSearchResult) {
        if cache[key] == nil { cacheOrder.append(key) }
        cache[key] = r
        if cacheOrder.count > Self.cacheMax { cache[cacheOrder.removeFirst()] = nil }
    }

    /// Clear the in-memory cache (tests).
    public func clearCache() { cache = [:]; cacheOrder = [] }

    /// Photon only, ranked by `Photon.rankPlaces`. Never throws.
    func photon(_ query: String) async -> (items: [PlaceHit], error: String?) {
        var req = URLRequest(url: Photon.url(query), cachePolicy: .useProtocolCachePolicy, timeoutInterval: Photon.timeout)
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        do {
            let (data, resp) = try await loader.fetchData(for: req)
            if let h = resp as? HTTPURLResponse, !(200...299).contains(h.statusCode) { return ([], "http \(h.statusCode)") }
            guard let features = try? Photon.parse(data) else { return ([], "bad response") }
            return (Photon.rankPlaces(features, query), nil)
        } catch {
            if (error as? URLError)?.code == .timedOut { return ([], "timeout") }
            if (error as? URLError)?.code == .cancelled || Task.isCancelled { return ([], "aborted") }
            return ([], "network")
        }
    }
}
