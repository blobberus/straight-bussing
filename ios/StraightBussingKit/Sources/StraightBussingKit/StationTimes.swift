import Foundation

/// A time at every station (owner 2026-11-20: "Shouldn't each station have a predicted arrival time when viewing it?"):
/// a port of web/js/core/eta.js.
///
/// Passio's tripUpdates give most stops a FILLER time: the previous listed stop's time + 2 s (sometimes 3), so a route
/// page showed "10 min" at 14 stops of 53rd Street Express in a row (live feed Fri Nov 20 12:37 PM; 55% of the rows
/// since Oct 28, DC-031). A filler time is not a forecast: the screens that show a time skip it (Arrivals, Planner,
/// Notify, TripFollow) and estimate it instead; the checks that only ask "does this trip go on" (Operating, Idle) still
/// count it.
public enum StationTimes {
    /// A stop time 0 to `fillerS` seconds after the previous listed stop's time in one trip update is filler.
    public static let fillerS = 3.0

    /// Marks Passio's filler times (`StopTimeUpdate.filler`, web markFiller): walking the stop times in listed order, an
    /// entry whose time (arrival, else departure) is at least 0 and at most `fillerS` seconds after the previous listed
    /// entry that has a time is filler. The first entry of a run (its head) stays a live time; an entry without a time
    /// is never filler and does not break a run. Idempotent: the flags come from the times alone.
    public static func markFiller(_ tu: TripUpdate) -> TripUpdate {
        var out = tu
        var prev: Double? = nil
        for i in out.stopTimeUpdates.indices {
            let t = out.stopTimeUpdates[i].time
            guard t != 0 else { out.stopTimeUpdates[i].filler = false; continue }
            let d = prev.map { t - $0 }
            out.stopTimeUpdates[i].filler = d.map { $0 >= 0 && $0 <= fillerS } ?? false
            prev = t
        }
        return out
    }

    /// `markFiller` on every trip update.
    public static func markFiller(_ trips: [TripUpdate]) -> [TripUpdate] { trips.map(markFiller) }

    /// Plain words of the three kinds of time (web ETA_WORDS): a live time is shown as it is ("3 min"); an estimate
    /// "~5 min" + "est." (VoiceOver "in about 5 min, estimated"); a timetable time "1:15 PM" + "Scheduled" (VoiceOver
    /// "scheduled 1:15 PM, not live").
    public enum Words {
        public static let est = "est."
        public static let sched = "Scheduled"
        public static let estSay = "estimated"
        public static let schedSay = "scheduled, not live"
    }

    /// The route page's footer sentences, one per kind shown (web ETA_NOTES).
    public enum Notes {
        public static let live = "Unmarked times are live predictions. Bus positions are approximate."
        public static let est = "est. = estimated from where the bus is and the timetable's travel times."
        public static let sched = "Scheduled = the timetable, not live."
    }

    /// The three kinds of station time.
    public enum Kind: String, Sendable {
        /// A real Passio time of that bus (not filler).
        case live
        /// Estimated from where a bus of the route is now and the timetable's travel times between stops, scaled to that
        /// bus's own live times where it has them.
        case est
        /// The next timetable time at the stop (no bus of the route can give one).
        case sched
    }

    /// One of a bus's next stops (web busTimes rows).
    public struct BusTime: Hashable, Sendable {
        public var stopId: String
        /// Index in the route's stop order (`Notify.routeOrder`: a loop's repeated last stop dropped).
        public var idx: Int
        public var t: Double
        public var kind: Kind
        public init(stopId: String, idx: Int, t: Double, kind: Kind) { self.stopId = stopId; self.idx = idx; self.t = t; self.kind = kind }
    }

    /// A time at a station (web stationTimes rows): a live arrival, or a bus's estimate there.
    public struct StationTime: Hashable, Sendable {
        public var rid: String
        public var t: Double
        public var kind: Kind
        /// Vehicle label, if any.
        public var bus: String?
        public var vehicleId: String?
        public var tripId: String?
        public init(rid: String, t: Double, kind: Kind, bus: String? = nil, vehicleId: String? = nil, tripId: String? = nil) {
            self.rid = rid; self.t = t; self.kind = kind; self.bus = bus; self.vehicleId = vehicleId; self.tripId = tripId
        }
        init(_ a: Arrival) { self.init(rid: a.rid, t: a.t, kind: .live, bus: a.bus, vehicleId: a.vehicleId, tripId: a.tripId) }
        /// The same row as an `Arrival` (bus numbers, rows that take one).
        public var arrival: Arrival { Arrival(rid: rid, t: t, bus: bus, tripId: tripId, vehicleId: vehicleId) }
    }

