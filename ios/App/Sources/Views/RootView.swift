import SwiftUI
import StraightBussingKit

/// Google-Maps-style layout (web v2.4): full-screen map, floating destination search bar with the Settings
/// gear, stale-data banner under it, a bottom sheet with three detents resting on the bottom tab bar.
struct RootView: View {
    @Environment(AppModel.self) private var model
    static let tabBarHeight: CGFloat = 56

    var body: some View {
        @Bindable var model = model
        GeometryReader { geo in
            let inDirections = model.page == .directions
            let topReserved: CGFloat = inDirections ? 8 : 64 + (model.staleLevel == .fresh ? 0 : 40)
            let available = max(200, geo.size.height - Self.tabBarHeight - topReserved)
            let sheetH = BottomSheet<EmptyView>.height(for: model.detent, available: available)
            ZStack(alignment: .bottom) {
                // The inset is applied here, not passed in: MapScreen has no inputs, so a detent change only
                // relayouts the map instead of re-running its body.
                MapScreen()
                    .safeAreaPadding(.bottom, sheetH + Self.tabBarHeight)
                    .ignoresSafeArea()
                VStack(spacing: 8) {
                    if !inDirections { SearchBar() }
                    StaleBanner()
                    if model.detent != .full { LocateButton().frame(maxWidth: .infinity, alignment: .trailing) }
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 12)
                .padding(.top, 4)
                VStack(spacing: 0) {
                    BottomSheet(detent: $model.detent, available: available) { SheetContent() }
                    TabBar()
                }
            }
            // Above the sheet at every detent, like a system banner.
            .overlay(alignment: .top) { ToastBanner().padding(.horizontal, 12).padding(.top, 4) }
        }
        .sheet(isPresented: $model.showSettings) { SettingsView() }
        .sheet(isPresented: $model.showLiveActivityPreview) {
            NavigationStack { LiveActivityPreviewView() }
        }
        .confirmationDialog(deleteTitle, isPresented: deleteBinding, titleVisibility: .visible, presenting: model.confirmDelete) { c in
            Button("Delete", role: .destructive) { model.apply(Custom.deleteCustom(model.routeState, c.id)) }
            Button("Cancel", role: .cancel) {}
        } message: { _ in
            Text("This removes the custom route from this iPhone. Your hidden routes are restored.")
        }
    }

    var deleteTitle: String { "Delete \u{201C}\(model.confirmDelete?.name ?? "")\u{201D}?" }
    var deleteBinding: Binding<Bool> {
        Binding(get: { model.confirmDelete != nil }, set: { if !$0 { model.confirmDelete = nil } })
    }
}

/// Floating "Search for a destination" bar with the Settings gear at its right end.
struct SearchBar: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        HStack(spacing: 0) {
            Button { model.openDirections() } label: {
                HStack(spacing: 10) {
                    Image(systemName: "magnifyingglass").font(.body.weight(.semibold))
                    Text("Search for a destination").foregroundStyle(.secondary)
                    Spacer()
                }
                .padding(.leading, 16)
                .frame(height: 50)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("searchBar")
            .accessibilityLabel("Search for a destination")
            Button { model.showSettings = true } label: {
                Image(systemName: "gearshape").font(.title3).frame(width: 50, height: 50)
            }
            .accessibilityIdentifier("settingsButton")
            .accessibilityLabel("Settings")
        }
        .background(.regularMaterial, in: Capsule())
        .shadow(color: .black.opacity(0.15), radius: 8, y: 2)
    }
}

/// Stale / failed live data is always flagged (ship checklist item 1).
struct StaleBanner: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        let level = model.staleLevel
        if level != .fresh && model.liveLoaded {
            HStack(spacing: 8) {
                Image(systemName: level == .err ? "wifi.exclamationmark" : "clock.badge.exclamationmark")
                Text(text(level)).font(.footnote.weight(.semibold)).lineLimit(2)
                Spacer(minLength: 0)
                if level == .err {
                    Button("Retry") { Task { await model.pollOnce() } }.font(.footnote.weight(.bold))
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
            .foregroundStyle(.black)
            .background(Color.yellow.opacity(0.92), in: RoundedRectangle(cornerRadius: 12))
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.updatesFrequently)
        }
    }

    func text(_ l: StaleLevel) -> String {
        switch l {
        case .err: return "Live data unavailable. Times may be wrong. Official: 773.702.8181"
        case .old: return "Live data is out of date (\(TimeFmt.ago(model.feedTs, from: model.now)))."
        case .late: return "Live data delayed. Bus times may be off."
        case .fresh: return ""
        }
    }
}

/// In-app bus alert banner: shown when system notifications are not allowed (`AppModel.checkBusAlerts`).
/// Disappears after a few seconds; a tap dismisses it.
struct ToastBanner: View {
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let transition: AnyTransition = reduceMotion ? .opacity : .move(edge: .top).combined(with: .opacity)
        VStack(spacing: 0) {
            if let text = model.toast {
                Button { model.dismissToast() } label: {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: "bell.fill").foregroundStyle(Color.accentColor)
                        Text(text).font(.subheadline).foregroundStyle(.primary).multilineTextAlignment(.leading)
                        Spacer(minLength: 0)
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
                    .shadow(color: .black.opacity(0.18), radius: 10, y: 3)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(text)
                .accessibilityHint("Dismisses the alert")
                .accessibilityIdentifier("busAlertBanner")
                .transition(transition)
            }
        }
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.25), value: model.toast)
    }
}

struct LocateButton: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        Button { model.locate() } label: {
            Image(systemName: model.user == nil ? "location" : "location.fill")
                .font(.title3)
                .frame(width: 44, height: 44)
                .background(.regularMaterial, in: Circle())
                .shadow(color: .black.opacity(0.15), radius: 6, y: 2)
        }
        .accessibilityLabel("Show my location")
    }
}

/// Bottom navigation: Current trip / Routes / My Routes.
struct TabBar: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        HStack(spacing: 0) {
            ForEach(Tab.allCases) { t in
                Button { model.select(t) } label: {
                    VStack(spacing: 3) {
                        Image(systemName: t.icon).font(.system(size: 19, weight: .semibold))
                        Text(t.title).font(.caption2.weight(.semibold))
                    }
                    .frame(maxWidth: .infinity, minHeight: RootView.tabBarHeight)
                    .foregroundStyle(model.tab == t ? Color.accentColor : Color.secondary)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("tab.\(t.rawValue)")
                .accessibilityAddTraits(model.tab == t ? .isSelected : [])
            }
        }
        .background(.bar, ignoresSafeAreaEdges: .bottom)
        .overlay(alignment: .top) { Divider() }
    }
}
