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
}
