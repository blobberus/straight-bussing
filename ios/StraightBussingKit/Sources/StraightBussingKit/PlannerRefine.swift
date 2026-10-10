import Foundation

/// A pedestrian router (sidewalk directions). The app passes `WalkRouteCache.router` around MapKit
/// `MKDirections` walking (nil in `-demo`, so CI screenshots stay deterministic); nil = straight-line estimates.
public typealias WalkRouter = @Sendable (_ from: LatLon, _ to: LatLon) async throws -> WalkResult?

extension Planner {
    /// Router minute overrides for every walk leg of an option (keys as in `plan`'s walkMins).
    static func overridesOf(_ legs: [Leg]) -> [String: Double] {
        var out: [String: Double] = [:]
        for (i, l) in legs.enumerated() {
            guard let w = l.walk else { continue }
            let prev = i > 0 ? legs[i - 1].bus : nil, next = i + 1 < legs.count ? legs[i + 1].bus : nil
            if let prev, let next { out["xfer:" + (prev.alight.id ?? "") + ">" + (next.board.id ?? "")] = w.min }
            else if let next { out["start:" + (next.board.id ?? "")] = w.min }
            else if let prev { out["end:" + (prev.alight.id ?? "")] = w.min }
        }
        return out
    }

    /// Replace estimated walk legs with router walks (never shorter than the straight line), re-time every
    /// leg and recompute total / arrive / walkMin / walkM. If a live bus would now be missed, re-plan with
    /// the router walking times and return the same-route option (refined again), or nil when it no longer
    /// exists (drop the card). Never throws (core/planner.js refineWalking).
    public static func refineWalking(_ option: TripOption, walkRoute: WalkRouter?, now: Double? = nil, data: PlannerData?,
                                     from: LatLon? = nil, to: LatLon? = nil, predict: RidePredictor? = nil,
                                     depth: Int = 0) async -> TripOption? {
        let t0 = now ?? option.t0
        var legs = option.legs
        if let walkRoute {
            let results: [Int: WalkResult] = await withTaskGroup(of: (Int, WalkResult?).self) { group in
                for (i, l) in legs.enumerated() {
                    guard let w = l.walk else { continue }
                    group.addTask { (i, try? await walkRoute(w.from.coord, w.to.coord)) }
                }
                var out: [Int: WalkResult] = [:]
                for await (i, r) in group { if let r { out[i] = r } }
                return out
            }
            for (i, r) in results {
                guard var w = legs[i].walk, r.min.isFinite, r.m.isFinite else { continue }
                let crow = w.from.coord.isValid && w.to.coord.isValid ? Geo.hav(w.from.coord, w.to.coord) : 0
                w.m = JS.round(max(r.m, crow))
                w.min = max(r.min, crow / Geo.walkMetersPerMin)
                w.source = r.source == .router ? .router : .estimate
                if !r.coords.isEmpty { w.coords = r.coords }
                legs[i] = .walk(w)
            }
        }
        var t = t0, missed = false
        for i in legs.indices {
            switch legs[i] {
            case .walk(let w):
                t += w.min * 60
            case .bus(var b):
                if b.waitLive {
                    if t > b.boardT + graceS { missed = true; break }
                    b.wait = max(0, (b.boardT - t) / 60)
                } else {
                    b.boardT = t + b.wait * 60
                }
                if !(b.source == .live && b.alightT > b.boardT) { b.alightT = b.boardT + b.ride * 60 }
                t = b.alightT
                legs[i] = .bus(b)
            }
            if missed { break }
        }
        if missed {
            if depth >= 2 { return nil }
            let first = legs.first, last = legs.last
            let f: LatLon? = (from?.isValid ?? false) ? from : first?.walk?.from.coord ?? first?.bus?.board.coord
            let d: LatLon? = (to?.isValid ?? false) ? to : last?.walk?.to.coord ?? last?.bus?.alight.coord
            guard let f, let d, f.isValid, d.isValid, let data else { return nil }
            let again = plan(from: f, to: d, now: t0, data: data, predict: predict, walkMins: overridesOf(legs))
            guard let same = again.options.first(where: { $0.key == option.key }) else { return nil }
            guard var r = await refineWalking(same, walkRoute: walkRoute, now: t0, data: data, from: f, to: d,
                                              predict: predict, depth: depth + 1) else { return nil }
            r.replanned = true
            return r
        }
        let total = (t - t0) / 60
        let wt = Rank.walkTotals(legs)
        var out = option
        out.legs = legs
        out.total = total
        out.totalMin = max(1, Int(JS.round(total)))
        out.arrive = t
        out.t0 = t0
        out.walkMin = wt.walkMin
        out.walkM = wt.walkM
        out.refined = true
        return out
    }
}