    /// Riding minutes between two stops of a route: (route id, from stop id, to stop id) -> minutes, nil = unknown.
    public typealias Ride = (String, String, String) -> Double?

    /// The default ride (web defaultRide): the scheduled minutes on segments.json (`SchedulePredictor`, the source
    /// `TripFollow.stopTimes` uses on the Current trip timeline).
    public static func scheduleRide(_ S: StaticData, when: Double) -> Ride {
        let p = SchedulePredictor(segments: S.segments, routeStops: S.routeStops)
        return { rid, a, b in p.rideMinutes(rid: rid, from: a, to: b, when: when).min }
    }

    /// This bus's trip updates on its route: every one naming its vehicle (Passio splits a bus over its current and
    /// next trip), else the one update of its trip id when that names no vehicle (never another bus's times).
    static func busUpdates(_ trips: [TripUpdate], _ bus: VehiclePosition, _ rid: String) -> [TripUpdate] {
        let vid = bus.vehicle.id, tid = bus.trip.tripId
        func offRoute(_ t: TripUpdate) -> Bool { t.trip.routeId != nil && t.trip.routeId != rid }
        let mine = vid == nil ? [] : trips.filter { $0.vehicle.id != nil && $0.vehicle.id == vid && !offRoute($0) }
        if !mine.isEmpty { return mine }
        let byTrip = tid == nil ? [] : trips.filter { $0.trip.tripId != nil && $0.trip.tripId == tid && !offRoute($0) }
        return byTrip.count == 1 && byTrip[0].vehicle.id == nil ? byTrip : []
    }

    /// Is this bus shown without its times (`Seen`: transitioning to a new line, `Seen.transitionTimes` off)?
    static func timesOff(_ L: LiveState, _ bus: VehiclePosition) -> Bool {
        !Seen.transitionTimes && L.transitioning.contains(bus.vehicle.id ?? "")
    }

