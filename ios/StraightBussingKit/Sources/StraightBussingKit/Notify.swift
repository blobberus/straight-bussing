import Foundation

/// Bus alert settings (state.js `notify`, NOTIFY_DEFAULTS): "notify me when my bus is near <station>" and, since
/// 2026-10-13, trip alerts. `twoStops` / `oneStop` / `minutes` / `inApp` choose WHEN, for station and trip alerts alike.
public struct NotifyPrefs: Codable, Hashable, Sendable {
    public var stopId: String? = nil
    /// Empty = any visible route serving the station.
    public var rids: [String] = []
    public var twoStops = true
    public var oneStop = true
    /// 0 = off, else alert at <= N min.
    public var minutes = 0
    public var liveActivity = true
    public var inApp = true
    /// Alerts for a started trip (before your bus comes, before you get off). Settings > Bus alerts > Trip alerts.
    public var trip = true
    public init() {}

    enum CodingKeys: String, CodingKey { case stopId, rids, twoStops, oneStop, minutes, liveActivity, inApp, trip }

    /// Every field optional (web cleanNotify): a blob saved before a field existed (or with a wrong type in it) keeps
    /// its other settings and takes the default for the rest. A throwing decoder here would reset ALL of `Prefs`
    /// (hidden routes, favorites, custom routes), since NotifyPrefs is decoded inside it.
    public init(from decoder: Decoder) throws {
        let d = NotifyPrefs()
        guard let c = try? decoder.container(keyedBy: CodingKeys.self) else { self = d; return }
        func get<T: Decodable>(_ k: CodingKeys, _ def: T) -> T {
            if let v = try? c.decodeIfPresent(T.self, forKey: k) { return v }
            return def
        }
        if let s = try? c.decodeIfPresent(String.self, forKey: .stopId) { stopId = s } else { stopId = nil }
        rids = get(.rids, d.rids)
        twoStops = get(.twoStops, d.twoStops)
        oneStop = get(.oneStop, d.oneStop)
        minutes = get(.minutes, d.minutes)
        liveActivity = get(.liveActivity, d.liveActivity)
        inApp = get(.inApp, d.inApp)
        trip = get(.trip, d.trip)
    }
}

/// A live bus heading to a station.
public struct BusAway: Hashable, Sendable {
    public var rid: String
    public var tripId: String?
    public var vehicleId: String?
    public var label: String
    /// 0 = the station is the bus's next stop.
    public var stopsAway: Int
    public var etaS: Double?
    public var nextStopId: String
    public var nextStopName: String
}

/// A due bus alert: a station alert (twoStops / oneStop / minutes), a trip alert (board2 / board1 / boardMin before
/// boarding, off2 / off1 on board) or the one "Live data delayed" alert of an outage (both).
public struct BusAlert: Hashable, Sendable {
    public enum Kind: String, Sendable { case twoStops, oneStop, minutes, board2, board1, boardMin, off2, off1, delayed }
    public var key: String
    public var kind: Kind
    public var title: String
    public var body: String
    public init(key: String, kind: Kind, title: String, body: String) {
        self.key = key; self.kind = kind; self.title = title; self.body = body
    }
}

/// Pure "bus near my station" logic (web/js/core/notify.js), shared by in-app banners, local notifications
/// and the Live Activity. Minutes come only from live trip updates (never invented); texts say "est.".
public enum Notify {
    /// A vehicle report older than this (s) is ignored.
    public static let busStaleS = 180.0
    static let firedMax = 400

    /// Route order without a loop's repeated last stop.
    public static func routeOrder(_ list: [String]?) -> (order: [String], loop: Bool) {
        let l = list ?? []
        let loop = l.count > 2 && l.first == l.last
        return (loop ? Array(l.dropLast()) : l, loop)
    }

    /// The bus's own trip update: Passio reuses one trip id for several buses, so trip AND vehicle must match
    /// (the trip id alone only when it is unambiguous or the bus has no vehicle id), else the vehicle's entity.
    static func tripFor(_ trips: [TripUpdate], _ bus: VehiclePosition) -> TripUpdate? {
        let tid = bus.trip.tripId, vid = bus.vehicle.id
        let byTrip = tid == nil ? [] : trips.filter { $0.trip.tripId == tid }
        if let vid, let t = byTrip.first(where: { $0.vehicle.id == vid }) { return t }
        if vid == nil || byTrip.count == 1, let t = byTrip.first { return t }
        if let vid { return trips.first { $0.vehicle.id == vid } }
        return nil
    }

