import Foundation

/// Trip timing words shared by Current trip and Directions (web ui/views/tripinfo.js). Walking is always
/// visible, totals say they include walking, "Leave now / Leave in N min" comes from the walking estimate, and
/// every derived time is labeled an estimate.
public enum TripInfo {
    /// Ride-time source wording for bus steps.
    public static func sourceText(_ s: RideSource) -> String {
        switch s {
        case .live: return "from live bus prediction"
        case .learned: return "learned from past rides"
        case .schedule: return "from schedule"
        case .estimate: return "distance estimate"
        }
    }

    /// Whole minutes, at least 1.
    public static func mins(_ m: Double) -> Int { max(1, Int(JS.round(m.isFinite ? m : 0))) }
    /// Walking minutes: "<1" under half a minute, else whole minutes.
    public static func walkMins(_ m: Double?) -> String {
        let v = m ?? 0
        return v < 0.5 ? "<1" : String(Int(JS.round(v)))
    }
    /// Walking minutes to a stop from a straight-line distance (x1.2 detour). Estimate.
    public static func stopWalkMin(_ d: Double) -> Double { Geo.walkMin(d * Geo.walkDetour) }
    /// "4 min walk · 320 m" for a straight-line distance.
    public static func walkText(_ d: Double) -> String { "\(mins(Geo.walkMin(d * Geo.walkDetour))) min walk · \(Int(JS.round(d))) m" }

    public enum CatchKind: String, Sendable { case miss, now, later }
    public struct CatchNote: Hashable, Sendable {
        public var kind: CatchKind
        public var text: String
        public var aria: String
        public var slack: Double
    }

    /// Guidance for catching a bus on foot.
    public static func catchNote(_ etaS: Double, walkMin: Double, now: Double) -> CatchNote {
        let slack = (etaS - now) / 60 - walkMin
        if slack < 0 {
            return CatchNote(kind: .miss, text: "Leaves before you can walk there, est.",
                             aria: "leaves before you can walk there, estimate from walking time", slack: slack)
        }
        if slack < 1 {
            return CatchNote(kind: .now, text: "Leave now, est.", aria: "leave now to catch it, estimate from walking time", slack: slack)
        }
        let n = Int(slack.rounded(.down))
        return CatchNote(kind: .later, text: "Leave in \(n) min, est.",
                         aria: "leave in \(n) minute\(n == 1 ? "" : "s") to catch it, estimate from walking time", slack: slack)
    }

    /// Board / alight clock per leg (nil for walk legs), walking forward from the option's start.
    public static func legsTimes(_ o: TripOption, now: Double) -> [(b: Double, a: Double)?] {
        var t = o.t0.isFinite && o.t0 > 0 ? o.t0 : now
        return o.legs.map { (l: Leg) -> (b: Double, a: Double)? in
            switch l {
            case .walk(let w):
                t += w.min * 60
                return nil
            case .bus(let b):
                let bt = b.boardT != 0 ? b.boardT : t + b.wait * 60
                let at = b.alightT != 0 ? b.alightT : bt + b.ride * 60
                t = at
                return (bt, at)
            }
        }
    }

    /// Total walking minutes (float).
    public static func walkTotal(_ o: TripOption) -> Double { o.walkLegs.reduce(0) { $0 + $1.min } }

    public struct Leave: Hashable, Sendable {
        public var now: Bool
        public var text: String
        public var by: Double
        public var slack: Double
    }

    /// When to leave for the first bus. Only for a live first bus (a headway guess is not a departure time).
    public static func leaveInfo(_ o: TripOption, now: Double) -> Leave? {
        guard let fb = o.legs.firstIndex(where: { $0.bus != nil }), let bus = o.legs[fb].bus, bus.waitLive, bus.boardT != 0 else { return nil }
        let walkBefore = o.legs[0..<fb].reduce(0.0) { $0 + ($1.walk?.min ?? 0) }
        let by = bus.boardT - walkBefore * 60, slack = (by - now) / 60
        if slack < 1 { return Leave(now: true, text: "Leave now", by: by, slack: slack) }
        return Leave(now: false, text: "Leave in \(Int(slack.rounded(.down))) min (by \(TimeFmt.clock(by)))", by: by, slack: slack)
    }

