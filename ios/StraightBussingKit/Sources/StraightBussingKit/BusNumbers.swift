import Foundation

/// Numbered buses (owner 2026-10-30: "if there are multiple buses on a line, name them with a number so that if a user
/// clicks on a particular bus it will show their arrival times at each station instead of the closest one while that
/// bus is clicked"). A route's shown buses are "Bus 1", "Bus 2", ... only when it shows two or more, in vehicle id
/// order (numeric when both ids are numbers, else text); a single bus gets no number. Pure, like the web core helper.
public enum BusNumbers {
    /// Vehicle id order: numeric when both ids are numbers, else text.
    public static func idOrder(_ a: String, _ b: String) -> Bool {
        if let x = Double(a), let y = Double(b), x.isFinite, y.isFinite, x != y { return x < y }
        return a < b
    }

    /// Numbers (from 1) for one route's shown buses, keyed by vehicle id: empty unless there are two or more distinct
    /// ids. Blank ids are ignored.
    public static func numbers(_ vehicleIds: [String?]) -> [String: Int] {
        var ids: [String] = []
        for id in vehicleIds { if let id, !id.isEmpty, !ids.contains(id) { ids.append(id) } }
        guard ids.count >= 2 else { return [:] }
        var out: [String: Int] = [:]
        for (i, id) in ids.sorted(by: idOrder).enumerated() { out[id] = i + 1 }
        return out
    }

    /// Numbers for every route of `buses`: route id -> vehicle id -> number.
    public static func byRoute(_ buses: [VehiclePosition]) -> [String: [String: Int]] {
        var per: [String: [String?]] = [:]
        for b in buses { if let rid = b.trip.routeId { per[rid, default: []].append(b.vehicle.id) } }
        var out: [String: [String: Int]] = [:]
        for (rid, ids) in per { let n = numbers(ids); if !n.isEmpty { out[rid] = n } }
        return out
    }

    /// "Bus 2" (nil without a number).
    public static func name(_ n: Int?) -> String? { n.map { "Bus \($0)" } }
}

extension Arrivals {
    /// One bus's own live times at each stop of its route (a numbered bus selected on the route page, owner 2026-10-30):
    /// per stop the earliest time not more than 30 s past, over every trip update that names this vehicle on this route
    /// (Passio splits one bus's predictions across its current and next trip). A stop missing from the result has no
    /// prediction from this bus. Never another bus's times.
    public static func busTimes(trips: [TripUpdate], vehicleId: String, routeId: String, now: Double) -> [String: Double] {
        var out: [String: Double] = [:]
        for tu in trips where tu.vehicle.id == vehicleId && (tu.trip.routeId == nil || tu.trip.routeId == routeId) {
            for u in tu.stopTimeUpdates {
                guard let sid = u.stopId else { continue }
                let t = u.time
                guard t != 0, t.isFinite, t > now - 30 else { continue }
                if let cur = out[sid], cur <= t { continue }
                out[sid] = t
            }
        }
        return out
    }
}

extension TripText {
    /// The collapsed sheet's right side during a trip (owner 2026-10-30, "Arriving In"): minutes until the trip's bus
    /// reaches your stop, the boarding stop before you board and the stop you get off at on board, from the same
    /// evaluation as the Current trip card. "Arriving In: Now" under a minute; "~" while the time is planned rather than
    /// live, or live data is delayed. No time yet: the card's words ("No live bus time yet"), never a number. No bus in
    /// the current step (the last walk, or a trip without a bus): the walking time, "Walk 6 min".
    public static func arrivingIn(_ p: TripFollow, now: Double) -> String {
        func walk(_ w: TripFollow.WalkStep) -> String {
            let m = w.state == .active ? (w.minNow ?? w.min) : w.min
            return "Walk \(TripInfo.walkMins(m)) min"
        }
        let step = p.legs.indices.contains(p.active) ? p.legs[p.active] : nil
        if p.phase == .arrived {
            if let w = step?.walk, w.state != .done { return walk(w) }
            return ""
        }
        guard let leg = step?.bus else {
            if let w = step?.walk { return walk(w) }
            return ""
        }
        let onBus = p.phase == .onBus
        guard let t = onBus ? leg.alightEta : leg.boardEta else { return "No live bus time yet" }
        let live = onBus ? leg.alightLive : leg.boardLive
        let m = TimeFmt.minsUntil(t, from: now)
        return "Arriving In: " + (m < 1 ? "Now" : (p.stale != .fresh || !live ? "~" : "") + "\(m) min")
    }
}

extension Rank {
    /// Walking the whole way is suggested as the first option when it takes this many minutes or fewer.
    public static let walkFirstMaxMin = 10.0

    /// Walk first (owner 2026-10-30: "if the distance is very close, it is ok to just suggest the user to walk on their
    /// first travel option"): there are bus options, and walking the whole way takes 10 minutes or less, or arrives no
    /// later than the best bus option. Otherwise the ranked bus options keep their order.
    public static func walkFirst(_ r: PlanResult) -> Bool {
        guard !r.options.isEmpty, r.walkOnlyMin > 0, r.walkOnlyMin.isFinite else { return false }
        if r.walkOnlyMin <= walkFirstMaxMin { return true }
        let best = r.options.map(\.arrive).min() ?? .infinity
        return r.now + r.walkOnlyMin * 60 <= best
    }
}
