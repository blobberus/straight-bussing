import Foundation

/// Words of the Current trip timeline (web ui/views/tripprogress.js), pure so they are unit-tested and the same
/// on both platforms. Every time is labeled as an estimate somewhere on screen; the bus position is always written
/// out (never only drawn).
public enum TripText {
    static func plural(_ n: Int, _ w: String) -> String { "\(n) \(w)\(n == 1 ? "" : "s")" }

    /// "Bus 101" / "The bus".
    public static func busName(_ v: TripFollow.Vehicle?) -> String {
        guard let v, !v.label.isEmpty else { return "The bus" }
        return "Bus \(v.label)"
    }

    /// "4 min" / "Now" (with "~" while live data is delayed), like the route detail timeline.
    public static func etaText(_ t: Double?, now: Double, late: Bool) -> String {
        guard let t, t != 0 else { return "" }
        let m = TimeFmt.minsUntil(t, from: now)
        return m < 1 ? "Now" : (late ? "~" : "") + "\(m) min"
    }

    /// "now" / "in 4 minutes".
    public static func inMin(_ t: Double, now: Double) -> String {
        let m = TimeFmt.minsUntil(t, from: now)
        return m < 1 ? "now" : "in \(plural(m, "minute"))"
    }

    /// Where the followed bus is, in words ("Bus 101 is 3 stops away", "Bus 101 is between A and B").
    public static func busWords(_ leg: TripFollow.BusStep, now: Double) -> (status: String, location: String) {
        guard let v = leg.vehicle else { return ("", "") }
        let who = busName(v), b = leg.boardName, a = leg.alightName
        var status = ""
        if let s = leg.stopsAway {
            status = s == 0 ? (v.at ? "\(who) is at \(b)" : "\(who) is approaching \(b)") : "\(who) is \(plural(s, "stop")) away"
        } else if let l = leg.stopsLeft {
            status = l == 0 ? "Get off here: \(a)" : l == 1 ? "Get off at the next stop: \(a)" : "\(plural(l, "stop")) to \(a)"
        }
        var whereText = v.at ? "\(who) is at \(v.nextName)"
            : v.prevName.map { "\(who) is between \($0) and \(v.nextName)" } ?? "\(who) is heading to \(v.nextName)"
        if v.stale && v.seen != 0 { whereText += ", location from \(TimeFmt.ago(v.seen, from: now))" }
        return (status, whereText)
    }

    /// The one-glance status card for the current phase.
    public struct NowCard: Hashable, Sendable {
        public enum Icon: Hashable, Sendable { case walk, route(String), pin }
        public var icon: Icon
        public var prim: String
        public var sec: [String]
        /// The big ETA on the right (boarding, or alighting while on the bus).
        public var eta: Double?
        /// The ETA is not live (shown with "~").
        public var etaApprox: Bool
    }

    public static func nowCard(_ p: TripFollow, routes: [String: Route], now: Double) -> NowCard {
        let late = p.stale != .fresh
        if p.phase == .arrived {
            let fin = p.legs.indices.contains(p.active) ? p.legs[p.active].walk : nil
            let prim = fin.map { "Walk \(TripInfo.walkMins($0.min)) min to \(p.to)" } ?? "You have arrived at \(p.to)"
            return NowCard(icon: .pin, prim: prim, sec: p.arriveT.map { ["Arrive about \(TimeFmt.clock($0)), est."] } ?? [], eta: nil, etaApprox: false)
        }
        guard let leg = p.legs.indices.contains(p.active) ? p.legs[p.active].bus : nil else {
            return NowCard(icon: .pin, prim: "Trip to \(p.to)", sec: [], eta: nil, etaApprox: false)
        }
        let w = busWords(leg, now: now)
        let short = routes[leg.rid]?.short ?? ""
        var icon: NowCard.Icon = .route(leg.rid), prim = "", sec: [String] = []
        switch p.phase {
        case .walkToStop:
            icon = .walk
            prim = "Walk \(TripInfo.walkMins(leg.walkMin)) min to \(leg.boardName)"
            if let b = leg.boardEta { sec.append(TripInfo.catchNote(b, walkMin: leg.walkMin ?? 0, now: now).text) }
            if !w.status.isEmpty { sec.append(w.status) }
            else if let b = leg.boardEta {
                sec.append("\(short.isEmpty ? "Bus" : short) \(leg.boardLive ? "arrives" : "planned") \(inMin(b, now: now))\(leg.boardLive ? "" : ", est.")")
            } else { sec.append("No live bus time yet") }
        case .waiting:
            prim = !w.status.isEmpty ? w.status : leg.boardEta.map { leg.boardLive ? "Next bus" : "Bus planned for \(TimeFmt.clock($0))" } ?? "Waiting for the bus"
            sec.append("Board at \(leg.boardName)\(leg.boardEta.map { " " + inMin($0, now: now) } ?? "")\(leg.boardLive ? "" : leg.boardEta != nil ? ", est." : "")")
            if leg.missed { sec.append("Your planned bus has left. Showing the next one.") }
        default:
            prim = !w.status.isEmpty ? w.status : "Riding to \(leg.alightName)"
            sec.append("Get off at \(leg.alightName)\(leg.alightEta.map { " about \(TimeFmt.clock($0))\(leg.alightLive ? "" : ", est.")" } ?? "")")
        }
        if !leg.live { sec.append(leg.byTime ? "No live bus data: following the plan's times (estimate)." : "No live bus position right now.") }
        let onBus = p.phase == .onBus
        let t = onBus ? leg.alightEta : leg.boardEta
        let live = onBus ? leg.alightLive : leg.boardLive
        return NowCard(icon: icon, prim: prim, sec: sec, eta: t, etaApprox: late || !live)
    }