    /// First upcoming stop in a trip update (earliest time > now-30).
    static func nextFromTrip(_ tu: TripUpdate?, _ now: Double) -> String? {
        var best: (id: String, t: Double)? = nil
        for u in tu?.stopTimeUpdates ?? [] {
            let t = u.time
            if t != 0, t > now - 30, let id = u.stopId, best == nil || t < best!.t { best = (id, t) }
        }
        return best?.id
    }

    /// Live predicted arrival at stopId for this trip (earliest upcoming), or nil.
    static func etaAt(_ tu: TripUpdate?, _ stopId: String, _ now: Double) -> Double? {
        var best: Double? = nil
        for u in tu?.stopTimeUpdates ?? [] where u.stopId == stopId {
            let t = u.time
            if t != 0 && t > now - 30 && (best == nil || t < best!) { best = t }
        }
        return best
    }

    /// Every live bus heading to `stopId` and how far away it is, nearest first.
    public static func stopsAway(staticData: StaticData, live: LiveState, stopId: String, rids: [String]? = nil, now: Double) -> [BusAway] {
        let only: Set<String>? = rids.map { Set($0) }
        var out: [BusAway] = []
        for b in live.buses {
            guard let r = b.trip.routeId else { continue }
            if let only, !only.contains(r) { continue }
            if b.timestamp != 0 && now - b.timestamp > busStaleS { continue }
            let (order, loop) = routeOrder(staticData.routeStops[r])
            guard let j = order.firstIndex(of: stopId) else { continue }
            let tu = tripFor(live.trips, b)
            let next: String? = (b.stopId != nil && order.contains(b.stopId!)) ? b.stopId : nextFromTrip(tu, now)
            guard let next, let i = order.firstIndex(of: next) else { continue }
            var away = j - i
            if away < 0 {
                if !loop { continue }
                away += order.count
            }
            out.append(BusAway(rid: r, tripId: b.trip.tripId, vehicleId: b.vehicle.id, label: b.vehicle.label ?? b.vehicle.id ?? "",
                               stopsAway: away, etaS: etaAt(tu, stopId, now), nextStopId: next,
                               nextStopName: staticData.stops[next].flatMap { $0.name.isEmpty ? nil : $0.name } ?? next))
        }
        return out.stableSorted { a, b in
            a.stopsAway != b.stopsAway ? a.stopsAway < b.stopsAway : (a.etaS ?? .infinity) < (b.etaS ?? .infinity)
        }
    }

    /// Routes watched: the chosen ones serving the station, else every visible route serving it.
    public static func watchedRoutes(_ prefs: NotifyPrefs, staticData: StaticData, hidden: [String]) -> [String] {
        guard let sid = prefs.stopId else { return [] }
        let serve = staticData.stopRoutes[sid] ?? []
        let chosen = prefs.rids.filter { serve.contains($0) }
        if !chosen.isEmpty { return chosen }
        let h = Set(hidden)
        return serve.filter { !h.contains($0) }
    }

    /// "about 4 min (est.)" / "under a minute (est.)" / '' when there is no live time.
    public static func minutesText(_ etaS: Double?, now: Double) -> String {
        guard let etaS, etaS != 0 else { return "" }
        let m = TimeFmt.minsUntil(etaS, from: now)
        return m < 1 ? "under a minute (est.)" : "about \(m) min (est.)"
    }

    static func routeName(_ s: StaticData, _ rid: String) -> String {
        guard let r = s.routes[rid] else { return "Shuttle" }
        return !r.long.isEmpty ? r.long : !r.short.isEmpty ? r.short : "Shuttle"
    }

    /// The one alert when live data goes down (old or failing) while alerts are armed (web DELAYED_TITLE and bodies).
    public static let delayedTitle = "Live data delayed"
    public static let tripDelayedBody = "Bus positions and times may be off. Check the official app or call 773.702.8181."
    public static let stationDelayedBody = "Bus alerts are paused: bus positions may be off. Check the official app or call 773.702.8181."

