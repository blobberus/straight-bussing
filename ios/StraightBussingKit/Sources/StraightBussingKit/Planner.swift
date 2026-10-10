import Foundation

/// Trip planner: walk + one direct shuttle, or walk + shuttle + short transfer walk + shuttle
/// (web/js/core/planner.js, same rules). Every number it produces is an ESTIMATE.
///
///  - walking 80 m/min on straight line x 1.2; at most 800 m to the boarding stop and from the alighting
///    stop, widened to 1600 m when no option exists within 800 m; transfer walk <= 150 m. Every walk costs
///    time; only walks under 1 m get no step.
///  - ride: same-trip live prediction, else the predictor, else path distance at 18 km/h.
///  - wait: next live arrival at the board stop after you WALK there (15 s grace), else headway estimate
///    (cycle minutes / buses running / 2, clamped to [1, 30]); route skipped if neither.
///  - direct trips contribute, per route, the best (board, alight) pair for each ranking criterion.
///  - ranked by `Rank` (least walking > earliest arrival > shortest wait > criteria met); max 4.
public enum Planner {
    public static let maxWalk = 800.0
    public static let maxWalkFar = 1600.0
    public static let xferM = 150.0
    public static let busKmh = 18.0
    static let busMPerMin = 18000.0 / 60
    public static let maxOpts = 4
    public static let minWalkLeg = 1.0
    public static let graceS = 15.0
    public static let headwayCap = 30.0
    static let xferGainMin = 2.0

    struct Seq { var ids: [String]; var loop: Bool }

    /// Stop sequence of a route; a loop drops its duplicated last stop; stops without coords are skipped.
    static func seqOf(_ list: [String], _ stops: [String: Stop]) -> Seq {
        var ids = list
        let loop = ids.count > 2 && ids.first == ids.last
        if loop { ids.removeLast() }
        ids = ids.filter { stops[$0]?.coord.isValid ?? false }
        return Seq(ids: ids, loop: loop && ids.count > 1)
    }

    /// Forward index path i -> j inclusive (wrapping on loops) or nil.
    static func pathIdx(_ seq: Seq, _ i: Int, _ j: Int) -> [Int]? {
        let n = seq.ids.count
        if i == j { return nil }
        var out = [i]
        if seq.loop {
            var k = (i + 1) % n
            while true {
                out.append(k)
                if k == j { break }
                if out.count > n { return nil }
                k = (k + 1) % n
            }
        } else {
            if j < i { return nil }
            out.append(contentsOf: (i + 1)...j)
        }
        return out
    }

    struct Wait { var min: Double; var live: Bool; var t: Double; var tu: TripUpdate? }
    struct RideCore { var min: Double; var source: RideSource; var conf: Double; var p10: Double?; var p90: Double? }
    struct Ride { var core: RideCore; var alightT: Double }
    struct WalkCand { var i: Int; var id: String; var m: Double; var min: Double }
    struct RideKey: Hashable { var rid: String; var from: Int; var to: Int }

    /// Per-plan helpers closed over the data.
    final class Ctx {
        let stops: [String: Stop]
        let over: [String: Double]
        let predict: RidePredictor?
        var live: [String: [(t: Double, tu: TripUpdate)]] = [:]
        var nBuses: [String: Int] = [:]
        /// Keyed by route + first and last path index: `pathIdx` makes the path from those alone.
        var rideCache: [RideKey: RideCore] = [:]
        var cycleCache: [String: Double] = [:]

        init(data: PlannerData, predict: RidePredictor?, walkMins: [String: Double]) {
            stops = data.stops
            over = walkMins
            self.predict = predict
            for tu in data.trips {
                guard let rid = tu.trip.routeId else { continue }
                for u in tu.stopTimeUpdates {
                    let t = u.time
                    guard t != 0, let sid = u.stopId else { continue }
                    live[rid + "|" + sid, default: []].append((t, tu))
                }
            }
            for (k, arr) in live { live[k] = arr.stableSorted { $0.t < $1.t } }
            for v in data.buses { if let r = v.trip.routeId { nBuses[r, default: 0] += 1 } }
        }

        func pt(_ id: String) -> Place {
            let s = stops[id]!
            return Place(id: id, name: s.name.isEmpty ? id : s.name, lat: s.lat, lon: s.lon)
        }

