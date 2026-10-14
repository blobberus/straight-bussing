import Combine
import SwiftUI
import UIKit
import StraightBussingKit

/// Google-Maps-style layout (web v2.4): full-screen map, floating destination search bar with the Settings gear (in
/// Directions the bar itself turns into the Start / Destination card, in place, and back again when Directions
/// closes), the status pill and the map context bar under it, a bottom sheet with two resting states (collapsed /
/// expanded, owner spec 2026-10-12) on the bottom tab bar.
struct RootView: View {
    @Environment(AppModel.self) private var model
    static let tabBarHeight: CGFloat = 56
    /// Measured height of the floating chrome above the sheet (search bar or Directions card, status pill, context
    /// bar): a long stale message, large text or the Directions card makes it taller, and the expanded sheet must
    /// stay below it.
    @State private var chromeH: CGFloat = 50
    /// The keyboard is up: the tab bar steps aside so the sheet keeps its room for suggestions.
    @State private var keyboardUp = false
    /// The sheet's settled visible height: the map's bottom padding follows it, so the map never re-centers while the
    /// sheet is still moving (owner 2026-10-12: no hitch).
    @State private var settledSheetH: CGFloat = 0
    /// Directions' typed text, focus and suggestions, shared by the top card and the sheet below it.
    @State private var dirUI = DirectionsUI()
    @Namespace private var searchNS
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        @Bindable var model = model
        GeometryReader { geo in
            let inDirections = model.page == .directions
            // On the Routes list the list's own bar says the same thing with the same button (one action per intent).
            let ctx = ContextBar.shows(model) && model.detent != .full && !(model.tab == .routes && model.page == nil)
            let topReserved: CGFloat = chromeH > 1 ? chromeH + 14 : 8
            let tabH: CGFloat = keyboardUp ? 0 : Self.tabBarHeight
            let available = max(200, geo.size.height - tabH - topReserved)
            let mapRects = MapRects.of(geo, chromeH: chromeH, sheetH: settledSheetH, tabH: tabH)
            ZStack(alignment: .bottom) {
                // The inset is applied here, not passed in: MapScreen has no inputs, so a settled sheet only
                // relayouts the map instead of re-running its body.
                MapScreen()
                    .safeAreaPadding(.bottom, settledSheetH + tabH)
                    .ignoresSafeArea()
                VStack(spacing: 8) {
                    VStack(spacing: 8) {
                        // the bar and the card are one element that changes shape (matchedGeometryEffect; Reduce
                        // Motion: a crossfade)
                        if inDirections {
                            DirectionsCard()
                                .modifier(SearchMorphEffect(ns: searchNS, on: !reduceMotion))
                                .transition(.opacity)
                        } else {
                            SearchBar()
                                .modifier(SearchMorphEffect(ns: searchNS, on: !reduceMotion))
                                .transition(.opacity)
                        }
                        StatusPill()
                        if ctx && !inDirections { ContextBar() }
                    }
                    .animation(reduceMotion ? .easeInOut(duration: 0.2) : .spring(response: 0.38, dampingFraction: 0.86), value: inDirections)
                    .onGeometryChange(for: CGFloat.self, of: { $0.size.height }) { h in
                        if abs(h - chromeH) > 0.5 { withAnimation(.easeOut(duration: 0.2)) { chromeH = h } }
                    }
                    if model.detent != .full { LocateButton().frame(maxWidth: .infinity, alignment: .trailing) }
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 12)
                .padding(.top, 4)
                VStack(spacing: 0) {
                    BottomSheet(detent: $model.detent, available: available, onSettled: { _, h in
                        if abs(h - settledSheetH) > 0.5 { settledSheetH = h }
                    }) {
                        SheetHeader()
                    } content: {
                        SheetContent()
                    }
                    if !keyboardUp { TabBar() }
                }
            }
            // Above the sheet in both states, like a system banner.
            .overlay(alignment: .top) { ToastBanner().padding(.horizontal, 12).padding(.top, 4) }
            // the trip's follow camera keeps its frame inside what the rider can see of the map
            .onChange(of: mapRects, initial: true) { _, r in
                let cam = model.mapCamera
                cam.safeRect = r.safe
                if cam.visibleRect != r.visible { cam.visibleRect = r.visible }
            }
        }
        .environment(dirUI)
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in keyboardUp = true }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in keyboardUp = false }
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
        // the rider asked for their location and it is off: one tap to the switch in iOS Settings
        .alert("Location is off", isPresented: $model.showLocationOff) {
            Button("Open Settings") { AppModel.openAppSettings() }
            Button("Not now", role: .cancel) {}
        } message: {
            Text("To see stops near you and walk from where you are, allow location for Straight Bussing in iOS Settings. It stays on your iPhone.")
        }
    }

    var deleteTitle: String { "Delete \u{201C}\(model.confirmDelete?.name ?? "")\u{201D}?" }
    var deleteBinding: Binding<Bool> {
        Binding(get: { model.confirmDelete != nil }, set: { if !$0 { model.confirmDelete = nil } })
    }
}