    /// Option card lines under the chips: first walk + first bus, then leave guidance + walking total.
    public static func optionLines(_ o: TripOption, now: Double) -> (first: String, second: String, leaveNow: Bool)? {
        let times = legsTimes(o, now: now)
        guard let fb = o.legs.firstIndex(where: { $0.bus != nil }), let bus = o.legs[fb].bus, let tb = times[fb] else { return nil }
        let board = bus.board.name.isEmpty ? "the stop" : bus.board.name
        let busAt = TimeFmt.clock(tb.b)
        let l1 = o.legs[0].walk.map { "Walk \(walkMins($0.min)) min to \(board) · bus \(busAt)" } ?? "No walk: board at \(board) · bus \(busAt)"
        let wt = walkTotal(o), leave = leaveInfo(o, now: now)
        let incl = wt > 0 ? "includes \(walkMins(wt)) min walking" : "no walking"
        let l2 = leave.map { $0.text + " · " + incl } ?? (incl.prefix(1).uppercased() + incl.dropFirst())
        return (l1, l2, leave?.now == true)
    }

    /// A piece of text, bold or not (step titles bold the stop names and clock times like the web).
    public struct Run: Hashable, Sendable {
        public var text: String
        public var bold: Bool
        public init(_ text: String, bold: Bool = false) { self.text = text; self.bold = bold }
    }

    /// One Directions step (ui/views/tripinfo.js stepsHTML).
    public struct Step: Hashable, Sendable {
        public enum Kind: Hashable, Sendable { case walk, bus(String), arrive }
        public var kind: Kind
        public var title: [Run]
        /// Small tag after the title ("sidewalk route" / "estimate" / "live" / "est.").
        public var tag: String?
        public var sub: String?
        /// Tag after the sub line ("est.").
        public var subTag: String?
        public var plain: String { title.map(\.text).joined() }
    }

    /// Step list for an option: the walk to the first stop and to the destination are always shown.
    public static func steps(_ o: TripOption, now: Double, fromLabel: String?, toLabel: String?) -> [Step] {
        let times = legsTimes(o, now: now), legs = o.legs, n = legs.count
        let dest = (toLabel ?? "").isEmpty ? "destination" : toLabel!
        var out: [Step] = []
        if let b = legs.first?.bus {
            let start = !b.board.name.isEmpty ? b.board.name : (fromLabel ?? "").isEmpty ? "the stop" : fromLabel!
            var s = Step(kind: .walk, title: [Run("No walk: start at "), Run(start, bold: true)])
            if let f = fromLabel, !f.isEmpty, f != b.board.name { s.sub = "\(f) is right by the stop" }
            out.append(s)
        }
        for (i, l) in legs.enumerated() {
            switch l {
            case .walk(let w):
                let next = i + 1 < n ? legs[i + 1].bus : nil, prev = i > 0 ? legs[i - 1].bus : nil
                let to = i == n - 1 ? dest : next?.board.name ?? w.to.name
                let change = prev != nil && next != nil ? " to change" : ""
                var s = Step(kind: .walk, title: [Run("Walk \(walkMins(w.min)) min (\(Int(JS.round(w.m))) m) to "),
                                                  Run(to.isEmpty ? "the stop" : to, bold: true), Run(change)],
                             tag: w.source == .router ? "sidewalk route" : "estimate")
                if i == 0, next != nil, let lv = leaveInfo(o, now: now), times.count > 1, let t1 = times[1] {
                    s.sub = "\(lv.now ? "Leave now" : "Leave by " + TimeFmt.clock(lv.by)) to catch the \(TimeFmt.clock(t1.b)) bus"
                    s.subTag = "est."
                }
                out.append(s)
            case .bus(let b):
                guard let t = times[i] else { continue }
                let w = Int(JS.round(b.wait)), r = mins(b.ride), sp = max(1, b.stopsPassed)
                out.append(Step(kind: .bus(b.rid),
                                title: [Run("Bus arrives at "), Run(b.board.name, bold: true), Run(" "), Run(TimeFmt.clock(t.b), bold: true)],
                                tag: b.waitLive ? "live" : "est.",
                                sub: "Wait ~\(w < 1 ? "<1" : String(w)) min · Ride ~\(r) min to \(b.alight.name) (\(TimeFmt.clock(t.a))) · \(sp) stop\(sp > 1 ? "s" : "") · \(sourceText(b.source))",
                                subTag: "est."))
            }
        }
        if let last = legs.last?.bus {
            let al = last.alight.name.isEmpty ? "the stop" : last.alight.name
            out.append(Step(kind: .walk, title: [Run("No walk: get off at "), Run(al, bold: true), Run(dest != al ? ", \(dest) is right there" : "")]))
        }
        let wt = walkTotal(o)
        out.append(Step(kind: .arrive, title: [Run("Arrive at "), Run(dest, bold: true), Run(" about "), Run(TimeFmt.clock(o.arrive), bold: true)],
                        sub: "About \(o.totalMin) min in total, \(wt > 0 ? "including \(walkMins(wt)) min walking" : "no walking")", subTag: "est."))
        return out
    }

