import Foundation

/// Keeps live bus badges on the line they drive (owner 2026-10-18: "the bus location should update smoothly without
/// exiting the borders of the roads and the station lines they follow", especially after a reload or when bus data
/// comes back after a gap): a faithful port of web/js/map/track.js (same rules and numbers) plus the move timing of
/// web/js/map/layers.js (`moveTiming`). Pure; the app animates what `follow` returns (App `BusMotion`). Tested with
/// the cases of web/tests/map-track.js and a golden file the JavaScript computed on real bus reports
/// (BusTrackTests, Fixtures/bustrack_golden.json).
///
/// A report within `onM` of its route's shape (the colored line on the map, drawn on the streets) is shown ON the line:
/// the GPS fix projected onto it. A move along the line is drawn through the line's own points, so the badge turns the
/// corner with the street instead of cutting across a block, after a long gap too. Which pass of the line: a street
/// driven out and back, or a loop, passes one point several times, so the pass that continues from where the badge
/// is now wins, within what a bus can drive since its last report (`speedMps`); a short step back (GPS jitter,
/// `backM`) stays on the line. A badge that is not on the line yet takes the closest pass, the one heading the way the
/// feed says when two are about as close. A report off the line (a detour, the garage) is shown where it is.
public enum BusTrack {
    /// A fix this close to the line is on it (GPS error plus the street's width).
    public static let onM = 40.0
    /// A step back along the line up to this long is GPS jitter: drawn along the line.
    public static let backM = 30.0
    /// Fastest a shuttle drives (about 50 mph), for "could it have driven that far since its last report".
    public static let speedMps = 22.0
    /// Extra distance allowed on top of `speedMps` x the time between reports.
    public static let slackM = 400.0
    /// Lines whose ends are this close are loops (a bus continues through the start).
    static let closedM = 80.0

    /// One shape line ready for tracking.
    public struct Line: Sendable {
        public let line: [LatLon]
        public let cum: [Double]
        public let length: Double
        public let closed: Bool
    }

    /// A place on the route's lines: line index, meters along it, the point.
    public struct Place: Equatable, Sendable {
        public var li: Int
        public var pos: Double
        public var pt: LatLon
        public init(li: Int, pos: Double, pt: LatLon) { self.li = li; self.pos = pos; self.pt = pt }
    }

    /// Where a badge is on its line now (line index, meters along it).
    public struct OnLine: Equatable, Sendable {
        public var li: Int
        public var pos: Double
        public init(li: Int, pos: Double) { self.li = li; self.pos = pos }
    }

    /// The result of `follow`: the new place on the line (nil: off the line, drawn at the fix), the way there (from the
    /// badge's spot, through the line's points when `along`), and the meters moved along the line (signed; 0 when not).
    public struct Move: Equatable, Sendable {
        public var to: Place?
        public var path: [LatLon]
        public var along: Bool
        public var f: Double
    }

    /// A route's shape lines ready for tracking (web `prepareShape`): repeated and invalid points dropped, lines with
    /// fewer than 2 points or no length dropped. Callers cache the result per route.
    public static func prepare(_ lines: [[LatLon]]?) -> [Line] {
        var out: [Line] = []
        for raw in lines ?? [] {
            var line: [LatLon] = []
            line.reserveCapacity(raw.count)
            for p in raw where p.isValid {
                if let q = line.last, !(abs(q.lat - p.lat) > 1e-7 || abs(q.lon - p.lon) > 1e-7) { continue }
                line.append(p)
            }
            guard line.count >= 2 else { continue }
            let cum = Geometry.cumulative(line), L = cum[cum.count - 1]
            if L > 0 { out.append(Line(line: line, cum: cum, length: L, closed: Geometry.distM(line[0], line[line.count - 1]) < closedM)) }
        }
        return out
    }

