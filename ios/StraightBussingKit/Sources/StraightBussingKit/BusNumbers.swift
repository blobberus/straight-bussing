import Foundation

/// Numbered buses (owner 2026-10-30: "if there are multiple buses on a line, name them with a number so that if a user
/// clicks on a particular bus it will show their arrival times at each station instead of the closest one while that
/// bus is clicked"). Port of web/js/core/busnum.js: a route showing two or more buses names them "Bus 1", "Bus 2",
/// ... in vehicle id order (numeric when both ids are numbers, else text order), so the names stay put while the same
/// buses run; a single bus keeps its own label. Pure.
public enum BusNumbers {
    /// A bus's key (busnum.js busKey): its vehicle id, else its label; nil when it has neither.
    public static func key(_ b: VehiclePosition) -> String? {
        if let id = b.vehicle.id, !id.isEmpty { return id }
        if let l = b.vehicle.label, !l.isEmpty { return l }
        return nil
    }

    /// Vehicle id order (busnum.js compareIds): numeric when both are numbers, else text order (ties by text).
    public static func idOrder(_ a: String, _ b: String) -> Bool {
        let ta = a.trimmingCharacters(in: .whitespaces), tb = b.trimmingCharacters(in: .whitespaces)
        if !ta.isEmpty, !tb.isEmpty, let x = Double(ta), let y = Double(tb), x.isFinite, y.isFinite, x != y { return x < y }
        return a < b
    }

    /// Numbers (from 1) for one route's bus keys: empty unless there are two or more distinct keys.
    public static func numbers(_ keys: [String?]) -> [String: Int] {
        var ids: [String] = []
        for k in keys { if let k, !k.isEmpty, !ids.contains(k) { ids.append(k) } }
        guard ids.count >= 2 else { return [:] }
        var out: [String: Int] = [:]
        for (i, id) in ids.sorted(by: idOrder).enumerated() { out[id] = i + 1 }
        return out
    }

    /// Numbers per route (busnum.js busNumbers, grouped): route id -> bus key -> number; routes with one bus absent.
    public static func byRoute(_ buses: [VehiclePosition]) -> [String: [String: Int]] {
        byRoute(buses.compactMap { b in b.trip.routeId.map { (rid: $0, key: key(b)) } })
    }

    /// The same from (route id, bus key) pairs: the app numbers the buses its map draws (a bus missing from one poll
    /// stays drawn for 45 s, and keeps its number and a pick meanwhile).
    public static func byRoute(_ pairs: [(rid: String, key: String?)]) -> [String: [String: Int]] {
        var per: [String: [String?]] = [:]
        for p in pairs where !p.rid.isEmpty { per[p.rid, default: []].append(p.key) }
        var out: [String: [String: Int]] = [:]
        for (rid, keys) in per { let n = numbers(keys); if !n.isEmpty { out[rid] = n } }
        return out
    }

    /// How the app names a bus (busnum.js busName): "Bus 2" on a route with several buses, else "Bus <fleet label>",
    /// else "This bus".
    public static func name(number: Int?, label: String?) -> String {
        if let number { return "Bus \(number)" }
        if let label, !label.isEmpty { return "Bus \(label)" }
        return "This bus"
    }

    /// `name(number:label:)` for a live bus and its route's numbers.
    public static func name(_ b: VehiclePosition, numbers: [String: Int]) -> String {
        name(number: key(b).flatMap { numbers[$0] }, label: b.vehicle.label ?? b.vehicle.id)
    }

    /// One bus's own next live time at a stop (busnum.js busArrival): the first arrival of that vehicle in the stop's
    /// arrivals (sorted by time), never another bus's.
    public static func busArrival(_ arrivals: [Arrival], vehicleId: String?) -> Arrival? {
        guard let vehicleId else { return nil }
        return arrivals.first { $0.vehicleId == vehicleId }
    }
}

extension TripText {
    /// The sheet header's right side on Current trip during a trip (owner 2026-10-30, web ui/views/tripprogress.js
    /// tripMetaText), from the same evaluation as the card:
    ///  - waiting at the stop: "Arriving In: 4 min" until the bus reaches your boarding stop; on the bus: until it reaches
    ///    the stop where you get off. "Arriving In: Now" under a minute, "~4 min" while live data is delayed. A planned
    ///    time only: "Arriving In: ~4 min est."; no time at all: "No live bus time yet".
    ///  - walking (to the stop, after the last bus, or a trip with no bus): "Walk 6 min", the walking time left.
    ///  - off the last bus with no walk left: "Arrived".
    public static func arrivingIn(_ p: TripFollow, now: Double) -> String {
        func walk(_ m: Double) -> String { "Walk \(TripInfo.walkMins(m)) min" }
        let step = p.legs.indices.contains(p.active) ? p.legs[p.active] : nil
        if p.phase == .arrived {
            if let w = step?.walk { return walk(w.minNow ?? w.min) }
            return "Arrived"
        }
        if p.phase == .walkToStop {
            if let w = p.legs.compactMap(\.walk).first(where: { $0.state == .active }) { return walk(w.minNow ?? w.min) }
            return walk(step?.bus?.walkMin ?? 0)
        }
        guard let leg = step?.bus else { return step?.walk.map { walk($0.minNow ?? $0.min) } ?? "" }
        let onBus = p.phase == .onBus
        guard let t = onBus ? leg.alightEta : leg.boardEta else { return "No live bus time yet" }
        let live = onBus ? leg.alightLive : leg.boardLive
        return live ? "Arriving In: " + etaText(t, now: now, late: p.stale != .fresh) : "Arriving In: " + estText(t, now: now) + " est."
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
