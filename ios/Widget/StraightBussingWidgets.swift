import ActivityKit
import SwiftUI
import WidgetKit
import StraightBussingKit

/// Widget extension: the trip Live Activity (Lock Screen + Dynamic Island). A favorite-stop home screen
/// widget is planned (conversion to appstore.md P8) and not part of this draft.
@main
struct StraightBussingWidgets: WidgetBundle {
    var body: some Widget {
        TripLiveActivity()
    }
}

struct TripLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TripActivityAttributes.self) { context in
            LiveTripLockScreenView(title: context.attributes.title, state: context.state, isStale: context.isStale,
                                   simulated: context.attributes.simulated)
                .padding(14)
                .environment(\.colorScheme, .dark)
                .foregroundStyle(.white)
                .activityBackgroundTint(Color.black.opacity(0.55))
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            let s = context.state
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    LiveRouteChip(state: s).padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    LiveCountdown(state: s, font: .system(size: 22, weight: .bold, design: .rounded))
                        .frame(maxWidth: 90)
                        .opacity(context.isStale ? 0.6 : 1)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text("\(s.boardName) → \(s.alightName)")
                        .font(.caption.weight(.semibold))
                        .lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(spacing: 4) {
                        TripProgressBar(state: s)
                        HStack {
                            LiveHeadline(state: s, isStale: context.isStale).lineLimit(1)
                            Spacer()
                            Text(context.attributes.simulated ? "Simulated (demo)" : context.isStale ? "Data delayed" : "est. · Unofficial")
                        }
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    }
                }
            } compactLeading: {
                LiveRouteChip(state: s, compact: true)
            } compactTrailing: {
                // Self-ticking timer: the minutes keep counting while the app is in the background.
                LiveCompactTrailing(state: s, isStale: context.isStale)
            } minimal: {
                Circle().fill(Color(hex: s.routeColor)).frame(width: 14, height: 14)
            }
            .widgetURL(URL(string: "straightbussing://trip"))
            .keylineTint(Color(hex: s.routeColor))
        }
    }
}
