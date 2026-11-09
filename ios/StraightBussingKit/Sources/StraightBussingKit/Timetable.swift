import Foundation

/// The published timetable (web/data/timetable.json, tools/build_gtfs.py build_timetable) for planning a trip at a chosen
/// start time (Directions' "Leave at", owner 2026-11-09). Bad entries are dropped (web data/timetable.js cleanTimetable).
public struct TimetableData: Sendable, Equatable {
    public struct Service: Sendable, Equatable {
        /// "1111100": Monday ... Sunday.
        public var days: String
        public var start: String?
        public var end: String?
        public init(days: String, start: String? = nil, end: String? = nil) { self.days = days; self.start = start; self.end = end }
    }
    public struct Pattern: Sendable, Equatable {
        /// Stop ids in trip order.
        public var stops: [String]
        /// Seconds after the trip's start at each stop.
        public var t: [Double]
        /// Service id -> trip starts (seconds after the service day's midnight; may pass 24:00), ascending.
        public var starts: [String: [Double]]
        public init(stops: [String], t: [Double], starts: [String: [Double]]) { self.stops = stops; self.t = t; self.starts = starts }
    }
    public var generated: String?
    public var feedStart: String?
    public var feedEnd: String?
    public var services: [String: Service]
    /// ISO date -> service id -> 1 added | 2 removed (calendar_dates inside the feed window).
    public var dates: [String: [String: Int]]
    public var routes: [String: [Pattern]]

    public init(generated: String? = nil, feedStart: String? = nil, feedEnd: String? = nil, services: [String: Service] = [:],
                dates: [String: [String: Int]] = [:], routes: [String: [Pattern]] = [:]) {
        self.generated = generated; self.feedStart = feedStart; self.feedEnd = feedEnd
        self.services = services; self.dates = dates; self.routes = routes
    }

    static func isISO(_ s: Any?) -> String? {
        guard let s = s as? String, s.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil else { return nil }
        return s
    }

    /// Parse timetable.json (nil when nothing usable is left; same rules as the web's cleanTimetable).
    public static func parse(_ data: Data) -> TimetableData? {
        guard let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let rawRoutes = o["routes"] as? [String: Any], let rawServices = o["services"] as? [String: Any] else { return nil }
        func num(_ v: Any?) -> Double? {
            guard let n = v as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { return nil }
            let d = n.doubleValue
            return d.isFinite ? d : nil
        }
        var services: [String: Service] = [:]
        for (sid, raw) in rawServices {
            guard let s = raw as? [String: Any], let days = s["days"] as? String,
                  days.range(of: #"^[01]{7}$"#, options: .regularExpression) != nil else { continue }
            services[sid] = Service(days: days, start: isISO(s["start"]), end: isISO(s["end"]))
        }
        var dates: [String: [String: Int]] = [:]
        for (iso, raw) in (o["dates"] as? [String: Any]) ?? [:] {
            guard isISO(iso) != nil, let m = raw as? [String: Any] else { continue }
            var day: [String: Int] = [:]
            for (sid, typ) in m { if let n = num(typ), n == 1 || n == 2 { day[sid] = Int(n) } }
            if !day.isEmpty { dates[iso] = day }
        }
        var routes: [String: [Pattern]] = [:]
        for (rid, raw) in rawRoutes {
            guard let pats = raw as? [Any] else { continue }
            var list: [Pattern] = []
            for p in pats {
                guard let p = p as? [String: Any], let stopsRaw = p["stops"] as? [Any], let tRaw = p["t"] as? [Any],
                      stopsRaw.count == tRaw.count, stopsRaw.count >= 2 else { continue }
                let t = tRaw.compactMap(num)
                guard t.count == tRaw.count, t.enumerated().allSatisfy({ $0.element >= 0 && ($0.offset == 0 || $0.element >= t[$0.offset - 1]) }) else { continue }
                let stops = stopsRaw.map { ($0 as? String) ?? (($0 as? NSNumber)?.stringValue ?? "\($0)") }
                var starts: [String: [Double]] = [:]
                for (sid, arr) in (p["starts"] as? [String: Any]) ?? [:] {
                    guard services[sid] != nil, let arr = arr as? [Any] else { continue }
                    let ok = arr.compactMap(num).filter { $0 >= 0 && $0 < 3 * 86400 }.sorted()
                    if !ok.isEmpty { starts[sid] = ok }
                }
                if !starts.isEmpty { list.append(Pattern(stops: stops, t: t, starts: starts)) }
            }
            if !list.isEmpty { routes[rid] = list }
        }
        guard !routes.isEmpty else { return nil }
        let feed = o["feed"] as? [String: Any]
        return TimetableData(generated: o["generated"] as? String, feedStart: isISO(feed?["start"]), feedEnd: isISO(feed?["end"]),
                             services: services, dates: dates, routes: routes)
    }
}

/// A trip at a chosen start time (owner 2026-11-09: "when deciding a destination, the user should have an optional trip
/// start time. This trip start time should schedule the arrivals based on the scheduled arrival time"). A faithful port of
/// web/js/core/timetable.js (same rules, words and numbers; TimetableTests replays the web's answers,
/// Fixtures/tripstart_golden.json). Pure, never throws.
///
/// - `startMode`: no start time or one already past = `.now` (live, as always); under `liveSoonMin` minutes away =
///   `.live` (live predictions planned from that time, Start stays); later = `.timetable` (scheduled times only, the larger
///   disclaimer, no Start).
/// - Service days: calendar weekday and date range, then calendar_dates. Trip times are wall-clock Chicago times on the
///   service date; past 24:00 = that clock time on the next date (the reading `Schedule` uses for listed hours).
/// - Instances, departures by "route|stop" (a trip's last stop is not a boarding point), the time a trip reaches a stop,
///   across the end of a loop onto the trip that starts there within `layoverMaxS`.
public enum Timetable {
    public enum Mode: String, Sendable { case now, live, timetable }

