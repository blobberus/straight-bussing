import Foundation
import QuartzCore
import StraightBussingKit

/// Moves the bus markers along their route line (owner 2026-10-18: smooth, never off the roads and the route lines,
/// after a reload or a gap in the feed too; web map/layers.js createBusLayer). The rules are the Kit's `BusTrack`
/// (the same as web map/track.js): a report near its route's line is drawn on the line, and each move goes through
/// the line's own points: a normal poll at constant speed over 9 s, a catch-up after a gap eased in 0.9 to 2.6 s;
/// the heading turns with the street, the short way round (`HeadingCone.unwrap`). Off the line: a short straight
/// glide, a long move jumps.
///
/// SwiftUI's Map would animate an annotation's coordinate in a straight line (across the block), so the badge is
/// stepped along the path and each step is set as is, exactly on the line (`AppModel.publishBuses`, no animation):
/// 4 steps a second for a normal glide (about 3 m a step, under a pixel at the campus zoom), up to 30 while catching up.
/// Plain steps, not a chain of short animations: an app that is always animating never goes idle (more battery, and
/// XCUITest waits for idle: a test with simulated buses took 3 to 4 min instead of 50 s). Nothing ticks when no badge
/// moves, in the background or while a sheet covers the map (`pause`), with Reduce Motion (moves at once) or in the
/// `-demo` CI build (UI tests never wait on a glide).
@MainActor
final class BusMotion {
    /// One bus report of a poll.
    struct Report {
        let id: String
        let rid: String
        let coord: LatLon
        let bearing: Double?
        /// The vehicle's own report time (feed clock, 0 = unknown).
        let vt: Double
    }

    private struct Anim {
        let path: [LatLon]
        let cum: [Double]
        let total: Double
        let t0: Double
        let dur: Double
        let ease: Bool
        let along: Bool
        let f: Double
        let line: BusTrack.Line?
        let pos0: Double
        let endHeading: Double?
    }

    private struct Mover {
        var rid: String
        var raw: LatLon
        var bearing: Double?
        var vt: Double
        var seen: Double
        var to: BusTrack.Place?
        var disp: LatLon
        var anim: Anim?
        var rot: Double?
    }

    private var movers: [String: Mover] = [:]
    private var lines: [String: [BusTrack.Line]] = [:]
    private var linesVersion = -1
    private var ticker: Task<Void, Never>?
    private var active = true
    /// Called after every step: the model republishes the markers where the badges are now.
    var onStep: (() -> Void)?
    /// A web `busHeading` rule: a bus must move this far before its heading comes from its movement.
    static let headingMinM = 15.0
    /// Steps: at most about `chordM` meters each (at the fastest move's speed), between 30 and 4 steps a second.
    static let chordM = 3.0, minStep = 1.0 / 30, maxStep = 0.25

    private func clock() -> Double { CACurrentMediaTime() }

    /// The route's lines, prepared once per schedule version.
    private func prepared(_ rid: String, _ shapes: [String: [[LatLon]]], _ version: Int) -> [BusTrack.Line] {
        if version != linesVersion { lines = [:]; linesVersion = version }
        if let l = lines[rid] { return l }
        let l = BusTrack.prepare(shapes[rid])
        lines[rid] = l
        return l
    }

    private static func done(_ a: Anim, _ t: Double) -> Double {
        let k = a.dur > 0 ? Swift.min(1, Swift.max(0, (t - a.t0) / a.dur)) : 1
        return a.ease ? BusTrack.easeInOut(k) : k
    }

    /// Where a badge is on its line now, or nil when it is not on the line.
    private static func onLine(_ m: Mover, _ t: Double) -> BusTrack.OnLine? {
        if let a = m.anim {
            guard a.along, let s = a.line, let li = m.to?.li else { return nil }
            return BusTrack.OnLine(li: li, pos: BusTrack.advance(s, a.pos0, a.f * done(a, t)))
        }
        return m.to.map { BusTrack.OnLine(li: $0.li, pos: $0.pos) }
    }

    private static func turned(_ rot: Double?, _ deg: Double?) -> Double? {
        guard let deg, deg.isFinite else { return rot }
        return HeadingCone.unwrap(rot, deg)
    }