    static func capped(_ fired: [String]) -> [String] { fired.count > firedMax ? Array(fired.suffix(firedMax)) : fired }

    /// Station alerts that should fire now (each trip + kind once). While live data is down or old: one 'delayed'
    /// alert per outage (only after data was reached once, and only while the app polls), nothing else.
    /// - tripOn: a started trip with trip alerts on is in progress (`tripAlertsOn`): station alerts pause, the
    ///   alerts follow the trip's bus.
    /// - polling: false while the feed is paused (the app is not in front, or back but before its first poll), so
    ///   old data is not an outage.
    public static func dueAlerts(prefs: NotifyPrefs, staticData: StaticData, live: LiveState, hidden: [String],
                                 fired prevFired: [String], now: Double, tripOn: Bool = false,
                                 polling: Bool = true) -> (alerts: [BusAlert], fired: [String]) {
        var fired = prevFired
        guard let sid = prefs.stopId, !tripOn else { return ([], fired) }
        let level = live.staleLevel(now: now), dk = "\(sid)|delayed"
        if level == .err || level == .old {
            if live.lastOk == 0 || !polling || fired.contains(dk) { return ([], fired) }
            fired.append(dk)
            return ([BusAlert(key: dk, kind: .delayed, title: delayedTitle, body: stationDelayedBody)], capped(fired))
        }
        fired.removeAll { $0 == dk }   // fresh again: a later outage alerts again
        let rids = watchedRoutes(prefs, staticData: staticData, hidden: hidden)
        if rids.isEmpty { return ([], fired) }
        let stop = staticData.stops[sid].flatMap { $0.name.isEmpty ? nil : $0.name } ?? "your station"   // web `||`
        var alerts: [BusAlert] = []
        for it in stopsAway(staticData: staticData, live: live, stopId: sid, rids: rids, now: now) {
            var kinds: [BusAlert.Kind] = []
            if prefs.oneStop && it.stopsAway <= 1 { kinds.append(.oneStop) }
            else if prefs.twoStops && it.stopsAway == 2 { kinds.append(.twoStops) }
            if prefs.minutes > 0, let eta = it.etaS, eta - now <= Double(prefs.minutes * 60) { kinds.append(.minutes) }
            for k in kinds {
                let when = minutesText(it.etaS, now: now)
                let head = k == .minutes ? (when.isEmpty ? "arriving soon" : "arriving in \(when)")
                    : it.stopsAway == 0 ? "your stop is next" : it.stopsAway == 1 ? "1 stop away" : "\(it.stopsAway) stops away"
                var body = "\(it.label.isEmpty ? "The bus" : "Bus \(it.label)") to \(stop). Next stop: \(it.nextStopName)."
                if k != .minutes && !when.isEmpty { body += " Arrives in \(when)." }
                if level == .late { body += " Live data is delayed." }
                let key = "\(sid)|\(it.tripId ?? "")|\(it.vehicleId ?? "")|\(k.rawValue)"   // trip ids are shared by several buses
                if fired.contains(key) { continue }
                if k == .twoStops && fired.contains(String(key.dropLast(BusAlert.Kind.twoStops.rawValue.count)) + BusAlert.Kind.oneStop.rawValue) { continue }
                fired.append(key)
                alerts.append(BusAlert(key: key, kind: k, title: "\(routeName(staticData, it.rid)): \(head)", body: body))
            }
        }
        return (alerts, capped(fired))
    }

    // MARK: - Trip alerts (2026-10-13, web core/notify.js tripAlerts)

    /// A number in a key the way the web writes it (1800000000, not 1800000000.0).
    static func keyNum(_ x: Double?) -> String {
        guard let x, x.isFinite else { return "" }
        return x == x.rounded() && abs(x) < 1e15 ? String(Int64(x)) : String(x)
    }

