import Foundation

/// A started trip in compact form (web ui/views/journey.js planJourney): enough to follow it later without the
/// Directions screen. `to` = destination name, `t0` = when the plan was made.
public struct TripJourney: Codable, Hashable, Sendable {
    public var to: String
    public var label: String
    public var t0: Double?
    public var legs: [TripJourney.Leg]
    public var rids: [String]

    public struct Bus: Codable, Hashable, Sendable {
        public var rid: String
        public var boardId: String
        public var boardName: String
        public var alightId: String
        public var alightName: String
        public var tripId: String?
        public var vehicleId: String?
        public var boardT: Double?
        public var alightT: Double?
        public var source: RideSource?
        public var waitLive: Bool
        public init(rid: String, boardId: String, boardName: String, alightId: String, alightName: String, tripId: String? = nil,
                    vehicleId: String? = nil, boardT: Double? = nil, alightT: Double? = nil, source: RideSource? = nil, waitLive: Bool = false) {
            self.rid = rid; self.boardId = boardId; self.boardName = boardName; self.alightId = alightId; self.alightName = alightName
            self.tripId = tripId; self.vehicleId = vehicleId; self.boardT = boardT; self.alightT = alightT; self.source = source
            self.waitLive = waitLive
        }
    }

    public enum Leg: Codable, Hashable, Sendable {
        case walk(min: Double, toName: String?)
        case bus(Bus)
    }

    public init(to: String, label: String? = nil, t0: Double?, legs: [TripJourney.Leg]) {
        self.to = to
        self.label = label ?? "To " + to
        self.t0 = t0
        self.legs = legs
        var r: [String] = []
        for l in legs { if case .bus(let b) = l, !r.contains(b.rid) { r.append(b.rid) } }
        rids = r
    }

    /// Compact legs of a planner option (journey.js journeyLegs): the last walk is named after the destination,
    /// a walk before a bus after its boarding stop.
    public static func legs(of o: TripOption, to: String) -> [TripJourney.Leg] {
        var out: [TripJourney.Leg] = []
        for (i, l) in o.legs.enumerated() {
            switch l {
            case .walk(let w):
                let next = i + 1 < o.legs.count ? o.legs[i + 1].bus : nil
                let name = i == o.legs.count - 1 ? to : next?.board.name ?? w.to.name
                out.append(.walk(min: w.min, toName: name))
            case .bus(let b):
                out.append(.bus(Bus(rid: b.rid, boardId: b.board.id ?? "", boardName: b.board.name, alightId: b.alight.id ?? "",
                                    alightName: b.alight.name, tripId: b.tripId, vehicleId: b.vehicleId, boardT: b.boardT,
                                    alightT: b.alightT, source: b.source, waitLive: b.waitLive)))
            }
        }
        return out
    }

    /// The journey for an option, or nil when it has no bus leg (walk-only trips are not followed).
    public static func plan(_ o: TripOption, to: String) -> TripJourney? {
        let j = TripJourney(to: to, t0: o.t0, legs: legs(of: o, to: to))
        return j.rids.isEmpty ? nil : j
    }

    /// Bus legs as "rid:board>alight" (what the timeline follows; Directions replaces the journey when it changes).
    public var legSignature: String {
        legs.compactMap { l -> String? in if case .bus(let b) = l { return "\(b.rid):\(b.boardId)>\(b.alightId)" } else { return nil } }
            .joined(separator: "|")
    }
}

