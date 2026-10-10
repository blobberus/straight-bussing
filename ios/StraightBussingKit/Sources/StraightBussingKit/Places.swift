import Foundation

/// A local place search hit (data/places.js searchLocal item).
public struct PlaceHit: Hashable, Sendable, Identifiable {
    public var label: String
    /// 'Kind, address · N min walk to <stop>' (one middle dot per line).
    public var sub: String
    public var lat: Double
    public var lon: Double
    public var walk: Int
    public var stop: String
    public var score: Int
    /// From the on-device index (else a Photon result: `walk` 0, `stop` '', `score` 0).
    public var local: Bool = true
    public var id: String { "\(label)|\(lat),\(lon)" }
    public var coord: LatLon { LatLon(lat: lat, lon: lon) }
}

/// What a corrected search assumed (data/places.js findLocal `assumed`): results are for `to`, typed was `from`.
/// `big`: a long stretch (2+ edits in a word, 2+ words, or a space added / removed) the UI should mention.
public struct SearchAssumption: Hashable, Sendable {
    public var from: String
    public var to: String
    public var big: Bool
    public init(from: String, to: String, big: Bool) { self.from = from; self.to = to; self.big = big }
}

/// `PlaceIndex.find` result.
public struct LocalPlaces: Hashable, Sendable {
    public var items: [PlaceHit]
    public var assumed: SearchAssumption?
    public init(items: [PlaceHit], assumed: SearchAssumption? = nil) { self.items = items; self.assumed = assumed }
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
    /// When tools/build_places.py made the file ("2026-10-09T17:17Z"); decides which copy is newer.
    public var generated: String?
    public init(stops: [String], p: [PlaceRecord], generated: String? = nil) { self.stops = stops; self.p = p; self.generated = generated }

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
    enum CodingKeys: String, CodingKey { case stops, p, generated }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        generated = try? c.decode(String.self, forKey: .generated)
        stops = (try? c.decode([String].self, forKey: .stops)) ?? []
        p = try c.decode(LossyList<Row>.self, forKey: .p).items.compactMap(\.value)
    }
}

/// On-device search over the campus places index (web/js/data/places.js). Forgiving: punctuation and spaces
/// are ignored ("chickfila" = "Chick-fil-A"), word prefixes match, one typo is allowed in longer words,
/// nicknames count as names ("Reg", "Max P") and categories work ("coffee", "grocery", "apartments"). Ranked by
/// match quality, then walk to the nearest stop. When nothing matches well, the query is spell-corrected
/// (`Spell`) against the words of the place names, nicknames and stop names, and the result says what it
/// assumed. Sends nothing anywhere.
public struct PlaceIndex: Sendable {
    public static let limit = 5
    static let minScore = 50.0
    /// A typed query this good is never corrected.
    static let strong = 88.0
    /// A correction must match every word of a name (not only categories / addresses)...
    static let nameLevel = 75.0
    /// ... and beat what was typed by this much.
    static let margin = 4.0
    /// The query is a whole name or the start of one (a risky correction needs this).
    static let whole = 92.0
    /// Query words that mean a kind of place (matched against OSM tag values kept in the search terms).
    static let synonyms: [String: [String]] = [
        "coffee": ["cafe", "coffee"], "cafe": ["cafe", "coffee"], "grocery": ["supermarket", "greengrocer", "grocery"],
        "groceries": ["supermarket", "greengrocer", "grocery"], "food": ["restaurant", "fast", "cafe", "dining"], "restaurant": ["restaurant"],
        "restaurants": ["restaurant"], "apartment": ["apartments"], "apartments": ["apartments"], "apt": ["apartments"],
        "apts": ["apartments"], "dorm": ["dormitory", "dorm"], "dorms": ["dormitory", "dorm"], "drugstore": ["pharmacy", "chemist"],
        "pharmacy": ["pharmacy", "chemist"], "gas": ["fuel"], "gym": ["fitness", "gym", "sports"], "bar": ["bar", "pub"], "bars": ["bar", "pub"],
        "pizza": ["pizza"], "burger": ["burger"], "burgers": ["burger"], "library": ["library"], "church": ["worship", "church"],
        "bank": ["bank"], "hotel": ["hotel"], "train": ["station", "train"], "parking": ["parking"], "garage": ["parking"],
        "dining": ["dining"],
    ]

