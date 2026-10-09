import SwiftUI
import StraightBussingKit

/// In-app preview of the trip Live Activity (Lock Screen, Dynamic Island compact / expanded / minimal),
/// rendered with the same views as the widget extension. Used for simulator screenshots, where the real
/// Lock Screen cannot be captured.
struct LiveActivityPreviewView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    var snapshot: LiveTripSnapshot? {
        if let p = model.tripProgress { return p.snapshot(staticData: model.staticData) }
        return nil
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let s = snapshot {
                    let title = "To \(model.activeTrip?.label ?? "destination")"
                    label("Lock Screen")
                    LiveTripLockScreenView(title: title, state: s)
                        .padding(14)
                        .environment(\.colorScheme, .dark)
                        .foregroundStyle(.white)
                        .background(
                            LinearGradient(colors: [Color(red: 0.15, green: 0.18, blue: 0.32), Color(red: 0.32, green: 0.18, blue: 0.36)],
                                           startPoint: .topLeading, endPoint: .bottomTrailing),
                            in: RoundedRectangle(cornerRadius: 22))
                        .accessibilityIdentifier("liveActivityLockScreen")
                    label("Dynamic Island · compact")
                    HStack {
                        Spacer()
                        HStack(spacing: 8) {
                            LiveRouteChip(state: s, compact: true)
                            Spacer(minLength: 60)
                            Text(s.compactText(now: model.now)).font(.caption2.weight(.semibold)).monospacedDigit().foregroundStyle(.white)
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
                            Text(s.headline).lineLimit(1)
                            Spacer()
                            Text("est. · Unofficial")
                        }
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    }
                    .padding(16)
                    .environment(\.colorScheme, .dark)
                    .foregroundStyle(.white)
                    .background(.black, in: RoundedRectangle(cornerRadius: 40))
                    label("Dynamic Island · minimal")
                    Circle().fill(Color(hex: s.routeColor)).frame(width: 14, height: 14)
                        .frame(width: 36, height: 36).background(.black, in: Circle())
                    if model.liveActivity.isSupported {
                        Button(model.liveActivity.isRunning ? "Live Activity running" : "Start Live Activity") {
                            model.liveActivity.start(title: title, state: s)
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(model.liveActivity.isRunning)
                    }
                    Text("Times are estimates. The countdown ticks on its own; stops away updates while the app is open (push updates need the server).")
                        .font(.caption).foregroundStyle(.secondary)
                } else {
                    EmptyStateView(title: "No trip started", message: "Plan a trip in Directions and tap Start to see its Live Activity.")
                }
            }
            .padding(16)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("Live Activity")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
        }
    }

    func label(_ s: String) -> some View {
        Text(s).font(.footnote.weight(.semibold)).foregroundStyle(.secondary).textCase(.uppercase)
    }
}