/// Follow a started trip against live data (Current trip timeline, Google-Maps-transit style): a port of
/// web/js/core/tripprogress.js. Pure; recompute on every poll. For every bus leg: the stops from the boarding to
/// the alighting stop along routeStops (loops wrap), plus up to 3 stops before the boarding stop while the bus has
/// not reached it, the vehicle to follow and where it is.
///  - vehicle: the leg's planned trip AND vehicle (Passio reuses one trip id for several buses); else, once the
///    planned boarding time is past, a bus between the two stops (you are probably on it); else the next operating
///    bus arriving at the boarding stop that you can still walk to; else the route bus fewest stops before it. If
///    your location is still at the boarding stop after the followed bus left, it was missed and the next bus is
///    followed instead (`missed`).
///  - ETAs only from that vehicle's live stop_time_update, matched in order; no live time = nil. Planned times are
///    returned separately and flagged (not live).
/// Phases: walk-to-stop / waiting / on-bus / arrived. Without a live vehicle the phase follows the plan's clock
/// (`byTime`) and your location when known.
public struct TripFollow: Hashable, Sendable {
    public enum Phase: String, Sendable { case walkToStop = "walk-to-stop", waiting, onBus = "on-bus", arrived }
    public enum LegState: String, Sendable { case done, active, upcoming }
    public enum BusPhase: String, Sendable { case walkToStop = "walk-to-stop", waiting, onBus = "on-bus", done, upcoming }
    public enum StopRole: String, Sendable { case before, board, ride, alight }
    public enum StopState: String, Sendable { case passed, current, next, upcoming }
    public enum How: String, Sendable { case trip, onboard, next }

    /// Tunables (web TRIP).
    public static let before = 3          // stops listed before the boarding stop while the bus is still coming
    public static let atStopM = 35.0      // a bus this close to the stop it is heading to is at that stop
    public static let atUserM = 60.0      // you are at the stop within this distance
    public static let missedM = 120.0     // still this close to the boarding stop after the bus left -> missed it
    public static let busStaleS = 60.0    // a vehicle report older than this is labeled with its age
    public static let graceS = 60.0       // a planned time counts as passed this long after it is due
    public static let lateDoneS = 900.0   // planned trip gone this long after its planned arrival -> ride over
    public static let stopS = 90.0        // rough seconds per stop (only to skip buses you cannot reach)

    public struct Vehicle: Hashable, Sendable {
        public var id: String?
        public var label: String
        public var tripId: String?
        public var how: How
        /// Index in the leg's stops of the stop it is heading to (-1: `behind` stops before the first; count: past).
        public var idx: Int
        public var behind: Int
        public var beyond: Int
        public var frac: Double
        /// Within 35 m of stop `idx`.
        public var at: Bool
        /// Position in stop units (2.4 = 40% of the way from stop 2 to stop 3).
        public var pos: Double
        public var nextId: String
        public var nextName: String
        public var prevName: String?
        public var lat: Double?
        public var lon: Double?
        /// Report time (0 = unknown).
        public var seen: Double
        public var stale: Bool
    }

    public struct StopRow: Hashable, Sendable, Identifiable {
        public var id: String
        public var name: String
        public var role: StopRole
        public var state: StopState
        /// Live ETA from the followed bus (nil when none or passed).
        public var eta: Double?
    }

    public struct WalkStep: Hashable, Sendable {
        public var min: Double
        /// Live walking minutes from your location while walking to the stop.
        public var minNow: Double?
        public var toName: String
        public var final: Bool
        public var state: LegState
    }

    public struct BusStep: Hashable, Sendable {
        public var rid: String
        public var boardId: String
        public var boardName: String
        public var alightId: String
        public var alightName: String
        public var planTripId: String?
        public var source: RideSource?
        public var state: LegState = .upcoming
        public var phase: BusPhase = .upcoming
        public var vehicle: Vehicle?
        public var stops: [StopRow] = []
        public var boardIdx = 0
        public var alightIdx = 1
        public var stopsAway: Int?
        public var stopsLeft: Int?
        public var boardEta: Double?
        public var boardLive = false
        public var alightEta: Double?
        public var alightLive = false
        public var rideMin: Double?
        public var live = false
        public var byTime = false
        public var missed = false
        public var canCatch: Bool?
        public var slackMin: Double?
        public var walkMin: Double?
        public var doneT: Double?
    }

