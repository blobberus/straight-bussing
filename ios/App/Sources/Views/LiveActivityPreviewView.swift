import SwiftUI
import StraightBussingKit

/// In-app preview of the trip Live Activity (Lock Screen, Dynamic Island compact / expanded / minimal),
/// rendered with the same views as the widget extension. Used for simulator screenshots, where the real
/// Lock Screen cannot be captured.
struct LiveActivityPreviewView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var startTries = 0

    var snapshot: LiveTripSnapshot? {
        if let p = model.tripFollow { return p.snapshot(staticData: model.staticData, now: model.now) }
        return nil
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let s = snapshot, model.config.screen?.hasPrefix("livestates") == true {
                    LiveActivityStatesView(state: s, title: "To \(model.activeTrip?.label ?? "destination")")
                } else if let s = snapshot {
                    let title = "To \(model.activeTrip?.label ?? "destination")"
                    label("Lock Screen")
                    // a flat dark stand-in for the wallpaper (the system draws the real one); the frame radii here
                    // copy the system's Lock Screen card and Dynamic Island, not the app's radius scale
                    LiveTripLockScreenView(title: title, state: s, simulated: model.simulating)
                        .padding(14)
                        .environment(\.colorScheme, .dark)
                        .foregroundStyle(.white)
                        .background(Self.wallpaper, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                        .accessibilityIdentifier("liveActivityLockScreen")
                    label("Dynamic Island · compact")
                    HStack {
                        Spacer()
                        HStack(spacing: 8) {
                            LiveRouteChip(state: s, compact: true)
                            Spacer(minLength: 60)
                            LiveCompactTrailing(state: s).foregroundStyle(.white)
                        }
                        .padding(.horizontal, 12)
                        .frame(width: 300, height: 36)
                        .background(.black, in: Capsule())
                        Spacer()
                    }
                    label("Dynamic Island · expanded")
                    VStack(spacing: 8) {
                        HStack {
                            LiveRouteChip(state: s)
                            Spacer()
                            Text("\(s.boardName) → \(s.alightName)").font(.caption.weight(.semibold)).lineLimit(1)
                            Spacer()
                            LiveETA(state: s, mainFont: .system(size: 22, weight: .bold, design: .rounded), maxWidth: 96)
                        }
                        TripProgressBar(state: s)
                        HStack {
                            LiveHeadline(state: s).lineLimit(1)
                            Spacer()
                            Text(model.simulating ? "Simulated (demo)" : "est. · Unofficial")
                        }
                        .font(.caption2)
                        .foregroundStyle(Palette.text2)
                    }
                    .padding(16)
                    .environment(\.colorScheme, .dark)
                    .foregroundStyle(.white)
                    .background(.black, in: RoundedRectangle(cornerRadius: 40))
                    label("Dynamic Island · minimal")
                    Circle().fill(Color(hex: s.routeColor)).frame(width: 14, height: 14)
                        .frame(width: 36, height: 36).background(.black, in: Circle())
                    if model.liveActivity.isSupported {
                        let _ = startTries   // the controller is not observable: a tap re-reads isRunning
                        if model.liveActivity.isRunning {
                            Label("Live Activity running on the Lock Screen", systemImage: "checkmark.circle.fill")
                                .font(.subheadline.weight(.semibold)).foregroundStyle(Palette.text2)
                                .frame(minHeight: 44)
                        } else {
                            Button("Start Live Activity") {
                                model.liveActivity.start(title: title, state: s, simulated: model.simulating)
                                startTries += 1
                            }
                            .primaryButtonStyle()
                            if startTries > 0 {
                                Text("iOS did not start it. Try again in a moment.").font(.caption).foregroundStyle(Palette.text2)
                            }
                        }
                    } else {
                        Text("Live Activities are off for Straight Bussing in iOS Settings.").font(.subheadline).foregroundStyle(Palette.text2)
                    }
                    Text(Self.footnote)
                        .font(.caption).foregroundStyle(Palette.text2)
                } else {
                    EmptyStateView(title: "No trip started", message: "Plan a trip in Directions and tap Start to see its Live Activity.")
                }
            }
            .padding(16)
        }
        // `-screen livestatesend` (CI): the same states scrolled to the end, so the stale card is in the picture too
        .defaultScrollAnchor(model.config.screen == "livestatesend" ? .bottom : .top)
        .background(Palette.sheet)
        .tint(Palette.accent)
        .navigationTitle("Live Activity")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
        }
    }

    static let wallpaper = Color(red: 0.16, green: 0.17, blue: 0.22)

    /// How the times behave while the app is not running (they are whole minutes everywhere, never seconds).
    static var footnote: String {
        let minutes: String
        if #available(iOS 18.0, *) {
            minutes = "The minutes count down on their own."
        } else {
            minutes = "The arrival time is shown with the minutes as of the last update."
        }
        return "Times are estimates in whole minutes. " + minutes
            + " Stops away updates while the app is open (push updates need the server); 2 minutes after the last update it says the data is delayed."
    }

    func label(_ s: String) -> some View {
        Text(s).font(.footnote.weight(.semibold)).foregroundStyle(Palette.text2).textCase(.uppercase)
    }
}

