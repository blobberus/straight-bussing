import Foundation

/// Buses more than a block off their route (owner 2026-11-06: "If a bus is off it's route for more than a block, make
/// the bus disappear from the map (so it does not confuse viewers of the route) as it is most likely not running
/// anymore--still continue to track the bus"; it replaced the 2026-11-04 rule, 300 m from every line for 15 min). A
/// faithful port of web/js/core/offroute.js (same rules and numbers; OffRouteTests replays the web's answers on real bus
/// reports, Fixtures/offroute_golden.json). `LiveState.applying` runs it after `Operating`: a hidden bus leaves the map,
/// route pages, arrivals, counts, alerts and the planner, but its clock stays in `LiveState.offTracks` and the bus in
/// `LiveState.awayBuses` (the route page says "1 bus is away from the route and hidden from the map"), so it shows again
/// on its first report back within a block. Measured on 27 days of archived bus reports: RouteKnower.md E27b,
/// docs/ARCHITECTURE.md "Buses that do not follow their route".
///
/// MORE THAN A BLOCK OFF: farther than `blockM` from its OWN route's line (one Chicago block, 201 m, plus the drawn
/// line's offset from the lane and GPS error). The clock starts at the first such report and restarts within `blockM`
/// of its line, on a route change, or after `gapS` without a report. HIDDEN once the clock reaches `confirmS` on at
/// least two distinct reports (one bad GPS fix never hides a bus), except inside its route's listed hours (padded
/// `hoursPadS`) while an operator alert names its route or names no route and reads like a detour (an official detour
/// means the bus is serving riders). A hidden bus's trip updates are dropped too (`dropHidden`): Passio keeps
/// predicting buses that drive to the garage (DC-022).
public enum OffRoute {
    /// A report farther than this from its own route's line is more than a block off the route (m).
    public static let blockM = 250.0
    /// More than a block off for this long (from its first such report, on the bus's own report times) = hidden (s).
    public static let confirmS = 45.0
    /// The listed hours are padded this much at both ends for the detour alert exemption (s).
    public static let hoursPadS = 30.0 * 60
    /// No report from the bus for longer than this restarts its clock (s).
    public static let gapS = 600.0
    /// Operator alert text that reads like a detour (for alerts that name no route); web DETOUR_RE.
    public static let detourPattern = "detour|re-?rout|closed|closure|blocked|construction|bypass|not serv|will not stop|temporar"

    static let earthR = 6_371_000.0, rad = Double.pi / 180

    /// One bus's clock (web: tracks[id]); `n` = its distinct reports more than a block off since the clock started.
    public struct Track: Equatable, Sendable {
        public var rid: String
        public var since: Double
        public var last: Double
        public var n: Int
        public init(rid: String, since: Double, last: Double, n: Int) {
            self.rid = rid; self.since = since; self.last = last; self.n = n
        }
    }

    /// The closest point of a line and its distance (m).
    public struct Closest: Equatable, Sendable {
        public var d: Double
        public var lat: Double
        public var lon: Double
    }

    /// The closest point of a route's lines to a position (flat-earth meters around the position); nil without a line.
    public static func closestOnLine(_ lines: [[LatLon]]?, lat: Double, lon: Double) -> Closest? {
        guard let lines, lat.isFinite, lon.isFinite else { return nil }
        let kx = earthR * rad * cos(lat * rad), ky = earthR * rad
        var best: Closest? = nil
        for raw in lines {
            let line = raw.filter(\.isValid)
            guard line.count >= 2 else { continue }
            for i in 1..<line.count {
                let ax = (line[i - 1].lon - lon) * kx, ay = (line[i - 1].lat - lat) * ky
                let bx = (line[i].lon - lon) * kx, by = (line[i].lat - lat) * ky
                let dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy
                let t = l2 > 0 ? max(0, min(1, -(ax * dx + ay * dy) / l2)) : 0
                let qx = ax + t * dx, qy = ay + t * dy, d = hypot(qx, qy)
                if best == nil || d < best!.d { best = Closest(d: d, lat: lat + qy / ky, lon: lon + qx / kx) }
            }
        }
        return best
    }