    public enum Step: Hashable, Sendable {
        case walk(WalkStep)
        case bus(BusStep)
        public var bus: BusStep? { if case .bus(let b) = self { return b }; return nil }
        public var walk: WalkStep? { if case .walk(let w) = self { return w }; return nil }
    }

    public var to: String
    public var label: String
    public var phase: Phase
    /// Index in `legs` of the current leg.
    public var active: Int
    public var arriveT: Double?
    public var arriveLive: Bool
    public var live: Bool
    public var stale: StaleLevel
    public var legs: [Step]

    public var busLegs: [BusStep] { legs.compactMap(\.bus) }
    /// The bus leg the rider is on or waiting for (the last one once arrived).
    public var currentBus: BusStep? { legs.indices.contains(active) ? legs[active].bus ?? busLegs.last : busLegs.last }

    // MARK: - Helpers

    static func walkMinM(_ m: Double) -> Double { m * Geo.walkDetour / Geo.walkMetersPerMin }

    /// Trip update of a trip run by a vehicle: with a vehicle the entity with both ids wins; the trip id alone only
    /// when it is unambiguous (or no vehicle is known); else the vehicle's own entity.
    static func tripUpdate(_ trips: [TripUpdate], _ tripId: String?, _ vehicleId: String?) -> TripUpdate? {
        let byTrip = tripId == nil ? [] : trips.filter { $0.trip.tripId == tripId }
        if let vehicleId, let t = byTrip.first(where: { $0.vehicle.id == vehicleId }) { return t }
        if vehicleId == nil || byTrip.count == 1, let t = byTrip.first { return t }
        if let vehicleId { return trips.first { $0.vehicle.id == vehicleId } }
        return nil
    }

    /// Operating bus running a trip: the planned vehicle when known, else the bus on that trip id, else the vehicle
    /// named in that trip's update.
    static func busForTrip(_ L: LiveState, _ rid: String, _ tripId: String?, _ vehicleId: String?) -> VehiclePosition? {
        let onRoute: (VehiclePosition) -> Bool = { $0.trip.routeId == rid }
        if let vehicleId { return L.buses.first { $0.vehicle.id == vehicleId && onRoute($0) } }
        guard let tripId else { return nil }
        if let b = L.buses.first(where: { $0.trip.tripId == tripId }) { return b }
        guard let vid = tripUpdate(L.trips, tripId, nil)?.vehicle.id else { return nil }
        return L.buses.first { $0.vehicle.id == vid && onRoute($0) }
    }

    struct Window {
        var order: [String]
        var loop: Bool
        var n: Int
        var path: [Int]
        var before: [Int]
    }

    /// Route-order indexes from board to alight (forward, loops wrap; shortest) plus the stops before, or nil.
    static func legWindow(_ list: [String]?, _ boardId: String, _ alightId: String) -> Window? {
        let (order, loop) = Notify.routeOrder(list)
        let n = order.count
        var best: (b: Int, len: Int)? = nil
        for (i, id) in order.enumerated() where id == boardId {
            let upper = loop ? n : n - i
            var s = 1
            while s < upper {
                if order[loop ? (i + s) % n : i + s] == alightId {
                    if best == nil || s < best!.len { best = (i, s) }
                    break
                }
                s += 1
            }
        }
        guard let b = best else { return nil }
        let path = (0...b.len).map { loop ? (b.b + $0) % n : b.b + $0 }
        var before: [Int] = []
        var used = Set(path)
        var k = path[0]
        for _ in 0..<Self.before {
            k = loop ? (k - 1 + n) % n : k - 1
            if k < 0 || used.contains(k) { break }
            used.insert(k)
            before.insert(k, at: 0)
        }
        return Window(order: order, loop: loop, n: n, path: path, before: before)
    }