    /// VoiceOver label of an option card (directions.js optionHTML aria).
    public static func optionLabel(_ o: TripOption, index: Int, criteria: String, routes: [String: Route], now: Double) -> String {
        let wt = walkTotal(o)
        let names = o.busLegs.map { routes[$0.rid]?.short.isEmpty == false ? routes[$0.rid]!.short : $0.rid }.joined(separator: " then ")
        let lines = optionLines(o, now: now).map { "\($0.first). \($0.second)" } ?? ""
        let crit = criteria.isEmpty ? "" : " (" + criteria.replacingOccurrences(of: " · ", with: ", ") + ")"
        let s = "Option \(index + 1)\(crit): about \(o.totalMin) minutes including \(wt > 0 ? walkMins(wt) + " minutes walking" : "no walking"), arrive \(TimeFmt.clock(o.arrive))\(names.isEmpty ? "" : ", take " + names). \(lines) Estimate."
        return s.replacingOccurrences(of: "<1 min", with: "under 1 min")
    }
}

/// Live-data honesty wording shared by the status pill, arrival rows, stop screen and alerts (web main.js
/// renderPill, ui/components.js liveLabel, ui/views/stop.js updatedText, ui/views/alerts.js).
public enum LiveText {
    public static let phone = "773.702.8181"

    public enum PillKind: String, Sendable { case err, warn, info }
    public struct Pill: Hashable, Sendable {
        public var kind: PillKind
        public var text: String
        /// Offer Retry.
        public var retry: Bool
    }

    /// The status pill under the search bar (nil = nothing to say). The feed in error is never "no shuttles";
    /// a fresh empty feed during scheduled service says no bus is reporting (Operating.silentService).
    public static func pill(level: StaleLevel, polled: Bool, lastOk: Double, feedTs: Double, loaded: Bool, busCount: Int,
                            silent: Bool) -> Pill? {
        guard polled else { return nil }
        switch level {
        case .err:
            return Pill(kind: .err, text: lastOk != 0 ? "Can't reach the shuttle feed. Retrying. Showing last known data."
                        : "Can't reach the shuttle feed. Don't rely on these times; call \(phone).", retry: true)
        case .old:
            return Pill(kind: .warn, text: "Live data is out of date\(feedTs != 0 ? " (last update " + TimeFmt.clock(feedTs) + ")" : ""). Times are approximate.", retry: false)
        case .late:
            return Pill(kind: .warn, text: "Live data delayed. Times may be off.", retry: false)
        case .fresh:
            guard loaded && busCount == 0 else { return nil }
            return silent ? Pill(kind: .warn, text: "No shuttles are reporting live locations", retry: false)
                : Pill(kind: .info, text: "No shuttles running right now", retry: false)
        }
    }