    /// Trip alerts that should fire now, from the trip's ONE progress evaluation (the `TripFollow` the Current trip
    /// card, the map and the Live Activity show). Before boarding, per followed bus (a different bus after a miss may
    /// alert again): 'board2' (2 stops away), 'board1' (1 stop away or your stop is next), 'boardMin' (live arrival
    /// within `prefs.minutes`). On board, once per ride (even if the trip id rolls): 'off2' ("Get off in 2 stops: X"),
    /// 'off1' ("Get off at the next stop: X" / "Get off here: X"). `prefs.twoStops` / `oneStop` / `minutes` choose
    /// which; `prefs.trip` false turns them off. Live data down: one 'delayed' alert per outage. Titles are the card's
    /// words (`TripText.busWords` / `offText`).
    /// - t0: when the trip was started (a new started trip = new keys).
    /// - live: the feed state `p` was computed from, at the same `now` (its stale level and whether data was ever
    ///   reached).
    /// - polling: false while the feed is paused (see `dueAlerts`).
    public static func tripAlerts(_ p: TripFollow?, prefs n: NotifyPrefs, staticData S: StaticData, live: LiveState, t0: Double?,
                                  fired prevFired: [String], now: Double, polling: Bool = true) -> (alerts: [BusAlert], fired: [String]) {
        var fired = prevFired
        guard let p, n.trip, p.phase != .arrived, p.legs.indices.contains(p.active), let leg = p.legs[p.active].bus else { return ([], fired) }
        let tk = "trip|\(keyNum(t0))|\(p.active)|\(leg.rid):\(leg.boardId)>\(leg.alightId)"
        let level = live.staleLevel(now: now)
        var alerts: [BusAlert] = []
        if level == .err || level == .old {
            let dk = "\(tk)|delayed"
            if live.lastOk != 0 && polling && !fired.contains(dk) {
                fired.append(dk)
                alerts.append(BusAlert(key: dk, kind: .delayed, title: delayedTitle, body: tripDelayedBody))
            }
            return (alerts, capped(fired))
        }
        fired.removeAll { $0 == "\(tk)|delayed" }
        guard leg.state == .active, let v = leg.vehicle else { return (alerts, fired) }
        let route = routeName(S, leg.rid), who = TripText.busName(v), late = level == .late ? " Live data is delayed." : ""
        func add(_ key: String, _ kind: BusAlert.Kind, _ title: String, _ body: String) {
            if fired.contains(key) { return }
            fired.append(key)
            alerts.append(BusAlert(key: key, kind: kind, title: title, body: body + late))
        }
        if p.phase == .walkToStop || p.phase == .waiting, let away = leg.stopsAway {
            let vk = "\(tk)|\(v.id.flatMap { $0.isEmpty ? nil : $0 } ?? v.label)"
            let when = leg.boardLive && leg.boardEta != nil && leg.boardEta != 0 ? " Arrives in \(minutesText(leg.boardEta, now: now))." : ""
            let foot = p.phase == .walkToStop && leg.canCatch == false ? " You may not make it on foot." : ""
            let head = "\(route): \(TripText.busWords(leg, now: now).status)", body = "Board at \(leg.boardName).\(when)\(foot)"
            if n.oneStop && away <= 1 { add("\(vk)|board1", .board1, head, body) }
            else if n.twoStops && away == 2 && !fired.contains("\(vk)|board1") { add("\(vk)|board2", .board2, head, body) }
            if n.minutes > 0, leg.boardLive, let eta = leg.boardEta, eta != 0, eta - now <= Double(n.minutes * 60) {
                add("\(vk)|boardMin", .boardMin, "\(route): arriving at \(leg.boardName) in \(minutesText(eta, now: now))", "\(who). Next stop: \(v.nextName).")
            }
        } else if p.phase == .onBus, let left = leg.stopsLeft {
            let body = "\(route), \(who)." + (leg.alightLive && leg.alightEta != nil && leg.alightEta != 0 ? " Your stop in \(minutesText(leg.alightEta, now: now))." : "")
            if n.oneStop && left <= 1 { add("\(tk)|off1", .off1, TripText.offText(left, leg.alightName), body) }
            else if n.twoStops && left == 2 && !fired.contains("\(tk)|off1") { add("\(tk)|off2", .off2, TripText.offText(2, leg.alightName), body) }
        }
        return (alerts, capped(fired))
    }

    /// A started trip with trip alerts on is in progress: station alerts pause meanwhile (web tripAlertsOn).
    public static func tripAlertsOn(_ p: TripFollow?, prefs: NotifyPrefs) -> Bool {
        guard let p else { return false }
        return p.phase != .arrived && prefs.trip
    }
}
