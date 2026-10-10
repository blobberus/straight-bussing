import Foundation

/// A leg endpoint: a stop (`id` set) or a free point ('Start' / 'Destination').
public struct Place: Codable, Hashable, Sendable {
    public var id: String?
    public var name: String
    public var lat: Double
    public var lon: Double
    public init(id: String? = nil, name: String, lat: Double, lon: Double) {
        self.id = id; self.name = name; self.lat = lat; self.lon = lon
    }
    public var coord: LatLon { LatLon(lat: lat, lon: lon) }
}

/// Walk leg (docs/ARCHITECTURE.md WalkLeg).
public struct WalkLeg: Codable, Hashable, Sendable {
    public var from: Place
    public var to: Place
    /// Whole meters.
    public var m: Double
    /// Float minutes.
    public var min: Double
    public var coords: [LatLon]?
    public var source: WalkResult.Source
    public init(from: Place, to: Place, m: Double, min: Double, coords: [LatLon]? = nil, source: WalkResult.Source = .estimate) {
        self.from = from; self.to = to; self.m = m; self.min = min; self.coords = coords; self.source = source
    }
}

/// Where a ride time came from.
public enum RideSource: String, Codable, Sendable { case live, learned, schedule, estimate }

/// Bus leg (docs/ARCHITECTURE.md BusLeg). `stopIds` (board ... alight in travel order) is native-only: the
/// web derives it from `path`.
public struct BusLeg: Codable, Hashable, Sendable {
    public var rid: String
    public var board: Place
    public var alight: Place
    public var stopIds: [String]
    public var path: [LatLon]
    public var stopsPassed: Int
    /// Minutes.
    public var wait: Double
    public var waitLive: Bool
    /// Minutes.
    public var ride: Double
    public var source: RideSource
    public var conf: Double
    public var boardT: Double
    public var alightT: Double
    /// Live trip id when the wait comes from a trip update.
    public var tripId: String?
    /// Vehicle whose prediction the wait came from (Passio reuses trip ids across buses, so the trip id alone
    /// does not say which bus to follow).
    public var vehicleId: String? = nil
    public var p10: Double?
    public var p90: Double?
}

/// A trip leg.
public enum Leg: Codable, Hashable, Sendable {
    case walk(WalkLeg)
    case bus(BusLeg)

    public var walk: WalkLeg? { if case .walk(let w) = self { return w }; return nil }
    public var bus: BusLeg? { if case .bus(let b) = self { return b }; return nil }
    public var isWalk: Bool { walk != nil }
}

/// What an option is best at (core/rank.js CRITERIA ids).
public enum Criterion: String, Codable, CaseIterable, Sendable {
    case walk, arrive, wait

    public var label: String {
        switch self {
        case .walk: return "Least walking"
        case .arrive: return "Earliest arrival"
        case .wait: return "Shortest wait"
        }
    }
    /// Minutes within the best that still count as best.
    public var tol: Double {
        switch self {
        case .walk: return 0.5
        case .arrive, .wait: return 1
        }
    }
}

/// A planned trip option (docs/ARCHITECTURE.md Option). Every number is an estimate.
public struct TripOption: Codable, Hashable, Sendable, Identifiable {
    public var key: String
    /// Float minutes including every walk.
    public var total: Double
    public var totalMin: Int
    public var arrive: Double
    public var t0: Double
    public var walkMin: Double
    public var walkM: Int
    public var meets: [Criterion]
    public var legs: [Leg]
    public var refined: Bool = false
    public var replanned: Bool = false

    public var id: String { key }
    public var busLegs: [BusLeg] { legs.compactMap(\.bus) }
    public var walkLegs: [WalkLeg] { legs.compactMap(\.walk) }
}

/// Result of `Planner.plan`.
public struct PlanResult: Hashable, Sendable {
    public var now: Double
    public var options: [TripOption]
    /// Walking the whole way (straight line x 1.2; the sidewalk route once `Planner.refinePlan` ran).
    public var walkOnlyM: Int
    public var walkOnlyMin: Double
    /// Sidewalk path for walking the whole way (router), nil for the straight estimate.
    public var walkOnlyCoords: [LatLon]? = nil
    public var walkOnlySource: WalkResult.Source = .estimate
    /// `Planner.refinePlan` ran (walk legs went through the router).
    public var refined = false
    /// Every option was dropped by the refinement: the buses leave before you could reach the stop.
    public var missedAll = false
}

/// Raw candidate before ranking (planner -> pickOptions).
public struct PlanCandidate: Hashable, Sendable {
    public var key: String
    public var legs: [Leg]
    public var arr: Double
    public var xfer: Bool
    public init(key: String, legs: [Leg], arr: Double, xfer: Bool) { self.key = key; self.legs = legs; self.arr = arr; self.xfer = xfer }
}

/// Inputs the planner reads (the store slices of core/planner.js `data`).
public struct PlannerData: Sendable {
    public var stops: [String: Stop]
    public var routeStops: [String: [String]]
    /// Route ids of `routeStops` in data order.
    public var routeOrder: [String]
    public var trips: [TripUpdate]
    public var buses: [VehiclePosition]
    public init(stops: [String: Stop], routeStops: [String: [String]], routeOrder: [String]? = nil,
                trips: [TripUpdate] = [], buses: [VehiclePosition] = []) {
        self.stops = stops; self.routeStops = routeStops
        self.routeOrder = routeOrder ?? JS.keyOrder(routeStops.keys)
        self.trips = trips; self.buses = buses
    }
}