/// The search bar and the Directions card are one element that changes shape (owner 2026-10-12, like Google Maps):
/// a matched geometry between them; Reduce Motion: none (they crossfade).
struct SearchMorphEffect: ViewModifier {
    let ns: Namespace.ID
    let on: Bool
    func body(content: Content) -> some View {
        if on { content.matchedGeometryEffect(id: "searchCard", in: ns) } else { content }
    }
}

/// Floating "Search for a destination" bar with the Settings gear at its right end. A tap opens Directions: the bar
/// turns into the Start / Destination card in place, keyboard on Destination.
struct SearchBar: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        HStack(spacing: 0) {
            Button { model.dirActiveTo = true; model.openDirections() } label: {
                HStack(spacing: 10) {
                    Image(systemName: "magnifyingglass").font(.body.weight(.semibold))
                    Text("Search for a destination").foregroundStyle(Palette.text2)
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
        .shadow(color: Palette.shadow.opacity(0.15), radius: 8, y: 2)
        // map chrome: grows with text size, but not so far that it hides the map (the sheet holds the content)
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
    }
}

/// The status pill (web main.js renderPill): stale / failed live data is always flagged, and a fresh empty feed
/// says whether the schedule has routes in service (ship checklist item 1). Same words as the web. While the
/// Settings switch simulates buses it reads "Simulated buses" instead (the one quiet indicator; a tap opens
/// Settings at the switch). The `-demo` launch argument never shows that: its pill is the normal one.
struct StatusPill: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        if model.simulating {
            SimulatedPill()
        } else if let p = model.statusPill {
            HStack(spacing: 8) {
                Image(systemName: icon(p)).accessibilityHidden(true)
                // safety text: never truncated (the sheet makes room, RootView measures this stack)
                Text(p.text).font(.footnote.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
                if p.retry {
                    Button { Task { await model.pollOnce() } } label: {
                        Text("Retry").font(.footnote.weight(.bold)).underline()
                            .frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Retry loading live data")
                } else if p.alert {
                    // no bus is reporting and the operator posted an alert: it may say why (rider safety)
                    Button { model.openAlerts() } label: {
                        Text("See alert").font(.footnote.weight(.bold)).underline()
                            .frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Read the service alert")
                    .accessibilityIdentifier("pillAlert")
                }
            }
            .padding(.horizontal, 12).padding(.vertical, p.retry || p.alert ? 0 : 7)
            .foregroundStyle(p.kind == .err ? Color.white : p.kind == .warn ? Self.onYellow : Color.primary)
            .background(pillStyle(p), in: RoundedRectangle(cornerRadius: Radius.control, style: .continuous))
            .dynamicTypeSize(...DynamicTypeSize.accessibility2)
            .shadow(color: Palette.shadow.opacity(0.12), radius: 4, y: 1)
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

    /// Dark text on the yellow pill in both themes (12:1).
    static let onYellow = Palette.fixed(0x111114)

    /// Feed error: the danger fill (white 5.7:1). Delayed data: system yellow, the strongest warning on the map
    /// (deliberately louder than the web's gold tint; rider safety first).
    func pillStyle(_ p: LiveText.Pill) -> AnyShapeStyle {
        switch p.kind {
        case .err: return AnyShapeStyle(Palette.dangerFill)
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
                (Text("Only showing routes for: ").foregroundColor(Palette.text2) + Text(j.label).fontWeight(.semibold))
                    .font(.footnote).lineLimit(2)
                ForEach(rids.prefix(Self.maxChips), id: \.self) { RouteChip(route: model.route($0), rid: $0, size: 11) }
                if rids.count > Self.maxChips { Text("+\(rids.count - Self.maxChips)").font(.caption).foregroundStyle(Palette.text2) }
                Spacer(minLength: 0)
                Button { model.endJourney() } label: {
                    Text("Show all").font(.footnote.weight(.bold)).frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
                }
                .accessibilityHint("Shows every route on the map again")
            } else if let c = RouteVisibility.activeCustomRoute(s) {
                (Text("My route: ").foregroundColor(Palette.text2) + Text(c.name).fontWeight(.semibold)).font(.footnote).lineLimit(2)
                Spacer(minLength: 0)
                Button { model.apply(Custom.clearCustom(model.routeState)) } label: {
                    Text("Clear").font(.footnote.weight(.bold)).frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
                }
                .accessibilityLabel("Clear my route \(c.name)")
            }
        }
        .padding(.leading, 12).padding(.trailing, 4)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: Radius.control, style: .continuous))
        .shadow(color: Palette.shadow.opacity(0.12), radius: 4, y: 1)
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
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
                        Image(systemName: model.toastIcon).foregroundStyle(Palette.accent).accessibilityHidden(true)
                        Text(text).font(.subheadline).foregroundStyle(Palette.text).multilineTextAlignment(.leading)
                        Spacer(minLength: 0)
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
                    .shadow(color: Palette.shadow.opacity(0.18), radius: 10, y: 3)
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

/// Show my location; during a started trip: show you in the trip again (the follow camera back on, web
/// onLocateFab + tripmap recenter). The symbol says the state (filled = following / located), not color alone.
struct LocateButton: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        let trip = model.activeTrip != nil
        let following = trip && model.mapCamera.follow
        Button {
            if trip { model.recenterTrip(); return }
            if model.locState == .denied && !model.config.demo { model.showLocationOff = true; return }
            model.locate()
        } label: {
            Image(systemName: trip ? (following ? "location.north.line.fill" : "location.north.line") : model.user == nil ? "location" : "location.fill")
                .font(.title3)
                .frame(width: 44, height: 44)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: Radius.control, style: .continuous))
                .shadow(color: Palette.shadow.opacity(0.15), radius: 6, y: 2)
        }
        .accessibilityLabel(trip ? "Show me on my trip" : "Show my location")
        .accessibilityValue(trip ? (following ? "Following the trip" : "Not following") : "")
        .accessibilityIdentifier("locateButton")
    }
}

