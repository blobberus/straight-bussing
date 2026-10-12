import SwiftUI
import StraightBussingKit

/// Custom bottom sheet resting on the tab bar (the web's ui/sheet.js), owner spec 2026-10-12: two resting states,
/// collapsed (grab bar + title line, whose right side keeps the one-line summary such as the next bus) and expanded.
/// The whole header strip drags it (from just above the sheet's top edge through the grab bar and the title line;
/// a drag that starts on the Back button still drags, a tap there still goes back). While the finger is down the
/// sheet follows it 1:1 to any height (rubber band past the ends); on release it goes the way the finger last moved
/// (Kit `SheetMotion`: up = expanded, down = collapsed; a finger that stopped keeps its last direction). A tap on the
/// grab bar toggles, a tap on a collapsed header expands. The settle is a spring that starts at the finger's speed.
/// Laid out once at full height and slid with an offset; the content's bottom inset and the map padding
/// (`onSettled`) change only after the spring finishes, so nothing re-lays out while it moves. VoiceOver adjusts
/// it (Collapsed / Expanded); Reduce Motion: a short ease, no spring.
struct BottomSheet<Header: View, Content: View>: View {
    @Binding var detent: Detent
    let available: CGFloat
    var header: Header
    var content: Content
    /// The state the sheet came to rest in and its visible height (the map padding follows it, RootView).
    var onSettled: (Detent, CGFloat) -> Void
    /// The content's bottom inset follows this, not `detent`: it changes after the spring has settled.
    @State private var insetDetent: Detent
    /// The header's measured height: collapsed = grab bar + this, so large text keeps the whole title line.
    @State private var headerH: CGFloat = 50
    /// Finger travel since the drag began (positive = down).
    @State private var drag: CGFloat = 0
    @State private var tracking = false
    @State private var motion = SheetMotion()
    /// The release spring (carries the finger's velocity) until it settles; nil = the default spring.
    @State private var settle: Animation?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(detent: Binding<Detent>, available: CGFloat, onSettled: @escaping (Detent, CGFloat) -> Void = { _, _ in },
         @ViewBuilder header: () -> Header, @ViewBuilder content: () -> Content) {
        _detent = detent
        self.available = available
        self.onSettled = onSettled
        self.header = header()
        self.content = content()
        _insetDetent = State(initialValue: detent.wrappedValue)
    }

    static var shape: UnevenRoundedRectangle { UnevenRoundedRectangle(topLeadingRadius: Radius.sheet, topTrailingRadius: Radius.sheet, style: .continuous) }
    static let grabH: CGFloat = 30

    static func height(for d: Detent, available: CGFloat, headerH: CGFloat) -> CGFloat {
        switch d {
        case .peek: return min(available, grabH + headerH + 4)
        case .full: return available
        }
    }

    func h(_ d: Detent) -> CGFloat { Self.height(for: d, available: available, headerH: headerH) }
    var defaultAnimation: Animation { reduceMotion ? .easeOut(duration: 0.15) : .spring(response: 0.36, dampingFraction: 0.88) }