    /// Point at a distance along a line (clamped to its ends).
    public static func pointAt(_ line: [LatLon], _ cum: [Double], _ pos: Double) -> LatLon {
        let L = cum[cum.count - 1]
        if !(pos > 0) { return line[0] }
        if pos >= L { return line[line.count - 1] }
        var lo = 0, hi = cum.count - 1
        while hi - lo > 1 {
            let mid = (lo + hi) >> 1
            if cum[mid] <= pos { lo = mid } else { hi = mid }
        }
        let a = line[lo], b = line[hi], seg = cum[hi] - cum[lo], t = seg > 0 ? (pos - cum[lo]) / seg : 0
        return LatLon(lat: a.lat + t * (b.lat - a.lat), lon: a.lon + t * (b.lon - a.lon))
    }

    /// The line's points from `pos0`, `f` meters along it (f < 0: backwards), through the start on loops.
    public static func walk(_ s: Line, _ pos0: Double, _ f: Double) -> [LatLon] {
        let line = s.line, cum = s.cum, L = s.length
        var out = [pointAt(line, cum, pos0)]
        if f >= 0 {
            let end = s.closed ? pos0 + f : Swift.min(L, pos0 + f)
            var base = 0.0, from = pos0, lap = 0
            while lap < 3 && from < end {
                for i in 0..<line.count {
                    let at = base + cum[i]
                    if at > from && at < end { out.append(line[i]) }
                }
                from = base + L
                base += L
                lap += 1
            }
            out.append(pointAt(line, cum, s.closed ? jsMod(end, L) : end))
        } else {
            let end = Swift.max(0, pos0 + f)
            for i in stride(from: line.count - 1, through: 0, by: -1) where cum[i] < pos0 && cum[i] > end { out.append(line[i]) }
            out.append(pointAt(line, cum, end))
        }
        return dropRepeats(out)
    }

    /// ((x % m) + m) % m with JavaScript's remainder (sign of the dividend).
    static func jsMod(_ x: Double, _ m: Double) -> Double {
        (x.truncatingRemainder(dividingBy: m) + m).truncatingRemainder(dividingBy: m)
    }

    static func dropRepeats(_ pts: [LatLon]) -> [LatLon] {
        var out: [LatLon] = []
        out.reserveCapacity(pts.count)
        for p in pts {
            if let q = out.last, !(abs(q.lat - p.lat) > 1e-9 || abs(q.lon - p.lon) > 1e-9) { continue }
            out.append(p)
        }
        return out
    }

    /// Direction of travel (deg) of a line at a position; nil where the line has no length there.
    public static func headingAt(_ s: Line, _ pos: Double) -> Double? {
        let a = pointAt(s.line, s.cum, Swift.max(0, pos - 8)), b = pointAt(s.line, s.cum, Swift.min(s.length, pos + 8))
        return Geometry.distM(a, b) > 1 ? Geo.bearing(a, b) : nil
    }

    /// One pass of a line within `onM` of a fix.
    public struct Pass: Equatable, Sendable { public var li: Int; public var d: Double; public var pos: Double; public var pt: LatLon }

    /// Every pass of the route's lines within `onM` of a fix.
    public static func locate(_ prep: [Line], _ pt: LatLon) -> [Pass] {
        var out: [Pass] = []
        for (li, s) in prep.enumerated() {
            for c in Geometry.candidates(s.line, s.cum, pt).cands where c.d <= onM { out.append(Pass(li: li, d: c.d, pos: c.pos, pt: c.pt)) }
        }
        return out
    }

    /// Angle between two headings, 0 to 180 (web `angleOff`).
    static func angleOff(_ a: Double, _ b: Double) -> Double {
        abs(((a - b).truncatingRemainder(dividingBy: 360) + 540).truncatingRemainder(dividingBy: 360) - 180)
    }

