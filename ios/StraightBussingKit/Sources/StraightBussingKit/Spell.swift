import Foundation

/// Spelling correction for the place search ("did you mean", Google style), a port of web/js/data/spell.js. Pure.
/// The vocabulary is every word of the local place names, nicknames and campus stop names (`PlaceIndex` builds it
/// once). Distance = Damerau-Levenshtein (optimal string alignment) with typing-friendly weights: neighbouring keys,
/// vowel mix-ups, swapped letters and doubled letters cost less than other edits. Limits: words under 4 letters are
/// never corrected, 1 edit for 4-5 letters, 2 edits for longer words. Also handles a missing space
/// ("maxpalevsky") and an extra one ("regen stein"). Words are normalized (`PlaceIndex.norm`: a-z, 0-9).
public enum Spell {
    static let rows = ["qwertyuiop", "asdfghjkl", "zxcvbnm"]
    /// Key position (x shifted half a key per row, y = row) per ASCII letter.
    static let pos: [UInt8: (Double, Double)] = {
        var out: [UInt8: (Double, Double)] = [:]
        for (y, r) in rows.enumerated() {
            for (x, c) in r.utf8.enumerated() { out[c] = (Double(x) + Double(y) * 0.5, Double(y)) }
        }
        return out
    }()
    static let vowels = Set("aeiouy".utf8)
    /// Two neighbouring letters swapped ("palvesky").
    static let swapCost = 0.6
    /// A key next to the right one ("regenstwin").
    static let nearKey = 0.6
    /// One vowel for another ("regensteen").
    static let vowelCost = 0.7
    /// A doubled letter added or dropped ("mansuetto", "crear").
    static let doubleCost = 0.5
    /// A space added or dropped.
    public static let joinCost = 0.8
    /// Matched only the start of a longer word (still typing).
    static let prefixCost = 0.3

    /// Weighted distance: `cost`, and `edits` = plain edit count along the cheapest alignment (`Int.max` = too far).
    public struct Distance: Hashable, Sendable {
        public var cost: Double
        public var edits: Int
        public static let far = Distance(cost: .infinity, edits: Int.max)
    }

    /// Keys next to each other on a QWERTY keyboard.
    public static func adjacent(_ a: UInt8, _ b: UInt8) -> Bool {
        guard let p = pos[a], let q = pos[b], a != b else { return false }
        return abs(p.0 - q.0) <= 1 && abs(p.1 - q.1) <= 1
    }

    /// Most edits allowed for a typed word of this length (0 = never corrected).
    public static func maxEdits(_ len: Int) -> Int { len < 4 ? 0 : len <= 5 ? 1 : 2 }

    static func isDigit(_ c: UInt8) -> Bool { c >= 0x30 && c <= 0x39 }
    static func hasDigit(_ s: String) -> Bool { s.utf8.contains(where: isDigit) }

    static func subSlow(_ x: UInt8, _ y: UInt8) -> Double {
        if x == y { return 0 }
        if adjacent(x, y) { return nearKey }
        if vowels.contains(x) && vowels.contains(y) { return vowelCost }
        return isDigit(x) || isDigit(y) ? 1.5 : 1
    }

    /// `subSlow` for every ASCII pair (index x << 7 | y), built once: the distance loop does no lookups.
    static let subTable: [Double] = {
        var t = [Double](repeating: 1, count: 128 * 128)
        for x in 0..<128 { for y in 0..<128 { t[x << 7 | y] = subSlow(UInt8(x), UInt8(y)) } }
        return t
    }()

    static func sub(_ x: UInt8, _ y: UInt8) -> Double {
        x < 128 && y < 128 ? subTable[Int(x) << 7 | Int(y)] : subSlow(x, y)
    }

    static func indel(_ s: [UInt8], _ k: Int) -> Double {
        (k > 0 && s[k] == s[k - 1]) || (k + 1 < s.count && s[k] == s[k + 1]) ? doubleCost : 1
    }

