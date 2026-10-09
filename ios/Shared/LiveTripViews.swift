import SwiftUI
import StraightBussingKit

/// Live Activity building blocks, shared by the widget extension (real lock screen / Dynamic Island) and the
/// app (in-app preview screen, used for simulator screenshots).

/// Route badge in the route's color.
struct LiveRouteChip: View {
    let state: LiveTripSnapshot
    var compact = false
    var body: some View {
        Text(state.routeShort.isEmpty ? "Bus" : state.routeShort)
            .font(.system(size: compact ? 12 : 14, weight: .heavy, design: .rounded))
            .lineLimit(1)
            .padding(.horizontal, compact ? 5 : 7)
            .padding(.vertical, compact ? 2 : 3)
            .foregroundStyle(Color.textOn(hex: state.routeColor))
            .background(Color(hex: state.routeColor), in: RoundedRectangle(cornerRadius: compact ? 5 : 6))
            .accessibilityLabel("Route \(state.routeName)")
    }
}

/// Self-ticking countdown to `target` (no updates needed while the phone is locked).
struct LiveCountdown: View {
    let state: LiveTripSnapshot
    var font: Font = .system(size: 30, weight: .bold, design: .rounded)
    var body: some View {
        let now = Date()
        let target = Date(timeIntervalSince1970: state.target)
        if target > now {
            Text(timerInterval: now...target, countsDown: true, showsHours: false)
                .font(font).monospacedDigit().multilineTextAlignment(.trailing)
        } else {
            Text("Now").font(font)
        }
    }
}

/// Dynamic Island compact trailing: "3 stops 4:12" with a timer the system ticks itself, so the minutes never
/// freeze while the app is in the background (they used to be baked into the text at update time). Stale
/// content (no update for 120 s) is dimmed and marked "~", like stale times everywhere else in the app.
struct LiveCompactTrailing: View {
    let state: LiveTripSnapshot
    var isStale = false
    var body: some View {
        let now = Date()
        let target = Date(timeIntervalSince1970: state.target)
        HStack(spacing: 3) {
            if !state.compactPrefix.isEmpty { Text(state.compactPrefix) }
            if isStale { Text("~") }
            if target > now {
                Text(timerInterval: now...target, countsDown: true, showsHours: false)
                    .monospacedDigit()
                    .multilineTextAlignment(.trailing)
                    .frame(minWidth: 24, maxWidth: 40, alignment: .trailing)
            } else {
                Text("now")
            }
        }
        .font(.caption2.weight(.semibold))
        .lineLimit(1)
        .opacity(isStale ? 0.6 : 1)
        .accessibilityElement(children: .combine)
    }
}

/// The trip headline without frozen numbers: a time-based headline ("Next 53RD at Reynolds Club in about
/// 4 min") is shown as its words plus a self-ticking timer; stop-based headlines have no minutes and stay text.
struct LiveHeadline: View {
    let state: LiveTripSnapshot
    var isStale = false
    var body: some View {
        let now = Date()
        let target = Date(timeIntervalSince1970: state.target)
        if let lead = state.headlineLead {
            if target > now && !isStale {
                Text(verbatim: lead + " in ") + Text(timerInterval: now...target, countsDown: true, showsHours: false)
            } else {
                Text(lead)
            }
        } else {
            Text(state.headline)
        }
    }
}

/// The next stops as dots on a line with the bus between them (Google-Maps-style, horizontal).
struct TripProgressBar: View {
    let state: LiveTripSnapshot
    var showNames = true
    var body: some View {
        let n = max(2, state.stopNames.count)
        let color = Color(hex: state.routeColor)
        VStack(spacing: 4) {
            GeometryReader { geo in
                let w = geo.size.width, step = w / CGFloat(n - 1)
                ZStack(alignment: .leading) {
                    Capsule().fill(color.opacity(0.35)).frame(height: 4)
                    if let p = state.busPosition {
                        Capsule().fill(color).frame(width: max(0, min(w, CGFloat(p) * step)), height: 4)
                    }
                    ForEach(0..<state.stopNames.count, id: \.self) { i in
                        let key = i == state.boardIndex || i == state.alightIndex
                        Circle()
                            .fill(key ? color : Color.white)
                            .overlay(Circle().stroke(color, lineWidth: 2))
                            .frame(width: key ? 11 : 8, height: key ? 11 : 8)
                            .position(x: CGFloat(i) * step, y: geo.size.height / 2)
                    }
                    if let p = state.busPosition {
                        Image(systemName: "bus.fill")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(Color.textOn(hex: state.routeColor))
                            .padding(4)
                            .background(color, in: Circle())
                            .overlay(Circle().stroke(.white, lineWidth: 1.5))
                            .position(x: max(0, min(w, CGFloat(p) * step)), y: geo.size.height / 2)
                    }
                }
            }
            .frame(height: 22)
            if showNames, let first = state.stopNames.first, let last = state.stopNames.last {
                HStack {
                    Text(first).lineLimit(1)
                    Spacer(minLength: 8)
                    Text(last).lineLimit(1)
                }
                .font(.caption2)
                .foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Self.spoken(state))
    }

    static func spoken(_ s: LiveTripSnapshot) -> String {
        var t = "\(s.routeName). "
        if let a = s.stopsAway { t += a == 0 ? "Bus arriving at \(s.boardName). " : "Bus \(a) stops from \(s.boardName). " }
        if let l = s.stopsLeft { t += l == 0 ? "Get off at the next stop, \(s.alightName). " : "\(l) stops to \(s.alightName). " }
        return t + "Times are estimates."
    }
}

/// Lock Screen / banner presentation of the trip.
struct LiveTripLockScreenView: View {
    let title: String
    let state: LiveTripSnapshot
    var isStale = false
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                LiveRouteChip(state: state)
                VStack(alignment: .leading, spacing: 1) {
                    Text(title).font(.subheadline.weight(.semibold)).lineLimit(1)
                    LiveHeadline(state: state, isStale: isStale).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer(minLength: 4)
                LiveCountdown(state: state)
            }
            TripProgressBar(state: state)
            HStack(spacing: 4) {
                Text(isStale ? "Data delayed · times may be off" : "est. · \(state.live ? "live" : "schedule") · as of \(Self.clock(state.asOf))")
                Spacer()
                Text("Unofficial")
            }
            .font(.caption2)
            .foregroundStyle(isStale ? Color.orange : Color.secondary)
        }
        .opacity(isStale ? 0.75 : 1)
    }

    /// "4:12 PM" through the Kit's cached formatter (no DateFormatter allocation per render).
    static func clock(_ t: Double) -> String { TimeFmt.clock(t) }
}