    /// Walk row of the timeline: head + optional sub line.
    public static func walkRow(_ p: TripFollow, _ i: Int, now: Double) -> (head: String, sub: String) {
        guard let l = p.legs[i].walk else { return ("", "") }
        let next = i + 1 < p.legs.count ? p.legs[i + 1].bus : nil
        let prev = i > 0 ? p.legs[i - 1].bus : nil
        let change = prev != nil && next != nil
        let m = l.state == .active && l.minNow != nil ? l.minNow! : l.min
        let head = l.state == .done ? "Walked to \(l.toName)" : "Walk \(TripInfo.walkMins(m)) min to \(l.toName)\(change ? " to change" : "")"
        var sub = ""
        if l.state == .active, let n = next, let b = n.boardEta { sub = TripInfo.catchNote(b, walkMin: m, now: now).text }
        else if l.state != .done { sub = "Walking time, est." }
        return (head, sub)
    }

    /// Bus leg head: "3 stops · ~5 min ride, est." and where the bus is.
    public static func busMeta(_ leg: TripFollow.BusStep) -> [String] {
        var meta = [plural(max(1, leg.alightIdx - leg.boardIdx), "stop")]
        if let r = leg.rideMin, r > 0 { meta.append("~\(max(1, Int(JS.round(r)))) min ride, est.") }
        return meta
    }

    public static func whereLine(_ leg: TripFollow.BusStep, now: Double) -> String {
        if leg.state == .active {
            if leg.vehicle != nil { return busWords(leg, now: now).location }
            return leg.live ? "" : "No live position for this bus"
        }
        if leg.state == .upcoming, let b = leg.boardEta {
            return "Next bus \(leg.boardLive ? "at" : "planned") \(TimeFmt.clock(b))\(leg.boardLive ? "" : ", est.")"
        }
        return ""
    }

    /// The stops a leg shows: a finished leg shows only its boarding and alighting stop.
    public static func shownStops(_ leg: TripFollow.BusStep) -> (stops: [TripFollow.StopRow], boardIdx: Int, alightIdx: Int) {
        if leg.state == .done && leg.stops.count > 2 && leg.stops.indices.contains(leg.alightIdx) {
            return ([leg.stops[leg.boardIdx], leg.stops[leg.alightIdx]], 0, 1)
        }
        return (leg.stops, leg.boardIdx, leg.alightIdx)
    }

    /// Label above the first stop while the bus is still before it: the stop it just left (passed) or
    /// "2 more stops before X" / "Bus 101 is starting its trip". nil when nothing is shown.
    public static func leadRow(_ leg: TripFollow.BusStep) -> (text: String, passed: Bool)? {
        let s = shownStops(leg).stops
        guard leg.state == .active, let v = leg.vehicle, v.idx < s.count, !s.isEmpty else { return nil }
        guard v.idx < 0 || (v.idx == 0 && !v.at) else { return nil }
        if v.idx == 0, let prev = v.prevName { return (prev, true) }
        return (v.idx < 0 ? "\(plural(v.behind, "more stop")) before \(s[0].name)" : "\(busName(v)) is starting its trip", false)
    }

    /// ETA text of a stop row ("Passed", "4 min", "~4:12 PM" planned) and whether it is a planned estimate.
    public static func stopEta(_ s: TripFollow.StopRow, _ leg: TripFollow.BusStep, now: Double, late: Bool) -> (text: String, est: Bool) {
        if s.state == .passed { return ("Passed", false) }
        if s.eta != nil { return (etaText(s.eta, now: now, late: late), false) }
        if s.role == .board, let b = leg.boardEta, !leg.boardLive { return ("~" + TimeFmt.clock(b), true) }
        if s.role == .alight, let a = leg.alightEta, !leg.alightLive { return ("~" + TimeFmt.clock(a), true) }
        return ("", false)
    }

    /// The bus pill on a stop row ("Bus 101 heading here" / "is here"), nil when the bus is not there.
    public static func busPill(_ s: TripFollow.StopRow, k: Int, _ leg: TripFollow.BusStep) -> String? {
        let shown = shownStops(leg).stops
        guard leg.state == .active, let v = leg.vehicle, v.idx < shown.count, v.idx == k,
              s.state == .current || s.state == .next else { return nil }
        return "\(busName(v)) \(s.state == .current ? "is here" : "heading here")"
    }

