import Foundation

/// Which vehicles in the live feed are actually in service (web/js/core/operating.js). Owner rule
/// (2026-10-08): a bus that is not operating is not shown anywhere (map, station lists, counts, alerts,
/// planner).
///
/// A bus is operating when ALL hold:
///  1. Fresh position: its last report is at most `staleS` older than the feed itself (feed clock).
///  2. Known route: its route id is in the static network.
///  3. In service: its route is scheduled now, OR its trip still has a live prediction it has not reached.
/// Before static data loads, only rule 1 applies.
public enum Operating {
    /// Seconds after which a vehicle's last report means it is not operating.
    public static let staleS = 300.0
    static let predGraceS = 60.0

    public struct Context: Sendable {
        public var routes: [String: Route]
        public var service: ServiceData
        public var trips: [TripUpdate]
        public var feedTs: Double
        public var now: Double
        public var staticLoaded: Bool
        public init(routes: [String: Route], service: ServiceData, trips: [TripUpdate], feedTs: Double, now: Double, staticLoaded: Bool) {
            self.routes = routes; self.service = service; self.trips = trips; self.feedTs = feedTs; self.now = now
            self.staticLoaded = staticLoaded
        }
    }

    static func hasLivePrediction(_ bus: VehiclePosition, _ trips: [TripUpdate], _ ref: Double) -> Bool {
        guard let id = bus.trip.tripId else { return false }
        for t in trips where t.trip.tripId == id {
            if let a = t.vehicle.id, let b = bus.vehicle.id, a != b { continue }   // shared trip id, other bus
            for u in t.stopTimeUpdates {
                let at = u.time
                if at != 0 && at >= ref - predGraceS { return true }
            }
        }
        return false
    }

    /// Is this vehicle in service?
    public static func isOperating(_ bus: VehiclePosition, _ ctx: Context) -> Bool {
        let ref = ctx.feedTs != 0 ? ctx.feedTs : ctx.now
        if bus.timestamp != 0 && ref != 0 && ref - bus.timestamp > staleS { return false }   // 1. ghost
        if !ctx.staticLoaded { return true }
        guard let rid = bus.trip.routeId, ctx.routes[rid] != nil else { return false }          // 2. unknown route
        let when = ctx.now != 0 ? ctx.now : ref
        if Schedule.isScheduledNow(ctx.service, rid, when) != false { return true }              // 3. in service
        return hasLivePrediction(bus, ctx.trips, when)                                           //    late last trip
    }

    /// The operating subset (input order kept).
    public static func operatingBuses(_ buses: [VehiclePosition], _ ctx: Context) -> [VehiclePosition] {
        buses.filter { isOperating($0, ctx) }
    }

    // MARK: Silent service (rider safety, 2026-10-10; web/js/core/operating.js)
    // The feed can be fresh yet list no vehicle while the schedule has routes in service (night routes after
    // midnight). Either those buses run without sending GPS, or service ended early; we cannot tell which,
    // so the app never says "no shuttles running" / "not running" then.

    /// Routes the schedule has in service at `now`, in `routeIds` order. A route without schedule data does
    /// not count. `hidden` routes are dropped; `among` (e.g. a stop's routes) keeps only those.
    public static func scheduledRoutes(_ routeIds: [String], service: ServiceData, now: Double,
                                       hidden: Set<String> = [], among: Set<String>? = nil) -> [String] {
        routeIds.filter { rid in
            !hidden.contains(rid) && (among?.contains(rid) ?? true) && Schedule.isScheduledNow(service, rid, now) == true
        }
    }

    /// Silent service: the feed answered (not an outage, `level != .err`), no bus is operating, yet at least
    /// one route (visible or not) is scheduled now.
    public static func silentService(loaded: Bool, buses: [VehiclePosition], level: StaleLevel, routeIds: [String],
                                     service: ServiceData, now: Double) -> Bool {
        loaded && buses.isEmpty && level != .err && !scheduledRoutes(routeIds, service: service, now: now).isEmpty
    }

    /// Is the route scheduled now with no operating bus? Its status is then "Scheduled, no live location",
    /// never "Not running". Callers check a feed outage first.
    public static func scheduledNoLive(_ rid: String, buses: [VehiclePosition], service: ServiceData, now: Double) -> Bool {
        !buses.contains { $0.trip.routeId == rid } && Schedule.isScheduledNow(service, rid, now) == true
    }

    /// 'Scheduled until 4:29 AM, no live location', or nil when `scheduledNoLive` is false.
    public static func noLiveStatus(_ rid: String, buses: [VehiclePosition], service: ServiceData, now: Double) -> String? {
        guard scheduledNoLive(rid, buses: buses, service: service, now: now) else { return nil }
        let until = Schedule.scheduledUntil(service, rid, now).map { " until " + Schedule.clock12($0) } ?? ""
        return "Scheduled" + until + ", no live location"
    }

    static let maxNamed = 3

    static func andList(_ xs: [String]) -> String {
        guard xs.count > 1, let last = xs.last else { return xs.joined() }
        return xs.dropLast().joined(separator: ", ") + " and " + last
    }

    /// Plain-text explanation for silent service: which of `rids` the schedule has in service and until when
    /// (Chicago time), that no bus is sending its location, and the official phone. More than 3 routes are
    /// counted, not named; [] means only hidden routes are scheduled. Same text as web silentText.
    public static func silentText(_ rids: [String], routes: [String: Route], service: ServiceData, now: Double,
                                  phone: String? = nil) -> String {
        let one = rids.count == 1
        let what: String
        if rids.isEmpty {
            what = "Some hidden routes are scheduled now"
        } else if rids.count > maxNamed {
            what = "The schedule shows \(rids.count) routes in service now"
        } else {
            var groups: [(until: String, names: [String])] = []   // same end time -> one clause, first-seen order
            for rid in rids {
                let until = Schedule.scheduledUntil(service, rid, now).map { Schedule.clock12($0) } ?? ""
                let name = routes[rid]?.displayName ?? rid
                if let i = groups.firstIndex(where: { $0.until == until }) { groups[i].names.append(name) }
                else { groups.append((until: until, names: [name])) }
            }
            var clauses: [String] = []
            for (i, g) in groups.enumerated() {
                var c = "the " + andList(g.names) + (g.names.count > 1 ? " routes" : " route")
                if i == 0 { c += " in service" }
                if !g.until.isEmpty { c += " until " + g.until }
                clauses.append(c)
            }
            what = "The schedule shows " + andList(clauses)
        }
        let pronoun = one ? "it's" : "they're"
        var text = what + ", but no bus is sending its location, so we can't confirm " + pronoun + " running."
        if let phone { text += " Call " + phone + " before you rely on " + (one ? "it" : "them") + "." }
        return text
    }
}
