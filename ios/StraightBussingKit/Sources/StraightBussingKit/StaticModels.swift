import Foundation

/// A shuttle route (web/data/routes.json entry).
public struct Route: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var short: String
    public var long: String
    /// '#RRGGBB' (may be empty in the data).
    public var color: String
    public var textColor: String

    public init(id: String, short: String = "", long: String = "", color: String = "", textColor: String = "") {
        self.id = id; self.short = short; self.long = long; self.color = color; self.textColor = textColor
    }

    /// Long name, else short name, else the id.
    public var displayName: String { !long.isEmpty ? long : !short.isEmpty ? short : id }
    /// Text for a route chip: short name, else the initial of the long name.
    public var chipText: String { !short.isEmpty ? short : String(long.prefix(1)).uppercased() }
}

/// A stop (web/data/stops.json entry).
public struct Stop: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var lat: Double
    public var lon: Double
    public init(id: String, name: String, lat: Double, lon: Double) {
        self.id = id; self.name = name; self.lat = lat; self.lon = lon
    }
    public var coord: LatLon { LatLon(lat: lat, lon: lon) }
}

/// Street address of a stop (web/data/stop_addresses.json entry).
public struct StopAddress: Codable, Hashable, Sendable {
    public var address: String
    public var street: String?
    public var neighborhood: String?
}

/// One day of scheduled service (service.json `days.<key>` or an exception's `hours`).
public struct ServiceDay: Codable, Hashable, Sendable {
    public var first: String?
    public var last: String?
    public var trips: Int?
    /// Scheduled vehicles in service per local hour (24 entries).
    public var buses: [Int]?
    /// Service windows [['HH:MM','HH:MM']]; times may be >= 24:00 (after midnight).
    public var spans: [[String]]?
    public init(first: String? = nil, last: String? = nil, trips: Int? = nil, buses: [Int]? = nil, spans: [[String]]? = nil) {
        self.first = first; self.last = last; self.trips = trips; self.buses = buses; self.spans = spans
    }
}

/// A calendar change (calendar_dates) in the feed window.
public struct ServiceException: Codable, Hashable, Sendable {
    public var date: String
    public var type: String
    public var days: String?
    public var hours: ServiceDay?
    public init(date: String, type: String, days: String? = nil, hours: ServiceDay? = nil) {
        self.date = date; self.type = type; self.days = days; self.hours = hours
    }
}

/// Schedule summary of one route.
public struct RouteService: Codable, Hashable, Sendable {
    /// Day key ('mon'...'sun') -> hours; a missing key means no service that day.
    public var days: [String: ServiceDay]
    public var exceptions: [ServiceException]

    public init(days: [String: ServiceDay], exceptions: [ServiceException] = []) {
        self.days = days; self.exceptions = exceptions
    }

    private struct LossyDay: Decodable {
        let day: ServiceDay?
        init(from decoder: Decoder) throws { day = try? ServiceDay(from: decoder) }
    }
    private struct LossyException: Decodable {
        let value: ServiceException?
        init(from decoder: Decoder) throws { value = try? ServiceException(from: decoder) }
    }
    enum CodingKeys: String, CodingKey { case days, exceptions }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let raw = try c.decode([String: LossyDay].self, forKey: .days)
        var days: [String: ServiceDay] = [:]
        for (k, v) in raw { if let d = v.day { days[k] = d } }
        self.days = days
        self.exceptions = ((try? c.decode([LossyException].self, forKey: .exceptions)) ?? []).compactMap(\.value)
    }
}

/// web/data/service.json.
public struct ServiceData: Codable, Hashable, Sendable {
    public struct FeedWindow: Codable, Hashable, Sendable {
        public var start: String
        public var end: String
    }
    public var generated: String?
    public var feed: FeedWindow?
    public var routes: [String: RouteService]

    public init(generated: String? = nil, feed: FeedWindow? = nil, routes: [String: RouteService] = [:]) {
        self.generated = generated; self.feed = feed; self.routes = routes
    }

