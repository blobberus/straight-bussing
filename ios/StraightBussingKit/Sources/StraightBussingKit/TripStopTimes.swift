import Foundation

/// Minutes to every stop of a bus leg (web core/tripprogress.js stopTimes; the Current trip timeline shows them right
/// of each station name, owner 2026-10-20).
extension TripFollow {
    /// Where a stop's minutes come from: Passio's live time, the scheduled ride time between stops, or the trip plan.
    public enum TimeSource: String, Sendable { case live, schedule, plan }

    /// Minutes to one stop: Passio's live time, or an estimate (`est`).
    public struct StopTime: Hashable, Sendable {
        public var t: Double
        public var est: Bool
        public var src: TimeSource
        public init(t: Double, est: Bool, src: TimeSource) { self.t = t; self.est = est; self.src = src }
    }

    /// Passio's live time where it has one; else an ESTIMATE (est) from the times around the stop and the scheduled
    /// ride time between stops, `ride(fromId, toId)` -> minutes or nil (SchedulePredictor.rideMinutes on
    /// segments.json; nil = no schedule data, never 0 min); without it the trip plan's average per stop. In order: a
    /// stop between two live times is scaled between them; after the last live time it adds the ride from there;
    /// before the first, it counts back from it; with no live time at all, from where the bus is now; with no live
    /// bus, from the plan's boarding time. Never earlier than now or than the stop before it. Passed stops: nil.
    public static func stopTimes(_ leg: BusStep, now: Double, ride: ((String, String) -> Double?)? = nil) -> [StopTime?] {
        let S = leg.stops
        var out = [StopTime?](repeating: nil, count: S.count)
        if S.isEmpty { return out }
        let span = max(1, leg.alightIdx - leg.boardIdx)
        let perStop: Double? = { if let r = leg.rideMin, r > 0, r.isFinite { return r / Double(span) }; return nil }()
        var src = TimeSource.plan
        func mins(_ a: Int, _ b: Int) -> Double? {
            if a == b { return 0 }
            if a > b { return nil }
            if let ride, let r = ride(S[a].id, S[b].id), r.isFinite, r >= 0 { src = .schedule; return r }
            return perStop.map { $0 * Double(b - a) }
        }
        let live: [Double?] = S.map { s in
            guard s.state != .passed, let e = s.eta, e != 0, e.isFinite else { return nil }
            return e
        }
        let v = leg.vehicle
        var floor = now
        for k in S.indices {
            if S[k].state == .passed { continue }
            if let lk = live[k] {
                out[k] = StopTime(t: max(lk, now), est: false, src: .live)
                floor = max(floor, lk)
                continue
            }
            src = .plan
            let j = (0..<k).reversed().first { live[$0] != nil } ?? -1
            let m = (k + 1 < S.count ? Array((k + 1)..<S.count) : []).first { live[$0] != nil } ?? -1
            var t: Double? = nil
            if j >= 0 {
                if let r = mins(j, k), let lj = live[j] {
                    t = lj + r * 60
                    if m >= 0, let rm = mins(j, m), rm > 0, let lm = live[m], lm > lj { t = lj + (lm - lj) * (r / rm) }
                }
            } else if m >= 0 {
                if let r = mins(k, m), let lm = live[m] { t = lm - r * 60 }
            } else if let v, v.idx >= 0, v.idx <= k, v.idx < S.count {
                if let r = mins(v.idx, k) {
                    let lead: Double? = v.at ? 0 : v.idx > 0 ? mins(v.idx - 1, v.idx) : perStop
                    t = now + (lead.map { $0 * (1 - v.frac) * 60 } ?? 0) + r * 60
                }
            } else if v == nil, let be = leg.boardEta, !leg.boardLive, k >= leg.boardIdx {
                if let r = mins(leg.boardIdx, k) { t = be + r * 60 }
            }
            guard var tt = t, tt.isFinite else { continue }
            tt = max(tt, floor, now)
            floor = tt
            out[k] = StopTime(t: tt, est: true, src: src)
        }
        return out
    }
}