    /// Where a bus is relative to window `w` (route-order indexes): idx into w, -1 behind it, w.count past it.
    /// preferBehind: the bus is known to be coming, so on a loop a next stop after the boarding stop means the
    /// previous lap.
    static func locate(_ W: Window, _ w: [Int], _ nextId: String, _ preferBehind: Bool) -> (idx: Int, behind: Int, beyond: Int)? {
        if let p = w.firstIndex(where: { W.order[$0] == nextId }), !(preferBehind && W.loop && p > W.before.count) {
            return (p, 0, 0)
        }
        var toFirst = Int.max, fromLast = Int.max
        for (k, id) in W.order.enumerated() where id == nextId {
            let b = W.loop ? (w[0] - k + W.n) % W.n : w[0] - k
            let a = W.loop ? (k - w[w.count - 1] + W.n) % W.n : k - w[w.count - 1]
            if b > 0 { toFirst = min(toFirst, b) }
            if a > 0 { fromLast = min(fromLast, a) }
        }
        if toFirst == Int.max && fromLast == Int.max { return nil }
        if toFirst < Int.max && (preferBehind || toFirst <= fromLast) { return (-1, toFirst, 0) }
        return (w.count, 0, fromLast)
    }

    /// A located vehicle plus the trip update whose predictions to use.
    struct Placed { var v: Vehicle; var tu: TripUpdate? }

    /// Vehicle record for a bus along the window w (nil when it is not on this route). tuFor: the trip update whose
    /// predictions to use (the trip you will ride; a vehicle can still be finishing an earlier trip), default the
    /// vehicle's current trip. The position always comes from the vehicle's current trip.
    static func vehicleAt(_ S: StaticData, _ L: LiveState, _ W: Window, _ w: [Int], _ bus: VehiclePosition, _ how: How,
                          _ now: Double, _ preferBehind: Bool, _ tuFor: TripUpdate?) -> Placed? {
        let cur = tripUpdate(L.trips, bus.trip.tripId, bus.vehicle.id)
        let tu = tuFor ?? cur
        var nextId = bus.stopId
        if nextId == nil || !W.order.contains(nextId!) {
            let ups = ((cur ?? tu)?.stopTimeUpdates ?? []).filter { $0.time > now - 30 }.stableSorted { $0.time < $1.time }
            nextId = ups.first?.stopId
        }
        guard let next = nextId, let loc = locate(W, w, next, preferBehind) else { return nil }
        let here = bus.coord
        let k = loc.idx >= 0 && loc.idx < w.count ? w[loc.idx] : (W.order.firstIndex(of: next) ?? 0)
        let pk = W.loop ? (k - 1 + W.n) % W.n : k - 1
        let prevId: String? = pk >= 0 ? W.order[pk] : nil
        var frac = 0.5, at = false
        let ns = S.stops[next], ps = prevId.flatMap { S.stops[$0] }
        if here.isValid, let ns, ns.coord.isValid {
            let dn = Geo.hav(here, ns.coord)
            at = dn <= atStopM
            if let ps, ps.coord.isValid {
                let dp = Geo.hav(ps.coord, here)
                if dp + dn > 0 { frac = min(0.9, max(0.1, dp / (dp + dn))) }
            }
        }
        let seen = bus.timestamp
        let pos: Double = loc.idx < 0 ? -1 : loc.idx >= w.count ? Double(w.count) : at ? Double(loc.idx) : Double(loc.idx) - 1 + frac
        let v = Vehicle(id: bus.vehicle.id, label: bus.vehicle.label ?? bus.vehicle.id ?? "", tripId: bus.trip.tripId, how: how,
                        idx: loc.idx, behind: loc.behind, beyond: loc.beyond, frac: frac, at: at, pos: pos, nextId: next,
                        nextName: ns.map { $0.name.isEmpty ? next : $0.name } ?? next,
                        prevName: ps.map { $0.name.isEmpty ? (prevId ?? "") : $0.name } ?? prevId,
                        lat: here.isValid ? here.lat : nil, lon: here.isValid ? here.lon : nil, seen: seen,
                        stale: seen != 0 && now - seen > busStaleS)
        return Placed(v: v, tu: tu)
    }