    public static let liveSoonMin = 10.0
    public static let layoverMaxS = 1800.0
    public static let aheadS = 4 * 3600.0

    public static let leaveNow = "Leave now"
    public static let title = "Scheduled times, not live"
    public static let disclaimer = "Planned from the timetable. Most buses run later than scheduled, and the campus shuttles "
        + "currently have no way to adjust these times for that, so leave extra time. For live times, plan with Leave now."
    public static let soon = "Your start time is less than 10 minutes away, so these are live times from then."
    public static let startLater = "Start appears 10 minutes before your start time, when live times take over."
    public static let noneTitle = "No scheduled shuttle trip"
    public static let outside = "This date is outside the published timetable, so the regular weekly pattern is used. Holidays and breaks are not included."
    public static let loading = "Loading the timetable\u{2026}"
    public static let failed = "The timetable could not be loaded. Check your connection, or plan with Leave now."
    /// The start time sheet (web ui/views/leavepick.js LEAVE_TITLE, LEAVE_NOTE, previewText).
    public static let pickerTitle = "Trip start time"
    public static let pickerNote = "Up to 10 minutes from now, bus times stay live. Later times come from the timetable, and most buses run later than scheduled."
    public static let passed = "That time has passed, so trips are planned from now."
    /// What Set would do, in one sentence (the live line under the wheels).
    public static func previewText(_ at: Double, now: Double, _ tt: TimetableData?, locale: Locale = .current) -> String {
        switch startMode(at, now: now) {
        case .now: return at < now - 59 ? "That time has passed, so trips are planned from now. Bus times are live." : "\(leaveNow). Bus times are live."
        case .live: return "\(leaveLabel(at, now: now, locale: locale)). Less than 10 minutes away, so bus times stay live."
        case .timetable: return "\(leaveLabel(at, now: now, locale: locale)). Bus times will come from the timetable." + (outsideTimetable(tt, at) ? " " + outside : "")
        }
    }
    /// "The timetable has no shuttle that goes close to both places around 5:40 PM."
    public static func noneText(_ at: Double) -> String { "The timetable has no shuttle that goes close to both places around \(TimeFmt.clock(at))." }

    static let dow = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    static let dowLong = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

    /// Which planning mode a start time means.
    public static func startMode(_ at: Double?, now: Double) -> Mode {
        guard let at, at.isFinite, at > now else { return .now }
        return at - now < liveSoonMin * 60 ? .live : .timetable
    }

    /// 'YYYY-MM-DD' of a Chicago date.
    public static func isoOf(_ t: Double) -> String { Schedule.isoDate(Schedule.localParts(t)) }

    /// Year, month, day of an ISO date (nil when it is not one).
    static func ymd(_ iso: String) -> [Int]? {
        let p = iso.split(separator: "-").compactMap { Int($0) }
        return p.count == 3 ? p : nil
    }
    static func utcDate(_ iso: String) -> Date? {
        guard let p = ymd(iso) else { return nil }
        return Schedule.utcCal.date(from: DateComponents(year: p[0], month: p[1], day: p[2]))
    }

