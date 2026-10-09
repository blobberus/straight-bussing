import Foundation

// GTFS-realtime JSON as served by Passio (snake_case keys; ids and times may be numbers or strings).
// The decoders are tolerant like data/live.js: a malformed entity is dropped, not the whole feed.

/// `{id, label}` of a vehicle.
public struct VehicleDescriptor: Hashable, Sendable {
    public var id: String?
    public var label: String?
    public init(id: String? = nil, label: String? = nil) { self.id = id; self.label = label }
}

/// `{trip_id, route_id}`.
public struct TripDescriptor: Hashable, Sendable {
    public var tripId: String?
    public var routeId: String?
    public init(tripId: String? = nil, routeId: String? = nil) { self.tripId = tripId; self.routeId = routeId }
}

/// A live vehicle (GTFS-rt VehiclePosition), the web's `store.buses` entries.
public struct VehiclePosition: Hashable, Sendable {
    public var vehicle: VehicleDescriptor
    public var latitude: Double
    public var longitude: Double
    public var bearing: Double?
    public var speed: Double?
    public var trip: TripDescriptor
    /// Unix seconds of the report (0 when missing).
    public var timestamp: Double
    /// The stop the vehicle is heading to / at.
    public var stopId: String?
    public var currentStopSequence: Int?

    public init(vehicle: VehicleDescriptor = .init(), latitude: Double, longitude: Double, bearing: Double? = nil,
                speed: Double? = nil, trip: TripDescriptor = .init(), timestamp: Double = 0, stopId: String? = nil,
                currentStopSequence: Int? = nil) {
        self.vehicle = vehicle; self.latitude = latitude; self.longitude = longitude; self.bearing = bearing
        self.speed = speed; self.trip = trip; self.timestamp = timestamp; self.stopId = stopId
        self.currentStopSequence = currentStopSequence
    }

    public var coord: LatLon { LatLon(lat: latitude, lon: longitude) }
    public var routeId: String? { trip.routeId }
    /// Label, else id, else ''.
    public var displayLabel: String { vehicle.label ?? vehicle.id ?? "" }
}

/// One stop of a trip update.
public struct StopTimeUpdate: Hashable, Sendable {
    public var stopId: String?
    public var stopSequence: Int?
    public var arrival: Double?
    public var departure: Double?
    public init(stopId: String?, stopSequence: Int? = nil, arrival: Double? = nil, departure: Double? = nil) {
        self.stopId = stopId; self.stopSequence = stopSequence; self.arrival = arrival; self.departure = departure
    }
    /// `arrival.time || departure.time || 0` (JS truthiness: a zero arrival falls back to departure).
    public var time: Double {
        if let a = arrival, a != 0, a.isFinite { return a }
        if let d = departure, d != 0, d.isFinite { return d }
        return 0
    }
}

/// A GTFS-rt TripUpdate, the web's `store.trips` entries.
public struct TripUpdate: Hashable, Sendable {
    public var trip: TripDescriptor
    public var vehicle: VehicleDescriptor
    public var stopTimeUpdates: [StopTimeUpdate]
    public init(trip: TripDescriptor, vehicle: VehicleDescriptor = .init(), stopTimeUpdates: [StopTimeUpdate]) {
        self.trip = trip; self.vehicle = vehicle; self.stopTimeUpdates = stopTimeUpdates
    }
}

/// A service alert.
public struct ServiceAlert: Hashable, Sendable, Identifiable {
    public struct Period: Hashable, Sendable {
        public var start: Double?
        public var end: Double?
        public init(start: Double? = nil, end: Double? = nil) { self.start = start; self.end = end }
    }
    public var id: String
    public var header: String
    public var description: String
    public var activePeriods: [Period]
    /// Route ids named in informed_entity.
    public var routeIds: [String]
    public init(id: String, header: String, description: String = "", activePeriods: [Period] = [], routeIds: [String] = []) {
        self.id = id; self.header = header; self.description = description; self.activePeriods = activePeriods
        self.routeIds = routeIds
    }
}

