import SwiftUI
import StraightBussingKit

/// In-app preview of the trip Live Activity (Lock Screen, Dynamic Island compact / expanded / minimal),
/// rendered with the same views as the widget extension. Used for simulator screenshots, where the real
/// Lock Screen cannot be captured.
struct LiveActivityPreviewView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    var snapshot: LiveTripSnapshot? {
        if let p = model.tripFollow { return p.snapshot(staticData: model.staticData, now: model.now) }
        return nil
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                DemoBanner()
                if let s = snapshot {
                    let title = "To \(model.activeTrip?.label ?? "destination")"
                    label("Lock Screen")
                    // a flat dark stand-in for the wallpaper (the system draws the real one); the frame radii here
                    // copy the system's Lock Screen card and Dynamic Island, not the app's radius scale
                    LiveTripLockScreenView(title: title, state: s, simulated: model.feedSimulated)
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
                            LiveCountdown(state: s, font: .system(size: 22, weight: .bold, design: .rounded))
                        }
                        TripProgressBar(state: s)
                        HStack {
                            LiveHeadline(state: s).lineLimit(1)
                            Spacer()
                            Text(model.feedSimulated ? "Simulated (demo)" : "est. · Unofficial")
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
                        if model.liveActivity.isRunning {
                            Label("Live Activity running on the Lock Screen", systemImage: "checkmark.circle.fill")
                                .font(.subheadline.weight(.semibold)).foregroundStyle(Palette.text2)
                                .frame(minHeight: 44)
                        } else {
                            Button("Start Live Activity") {
                                model.liveActivity.start(title: title, state: s, simulated: model.feedSimulated)
                            }
                            .primaryButtonStyle()
                        }
                    }
                    Text("Times are estimates. The countdown ticks on its own; stops away updates while the app is open (push updates need the server).")
                        .font(.caption).foregroundStyle(Palette.text2)
                } else {
                    EmptyStateView(title: "No trip started", message: "Plan a trip in Directions and tap Start to see its Live Activity.")
                }
            }
            .padding(16)
        }
        .background(Palette.sheet)
        .tint(Palette.accent)
        .navigationTitle("Live Activity")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
        }
    }

    static let wallpaper = Color(red: 0.16, green: 0.17, blue: 0.22)

    func label(_ s: String) -> some View {
        Text(s).font(.footnote.weight(.semibold)).foregroundStyle(Palette.text2).textCase(.uppercase)
    }
}