    /// Inside the route's listed hours at `t`, padded `padS` at both ends (checked every 5 min); nil without schedule data.
    public static func inListedHours(_ service: ServiceData?, _ rid: String, _ t: Double, padS: Double = hoursPadS) -> Bool? {
        let now = Schedule.isScheduledNow(service, rid, t)
        if now != false { return now }
        var k = 300.0
        while k <= padS {
            if Schedule.isScheduledNow(service, rid, t - k) == true || Schedule.isScheduledNow(service, rid, t + k) == true { return true }
            k += 300
        }
        return false
    }

    /// An operator alert active at `now` that names the route (any text), or names no route and reads like a detour.
    public static func detourAlert(_ alerts: [ServiceAlert], routes: [String: Route], rid: String, now: Double) -> Bool {
        for a in Arrivals.activeAlerts(alerts, now: now) {
            let ids = Arrivals.alertRouteIds(a, routes: routes)
            if !ids.isEmpty {
                if ids.contains(rid) { return true }
                continue
            }
            if (a.header + " " + a.description).range(of: detourPattern, options: [.regularExpression, .caseInsensitive]) != nil {
                return true
            }
        }
        return false
    }

    /// One vehicle poll (web offRouteStep): carry each bus's clock forward and say which buses are hidden (vehicle ids,
    /// input order). `now` = the clock for listed hours and alerts; `feedTs` = the feed's time (report times fall back to it).
    public static func step(_ tracks: [String: Track], buses: [VehiclePosition], shapes: [String: [[LatLon]]],
                            service: ServiceData?, alerts: [ServiceAlert], routes: [String: Route], now: Double,
                            feedTs: Double) -> (tracks: [String: Track], hidden: [String]) {
        var next: [String: Track] = [:], hidden: [String] = [], seen = Set<String>()
        let ref = feedTs != 0 ? feedTs : now
        let nowT = now != 0 ? now : ref
        for b in buses {
            guard let id = b.vehicle.id, !id.isEmpty else { continue }
            seen.insert(id)
            guard let rid = b.trip.routeId, !rid.isEmpty, b.latitude.isFinite, b.longitude.isFinite else { continue }
            guard let own = closestOnLine(shapes[rid], lat: b.latitude, lon: b.longitude), own.d > blockM else { continue }
            let t = b.timestamp != 0 ? b.timestamp : ref
            let tr: Track
            if let p = tracks[id], p.rid == rid, t >= p.since, t - p.last <= gapS {
                tr = Track(rid: rid, since: p.since, last: max(p.last, t), n: max(p.n, 1) + (t > p.last ? 1 : 0))
            } else {
                tr = Track(rid: rid, since: t, last: t, n: 1)
            }
            next[id] = tr
            if tr.n < 2 || t - tr.since < confirmS { continue }                // one bad fix never hides a bus
            if inListedHours(service, rid, nowT) != false && detourAlert(alerts, routes: routes, rid: rid, now: nowT) { continue }   // official detour
            hidden.append(id)
        }
        for (id, p) in tracks where !seen.contains(id) && ref - p.last <= gapS { next[id] = p }
        return (next, hidden)
    }

    /// The buses and trip updates without the hidden vehicles (trip updates by vehicle id only: trip ids are shared).
    public static func dropHidden(buses: [VehiclePosition], trips: [TripUpdate], hidden: [String]) -> (buses: [VehiclePosition], trips: [TripUpdate]) {
        guard !hidden.isEmpty else { return (buses, trips) }
        let h = Set(hidden)
        return (buses.filter { !($0.vehicle.id.map(h.contains) ?? false) },
                trips.filter { !($0.vehicle.id.map(h.contains) ?? false) })
    }

    /// The buses `step` hid, kept for the route page (web awayBuses; `LiveState.awayBuses`): still tracked, not shown.
    public static func awayBuses(_ buses: [VehiclePosition], hidden: [String]) -> [VehiclePosition] {
        guard !hidden.isEmpty else { return [] }
        let h = Set(hidden)
        return buses.filter { $0.vehicle.id.map(h.contains) ?? false }
    }

    /// How many of a route's buses are more than a block off it and hidden (web awayCount).
    public static func awayCount(_ away: [VehiclePosition], rid: String) -> Int {
        away.filter { $0.trip.routeId == rid }.count
    }
}
