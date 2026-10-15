import Foundation

/// Where Directions plans trips to (web core/coverage.js; owner 2026-10-15: "If a search query for destination
/// doesn't have a proper stop or address within range, say: Sorry, Straight Bussing only covers locations 800m within
/// [the] shuttle routes"): a destination within `meters` (straight line) of a stop that at least one route serves.
/// Only the Directions destination is checked (never the start, Current trip's place search or Routes to station);
/// the planner's 1600 m end walk stays for covered destinations. Pure.
public enum Coverage {
    /// Straight-line meters from the nearest served stop.
    public static let meters = 800.0
    /// What Directions says for a destination outside it (owner wording; no "UGo": the app uses no operator names
    /// of its own).
    public static let text = "Sorry, Straight Bussing only covers locations within 800 m of the campus shuttle routes."

    /// Straight-line meters from `p` to the nearest stop a route serves (`stopRoutes[id]` non-empty; every stop when
    /// `stopRoutes` is empty). nil when there are no stops (or `p` is not a valid point).
    public static func nearestStopMeters(_ p: LatLon, stops: [String: Stop], stopRoutes: [String: [String]]) -> Double? {
        guard p.isValid else { return nil }
        var best: Double?
        for (id, s) in stops where stopRoutes.isEmpty || !(stopRoutes[id] ?? []).isEmpty {
            let c = s.coord
            guard c.isValid else { continue }
            let d = Geo.hav(p, c)
            if best.map({ d < $0 }) ?? true { best = d }
        }
        return best
    }

    /// True when the endpoint is a stop, lies within `meters` of a served stop, or nothing can be said yet (no stop
    /// data: the schedule has not loaded, so never block on it).
    public static func covered(_ p: LatLon, stopId: String? = nil, stops: [String: Stop],
                               stopRoutes: [String: [String]]) -> Bool {
        if stopId != nil { return true }
        guard let d = nearestStopMeters(p, stops: stops, stopRoutes: stopRoutes) else { return true }
        return d <= meters
    }

    /// `covered` against the loaded schedule.
    public static func covered(_ p: LatLon, stopId: String? = nil, in S: StaticData) -> Bool {
        covered(p, stopId: stopId, stops: S.stops, stopRoutes: S.stopRoutes)
    }
}