    private struct LossyRoute: Decodable {
        let value: RouteService?
        init(from decoder: Decoder) throws { value = try? RouteService(from: decoder) }
    }
    enum CodingKeys: String, CodingKey { case generated, feed, routes }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        generated = try? c.decode(String.self, forKey: .generated)
        feed = try? c.decode(FeedWindow.self, forKey: .feed)
        let raw = (try? c.decode([String: LossyRoute].self, forKey: .routes)) ?? [:]
        var routes: [String: RouteService] = [:]
        for (k, v) in raw { if let r = v.value { routes[k] = r } }
        self.routes = routes
    }
}

/// web/data/segments.json: scheduled seconds per consecutive stop pair.
public struct SegmentsData: Codable, Hashable, Sendable {
    public struct RouteSegments: Codable, Hashable, Sendable {
        public var seg: [Double?]
        public var dwell: Double?
        public var hw: Double?
        public init(seg: [Double?], dwell: Double? = nil, hw: Double? = nil) { self.seg = seg; self.dwell = dwell; self.hw = hw }
        enum CodingKeys: String, CodingKey { case seg, dwell, hw }
        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            var list: [Double?] = []
            if var u = try? c.nestedUnkeyedContainer(forKey: .seg) {
                while !u.isAtEnd {
                    if (try? u.decodeNil()) == true { list.append(nil); continue }
                    if let d = try? u.decode(Double.self) { list.append(d) } else { _ = try? u.decode(Skip.self); list.append(nil) }
                }
            }
            seg = list
            dwell = try? c.decode(Double.self, forKey: .dwell)
            hw = try? c.decode(Double.self, forKey: .hw)
        }
    }
    public var routes: [String: RouteSegments]
    public init(routes: [String: RouteSegments]) { self.routes = routes }
}

/// Decodes (and discards) any JSON value: advances an unkeyed container past a bad element.
struct Skip: Decodable { init(from decoder: Decoder) throws {} }

/// All static GTFS-derived data the app needs (what data/static.js puts in the store).
public struct StaticData: Sendable {
    public var routes: [String: Route]
    /// Route ids in the web's data order (`Object.keys(routes)`).
    public var routeIds: [String]
    public var stops: [String: Stop]
    /// Route id -> polylines.
    public var shapes: [String: [[LatLon]]]
    /// Route id -> stop ids (first == last means a loop).
    public var routeStops: [String: [String]]
    /// Route ids of `routeStops` in data order.
    public var routeStopIds: [String]
    public var stopRoutes: [String: [String]]
    public var addresses: [String: StopAddress]
    public var service: ServiceData
    public var segments: SegmentsData?
    public var generated: String?

    public init(routes: [String: Route] = [:], routeIds: [String]? = nil, stops: [String: Stop] = [:],
                shapes: [String: [[LatLon]]] = [:], routeStops: [String: [String]] = [:], routeStopIds: [String]? = nil,
                addresses: [String: StopAddress] = [:], service: ServiceData = ServiceData(),
                segments: SegmentsData? = nil, generated: String? = nil) {
        self.routes = routes
        self.routeIds = routeIds ?? JS.keyOrder(routes.keys)
        self.stops = stops
        self.shapes = shapes
        self.routeStops = routeStops
        self.routeStopIds = routeStopIds ?? JS.keyOrder(routeStops.keys)
        self.stopRoutes = StaticData.deriveStopRoutes(routeStops, order: self.routeStopIds)
        self.addresses = addresses
        self.service = service
        self.segments = segments
        self.generated = generated
    }

    public var isEmpty: Bool { routes.isEmpty || stops.isEmpty }

    /// stopId -> [routeId] (each route once per stop), routes in data order (data/static.js deriveStopRoutes).
    public static func deriveStopRoutes(_ routeStops: [String: [String]], order: [String]) -> [String: [String]] {
        var out: [String: [String]] = [:]
        for rid in order {
            var seen = Set<String>()
            for id in routeStops[rid] ?? [] where seen.insert(id).inserted { out[id, default: []].append(rid) }
        }
        return out
    }

    /// Ordered route list (data order) for display.
    public var orderedRoutes: [Route] { routeIds.compactMap { routes[$0] } }
}