    /// Live label of arrival rows: "Live" / "Live, delayed" / "Last known" (+ the spoken form).
    public static func liveLabel(_ level: StaleLevel) -> (text: String, spoken: String) {
        switch level {
        case .fresh: return ("Live", "live")
        case .late: return ("Live, delayed", "live, data delayed")
        case .old, .err: return ("Last known", "last known prediction, may be out of date")
        }
    }

    /// Stop screen freshness footer.
    public static func updatedText(lastOk: Double, failed: Bool, level: StaleLevel, now: Double) -> String {
        if lastOk == 0 { return failed ? "Can't reach the shuttle feed. Retrying." : "Waiting for live data" }
        if level == .err { return "Last live update " + TimeFmt.clock(lastOk) + ". Retrying." }
        return "Updated " + TimeFmt.ago(lastOk, from: now)
    }

    /// Alert time window for the Alerts screen: "Until 4:12 PM" / "Since 9:00 AM" / "Until Oct 12" ('' none).
    public static func alertWindow(_ a: ServiceAlert, now: Double, calendar: Calendar = .current) -> String {
        guard let p = a.activePeriods.first(where: { w in (w.start == nil || w.start == 0 || w.start! <= now) && (w.end == nil || w.end == 0 || w.end! >= now) }) else { return "" }
        let today = Date(timeIntervalSince1970: now)
        func sameDay(_ t: Double) -> Bool { calendar.isDate(Date(timeIntervalSince1970: t), inSameDayAs: today) }
        if let e = p.end, e != 0, sameDay(e) { return "Until " + TimeFmt.clock(e, timeZone: calendar.timeZone) }
        if let s = p.start, s != 0, sameDay(s) { return "Since " + TimeFmt.clock(s, timeZone: calendar.timeZone) }
        if let e = p.end, e != 0 { return "Until " + dayLabel(e, calendar: calendar) }
        return ""
    }

    /// Alert period for Settings: "4:12 PM – 6:00 PM" / "Oct 12 4:12 PM – ..." / "Until ..." / "Since ...".
    public static func alertPeriod(_ a: ServiceAlert, now: Double, calendar: Calendar = .current) -> String {
        guard let p = a.activePeriods.first(where: { w in (w.start == nil || w.start == 0 || w.start! <= now) && (w.end == nil || w.end == 0 || w.end! >= now) }) else { return "" }
        let start = p.start ?? 0, end = p.end ?? 0
        if start == 0 && end == 0 { return "" }
        let today = Date(timeIntervalSince1970: now)
        func f(_ t: Double) -> String {
            let c = TimeFmt.clock(t, timeZone: calendar.timeZone)
            return calendar.isDate(Date(timeIntervalSince1970: t), inSameDayAs: today) ? c : dayLabel(t, calendar: calendar) + " " + c
        }
        if start != 0 && end != 0 { return "\(f(start)) \u{2013} \(f(end))" }
        return end != 0 ? "Until \(f(end))" : "Since \(f(start))"
    }

    static func dayLabel(_ t: Double, calendar: Calendar) -> String {
        let df = DateFormatter()
        df.calendar = calendar
        df.timeZone = calendar.timeZone
        df.locale = Locale(identifier: "en_US")
        df.setLocalizedDateFormatFromTemplate("MMMd")
        return df.string(from: Date(timeIntervalSince1970: t))
    }

    /// Words that make an alert important (alerts.js: severity WARNING/SEVERE, or detour / cancel / suspend / closed).
    public static func isSevere(_ a: ServiceAlert) -> Bool {
        let t = (a.header.isEmpty ? a.description : a.header).lowercased()
        return ["detour", "cancel", "suspend", "closed"].contains { t.contains($0) }
    }

    /// The Current trip alert banner: ("Service alert" | "N service alerts", first title + " and N more").
    public static func alertBanner(_ alerts: [ServiceAlert]) -> (head: String, line: String)? {
        guard let first = alerts.first else { return nil }
        let n = alerts.count
        let title = first.header.isEmpty ? "Service change" : first.header
        return (n == 1 ? "Service alert" : "\(n) service alerts", title + (n > 1 ? " and \(n - 1) more" : ""))
    }
}