        func pathM(_ seq: Seq, _ path: [Int]) -> Double {
            var m = 0.0
            for k in 1..<max(1, path.count) { m += Geo.hav(stops[seq.ids[path[k - 1]]]!.coord, stops[seq.ids[path[k]]]!.coord) }
            return m
        }

        func cycleMin(_ rid: String, _ seq: Seq) -> Double {
            if let c = cycleCache[rid] { return c }
            let c = cycleMin(seq)
            cycleCache[rid] = c
            return c
        }

        func cycleMin(_ seq: Seq) -> Double {
            let n = seq.ids.count
            var m = pathM(seq, Array(0..<n))
            if seq.loop && n > 1 { m += Geo.hav(stops[seq.ids[n - 1]]!.coord, stops[seq.ids[0]]!.coord) }
            return max(5, (seq.loop ? m : 2 * m) / Planner.busMPerMin)
        }

        /// Earliest time of `tu` at stopId strictly after `after`.
        func tripAt(_ tu: TripUpdate, _ stopId: String, _ after: Double) -> Double? {
            var best: Double? = nil
            for u in tu.stopTimeUpdates where u.stopId == stopId {
                let t = u.time
                if t > after && (best == nil || t < best!) { best = t }
            }
            return best
        }

        /// Wait to board rid at stopId when ready at readyT, or nil.
        func wait(_ rid: String, _ seq: Seq, _ stopId: String, _ readyT: Double) -> Wait? {
            if let arr = live[rid + "|" + stopId], let L = arr.first(where: { $0.t >= readyT - Planner.graceS }) {
                return Wait(min: max(0, (L.t - readyT) / 60), live: true, t: L.t, tu: L.tu)
            }
            guard let n = nBuses[rid], n > 0 else { return nil }
            let min = Swift.min(Planner.headwayCap, Swift.max(1, cycleMin(rid, seq) / Double(n) / 2))
            return Wait(min: min, live: false, t: readyT + min * 60, tu: nil)
        }

        /// Ride along path after boarding with `w`.
        func ride(_ rid: String, _ seq: Seq, _ path: [Int], _ w: Wait) -> Ride {
            let a = seq.ids[path[0]], b = seq.ids[path[path.count - 1]]
            if w.live, let tu = w.tu, let tb = tripAt(tu, b, w.t) {
                return Ride(core: RideCore(min: max(1, (tb - w.t) / 60), source: .live, conf: 0.8), alightT: tb)
            }
            let key = RideKey(rid: rid, from: path[0], to: path[path.count - 1])
            var r = rideCache[key]
            if r == nil {
                if let p = try? predict?.rideMinutes(rid: rid, from: a, to: b, when: w.t), let min = p.min, min.isFinite, min > 0 {
                    var core = RideCore(min: max(1, min), source: p.source == .learned ? .learned : .schedule, conf: p.conf)
                    if let p10 = p.p10, let p90 = p.p90, p10.isFinite, p90.isFinite { core.p10 = p10; core.p90 = p90 }
                    r = core
                }
                if r == nil { r = RideCore(min: max(1, pathM(seq, path) / Planner.busMPerMin), source: .estimate, conf: 0.3) }
                rideCache[key] = r
            }
            return Ride(core: r!, alightT: w.t + r!.min * 60)
        }

        /// Walk candidate from a point to/from stop index i, with optional router override.
        func walkTo(_ p: LatLon, _ id: String, _ i: Int, _ kind: String, _ maxM: Double) -> WalkCand? {
            guard let s = stops[id], s.coord.isValid else { return nil }
            let m = Geo.hav(p, s.coord) * Geo.walkDetour
            if m > maxM { return nil }
            let o = over[kind + ":" + id]
            return WalkCand(i: i, id: id, m: m, min: (o != nil && o!.isFinite && o! >= 0) ? o! : m / Geo.walkMetersPerMin)
        }

        func xferMin(_ ida: String, _ idb: String, _ d: Double) -> Double {
            if let o = over["xfer:" + ida + ">" + idb], o.isFinite, o >= 0 { return o }
            return d / Geo.walkMetersPerMin
        }

