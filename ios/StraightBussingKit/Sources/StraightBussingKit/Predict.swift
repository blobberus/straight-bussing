import Foundation

/// A ride-time estimate (minutes are floats; every number is an ESTIMATE).
public struct RideEstimate: Hashable, Sendable {
    public enum Source: String, Codable, Sendable { case schedule, learned }
    public var min: Double?
    public var source: Source
    public var conf: Double
    public var p10: Double?
    public var p90: Double?
    public init(min: Double?, source: Source, conf: Double, p10: Double? = nil, p90: Double? = nil) {
        self.min = min; self.source = source; self.conf = conf; self.p10 = p10; self.p90 = p90
    }
}

/// Anything the planner can ask for ride minutes (core/predict.js `predict`). May throw: the planner
/// falls back to distance.
public protocol RidePredictor: Sendable {
    func rideMinutes(rid: String, from: String, to: String, when: Double) throws -> RideEstimate
}

/// Learned model (learned.json, written by the collector tools). Optional: the app works without it.
public struct LearnedModel: Hashable, Sendable {
    public struct Segment: Hashable, Sendable {
        /// [median s, n, p10 s?, p90 s?, sigma?]
        public var a: [Double]?
        /// hour-of-week bucket -> [median s, n]
        public var h: [Int: [Double]]
        public init(a: [Double]?, h: [Int: [Double]] = [:]) { self.a = a; self.h = h }
    }
    public struct RouteModel: Hashable, Sendable {
        public var s: [Int: Segment]
        public var dw: Double?
        public init(s: [Int: Segment], dw: Double? = nil) { self.s = s; self.dw = dw }
    }
    public var v: Int
    public var k: Double?
    public var sigma: Double?
    public var routes: [String: RouteModel]
    public init(v: Int = 1, k: Double? = nil, sigma: Double? = nil, routes: [String: RouteModel]) {
        self.v = v; self.k = k; self.sigma = sigma; self.routes = routes
    }
}

/// Ride-time estimates from scheduled seconds per segment (segments.json), refined by learned medians when
/// a learned model is given (web/js/core/predict.js createPredict). Never throws.
public struct SchedulePredictor: RidePredictor {
    static let kDefault = 5.0
    static let z80 = 1.2816
    static let defaultSigma = 0.3

    public var segments: SegmentsData?
    public var routeStops: [String: [String]]
    public var learned: LearnedModel?

    public init(segments: SegmentsData?, routeStops: [String: [String]], learned: LearnedModel? = nil) {
        self.segments = segments; self.routeStops = routeStops; self.learned = learned
    }

    /// Hour-of-week bucket in America/Chicago, Monday 00:00 = 0 (0...167). Accepts seconds or ms.
    public static func howBucket(_ ts: Double) -> Int {
        let s = ts < 1e12 ? ts : ts / 1000
        let p = Schedule.localParts(s)
        return p.dow * 24 + p.min / 60
    }

    /// Segment indices along route order from -> to (shortest forward path, loops wrap), or nil.
    static func segPath(_ order: [String], _ from: String, _ to: String) -> [Int]? {
        let n = order.count
        if n < 2 || from == to { return nil }
        let loop = n > 2 && order[0] == order[n - 1]
        let nSeg = n - 1
        var best: [Int]? = nil
        for i in 0..<nSeg where order[i] == from {
            var steps = -1
            for s in 1...nSeg {
                let k = i + s
                if !loop && k > nSeg { break }
                if order[loop ? k % nSeg : k] == to { steps = s; break }
            }
            if steps > 0 && (best == nil || steps < best!.count) {
                best = (0..<steps).map { (i + $0) % nSeg }
            }
        }
        return best
    }

    struct SegResult { var sec: Double, w: Double, learned: Bool, lo: Double, hi: Double }

    func segment(_ rid: String, _ idx: Int, _ how: Int) -> SegResult? {
        let gSigma = (learned?.sigma ?? 0) > 0 ? learned!.sigma! : Self.defaultSigma
        let k = (learned?.k ?? 0) > 0 ? learned!.k! : Self.kDefault
        var sched: Double? = nil
        if let segs = segments?.routes[rid]?.seg, idx < segs.count, let v = segs[idx], v.isFinite, v >= 0 { sched = v }
        if let L = learned, let ent = L.routes[rid]?.s[idx] {
            let a = ent.a
            let hb = ent.h[how]
            let usedBucket = hb != nil && hb!.count > 1 && hb![1] > 0
            let e: [Double]? = usedBucket ? hb : a
            if let e, e.count > 1, e[0] > 0, e[1] > 0 {
                let useA = a != nil && a!.count > 1 && a![1] > 0 && usedBucket && L.v >= 2
                let n = useA ? a![1] : e[1]
                let w = n / (n + k)
                let sec = sched == nil ? e[0] : w * e[0] + (1 - w) * sched!
                var lo: Double, hi: Double
                if let a, a.count > 3, a[2] > 0, a[3] > 0, a[0] > 0 {
                    let r = sec / a[0]
                    lo = a[2] * r; hi = a[3] * r
                } else {
                    let sg = (a != nil && a!.count > 4 && a![4] > 0) ? a![4] : gSigma
                    lo = sec * exp(-Self.z80 * sg); hi = sec * exp(Self.z80 * sg)
                }
                return SegResult(sec: sec, w: w, learned: true, lo: min(lo, sec), hi: max(hi, sec))
            }
        }
        guard let s = sched else { return nil }
        return SegResult(sec: s, w: 0, learned: false, lo: s * exp(-Self.z80 * gSigma), hi: s * exp(Self.z80 * gSigma))
    }

    static func round2(_ x: Double) -> Double { JS.round(x * 100) / 100 }

    /// Estimated riding minutes between two stops of a route (min nil when unknown).
    public func rideMinutes(rid: String, from: String, to: String, when: Double) -> RideEstimate {
        let none = RideEstimate(min: nil, source: .schedule, conf: 0)
        guard let order = routeStops[rid], let seg = segments?.routes[rid],
              let idxs = Self.segPath(order, from, to) else { return none }
        let how = Self.howBucket(when)
        let schedDwell = seg.dwell ?? 0
        let lDwell: Double? = { if let d = learned?.routes[rid]?.dw, d >= 0 { return d } else { return nil } }()
        var total = 0.0, wsum = 0.0, anyL = false, dn = 0.0, up = 0.0, dn2 = 0.0, up2 = 0.0
        for (t, idx) in idxs.enumerated() {
            guard let r = segment(rid, idx, how) else { return none }
            total += r.sec; wsum += r.w; anyL = anyL || r.learned
            let d = r.sec - r.lo, u = r.hi - r.sec
            dn += d; up += u; dn2 += d * d; up2 += u * u
            if t < idxs.count - 1 { total += r.learned && lDwell != nil ? lDwell! : schedDwell }
        }
        guard total >= 0, total.isFinite else { return none }
        let conf = anyL ? 0.45 + 0.5 * (wsum / Double(idxs.count)) : 0.4
        var out = RideEstimate(min: Self.round2(max(0.5, total / 60)), source: anyL ? .learned : .schedule, conf: Self.round2(conf))
        if learned != nil {
            let down = (dn2.squareRoot() + dn) / 2, upS = (up2.squareRoot() + up) / 2
            var p10 = Self.round2(max(0.25, (total - down) / 60))
            let p90 = Self.round2(max(out.min!, (total + upS) / 60))
            if p10 > out.min! { p10 = out.min! }
            out.p10 = p10; out.p90 = p90
        }
        return out
    }
}
