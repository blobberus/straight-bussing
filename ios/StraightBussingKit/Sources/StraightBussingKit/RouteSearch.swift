import Foundation

/// Route search for the Routes list (web core/routesearch.js, ported 1:1; owner 2026-11-04: "You should be able to
/// search routes from the routes menu which will bring them to the top. Allow keywords and smart search such as
/// allowing 53rdst -> 53rd Street or 53rd St -> 53rd Street etc."). Pure. RouteSearchTests checks the web's golden
/// file (web/tests/routesearch-golden.json, written by tools/gen_routesearch_golden.py from the JavaScript).
///
/// Text rule: `PlaceIndex.norm` (the place search's; web core/text.js), then letters split from digits with the
/// ordinal dropped ("53rdst" = "53rd st" = "53 st"; a wrong "st" stays a word: "53st" = "53 street"; while typing the
/// start of the suffix too, "53r"), number words ("fifty third" = "53"), "and" / "the" / "of" / "for" / "at" / "to"
/// ignored, abbreviations both ways (`canonMap`). Keywords: short name, long-name words, the names of its stops.
/// Typos: `PlaceIndex.near1` on words of 4+ letters, never on the first letter of a 4 or 5 letter word.
/// Ranking (`Tier`, ties keep the list order): exact name 100, start of a name 90, every word a name word 80+,
/// the same after abbreviations 70+, name words plus one stop's words 60+ (`Hit.stop` names that stop), a name word
/// with a typo 50+, a stop word with a typo 45+; + 3 x the mean word weight (1 exact, 0.85 start, 0.7 typo), minus 0.5
/// per long-name word not typed (max 3).
public enum RouteSearch {
    /// Base score of each match kind.
    public enum Tier {
        public static let exact = 100.0, prefix = 90.0, words = 80.0, expand = 70.0, stop = 60.0, typo = 50.0, stopTypo = 45.0
    }

    /// Abbreviation -> the word it stands for (the query and the names are both mapped, so it works both ways).
    public static let canonMap: [String: String] = [
        "st": "street", "str": "street", "ave": "avenue", "av": "avenue", "blvd": "boulevard", "dr": "drive",
        "exp": "express", "expr": "express", "ctr": "center", "cntr": "center", "centre": "center",
        "dt": "downtown", "dtwn": "downtown", "n": "north", "s": "south", "e": "east", "w": "west", "nth": "north", "sth": "south",
        "apt": "apartments", "apts": "apartments", "hosp": "hospital", "sta": "station", "stn": "station", "univ": "university",
        "lib": "library", "shtl": "shuttle", "ln": "line",
    ]
    static let stopwords: Set<String> = ["and", "the", "of", "for", "at", "to"]
    static let units: [String: Int] = ["one": 1, "first": 1, "two": 2, "second": 2, "three": 3, "third": 3, "four": 4, "fourth": 4,
                                       "five": 5, "fifth": 5, "six": 6, "sixth": 6, "seven": 7, "seventh": 7, "eight": 8, "eighth": 8,
                                       "nine": 9, "ninth": 9]
    static let teens: [String: Int] = ["ten": 10, "tenth": 10, "eleven": 11, "eleventh": 11, "twelve": 12, "twelfth": 12,
                                       "thirteen": 13, "thirteenth": 13, "fourteen": 14, "fourteenth": 14, "fifteen": 15, "fifteenth": 15,
                                       "sixteen": 16, "sixteenth": 16, "seventeen": 17, "seventeenth": 17, "eighteen": 18, "eighteenth": 18,
                                       "nineteen": 19, "nineteenth": 19]
    static let tens: [String: Int] = ["twenty": 20, "twentieth": 20, "thirty": 30, "thirtieth": 30, "forty": 40, "fortieth": 40,
                                      "fifty": 50, "fiftieth": 50, "sixty": 60, "sixtieth": 60, "seventy": 70, "seventieth": 70,
                                      "eighty": 80, "eightieth": 80, "ninety": 90, "ninetieth": 90]
    static let unmatchedWeight = 0.5
    /// Lowest score of a match that names the route (exact name 100, the start of a name 90 down to 88.5).
    public static let namedMin = Tier.prefix - unmatchedWeight * 3

    /// A match: route id, score, and the stop whose name matched (stop tiers only).
    public struct Hit: Hashable, Sendable {
        public let id: String
        public let score: Double
        public let stop: String?
        public init(id: String, score: Double, stop: String? = nil) { self.id = id; self.score = score; self.stop = stop }
    }

    /// One route to index: names and the names of the stops it serves.
    public struct Item: Sendable {
        public var id: String, short: String, long: String
        public var stops: [String]
        public init(id: String, short: String = "", long: String = "", stops: [String] = []) {
            self.id = id; self.short = short; self.long = long; self.stops = stops
        }
    }

    struct StopEntry: Sendable { let name: String; let words: [String] }
    struct Entry: Sendable {
        let id: String, order: Int, sqShort: String, sqLong: String
        let names: [String], namesC: [String], mainC: [String]
        let stops: [StopEntry]
    }

