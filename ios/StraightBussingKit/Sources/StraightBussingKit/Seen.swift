import Foundation

/// The parts of the seen service windows (web/data/service_seen.json, tools/build_service_seen.py) the app uses; port of
/// web/js/data/static.js cleanSeen. Per line and day type: the days of the week it covers, its listed hours when learned
/// ('HH:MM-HH:MM,...') and the median first stop of each bus slot seen on `Seen.startMinDays` days or more; and the usual
/// line-to-line transitions (from, to, the from line's days of the week, median leave and join), all in minutes on the
/// service-day clock (00:30 after midnight = 1470). Every explanation stays in the file.
public struct SeenData: Sendable, Equatable {
    public struct Day: Sendable, Equatable {
        public var dows: [String]
        public var spans: String
        public var starts: [Double]
        public init(dows: [String], spans: String, starts: [Double]) { self.dows = dows; self.spans = spans; self.starts = starts }
    }
    public struct Move: Sendable, Equatable {
        public var from: String
        public var to: String
        public var dows: [String]
        public var leave: Double
        public var join: Double
        /// After a break (kind after_break): the window is only around the join.
        public var brk: Bool
        public init(from: String, to: String, dows: [String], leave: Double, join: Double, brk: Bool = false) {
            self.from = from; self.to = to; self.dows = dows; self.leave = leave; self.join = join; self.brk = brk
        }
    }
    public var validUntil: String?
    public var lines: [String: [Day]]
    public var transitions: [Move]
    public init(validUntil: String? = nil, lines: [String: [Day]] = [:], transitions: [Move] = []) {
        self.validUntil = validUntil; self.lines = lines; self.transitions = transitions
    }

    static func hm(_ v: Any?) -> Double? {
        guard let s = v as? String else { return nil }
        let p = s.split(separator: ":")
        guard p.count == 2, p[1].count == 2, (1...2).contains(p[0].count), let h = Int(p[0]), let m = Int(p[1]) else { return nil }
        return Double(h * 60 + m)
    }

    /// Parse service_seen.json (nil when nothing usable is left).
    public static func parse(_ data: Data, minDays: Int = Seen.startMinDays) -> SeenData? {
        guard let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let rawLines = o["lines"] as? [String: Any] else { return nil }
        func p50(_ v: Any?) -> Double? { hm((v as? [String: Any])?["p50"]) }
        var lines: [String: [Day]] = [:], types: [String: [String]] = [:]
        for (rid, raw) in rawLines {
            guard let L = raw as? [String: Any], let days = L["days"] as? [Any] else { continue }
            var list: [Day] = []
            for dr in days {
                guard let d = dr as? [String: Any], let dows = d["dows"] as? [Any],
                      let listed = d["listed"] as? [String: Any], let spans = listed["spans"] as? [Any] else { continue }
                let key = spans.compactMap { s -> String? in
                    guard let a = s as? [Any], a.count >= 2, let x = a[0] as? String, let y = a[1] as? String else { return nil }
                    return x + "-" + y
                }.joined(separator: ",")
                let starts = ((d["buses"] as? [Any]) ?? []).compactMap { br -> Double? in
                    guard let b = br as? [String: Any], let n = (b["days"] as? NSNumber)?.intValue, n >= minDays else { return nil }
                    return p50(b["first_stop"])
                }
                let ds = dows.compactMap { $0 as? String }
                list.append(Day(dows: ds, spans: key, starts: starts))
                if let type = d["type"] as? String { types[rid + "|" + type] = ds }
            }
            if !list.isEmpty { lines[rid] = list }
        }
        var moves: [Move] = []
        for tr in (o["transitions"] as? [Any]) ?? [] {
            guard let x = tr as? [String: Any], let from = x["from"] as? String, let to = x["to"] as? String,
                  let type = x["day_type"] as? String, let dows = types[from + "|" + type],
                  let leave = p50(x["leave"]), let join = p50(x["join"]) else { continue }
            moves.append(Move(from: from, to: to, dows: dows, leave: leave, join: join, brk: (x["kind"] as? String) == "after_break"))
        }
        guard !lines.isEmpty else { return nil }
        return SeenData(validUntil: o["valid_until"] as? String, lines: lines, transitions: moves)
    }
}

