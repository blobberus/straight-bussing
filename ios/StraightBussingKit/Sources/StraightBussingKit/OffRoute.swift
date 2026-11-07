import Foundation

/// The streets each route's buses really drive where its drawn line is off (web/data/corridors.json, RouteKnower E27c;
/// web data/static.js cleanCorridors): per route the signature of the drawn line the points were learned against
/// (points, meters) and the points (centers of 25 m cells driven in service on most days, 80 to 400 m from the line).
/// Bad routes and points are dropped; a route not listed keeps the E27b rule.
public struct CorridorData: Sendable, Equatable {
    public struct Entry: Sendable, Equatable {
        /// The drawn line's points (every point of every line) and length in meters when the corridor was learned.
        public var n: Int
        public var m: Double
        public var pts: [LatLon]
        public init(n: Int, m: Double, pts: [LatLon]) { self.n = n; self.m = m; self.pts = pts }
    }
    public var routes: [String: Entry]
    /// 'YYYY-MM-DD' (Chicago); after it the file is not used.
    public var validUntil: String?
    public var from: String?
    public var to: String?
    public init(routes: [String: Entry] = [:], validUntil: String? = nil, from: String? = nil, to: String? = nil) {
        self.routes = routes; self.validUntil = validUntil; self.from = from; self.to = to
    }

    /// Parse corridors.json (nil when it is not a JSON object).
    public static func parse(_ data: Data) -> CorridorData? {
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
        var out: [String: Entry] = [:]
        for (rid, raw) in (o["routes"] as? [String: Any]) ?? [:] {
            guard let e = raw as? [String: Any], let shape = e["shape"] as? [String: Any], let ptsRaw = e["pts"] as? [Any],
                  let n = num(shape["n"]), let m = num(shape["m"]), n > 0, m > 0 else { continue }
            let pts: [LatLon] = ptsRaw.compactMap { p in
                guard let a = p as? [Any], a.count >= 2, let lat = num(a[0]), let lon = num(a[1]), lat.isFinite, lon.isFinite else { return nil }
                return LatLon(lat: lat, lon: lon)
            }
            out[rid] = Entry(n: Int(n), m: m, pts: pts)
        }
        return CorridorData(routes: out, validUntil: str(o["valid_until"]), from: str(o["from"]), to: str(o["to"]))
    }
}

/// Buses that do not follow their route (owner 2026-11-06: "If a bus is off it's route for more than a block, make the
/// bus disappear from the map (so it does not confuse viewers of the route) as it is most likely not running
/// anymore--still continue to track the bus"; 2026-11-07: "the buses that are not driving on their designated routes
/// are still showing sometimes (for example, the downtown connector still shows even if its not on its route)"). A
/// faithful port of web/js/core/offroute.js (same rules and numbers; OffRouteTests replays the web's answers on real bus
/// reports, Fixtures/offroute_golden.json). `LiveState.applying` runs it after `Operating`: a hidden bus leaves the map,
/// route pages, arrivals, counts, alerts and the planner, but its clock stays in `LiveState.offTracks` and the bus in
/// `LiveState.awayBuses` (the route page says "1 bus is away from the route and hidden from the map"), so it shows again
/// on its first report back. Measured on 28 days of archived bus reports: RouteKnower.md E27b and E27c,
/// docs/ARCHITECTURE.md "Buses that do not follow their route".
///
/// WHERE THE ROUTE IS: its drawn line and, where that line is off, the streets its buses really drive (`CorridorData`,
/// used only while the route's line is the one it was learned against and before `validUntil`; otherwise the route has
/// its line only and no NEAR tier). The distance of a report = to the line or a corridor point, whichever is nearer.
/// Clocks run on the bus's own report times and restart on a route change or after `gapS` without a report. HIDDEN:
/// FAR farther than `blockM` for `confirmS` on at least two distinct reports; FAST farther than `fastM` on two distinct
/// reports in a row; NEAR (routes with a usable corridor) farther than `nearM` for `nearS` on at least two reports;
/// except inside the route's listed hours (padded `hoursPadS`) while an operator alert names its route or names no route
/// and reads like a detour, and only within `detourMaxM` of the route. A hidden bus's trip updates are dropped too
/// (`dropHidden`): Passio keeps predicting buses that drive to the garage (DC-022).
public enum OffRoute {
    /// A report farther than this from its route (line or corridor) is more than a block off (m): the FAR tier.
    public static let blockM = 250.0
    /// More than a block off for this long (from its first such report, on the bus's own report times) = hidden (s).
    public static let confirmS = 45.0
    /// Two distinct reports in a row farther than this from the route = hidden at once (m): the FAST tier.
    public static let fastM = 500.0
    /// Routes with a usable corridor: farther than this from the line and the corridor ... (m): the NEAR tier.
    public static let nearM = 120.0
    /// ... for this long (on at least two distinct reports) = hidden (s).
    public static let nearS = 120.0
    /// The listed hours are padded this much at both ends for the detour alert exemption (s).
    public static let hoursPadS = 30.0 * 60
    /// No report from the bus for longer than this restarts its clock (s).
    public static let gapS = 600.0
    /// The detour alert exemption holds only this close to the route (m): the Downtown Campus Connector's Lake Shore
    /// Drive detours ran up to 2.5 km off; the Oct 28 reroute alert had kept buses 4 to 11 km away shown.
    public static let detourMaxM = 3000.0
    /// A route's line matches its corridor's when the point counts are equal and the lengths within this share (or 25 m).
    public static let shapeTol = 0.01
    /// Operator alert text that reads like a detour (for alerts that name no route); web DETOUR_RE.
    public static let detourPattern = "detour|re-?rout|closed|closure|blocked|construction|bypass|not serv|will not stop|temporar"