/// Station search (web ui/views/pick.js matchStations, ui/views/settings.js searchStations).
public enum StationSearch {
    public struct Match: Hashable, Sendable {
        public var id: String
        public var name: String
        public var coord: LatLon
    }

    /// Stations whose name contains the query, or whose words start with every typed word ("57th metra" finds
    /// "57th St. & Metra (NB)"). Order: name starts with it, a word starts with it, all words match, anywhere;
    /// then alphabetical (numbers in numeric order). Empty query = every served station alphabetically.
    public static func match(_ stops: [String: Stop], stopRoutes: [String: [String]], _ q: String, max: Int = 40) -> [Match] {
        let needle = q.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let qw = PlaceIndex.norm(needle).split(separator: " ").map(String.init)
        func words(_ n: String) -> Bool {
            let nw = PlaceIndex.norm(n).split(separator: " ")
            return !qw.isEmpty && qw.allSatisfy { w in nw.contains { $0.hasPrefix(w) } }
        }
        func rank(_ n: String) -> Int {
            if needle.isEmpty { return 0 }
            if n.hasPrefix(needle) { return 0 }
            if n.contains(" " + needle) { return 1 }
            return words(n) ? 2 : 3
        }
        var out: [(m: Match, r: Int)] = []
        for (id, s) in stops where !(stopRoutes[id] ?? []).isEmpty {
            let low = s.name.lowercased()
            guard needle.isEmpty || low.contains(needle) || words(s.name) else { continue }
            out.append((Match(id: id, name: s.name, coord: s.coord), rank(low)))
        }
        out.sort { a, b in
            if a.r != b.r { return a.r < b.r }
            let c = a.m.name.compare(b.m.name, options: [.numeric, .caseInsensitive], locale: Locale(identifier: "en_US"))
            return c != .orderedSame ? c == .orderedAscending : a.m.id < b.m.id
        }
        return Array(out.prefix(max).map(\.m))
    }

    /// Settings station search: case-insensitive, word-start first, served stations only, max 6.
    public static func settings(_ stops: [String: Stop], stopRoutes: [String: [String]], _ q: String) -> [Match] {
        let s = q.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !s.isEmpty else { return [] }
        var out: [(m: Match, r: Int)] = []
        for (id, st) in stops where !(stopRoutes[id] ?? []).isEmpty {
            let name = st.name.lowercased()
            guard let r = name.range(of: s) else { continue }
            let before = r.lowerBound == name.startIndex ? nil : name[name.index(before: r.lowerBound)]
            let wordStart = before == nil || !(before!.isLetter || before!.isNumber || before! == "_")
            out.append((Match(id: id, name: st.name, coord: st.coord), wordStart ? 0 : 1))
        }
        out.sort { a, b in
            if a.r != b.r { return a.r < b.r }
            let c = a.m.name.compare(b.m.name, locale: Locale(identifier: "en_US"))
            return c != .orderedSame ? c == .orderedAscending : a.m.id < b.m.id
        }
        return Array(out.prefix(6).map(\.m))
    }

    /// Served stops within `maxM` of a point, nearest first (pick.js stopsNear). `hidden` routes do not count.
    public static func near(_ S: StaticData, _ p: LatLon, maxM: Double = 1500, max: Int = 5, hidden: Set<String> = []) -> [Geo.NearStop] {
        guard p.isValid else { return [] }
        var out: [Geo.NearStop] = []
        for (id, s) in S.stops where s.coord.isValid {
            let rs = (S.stopRoutes[id] ?? []).filter { !hidden.contains($0) }
            if rs.isEmpty { continue }
            let d = Geo.hav(p, s.coord)
            if d <= maxM { out.append(Geo.NearStop(id: id, name: s.name, lat: s.lat, lon: s.lon, d: d)) }
        }
        out.sort { $0.d < $1.d || ($0.d == $1.d && $0.id < $1.id) }
        return Array(out.prefix(max))
    }
}

/// Route detail words (web ui/views/route.js busPositions).
public enum RouteText {
    public struct BusSpot: Hashable, Sendable {
        public var label: String
        /// Index (in the route's unique stop order) of the stop it heads to; `prev` the one before (nil at a line start).
        public var next: Int
        public var prev: Int?
        public var frac: Double
        public var stale: Bool
        public var seen: Double
        public var text: String
    }

