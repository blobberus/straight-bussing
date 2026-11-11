import Foundation

/// Learned linger spots (web/data/idle.json, RouteKnower E28): where and from what time buses of a route linger at the
/// end of their shift. Bad entries are dropped (web data/static.js cleanLinger).
public struct IdleData: Sendable, Equatable {
    public struct Linger: Sendable, Equatable {
        public var route: String
        public var spot: String
        public var lat: Double
        public var lon: Double
        public var r: Double
        /// Service-day clock 'HH:MM' (may pass 24:00).
        public var after: String
        /// 'weekday' | 'sat' | 'sun' | 'daily'.
        public var days: String
        /// The route's listed hours it was learned under ('HH:MM-HH:MM' windows joined by ',').
        public var hours: [String]
        public var seen: Int
        public init(route: String, spot: String = "", lat: Double, lon: Double, r: Double = 120, after: String, days: String,
                    hours: [String], seen: Int = 0) {
            self.route = route; self.spot = spot; self.lat = lat; self.lon = lon; self.r = r; self.after = after
            self.days = days; self.hours = hours; self.seen = seen
        }
    }
    public var linger: [Linger]
    public var validUntil: String?
    public var from: String?
    public var to: String?
    public init(linger: [Linger] = [], validUntil: String? = nil, from: String? = nil, to: String? = nil) {
        self.linger = linger; self.validUntil = validUntil; self.from = from; self.to = to
    }

    /// Parse idle.json (nil when it is not a JSON object).
    public static func parse(_ data: Data) -> IdleData? {
        guard let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        func num(_ v: Any?) -> Double? {
            if let n = v as? NSNumber { return n.doubleValue }
            if let s = v as? String, !s.trimmingCharacters(in: .whitespaces).isEmpty { return Double(s) }
            return nil
        }
        func str(_ v: Any?) -> String? {
            if let s = v as? String { return s }
            if let n = v as? NSNumber { return n.stringValue }
            return nil
        }
        var out: [Linger] = []
        for raw in (o["linger"] as? [Any]) ?? [] {
            guard let e = raw as? [String: Any], let route = str(e["route"]), !route.isEmpty,
                  let lat = num(e["lat"]), let lon = num(e["lon"]), lat.isFinite, lon.isFinite,
                  let after = e["after"] as? String, after.range(of: #"^\d{1,2}:\d{2}$"#, options: .regularExpression) != nil,
                  let days = e["days"] as? String, ["weekday", "sat", "sun", "daily"].contains(days),
                  let hoursRaw = e["hours"] as? [Any] else { continue }
            let hours = hoursRaw.compactMap { $0 as? String }.filter { !$0.isEmpty }
            guard !hours.isEmpty else { continue }
            let r = num(e["r"]).flatMap { $0.isFinite && $0 > 0 ? $0 : nil } ?? 120
            out.append(Linger(route: route, spot: str(e["spot"]) ?? "", lat: lat, lon: lon, r: r, after: after, days: days,
                              hours: hours, seen: Int(num(e["seen"]) ?? 0)))
        }
        return IdleData(linger: out, validUntil: str(o["valid_until"]), from: str(o["from"]), to: str(o["to"]))
    }
}

/// Buses that are idle and not in service (owner 2026-11-06: buses parked in front of Regenstein Library at 11:50 PM
/// still showed as moving buses). A faithful port of web/js/core/idle.js (same rules and numbers; IdleTests replays
/// the web's answers on real bus reports, Fixtures/idle_golden.json). `LiveState.applying` runs it next to `OffRoute`,
/// so the map, route pages, arrivals, counts, alerts and the planner never show or offer such a bus. Measured on 27
/// days of archived bus reports: RouteKnower.md E28, docs/ARCHITECTURE.md "Idle buses that are not in service".
///
/// STILL: the bus's reports stay within `stillM` of its first report there; the clock restarts farther than that, on a
/// route change, or after `gapS` without a report. HIDDEN while still and: `parkedS` (whatever Passio predicts);
/// `idleS` with no Passio prediction `futureS` ahead; `lingerS` more than `pastPadS` outside its listed hours; or
/// `lingerS` at a learned linger spot of its route after that spot's time (`IdleData`), only while today's listed
/// hours of the route are the learned ones and before `validUntil`. Moving shows it again at once. Clocks and the time
/// of day run on the buses' own report times, never the phone's.
public enum Idle {
    /// A bus within this of where its clock started is still (m).
    public static let stillM = 80.0
    /// ... downtown (north of `downtownLat`: the Loop, the South Loop, River North), where tall buildings scatter GPS fixes
    /// (m; owner 2026-11-11 "use a wider standing still radius", RouteKnower E32c; web STILL_DOWNTOWN_M).
    public static let stillDowntownM = 150.0
    /// Downtown starts here (latitude; Cermak Road is 41.853, campus 41.79).
    public static let downtownLat = 41.85

