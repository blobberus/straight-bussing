import Foundation

/// Where YOU are on a started trip (web core/tripyou.js tripYou): the Current trip map's "You" marker, its stop labels
/// and the follow camera's frame. Pure; built from the SAME `TripFollow` value the timeline, the trip alerts and the
/// Live Activity use, so the map always says the same stop counts as the card and the notifications.
///  - on the bus (phase on-bus) you are drawn riding the followed bus, unless your accurate GPS is more than 300 m
///    (plus its accuracy) from it: then your GPS is shown and the counts still follow the bus (`far`);
///  - waiting: your GPS, else the boarding stop (assumed, source `stop`);
///  - walking to the stop / arrived: your GPS, else no marker.
public struct TripYou: Hashable, Sendable {
    public enum Source: String, Hashable, Sendable { case bus, gps, stop }
    public enum Role: String, Hashable, Sendable { case board, alight, dest }

    /// A stop of the current bus leg (lat / lon nil when the stop has no position in the schedule).
    public struct LegStop: Hashable, Sendable {
        public var id: String
        public var name: String
        public var lat: Double?
        public var lon: Double?
        public var point: LatLon? { lat.flatMap { la in lon.map { LatLon(lat: la, lon: $0) } } }
    }

    /// What the rider is heading for now: the boarding stop, the alighting stop or the destination.
    public struct Target: Hashable, Sendable {
        public var id: String?
        public var name: String
        public var lat: Double
        public var lon: Double
        public var role: Role
        public var point: LatLon { LatLon(lat: lat, lon: lon) }
    }

    /// Tunables (web YOU).
    /// Accurate GPS this far (m, plus its accuracy) from the followed bus: you are not drawn on it.
    public static let farM = 300.0
    /// GPS fixes with a worse accuracy (m) than this are not trusted over the bus position.
    public static let gpsAccM = 100.0
    /// A coming bus at most this many stops before your boarding stop is kept in the map frame.
    public static let nearBusStops = 3

    public var phase: TripFollow.Phase
    public var active: Int
    /// Where to draw you; both nil = unknown (no marker).
    public var lat: Double?
    public var lon: Double?
    public var source: Source?
    /// Drawn riding the followed bus (source `bus`).
    public var onBus: Bool
    /// On the bus with a live position, but your accurate GPS is far from it.
    public var far: Bool
    /// The followed bus of the current bus leg (nil when none).
    public var vehicleId: String?
    public var label: String?
    public var busLat: Double?
    public var busLon: Double?
    /// Copied from the current bus leg (nil when none).
    public var stopsAway: Int?
    public var stopsLeft: Int?
    public var board: LegStop?
    public var alight: LegStop?
    public var target: Target?
    /// What the map keeps in view: you (if known), the target, the coming bus (if near).
    public var frame: [LatLon]
    /// The sentence the map marker and VoiceOver use ('' when there is no marker).
    public var text: String

    public var point: LatLon? { lat.flatMap { la in lon.map { LatLon(lat: la, lon: $0) } } }

    /// A usable point (web ptOf): finite, and not 0,0 (a feed's "no position").
    public static func pt(_ p: LatLon?) -> LatLon? {
        guard let p, p.isValid, !(p.lat == 0 && p.lon == 0) else { return nil }
        return p
    }

    static func pt(_ lat: Double?, _ lon: Double?) -> LatLon? {
        guard let lat, let lon else { return nil }
        return pt(LatLon(lat: lat, lon: lon))
    }

    static func stopOf(_ S: StaticData, _ id: String, _ name: String) -> LegStop {
        let q = pt(S.stops[id]?.coord)
        return LegStop(id: id, name: name, lat: q?.lat, lon: q?.lon)
    }