    /// Ordered unique stop ids of a route (a loop's repeated last stop is dropped).
    public static func stopOrder(_ list: [String]?) -> [String] {
        var out: [String] = []
        for id in list ?? [] where !out.contains(id) { out.append(id) }
        return out
    }

    /// Where each live bus of a route is along the stop order, with a sentence for each.
    public static func busPositions(_ S: StaticData, buses: [VehiclePosition], rid: String, now: Double) -> [BusSpot] {
        let list = S.routeStops[rid] ?? [], ids = stopOrder(list)
        let loop = list.count > 2 && list.first == list.last
        func name(_ i: Int) -> String { S.stops[ids[i]]?.name ?? ids[i] }
        var out: [BusSpot] = []
        for b in buses where b.trip.routeId == rid {
            guard let sid = b.stopId, let next = ids.firstIndex(of: sid) else { continue }
            let prev: Int? = next > 0 ? next - 1 : loop && ids.count > 1 ? ids.count - 1 : nil
            var frac = 0.5
            if let pi = prev, let a = S.stops[ids[pi]], let n = S.stops[ids[next]], b.coord.isValid {
                let dp = Geo.hav(a.coord, b.coord), dn = Geo.hav(b.coord, n.coord)
                if dp + dn > 0 { frac = min(0.9, max(0.1, dp / (dp + dn))) }
            }
            let seen = b.timestamp, stale = seen != 0 && now - seen > 60
            let label = b.vehicle.label ?? b.vehicle.id ?? ""
            var text = "Bus \(label) " + (prev == nil ? "approaching \(name(next))" : "between \(name(prev!)) and \(name(next)), heading to \(name(next))")
            if stale { text += ", location from \(TimeFmt.ago(seen, from: now))" }
            out.append(BusSpot(label: label, next: next, prev: prev, frac: frac, stale: stale, seen: seen, text: text))
        }
        return out
    }

    /// Scheduled buses by hour: today's, else the first day with service ("Mondays"). nil = nothing worth a chart.
    public static func busesChart(_ svc: ServiceData, rid: String, now: Double) -> (when: String, list: [Schedule.HourCount])? {
        let today = Schedule.dayKey(now)
        var key = today, list = Schedule.busesByHour(svc, rid, today)
        if list.isEmpty {
            for k in Schedule.dayKeys {
                let l = Schedule.busesByHour(svc, rid, k)
                if !l.isEmpty { key = k; list = l; break }
            }
        }
        guard let first = list.first else { return nil }
        let maxN = list.map(\.buses).max() ?? 0
        if maxN <= 1 && list.allSatisfy({ $0.buses == first.buses }) { return nil }
        return (key == today ? "today" : (Schedule.dayName[key] ?? key) + "s", list)
    }

    /// "7 AM–9 AM: 3 buses · 9 AM–5 PM: 2 buses".
    public static func hoursText(_ list: [Schedule.HourCount]) -> String {
        Schedule.groupHours(list).map { "\(Schedule.hourLabel($0.from))\u{2013}\(Schedule.hourLabel($0.to)): \($0.buses) bus\($0.buses > 1 ? "es" : "")" }
            .joined(separator: " · ")
    }

    /// Today's hours note for a calendar exception: " (reduced schedule)" / " (schedule change)" / " (extra service)".
    public static func exceptionNote(_ h: Schedule.Hours) -> String {
        switch h.exception {
        case "removed"?: return h.first != nil ? " (reduced schedule)" : " (schedule change)"
        case "added"?: return " (extra service)"
        default: return ""
        }
    }
}

extension Custom {
    /// Default name for a new custom route: "My route N" not already used (routes.js defaultName).
    public static func defaultName(_ s: RouteState) -> String {
        let used = Set(s.customRoutes.map(\.name))
        var n = s.customRoutes.count + 1
        while used.contains("My route \(n)") { n += 1 }
        return "My route \(n)"
    }
}
