import Foundation

/// Live progress of a started trip, for the Google-Maps-style "Current trip" timeline and the Live Activity:
/// walk to the boarding stop, then every stop of each bus leg (plus the stops the bus still has to pass
/// before it reaches you: "3 stops away"), the live bus between stops, a live ETA per stop from the trip's
/// tripUpdate (same trip id when known, else the next bus on that route reaching the boarding stop), then
/// the final walk. Pure: recompute it on every poll. Every time is an estimate.
public struct TripProgress: Hashable, Sendable {
    public enum Phase: String, Codable, Sendable { case walkToStop, waiting, riding, transfer, walkToDestination, arrived }
    /// Relative to the bus: stops it has passed, the stop it is heading to, stops after that.
    public enum RowState: String, Codable, Sendable { case passed, next, upcoming }
    public enum RowRole: String, Codable, Sendable { case approach, board, ride, alight }

    public struct StopRow: Hashable, Sendable, Identifiable {
        public var id: String
        public var stopId: String
        public var name: String
        public var coord: LatLon
        public var eta: Double?
        /// ETA from a live trip update (else interpolated from the plan, or nil).
        public var etaLive: Bool
        public var state: RowState
        public var role: RowRole
    }

    public struct BusSegment: Hashable, Sendable {
        public var legIndex: Int
        public var rid: String
        public var tripId: String?
        public var vehicleId: String?
        public var vehicleLabel: String?
        /// Approach stops (bus still has to pass them), then board ... alight.
        public var rows: [StopRow]
        /// Approach stops not listed because the bus is further away.
        public var hiddenBefore: Int
        /// Row the bus is heading to (nil = bus not located on these rows).
        public var busRow: Int?
        /// 0...1 progress from the row above `busRow` toward it.
        public var busFrac: Double
        /// Stops until the boarding stop (0 = it is the bus's next stop); nil when unknown or on board.
        public var stopsAway: Int?
        /// Stops until the alighting stop while on board (0 = get off at the next stop).
        public var stopsLeft: Int?
        public var boarded: Bool
        public var pastAlight: Bool
        public var boardIndex: Int
        public var alightIndex: Int
        public var boardEta: Double
        public var alightEta: Double
        /// Any ETA on this segment comes from a live trip update.
        public var live: Bool
        public var located: Bool { busRow != nil }
    }

    public enum Step: Hashable, Sendable {
        case walk(legIndex: Int, leg: WalkLeg, start: Double, end: Double, done: Bool, active: Bool)
        case bus(BusSegment)
    }

    public var steps: [Step]
    public var phase: Phase
    /// Re-estimated arrival at the destination.
    public var arrive: Double
    public var headline: String
    public var detail: String
    public var now: Double

    public static let maxApproach = 4

    public var segments: [BusSegment] { steps.compactMap { if case .bus(let s) = $0 { return s } else { return nil } } }
    /// The segment the rider is on or waiting for (nil on walk-only trips).
    public var currentSegment: BusSegment? { segments.first { !$0.pastAlight } ?? segments.last }

    // MARK: - Compute

    /// Earliest live time of `tu` at stopId after `after`.
    static func liveAt(_ tu: TripUpdate?, _ stopId: String, after: Double) -> Double? {
        var best: Double? = nil
        for u in tu?.stopTimeUpdates ?? [] where u.stopId == stopId {
            let t = u.time
            if t != 0 && t > after && (best == nil || t < best!) { best = t }
        }
        return best
    }

    /// The next trip of `rid` reaching `stopId` after now-30.
    static func nextTrip(_ live: LiveState, _ rid: String, _ stopId: String, _ now: Double) -> TripUpdate? {
        var best: (TripUpdate, Double)? = nil
        for t in live.trips where t.trip.routeId == rid {
            if let at = Notify.etaAt(t, stopId, now), best == nil || at < best!.1 { best = (t, at) }
        }
        return best?.0
    }

    static func vehicle(for tu: TripUpdate?, _ live: LiveState, _ now: Double) -> VehiclePosition? {
        guard let tu else { return nil }
        let v = live.buses.first { $0.trip.tripId != nil && $0.trip.tripId == tu.trip.tripId }
            ?? live.buses.first { $0.vehicle.id != nil && $0.vehicle.id == tu.vehicle.id }
        if let v, v.timestamp != 0, now - v.timestamp > Notify.busStaleS { return nil }
        return v
    }