/// CI only (`-screen livestates`): the Lock Screen card and the compact Dynamic Island in each arrival state, so the
/// iOS 17 layout and the stale / last-minute redraws can be checked on the CI's iOS 26 simulator. Not reachable in
/// the app. The format line checks the minute rounding of the iOS 18 self-updating text.
struct LiveActivityStatesView: View {
    let state: LiveTripSnapshot
    let title: String

    var body: some View {
        let now = Date().timeIntervalSince1970
        let far = Self.moved(state, target: now + 272, asOf: now)
        let due = Self.moved(state, target: now + 40, asOf: now)
        VStack(alignment: .leading, spacing: 12) {
            if #available(iOS 18.0, *) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(Self.formatSamples(now: now))
                    HStack(spacing: 4) {
                        Text("Self-updating, 272 s left:")
                        LiveMinutes(target: now + 272)
                    }
                }
                .font(.caption).monospacedDigit().foregroundStyle(Palette.text2)
            }
            row("iOS 18 and later: minutes the system counts down", far, .countdown, stale: false)
            row("iOS 17: the arrival time, minutes as of the last update", far, .clockAsOf, stale: false)
            row("Last minute (both)", due, .due, stale: false)
            row("No update for 2 minutes (both)", far, .staleClock, stale: true)
        }
    }

    static func moved(_ s: LiveTripSnapshot, target: Double, asOf: Double) -> LiveTripSnapshot {
        var c = s
        c.target = target
        c.asOf = asOf
        return c
    }

    /// The iOS 18 minute text at a few remaining times ("272 s = 4 min, ..."): floored, never seconds.
    @available(iOS 18.0, *)
    static func formatSamples(now: Double) -> String {
        let f = Date.ComponentsFormatStyle(style: .abbreviated, locale: .autoupdatingCurrent, calendar: .autoupdatingCurrent, fields: [.minute])
        let start = Date(timeIntervalSince1970: now)
        return "Format: " + [272.0, 119, 61, 59, 0].map { s in
            "\(Int(s)) s = " + f.format(start..<start.addingTimeInterval(s))
        }.joined(separator: ", ")
    }

    func row(_ label: String, _ s: LiveTripSnapshot, _ mode: LiveETAMode, stale: Bool) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.footnote.weight(.semibold)).foregroundStyle(Palette.text2)
            LiveTripLockScreenView(title: title, state: s, isStale: stale, mode: mode)
                .padding(12)
                .environment(\.colorScheme, .dark)
                .foregroundStyle(.white)
                .background(LiveActivityPreviewView.wallpaper, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            HStack(spacing: 8) {
                LiveRouteChip(state: s, compact: true)
                Spacer(minLength: 40)
                LiveCompactTrailing(state: s, isStale: stale, mode: mode).foregroundStyle(.white)
            }
            .padding(.horizontal, 12)
            .frame(width: 250, height: 32)
            .background(.black, in: Capsule())
        }
    }
}