    /// The still radius where a bus's clock started (m; web stillRadius).
    public static func stillRadius(_ lat: Double) -> Double { lat >= downtownLat ? stillDowntownM : stillM }
    /// Still this long with no Passio prediction `futureS` ahead = hidden (s).
    public static let idleS = 30.0 * 60
    /// Still this long = hidden, whatever Passio predicts (s).
    public static let parkedS = 90.0 * 60
    /// Still this long outside the listed hours + `pastPadS`, or at a learned linger spot after its time = hidden (s).
    public static let lingerS = 3.0 * 60
    /// Outside the route's listed hours by more than this (s).
    public static let pastPadS = 60.0 * 60
    /// A prediction at least this far after the bus's report counts as "Passio expects it to move" (s).
    public static let futureS = 120.0
    /// No report from the bus for longer than this restarts its clock (s).
    public static let gapS = 600.0
    /// Radius of a learned linger spot when the file gives none (m).
    public static let spotR = 120.0

    static let earthR = 6_371_000.0, rad = Double.pi / 180

    /// One bus's still clock (web: tracks[id]).
    public struct Track: Equatable, Sendable {
        public var rid: String
        public var lat: Double
        public var lon: Double
        public var since: Double
        public var last: Double
        public init(rid: String, lat: Double, lon: Double, since: Double, last: Double) {
            self.rid = rid; self.lat = lat; self.lon = lon; self.since = since; self.last = last
        }
    }

    /// Why a bus is hidden.
    public enum Reason: String, Sendable { case parked, idle, past, linger }

    static func distM(_ lat1: Double, _ lon1: Double, _ lat2: Double, _ lon2: Double) -> Double {
        let kx = earthR * rad * cos((lat1 + lat2) / 2 * rad)
        return hypot((lon2 - lon1) * kx, (lat2 - lat1) * earthR * rad)
    }

    /// The service-day clock (web serviceClock): minutes since that day's midnight (00:30 after midnight = 1470), the
    /// service day's date, its key and its day group.
    public struct Clock: Equatable, Sendable {
        public var min: Int
        public var iso: String
        public var day: String
        public var group: String
    }

    public static func serviceClock(_ t: Double) -> Clock {
        let p = Schedule.localParts(t)
        let night = p.min < 240
        let d = night ? Schedule.localParts(t - 86400) : p
        let day = Schedule.dayKeys[d.dow]
        return Clock(min: night ? p.min + 1440 : p.min, iso: String(format: "%04d-%02d-%02d", d.y, d.m, d.d), day: day,
                     group: day == "sat" ? "sat" : day == "sun" ? "sun" : "weekday")
    }

    /// The route's listed hours on a service day as 'HH:MM-HH:MM' windows joined by ','; nil without schedule data.
    public static func hoursKey(_ service: ServiceData?, _ rid: String, iso: String, day: String) -> String? {
        guard let r = Schedule.routeService(service, rid) else { return nil }
        let d: ServiceDay?
        if let e = r.exceptions.first(where: { $0.date == iso }) { d = e.hours } else { d = r.days[day] }
        guard let d else { return "" }
        let spans: [[String]]
        if let s = d.spans, !s.isEmpty { spans = s }
        else if let f = d.first, let l = d.last, !f.isEmpty, !l.isEmpty { spans = [[f, l]] }
        else { spans = [] }
        return spans.filter { $0.count >= 2 }.map { $0[0] + "-" + $0[1] }.joined(separator: ",")
    }