    /// An ISO date moved by n days.
    public static func isoAdd(_ iso: String, _ n: Int) -> String {
        guard let base = utcDate(iso), let x = Schedule.utcCal.date(byAdding: .day, value: n, to: base) else { return iso }
        let c = Schedule.utcCal.dateComponents([.year, .month, .day], from: x)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    static func dowOf(_ iso: String) -> Int {
        guard let x = utcDate(iso) else { return 0 }
        return (Schedule.utcCal.component(.weekday, from: x) + 5) % 7
    }

    /// Service ids running on a service date.
    public static func servicesOn(_ tt: TimetableData?, _ iso: String) -> Set<String> {
        guard let tt else { return [] }
        var on = Set<String>()
        let k = dowOf(iso)
        for (sid, s) in tt.services {
            let ch = Array(s.days)
            if k < ch.count, ch[k] == "1", s.start.map({ $0 <= iso }) ?? true, s.end.map({ iso <= $0 }) ?? true { on.insert(sid) }
        }
        for (sid, typ) in tt.dates[iso] ?? [:] { if typ == 1 { on.insert(sid) } else { on.remove(sid) } }
        return on
    }

    /// Unix time of a service-day time (Chicago wall clock; past 24:00 = the next date's clock).
    public static func serviceUnix(_ iso: String, _ sec: Double) -> Double {
        let days = Int((sec / 86400).rounded(.down)), r = sec - Double(days) * 86400
        guard let p = ymd(isoAdd(iso, days)) else { return 0 }
        let h = Int((r / 3600).rounded(.down)), mi = Int((r.truncatingRemainder(dividingBy: 3600) / 60).rounded(.down))
        return TimeActive.chicagoUnix(p[0], p[1], p[2], h, mi) + r.truncatingRemainder(dividingBy: 60)
    }

    /// The timetable's dates do not cover this time (weekly pattern, holidays unknown).
    public static func outsideTimetable(_ tt: TimetableData?, _ at: Double) -> Bool {
        guard let tt else { return false }
        let iso = isoOf(at)
        return (tt.feedStart.map { iso < $0 } ?? false) || (tt.feedEnd.map { iso > $0 } ?? false)
    }

    /// One scheduled trip on a service date.
    public struct Instance: Sendable, Equatable {
        public var rid: String
        public var id: String
        public var stops: [String]
        public var times: [Double]
        public var start: Double
        public var end: Double
    }

    /// Scheduled trips running between `from` and `to`, by start time then id.
    public static func instancesBetween(_ tt: TimetableData?, _ from: Double, _ to: Double, rids: [String]? = nil) -> [Instance] {
        guard let tt, from.isFinite, to.isFinite else { return [] }
        let want: Set<String>? = rids.map { Set($0) }
        var out: [Instance] = []
        var iso = isoAdd(isoOf(from), -1)
        let last = isoOf(to)
        while iso <= last {
            let on = servicesOn(tt, iso)
            if !on.isEmpty {
                let b = [0.0, 86400, 172800].map { serviceUnix(iso, $0) }
                func at(_ sec: Double) -> Double {
                    let n = Int((sec / 86400).rounded(.down))
                    return n < 2 && b[n + 1] - b[n] == 86400 ? b[n] + (sec - Double(n) * 86400) : serviceUnix(iso, sec)
                }
                for (rid, pats) in tt.routes {
                    if let want, !want.contains(rid) { continue }
                    for (pi, p) in pats.enumerated() {
                        let dur = p.t.last ?? 0
                        for sid in on {
                            for s in p.starts[sid] ?? [] {
                                let t0 = at(s)
                                if t0 + dur < from || t0 > to { continue }
                                out.append(Instance(rid: rid, id: "\(rid):\(iso):\(pi):\(jsNum(s))", stops: p.stops, times: p.t.map { t0 + $0 },
                                                    start: t0, end: t0 + dur))
                            }
                        }
                    }
                }
            }
            iso = isoAdd(iso, 1)
        }
        return out.sorted { $0.start < $1.start || ($0.start == $1.start && $0.id < $1.id) }
    }

    /// A number the way JavaScript prints it in a template (whole numbers without ".0").
    static func jsNum(_ x: Double) -> String { x == x.rounded() && abs(x) < 1e15 ? String(Int(x)) : String(x) }

    public struct Departure: Sendable, Equatable {
        public var t: Double
        public var inst: Int   // index into the instances
    }

    /// Boarding times by "rid|stopId", earliest first (stable: the instances' order for equal times).
    public static func departureIndex(_ instances: [Instance]) -> [String: [Departure]] {
        var idx: [String: [Departure]] = [:]
        for (n, inst) in instances.enumerated() {
            for k in 0..<max(0, inst.stops.count - 1) { idx[inst.rid + "|" + inst.stops[k], default: []].append(Departure(t: inst.times[k], inst: n)) }
        }
        for (key, arr) in idx { idx[key] = arr.stableSorted { $0.t < $1.t } }
        return idx
    }

    /// When a trip reaches a stop strictly after `after`.
    public static func instAt(_ inst: Instance, _ stopId: String, after: Double) -> Double? {
        for k in inst.stops.indices where inst.stops[k] == stopId && inst.times[k] > after { return inst.times[k] }
        return nil
    }

    /// The route's trip that starts where `inst` ends, within `layoverMaxS` of its end.
    public static func nextInstance(_ instances: [Instance], _ i: Int) -> Int? {
        let inst = instances[i], endStop = inst.stops.last
        for (n, x) in instances.enumerated() where n != i && x.rid == inst.rid && x.stops.first == endStop {
            if x.start >= inst.end && x.start <= inst.end + layoverMaxS { return n }
        }
        return nil
    }

    /// When the bus leaving on instance `i` at `depT` reaches `stopId` (this trip, else the one going on from the loop's end).
    public static func reachAt(_ instances: [Instance], _ i: Int, _ stopId: String, depT: Double) -> Double? {
        if let t = instAt(instances[i], stopId, after: depT) { return t }
        guard let n = nextInstance(instances, i) else { return nil }
        return instAt(instances[n], stopId, after: depT)
    }

    /* ---------- the start time control ---------- */

    /// "Leave now", "Leave at 5:40 PM" (today), "Leave tomorrow at 5:40 PM", "Leave Wed Nov 11 at 5:40 PM".
    public static func leaveLabel(_ at: Double?, now: Double, locale: Locale = .current) -> String {
        guard let at, startMode(at, now: now) != .now else { return leaveNow }
        let a = isoOf(at), n = isoOf(now), c = TimeFmt.clock(at, locale: locale)
        if a == n { return "Leave at \(c)" }
        if a == isoAdd(n, 1) { return "Leave tomorrow at \(c)" }
        let p = Schedule.localParts(at)
        return "Leave \(dow[p.dow]) \(TimeActive.monthsShort[max(0, min(11, p.m - 1))]) \(p.d) at \(c)"
    }

    public struct Day: Sendable, Equatable, Hashable {
        public var iso: String
        public var text: String
        public var say: String
    }

    /// Days the picker offers: today, tomorrow, then the dates through the timetable's last date (at least a week, at most 31).
    public static func leaveDays(now: Double, _ tt: TimetableData?) -> [Day] {
        let today = isoOf(now)
        var n = 7
        if let end = tt?.feedEnd, end >= today, let a = utcDate(today), let b = utcDate(end) {
            n = min(31, max(7, Int(JS.round(b.timeIntervalSince(a) / 86400)) + 1))
        }
        return (0..<n).map { i in
            let iso = isoAdd(today, i), p = ymd(iso) ?? [0, 1, 1], w = dowOf(iso), m = p[1], d = p[2]
            let mon = TimeActive.monthsShort[max(0, min(11, m - 1))], monL = TimeActive.monthsLong[max(0, min(11, m - 1))]
            let text = i == 0 ? "Today" : i == 1 ? "Tomorrow" : "\(dow[w]) \(mon) \(d)"
            return Day(iso: iso, text: text, say: i < 2 ? "\(text), \(dowLong[w]), \(monL) \(d)" : "\(dowLong[w]), \(monL) \(d)")
        }
    }

    /// The moment a day and a clock time name (Chicago).
    public static func leaveUnix(iso: String, hour24: Int, minute: Int) -> Double {
        guard let p = ymd(iso) else { return 0 }
        return TimeActive.chicagoUnix(p[0], p[1], p[2], hour24, minute)
    }

    /// The picker's starting point: the chosen time, else now rounded up to the next 5 minutes.
    public static func leaveDefault(_ at: Double?, now: Double) -> Double {
        if let at, at.isFinite, at > now { return at }
        return ((now + 1) / 300).rounded(.up) * 300
    }
}