    /// Live ETAs of a trip update along stop ids, matched in order (nil where none).
    static func etasAlong(_ tu: TripUpdate?, _ ids: [String], _ from: Int, _ now: Double) -> [Double?] {
        var ups = (tu?.stopTimeUpdates ?? []).map { (id: $0.stopId ?? "null", t: $0.time, seq: $0.stopSequence) }
            .filter { $0.t != 0 && $0.t > now - 30 }
        if ups.allSatisfy({ $0.seq != nil }) {
            ups = ups.stableSorted { a, b in a.seq! != b.seq! ? a.seq! < b.seq! : a.t < b.t }
        } else {
            ups = ups.stableSorted { $0.t < $1.t }
        }
        var out = [Double?](repeating: nil, count: ids.count)
        var j = 0
        var k = max(0, from)
        while k < ids.count {
            var m = j
            while m < ups.count && ups[m].id != ids[k] { m += 1 }
            if m < ups.count { out[k] = ups[m].t; j = m + 1 }
            k += 1
        }
        return out
    }

    static func userTo(_ S: StaticData, _ user: LatLon?, _ id: String) -> Double? {
        guard let u = user, u.isValid, let s = S.stops[id], s.coord.isValid else { return nil }
        return Geo.hav(u, s.coord)
    }

    struct Ctx {
        var active: Bool
        var prevWalk: Double?   // minutes of the walk before this bus leg (nil = none)
        var walkStart: Double?
        var readyT: Double
    }