        func busLeg(_ rid: String, _ seq: Seq, _ path: [Int], _ w: Wait, _ r: Ride) -> BusLeg {
            let ids = path.map { seq.ids[$0] }
            return BusLeg(rid: rid, board: pt(ids[0]), alight: pt(ids[ids.count - 1]), stopIds: ids,
                          path: ids.map { stops[$0]!.coord }, stopsPassed: ids.count - 1, wait: w.min, waitLive: w.live,
                          ride: r.core.min, source: r.core.source, conf: r.core.conf, boardT: w.t, alightT: r.alightT,
                          tripId: w.tu?.trip.tripId, vehicleId: w.tu?.vehicle.id, p10: r.core.p10, p90: r.core.p90)
        }
    }

    static func addWalk(_ legs: inout [Leg], _ a: Place, _ b: Place, _ m: Double, _ min: Double) {
        if m >= minWalkLeg { legs.append(.walk(WalkLeg(from: a, to: b, m: JS.round(m), min: min, source: .estimate))) }
    }

    struct Pick { var arr: Double; var wm: Double; var b: WalkCand; var a: WalkCand; var path: [Int]; var w: Wait; var r: Ride }

    /// Direct and one-transfer candidates whose end walks are at most maxM meters.
    static func candidates(_ C: Ctx, _ rids: [String], _ seqs: [String: Seq], _ from: LatLon, _ to: LatLon, _ t0: Double,
                           _ maxM: Double) -> [PlanCandidate] {
        var near: [String: (bo: [WalkCand], al: [WalkCand])] = [:]
        for rid in rids {
            var bo: [WalkCand] = [], al: [WalkCand] = []
            for (i, id) in seqs[rid]!.ids.enumerated() {
                if let b = C.walkTo(from, id, i, "start", maxM) { bo.append(b) }
                if let a = C.walkTo(to, id, i, "end", maxM) { al.append(a) }
            }
            near[rid] = (bo, al)
        }
        let start = Place(name: "Start", lat: from.lat, lon: from.lon)
        let dest = Place(name: "Destination", lat: to.lat, lon: to.lon)
        var cands: [PlanCandidate] = []

        // Direct: per route, the best (board, alight) pair for each criterion; ties go to the earlier arrival.
        func better(_ k: Int, _ x: Pick, _ y: Pick) -> Bool {
            switch k {
            case 0: return x.arr < y.arr || (x.arr == y.arr && x.wm < y.wm)
            case 1: return x.wm < y.wm - 1e-9 || (abs(x.wm - y.wm) <= 1e-9 && x.arr < y.arr)
            default: return x.w.min < y.w.min - 1e-9 || (abs(x.w.min - y.w.min) <= 1e-9 && x.arr < y.arr)
            }
        }
        for rid in rids {
            let seq = seqs[rid]!, (bo, al) = near[rid]!
            if bo.isEmpty || al.isEmpty { continue }
            var best: [Pick?] = [nil, nil, nil]   // arr, walk, wait
            for b in bo {
                guard let w = C.wait(rid, seq, b.id, t0 + b.min * 60) else { continue }
                for a in al {
                    guard let path = pathIdx(seq, b.i, a.i) else { continue }
                    let r = C.ride(rid, seq, path, w)
                    let x = Pick(arr: r.alightT + a.min * 60, wm: b.min + a.min, b: b, a: a, path: path, w: w, r: r)
                    for k in 0..<3 where best[k] == nil || better(k, x, best[k]!) { best[k] = x }
                }
            }
            var done = Set<String>()
            for k in 0..<3 {
                guard let x = best[k] else { continue }
                let pair = x.b.id + ">" + x.a.id
                if done.contains(pair) { continue }
                done.insert(pair)
                let bl = C.busLeg(rid, seq, x.path, x.w, x.r)
                var legs: [Leg] = []
                addWalk(&legs, start, bl.board, x.b.m, x.b.min)
                legs.append(.bus(bl))
                addWalk(&legs, bl.alight, dest, x.a.m, x.a.min)
                cands.append(PlanCandidate(key: k == 0 ? rid : rid + ":" + pair, legs: legs, arr: x.arr, xfer: false))
            }
        }

        // One transfer: earliest arrival of A at each of its stops, then B from linked stops.
        struct AtK { var b: WalkCand; var w: Wait; var r: Ride; var path: [Int] }
        struct XBest { var arr: Double; var x: AtK; var d: Double; var xm: Double; var wb: Wait; var rb: Ride; var pb: [Int]; var a: WalkCand }
        for A in rids {
            let sa = seqs[A]!
            if near[A]!.bo.isEmpty { continue }
            var atK = [AtK?](repeating: nil, count: sa.ids.count)
            for b in near[A]!.bo {
                guard let w = C.wait(A, sa, b.id, t0 + b.min * 60) else { continue }
                for k in 0..<sa.ids.count {
                    guard let path = pathIdx(sa, b.i, k) else { continue }
                    let r = C.ride(A, sa, path, w)
                    if atK[k] == nil || r.alightT < atK[k]!.r.alightT { atK[k] = AtK(b: b, w: w, r: r, path: path) }
                }
            }
            for B in rids {
                if B == A || near[B]!.al.isEmpty { continue }
                let sb = seqs[B]!
                var best: XBest? = nil
                for (k, ida) in sa.ids.enumerated() {
                    guard let x = atK[k], let s = C.stops[ida], s.coord.isValid else { continue }
                    for (m, idb) in sb.ids.enumerated() {
                        guard let o = C.stops[idb], o.coord.isValid else { continue }
                        let d = ida == idb ? 0 : Geo.hav(s.coord, o.coord) * Geo.walkDetour
                        if d > xferM { continue }
                        let xm = C.xferMin(ida, idb, d)
                        guard let wb = C.wait(B, sb, idb, x.r.alightT + xm * 60) else { continue }
                        for a in near[B]!.al {
                            guard let pb = pathIdx(sb, m, a.i) else { continue }
                            let rb = C.ride(B, sb, pb, wb), arr = rb.alightT + a.min * 60
                            if best == nil || arr < best!.arr { best = XBest(arr: arr, x: x, d: d, xm: xm, wb: wb, rb: rb, pb: pb, a: a) }
                        }
                    }
                }
                guard let bx = best else { continue }
                let l1 = C.busLeg(A, sa, bx.x.path, bx.x.w, bx.x.r), l2 = C.busLeg(B, sb, bx.pb, bx.wb, bx.rb)
                var legs: [Leg] = []
                addWalk(&legs, start, l1.board, bx.x.b.m, bx.x.b.min)
                legs.append(.bus(l1))
                addWalk(&legs, l1.alight, l2.board, bx.d, bx.xm)
                legs.append(.bus(l2))
                addWalk(&legs, l2.alight, dest, bx.a.m, bx.a.min)
                cands.append(PlanCandidate(key: A + ">" + B, legs: legs, arr: bx.arr, xfer: true))
            }
        }
        return cands
    }

