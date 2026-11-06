import Foundation

/// Which trip options to show and in what order (web/js/core/rank.js, owner rule 2026-10-08).
/// Criteria in priority order: 1. least walking, 2. earliest arrival, 3. shortest wait. An option "meets" a
/// criterion when within a tolerance of the best. Order: highest-priority criterion met (none = last), then
/// more criteria met, then fewer walking minutes, earlier arrival, shorter wait.
/// The long way around (owner 2026-11-06, `longWay*`): the least-walking option may be slower than walking; `pickOptions`
/// keeps it, `walkPlace` puts walking the whole way under it ("Faster to walk") and `criteriaLine` states the trade-off.
public enum Rank {
    static let eps = 1e-9

    /// The long way around (web core/rank.js LONG_WAY; owner 2026-11-06: "approve of taking the long way around routes to
    /// reach a location given that it is the least amount of walking and long wait is ok"; Regenstein to Vue53 on the 53rd
    /// Street Express rides 12 stops around the loop). An option "saves walking" when it walks at least `longWaySaveMin`
    /// less than the walking to beat AND at most half of it; `pickOptions` keeps an option slower than the usual limit
    /// (max(2 x walking, walking + 15 min)) when it walks least of all candidates (0.5 min tolerance), saves walking
    /// compared with the least walking within the usual limit (or walking the whole way, if less), and takes at most
    /// `longWayMaxMin` door to door, a long wait included. A ride never goes a full loop (`Planner.pathIdx`).
    public static let longWaySaveMin = 5.0
    public static let longWaySaveFrac = 0.5
    public static let longWayMaxMin = 60.0

    /// Whether walking `walkMin` minutes saves enough over walking `walkOnlyMin` (at least 5 min less and at most half;
    /// web core/rank.js savesWalking).
    public static func savesWalking(_ walkMin: Double, _ walkOnlyMin: Double) -> Bool {
        guard walkMin.isFinite, walkOnlyMin.isFinite, walkOnlyMin > 0 else { return false }
        return walkOnlyMin - walkMin >= longWaySaveMin - eps && walkMin <= walkOnlyMin * (1 - longWaySaveFrac) + eps
    }

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

    /// "Least walking, earliest arrival" ('' for none), in priority order.
    public static func criteriaText(_ meets: [Criterion]) -> String {
        Criterion.allCases.filter { meets.contains($0) }.enumerated()
            .map { $0.offset == 0 ? $0.element.label : $0.element.label.prefix(1).lowercased() + $0.element.label.dropFirst() }
            .joined(separator: ", ")
    }

    /// Identity of an option's bus legs (route, stops, boarding time).
    static func legSig(_ legs: [Leg]) -> String {
        legs.compactMap(\.bus).map { "\($0.rid):\($0.board.id ?? "")>\($0.alight.id ?? "")@\(Int(JS.round($0.boardT)))" }
            .joined(separator: "|")
    }

    /// Options that became the same trip (route, stops and boarding time of every bus leg) listed once, the first kept
    /// (web core/rank.js uniqueOptions): the sidewalk refinement re-times walks and re-plans a missed bus, so two options
    /// can end up on the same bus (QA 2026-11-05). Options with no bus leg are kept as they are.
    public static func uniqueOptions(_ options: [TripOption]) -> [TripOption] {
        var seen = Set<String>()
        return options.filter { o in
            let sig = legSig(o.legs)
            if sig.isEmpty { return true }
            return seen.insert(sig).inserted
        }
    }

    /// Candidates -> ranked options: drop ones absurdly slower than walking (unless they are the least-walking long way
    /// around, `longWay*`) and transfers that do not beat the best direct trip by `xferGainMin`, merge duplicates, rank, cap.
    public static func pickOptions(_ cands: [PlanCandidate], t0: Double, walkOnlyMin: Double, max: Int = 4,
                                   xferGainMin: Double = 2) -> [TripOption] {
        let limit = Swift.max(2 * walkOnlyMin, walkOnlyMin + 15)
        let longLimit = Swift.max(limit, longWayMaxMin)   // the long way around: slower is fine when it walks least
        let bestDirect = cands.filter { !$0.xfer }.map(\.arr).min() ?? .infinity
        let viable = cands.filter { !($0.xfer && $0.arr > bestDirect - xferGainMin * 60) }   // transfer not worth it
        func totalOf(_ c: PlanCandidate) -> Double { (c.arr - t0) / 60 }
        func walkOf(_ c: PlanCandidate) -> Double { walkTotals(c.legs).walkMin }
        // the walking to beat: walking the whole way or the least-walking option within the usual limit
        let usualWalk = Swift.min(walkOnlyMin, viable.filter { totalOf($0) <= limit }.map(walkOf).min() ?? .infinity)
        let leastWalk = viable.filter { totalOf($0) <= longLimit }.map(walkOf).min() ?? .infinity
        var seen = Set<String>()
        var out: [TripOption] = []
        for c in viable.stableSorted(by: { $0.arr < $1.arr || ($0.arr == $1.arr && $0.legs.count < $1.legs.count) }) {
            let total = totalOf(c)
            let wt = walkTotals(c.legs)
            let longWay = total <= longLimit && savesWalking(wt.walkMin, usualWalk) && wt.walkMin <= leastWalk + Criterion.walk.tol + eps
            if total > limit && !longWay { continue }   // absurdly longer than walking, and not the least-walking long way around
            let sig = legSig(c.legs)
            if seen.contains(sig) { continue }
            seen.insert(sig)
            out.append(TripOption(key: c.key, total: total, totalMin: Swift.max(1, Int(JS.round(total))), arrive: c.arr, t0: t0,
                                  walkMin: wt.walkMin, walkM: wt.walkM, meets: [], legs: c.legs))
        }
        return Array(rankOptions(out).prefix(max))
    }
}