    /// Evaluate one bus leg (web evalBus).
    static func evalBus(_ l: TripJourney.Bus, _ S: StaticData, _ L: LiveState, _ user: LatLon?, _ now: Double, _ ctx: Ctx) -> BusStep {
        let rid = l.rid, bId = l.boardId, aId = l.alightId
        func nameOf(_ id: String) -> String {
            if let n = S.stops[id]?.name, !n.isEmpty { return n }
            if id == bId && !l.boardName.isEmpty { return l.boardName }
            if id == aId && !l.alightName.isEmpty { return l.alightName }
            return id
        }
        let W = legWindow(S.routeStops[rid], bId, aId)
        let pB = l.boardT.flatMap { $0.isFinite ? $0 : nil }, pA = l.alightT.flatMap { $0.isFinite ? $0 : nil }
        let rideS: Double? = pB != nil && pA != nil && pA! > pB! ? pA! - pB! : nil
        let nearBoard = userTo(S, user, bId)
        var out = BusStep(rid: rid, boardId: bId, boardName: nameOf(bId), alightId: aId, alightName: nameOf(aId),
                          planTripId: l.tripId, source: l.source)
        out.rideMin = rideS.map { $0 / 60 }
        let w: [Int] = W.map { $0.before + $0.path } ?? []
        let ids: [String] = W.map { win in w.map { win.order[$0] } } ?? [bId, aId]
        var bpos = W?.before.count ?? 0, apos = ids.count - 1

        func place(_ bus: VehiclePosition, _ how: How, _ behind: Bool, _ tu: TripUpdate? = nil) -> Placed? {
            guard let W else { return nil }
            return vehicleAt(S, L, W, w, bus, how, now, behind, tu)
        }
        let routeBuses = L.buses.filter { $0.trip.routeId == rid }
        // Still walking to the boarding stop: a "next" bus that passes it before you can get there is not your bus.
        let prevMin = ctx.prevWalk ?? 0
        let walking = ctx.active && ctx.prevWalk != nil && !(nearBoard != nil && nearBoard! <= atUserM)
            && !(nearBoard == nil && ctx.walkStart != nil && now >= ctx.walkStart! + prevMin * 60)
        let reachT: Double
        if !walking { reachT = now }
        else if let nb = nearBoard { reachT = now + 60 * walkMinM(nb) }
        else if let ws = ctx.walkStart { reachT = now + 60 * max(0, (ws - now) / 60 + prevMin) }
        else { reachT = now + 60 * prevMin }
        // seconds per stop, only to judge whether a bus WITHOUT a prediction gets there first (never displayed)
        let perStopS: Double = rideS != nil && W != nil ? rideS! / Double(max(1, W!.path.count - 1)) : stopS

        func approaching(_ skip: String?) -> Placed? {
            let minT = ctx.active ? max(now - 30, reachT - graceS) : ctx.readyT - 15
            for a in Arrivals.arrivalsFor(trips: L.trips, stopId: bId, routeId: rid, now: now) {
                if a.t < minT { continue }
                guard let b = busForTrip(L, rid, a.tripId, a.vehicleId) else { continue }
                if let skip, b.vehicle.id == skip { continue }
                if let v = place(b, .next, true, tripUpdate(L.trips, a.tripId, a.vehicleId)), v.v.idx <= bpos { return v }
            }
            var best: (v: Placed, away: Int)? = nil
            for b in routeBuses {
                if let skip, b.vehicle.id == skip { continue }
                guard let v = place(b, .next, true), v.v.idx <= bpos else { continue }
                let away = v.v.idx < 0 ? v.v.behind + bpos : bpos - v.v.idx
                if walking && now + Double(away) * perStopS < reachT - graceS { continue }   // gone before you get there
                if best == nil || away < best!.away { best = (v, away) }
            }
            return best?.v
        }

        let stillAtBoard = nearBoard != nil && nearBoard! <= missedM
        let nearAlight = userTo(S, user, aId)
        var V: Placed? = nil
        if let planned = busForTrip(L, rid, l.tripId, l.vehicleId) {
            // The vehicle may still be finishing an EARLIER trip (your trip is its next one): then it is coming
            // (never "past your stop"), and the predictions are those of YOUR trip.
            let onPlanned = l.tripId != nil && planned.trip.tripId == l.tripId
            let tu = tripUpdate(L.trips, l.tripId, l.vehicleId ?? (onPlanned ? planned.vehicle.id : nil))
            let coming = !onPlanned || (tu?.stopTimeUpdates.contains(where: { $0.stopId == bId && $0.time > now - 30 }) ?? false)
            let pastBoard = ctx.active && pB != nil && now > pB! + graceS && !stillAtBoard
            V = place(planned, .trip, coming && (!onPlanned || !pastBoard), tu)
            if let v = V, !onPlanned, v.v.idx > bpos { V = nil }   // line route: its earlier trip says nothing about yours
        }
        // the planned trip is gone: long past its planned arrival, or you are at the alighting stop -> leg done
        let lateDone = ctx.active && !stillAtBoard && ((nearAlight != nil && nearAlight! <= atUserM)
            || (pA != nil && now > pA! + lateDoneS && !(V != nil && V!.v.idx > bpos)))
        if V == nil && !lateDone && ctx.active && pB != nil && now > pB! + graceS && !stillAtBoard {
            var best: Placed? = nil
            for b in routeBuses {
                if let v = place(b, .onboard, false), v.v.idx > bpos, v.v.idx <= apos, best == nil || v.v.idx < best!.v.idx { best = v }
            }
            V = best
        }
        if V == nil && !lateDone { V = approaching(nil) }
        if let v = V, ctx.active, v.v.idx > bpos, stillAtBoard {
            var nearStop = false
            if let lat = v.v.lat, let lon = v.v.lon, let sb = S.stops[bId], sb.coord.isValid {
                nearStop = Geo.hav(LatLon(lat: lat, lon: lon), sb.coord) < missedM + 130
            }
            if !nearStop {
                out.missed = true
                V = approaching(v.v.id)
            }
        }

        // phase
        func atStop() -> Bool {
            guard ctx.prevWalk != nil else { return true }
            if let nb = nearBoard { return nb <= atUserM }
            return ctx.walkStart != nil && now >= ctx.walkStart! + prevMin * 60
        }
        var onBus = false, done = false
        if lateDone && !(V != nil && V!.v.idx > bpos && V!.v.idx <= apos) {
            done = true; out.byTime = V == nil; V = nil
        } else if let v = V {
            if v.v.idx > apos { done = !out.missed } else if v.v.idx > bpos { onBus = true }
        } else if ctx.active, let pb = pB, !stillAtBoard {
            out.byTime = true
            if now >= (pA ?? pb + 600) + graceS { done = true } else if now >= pb + graceS { onBus = true }
        }
        if !ctx.active { out.state = .upcoming; out.phase = .upcoming; done = false; onBus = false }
        else if done { out.state = .done; out.phase = .done }
        else { out.state = .active; out.phase = onBus ? .onBus : atStop() ? .waiting : .walkToStop }

        // stops before the boarding stop only while a live bus is still coming to it on the active leg
        var list = ids, from = 0
        if W != nil && (onBus || done || !ctx.active || V == nil) && bpos > 0 {
            list = Array(ids[bpos...]); from = bpos; apos -= bpos; bpos = 0
            if var v = V {
                if v.v.idx < 0 { v.v.behind += from } else if v.v.idx < from { v.v.behind = from - v.v.idx }
                v.v.idx = v.v.idx < from ? -1 : v.v.idx - from
                v.v.pos = v.v.idx < 0 ? -1 : v.v.pos - Double(from)
                V = v
            }
        }
        // live ETAs from the followed bus
        let etas: [Double?] = V.flatMap { v in v.tu.map { etasAlong($0, list, v.v.idx, now) } } ?? list.map { _ in nil }
        out.stops = list.enumerated().map { k, id in
            var st: StopState = .upcoming
            if done { st = .passed }
            else if let v = V?.v, v.idx >= list.count { st = .passed }
            else if let v = V?.v, v.idx >= 0 { st = k < v.idx ? .passed : k == v.idx ? (v.at ? .current : .next) : .upcoming }
            else if V == nil && onBus && k <= bpos { st = .passed }
            let role: StopRole = k == bpos ? .board : k == apos ? .alight : k < bpos ? .before : .ride
            return StopRow(id: id, name: nameOf(id), role: role, state: st, eta: st == .passed ? nil : etas[k])
        }
        out.boardIdx = bpos; out.alightIdx = apos
        if let v = V?.v {
            out.vehicle = v
            if v.idx <= bpos { out.stopsAway = v.idx < 0 ? v.behind + bpos : bpos - v.idx }
            else if v.idx <= apos { out.stopsLeft = v.at && v.idx == apos ? 0 : apos - v.idx + 1 }
        }
        // board / alight times: live from the followed bus, else the plan (flagged)
        let be = out.stops.indices.contains(bpos) ? out.stops[bpos].eta : nil
        let ae = out.stops.indices.contains(apos) ? out.stops[apos].eta : nil
        if let be { out.boardEta = be; out.boardLive = true }
        else if !onBus && !done && V == nil, let pb = pB, pb > max(now, ctx.active ? 0 : ctx.readyT) - graceS { out.boardEta = pb }
        else if !onBus && !done && !ctx.active && V == nil { out.boardEta = max(ctx.readyT, pB ?? 0) }
        if let ae { out.alightEta = ae; out.alightLive = true }
        else if let b = out.boardEta, let r = rideS { out.alightEta = b + r }
        else if let pa = pA, !done { out.alightEta = max(pa, now) }
        else if done, let pa = pA { out.alightEta = min(pa, now) }
        out.live = V != nil || out.boardLive || out.alightLive
        if done { out.doneT = out.alightEta.map { min($0, now) } ?? now }

        // walking to the stop: live walking time from your location, leave slack against the bus time
        if out.phase == .walkToStop, ctx.prevWalk != nil {
            let wm = nearBoard.map(walkMinM) ?? prevMin
            out.walkMin = wm
            if let b = out.boardEta { out.slackMin = (b - now) / 60 - wm; out.canCatch = out.slackMin! >= 0 }
        }
        return out
    }