    /// Plan trips from `from` to `to`. Totals include every walk.
    /// - Parameter walkMins: router minute overrides keyed 'start:<stopId>', 'end:<stopId>', 'xfer:<a>><b>'
    ///   (used by `refineWalking`; normal callers omit it).
    public static func plan(from: LatLon?, to: LatLon?, now: Double, data: PlannerData?, predict: RidePredictor? = nil,
                            walkMins: [String: Double] = [:]) -> PlanResult {
        var result = PlanResult(now: now, options: [], walkOnlyM: 0, walkOnlyMin: 0)
        guard let from, let to, from.isValid, to.isValid else { return result }
        let wm = Geo.hav(from, to) * Geo.walkDetour
        result.walkOnlyM = Int(JS.round(wm))
        result.walkOnlyMin = wm / Geo.walkMetersPerMin
        guard let data else { return result }
        let C = Ctx(data: data, predict: predict, walkMins: walkMins)
        let rids = data.routeOrder.filter { data.routeStops[$0] != nil }
        var seqs: [String: Seq] = [:]
        for rid in rids { seqs[rid] = seqOf(data.routeStops[rid] ?? [], C.stops) }
        result.options = Rank.pickOptions(candidates(C, rids, seqs, from, to, now, maxWalk), t0: now,
                                          walkOnlyMin: result.walkOnlyMin, max: maxOpts, xferGainMin: xferGainMin)
        if result.options.isEmpty {   // nothing within 800 m of one end: allow longer end walks
            result.options = Rank.pickOptions(candidates(C, rids, seqs, from, to, now, maxWalkFar), t0: now,
                                              walkOnlyMin: result.walkOnlyMin, max: maxOpts, xferGainMin: xferGainMin)
        }
        return result
    }
}