/// Bottom navigation: Current trip / Routes / My Routes. The selected tab is also the label weight and an
/// accessibility trait, not color alone. Like the system tab bar, the labels stop growing at the largest
/// standard text size and offer the Large Content Viewer (touch and hold) at accessibility sizes.
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
                    .foregroundStyle(model.tab == t ? Palette.accent : Palette.text2)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(t.title)
                .accessibilityIdentifier("tab.\(t.rawValue)")
                .accessibilityAddTraits(model.tab == t ? .isSelected : [])
                .accessibilityShowsLargeContentViewer {
                    Label(t.title, systemImage: t.icon)
                }
            }
        }
        .dynamicTypeSize(...DynamicTypeSize.xxLarge)
        .background(.bar, ignoresSafeAreaEdges: .bottom)
        .overlay(alignment: .top) { Divider() }
    }
}

/// "Simulated buses": the Settings switch is on (never in `-demo`). Quiet like the info pill, yet never mistaken for
/// live service (a test-tube symbol and the words); a tap opens Settings at the switch to turn it off.
struct SimulatedPill: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        Button { model.openSimulatedSetting() } label: {
            HStack(spacing: 8) {
                Image(systemName: "testtube.2").accessibilityHidden(true)
                Text(AppModel.simulatedPillText).font(.footnote.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(Palette.text2)
                    .accessibilityHidden(true)
            }
            .foregroundStyle(Palette.text)
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: Radius.control, style: .continuous))
            .contentShape(RoundedRectangle(cornerRadius: Radius.control, style: .continuous))
        }
        .buttonStyle(.plain)
        .dynamicTypeSize(...DynamicTypeSize.accessibility2)
        .shadow(color: Palette.shadow.opacity(0.12), radius: 4, y: 1)
        .accessibilityLabel("Simulated buses, not real shuttles")
        .accessibilityHint("Opens Settings to turn simulated buses off")
        .accessibilityIdentifier("simulatedPill")
    }
}

extension AppModel {
    /// This app's page in iOS Settings (location, notifications).
    static func openAppSettings() {
        if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
    }
}