    /// Fewest edits two words can be apart judging by their letters alone (cheap filter before the full distance).
    static func lowerBound(_ a: [UInt8], _ b: [UInt8]) -> Int {
        var hist = [Int](repeating: 0, count: 128)
        return a.withUnsafeBufferPointer { pa in b.withUnsafeBufferPointer { pb in lowerBound(pa, pb, &hist) } }
    }

    /// `lowerBound` with a caller's all-zero 128-entry histogram (left all zero again).
    static func lowerBound(_ a: UnsafeBufferPointer<UInt8>, _ b: UnsafeBufferPointer<UInt8>, _ hist: inout [Int]) -> Int {
        for c in a { hist[Int(c & 127)] += 1 }
        var common = 0
        for c in b {
            let k = Int(c & 127)
            if hist[k] > 0 { hist[k] -= 1; common += 1 }
        }
        for c in a { hist[Int(c & 127)] = 0 }
        return max(a.count, b.count) - common
    }

    /// Weighted optimal-string-alignment distance between a typed word and a vocabulary word.
    /// - Parameter limit: give up (`Distance.far`) once more edits than this are certain.
    public static func distance(_ a: String, _ b: String, limit: Int = 2) -> Distance {
        distance(Array(a.utf8), Array(b.utf8), limit: limit)
    }

    static func distance(_ a: [UInt8], _ b: [UInt8], limit: Int) -> Distance {
        var scratch = Scratch()
        return a.withUnsafeBufferPointer { pa in b.withUnsafeBufferPointer { pb in distance(pa, pb, limit: limit, &scratch) } }
    }

    /// Buffers reused across the distance calls of one search (no allocation per vocabulary word).
    struct Scratch {
        var C: [Double] = []
        var E: [Int] = []
        var ia: [Double] = []
        var ib: [Double] = []
        var hist = [Int](repeating: 0, count: 128)
    }

    /// The `indel` cost of every position of `s` into `out` (same rule: next to the same letter = doubled).
    static func indels(_ s: UnsafeBufferPointer<UInt8>, _ out: inout [Double]) {
        let n = s.count
        if out.count < n { out = [Double](repeating: 0, count: n) }
        for k in 0..<n { out[k] = (k > 0 && s[k] == s[k - 1]) || (k + 1 < n && s[k] == s[k + 1]) ? doubleCost : 1 }
    }

    static func distance(_ a: UnsafeBufferPointer<UInt8>, _ b: UnsafeBufferPointer<UInt8>, limit: Int, _ sc: inout Scratch) -> Distance {
        let n = a.count, m = b.count, w = m + 1
        if abs(n - m) > limit { return .far }
        if lowerBound(a, b, &sc.hist) > limit { return .far }
        let size = (n + 1) * w
        // move the buffers out (no copy-on-write while they are written), back in at the end
        var C = sc.C, E = sc.E, ia = sc.ia, ib = sc.ib
        sc.C = []; sc.E = []; sc.ia = []; sc.ib = []
        defer { sc.C = C; sc.E = E; sc.ia = ia; sc.ib = ib }
        if C.count < size { C = [Double](repeating: 0, count: size); E = [Int](repeating: 0, count: size) }
        indels(a, &ia)
        indels(b, &ib)
        C[0] = 0; E[0] = 0
        if m > 0 { for j in 1...m { C[j] = C[j - 1] + ib[j - 1]; E[j] = j } }
        if n > 0 {
            for i in 1...n {
                let r = i * w, up = r - w, x = a[i - 1], dA = ia[i - 1]
                C[r] = C[up] + dA; E[r] = i
                var rowMin = E[r]
                if m > 0 {
                    for j in 1...m {
                        let y = b[j - 1]
                        var best = C[up + j - 1] + sub(x, y), ed = E[up + j - 1] + (x == y ? 0 : 1)
                        let del = C[up + j] + dA
                        if del < best { best = del; ed = E[up + j] + 1 }
                        let ins = C[r + j - 1] + ib[j - 1]
                        if ins < best { best = ins; ed = E[r + j - 1] + 1 }
                        if i > 1 && j > 1 && x != y && x == b[j - 2] && a[i - 2] == y {
                            let t = C[up - w + j - 2] + swapCost
                            if t < best { best = t; ed = E[up - w + j - 2] + 1 }
                        }
                        C[r + j] = best; E[r + j] = ed
                        if ed < rowMin { rowMin = ed }
                    }
                }
                if rowMin > limit { return .far }   // edits only grow along any alignment
            }
        }
        return Distance(cost: C[n * w + m], edits: E[n * w + m])
    }