/// Transition windows (owner 2026-11-11: "Still show these buses if they are in a transition time to their new route
/// (indicate this on their bus icon (if the bus is clicked, have it display: Transitioning to new line)."). Port of
/// web/js/core/seen.js, same rule and numbers: `OffRoute` asks `transitionAt` before it hides a bus off its route; inside
/// a window the bus stays on the map, marked (`LiveState.transitioning`). A window of line L: a usual transition from or
/// to L (`transitionPadS` before the median leave to `transitionPadS` after the median join; after a break only around
/// the join), or a usual shift start of
/// L (`transitionPadS` around the median first stop); a shift end is not one. Used only while the day's listed hours of
/// L equal the learned ones and the file is not past valid_until. Learned times, never shown as a schedule.
public enum Seen {
    /// A window runs this long before and after its learned times (s; RouteKnower E30's transition windows).
    public static let transitionPadS = 30.0 * 60
    /// A shift start counts when that bus slot was seen on at least this many days.
    public static let startMinDays = 3
    /// Only this close to its route (m) is an off-route bus kept on the map as transitioning (RouteKnower E32c: of the
    /// marked minutes 1 km or more off, 20% were a bus that then served; 300 m to 1 km, 60%).
    public static let transitionMaxM = 1000.0
    /// A transitioning bus's Passio times stay on screen (true) or only its marked badge does (false; RouteKnower E32c:
    /// with its times, ghost times rose from 4.5% to 5.6% of bus-minutes with times; its badge alone left them unchanged).
    public static let transitionTimes = false
    /// Heading toward its line (m): inside a window a bus is marked only once it is this much nearer its route than at its
    /// farthest point of the stretch off it (coming back to serve; driving away or parked off its line is not). 0 = any.
    public static let towardM = 100.0
    /// The words for a marked bus (owner 2026-11-11, exactly); web TRANSITION_TEXT.
    public static let transitionText = "Transitioning to new line"

    public struct Window: Sendable, Equatable {
        public var kind: String
        public var from: String?
        public var to: String?
        public var a: Double
        public var b: Double
    }

    /// The entry of a line for the service day of t, when it may be used (web seenEntry).
    public static func entry(_ seen: SeenData?, service: ServiceData?, rid: String, t: Double) -> (day: SeenData.Day, min: Double, dow: String)? {
        guard let seen, let days = seen.lines[rid], !days.isEmpty, t.isFinite else { return nil }
        let c = Idle.serviceClock(t)
        if let v = seen.validUntil, !v.isEmpty, c.iso > v { return nil }
        guard let d = days.first(where: { $0.dows.contains(c.day) }) else { return nil }
        guard let key = Idle.hoursKey(service, rid, iso: c.iso, day: c.day), key == d.spans else { return nil }
        return (d, Double(c.min), c.day)
    }

    /// The transition window of line `rid` that t (the bus's report time) is in, or nil (web transitionAt).
    public static func transitionAt(_ seen: SeenData?, service: ServiceData?, rid: String, t: Double, padS: Double = transitionPadS) -> Window? {
        guard let seen, let e = entry(seen, service: service, rid: rid, t: t) else { return nil }
        let pad = padS / 60
        for x in seen.transitions where (x.from == rid || x.to == rid) && x.dows.contains(e.dow) {
            let a = (x.brk ? x.join : min(x.leave, x.join)) - pad, b = (x.brk ? x.join : max(x.leave, x.join)) + pad
            if e.min >= a && e.min <= b { return Window(kind: "transition", from: x.from, to: x.to, a: a, b: b) }
        }
        for s in e.day.starts where e.min >= s - pad && e.min <= s + pad {
            return Window(kind: "start", from: nil, to: nil, a: s - pad, b: s + pad)
        }
        return nil
    }
}
