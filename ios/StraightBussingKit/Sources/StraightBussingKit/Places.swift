import Foundation

/// A local place search hit (data/places.js searchLocal item).
public struct PlaceHit: Hashable, Sendable, Identifiable {
    public var label: String
    /// 'Kind · address · N min walk to <stop>'.
    public var sub: String
    public var lat: Double
    public var lon: Double
    public var walk: Int
    public var stop: String
    public var score: Int
    public var id: String { "\(label)|\(lat),\(lon)" }
    public var coord: LatLon { LatLon(lat: lat, lon: lon) }
}

/// One entry of places.json `p`: [name, kind, address, lat, lon, stop index, walk minutes, search terms,
/// other names?] (v2: nicknames / OSM alt names, e.g. "Bart Mart" for Bartlett Dining Commons).
public struct PlaceRecord: Hashable, Sendable {
    public var name: String
    public var kind: String
    public var address: String
    public var lat: Double
    public var lon: Double
    public var stopIndex: Int
    public var walk: Int
    public var terms: String
    public var aliases: [String]
    public init(_ name: String, _ kind: String, _ address: String, _ lat: Double, _ lon: Double, _ stopIndex: Int, _ walk: Int,
                _ terms: String, _ aliases: [String] = []) {
        self.name = name; self.kind = kind; self.address = address; self.lat = lat; self.lon = lon
        self.stopIndex = stopIndex; self.walk = walk; self.terms = terms; self.aliases = aliases
    }
}

/// web/data/places.json.
public struct PlacesData: Decodable, Sendable {
    public var stops: [String]
    public var p: [PlaceRecord]
    public init(stops: [String], p: [PlaceRecord]) { self.stops = stops; self.p = p }

    struct Row: Decodable {
        var value: PlaceRecord?
        init(from decoder: Decoder) throws {
            var u = try decoder.unkeyedContainer()
            func s() -> String {
                if let v = try? u.decode(String.self) { return v }
                _ = try? u.decode(Skip.self)
                return ""
            }
            func d() -> Double {
                if let v = try? u.decode(Double.self) { return v }
                _ = try? u.decode(Skip.self)
                return .nan
            }
            let name = s(), kind = s(), addr = s(), lat = d(), lon = d(), si = d(), walk = d(), terms = u.isAtEnd ? "" : s()
            var aliases: [String] = []
            if !u.isAtEnd { aliases = (try? u.decode([String].self)) ?? [] }
            value = name.isEmpty || !lat.isFinite || !lon.isFinite ? nil
                : PlaceRecord(name, kind, addr, lat, lon, si.isFinite ? Int(si) : -1, walk.isFinite ? Int(walk) : 0, terms, aliases)
        }
    }
    enum CodingKeys: String, CodingKey { case stops, p }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        stops = (try? c.decode([String].self, forKey: .stops)) ?? []
        p = try c.decode(LossyList<Row>.self, forKey: .p).items.compactMap(\.value)
    }
}

/// On-device search over the campus places index (web/js/data/places.js). Forgiving: punctuation and spaces
/// are ignored ("chickfila" = "Chick-fil-A"), word prefixes match, one typo is allowed in longer words, and
/// categories work ("coffee", "grocery", "apartments"). Ranked by match quality, then walk to the nearest
/// stop. Sends nothing anywhere.
public struct PlaceIndex: Sendable {
    public static let limit = 5
    static let minScore = 50.0
    static let synonyms: [String: [String]] = [
        "coffee": ["cafe", "coffee"], "cafe": ["cafe", "coffee"], "grocery": ["supermarket", "greengrocer", "grocery"],
        "groceries": ["supermarket", "greengrocer", "grocery"], "food": ["restaurant", "fast", "cafe"], "restaurant": ["restaurant"],
        "restaurants": ["restaurant"], "apartment": ["apartments"], "apartments": ["apartments"], "apt": ["apartments"],
        "apts": ["apartments"], "dorm": ["dormitory", "dorm"], "dorms": ["dormitory", "dorm"], "drugstore": ["pharmacy", "chemist"],
        "pharmacy": ["pharmacy", "chemist"], "gas": ["fuel"], "gym": ["fitness", "gym"], "bar": ["bar", "pub"], "bars": ["bar", "pub"],
        "pizza": ["pizza"], "burger": ["burger"], "burgers": ["burger"], "library": ["library"], "church": ["worship", "church"],
        "bank": ["bank"], "hotel": ["hotel"],
    ]

    /// A searchable form of the name: the real name first, then nicknames.
    struct Form: Sendable { var words: [String]; var sq: String }
    struct Entry: Sendable { var p: PlaceRecord; var forms: [Form]; var all: [String] }
    /// A nickname match ranks just below the same exact / prefix match on the real name.
    static let aliasPenalty = 0.5
    /// Per name word the query does not mention (max 3): "univ of chicago" prefers the shorter name.
    static let unmatchedPenalty = 0.5
    let data: PlacesData
    let index: [Entry]

    public init(_ data: PlacesData) {
        self.data = data
        index = data.p.map { p in
            var seen = Set<String>()
            var forms: [Form] = []
            for text in [p.name] + p.aliases {
                let n = Self.norm(text)
                if !n.isEmpty && seen.insert(n).inserted {
                    forms.append(Form(words: n.split(separator: " ").map(String.init), sq: n.replacingOccurrences(of: " ", with: "")))
                }
            }
            let extra = Self.norm([p.kind, p.address, p.terms].joined(separator: " ")).split(separator: " ").map(String.init)
            return Entry(p: p, forms: forms, all: forms.flatMap(\.words) + extra)
        }
    }

