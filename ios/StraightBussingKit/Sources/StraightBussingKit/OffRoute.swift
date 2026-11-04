import Foundation

/// Buses that are not following their route (owner 2026-11-04: "If buses are not following their routes for a long
/// period of time (measure this by the bus operation data and their listed hours), remove them from the map"). A
/// faithful port of web/js/core/offroute.js (same rules and numbers; OffRouteTests replays the web's answers on real
/// bus reports, Fixtures/offroute_golden.json). `LiveState.applying` runs it after `Operating`, so the map, route
/// pages, arrivals, counts, alerts and the planner never show such a bus. Measured on 25 days of archived bus reports:
/// RouteKnower.md E27, docs/ARCHITECTURE.md "Buses that do not follow their route".
///
/// OFF the route: farther than `offM` from its route's line AND from every other route's line (a bus filling in on
/// another line still follows a route). The clock starts at the first such report and restarts when it comes within
/// `offM` of any line, changes route, or sends nothing for `gapS`. HIDDEN once the clock reaches `hideInS` inside its
/// route's listed hours (padded `hoursPadS`), `hideOutS` outside them, except (rider safety) while FOLLOWING (the closest
/// points of its line spread `followM` since the clock started: the Downtown Campus Connector off Lake Shore Drive),
/// RETURNING (`returnM` closer to its line than its farthest point: leaving the garage), or, inside the listed hours,
/// during an operator alert that names its route or names no route and reads like a detour. A hidden bus's trip updates
/// are dropped too (`dropHidden`): Passio kept predicting the buses that drove to the garage on Nov 2 (DC-022).
public enum OffRoute {
    /// A report farther than this from its route's line (and from every other line) is off the route (m).
    public static let offM = 300.0
    /// Off the route this long inside the listed hours (+ `hoursPadS`) = hidden (s).
    public static let hideInS = 15.0 * 60
    /// Off the route this long outside the listed hours = hidden (s).
    public static let hideOutS = 5.0 * 60
    /// The listed hours are padded this much at both ends (s).
    public static let hoursPadS = 30.0 * 60
    /// The closest points of the line spread this far since the clock started = driving along the route elsewhere (m).
    public static let followM = 1500.0
    /// This much closer to its line than its farthest point since the clock started = heading back (m).
    public static let returnM = 1000.0
    /// No report from the bus for longer than this restarts its clock (s).
    public static let gapS = 600.0
    /// Operator alert text that reads like a detour (for alerts that name no route); web DETOUR_RE.
    public static let detourPattern = "detour|re-?rout|closed|closure|blocked|construction|bypass|not serv|will not stop|temporar"

    static let earthR = 6_371_000.0, rad = Double.pi / 180

    /// A lat/lon box (the closest line points since the clock started).
    public struct Box: Equatable, Sendable {
        public var s: Double, n: Double, w: Double, e: Double
        public init(s: Double, n: Double, w: Double, e: Double) { self.s = s; self.n = n; self.w = w; self.e = e }
    }

    /// One bus's clock (web: tracks[id]).
    public struct Track: Equatable, Sendable {
        public var rid: String
        public var since: Double
        public var last: Double
        public var dmax: Double
        public var box: Box
        public init(rid: String, since: Double, last: Double, dmax: Double, box: Box) {
            self.rid = rid; self.since = since; self.last = last; self.dmax = dmax; self.box = box
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

    static func spanM(_ b: Box) -> Double {
        let kx = earthR * rad * cos((b.s + b.n) / 2 * rad)
        return hypot((b.e - b.w) * kx, (b.n - b.s) * earthR * rad)
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
            guard let own = closestOnLine(shapes[rid], lat: b.latitude, lon: b.longitude), own.d > offM else { continue }
            if shapes.keys.contains(where: { $0 != rid && (closestOnLine(shapes[$0], lat: b.latitude, lon: b.longitude)?.d ?? .infinity) <= offM }) {
                continue                                                       // on another route's line
            }
            let t = b.timestamp != 0 ? b.timestamp : ref
            let p = tracks[id]
            let cont = p.map { $0.rid == rid && t >= $0.since && t - $0.last <= gapS } ?? false
            let box: Box
            if cont, let p {
                box = Box(s: min(p.box.s, own.lat), n: max(p.box.n, own.lat), w: min(p.box.w, own.lon), e: max(p.box.e, own.lon))
            } else {
                box = Box(s: own.lat, n: own.lat, w: own.lon, e: own.lon)
            }
            let tr = Track(rid: rid, since: cont ? p!.since : t, last: cont ? max(p!.last, t) : t,
                           dmax: max(cont ? p!.dmax : 0, own.d), box: box)
            next[id] = tr
            let inside = inListedHours(service, rid, nowT) != false             // no schedule data counts as inside
            if t - tr.since < (inside ? hideInS : hideOutS) { continue }
            if spanM(box) >= followM { continue }                              // following its route elsewhere
            if own.d <= tr.dmax - returnM { continue }                         // heading back to its line
            if inside && detourAlert(alerts, routes: routes, rid: rid, now: nowT) { continue }
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
}