    /// This bus's next stops in travel order from the stop it is heading to, one lap (a loop wraps; its repeated last
    /// stop is dropped), each with a time (web busTimes): its own live Passio time where it has one (filler skipped;
    /// matched in travel order, so a time earlier than a stop before it is not used), else an estimate
    /// (`TripFollow.stopTimes`: scaled between where the bus is now and its live times, else the ride from the last
    /// one). Never before now or the stop before. Estimates past its last live time stop once the route is not
    /// scheduled at that time (the bus leaves service). [] for a bus off its route's stop list or shown without its
    /// times (transitioning).
    public static func busTimes(_ S: StaticData, _ L: LiveState, bus: VehiclePosition, now: Double, ride: Ride? = nil) -> [BusTime] {
        guard let rid = bus.trip.routeId, !timesOff(L, bus) else { return [] }
        let (order, loop) = Notify.routeOrder(S.routeStops[rid])
        let n = order.count
        guard n > 0 else { return [] }
        let list = busUpdates(L.trips, bus, rid)
        var ups: [(id: String, t: Double, seq: Int?)] = []
        for tu in list {
            for u in tu.stopTimeUpdates where !u.filler {
                guard let id = u.stopId else { continue }
                let t = u.time
                if t != 0 && t > now - 30 { ups.append((id: id, t: t, seq: u.stopSequence)) }
            }
        }
        // one trip: its stop sequence; several (current + next trip): sequences restart per trip, so time order
        if list.count == 1 && ups.allSatisfy({ $0.seq != nil }) {
            ups = ups.stableSorted { a, b in a.seq! != b.seq! ? a.seq! < b.seq! : a.t < b.t }
        } else {
            ups = ups.stableSorted { $0.t < $1.t }
        }
        var next: String? = bus.stopId.flatMap { order.contains($0) ? $0 : nil }
        if next == nil { next = ups.stableSorted { $0.t < $1.t }.first { order.contains($0.id) }?.id }
        guard let nx = next, let i0 = order.firstIndex(of: nx) else { return [] }
        let idxs = (0..<(loop ? n : n - i0)).map { loop ? (i0 + $0) % n : i0 + $0 }
        let ids = idxs.map { order[$0] }
        // live times along the stops, in order, never earlier than a stop before
        var live = [Double?](repeating: nil, count: ids.count)
        var j = 0, last = -Double.infinity
        for k in ids.indices {
            var q = j
            while q < ups.count {
                if ups[q].id == ids[k] && ups[q].t >= last { live[k] = ups[q].t; last = ups[q].t; j = q + 1; break }
                q += 1
            }
        }
        // where the bus is between the stop before and its next stop
        let pk = i0 > 0 ? i0 - 1 : loop ? n - 1 : -1
        let prevId: String? = pk >= 0 ? order[pk] : nil
        let here = bus.coord, ns = S.stops[nx], ps = prevId.flatMap { S.stops[$0] }
        var frac = 0.5, at = false
        if here.isValid, let ns, ns.coord.isValid {
            let dn = Geo.hav(here, ns.coord)
            at = dn <= TripFollow.atStopM
            if let ps, ps.coord.isValid {
                let dp = Geo.hav(ps.coord, here)
                if dp + dn > 0 { frac = min(0.9, max(0.1, dp / (dp + dn))) }
            }
        }
        var leg = TripFollow.BusStep(rid: rid, boardId: ids[0], boardName: "", alightId: ids[ids.count - 1], alightName: "",
                                     planTripId: nil, source: nil)
        leg.stops = ids.indices.map { TripFollow.StopRow(id: ids[$0], name: "", role: .ride, state: .upcoming, eta: live[$0]) }
        leg.boardIdx = 0
        leg.alightIdx = ids.count - 1
        leg.vehicle = TripFollow.Vehicle(id: bus.vehicle.id, label: bus.vehicle.label ?? bus.vehicle.id ?? "", tripId: bus.trip.tripId,
                                         how: .next, idx: 0, behind: 0, beyond: 0, frac: frac, at: at, pos: 0, nextId: nx, nextName: "",
                                         prevId: prevId, prevName: nil, lat: nil, lon: nil, seen: bus.timestamp, stale: false)
        let r = ride ?? scheduleRide(S, when: now)
        let times = TripFollow.stopTimes(leg, now: now, ride: { a, b in r(rid, a, b) })
        let lastLive = live.lastIndex { $0 != nil } ?? -1
        var out: [BusTime] = []
        for k in ids.indices {
            guard k < times.count, let x = times[k], x.t.isFinite else { continue }
            if x.est && k > lastLive && Schedule.isScheduledNow(S.service, rid, x.t) == false { break }   // the bus leaves service
            out.append(BusTime(stopId: ids[k], idx: idxs[k], t: x.t, kind: x.est ? .est : .live))
        }
        return out
    }

    /// `busTimes` of every bus in `L.buses`, in the same order: compute it once per poll / clock tick and hand it to
    /// `stationTimes(laps:)` for every stop of a page (the web memoizes busTimes per bus).
    public static func laps(_ S: StaticData, _ L: LiveState, now: Double, ride: Ride? = nil) -> [[BusTime]] {
        let r = ride ?? scheduleRide(S, when: now)
        return L.buses.map { busTimes(S, L, bus: $0, now: now, ride: r) }
    }