/// A parsed feed: header timestamp + entities.
public struct Feed<Entity: Sendable>: Sendable {
    public var timestamp: Double
    public var entities: [Entity]
}

// MARK: - Decoding

struct AnyKey: CodingKey {
    var stringValue: String
    var intValue: Int? { nil }
    init(_ s: String) { stringValue = s }
    init?(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { return nil }
}

extension KeyedDecodingContainer where K == AnyKey {
    /// Number or numeric string -> Double (nil when missing or not numeric).
    func num(_ key: String) -> Double? {
        let k = AnyKey(key)
        if let d = try? decode(Double.self, forKey: k) { return d.isFinite ? d : nil }
        if let s = try? decode(String.self, forKey: k) { return Double(s.trimmingCharacters(in: .whitespaces)) }
        return nil
    }
    /// String or number -> String (numbers written like JavaScript's String(n)).
    func str(_ key: String) -> String? {
        let k = AnyKey(key)
        if let s = try? decode(String.self, forKey: k) { return s }
        if let i = try? decode(Int64.self, forKey: k) { return String(i) }
        if let d = try? decode(Double.self, forKey: k) { return d == d.rounded() && abs(d) < 1e15 ? String(Int64(d)) : String(d) }
        return nil
    }
    func obj(_ key: String) -> KeyedDecodingContainer<AnyKey>? {
        try? nestedContainer(keyedBy: AnyKey.self, forKey: AnyKey(key))
    }
    func list(_ key: String) -> UnkeyedDecodingContainer? {
        try? nestedUnkeyedContainer(forKey: AnyKey(key))
    }
}

/// Decodes every element of an array it can; bad elements become nil (and are skipped).
struct LossyList<T: Decodable>: Decodable {
    var items: [T]
    init(from decoder: Decoder) throws {
        var u = try decoder.unkeyedContainer()
        var out: [T] = []
        while !u.isAtEnd {
            if let v = try? u.decode(T.self) { out.append(v) } else { _ = try? u.decode(Skip.self) }
        }
        items = out
    }
}

extension VehicleDescriptor {
    init(_ c: KeyedDecodingContainer<AnyKey>?) { self.init(id: c?.str("id"), label: c?.str("label")) }
}
extension TripDescriptor {
    init(_ c: KeyedDecodingContainer<AnyKey>?) { self.init(tripId: c?.str("trip_id"), routeId: c?.str("route_id")) }
}

/// `entity[].vehicle` with a position (others are dropped, like parseBuses).
struct VehicleEntity: Decodable {
    var value: VehiclePosition?
    init(from decoder: Decoder) throws {
        let e = try decoder.container(keyedBy: AnyKey.self)
        guard let v = e.obj("vehicle"), let p = v.obj("position"),
              let lat = p.num("latitude"), let lon = p.num("longitude") else { value = nil; return }
        value = VehiclePosition(vehicle: VehicleDescriptor(v.obj("vehicle")), latitude: lat, longitude: lon,
                                bearing: p.num("bearing"), speed: p.num("speed"), trip: TripDescriptor(v.obj("trip")),
                                timestamp: v.num("timestamp") ?? 0, stopId: v.str("stop_id"),
                                currentStopSequence: v.num("current_stop_sequence").map { Int($0) })
    }
}

struct StopTimeEntity: Decodable {
    var value: StopTimeUpdate
    init(from decoder: Decoder) throws {
        let u = try decoder.container(keyedBy: AnyKey.self)
        value = StopTimeUpdate(stopId: u.str("stop_id"), stopSequence: u.num("stop_sequence").map { Int($0) },
                               arrival: u.obj("arrival")?.num("time"), departure: u.obj("departure")?.num("time"))
    }
}

/// `entity[].trip_update` (parseTrips).
struct TripEntity: Decodable {
    var value: TripUpdate?
    init(from decoder: Decoder) throws {
        let e = try decoder.container(keyedBy: AnyKey.self)
        guard let t = e.obj("trip_update") else { value = nil; return }
        let ups = (try? t.decode(LossyList<StopTimeEntity>.self, forKey: AnyKey("stop_time_update")))?.items.map(\.value) ?? []
        value = TripUpdate(trip: TripDescriptor(t.obj("trip")), vehicle: VehicleDescriptor(t.obj("vehicle")), stopTimeUpdates: ups)
    }
}

/// `entity[].alert` (parseAlerts).
struct AlertEntity: Decodable {
    var value: ServiceAlert?
    init(from decoder: Decoder) throws {
        let e = try decoder.container(keyedBy: AnyKey.self)
        guard let a = e.obj("alert") else { value = nil; return }
        var periods: [ServiceAlert.Period] = []
        if var u = a.list("active_period") {
            while !u.isAtEnd {
                if let p = try? u.nestedContainer(keyedBy: AnyKey.self) {
                    periods.append(.init(start: p.num("start"), end: p.num("end")))
                } else { _ = try? u.decode(Skip.self) }
            }
        }
        var rids: [String] = []
        if var u = a.list("informed_entity") {
            while !u.isAtEnd {
                if let p = try? u.nestedContainer(keyedBy: AnyKey.self) { if let r = p.str("route_id") { rids.append(r) } }
                else { _ = try? u.decode(Skip.self) }
            }
        }
        value = ServiceAlert(id: e.str("id") ?? UUID().uuidString, header: Self.text(a.obj("header_text"), a, "header_text"),
                             description: Self.text(a.obj("description_text"), a, "description_text"),
                             activePeriods: periods, routeIds: rids)
    }