    /// A poll's reports (or the same ones again when only the clock moved): every bus whose report changed starts a
    /// move from where its badge is now. Buses no longer reported are dropped.
    func update(_ reports: [Report], shapes: [String: [[LatLon]]], version: Int, now: Double, reduce: Bool) {
        let t = clock()
        var keep = Set<String>()
        for r in reports {
            keep.insert(r.id)
            let prep = prepared(r.rid, shapes, version)
            guard var m = movers[r.id], m.rid == r.rid else {
                let first = BusTrack.follow(prep, from: nil, at: nil, r.coord, bearing: r.bearing)
                let start = first.to?.pt ?? r.coord
                // no feed heading: the line's own direction (shapes run the way the buses drive)
                let hd = r.bearing ?? first.to.flatMap { BusTrack.headingAt(prep[$0.li], $0.pos) }
                movers[r.id] = Mover(rid: r.rid, raw: r.coord, bearing: r.bearing, vt: r.vt, seen: now, to: first.to,
                                     disp: start, anim: nil, rot: Self.turned(nil, hd))
                continue
            }
            if m.raw == r.coord {
                if m.anim == nil, r.bearing != m.bearing { m.rot = Self.turned(m.rot, r.bearing) }
                m.bearing = r.bearing
                movers[r.id] = m
                continue
            }
            let dt = r.vt > 0 && m.vt > 0 ? r.vt - m.vt : now - m.seen
            let from = Self.onLine(m, t)
            let mv = BusTrack.follow(prep, from: from, at: m.disp, r.coord, bearing: r.bearing, dt: dt)
            let cum = BusTrack.pathCum(mv.path), total = cum.last ?? 0
            let timing = BusTrack.timing(along: mv.along, length: total, dt: dt, reduce: reduce)
            // the heading: along the street when it moves on the line, else the feed's, else from the movement
            let moved: Double? = Geometry.distM(m.raw, r.coord) >= Self.headingMinM ? Geo.bearing(m.raw, r.coord) : nil
            let endHd: Double? = mv.along && mv.f > 2 ? mv.to.flatMap { BusTrack.headingAt(prep[$0.li], $0.pos) } : (r.bearing ?? moved)
            let target = mv.to?.pt ?? r.coord
            m.to = mv.to
            m.raw = r.coord
            m.bearing = r.bearing
            m.seen = now
            if r.vt > 0 { m.vt = r.vt }
            if timing.dur <= 0 {
                m.anim = nil
                m.disp = target
                m.rot = Self.turned(m.rot, endHd)
            } else {
                let line = mv.along ? mv.to.map { prep[$0.li] } : nil
                m.anim = Anim(path: mv.path, cum: cum, total: total, t0: t, dur: timing.dur, ease: timing.ease, along: mv.along,
                              f: mv.f, line: line, pos0: from?.pos ?? 0, endHeading: endHd)
                if !mv.along { m.rot = Self.turned(m.rot, endHd) }
            }
            movers[r.id] = m
        }
        for id in movers.keys where !keep.contains(id) { movers[id] = nil }
        startTicking()
    }

    /// Where a bus's badge is drawn now and its heading rotation (unwrapped degrees; nil = no heading yet).
    func shown(_ id: String) -> (coord: LatLon, rotation: Double?)? {
        movers[id].map { ($0.disp, $0.rot) }
    }

    /// Advances every move to time t. -> whether any move still runs.
    private func step(_ t: Double) -> Bool {
        var more = false
        for (id, var m) in movers {
            guard let a = m.anim else { continue }
            let e = Self.done(a, t)
            m.disp = BusTrack.pointAt(a.path, a.cum, e * a.total)
            if a.along, a.f > 2, let s = a.line {
                m.rot = Self.turned(m.rot, BusTrack.headingAt(s, BusTrack.advance(s, a.pos0, a.f * e)))
            }
            if e >= 1 {
                m.anim = nil
                m.rot = Self.turned(m.rot, a.endHeading)
            } else {
                more = true
            }
            movers[id] = m
        }
        return more
    }

    /// The next step's length: about `chordM` at the fastest move's speed, 1/30 to 1/4 s.
    private func nextStep() -> Double {
        var best = Self.maxStep
        for m in movers.values {
            guard let a = m.anim, a.dur > 0 else { continue }
            let speed = a.total / a.dur * (a.ease ? 2 : 1)     // an eased move runs twice its mean speed at its middle
            if speed > 0 { best = Swift.min(best, Swift.max(Self.minStep, Self.chordM / speed)) }
        }
        return best
    }

    private func startTicking() {
        guard active, ticker == nil, movers.values.contains(where: { $0.anim != nil }) else { return }
        ticker = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                let len = self.nextStep()
                try? await Task.sleep(nanoseconds: UInt64(len * 1_000_000_000))
                if Task.isCancelled { break }
                let more = self.step(self.clock())
                self.onStep?()
                if !more { break }
            }
            self?.ticker = nil
        }
    }

    /// The app leaves the foreground, or a sheet covers the map: every move ends where it was going, nothing ticks
    /// until `resume`.
    func pause() {
        active = false
        ticker?.cancel()
        ticker = nil
        _ = step(.infinity)
        onStep?()
    }

    /// Back in the foreground with the map in view (the next poll starts new moves; a long absence catches up along
    /// the line).
    func resume() {
        active = true
        startTicking()
    }
}
