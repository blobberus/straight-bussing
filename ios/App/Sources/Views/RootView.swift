import SwiftUI
import StraightBussingKit

/// Google-Maps-style layout (web v2.4): full-screen map, floating destination search bar with the Settings
/// gear, the status pill and the map context bar under it, a bottom sheet with three detents resting on the
/// bottom tab bar.
struct RootView: View {
    @Environment(AppModel.self) private var model
    static let tabBarHeight: CGFloat = 56

    var body: some View {
        @Bindable var model = model
        GeometryReader { geo in
            let inDirections = model.page == .directions
            let ctx = ContextBar.shows(model) && model.detent != .full
            let topReserved: CGFloat = inDirections ? 8 : 64 + (model.statusPill == nil ? 0 : 46) + (ctx ? 50 : 0)
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
                    StatusPill()
                    if ctx && !inDirections { ContextBar() }
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
            Button("Delete", role: .destructive) { model.deleteCustomConfirmed(c) }
            Button("Cancel", role: .cancel) {}
        } message: { _ in
            Text("This custom route will be removed from My Routes. This can\u{2019}t be undone.")
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
            Button { model.dirActiveTo = true; model.openDirections() } label: {
                HStack(spacing: 10) {
                    Image(systemName: "magnifyingglass").font(.body.weight(.semibold))
                    Text("Search for a destination").foregroundStyle(.secondary)
                    Spacer()
                }
                .padding(.leading, 16)
                .frame(minHeight: 50)
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

/// The status pill (web main.js renderPill): stale / failed live data is always flagged, and a fresh empty feed
/// says whether the schedule has routes in service (ship checklist item 1). Same words as the web.
struct StatusPill: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        if let p = model.statusPill {
            HStack(spacing: 8) {
                Image(systemName: icon(p)).accessibilityHidden(true)
                Text(p.text).font(.footnote.weight(.semibold)).lineLimit(3).fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
                if p.retry {
                    Button("Retry") { Task { await model.pollOnce() } }
                        .font(.footnote.weight(.bold))
                        .frame(minWidth: 44, minHeight: 32)
                        .accessibilityLabel("Retry loading live data")
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 7)
            .foregroundStyle(p.kind == .err ? Color.white : p.kind == .warn ? Color.black : Color.primary)
            .background(pillStyle(p), in: RoundedRectangle(cornerRadius: 12))
            .shadow(color: .black.opacity(0.12), radius: 4, y: 1)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.updatesFrequently)
            .accessibilityIdentifier("statusPill")
        }
    }

    func icon(_ p: LiveText.Pill) -> String {
        switch p.kind {
        case .err: return "wifi.exclamationmark"
        case .warn: return model.staleLevel == .fresh ? "antenna.radiowaves.left.and.right.slash" : "clock.badge.exclamationmark"
        case .info: return "bus"
        }
    }

    func pillStyle(_ p: LiveText.Pill) -> AnyShapeStyle {
        switch p.kind {
        case .err: return AnyShapeStyle(Color(red: 0.72, green: 0.11, blue: 0.11))
        case .warn: return AnyShapeStyle(Color.yellow.opacity(0.95))
        case .info: return AnyShapeStyle(.regularMaterial)
        }
    }
}

/// Map context bar (web ui/contextbar.js): why the map shows fewer routes than usual, with a one-tap way out.
struct ContextBar: View {
    @Environment(AppModel.self) private var model
    static let maxChips = 4

    static func shows(_ m: AppModel) -> Bool {
        (m.routeState.journey.map { !$0.rids.isEmpty } ?? false) || RouteVisibility.activeCustomRoute(m.routeState) != nil
    }

    var body: some View {
        let s = model.routeState
        HStack(spacing: 8) {
            if let j = s.journey, !j.rids.isEmpty {
                let rids = j.rids.filter { model.route($0) != nil }
                (Text("Only showing routes for: ").foregroundColor(.secondary) + Text(j.label).fontWeight(.semibold))
                    .font(.footnote).lineLimit(2)
                ForEach(rids.prefix(Self.maxChips), id: \.self) { RouteChip(route: model.route($0), rid: $0, size: 11) }
                if rids.count > Self.maxChips { Text("+\(rids.count - Self.maxChips)").font(.caption).foregroundStyle(.secondary) }
                Spacer(minLength: 0)
                Button("Show all") { model.endJourney() }
                    .font(.footnote.weight(.bold)).frame(minWidth: 44, minHeight: 36)
                    .accessibilityHint("Shows every route on the map again")
            } else if let c = RouteVisibility.activeCustomRoute(s) {
                (Text("My route: ").foregroundColor(.secondary) + Text(c.name).fontWeight(.semibold)).font(.footnote).lineLimit(2)
                Spacer(minLength: 0)
                Button("Clear") { model.apply(Custom.clearCustom(model.routeState)) }
                    .font(.footnote.weight(.bold)).frame(minWidth: 44, minHeight: 36)
                    .accessibilityLabel("Clear my route \(c.name)")
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 4)
        .background(.regularMaterial, in: Capsule())
        .shadow(color: .black.opacity(0.12), radius: 4, y: 1)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("contextBar")
    }
}

/// In-app banner: bus alerts when system notifications are not allowed, and short confirmations.
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
                        Image(systemName: model.toastIcon).foregroundStyle(Color.accentColor).accessibilityHidden(true)
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
                .accessibilityHint("Dismisses the message")
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
        Button {
            if model.locState == .denied && !model.config.demo {
                model.showInfo("Location is off. Turn it on in iOS Settings to see stops near you.")
            }
            model.locate()
        } label: {
            Image(systemName: model.user == nil ? "location" : "location.fill")
                .font(.title3)
                .frame(width: 44, height: 44)
                .background(.regularMaterial, in: Circle())
                .shadow(color: .black.opacity(0.15), radius: 6, y: 2)
        }
        .accessibilityLabel("Show my location")
    }
}

/// Bottom navigation: Current trip / Routes / My Routes. The Current trip tab counts active service alerts
/// (web alert count badge); selected state is also the label weight and an accessibility trait, not color alone.
struct TabBar: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        HStack(spacing: 0) {
            ForEach(Tab.allCases) { t in
                Button { model.select(t) } label: {
                    VStack(spacing: 3) {
                        Image(systemName: t.icon).font(.system(size: 19, weight: .semibold))
                        Text(t.title).font(.caption2.weight(model.tab == t ? .bold : .medium))
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