    /// Where you are on trip `p` (nil when there is no trip). `user` / `accuracy` (m, nil = unknown) are the last GPS
    /// fix; `dest` is the trip's destination point (the planned option's last leg end; web journey.dest).
    public static func compute(_ p: TripFollow?, user: LatLon?, accuracy: Double?, staticData S: StaticData, dest: LatLon?) -> TripYou? {
        guard let p else { return nil }
        // the current bus leg: the active leg when it is a bus leg; once arrived the last bus leg
        var leg: TripFollow.BusStep? = p.legs.indices.contains(p.active) ? p.legs[p.active].bus : nil
        if leg == nil && p.phase == .arrived { leg = p.busLegs.last }
        let v = leg?.vehicle
        let gps = pt(user)
        let acc: Double? = accuracy.flatMap { $0.isFinite ? $0 : nil }
        let accurate = gps != nil && (acc == nil || acc! <= gpsAccM)
        let busPt = pt(v?.lat, v?.lon)
        let board = leg.map { stopOf(S, $0.boardId, $0.boardName) }
        let alight = leg.map { stopOf(S, $0.alightId, $0.alightName) }
        func tgt(_ s: LegStop?, _ role: Role) -> Target? {
            guard let s, let la = s.lat, let lo = s.lon else { return nil }
            return Target(id: s.id, name: s.name, lat: la, lon: lo, role: role)
        }
        let who = TripText.busName(v)

        var you: LatLon? = nil, source: Source? = nil, onBus = false, far = false
        var target: Target? = nil
        var text = ""
        if p.phase == .onBus, let leg {
            target = tgt(alight, .alight)
            if let busPt {
                if accurate, let g = gps, Geo.hav(g, busPt) > farM + (acc ?? 0) {
                    you = g; source = .gps; far = true
                    text = "Your location is not near \(who). Stop counts follow the bus."
                } else {
                    you = busPt; source = .bus; onBus = true
                    text = leg.stopsLeft.map { "You are on \(who). " + TripText.offText($0, leg.alightName) } ?? "You are on \(who)."
                }
            } else if let g = gps {
                you = g; source = .gps; text = "Your location. Riding to \(leg.alightName)."
            }
        } else if p.phase == .waiting, let leg {
            target = tgt(board, .board)
            if let g = gps { you = g; source = .gps; text = "Your location. Waiting at \(leg.boardName)." }
            else if let b = board, let la = b.lat, let lo = b.lon {
                you = LatLon(lat: la, lon: lo); source = .stop; text = "Waiting at \(leg.boardName)."
            }
        } else if p.phase == .walkToStop, let leg {
            target = tgt(board, .board)
            if let g = gps { you = g; source = .gps; text = "Your location. Walking to \(leg.boardName)." }
        } else {
            if let d = pt(dest) { target = Target(id: nil, name: p.to, lat: d.lat, lon: d.lon, role: .dest) }
            else { target = tgt(alight, .alight) }
            if let g = gps { you = g; source = .gps; text = "Your location. Walking to \(p.to)." }
        }

        var frame: [LatLon] = []
        if let you { frame.append(you) }
        if let t = target { frame.append(LatLon(lat: t.lat, lon: t.lon)) }
        if p.phase == .walkToStop || p.phase == .waiting, let busPt, let s = leg?.stopsAway, s <= nearBusStops { frame.append(busPt) }

        return TripYou(phase: p.phase, active: p.active, lat: you?.lat, lon: you?.lon, source: source, onBus: onBus, far: far,
                       vehicleId: v?.id, label: v.flatMap { $0.label.isEmpty ? nil : $0.label }, busLat: busPt?.lat, busLon: busPt?.lon,
                       stopsAway: leg?.stopsAway, stopsLeft: leg?.stopsLeft,
                       board: board, alight: alight, target: target, frame: frame, text: text)
    }

    // MARK: Map labels

    /// A small pill on one of the trip's stops ("Board here", "Get off in 2 stops", "Get off here").
    public struct StopLabel: Hashable, Sendable {
        public var stopId: String
        public var stopName: String
        public var point: LatLon
        public var text: String
    }

    /// The trip's stop labels (web map.js renderYou), same numbers as the card and the alerts: before boarding the
    /// boarding stop says "Board here" (drawn under the stop); until arrived the alighting stop says
    /// offShort(stopsLeft) on board, else "Get off here" (drawn above it).
    public var stopLabels: [StopLabel] {
        var out: [StopLabel] = []
        let before = phase == .walkToStop || phase == .waiting
        if before, let b = board, let pt = b.point { out.append(StopLabel(stopId: b.id, stopName: b.name, point: pt, text: "Board here")) }
        if phase != .arrived, let a = alight, let pt = a.point {
            let t = phase == .onBus ? TripText.offShort(stopsLeft) : "Get off here"
            out.append(StopLabel(stopId: a.id, stopName: a.name, point: pt, text: t))
        }
        return out
    }
}