    /// The learned linger spot of the route the bus is at, past that spot's time, or nil (web lingerAt).
    public static func lingerAt(_ idle: IdleData?, _ service: ServiceData?, rid: String, lat: Double, lon: Double, t: Double) -> IdleData.Linger? {
        guard let idle, !idle.linger.isEmpty, lat.isFinite, lon.isFinite else { return nil }
        let c = serviceClock(t)
        if let v = idle.validUntil, !v.isEmpty, c.iso > v { return nil }
        var key: String?? = nil
        for e in idle.linger {
            guard e.route == rid, e.days == "daily" || e.days == c.group else { continue }
            guard let after = Schedule.mins(e.after), c.min >= after else { continue }
            guard distM(lat, lon, e.lat, e.lon) <= (e.r > 0 ? e.r : spotR) else { continue }
            guard !e.hours.isEmpty else { continue }
            if key == nil { key = .some(hoursKey(service, rid, iso: c.iso, day: c.day)) }
            guard let k = key ?? nil, e.hours.contains(k) else { continue }
            return e
        }
        return nil
    }

    /// Does Passio predict a stop for this vehicle at least `futureS` after `t`? (Any trip update naming the vehicle.)
    public static func predictsAhead(_ trips: [TripUpdate], id: String, t: Double) -> Bool {
        for tu in trips where tu.vehicle.id == id {
            for u in tu.stopTimeUpdates {
                let at = u.time
                if at != 0 && at >= t + futureS { return true }
            }
        }
        return false
    }

    /// One vehicle poll (web idleStep): carry each bus's still clock forward and say which buses are hidden (vehicle
    /// ids, input order) and why.
    public static func step(_ tracks: [String: Track], buses: [VehiclePosition], trips: [TripUpdate], service: ServiceData?,
                            idle: IdleData?, now: Double, feedTs: Double) -> (tracks: [String: Track], hidden: [String], why: [String: Reason]) {
        var next: [String: Track] = [:], hidden: [String] = [], why: [String: Reason] = [:], seen = Set<String>()
        let ref = feedTs != 0 ? feedTs : now
        for b in buses {
            guard let id = b.vehicle.id, !id.isEmpty else { continue }
            seen.insert(id)
            guard let rid = b.trip.routeId, !rid.isEmpty, b.latitude.isFinite, b.longitude.isFinite else { continue }
            let t = b.timestamp != 0 ? b.timestamp : ref
            let p = tracks[id]
            let cont = p.map { $0.rid == rid && t >= $0.since && t - $0.last <= gapS && distM($0.lat, $0.lon, b.latitude, b.longitude) <= stillRadius($0.lat) } ?? false
            let tr = cont ? Track(rid: rid, lat: p!.lat, lon: p!.lon, since: p!.since, last: max(p!.last, t))
                          : Track(rid: rid, lat: b.latitude, lon: b.longitude, since: t, last: t)
            next[id] = tr
            let still = t - tr.since
            if still < lingerS { continue }
            var reason: Reason? = nil
            if still >= parkedS { reason = .parked }
            else if still >= idleS && !predictsAhead(trips, id: id, t: t) { reason = .idle }
            else if OffRoute.inListedHours(service, rid, t, padS: pastPadS) == false { reason = .past }
            else if lingerAt(idle, service, rid: rid, lat: b.latitude, lon: b.longitude, t: t) != nil { reason = .linger }
            if let reason { hidden.append(id); why[id] = reason }
        }
        for (id, p) in tracks where !seen.contains(id) && ref - p.last <= gapS { next[id] = p }
        return (next, hidden, why)
    }
}