    var body: some View {
        let visible = CGFloat(SheetSnap.rubberBand(Double(h(detent) - drag), min: Double(h(.peek)), max: Double(available)))
        let anim = settle ?? defaultAnimation
        VStack(spacing: 0) {
            // the header strip: one full-width hit shape, from 14 pt above the sheet's edge down to the title line
            VStack(spacing: 0) {
                grabber
                header
                    .onGeometryChange(for: CGFloat.self, of: { $0.size.height }) { v in
                        if abs(v - headerH) > 0.5 { headerH = v }
                    }
                    .contentShape(Rectangle())
                    .onTapGesture { if detent == .peek { setDetent(.full) } }
            }
            .contentShape(TopExtendedRect(extra: 14))
            // wins over the buttons and the scroll view under it: a drag that starts anywhere on the strip moves the
            // sheet (a plain tap still reaches Back, the star, Edit map order)
            .highPriorityGesture(stripDrag)
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                // the part below the screen in the settled state: every row can still scroll into view
                .safeAreaPadding(.bottom, available - h(insetDetent))
        }
        .frame(height: available, alignment: .top)
        .frame(maxWidth: .infinity)
        .clipShape(Self.shape)
        // The shadow belongs to the background shape, not to the clipped content: a shadow on content makes
        // SwiftUI render the whole sheet offscreen on every drag frame; on a filled shape it is cheap.
        .background(
            Self.shape
                .fill(Palette.sheet)
                .shadow(color: Palette.shadow.opacity(0.18), radius: 10, y: -2)
        )
        .offset(y: available - visible)
        .animation(tracking ? nil : anim, value: drag)
        .animation(anim, value: detent)
        // what slides below the sheet's slot stays hidden (the tab bar and the screen edge); room above for the
        // rubber band past expanded
        .mask(alignment: .bottom) { Rectangle().frame(height: available + 400) }
        .onAppear { onSettled(detent, h(detent)) }
        // a state set from elsewhere (a page push, a tab switch, a tap on the map): the inset and the map follow
        // once the spring has settled
        .onChange(of: detent) { _, d in
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 450_000_000)
                if detent == d && !tracking { settled(d) }
            }
        }
        .onChange(of: headerH) { _, _ in if !tracking { onSettled(detent, h(detent)) } }
    }

    func settled(_ d: Detent) {
        if insetDetent != d { insetDetent = d }
        onSettled(d, h(d))
    }

    func setDetent(_ d: Detent) {
        guard d != detent else { return }
        detent = d
    }

    /// The grab bar (30 pt; the strip around it drags too). A tap toggles collapsed / expanded.
    var grabber: some View {
        Capsule()
            .fill(Palette.text2.opacity(0.45))
            .frame(width: 38, height: 5)
            .frame(maxWidth: .infinity, minHeight: Self.grabH)
            .contentShape(Rectangle())
            .onTapGesture { setDetent(detent == .peek ? .full : .peek) }
            .accessibilityElement()
            .accessibilityLabel("Resize panel")
            .accessibilityValue(detent == .peek ? "Collapsed" : "Expanded")
            .accessibilityIdentifier("sheetGrabber")
            .accessibilityAdjustableAction { dir in
                switch dir {
                case .increment: setDetent(.full)
                case .decrement: setDetent(.peek)
                @unknown default: break
                }
            }
    }

    /// Global coordinates: the sheet moves under the finger, so a local translation would feed back.
    var stripDrag: some Gesture {
        DragGesture(minimumDistance: 3, coordinateSpace: .global)
            .onChanged { v in
                if !tracking {
                    tracking = true
                    settle = nil
                    motion.begin(at: Double(v.startLocation.y))
                }
                motion.track(Double(v.location.y))
                drag = v.translation.height
            }
            .onEnded { v in
                motion.track(Double(v.location.y))
                release(translation: v.translation.height, velocityDown: v.velocity.height)
            }
    }

    /// The way the finger last moved decides (Kit `SheetMotion`); the spring starts at the finger's speed and the
    /// inset and the map follow only after it settled.
    func release(translation: CGFloat, velocityDown: CGFloat) {
        let visible = Double(h(detent) - translation)
        let target: Detent
        switch motion.outcome {
        case .expand: target = .full
        case .collapse: target = .peek
        case .tap: target = detent
        }
        let v0 = SheetSnap.initialVelocity(visible: visible, target: Double(h(target)), velocityDown: Double(velocityDown))
        let anim: Animation = reduceMotion ? .easeOut(duration: 0.15)
            : .interpolatingSpring(Spring(duration: 0.4, bounce: 0.04), initialVelocity: v0)
        settle = anim
        withAnimation(anim) {
            tracking = false
            drag = 0
            detent = target
        } completion: {
            if !tracking {
                settle = nil
                settled(target)
            }
        }
    }
}

/// A rectangle that reaches `extra` points above the view: the sheet's top edge is part of the drag strip.
struct TopExtendedRect: Shape {
    var extra: CGFloat
    func path(in r: CGRect) -> Path {
        Path(CGRect(x: r.minX, y: r.minY - extra, width: r.width, height: r.height + extra))
    }
}

/// The sheet's header: back button, title and the page's trailing control. A drag on it moves the sheet.
struct SheetHeader: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        HStack(spacing: 6) {
            if !model.path.isEmpty {
                Button { model.back() } label: {
                    Image(systemName: "chevron.left").font(.title3.weight(.semibold)).tapTarget()
                }
                .accessibilityLabel("Back")
                .accessibilityIdentifier("backButton")
            }
            Text(model.title)
                .font(.title2.weight(.bold))
                .lineLimit(2)
                .minimumScaleFactor(0.85)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("sheetTitle")
            Spacer()
            trailing
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 6)
    }

    @ViewBuilder var trailing: some View {
        switch model.page {
        case .stop(let id):
            Button { model.toggleFavorite(id) } label: {
                Image(systemName: model.isFav(id) ? "star.fill" : "star").font(.title3).foregroundStyle(Palette.star).tapTarget()
            }
            .accessibilityLabel(model.isFav(id) ? "Remove from favorites" : "Add to favorites")
            .accessibilityValue(model.isFav(id) ? "Favorited" : "")
            .accessibilityIdentifier("favButton")
        case nil where model.tab == .current:
            // the next bus at the nearest stop, one glance (web metaNearby "53RD · 4 min")
            Text(model.nearbyMeta).font(.subheadline.weight(.semibold)).foregroundStyle(Palette.text2).monospacedDigit()
                .fixedSize()
                .accessibilityLabel(model.nearbyMeta.isEmpty ? "" : "Next bus at the nearest stop: " + model.nearbyMeta)
        case nil where model.tab == .routes:
            Button { model.editingOrder.toggle() } label: {
                Text(model.editingOrder ? "Done" : "Edit map order").font(.subheadline.weight(.semibold))
                    .frame(minHeight: 44).contentShape(Rectangle())
            }
        default:
            EmptyView()
        }
    }
}

/// The current page of the selected tab.
struct SheetContent: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        switch model.page {
        case .route(let rid): RouteDetailView(rid: rid)
        case .stop(let id): StopDetailView(stopId: id)
        case .customRoute(let id): CustomRouteDetailView(id: id)
        case .editCustom(let id): CustomRouteEditor(id: id)
        case .about: AboutView()
        case .directions: DirectionsView()
        case .alerts: AlertsView()
        case .pick: PickView()
        case nil:
            switch model.tab {
            case .current: CurrentTripView()
            case .routes: RoutesView()
            case .myroutes: MyRoutesView()
            }
        }
    }
}
