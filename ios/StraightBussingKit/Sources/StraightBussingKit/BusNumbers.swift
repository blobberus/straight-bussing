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

    // MARK: arrivals name their bus (owner 2026-11-06: "When showing which bus is about to arrive at station, it should
    // state which bus number displayed on the route is about to arrive if there is more than 1 bus")
    //
    // One source: the app's `busNumbers` (route id -> bus key -> number), from the buses the map draws, so a bus missing
    // from one poll keeps its number (and the others theirs) for 45 s, like its badge (web store.busNums, busnum.js
    // numberStep). An arrival is tied to a bus by the vehicle id on its trip update (else its label, as `key`) and gets
    // that bus's number only when the bus is numbered on the arrival's own route; otherwise no number, never a guess.

    /// The number the map shows on bus `key` of route `rid` (busnum.js busNumber); nil when the route has one bus or
    /// that bus is not on it.
    public static func number(_ numbers: [String: [String: Int]], rid: String?, key: String?) -> Int? {
        guard let rid, let key, !key.isEmpty else { return nil }
        return numbers[rid]?[key]
    }

    /// The bus an arrival comes from (busnum.js arrivalKey): its trip update's vehicle id, else its label.
    public static func arrivalKey(_ a: Arrival) -> String? {
        if let v = a.vehicleId, !v.isEmpty { return v }
        if let l = a.bus, !l.isEmpty { return l }
        return nil
    }

    /// The key of a followed trip vehicle: its vehicle id, else its label (`key` for a live bus).
    public static func vehicleKey(_ v: TripFollow.Vehicle) -> String? {
        if let id = v.id, !id.isEmpty { return id }
        return v.label.isEmpty ? nil : v.label
    }

    /// "Bus 2" for a number, "" for none (busnum.js numberName).
    public static func numberName(_ n: Int?) -> String {
        guard let n, n > 0 else { return "" }
        return "Bus \(n)"
    }

    /// Which numbered bus makes an arrival (busnum.js arrivalBusName): "Bus 2" when the arrival's route shows two or more
    /// buses and its vehicle is one of them, else "" (one bus on the line, no vehicle on the trip update, a bus the
    /// map does not draw, a bus numbered on another route).
    public static func arrivalName(_ a: Arrival, numbers: [String: [String: Int]]) -> String {
        numberName(number(numbers, rid: a.rid, key: arrivalKey(a)))
    }

    /// The numbered bus a planned bus leg boards (busnum.js legBusName): only a live boarding time comes from a known
    /// vehicle (the planner sets `vehicleId` from that trip update); a scheduled or estimated time names no bus.
    public static func legName(_ leg: BusLeg, numbers: [String: [String: Int]]) -> String {
        guard leg.waitLive, let vid = leg.vehicleId else { return "" }
        return numberName(number(numbers, rid: leg.rid, key: vid))
    }

    /// The arrival row's text after the live label (web ui/components.js arrivalRow): numbered " · Bus 2", with walking
    /// guidance " · Bus 2, leave in 3 min, est." (one middle dot per line); otherwise the guidance " · Leave in 3 min,
    /// est.", else the fleet label " · Bus 1647", else "".
    public static func rowExtra(number: String, sub: String?, label: String?) -> String {
        let s = sub ?? ""
        if !number.isEmpty {
            let guide: String = s.isEmpty ? "" : ", " + s.prefix(1).lowercased() + String(s.dropFirst())
            return " · " + number + guide
        }
        if !s.isEmpty { return " · " + s }
        if let label, !label.isEmpty { return " · Bus \(label)" }
        return ""
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

    /// Where the walk card goes among the ranked bus options (web core/rank.js walkPlace) and why: `at` 0 = first, 1 =
    /// second (under the top bus option); `why` picks its caption.
    public struct WalkPlace: Hashable, Sendable {
        public enum Why: String, Hashable, Sendable { case close, faster }
        public var at: Int
        public var why: Why
        public init(at: Int, why: Why) { self.at = at; self.why = why }
        /// The walk card's line on top (web WALK_CAPTION).
        public var caption: String { why == .close ? "Close enough to walk" : "Faster to walk" }
    }

    /// Added to the line of an option that walks least but arrives later than walking the whole way (web SLOWER_NOTE).
    public static let slowerNote = "walking is faster"

    /// Where walking the whole way is listed (owner 2026-10-30 walk first: "if the distance is very close, it is ok to just
    /// suggest the user to walk on their first travel option"; 2026-11-06 the long way around), web core/rank.js walkPlace:
    ///  - 10 minutes or less: first, "Close enough to walk";
    ///  - else a bus arrives before walking would: not listed (the "Walking the whole way" footnote);
    ///  - else the top bus option (least walking) saves walking (`savesWalking`): second, "Faster to walk", when walking
    ///    arrives more than the arrival tolerance (1 min) earlier; about as fast: not listed;
    ///  - else first ("Faster to walk" when more than 1 min earlier, else "Close enough to walk").
    public static func walkPlace(_ r: PlanResult) -> WalkPlace? {
        guard let top = r.options.first, r.walkOnlyMin > 0, r.walkOnlyMin.isFinite else { return nil }
        if r.walkOnlyMin <= walkFirstMaxMin + eps { return WalkPlace(at: 0, why: .close) }
        let arrive = r.now + r.walkOnlyMin * 60
        let best = r.options.map(\.arrive).min() ?? .infinity
        if arrive > best + eps { return nil }
        let faster = arrive < best - Criterion.arrive.tol * 60 - eps
        if savesWalking(optionStats(top).walk, r.walkOnlyMin) { return faster ? WalkPlace(at: 1, why: .faster) : nil }
        return WalkPlace(at: 0, why: faster ? .faster : .close)
    }

    /// The walk card leads the list (`walkPlace` at 0).
    public static func walkFirst(_ r: PlanResult) -> Bool { walkPlace(r)?.at == 0 }

    /// The small "what it minimizes" line of a bus option (web core/rank.js criteriaLine): `criteriaText`, plus
    /// " · walking is faster" when it walks least but arrives more than the arrival tolerance (1 min) after walking the
    /// whole way would (the long way around). nil `walkArrive`: no note.
    public static func criteriaLine(_ o: TripOption, walkArrive: Double?) -> String {
        let t = criteriaText(o.meets)
        guard !t.isEmpty, o.meets.contains(.walk), let w = walkArrive, w > 0 else { return t }
        return o.arrive > w + Criterion.arrive.tol * 60 + eps ? t + " \u{00B7} " + slowerNote : t
    }

    /// A bus option's criteria once walking the whole way is listed beside it (web core/rank.js besideWalk): it keeps
    /// "Least walking", "Earliest arrival" or "Shortest wait" only if it also beats the walk (`walkMin` minutes,
    /// arriving at `walkArrive`, no wait) within the same tolerance, so the list never claims what the option right
    /// above disproves (QA 2026-11-05: a trip that walked 12 min and arrived 7 min after a 7 min walk said "Least
    /// walking, earliest arrival, shortest wait"). Only `meets` can lose criteria; the order is unchanged.
    public static func besideWalk(_ o: TripOption, walkMin: Double, walkArrive: Double) -> TripOption {
        let s = optionStats(o)
        let meets = o.meets.filter { c in
            switch c {
            case .arrive: return s.arrive <= walkArrive + c.tol * 60 + eps
            case .walk: return s.walk <= walkMin + c.tol + eps
            case .wait: return s.wait <= c.tol + eps
            }
        }
        if meets.count == o.meets.count { return o }
        var copy = o
        copy.meets = meets
        return copy
    }

    /// The bus options as listed (web walkFirst): with the walk card listed (first or second, `walkPlace`) each goes
    /// through `besideWalk`; otherwise `r.options` unchanged.
    public static func listedOptions(_ r: PlanResult) -> [TripOption] {
        guard walkPlace(r) != nil else { return r.options }
        let arrive = r.now + r.walkOnlyMin * 60
        return r.options.map { besideWalk($0, walkMin: r.walkOnlyMin, walkArrive: arrive) }
    }
}