    // MARK: - Compute

    /// Progress of a started trip (nil when the journey has no bus leg).
    public static func compute(_ J: TripJourney, staticData S: StaticData, live L: LiveState, user: LatLon?, now: Double) -> TripFollow? {
        guard J.legs.contains(where: { if case .bus = $0 { return true }; return false }) else { return nil }
        let src = J.legs
        var legs: [Step] = []
        var allDone = true, readyT = now, walkStart = J.t0, active = -1
        for (i, l) in src.enumerated() {
            switch l {
            case .walk(let min, let toName):
                legs.append(.walk(WalkStep(min: min, minNow: nil, toName: toName ?? "", final: i == src.count - 1, state: .upcoming)))
            case .bus(let b):
                var prevWalk: Double? = nil
                if i > 0, case .walk(let m, _) = src[i - 1] { prevWalk = m }
                if !allDone { readyT += (prevWalk ?? 0) * 60 }
                let r = evalBus(b, S, L, user, now, Ctx(active: allDone, prevWalk: prevWalk, walkStart: walkStart, readyT: readyT))
                legs.append(.bus(r))
                if r.state == .done {
                    walkStart = r.doneT
                    readyT = max(now, r.doneT ?? now)
                    continue
                }
                if allDone { active = legs.count - 1 }
                allDone = false
                readyT = r.alightEta ?? (r.boardEta.map { $0 + (r.rideMin ?? 0) * 60 } ?? readyT)
            }
        }
        // walk legs follow the bus legs around them
        let fallbackTo = !J.to.isEmpty ? J.to : J.label.hasPrefix("To ") ? String(J.label.dropFirst(3)) : J.label
        for i in legs.indices {
            guard case .walk(var w) = legs[i] else { continue }
            if w.final {
                if w.toName.isEmpty { w.toName = fallbackTo.isEmpty ? "destination" : fallbackTo }
                w.state = allDone ? .active : .upcoming
            } else if i + 1 < legs.count, case .bus(let next) = legs[i + 1] {
                if w.toName.isEmpty { w.toName = next.boardName }
                w.state = next.phase == .walkToStop ? .active : next.state == .upcoming ? .upcoming : .done
                if next.phase == .walkToStop { w.minNow = next.walkMin }
            }
            legs[i] = .walk(w)
        }
        if allDone { active = legs.count - 1 }
        let cur: Step? = legs.indices.contains(active) ? legs[active] : nil
        let phase: Phase
        if allDone { phase = .arrived }
        else {
            switch cur?.bus?.phase {
            case .onBus?: phase = .onBus
            case .waiting?: phase = .waiting
            default: phase = .walkToStop
            }
        }
        let buses = legs.compactMap(\.bus)
        let lastBus = buses[buses.count - 1]
        let fin = legs.last?.walk
        var arriveT: Double? = allDone ? (lastBus.doneT ?? now) : lastBus.alightEta
        if let a = arriveT, let f = fin { arriveT = a + f.min * 60 }
        if let a = arriveT, allDone { arriveT = max(a, now) }
        let to = !J.to.isEmpty ? J.to : !fallbackTo.isEmpty ? fallbackTo : fin?.toName ?? "destination"
        let liveNow = cur?.bus?.live ?? lastBus.live
        return TripFollow(to: to, label: J.label, phase: phase, active: active, arriveT: arriveT,
                          arriveLive: !allDone && lastBus.alightLive, live: liveNow, stale: L.staleLevel(now: now), legs: legs)
    }
}