    /// Times at a station, sorted by time (web stationTimes): the real live rows (`Arrivals.arrivalsFor`, filler
    /// skipped) plus, for each operating bus of a route serving it, its estimate there (`busTimes`) when that bus has no
    /// live row at the stop. A bus's live row that its own travel order contradicts (earlier than busTimes puts it:
    /// Passio's time at a stop listed out of order) gives way to busTimes's time; a later live row of the same bus (its
    /// next lap) stays. A transitioning bus shown without its times gives none.
    /// - Parameters:
    ///   - routeId: only this route (`hidden` is ignored then); `hidden`: route ids to leave out
    ///   - laps: `laps(S, L, now:)` for the same state and time (computed here when nil)
    public static func stationTimes(_ S: StaticData, _ L: LiveState, stopId: String, routeId: String? = nil, hidden: Set<String> = [],
                                    now: Double, ride: Ride? = nil, laps: [[BusTime]]? = nil) -> [StationTime] {
        let live = Arrivals.arrivalsFor(trips: L.trips, stopId: stopId, routeId: routeId, hidden: Array(hidden), now: now)
        var keep = [Bool](repeating: true, count: live.count)
        var extra: [StationTime] = []
        let r = ride ?? scheduleRide(S, when: now)
        for (bi, b) in L.buses.enumerated() {
            guard let rid = b.trip.routeId else { continue }
            if let routeId { if rid != routeId { continue } } else if hidden.contains(rid) { continue }
            guard (S.routeStops[rid] ?? []).contains(stopId) else { continue }
            let vid = b.vehicle.id, tid = b.trip.tripId
            let mine = live.indices.filter { i in
                let a = live[i]
                guard a.rid == rid else { return false }
                return a.vehicleId != nil ? a.vehicleId == vid : vid == nil && a.tripId != nil && a.tripId == tid
            }
            if timesOff(L, b) { for i in mine { keep[i] = false }; continue }
            let lap = laps.flatMap { bi < $0.count ? $0[bi] : nil } ?? busTimes(S, L, bus: b, now: now, ride: r)
            guard let bt = lap.first(where: { $0.stopId == stopId }) else { continue }
            var kept = false
            for i in mine {
                if live[i].t < bt.t - 1 { keep[i] = false }   // out of its own travel order
                else if abs(live[i].t - bt.t) <= 1 { kept = true }
            }
            if !kept { extra.append(StationTime(rid: rid, t: bt.t, kind: bt.kind, bus: b.vehicle.label, vehicleId: vid, tripId: tid)) }
        }
        let rows = live.indices.filter { keep[$0] }.map { StationTime(live[$0]) } + extra
        return rows.stableSorted { a, b in
            if a.t != b.t { return a.t < b.t }
            if a.kind != b.kind { return a.kind == .live }
            return a.rid < b.rid
        }
    }

    /// The route's scheduled trips around now for `scheduledAt` (compute once per route and minute).
    public static func scheduledInstances(_ tt: TimetableData?, rid: String, now: Double) -> [Timetable.Instance] {
        guard let tt, tt.routes[rid] != nil, now.isFinite else { return [] }
        return Timetable.instancesBetween(tt, now - 60, now + Timetable.aheadS, rids: [rid])
    }

    /// The next timetable time at a stop on a route within the next `Timetable.aheadS` (4 h) (web scheduledAt); nil when
    /// the timetable is not loaded or lists none. The screens show it only while the route is scheduled now and no bus
    /// can give a time there (a closed route keeps its own wording). `instances`: `scheduledInstances` for the same
    /// route and time (computed here when nil).
    public static func scheduledAt(_ tt: TimetableData?, rid: String, stopId: String, now: Double,
                                   instances: [Timetable.Instance]? = nil) -> Double? {
        let inst = instances ?? scheduledInstances(tt, rid: rid, now: now)
        var best: Double? = nil
        for i in inst {
            if let t = Timetable.instAt(i, stopId, after: now - 1), t <= now + Timetable.aheadS, best == nil || t < best! { best = t }
        }
        return best
    }

    /// What a station time shows and says (web timeWords).
    public struct Shown: Hashable, Sendable {
        /// "3 min", "Now", "~5 min", "1:15 PM".
        public var text: String
        /// "" (live), "est.", "Scheduled".
        public var tag: String
        /// VoiceOver: "in 3 min", "now", "in about 5 min, estimated", "scheduled 1:15 PM, not live".
        public var say: String
        /// A live "Now" (the live color).
        public var now: Bool
    }

    /// live: "3 min" / "Now" (stale feed: "~3 min"), no tag; est: "~5 min" (at least 1) + "est."; sched: "1:15 PM" +
    /// "Scheduled".
    public static func words(t: Double, kind: Kind, now: Double, stale: Bool = false, locale: Locale = .current) -> Shown {
        switch kind {
        case .sched:
            let c = TimeFmt.clock(t, locale: locale)
            return Shown(text: c, tag: Words.sched, say: "\(Words.sched.lowercased()) \(c), not live", now: false)
        case .est:
            let e = max(1, TimeFmt.minsUntil(t, from: now))
            return Shown(text: "~\(e) min", tag: Words.est, say: "in about \(e) min, \(Words.estSay)", now: false)
        case .live:
            let m = TimeFmt.minsUntil(t, from: now)
            if m < 1 { return Shown(text: "Now", tag: "", say: "now", now: true) }
            return Shown(text: "\(stale ? "~" : "")\(m) min", tag: "", say: "in \(stale ? "about " : "")\(m) min", now: false)
        }
    }
}
