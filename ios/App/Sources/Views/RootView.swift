import Combine
import SwiftUI
import UIKit
import StraightBussingKit

/// Google-Maps-style layout (web v2.4): full-screen map, floating destination search bar with the Settings
/// gear, the status pill and the map context bar under it, a bottom sheet with three detents resting on the bottom
/// tab bar.
struct RootView: View {
    @Environment(AppModel.self) private var model
    static let tabBarHeight: CGFloat = 56
    /// Measured height of the floating chrome above the sheet (search bar, status pill, context bar):
    /// a long stale message or large text makes it taller, and the sheet's full detent must stay below it.
    @State private var chromeH: CGFloat = 50
    /// The keyboard is up: the tab bar steps aside so the sheet keeps its room for suggestions.
    @State private var keyboardUp = false
    /// Search bar -> Directions (owner 2026-10-12: the start and destination fields grow out of the bar, so the bar
    /// reads as a search field, not a button): the bar's frame, kept current, and the stand-in in flight.
    @State private var barFrame: CGRect = .zero
    @State private var morph: SearchMorph?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    static let space = "rootSpace"

    var body: some View {
        @Bindable var model = model
        GeometryReader { geo in
            let inDirections = model.page == .directions
            // On the Routes list the list's own bar says the same thing with the same button (one action per intent).
            let ctx = ContextBar.shows(model) && model.detent != .full && !(model.tab == .routes && model.page == nil)
            let topReserved: CGFloat = chromeH > 1 ? chromeH + 14 : 8
            let tabH: CGFloat = keyboardUp ? 0 : Self.tabBarHeight
            let available = max(200, geo.size.height - tabH - topReserved)
            let sheetH = BottomSheet<EmptyView, EmptyView>.height(for: model.detent, available: available)
            ZStack(alignment: .bottom) {
                // The inset is applied here, not passed in: MapScreen has no inputs, so a detent change only
                // relayouts the map instead of re-running its body.
                MapScreen()
                    .safeAreaPadding(.bottom, sheetH + tabH)
                    .ignoresSafeArea()
                VStack(spacing: 8) {
                    VStack(spacing: 8) {
                        if !inDirections {
                            SearchBar(onOpen: startMorph)
                                .onGeometryChange(for: CGRect.self, of: { $0.frame(in: .named(Self.space)) }) { barFrame = $0 }
                        }
                        StatusPill()
                        if ctx && !inDirections { ContextBar() }
                    }
                    .onGeometryChange(for: CGFloat.self, of: { $0.size.height }) { h in
                        if abs(h - chromeH) > 0.5 { chromeH = h }
                    }
                    if model.detent != .full { LocateButton().frame(maxWidth: .infinity, alignment: .trailing) }
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 12)
                .padding(.top, 4)
                VStack(spacing: 0) {
                    BottomSheet(detent: $model.detent, available: available) { SheetHeader() } content: { SheetContent() }
                        .environment(\.directionsCardHidden, morph != nil)
                    if !keyboardUp { TabBar() }
                }
            }
            // Above the sheet at every detent, like a system banner.
            .overlay(alignment: .top) { ToastBanner().padding(.horizontal, 12).padding(.top, 4) }
            .overlay(alignment: .topLeading) { if let morph { SearchMorphView(morph: morph) } }
            .coordinateSpace(.named(Self.space))
            .onPreferenceChange(DirectionsCardFrameKey.self) { f in
                Task { @MainActor in flyMorph(to: f) }
            }
        }
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
    }

    /// The tap on the search bar: a stand-in starts on the bar's frame (the bar itself leaves with Directions).
    func startMorph() {
        guard !reduceMotion, barFrame.width > 0 else { return }
        morph = SearchMorph(rect: barFrame, radius: barFrame.height / 2, label: 1, card: 0)
    }

    /// The fields card reported where it is: fly the stand-in there (again if the card moves while the sheet
    /// rises), then hand over to the real card and fade the stand-in out.
    func flyMorph(to f: CGRect) {
        guard var m = morph, f.width > 0, f != m.target else { return }
        let first = m.target == nil
        m.target = f
        morph = m
        withAnimation(first ? .spring(response: 0.42, dampingFraction: 0.88) : .spring(response: 0.25, dampingFraction: 1)) {
            morph?.rect = f
            morph?.radius = Radius.card
            morph?.label = 0
            morph?.card = 1
        } completion: {
            guard morph?.target == f else { return }    // a later frame took over
            withAnimation(.easeOut(duration: 0.14)) { morph = nil }
        }
    }

    var deleteTitle: String { "Delete \u{201C}\(model.confirmDelete?.name ?? "")\u{201D}?" }
    var deleteBinding: Binding<Bool> {
        Binding(get: { model.confirmDelete != nil }, set: { if !$0 { model.confirmDelete = nil } })
    }
}

/// The stand-in that grows from the search bar into the Directions fields card.
struct SearchMorph: Equatable {
    var rect: CGRect
    var radius: CGFloat
    /// Opacity of the bar's "Search for a destination" label (fades out) and of the card's fill (fades in).
    var label: Double
    var card: Double
    var target: CGRect?
}

struct SearchMorphView: View {
    let morph: SearchMorph
    var body: some View {
        let shape = RoundedRectangle(cornerRadius: morph.radius, style: .continuous)
        ZStack(alignment: .leading) {
            shape.fill(.regularMaterial)
            shape.fill(Palette.card).opacity(morph.card)
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass").font(.body.weight(.semibold))
                Text("Search for a destination").foregroundStyle(Palette.text2).lineLimit(1)
            }
            .padding(.leading, 16)
            .opacity(morph.label)
        }
        .shadow(color: Palette.shadow.opacity(0.15 * (1 - morph.card)), radius: 8, y: 2)
        .frame(width: morph.rect.width, height: morph.rect.height)
        .offset(x: morph.rect.minX, y: morph.rect.minY)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .transition(.opacity)
    }
}

/// Where the Directions fields card is (in RootView's coordinate space), for the search bar morph.
struct DirectionsCardFrameKey: PreferenceKey {
    static let defaultValue: CGRect = .zero
    static func reduce(value: inout CGRect, nextValue: () -> CGRect) {
        let n = nextValue()
        if n.width > 0 { value = n }
    }
}

private struct DirectionsCardHiddenKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    /// The search bar morph is in flight: the real fields card waits, invisible (it keeps its focus).
    var directionsCardHidden: Bool {
        get { self[DirectionsCardHiddenKey.self] }
        set { self[DirectionsCardHiddenKey.self] = newValue }
    }
}

/// Floating "Search for a destination" bar with the Settings gear at its right end. A tap opens Directions and the
/// fields card grows out of the bar (RootView's morph).
struct SearchBar: View {
    @Environment(AppModel.self) private var model
    var onOpen: () -> Void = {}
    var body: some View {
        HStack(spacing: 0) {
            Button { onOpen(); model.dirActiveTo = true; model.openDirections() } label: {
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
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: Radius.control, style: .continuous))
                .shadow(color: Palette.shadow.opacity(0.15), radius: 6, y: 2)
        }
        .accessibilityLabel("Show my location")
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