    public var count: Int { index.count }

    /// Lowercase, strip accents and punctuation, "&" -> "and", words separated by single spaces.
    public static func norm(_ s: String) -> String {
        var scalars = String.UnicodeScalarView()
        for u in s.decomposedStringWithCanonicalMapping.unicodeScalars where !(0x300...0x36F).contains(u.value) { scalars.append(u) }
        let stripped = String(scalars).lowercased()
        var out = ""
        var pendingSpace = false
        for ch in stripped.replacingOccurrences(of: "&", with: " and ").unicodeScalars {
            let v = ch.value
            if v == 0x27 || v == 0x2019 || v == 0x60 || v == 0x2E { continue }   // ' ’ ` .
            if (v >= 0x61 && v <= 0x7A) || (v >= 0x30 && v <= 0x39) {
                if pendingSpace && !out.isEmpty { out.append(" ") }
                pendingSpace = false
                out.unicodeScalars.append(ch)
            } else {
                pendingSpace = true
            }
        }
        return out
    }

    /// Edit distance <= 1 (insert, delete, substitute or swap two neighbours).
    static func near1(_ a: [UInt8], _ b: [UInt8]) -> Bool {
        if a == b { return true }
        let la = a.count, lb = b.count
        if abs(la - lb) > 1 { return false }
        var i = 0
        while i < la && i < lb && a[i] == b[i] { i += 1 }
        func tail(_ x: [UInt8], _ from: Int) -> ArraySlice<UInt8> { from >= x.count ? [] : x[from...] }
        if la == lb {
            if tail(a, i + 1) == tail(b, i + 1) { return true }
            return i + 1 < la && a[i] == b[i + 1] && a[i + 1] == b[i] && tail(a, i + 2) == tail(b, i + 2)
        }
        return la > lb ? tail(a, i + 1) == tail(b, i) : tail(a, i) == tail(b, i + 1)
    }

    /// Best weight of one query word against words: 1 exact, .85 prefix, .7 one typo, 0 none.
    static func wordWeight(_ q: String, _ words: [String], fuzzy: Bool = true) -> Double {
        var best = 0.0
        let qb = Array(q.utf8)
        for w in words {
            if w == q { return 1 }
            if q.count >= 2 && w.hasPrefix(q) { best = max(best, 0.85) }
            else if fuzzy && q.count >= 5 && w.count >= 4 && near1(qb, Array(w.utf8)) { best = max(best, 0.7) }
        }
        return best
    }

    /// Score one place for a query (0 = no match). Name and nickname matches beat category / address matches.
    static func scorePlace(_ e: Entry, _ qw: [String], _ qsq: String) -> Double {
        var best = 0.0
        for (k, f) in e.forms.enumerated() {
            let alias = k > 0 ? aliasPenalty : 0
            var s = 0.0
            if f.sq == qsq { s = 100 - alias }
            else if qsq.count >= 3 && f.sq.hasPrefix(qsq) { s = 92 - alias }
            else {
                let ws = qw.map { wordWeight($0, f.words) }
                if ws.allSatisfy({ $0 > 0 }) {
                    let rest = f.words.filter { w in !qw.contains { w.hasPrefix($0) } }.count
                    s = 60 + 25 * (ws.reduce(0, +) / Double(ws.count)) + (ws[0] == 1 && f.words.first == qw[0] ? 3 : 0)
                        - unmatchedPenalty * Double(min(3, rest))
                } else if qsq.count >= 4 && f.sq.contains(qsq) {
                    s = 70
                }
            }
            best = max(best, s)
        }
        if best > 0 { return best }
        let xs = qw.map { q in max(wordWeight(q, e.all), (synonyms[q] ?? []).map { wordWeight($0, e.all, fuzzy: false) }.max() ?? 0) }
        if xs.allSatisfy({ $0 > 0 }) { return 45 + 20 * (xs.reduce(0, +) / Double(xs.count)) }
        return 0
    }

    /// Search the places (pure). Queries under 2 normalized characters return nothing.
    public func search(_ q: String, limit: Int = PlaceIndex.limit) -> [PlaceHit] {
        let n = Self.norm(q)
        guard n.count >= 2 else { return [] }
        let qw = n.split(separator: " ").map(String.init), qsq = n.replacingOccurrences(of: " ", with: "")
        var hits: [(Double, Entry)] = []
        for e in index {
            let s = Self.scorePlace(e, qw, qsq)
            if s >= Self.minScore { hits.append((s, e)) }
        }
        let en = Locale(identifier: "en_US")
        let sorted = hits.stableSorted { a, b in
            if a.0 != b.0 { return a.0 > b.0 }
            if a.1.p.walk != b.1.p.walk { return a.1.p.walk < b.1.p.walk }
            return a.1.p.name.compare(b.1.p.name, locale: en) == .orderedAscending
        }
        return sorted.prefix(limit).map { hit in
            let s = hit.0, p = hit.1.p
            let stop = p.stopIndex >= 0 && p.stopIndex < data.stops.count ? data.stops[p.stopIndex] : ""
            let walk = "\(p.walk) min walk to \(stop.isEmpty ? "a shuttle stop" : stop)"
            let sub = [p.kind != "Place" ? p.kind : "", p.address, walk].filter { !$0.isEmpty }.joined(separator: " · ")
            return PlaceHit(label: p.name, sub: sub, lat: p.lat, lon: p.lon, walk: p.walk, stop: stop, score: Int(JS.round(s)))
        }
    }
}