    /// Where a new report goes and the way there (web `follow`).
    /// - Parameters:
    ///   - prep: the route's lines (`prepare`; [] = none known)
    ///   - from: where the badge is on the line now (nil: not on it)
    ///   - at: where the badge is drawn now (nil for a new badge)
    ///   - pt: the new fix
    ///   - bearing: the feed's heading (deg), nil if none
    ///   - dt: seconds since the bus's last report, nil if unknown
    public static func follow(_ prep: [Line], from: OnLine?, at: LatLon?, _ pt: LatLon, bearing: Double? = nil, dt: Double? = nil) -> Move {
        let cands = locate(prep, pt)
        let start = at ?? pt
        if cands.isEmpty { return Move(to: nil, path: dropRepeats([start, pt]), along: false, f: 0) }
        if let from, prep.indices.contains(from.li) {
            let s = prep[from.li]
            let span = dt.map { Swift.min(1800, Swift.max(10, $0)) } ?? 10
            let ahead = speedMps * span + slackM
            var best: (c: Pass, f: Double, score: Double)? = nil
            for c in cands where c.li == from.li {
                var f = c.pos - from.pos
                if s.closed && f < -backM { f += s.length }        // a loop: forward through the start
                if f < -backM || f > ahead { continue }
                let score = c.d + 0.1 * abs(f)
                if best == nil || score < best!.score { best = (c, f, score) }
            }
            if let b = best {
                return Move(to: Place(li: b.c.li, pos: b.c.pos, pt: b.c.pt), path: walk(s, from.pos, b.f), along: true, f: b.f)
            }
        }
        var pick: (c: Pass, score: Double)? = nil
        for c in cands {
            var score = c.d
            if let brg = bearing, brg.isFinite, let h = headingAt(prep[c.li], c.pos), angleOff(h, brg) > 90 {
                score += 25                                       // that pass runs the other way
            }
            if pick == nil || score < pick!.score { pick = (c, score) }
        }
        let c = pick!.c
        return Move(to: Place(li: c.li, pos: c.pos, pt: c.pt), path: dropRepeats([start, c.pt]), along: false, f: 0)
    }

    /// Position along a line after moving f meters from pos (wrapping on loops, clamped on open lines).
    public static func advance(_ s: Line, _ pos: Double, _ f: Double) -> Double {
        let p = pos + f
        return s.closed ? jsMod(p, s.length) : Swift.max(0, Swift.min(s.length, p))
    }

    // MARK: move timing (web/js/map/layers.js moveTiming)

    /// A normal poll's glide (s): about one poll interval, at constant speed, so the badge keeps moving.
    public static let glideS = 9.0
    /// A move along the line longer than this (m), or after a gap of more than `glideGapS`, catches up quickly.
    static let normalM = 350.0, glideGapS = 30.0
    /// Off the line, a move longer than this (m) is drawn as a jump: a straight glide would cross the blocks.
    static let straightM = 150.0

    /// How long a move takes (s; 0 = drawn there at once) and whether it eases (a catch-up) or runs at constant speed.
    public struct Timing: Equatable, Sendable {
        public var dur: Double
        public var ease: Bool
        public init(dur: Double, ease: Bool) { self.dur = dur; self.ease = ease }
    }

    /// web `moveTiming(r, len, dt, reduce)`: a normal poll glides at constant speed over `glideS`; a catch-up (over
    /// 350 m along the line, or after more than 30 s without a report) eases in 0.9 to 2.6 s (700 ms + 0.8 ms per m);
    /// off the line a straight glide up to 150 m, longer = a jump; reduced motion = at once.
    public static func timing(along: Bool, length: Double, dt: Double?, reduce: Bool) -> Timing {
        if reduce || !(length > 0.5) { return Timing(dur: 0, ease: false) }
        if along {
            if length <= normalM && !((dt ?? .nan) > glideGapS) { return Timing(dur: glideS, ease: false) }
            return Timing(dur: Swift.min(2600, Swift.max(900, (700 + length * 0.8).rounded())) / 1000, ease: true)
        }
        return length <= straightM ? Timing(dur: glideS, ease: false) : Timing(dur: 0, ease: false)
    }

    /// Ease in and out for a catch-up (web `easeInOut`).
    public static func easeInOut(_ k: Double) -> Double { k < 0.5 ? 2 * k * k : 1 - pow(-2 * k + 2, 2) / 2 }

    /// Cumulative lengths of a path (for animating along it).
    public static func pathCum(_ path: [LatLon]) -> [Double] { Geometry.cumulative(path) }
}