    /// Vocabulary: word counts, words sorted, words by length (sorted).
    public struct Vocab: Sendable {
        public var count: [String: Int]
        public var sorted: [String]
        public var byLen: [Int: [String]]
        /// UTF-8 bytes of `sorted` and of `byLen` (same order), made once for the distance loops.
        var sortedBytes: [[UInt8]] = []
        var byLenBytes: [Int: [[UInt8]]] = [:]

        init(count: [String: Int], sorted: [String], byLen: [Int: [String]]) {
            self.count = count; self.sorted = sorted; self.byLen = byLen
            sortedBytes = sorted.map { Array($0.utf8) }
            byLenBytes = byLen.mapValues { $0.map { Array($0.utf8) } }
        }
    }

    /// Vocabulary from normalized texts (lowercase words separated by single spaces).
    public static func buildVocab<S: Sequence>(_ texts: S) -> Vocab where S.Element == String {
        var count: [String: Int] = [:]
        for t in texts { for w in t.split(separator: " ") where !w.isEmpty { count[String(w), default: 0] += 1 } }
        let sorted = count.keys.sorted()
        var byLen: [Int: [String]] = [:]
        for w in sorted { byLen[w.utf8.count, default: []].append(w) }
        return Vocab(count: count, sorted: sorted, byLen: byLen)
    }

    /// A vocabulary word, or the start of one ("regens").
    public static func known(_ v: Vocab, _ w: String) -> Bool {
        if v.count[w] != nil { return true }
        var lo = 0, hi = v.sorted.count
        while lo < hi {
            let mid = (lo + hi) >> 1
            if v.sorted[mid] < w { lo = mid + 1 } else { hi = mid }
        }
        return lo < v.sorted.count && v.sorted[lo].hasPrefix(w)
    }

    public struct Candidate: Hashable, Sendable {
        public var word: String
        public var cost: Double
        public var edits: Int
    }

    /// Closest vocabulary words for one typed word, cheapest first (ties: the more common word).
    /// - Parameter last: the word may be unfinished, so word beginnings count too (1 edit).
    public static func wordCandidates(_ v: Vocab, _ w: String, last: Bool = false, max: Int = 3) -> [Candidate] {
        let wb = Array(w.utf8)
        let lim = maxEdits(wb.count)
        if lim == 0 || hasDigit(w) { return [] }
        var found: [String: Candidate] = [:]
        var order: [String] = []
        func add(_ word: String, _ d: Distance, _ extra: Double) {
            let cost = d.cost + extra
            if let old = found[word] {
                if cost < old.cost { found[word] = Candidate(word: word, cost: cost, edits: d.edits) }
            } else {
                found[word] = Candidate(word: word, cost: cost, edits: d.edits)
                order.append(word)
            }
        }
        var sc = Scratch()
        wb.withUnsafeBufferPointer { pw in
            for L in (wb.count - lim)...(wb.count + lim) {
                guard let words = v.byLen[L] else { continue }
                let bytes = v.byLenBytes[L] ?? []
                for (k, c) in words.enumerated() {
                    let cb = k < bytes.count ? bytes[k] : Array(c.utf8)
                    let d = cb.withUnsafeBufferPointer { distance(pw, $0, limit: lim, &sc) }
                    if d.edits <= lim { add(c, d, 0) }
                }
            }
            if last {
                for (k, c) in v.sorted.enumerated() {
                    let cb = k < v.sortedBytes.count ? v.sortedBytes[k] : Array(c.utf8)
                    if cb.count <= wb.count + 1 { continue }
                    // the word's beginning, as long as what was typed
                    let d = cb.withUnsafeBufferPointer { distance(pw, UnsafeBufferPointer(rebasing: $0[0..<wb.count]), limit: 1, &sc) }
                    if d.edits <= 1 { add(c, d, prefixCost) }
                }
            }
        }
        let list = order.compactMap { found[$0] }.stableSorted { a, b in
            if a.cost != b.cost { return a.cost < b.cost }
            let ca = v.count[a.word] ?? 0, cb = v.count[b.word] ?? 0
            if ca != cb { return ca > cb }
            return a.word < b.word
        }
        return Array(list.prefix(max))
    }