    /// The search index (build once per schedule load; web buildRouteIndex / routeIndexFor).
    public struct Index: Sendable {
        let entries: [Entry]
        public var count: Int { entries.count }

        /// Items in list order (ties keep it). Stop names are deduplicated (loops repeat the first stop).
        public init(items: [Item]) {
            entries = items.enumerated().map { order, it -> Entry in
                let short = RouteSearch.words(it.short), long = RouteSearch.words(it.long)
                let names = short + long
                var seen = Set<String>(), stops: [StopEntry] = []
                for k in it.stops where !k.isEmpty && seen.insert(k).inserted {
                    stops.append(StopEntry(name: k, words: RouteSearch.words(k).map(RouteSearch.canon)))
                }
                let main = long.isEmpty ? short : long
                return Entry(id: it.id, order: order, sqShort: short.joined(), sqLong: long.joined(), names: names,
                             namesC: names.map(RouteSearch.canon), mainC: main.map(RouteSearch.canon), stops: stops)
            }
        }

        /// The schedule's routes in `ids` order with the names of their stops (routeStops).
        public init(_ d: StaticData, ids: [String]) {
            self.init(items: ids.map { id in
                Item(id: id, short: d.routes[id]?.short ?? "", long: d.routes[id]?.long ?? "",
                     stops: (d.routeStops[id] ?? []).compactMap { d.stops[$0]?.name }.filter { !$0.isEmpty })
            })
        }
    }

    /// English ordinal suffix of a number written in digits ("1" -> "st", "53" -> "rd", "11" -> "th").
    public static func ordinal(_ digits: String) -> String {
        let t = Int(String(digits.suffix(2))) ?? 0
        if t >= 11 && t <= 13 { return "th" }
        switch t % 10 {
        case 1: return "st"
        case 2: return "nd"
        case 3: return "rd"
        default: return "th"
        }
    }

    /// The word an abbreviation stands for ("st" -> "street"); any other word unchanged.
    public static func canon(_ w: String) -> String { canonMap[w] ?? w }

    static func isDigit(_ c: UInt8) -> Bool { c >= 0x30 && c <= 0x39 }

    /// Runs of digits and of letters in a normalized word ("53rdst" -> ["53", "rdst"]).
    static func pieces(_ w: String) -> [String] {
        var out: [String] = [], cur: [UInt8] = []
        for c in w.utf8 {
            if let last = cur.last, isDigit(last) != isDigit(c) { out.append(String(decoding: cur, as: UTF8.self)); cur = [] }
            cur.append(c)
        }
        if !cur.isEmpty { out.append(String(decoding: cur, as: UTF8.self)) }
        return out
    }

    /// Words of a route name, stop name or query (no abbreviations: see `canon`). typing: a query being typed, so a
    /// started ordinal suffix at the very end is dropped ("53r").
    public static func words(_ s: String, typing: Bool = false) -> [String] {
        let raw = PlaceIndex.norm(s).split(separator: " ").map(String.init)
        var out: [String] = []
        for (wi, w) in raw.enumerated() {
            var parts = pieces(w)
            for i in parts.indices {
                let p = parts[i]
                if p.isEmpty { continue }
                if isDigit(p.utf8.first!) {
                    var num = Substring(p)
                    while num.count > 1 && num.first == "0" { num = num.dropFirst() }
                    let n = String(num)
                    out.append(n)
                    if i + 1 < parts.count {
                        let next = parts[i + 1], suf = ordinal(n)
                        let end = typing && wi == raw.count - 1 && i + 1 == parts.count - 1
                        if next.hasPrefix(suf) { parts[i + 1] = String(next.dropFirst(suf.count)) }
                        else if next == "th" || next == "nd" || next == "rd" || (end && suf.hasPrefix(next)) { parts[i + 1] = "" }
                    }
                } else {
                    out.append(p)
                }
            }
        }
        var res: [String] = []
        var i = 0
        while i < out.count {
            let w = out[i]
            if let t = tens[w] {
                if i + 1 < out.count, let u = units[out[i + 1]] { res.append(String(t + u)); i += 1 } else { res.append(String(t)) }
            } else if let t = teens[w] { res.append(String(t)) }
            else if let u = units[w] { res.append(String(u)) }
            else { res.append(w) }
            i += 1
        }
        let kept = res.filter { !stopwords.contains($0) }
        return kept.isEmpty ? res : kept
    }

    static func near1(_ a: String, _ b: String) -> Bool { PlaceIndex.near1(Array(a.utf8), Array(b.utf8)) }

    /// Weight of one query word against words: 1 exact, 0.85 start of a word, 0.7 one typo, 0 none.
    static func wordW(_ q: String, _ words: [String], short: Bool, typo: Bool) -> Double {
        var best = 0.0
        let qn = q.utf8.count
        for w in words {
            if w == q { return 1 }
            if (qn >= 2 || short) && w.hasPrefix(q) { best = 0.85 }
            else if typo && best < 0.7 && qn >= 4 && w.utf8.count >= 4 && (qn > 5 || q.utf8.first == w.utf8.first)
                        && !q.utf8.contains(where: isDigit) && near1(q, w) { best = 0.7 }
        }
        return best
    }