    static let earthR = 6_371_000.0, rad = Double.pi / 180

    /// One bus's clocks (web: tracks[id]). since / n = the current stretch off the route (farther than `nearM` with a
    /// corridor, `blockM` without) and its distinct reports; fs / fn = the same for farther than `blockM` (nil / 0 when
    /// nearer); ff = distinct reports in a row farther than `fastM`.
    public struct Track: Equatable, Sendable {
        public var rid: String
        public var since: Double
        public var last: Double
        public var n: Int
        public var fs: Double?
        public var fn: Int
        public var ff: Int
        public init(rid: String, since: Double, last: Double, n: Int, fs: Double? = nil, fn: Int = 0, ff: Int = 0) {
            self.rid = rid; self.since = since; self.last = last; self.n = n; self.fs = fs; self.fn = fn; self.ff = ff
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

    /// The signature of a route's drawn line that corridors.json stores (web shapeSig): its points and its length in
    /// meters (haversine, rounded).
    public static func shapeSig(_ lines: [[LatLon]]?) -> (n: Int, m: Double) {
        var n = 0, m = 0.0
        for line in lines ?? [] {
            n += line.count
            if line.count >= 2 { for i in 1..<line.count { m += Geo.hav(line[i - 1], line[i]) } }
        }
        return (n, m.rounded())
    }

    /// The learned corridor points of a route, when they can be used (web corridorFor): the file is not past
    /// `validUntil` (the Chicago date of `t`), it lists the route, and the route's line still matches. nil = no corridor
    /// (the route keeps its line only and no NEAR tier); an empty array = learned, nothing off the line.
    public static func corridorFor(_ corridors: CorridorData?, shapes: [String: [[LatLon]]], rid: String, t: Double) -> [LatLon]? {
        guard let corridors, let e = corridors.routes[rid] else { return nil }
        if let until = corridors.validUntil, !until.isEmpty, Schedule.isoDate(Schedule.localParts(t)) > until { return nil }
        let sig = shapeSig(shapes[rid])
        guard sig.n > 0, sig.n == e.n, abs(sig.m - e.m) <= max(25, shapeTol * e.m) else { return nil }
        return e.pts
    }

    /// Distance to the nearest of a corridor's points (flat-earth meters around the position); infinity when none.
    public static func nearestPoint(_ pts: [LatLon]?, lat: Double, lon: Double) -> Double {
        guard let pts, !pts.isEmpty, lat.isFinite, lon.isFinite else { return .infinity }
        let kx = earthR * rad * cos(lat * rad), ky = earthR * rad
        var best = Double.infinity
        for p in pts {
            let dx = (p.lon - lon) * kx, dy = (p.lat - lat) * ky, d = dx * dx + dy * dy
            if d < best { best = d }
        }
        return best.squareRoot()
    }

    /// How far a report is from its route: to the drawn line or a corridor point, whichever is nearer; nil without a line.
    public static func offDistance(_ lines: [[LatLon]]?, _ pts: [LatLon]?, lat: Double, lon: Double) -> Double? {
        guard let own = closestOnLine(lines, lat: lat, lon: lon) else { return nil }
        return own.d <= nearM ? own.d : min(own.d, nearestPoint(pts, lat: lat, lon: lon))
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

    /// One vehicle poll (web offRouteStep): carry each bus's clocks forward and say which buses are hidden (vehicle ids,
    /// input order). `now` = the clock for listed hours, alerts and the corridor file's date; `feedTs` = the feed's time
    /// (report times fall back to it).
    public static func step(_ tracks: [String: Track], buses: [VehiclePosition], shapes: [String: [[LatLon]]],
                            corridors: CorridorData? = nil, service: ServiceData?, alerts: [ServiceAlert],
                            routes: [String: Route], now: Double, feedTs: Double) -> (tracks: [String: Track], hidden: [String]) {
        var next: [String: Track] = [:], hidden: [String] = [], seen = Set<String>()
        let ref = feedTs != 0 ? feedTs : now
        let nowT = now != 0 ? now : ref
        var corr: [String: [LatLon]] = [:], checked = Set<String>()       // rid -> corridorFor (once per poll)
        for b in buses {
            guard let id = b.vehicle.id, !id.isEmpty else { continue }
            seen.insert(id)
            guard let rid = b.trip.routeId, !rid.isEmpty, b.latitude.isFinite, b.longitude.isFinite else { continue }
            if !checked.contains(rid) {
                checked.insert(rid)
                if let pts = corridorFor(corridors, shapes: shapes, rid: rid, t: nowT) { corr[rid] = pts }
            }
            let pts = corr[rid]
            guard let d = offDistance(shapes[rid], pts, lat: b.latitude, lon: b.longitude), d > (pts != nil ? nearM : blockM) else { continue }
            let t = b.timestamp != 0 ? b.timestamp : ref
            let p = tracks[id]
            let cont = p.map { $0.rid == rid && t >= $0.since && t - $0.last <= gapS } ?? false
            let fresh = !cont || t > (p?.last ?? t)                        // a new report (not the same one repeated)
            var tr: Track
            if cont, let p {
                tr = Track(rid: rid, since: p.since, last: max(p.last, t), n: max(p.n, 1) + (fresh ? 1 : 0))
            } else {
                tr = Track(rid: rid, since: t, last: t, n: 1)
            }
            if d > blockM {
                if cont, let p, let fs = p.fs, t >= fs {
                    tr.fs = fs
                    tr.fn = max(p.fn, 1) + (fresh ? 1 : 0)
                } else {
                    tr.fs = t
                    tr.fn = 1
                }
            }
            if d > fastM { tr.ff = cont ? max(1, (p?.ff ?? 0) + (fresh ? 1 : 0)) : 1 }
            next[id] = tr
            let hide = (tr.fn >= 2 && t - (tr.fs ?? t) >= confirmS)      // FAR: one bad fix never hides a bus
                || tr.ff >= 2                                              // FAST
                || (pts != nil && tr.n >= 2 && t - tr.since >= nearS)      // NEAR
            if !hide { continue }
            if d <= detourMaxM && inListedHours(service, rid, nowT) != false && detourAlert(alerts, routes: routes, rid: rid, now: nowT) { continue }   // official detour
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

    /// How many of a route's buses are off it and hidden (web awayCount).
    public static func awayCount(_ away: [VehiclePosition], rid: String) -> Int {
        away.filter { $0.trip.routeId == rid }.count
    }
}