    /// A candidate correction of a whole query.
    public struct Correction: Hashable, Sendable {
        public var words: [String]
        public var cost: Double
        /// A long stretch worth telling the user about (2+ edits in a word, more than one word changed, or a
        /// space added / removed).
        public var big: Bool
        /// A short word (4-5 letters) changed by a plain edit ("loop" -> "coop"): needs a whole-name match.
        public var risky: Bool
    }

    /// Candidate corrections for a query, cheapest first. Only words that are neither a vocabulary word nor the
    /// start of one are changed (numbers never).
    public static func corrections(_ v: Vocab, _ qw: [String], max: Int = 10) -> [Correction] {
        let lastI = qw.count - 1
        struct Opt { var word: String; var cost: Double; var edits: Int; var risky: Bool }
        let opts: [[Opt]] = qw.enumerated().map { i, w in
            if hasDigit(w) || known(v, w) { return [Opt(word: w, cost: 0, edits: 0, risky: false)] }
            // short words: a plain edit is risky, and never on the first letter ("loop" is not "coop")
            let len = w.utf8.count
            let c = wordCandidates(v, w, last: i == lastI)
                .filter { len > 5 || $0.cost < 1 || $0.word.utf8.first == w.utf8.first }
                .map { Opt(word: $0.word, cost: $0.cost, edits: $0.edits, risky: len <= 5 && $0.cost >= 1) }
            return c.isEmpty ? [Opt(word: w, cost: 0, edits: 0, risky: false)] : c
        }
        struct Combo { var words: [String]; var cost: Double; var changed: Int; var most: Int; var risky: Bool }
        var combos = [Combo(words: [], cost: 0, changed: 0, most: 0, risky: false)]
        for o in opts {
            combos = combos.flatMap { c in
                o.map { x in
                    Combo(words: c.words + [x.word], cost: c.cost + x.cost, changed: c.changed + (x.edits != 0 ? 1 : 0),
                          most: Swift.max(c.most, x.edits), risky: c.risky || x.risky)
                }
            }.stableSorted { $0.cost < $1.cost }
            if combos.count > max { combos = Array(combos.prefix(max)) }
        }
        var out = combos.filter { $0.changed != 0 }.map {
            Correction(words: $0.words, cost: $0.cost, big: $0.most >= 2 || $0.changed > 1, risky: $0.risky)
        }
        // an extra space: two typed words that make one vocabulary word ("regen stein", "max palev sky")
        if lastI > 0 {
            for i in 0..<lastI {
                let m = qw[i] + qw[i + 1], end = i + 1 == lastI
                let fix: [Candidate] = v.count[m] != nil || (end && known(v, m))
                    ? [Candidate(word: m, cost: 0, edits: 0)] : wordCandidates(v, m, last: end, max: 1)
                for x in fix {
                    out.append(Correction(words: Array(qw[0..<i]) + [x.word] + Array(qw[(i + 2)...]), cost: joinCost + x.cost,
                                          big: true, risky: false))
                }
            }
        }
        // a missing space: one typed word that is two vocabulary words ("harpermemorial")
        for (i, w) in qw.enumerated() {
            let wb = Array(w.utf8)
            if wb.count < 5 || hasDigit(w) || v.count[w] != nil { continue }
            for k in 2...(wb.count - 2) {
                let a = String(decoding: wb[0..<k], as: UTF8.self), b = String(decoding: wb[k...], as: UTF8.self)
                if v.count[a] != nil && (v.count[b] != nil || (i == lastI && known(v, b))) {
                    out.append(Correction(words: Array(qw[0..<i]) + [a, b] + Array(qw[(i + 1)...]), cost: joinCost, big: true, risky: false))
                }
            }
        }
        return Array(out.stableSorted { $0.cost < $1.cost }.prefix(max))
    }
}