    /// A searchable form of the name: the real name first, then nicknames. `text` = as written.
    /// `words` / `sq` are normalized (ASCII a-z 0-9); `wb` / `sqb` are their bytes, made once for the search loops.
    struct Form: Sendable {
        var words: [String]; var sq: String; var text: String
        var wb: [[UInt8]]; var sqb: [UInt8]
        init(words: [String], sq: String, text: String) {
            self.words = words; self.sq = sq; self.text = text
            wb = words.map { Array($0.utf8) }; sqb = Array(sq.utf8)
        }
    }
    struct Entry: Sendable {
        var p: PlaceRecord; var forms: [Form]; var all: [String]
        var allB: [[UInt8]]
        init(p: PlaceRecord, forms: [Form], all: [String]) {
            self.p = p; self.forms = forms; self.all = all; allB = all.map { Array($0.utf8) }
        }
    }
    /// A query prepared once per ranking pass: normalized words, their bytes, squashed bytes, synonym bytes.
    struct Query {
        var words: [String]; var wb: [[UInt8]]; var sqb: [UInt8]; var syn: [[[UInt8]]]
        init(_ qw: [String]) {
            words = qw; wb = qw.map { Array($0.utf8) }; sqb = Array(qw.joined().utf8)
            syn = qw.map { (PlaceIndex.synonyms[$0] ?? []).map { Array($0.utf8) } }
        }
    }
    /// A nickname match ranks just below the same exact / prefix match on the real name.
    static let aliasPenalty = 0.5
    /// Per name word the query does not mention (max 3): "univ of chicago" prefers the shorter name.
    static let unmatchedPenalty = 0.5
    let data: PlacesData
    let index: [Entry]
    /// Spelling vocabulary and display forms ("dangelo" -> "D'Angelo") of names, nicknames, kinds, stop names.
    let vocab: Spell.Vocab
    let display: [String: String]

    public init(_ data: PlacesData) {
        self.data = data
        let index: [Entry] = data.p.map { p in
            var seen = Set<String>()
            var forms: [Form] = []
            for text in [p.name] + p.aliases {
                let n = Self.norm(text)
                if !n.isEmpty && seen.insert(n).inserted {
                    forms.append(Form(words: n.split(separator: " ").map(String.init), sq: n.replacingOccurrences(of: " ", with: ""), text: text))
                }
            }
            let extra = Self.norm([p.kind, p.address, p.terms].joined(separator: " ")).split(separator: " ").map(String.init)
            return Entry(p: p, forms: forms, all: forms.flatMap(\.words) + extra)
        }
        self.index = index
        let words = Self.buildWords(data, index)
        vocab = words.vocab
        display = words.display
    }

    /// Split like data/places.js `learn` (whitespace, hyphens, en dash, slash, comma, parentheses, ampersand).
    static func pieces(_ s: String) -> [String] {
        let seps: Set<Character> = ["-", "\u{2013}", "/", ",", "(", ")", "&"]
        return s.split(whereSeparator: { $0.isWhitespace || seps.contains($0) }).map(String.init)
    }

    /// `t` without leading / trailing characters that are not letters or digits.
    static func trimNonAlnum(_ t: String) -> String {
        let keep: (Character) -> Bool = { $0.isLetter || $0.isNumber }
        guard let a = t.firstIndex(where: keep), let b = t.lastIndex(where: keep) else { return "" }
        return String(t[a...b])
    }

    /// Spelling vocabulary + display forms from names, nicknames, kinds and stop names (data/places.js buildWords).
    static func buildWords(_ d: PlacesData, _ idx: [Entry]) -> (vocab: Spell.Vocab, display: [String: String]) {
        var texts: [String] = []
        var show: [String: String] = [:]
        func learn(_ orig: String) {
            for t in pieces(orig) {
                let k = norm(t)
                if k.isEmpty || k.contains(" ") { continue }
                let clean = trimNonAlnum(t)
                if let old = show[k] {
                    if old == old.lowercased() && clean != clean.lowercased() { show[k] = clean }
                } else {
                    show[k] = clean
                }
            }
        }
        for e in idx {
            for f in e.forms { texts.append(f.words.joined(separator: " ")) }
            texts.append(norm(e.p.kind))
            learn(e.p.name)
            for a in e.p.aliases { learn(a) }
        }
        for s in d.stops { texts.append(norm(s)); learn(s) }
        texts.append(synonyms.keys.sorted().joined(separator: " "))
        return (Spell.buildVocab(texts), show)
    }

    public var count: Int { index.count }
    /// `generated` of the places.json this index was built from.
    public var generated: String? { data.generated }

