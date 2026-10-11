import SwiftUI
import StraightBussingKit

/// Live Activity building blocks, shared by the widget extension (real lock screen / Dynamic Island) and the
/// app (in-app preview screen, used for simulator screenshots).
///
/// Times are whole minutes, never seconds (ship checklist item 2: no invented precision), and must stay right
/// while the app is not running: nothing updates the activity then (local updates, `pushType: nil`). So the
/// system draws it only at each update and once more at its stale date (Kit `LiveTripSnapshot.staleDate`: 120 s
/// after the data, or when the arrival enters its last minute), and everything in between either counts by itself
/// (iOS 18+) or is said "as of" the last update (iOS 17).

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

/// What the arrival shows when the system draws the activity (`now` = that moment).
enum LiveETAMode: Equatable {
    /// Under a minute: "Now" ("~Now" when stale), the clock under it.
    case due
    /// No update for 120 s: "~6:37 PM", no minutes (never a count on old data).
    case staleClock
    /// iOS 18+: whole minutes the system counts down itself ("4 min"), the clock under it.
    case countdown
    /// iOS 17 (no minute-precision self-updating text): the clock as the main value, "4 min as of 6:33 PM" under it.
    case clockAsOf

    static func of(_ s: LiveTripSnapshot, isStale: Bool, now: Double = Date().timeIntervalSince1970) -> LiveETAMode {
        if s.isDue(now: now) { return .due }
        if isStale { return .staleClock }
        if #available(iOS 18.0, *) { return .countdown }
        return .clockAsOf
    }
}

/// Whole minutes to `target` that the system keeps current by itself (iOS 18 `TimeDataSource`): "4 min", floored
/// like every ETA in the app (`Date.ComponentsFormatStyle` with the minute field only: never seconds). The range
/// ends at the target, so it never counts below "0 min"; the redraw at the stale date says "Now" before that.
@available(iOS 18.0, *)
struct LiveMinutes: View {
    let target: Double
    var body: some View {
        Text(TimeDataSource<Range<Date>>.dateRange(endingAt: Date(timeIntervalSince1970: target)),
             format: Date.ComponentsFormatStyle(style: .abbreviated, locale: .autoupdatingCurrent, calendar: .autoupdatingCurrent, fields: [.minute]))
    }
}

/// The arrival, right-aligned: main value + one small line (see `LiveETAMode`).
struct LiveETA: View {
    let state: LiveTripSnapshot
    var isStale = false
    var mainFont: Font = .system(size: 30, weight: .bold, design: .rounded)
    var maxWidth: CGFloat = 130
    /// nil = decided when drawn; set only by the CI states screen (LiveActivityStatesView).
    var mode: LiveETAMode? = nil
    var body: some View {
        let mode = self.mode ?? LiveETAMode.of(state, isStale: isStale)
        VStack(alignment: .trailing, spacing: 1) {
            Group {
                switch mode {
                case .due: Text((isStale ? "~" : "") + "Now")
                case .staleClock: Text("~" + state.clock)
                case .countdown:
                    if #available(iOS 18.0, *) { LiveMinutes(target: state.target) } else { Text(state.clock) }
                case .clockAsOf: Text(state.clock)
                }
            }
            .font(mainFont)
            .monospacedDigit()
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .multilineTextAlignment(.trailing)
            .frame(maxWidth: maxWidth, alignment: .trailing)
            switch mode {
            case .due, .countdown: Text(state.clock).font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
            case .clockAsOf: Text(state.minutesAsOfText).font(.caption2).foregroundStyle(.secondary)
            case .staleClock: EmptyView()
            }
        }
        .lineLimit(1)
        .accessibilityElement(children: .combine)
    }
}

/// Dynamic Island compact trailing: "3 stops 4 min" (iOS 18: minutes the system counts down; the stop count is
/// the last update's), "6:37 PM" on iOS 17, "Now" under a minute, "~6:37 PM" when stale (dimmed). Never seconds.
struct LiveCompactTrailing: View {
    let state: LiveTripSnapshot
    var isStale = false
    var mode: LiveETAMode? = nil
    var body: some View {
        let mode = self.mode ?? LiveETAMode.of(state, isStale: isStale)
        HStack(spacing: 3) {
            switch mode {
            case .due: Text((isStale ? "~" : "") + "Now")
            case .staleClock: Text("~" + state.clock)
            case .countdown:
                if !state.compactPrefix.isEmpty { Text(state.compactPrefix) }
                if #available(iOS 18.0, *) {
                    LiveMinutes(target: state.target)
                        .multilineTextAlignment(.trailing)
                        .frame(maxWidth: 46, alignment: .trailing)
                }
            case .clockAsOf: Text(state.clock)
            }
        }
        .font(.caption2.weight(.semibold))
        .monospacedDigit()
        .lineLimit(1)
        .opacity(isStale ? 0.6 : 1)
        .accessibilityElement(children: .combine)
    }
}

/// The trip headline without numbers that would freeze: a time-based headline ("Next 53RD at Reynolds Club in about
/// 4 min") is shown as its words only ("Next 53RD at Reynolds Club"), since the arrival sits right next to it; stop-
/// based headlines ("Bus 101 is 3 stops away") stay as they are.
struct LiveHeadline: View {
    let state: LiveTripSnapshot
    var body: some View { Text(state.headlineLead ?? state.headline) }
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

/// The footer line of the Lock Screen card and the expanded Dynamic Island: what the times rest on.
enum LiveFooter {
    /// "est. from live data · as of 6:33 PM" (one middle dot); the "as of" moves to the minutes on iOS 17
    /// ("4 min as of 6:33 PM"), so it is not said twice.
    static func text(_ s: LiveTripSnapshot, isStale: Bool, simulated: Bool, mode: LiveETAMode? = nil) -> String {
        if simulated { return "Simulated buses (demo), not real" }
        if isStale { return "Data delayed, times may be off" }
        let source = "est. from \(s.live ? "live data" : "the schedule")"
        return (mode ?? LiveETAMode.of(s, isStale: isStale)) == .clockAsOf ? source : source + " · as of " + TimeFmt.clock(s.asOf)
    }
}

/// Lock Screen / banner presentation of the trip.
struct LiveTripLockScreenView: View {
    let title: String
    let state: LiveTripSnapshot
    var isStale = false
    /// A simulated bus (Settings > Simulated buses): said instead of the live-data source.
    var simulated = false
    var mode: LiveETAMode? = nil
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 8) {
                LiveRouteChip(state: state)
                VStack(alignment: .leading, spacing: 1) {
                    Text(title).font(.subheadline.weight(.semibold)).lineLimit(1)
                    LiveHeadline(state: state).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                }
                Spacer(minLength: 4)
                LiveETA(state: state, isStale: isStale, mode: mode)
            }
            TripProgressBar(state: state)
            HStack(spacing: 4) {
                Text(LiveFooter.text(state, isStale: isStale, simulated: simulated, mode: mode))
                Spacer()
                Text("Unofficial")
            }
            .font(.caption2.weight(simulated ? .bold : .regular))
            .foregroundStyle(simulated || isStale ? Palette.warn : Color.secondary)
        }
        .opacity(isStale ? 0.75 : 1)
    }
}