    static func mean(_ ws: [Double]) -> Double { ws.reduce(0, +) / Double(ws.count) }
    /// All words weigh more than 0: the mean, else 0.
    static func allMean(_ ws: [Double]) -> Double { ws.allSatisfy { $0 > 0 } ? mean(ws) : 0 }

    /// Long-name words the query does not mention, x 0.5 (max 3 words).
    static func unmatched(_ e: Entry, _ qc: [String]) -> Double {
        var n = 0
        for w in e.mainC where !qc.contains(where: { q in w == q || w.hasPrefix(q) || (q.utf8.count >= 4 && w.utf8.count >= 4 && near1(q, w)) }) {
            n += 1
        }
        return unmatchedWeight * Double(min(3, n))
    }

    /// Score one route for query words (0 = no match) and the stop that matched (stop tiers only).
    static func score(_ e: Entry, _ qw: [String]) -> (score: Double, stop: String?) {
        let qsq = qw.joined(), last = qw.count - 1, qc = qw.map(canon)
        if qsq.isEmpty { return (0, nil) }
        if qsq == e.sqShort || qsq == e.sqLong { return (Tier.exact, nil) }
        if (!e.sqLong.isEmpty && e.sqLong.hasPrefix(qsq)) || (!e.sqShort.isEmpty && e.sqShort.hasPrefix(qsq)) {
            return (Tier.prefix - unmatched(e, qc), nil)
        }
        var m = allMean(qw.enumerated().map { wordW($1, e.names, short: $0 == last, typo: false) })
        if m > 0 { return (Tier.words + 3 * m - unmatched(e, qc), nil) }
        m = allMean(qc.enumerated().map { wordW($1, e.namesC, short: $0 == last, typo: false) })
        if m > 0 { return (Tier.expand + 3 * m - unmatched(e, qc), nil) }
        if qsq.utf8.count < 2 { return (0, nil) }
        func viaStops(typo: Bool, base: Double) -> (score: Double, stop: String?)? {
            var best = 0.0, stop: String?
            for s in e.stops {
                let v = allMean(qc.enumerated().map { i, q in
                    max(wordW(q, e.namesC, short: i == last, typo: typo), wordW(q, s.words, short: false, typo: typo))
                })
                if v > best { best = v; stop = s.name }
            }
            return best > 0 ? (base + 3 * best, stop) : nil
        }
        if let st = viaStops(typo: false, base: Tier.stop) { return st }
        m = allMean(qc.enumerated().map { wordW($1, e.namesC, short: $0 == last, typo: true) })
        if m > 0 { return (Tier.typo + 3 * m - unmatched(e, qc), nil) }
        return viaStops(typo: true, base: Tier.stopTypo) ?? (0, nil)
    }

    /// Routes matching a query, best first (ties keep the index order). Empty query: [].
    public static func search(_ index: Index, _ q: String) -> [Hit] {
        let qw = words(q, typing: true)
        if qw.isEmpty { return [] }
        var hits: [(hit: Hit, order: Int)] = []
        for e in index.entries {
            let r = score(e, qw)
            if r.score > 0 { hits.append((Hit(id: e.id, score: r.score, stop: r.stop), e.order)) }
        }
        hits.sort { $0.hit.score != $1.hit.score ? $0.hit.score > $1.hit.score : $0.order < $1.order }
        return hits.map(\.hit)
    }

    /// Order matches for the Routes list (owner 2026-11-05: "the top results, unless the name is clearly specified,
    /// should priortize active routes"; web rankByActive): the routes the query names (score >= `namedMin`) stay on top
    /// whether or not they run, then the matches operating now, then the rest, each in score order. `active` = the
    /// Show running rule (`AppModel.operatingRoutes`); nil = live status unknown: the order is unchanged.
    public static func rankByActive(_ hits: [Hit], active: Set<String>?) -> [Hit] {
        guard let active else { return hits }
        var named: [Hit] = [], run: [Hit] = [], rest: [Hit] = []
        for h in hits {
            if h.score >= namedMin { named.append(h) } else if active.contains(h.id) { run.append(h) } else { rest.append(h) }
        }
        return named + run + rest
    }

    /// Split a list (display order) into the matches, best first, and the rest in their usual order. Never changes
    /// anything stored: the Routes list only draws them in this order.
    public static func split(_ ids: [String], hits: [Hit]) -> (top: [String], rest: [String]) {
        let inList = Set(ids)
        var top: [String] = []
        for h in hits where inList.contains(h.id) && !top.contains(h.id) { top.append(h.id) }
        let got = Set(top)
        return (top, ids.filter { !got.contains($0) })
    }

    /// "3 routes match" / "1 route matches" / "No routes match".
    public static func matchText(_ n: Int) -> String {
        n == 0 ? "No routes match" : n == 1 ? "1 route matches" : "\(n) routes match"
    }
}
