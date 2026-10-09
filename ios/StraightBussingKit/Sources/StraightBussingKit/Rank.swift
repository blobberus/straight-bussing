import Foundation

/// Which trip options to show and in what order (web/js/core/rank.js, owner rule 2026-10-08).
/// Criteria in priority order: 1. least walking, 2. earliest arrival, 3. shortest wait. An option "meets" a
/// criterion when within a tolerance of the best. Order: highest-priority criterion met (none = last), then
/// more criteria met, then fewer walking minutes, earlier arrival, shorter wait.
public enum Rank {
    static let eps = 1e-9

    /// Total walking over legs: float minutes, whole meters.
    public static func walkTotals(_ legs: [Leg]) -> (walkMin: Double, walkM: Int) {
        var min = 0.0, m = 0.0
        for l in legs { if let w = l.walk { min += w.min; m += w.m } }
        return (min, Int(JS.round(m)))
    }

    public struct Stats: Hashable, Sendable {
        public var walk: Double
        public var arrive: Double
        public var wait: Double
    }

    /// The three numbers an option is ranked on, computed from its legs.
    public static func optionStats(_ o: TripOption) -> Stats {
        var walk = 0.0, wait = 0.0
        for l in o.legs {
            switch l {
            case .walk(let w): walk += w.min
            case .bus(let b): wait += b.wait
            }
        }
        return Stats(walk: walk, arrive: o.arrive, wait: wait)
    }

    static func meetsOf(_ s: Stats, _ best: Stats) -> [Criterion] {
        Criterion.allCases.filter { c in
            switch c {
            case .arrive: return s.arrive <= best.arrive + c.tol * 60 + eps
            case .walk: return s.walk <= best.walk + c.tol + eps
            case .wait: return s.wait <= best.wait + c.tol + eps
            }
        }
    }

    /// Rank options (copies with `meets`, best first). Does not mutate input.
    public static func rankOptions(_ options: [TripOption]) -> [TripOption] {
        guard !options.isEmpty else { return [] }
        let st = options.map(optionStats)
        let best = Stats(walk: st.map(\.walk).min()!, arrive: st.map(\.arrive).min()!, wait: st.map(\.wait).min()!)
        struct Row { var o: TripOption; var s: Stats; var meets: [Criterion] }
        let rows = options.indices.map { Row(o: options[$0], s: st[$0], meets: meetsOf(st[$0], best)) }
        func prio(_ r: Row) -> Int { Criterion.allCases.firstIndex { r.meets.contains($0) } ?? Criterion.allCases.count }
        let sorted = rows.stableSorted { a, b in
            if prio(a) != prio(b) { return prio(a) < prio(b) }
            if a.meets.count != b.meets.count { return a.meets.count > b.meets.count }
            if a.s.walk != b.s.walk { return a.s.walk < b.s.walk }
            if a.s.arrive != b.s.arrive { return a.s.arrive < b.s.arrive }
            return a.s.wait < b.s.wait
        }
        return sorted.map { r in var o = r.o; o.meets = r.meets; return o }
    }

    /// "Least walking · Earliest arrival" ('' for none), in priority order.
    public static func criteriaText(_ meets: [Criterion]) -> String {
        Criterion.allCases.filter { meets.contains($0) }.map(\.label).joined(separator: " · ")
    }

    /// Identity of an option's bus legs (route, stops, boarding time).
    static func legSig(_ legs: [Leg]) -> String {
        legs.compactMap(\.bus).map { "\($0.rid):\($0.board.id ?? "")>\($0.alight.id ?? "")@\(Int(JS.round($0.boardT)))" }
            .joined(separator: "|")
    }

    /// Candidates -> ranked options: drop ones absurdly slower than walking and transfers that do not beat
    /// the best direct trip by `xferGainMin`, merge duplicates, rank, cap.
    public static func pickOptions(_ cands: [PlanCandidate], t0: Double, walkOnlyMin: Double, max: Int = 4,
                                   xferGainMin: Double = 2) -> [TripOption] {
        let limit = Swift.max(2 * walkOnlyMin, walkOnlyMin + 15)
        let bestDirect = cands.filter { !$0.xfer }.map(\.arr).min() ?? .infinity
        var seen = Set<String>()
        var out: [TripOption] = []
        for c in cands.stableSorted(by: { $0.arr < $1.arr || ($0.arr == $1.arr && $0.legs.count < $1.legs.count) }) {
            let total = (c.arr - t0) / 60
            if total > limit { continue }
            if c.xfer && c.arr > bestDirect - xferGainMin * 60 { continue }
            let sig = legSig(c.legs)
            if seen.contains(sig) { continue }
            seen.insert(sig)
            let wt = walkTotals(c.legs)
            out.append(TripOption(key: c.key, total: total, totalMin: Swift.max(1, Int(JS.round(total))), arrive: c.arr, t0: t0,
                                  walkMin: wt.walkMin, walkM: wt.walkM, meets: [], legs: c.legs))
        }
        return Array(rankOptions(out).prefix(max))
    }
}