    /// VoiceOver label of a stop row.
    public static func stopSay(_ s: TripFollow.StopRow, k: Int, _ leg: TripFollow.BusStep, now: Double, late: Bool) -> String {
        let showV = leg.state == .active && leg.vehicle != nil && (leg.vehicle!.idx < shownStops(leg).stops.count)
        let passed = s.state == .passed
        var parts = [s.name]
        if s.role == .board { parts.append("board here") } else if s.role == .alight { parts.append("get off here") }
        if passed { parts.append("the bus has passed this stop") }
        else if s.state == .current && showV { parts.append("the bus is at this stop") }
        else if s.state == .next && showV { parts.append("the bus is heading here") }
        let e = stopEta(s, leg, now: now, late: late)
        if let t = s.eta, !passed { parts.append("bus \(inMin(t, now: now))\(late ? ", data delayed" : "")") }
        else if e.est, let t = s.role == .board ? leg.boardEta : leg.alightEta { parts.append("planned about \(TimeFmt.clock(t)), estimate") }
        return parts.joined(separator: ", ")
    }

    /// Header line: "Arrive about 4:12 PM · 15 min" (est. tag shown next to it).
    public static func arriveLine(_ p: TripFollow, now: Double) -> String {
        guard let a = p.arriveT else { return "Arrival time unknown" }
        let left = max(0, Int(JS.round((a - now) / 60)))
        return "Arrive about \(TimeFmt.clock(a))" + (p.phase != .arrived ? " · " + (left < 1 ? "under a minute" : "\(left) min") : "")
    }

    /// Honesty footnote under the timeline.
    public static func footnote(_ p: TripFollow) -> String {
        let cur = p.legs.indices.contains(p.active) ? p.legs[p.active].bus : nil
        let live = cur?.live ?? p.live
        return (live ? "Bus position and stop times are live predictions and can change." : "No live data for this bus right now: times come from the trip plan.")
            + " Every time here is an estimate."
    }

    /// Short headline for the Lock Screen / Dynamic Island and whether it is time-based (`lead` = its words without
    /// the minutes, so the Live Activity adds a self-ticking timer).
    public static func liveHeadline(_ p: TripFollow, routes: [String: Route], now: Double) -> (text: String, lead: String?) {
        if p.phase == .arrived {
            if let fin = p.legs.last?.walk, fin.state == .active { return ("Walk \(TripInfo.walkMins(fin.min)) min to \(p.to)", nil) }
            return ("You have arrived", nil)
        }
        guard let leg = p.currentBus else { return ("Trip to \(p.to)", nil) }
        let w = busWords(leg, now: now)
        if !w.status.isEmpty { return (w.status, nil) }
        if p.phase == .onBus { return ("Riding to \(leg.alightName)", nil) }
        let route = routes[leg.rid]?.chipText ?? leg.rid
        if let b = leg.boardEta {
            let lead = "Next \(route) at \(leg.boardName)"
            return ("\(lead) in about \(max(0, TimeFmt.minsUntil(b, from: now))) min", lead)
        }
        return ("Waiting for the bus", nil)
    }
}

extension TripFollow {
    /// The Live Activity content (nil when the trip has no bus leg). Same followed bus and words as the timeline.
    public func snapshot(staticData: StaticData, now: Double) -> LiveTripSnapshot? {
        guard let leg = currentBus else { return nil }
        let r = staticData.routes[leg.rid]
        let target: Double
        switch phase {
        case .walkToStop, .waiting: target = leg.boardEta ?? arriveT ?? now
        case .onBus: target = leg.alightEta ?? arriveT ?? now
        case .arrived: target = arriveT ?? now
        }
        let shown = TripText.shownStops(leg)
        let rows = shown.stops
        let v = leg.state == .active ? leg.vehicle : nil
        let busIdx: Int? = v.flatMap { $0.idx < rows.count ? max(0, $0.idx) : nil }
        let anchor = busIdx ?? shown.boardIdx
        let start = max(0, min(anchor - 1, rows.count - 6))
        let end = min(rows.count, start + 6)
        let window = start < end ? Array(rows[start..<end]) : []
        var pos: Double? = nil
        if let v, v.idx < rows.count { pos = max(-0.5, (v.idx < 0 ? -0.5 : v.pos) - Double(start)) }
        func idx(_ i: Int) -> Int? { i >= start && i < end ? i - start : nil }
        let h = TripText.liveHeadline(self, routes: staticData.routes, now: now)
        return LiveTripSnapshot(routeShort: r?.chipText ?? leg.rid, routeName: r?.displayName ?? leg.rid,
                                routeColor: r?.color ?? "#555555", routeTextColor: r?.textColor ?? "#FFFFFF",
                                boardName: leg.boardName, alightName: leg.alightName, phase: phase.rawValue, headline: h.text,
                                stopsAway: leg.stopsAway, stopsLeft: leg.stopsLeft, target: target,
                                stopNames: window.map { LiveTripSnapshot.shortName($0.name) }, busPosition: pos,
                                boardIndex: idx(shown.boardIdx), alightIndex: idx(shown.alightIdx), live: leg.live, asOf: now,
                                headlineLead: h.lead)
    }
}