    /// Plain text of a TranslatedString (or a plain string), English preferred (core/arrivals.js alertText).
    static func text(_ obj: KeyedDecodingContainer<AnyKey>?, _ parent: KeyedDecodingContainer<AnyKey>, _ key: String) -> String {
        if let s = try? parent.decode(String.self, forKey: AnyKey(key)) { return s.trimmingCharacters(in: .whitespacesAndNewlines) }
        guard var u = obj?.list("translation") else { return "" }
        var first: String? = nil, en: String? = nil
        while !u.isAtEnd {
            guard let t = try? u.nestedContainer(keyedBy: AnyKey.self) else { _ = try? u.decode(Skip.self); continue }
            guard let text = try? t.decode(String.self, forKey: AnyKey("text")) else { continue }
            if first == nil { first = text }
            if en == nil, let lang = t.str("language"), lang.lowercased().hasPrefix("en") { en = text }
        }
        return (en ?? first ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

struct FeedEnvelope<E: Decodable>: Decodable {
    var timestamp: Double
    var entities: [E]
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: AnyKey.self)
        timestamp = c.obj("header")?.num("timestamp") ?? 0
        entities = (try? c.decode(LossyList<E>.self, forKey: AnyKey("entity")))?.items ?? []
    }
}

/// Parsers for the three Passio feeds (data/live.js parseBuses / parseTrips / parseAlerts).
public enum FeedParser {
    public static func vehicles(_ data: Data) throws -> Feed<VehiclePosition> {
        let env = try JSONDecoder().decode(FeedEnvelope<VehicleEntity>.self, from: data)
        return Feed(timestamp: env.timestamp, entities: env.entities.compactMap(\.value))
    }
    public static func tripUpdates(_ data: Data) throws -> Feed<TripUpdate> {
        let env = try JSONDecoder().decode(FeedEnvelope<TripEntity>.self, from: data)
        return Feed(timestamp: env.timestamp, entities: env.entities.compactMap(\.value))
    }
    public static func alerts(_ data: Data) throws -> Feed<ServiceAlert> {
        let env = try JSONDecoder().decode(FeedEnvelope<AlertEntity>.self, from: data)
        return Feed(timestamp: env.timestamp, entities: env.entities.compactMap(\.value))
    }
}
