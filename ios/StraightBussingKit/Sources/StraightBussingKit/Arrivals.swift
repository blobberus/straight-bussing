import Foundation

/// An upcoming live arrival at a stop.
public struct Arrival: Hashable, Sendable {
    public var rid: String
    /// Unix seconds.
    public var t: Double
    /// Vehicle label, if any.
    public var bus: String?
    public var tripId: String?
    public init(rid: String, t: Double, bus: String?, tripId: String?) {
        self.rid = rid; self.t = t; self.bus = bus; self.tripId = tripId
    }
}

/// Freshness of live data (core/arrivals.js staleLevel).
public enum StaleLevel: String, Sendable {
    /// Fresh.
    case fresh = ""
    /// Feed timestamp > 120 s old.
    case late
    /// Feed timestamp > 300 s old.
    case old
    /// Never succeeded, last success > 60 s ago, or the last poll failed.
    case err
}

/// Pure functions over live-state slices (web/js/core/arrivals.js).
public enum Arrivals {
    public static let errAfterS = 60.0
    public static let lateAfterS = 120.0
    public static let oldAfterS = 300.0

    /// Upcoming live arrivals at a stop, sorted by time. Includes arrivals up to 30 s in the past (bus at the
    /// stop). A trip that lists the stop twice (loop start/end) yields both times.
    /// - Parameters:
    ///   - routeId: only this route (`hidden` is ignored then)
    ///   - hidden: route ids to exclude
    public static func arrivalsFor(trips: [TripUpdate], stopId: String, routeId: String? = nil,
                                   hidden: [String] = [], now: Double) -> [Arrival] {
        let hid = Set(hidden)
        var out: [Arrival] = []
        for tu in trips {
            guard let rid = tu.trip.routeId else { continue }
            if let routeId { if rid != routeId { continue } } else if hid.contains(rid) { continue }
            for u in tu.stopTimeUpdates where u.stopId == stopId {
                let t = u.time
                if t != 0 && t > now - 30 {
                    out.append(Arrival(rid: rid, t: t, bus: tu.vehicle.label, tripId: tu.trip.tripId))
                }
            }
        }
        return out.stableSorted { $0.t < $1.t || ($0.t == $1.t && $0.rid < $1.rid) }
    }

    /// Freshness of live data.
    public static func staleLevel(lastOk: Double, failed: Bool, feedTs: Double, now: Double) -> StaleLevel {
        if lastOk == 0 || failed || now - lastOk > errAfterS { return .err }
        if feedTs != 0 && now - feedTs > oldAfterS { return .old }
        if feedTs != 0 && now - feedTs > lateAfterS { return .late }
        return .fresh
    }

    /// Number of vehicles currently reporting on a route.
    public static func runningCount(buses: [VehiclePosition], rid: String) -> Int {
        buses.reduce(0) { $0 + ($1.trip.routeId == rid ? 1 : 0) }
    }

    /// Alerts active at `now`: no active period, or any period containing now (open ends allowed).
    public static func activeAlerts(_ alerts: [ServiceAlert], now: Double) -> [ServiceAlert] {
        alerts.filter { a in
            if a.activePeriods.isEmpty { return true }
            return a.activePeriods.contains { w in
                (w.start == nil || w.start == 0 || w.start! <= now) && (w.end == nil || w.end == 0 || w.end! >= now)
            }
        }
    }
}

/// Time formatting helpers (web/js/core/time.js). All times are unix seconds.
public enum TimeFmt {
    /// Whole minutes from `from` until `t`, floored (can be <= 0).
    public static func minsUntil(_ t: Double, from: Double) -> Int { Int(((t - from) / 60).rounded(.down)) }

    /// '4:12 PM' in the device's locale and time zone ('' for invalid input).
    public static func clock(_ t: Double, timeZone: TimeZone = .current, locale: Locale = .current) -> String {
        guard t.isFinite, t > 0 else { return "" }
        let f = DateFormatter()
        f.locale = locale
        f.timeZone = timeZone
        f.setLocalizedDateFormatFromTemplate("jmm")
        return f.string(from: Date(timeIntervalSince1970: t))
    }

    /// '8s ago', '3 min ago', '2 h ago', '3 d ago'; future/now 'just now'; invalid 'never'.
    public static func ago(_ t: Double, from: Double) -> String {
        guard t.isFinite, t > 0 else { return "never" }
        let s = Int((from - t).rounded(.down))
        if s < 1 { return "just now" }
        if s < 60 { return "\(s)s ago" }
        if s < 3600 { return "\(s / 60) min ago" }
        if s < 86400 { return "\(s / 3600) h ago" }
        return "\(s / 86400) d ago"
    }

    /// Timeline ETA label: 'Now' under a minute, else 'N min' ('~N min' when data is stale).
    public static func etaLabel(_ t: Double?, now: Double, stale: Bool = false) -> String {
        guard let t, t != 0 else { return "" }
        let m = minsUntil(t, from: now)
        return m < 1 ? "Now" : (stale ? "~" : "") + "\(m) min"
    }
}