    static func segment(_ legIndex: Int, _ b: BusLeg, _ S: StaticData, _ L: LiveState, _ now: Double) -> BusSegment {
        let (order, loop) = Notify.routeOrder(S.routeStops[b.rid])
        let legIds = b.stopIds.isEmpty ? [b.board.id ?? "", b.alight.id ?? ""] : b.stopIds
        let board = legIds[0]

        var tu: TripUpdate? = b.tripId.flatMap { tid in L.trips.first { $0.trip.tripId == tid } }
        if tu == nil { tu = nextTrip(L, b.rid, board, now) }
        var bus = vehicle(for: tu, L, now)
        func nextStop(_ v: VehiclePosition?, _ t: TripUpdate?) -> String? {
            guard let v else { return nil }
            if let s = v.stopId, order.contains(s) { return s }
            return Notify.nextFromTrip(t, now)
        }
        /// Index of the bus's next stop within the leg (> 0 = the bus has passed the boarding stop). On a loop
        /// the next stop can be in the leg while the bus is still a lap behind: if its trip reaches the
        /// boarding stop AFTER that stop, it is approaching, not past.
        func locate(_ next: String?, _ t: TripUpdate?) -> Int? {
            guard let next, let p = legIds.firstIndex(of: next) else { return nil }
            if p > 0, let bEta = Notify.etaAt(t, board, now), let nEta = Notify.etaAt(t, next, now), bEta > nEta { return nil }
            return p
        }
        var next = nextStop(bus, tu)
        var posInLeg = locate(next, tu)
        // The planned trip already left the boarding stop without us: follow the next bus instead.
        if (posInLeg ?? 0) == 0, tu != nil, Notify.etaAt(tu, board, now) == nil,
           let other = nextTrip(L, b.rid, board, now), other.trip.tripId != tu?.trip.tripId {
            tu = other
            bus = vehicle(for: tu, L, now)
            next = nextStop(bus, tu)
            posInLeg = locate(next, tu)
        }
        if bus == nil, tu == nil, let near = Notify.stopsAway(staticData: S, live: L, stopId: board, rids: [b.rid], now: now).first {
            bus = L.buses.first { $0.vehicle.id == near.vehicleId && $0.trip.tripId == near.tripId }
            tu = near.tripId.flatMap { tid in L.trips.first { $0.trip.tripId == tid } }
            next = near.nextStopId
            posInLeg = locate(next, tu)
        }

        var boarded = false, pastAlight = false
        var stopsAway: Int? = nil, stopsLeft: Int? = nil
        var approach: [String] = [], hiddenBefore = 0
        if let p = posInLeg {
            if p == 0 { stopsAway = 0 } else { boarded = true; stopsLeft = legIds.count - 1 - p }
        } else if let next, let i = order.firstIndex(of: next), let j = order.firstIndex(of: board) {
            var away = j - i
            if away < 0 { away = loop ? away + order.count : -1 }
            if away < 0 {
                pastAlight = true            // one-way route: the bus is beyond the boarding stop and the leg
            } else {
                stopsAway = away
                var ids: [String] = []
                var k = i
                while ids.count < away { ids.append(order[k]); k = (k + 1) % order.count }
                hiddenBefore = max(0, ids.count - maxApproach)
                approach = Array(ids.suffix(maxApproach))
            }
        }

        // Rows and ETAs (live from the trip update, monotonic along the rows; else interpolated from the plan).
        var rows: [StopRow] = []
        var prevT = now - 30
        var all: [(String, RowRole)] = approach.map { ($0, RowRole.approach) }
        for (k, id) in legIds.enumerated() {
            let role: RowRole = k == 0 ? .board : (k == legIds.count - 1 ? .alight : .ride)
            all.append((id, role))
        }
        for (k, item) in all.enumerated() {
            let id = item.0, role = item.1
            let s = S.stops[id]
            var eta = liveAt(tu, id, after: prevT)
            let isLive = eta != nil
            if let e = eta { prevT = e }
            if eta == nil, role != .approach, legIds.count > 1 {
                let idx = k - approach.count
                eta = b.boardT + (b.alightT - b.boardT) * Double(idx) / Double(legIds.count - 1)
            }
            rows.append(StopRow(id: "\(legIndex)-\(k)-\(id)", stopId: id, name: s?.name ?? id,
                                coord: s?.coord ?? LatLon(lat: .nan, lon: .nan), eta: eta, etaLive: isLive,
                                state: .upcoming, role: role))
        }
        let boardIndex = approach.count, alightIndex = rows.count - 1
        let boardEta = rows[boardIndex].eta ?? b.boardT, alightEta = rows[alightIndex].eta ?? b.alightT
        if !boarded && stopsAway == nil && !pastAlight && Notify.etaAt(tu, board, now) == nil && now > alightEta + 120 {
            pastAlight = true                // nothing live left and the planned ride is over
        }

        var busRow: Int? = nil
        var frac = 0.5
        if bus != nil && !pastAlight {
            if boarded, let p = posInLeg { busRow = approach.count + p }
            else if stopsAway == 0 { busRow = boardIndex }
            else if stopsAway != nil { busRow = 0 }
        }
        if let r = busRow, let v = bus {
            if r > 0 {
                let a = rows[r - 1].coord, n = rows[r].coord, here = v.coord
                if a.isValid && n.isValid && here.isValid {
                    let dp = Geo.hav(a, here), dn = Geo.hav(here, n)
                    if dp + dn > 0 { frac = min(0.9, max(0.1, dp / (dp + dn))) }
                }
            } else if hiddenBefore > 0 { frac = 0 }
            for i in rows.indices { rows[i].state = i < r ? .passed : i == r ? .next : .upcoming }
        } else {
            for i in rows.indices { if let e = rows[i].eta, e < now - 30 { rows[i].state = .passed } }
            if pastAlight { for i in rows.indices { rows[i].state = .passed } }
        }
        return BusSegment(legIndex: legIndex, rid: b.rid, tripId: tu?.trip.tripId ?? b.tripId, vehicleId: bus?.vehicle.id,
                          vehicleLabel: bus?.vehicle.label ?? tu?.vehicle.label, rows: rows, hiddenBefore: hiddenBefore,
                          busRow: busRow, busFrac: frac, stopsAway: boarded ? nil : stopsAway, stopsLeft: stopsLeft,
                          boarded: boarded, pastAlight: pastAlight, boardIndex: boardIndex, alightIndex: alightIndex,
                          boardEta: boardEta, alightEta: alightEta, live: rows.contains { $0.etaLive })
    }