    /// Lowercase, strip accents and punctuation, "&" -> "and", words separated by single spaces.
    public static func norm(_ s: String) -> String {
        if let fast = normASCII(s) { return fast }
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

    /// `norm` for pure-ASCII text (nearly every name): the same steps on bytes, without Unicode decomposition.
    /// nil when the text has any non-ASCII character (then the general path runs).
    static func normASCII(_ s: String) -> String? {
        var out: [UInt8] = []
        out.reserveCapacity(s.utf8.count)
        var pendingSpace = false
        func letter(_ c: UInt8) {
            if pendingSpace && !out.isEmpty { out.append(0x20) }
            pendingSpace = false
            out.append(c)
        }
        for var c in s.utf8 {
            if c >= 0x80 { return nil }
            if c >= 0x41 && c <= 0x5A { c += 0x20 }   // A-Z -> a-z
            if c == 0x26 {                            // "&" -> " and "
                pendingSpace = true
                letter(0x61); letter(0x6E); letter(0x64)
                pendingSpace = true
                continue
            }
            if c == 0x27 || c == 0x60 || c == 0x2E { continue }   // ' ` .
            if (c >= 0x61 && c <= 0x7A) || (c >= 0x30 && c <= 0x39) { letter(c) } else { pendingSpace = true }
        }
        return String(decoding: out, as: UTF8.self)
    }

    /// `w` starts with `q` (bytes).
    @inline(__always) static func hasPrefix(_ w: [UInt8], _ q: [UInt8]) -> Bool {
        if q.count > w.count { return false }
        for i in 0..<q.count where w[i] != q[i] { return false }
        return true
    }

    /// `q` occurs somewhere in `w` (bytes).
    static func contains(_ w: [UInt8], _ q: [UInt8]) -> Bool {
        let n = w.count, m = q.count
        if m == 0 { return true }
        if m > n { return false }
        outer: for i in 0...(n - m) {
            for k in 0..<m where w[i + k] != q[k] { continue outer }
            return true
        }
        return false
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
        wordWeight(Array(q.utf8), words.map { Array($0.utf8) }, fuzzy: fuzzy)
    }

    /// `wordWeight` on normalized bytes (normalized text is ASCII, so byte counts are letter counts).
    static func wordWeight(_ q: [UInt8], _ words: [[UInt8]], fuzzy: Bool = true) -> Double {
        var best = 0.0
        let qn = q.count
        for w in words {
            if w == q { return 1 }
            if qn >= 2 && hasPrefix(w, q) { best = max(best, 0.85) }
            else if fuzzy && qn >= 5 && w.count >= 4 && best < 0.7 && near1(q, w) { best = 0.7 }
        }
        return best
    }

    /// Score one place for a query (0 = no match). Name and nickname matches beat category / address matches.
    /// - Parameters:
    ///   - fuzzy: allow one typo per word
    ///   - names: names and nicknames only (no category / address matches)
    static func scorePlace(_ e: Entry, _ qw: [String], _ qsq: String, fuzzy: Bool = true, names: Bool = false) -> Double {
        scorePlace(e, Query(qw), fuzzy: fuzzy, names: names)
    }

    /// `scorePlace` for a prepared query (bytes compared, nothing allocated per place unless words match).
    static func scorePlace(_ e: Entry, _ q: Query, fuzzy: Bool = true, names: Bool = false) -> Double {
        var best = 0.0
        let qn = q.sqb.count
        for (k, f) in e.forms.enumerated() {
            let alias = k > 0 ? aliasPenalty : 0
            var s = 0.0
            if f.sqb == q.sqb { s = 100 - alias }
            else if qn >= 3 && hasPrefix(f.sqb, q.sqb) { s = whole - alias }
            else {
                // every query word must match a word of this name (sum and first weight, summed in order)
                var all = true, sum = 0.0, first = 0.0
                for (i, w) in q.wb.enumerated() {
                    let x = wordWeight(w, f.wb, fuzzy: fuzzy)
                    if x <= 0 { all = false; break }
                    sum += x
                    if i == 0 { first = x }
                }
                if all {
                    let rest = f.wb.filter { w in !q.wb.contains { hasPrefix(w, $0) } }.count
                    s = 60 + 25 * (sum / Double(q.wb.count)) + (first == 1 && f.words.first == q.words[0] ? 3 : 0)
                        - unmatchedPenalty * Double(min(3, rest))
                } else if qn >= 4 && contains(f.sqb, q.sqb) {
                    s = 70
                }
            }
            best = max(best, s)
        }
        if best > 0 || names { return best }
        var sum = 0.0
        for (i, w) in q.wb.enumerated() {
            var x = wordWeight(w, e.allB, fuzzy: fuzzy)
            for syn in q.syn[i] where x < 1 { x = max(x, wordWeight(syn, e.allB, fuzzy: false)) }
            if x <= 0 { return 0 }
            sum += x
        }
        return q.wb.isEmpty ? 0 : 45 + 20 * (sum / Double(q.wb.count))
    }

    /// Hits for normalized query words, best first (score, then walk, then name).
    func rank(_ qw: [String], fuzzy: Bool, names: Bool = false) -> [(Double, Entry)] {
        let q = Query(qw)
        var hits: [(Double, Entry)] = []
        for e in index {
            let s = Self.scorePlace(e, q, fuzzy: fuzzy, names: names)
            if s >= Self.minScore { hits.append((s, e)) }
        }
        let en = Locale(identifier: "en_US")
        return hits.stableSorted { a, b in
            if a.0 != b.0 { return a.0 > b.0 }
            if a.1.p.walk != b.1.p.walk { return a.1.p.walk < b.1.p.walk }
            return a.1.p.name.compare(b.1.p.name, locale: en) == .orderedAscending
        }
    }

    func item(_ hit: (Double, Entry)) -> PlaceHit {
        let s = hit.0, p = hit.1.p
        let stop = p.stopIndex >= 0 && p.stopIndex < data.stops.count ? data.stops[p.stopIndex] : ""
        let walk = "\(p.walk) min walk to \(stop.isEmpty ? "a shuttle stop" : stop)"
        let what = [p.kind != "Place" ? p.kind : "", p.address].filter { !$0.isEmpty }.joined(separator: ", ")
        let sub = [what, walk].filter { !$0.isEmpty }.joined(separator: " · ")
        return PlaceHit(label: p.name, sub: sub, lat: p.lat, lon: p.lon, walk: p.walk, stop: stop, score: Int(JS.round(s)))
    }

    /// Best spelling correction that finds a name-level match clearly better than the typed text (or nil).
    func correct(_ qw: [String], top: Double) -> (hits: [(Double, Entry)], to: String, big: Bool)? {
        var best: (value: Double, hits: [(Double, Entry)], c: Spell.Correction)? = nil
        for c in Spell.corrections(vocab, qw) {
            let hits = rank(c.words, fuzzy: false, names: true)
            let s = hits.first?.0 ?? 0
            if s < Self.nameLevel || s <= top + Self.margin || (c.risky && s < Self.whole - Self.aliasPenalty) { continue }
            let value = s - 3 * c.cost
            if best == nil || value > best!.value { best = (value: value, hits: hits, c: c) }
        }
        guard let b = best, let first = b.hits.first else { return nil }
        let sq = b.c.words.joined()
        // the corrected letters spell a whole name with other spacing ("regen stien" -> "Regenstein"): show that name
        if let f = first.1.forms.first(where: { $0.sq == sq }), f.words.count != b.c.words.count {
            return (hits: b.hits, to: f.text, big: true)
        }
        return (hits: b.hits, to: b.c.words.map { display[$0] ?? $0 }.joined(separator: " "), big: b.c.big)
    }

    /// Search the places (pure; data/places.js findLocal). When the typed text has no strong match, a spelling
    /// correction is tried and, if it finds better matches, used: `assumed` says so.
    /// - Parameter exact: as typed (no correction, no typo tolerance)
    public func find(_ q: String, limit: Int = PlaceIndex.limit, exact: Bool = false) -> LocalPlaces {
        let n = Self.norm(q)
        guard n.count >= 2 else { return LocalPlaces(items: []) }
        let qw = n.split(separator: " ").map(String.init)
        var hits = rank(qw, fuzzy: !exact)
        var assumed: SearchAssumption? = nil
        let top = hits.first?.0 ?? 0
        if !exact && top < Self.strong, let c = correct(qw, top: top) {
            hits = c.hits
            assumed = SearchAssumption(from: q.trimmingCharacters(in: .whitespacesAndNewlines), to: c.to, big: c.big)
        }
        return LocalPlaces(items: hits.prefix(limit).map { item($0) }, assumed: assumed)
    }

    /// Items only (data/places.js searchLocal). Queries under 2 normalized characters return nothing.
    public func search(_ q: String, limit: Int = PlaceIndex.limit) -> [PlaceHit] {
        find(q, limit: limit).items
    }
}
