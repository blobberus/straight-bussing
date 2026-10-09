import Foundation

/// "Notify me when my bus is near <station>" settings (state.js `notify`, NOTIFY_DEFAULTS).
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
    public init() {}
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

/// A due bus-near alert.
public struct BusAlert: Hashable, Sendable {
    public enum Kind: String, Sendable { case twoStops, oneStop, minutes }
    public var key: String
    public var kind: Kind
    public var title: String
    public var body: String
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

    static func tripFor(_ trips: [TripUpdate], _ bus: VehiclePosition) -> TripUpdate? {
        if let tid = bus.trip.tripId, let t = trips.first(where: { $0.trip.tripId == tid }) { return t }
        if let vid = bus.vehicle.id, let t = trips.first(where: { $0.vehicle.id == vid }) { return t }
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
                               nextStopName: staticData.stops[next]?.name ?? next))
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
        let m = Int(((etaS - now) / 60).rounded(.down))
        return m < 1 ? "under a minute (est.)" : "about \(m) min (est.)"
    }

    static func routeName(_ s: StaticData, _ rid: String) -> String {
        guard let r = s.routes[rid] else { return "Shuttle" }
        return !r.long.isEmpty ? r.long : !r.short.isEmpty ? r.short : "Shuttle"
    }

    /// Alerts that should fire now (each trip + kind once). None while live data is down or old.
    public static func dueAlerts(prefs: NotifyPrefs, staticData: StaticData, live: LiveState, hidden: [String],
                                 fired prevFired: [String], now: Double) -> (alerts: [BusAlert], fired: [String]) {
        var fired = prevFired
        guard let sid = prefs.stopId else { return ([], fired) }
        let level = live.staleLevel(now: now)
        if level == .err || level == .old { return ([], fired) }
        let rids = watchedRoutes(prefs, staticData: staticData, hidden: hidden)
        if rids.isEmpty { return ([], fired) }
        let stop = staticData.stops[sid]?.name ?? "your station"
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
                let key = "\(sid)|\(it.tripId ?? it.vehicleId ?? "")|\(k.rawValue)"
                if fired.contains(key) { continue }
                if k == .twoStops && fired.contains(key.replacingOccurrences(of: "twoStops", with: "oneStop")) { continue }
                fired.append(key)
                alerts.append(BusAlert(key: key, kind: k, title: "\(routeName(staticData, it.rid)): \(head)", body: body))
            }
        }
        if fired.count > firedMax { fired = Array(fired.suffix(firedMax)) }
        return (alerts, fired)
    }
}