    /// Progress of a started option against the latest live data.
    public static func compute(option: TripOption, staticData: StaticData, live: LiveState, now: Double) -> TripProgress {
        var steps: [Step] = []
        var t = option.t0
        var firstWalkEnd = option.t0
        for (i, leg) in option.legs.enumerated() {
            switch leg {
            case .walk(let w):
                let end = t + w.min * 60
                if i == 0 { firstWalkEnd = end }
                steps.append(.walk(legIndex: i, leg: w, start: t, end: end, done: false, active: false))
                t = end
            case .bus(let b):
                let seg = segment(i, b, staticData, live, now)
                steps.append(.bus(seg))
                t = max(t, seg.alightEta)
            }
        }
        let arrive = t
        let segs = steps.compactMap { s -> BusSegment? in if case .bus(let b) = s { return b } else { return nil } }
        let current = segs.firstIndex { !$0.pastAlight }
        let phase: Phase
        if let k = current {
            if segs[k].boarded { phase = .riding }
            else if k == 0 { phase = now < firstWalkEnd ? .walkToStop : .waiting }
            else { phase = .transfer }
        } else {
            phase = now >= arrive ? .arrived : .walkToDestination
        }
        // Walk step flags by position (number of bus legs before the walk).
        var busesBefore = 0
        for i in steps.indices {
            switch steps[i] {
            case .bus: busesBefore += 1
            case .walk(let li, let w, let s, let e, _, _):
                var done = false, active = false
                if busesBefore == 0 {
                    active = phase == .walkToStop; done = !active && !segs.isEmpty
                    if segs.isEmpty { active = phase == .walkToDestination; done = phase == .arrived }
                } else if busesBefore == segs.count {
                    active = phase == .walkToDestination; done = phase == .arrived
                } else {
                    let cur = current ?? segs.count
                    active = phase == .transfer && cur == busesBefore
                    done = cur > busesBefore || (cur == busesBefore && segs[cur].boarded)
                }
                steps[i] = .walk(legIndex: li, leg: w, start: s, end: e, done: done, active: active)
            }
        }
        var p = TripProgress(steps: steps, phase: phase, arrive: arrive, headline: "", detail: "", now: now)
        let tx = p.texts(staticData)
        p.headline = tx.0
        p.detail = tx.1
        return p
    }

    // MARK: - Text

    static func plural(_ n: Int, _ word: String) -> String { "\(n) \(word)\(n == 1 ? "" : "s")" }
    static func minutes(_ t: Double, _ now: Double) -> Int { max(0, Int(((t - now) / 60).rounded(.down))) }

    func texts(_ S: StaticData) -> (String, String) {
        guard let seg = currentSegment else {
            return phase == .arrived ? ("You have arrived", "") : ("Walk to your destination", "About \(Self.minutes(arrive, now)) min (est.)")
        }
        let route = S.routes[seg.rid]?.chipText ?? seg.rid
        let busName = seg.vehicleLabel.map { "Bus \($0)" } ?? route
        let boardName = seg.rows[seg.boardIndex].name, alightName = seg.rows[seg.alightIndex].name
        switch phase {
        case .walkToStop, .waiting, .transfer:
            let head: String
            if let a = seg.stopsAway, seg.located {
                head = a == 0 ? "\(busName) is arriving at \(boardName)" : "\(busName) is \(Self.plural(a, "stop")) from \(boardName)"
            } else {
                head = "Next \(route) at \(boardName) in about \(Self.minutes(seg.boardEta, now)) min"
            }
            let lead = phase == .waiting ? "Wait at \(boardName)" : "Walk to \(boardName)"
            return (head, "\(lead) · bus in about \(Self.minutes(seg.boardEta, now)) min (est.)")
        case .riding:
            let left = seg.stopsLeft ?? 0
            let head = left == 0 ? "Get off at the next stop: \(alightName)" : "\(Self.plural(left, "stop")) to \(alightName)"
            return (head, "On \(route) · arrive about \(Self.minutes(arrive, now)) min (est.)")
        case .walkToDestination:
            return ("Walk to your destination", "About \(Self.minutes(arrive, now)) min (est.)")
        case .arrived:
            return ("You have arrived", "")
        }
    }
}
