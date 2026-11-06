import Foundation

/// Buses that have left their route while Passio still predicts them (owner 2026-11-06: "avoid recommending routes on
/// buses that are about to leave their routes"; RouteKnower E29, data/labeled/transitions/). Port of
/// web/js/core/transition.js, same rule and numbers; golden cases from the web (Fixtures/transition_golden.json).
///
/// GONE: the bus's latest report (any route; a ghost in the feed counts with its own report time) is at least `goneS`
/// older than the feed, while the feed itself is alive (one of its vehicles reported within `freshS` of the feed time),
/// and the bus was reporting normally before it fell silent (its last two reports at most `sparseS` apart: a bus that
/// reports only every few minutes keeps driving unseen between reports). `LiveState.applying` drops the trip updates of
/// gone buses (like `OffRoute.dropHidden`), so arrivals, the planner, trip options, the next bus, bus alerts and the trip
/// view never offer a time from a bus that left its route; the map is unchanged (a gone bus is not on it: `Operating`
/// drops a report older than 5 min). Measured on 26 service days: of the predictions Passio showed for such buses, about
/// 99% were never served. Nothing guesses which bus is ABOUT to leave: no live signal reached even a third of flagged
/// visits out of sample (E29, E25).
///
/// Rider safety: no fresh vehicle at all (outage, the empty overnight feed) drops nothing; trip updates without a vehicle
/// id are kept; a vehicle not seen since launch gets its clock at the first poll that lists its prediction (a late
/// drop, never an early one); a bus is back the moment it reports again.
public enum Transition {
    /// A bus whose latest report is this much older than the feed has gone (s).
    public static let goneS = 15.0 * 60
    /// The feed is alive while one of its vehicles reported within this of the feed time (s; `Operating.staleS`).
    public static let freshS = 300.0
    /// A bus whose last two reports came further apart than this reports too rarely to call it gone (s).
    public static let sparseS = 120.0
    /// A vehicle that has not reported for this long and is not predicted now is forgotten (s).
    public static let keepS = 6.0 * 3600

    /// Per vehicle: `t` = its latest report time (or, with `fromPrediction`, when its prediction was first seen before
    /// any report), `dt` = the time between its last two reports (0 = not known yet). Web: `{t, dt, p}`.
    public struct Seen: Sendable, Equatable {
        public var t: Double
        public var dt: Double
        public var fromPrediction: Bool
        public init(t: Double, dt: Double = 0, fromPrediction: Bool = false) {
            self.t = t; self.dt = dt; self.fromPrediction = fromPrediction
        }
    }

    /// One vehicle poll (web goneStep): carry each vehicle's latest report time forward and say which buses have gone.
    /// `vehicles` = the feed's list as parsed (before `Operating`, ghosts included); `seen` is kept by the caller between
    /// polls; `gone` = vehicle ids whose trip updates to drop, in trip-update order.
    public static func step(_ prev: [String: Seen], vehicles: [VehiclePosition], trips: [TripUpdate], now: Double,
                            feedTs: Double) -> (seen: [String: Seen], gone: [String]) {
        let ref = feedTs != 0 ? feedTs : now
        var predicted = Set<String>()
        for tu in trips { if let id = tu.vehicle.id, !id.isEmpty { predicted.insert(id) } }
        var seen: [String: Seen] = [:]
        for (id, e) in prev where e.t.isFinite && (ref - e.t <= keepS || predicted.contains(id)) { seen[id] = e }
        var alive = false
        for b in vehicles {
            guard let id = b.vehicle.id, !id.isEmpty, b.timestamp != 0, b.timestamp.isFinite else { continue }
            let ts = b.timestamp
            if let e = seen[id], !e.fromPrediction {
                if ts > e.t { seen[id] = Seen(t: ts, dt: ts - e.t) }
            } else {
                seen[id] = Seen(t: ts)
            }
            if ref - ts <= freshS { alive = true }
        }
        var gone: [String] = []
        guard ref != 0 else { return (seen, gone) }
        for tu in trips {
            guard let id = tu.vehicle.id, !id.isEmpty else { continue }
            guard let e = seen[id] else { seen[id] = Seen(t: ref, fromPrediction: true); continue }   // its clock starts now
            if alive && ref - e.t >= goneS && !(e.dt > sparseS) && !gone.contains(id) { gone.append(id) }
        }
        return (seen, gone)
    }
}
