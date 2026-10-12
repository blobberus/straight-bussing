import SwiftUI
import StraightBussingKit

/// Custom bottom sheet with three detents (peek / half / full) that rests on the tab bar (the web's ui/sheet.js).
/// Owner request 2026-10-12 ("like Google Maps on an iPhone"): it follows the finger 1:1 from the grab bar, the
/// header and, at peek and half, the content (a vertical drag there moves the sheet, as in Maps; at full the
/// content scrolls); a slow release settles at the nearest detent and a flick is projected like a thrown scroll
/// view (Kit `SheetSnap`), so a quick swipe down from full collapses it entirely; the settle is a spring that
/// starts at the finger's speed. Laid out once at full height and slid with an offset: dragging never re-lays out
/// the content (smooth on a phone). VoiceOver adjusts it like a slider; Reduce Motion: a short ease, no spring.
struct BottomSheet<Header: View, Content: View>: View {
    @Binding var detent: Detent
    let available: CGFloat
    @ViewBuilder var header: Header
    @ViewBuilder var content: Content
    /// Finger travel since the drag began (positive = down).
    @State private var drag: CGFloat = 0
    @State private var tracking = false
    /// A content drag: nil = not decided yet, true = it moves the sheet, false = horizontal (swipe actions, chips).
    @State private var contentDrag: Bool?
    /// The release spring (carries the finger's velocity) until it settles; nil = the default spring.
    @State private var settle: Animation?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    static var shape: UnevenRoundedRectangle { UnevenRoundedRectangle(topLeadingRadius: Radius.sheet, topTrailingRadius: Radius.sheet, style: .continuous) }

    static func height(for d: Detent, available: CGFloat) -> CGFloat {
        switch d {
        case .peek: return min(available, 132)
        // 48 %: on a 6.1-inch iPhone (393 x 852 pt) the nearest stop with 3 arrivals and the one-line alert row fit
        // whole under the Current trip title (ship checklist item 3: the next bus in one glance)
        case .half: return max(220, available * 0.48)
        case .full: return available
        }
    }

    var heights: [Double] { Detent.allCases.map { Double(Self.height(for: $0, available: available)) } }
    var defaultAnimation: Animation { reduceMotion ? .easeOut(duration: 0.15) : .spring(response: 0.35, dampingFraction: 0.86) }

    var body: some View {
        let base = Self.height(for: detent, available: available)
        let visible = CGFloat(SheetSnap.rubberBand(Double(base - drag), min: heights[0], max: Double(available)))
        let anim = settle ?? defaultAnimation
        VStack(spacing: 0) {
            grabber
            header
                .contentShape(Rectangle())
                .gesture(sheetDrag(minimumDistance: 6, fromContent: false))
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                // the part below the screen at this detent: every row can still scroll into view
                .safeAreaPadding(.bottom, available - base)
                .scrollDisabled(contentDrag == true)
                // at full the content scrolls; below full a vertical drag on it moves the sheet (Maps)
                .simultaneousGesture(sheetDrag(minimumDistance: 8, fromContent: true), including: detent == .full ? .subviews : .all)
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
        // rubber band past full
        .mask(alignment: .bottom) { Rectangle().frame(height: available + 400) }
    }

    /// The grab bar: 30 pt tall plus 8 pt of touch slop around it, so a press on the tab always starts a drag.
    var grabber: some View {
        Capsule()
            .fill(Palette.text2.opacity(0.45))
            .frame(width: 38, height: 5)
            .frame(maxWidth: .infinity, minHeight: 30)
            .contentShape(Rectangle().inset(by: -8))
            .gesture(sheetDrag(minimumDistance: 1, fromContent: false))
            .onTapGesture { cycle() }
            .accessibilityElement()
            .accessibilityLabel("Resize panel")
            .accessibilityValue(["Collapsed", "Half", "Expanded"][detent.rawValue])
            .accessibilityIdentifier("sheetGrabber")
            .accessibilityAdjustableAction { dir in
                switch dir {
                case .increment: detent = Detent(rawValue: min(2, detent.rawValue + 1)) ?? .full
                case .decrement: detent = Detent(rawValue: max(0, detent.rawValue - 1)) ?? .peek
                @unknown default: break
                }
            }
    }

    /// A tap on the grab bar: peek -> half -> full -> half (the web's grabber click).
    func cycle() {
        detent = detent == .peek ? .half : detent == .half ? .full : .half
    }

    /// Global coordinates: the sheet moves under the finger, so a local translation would feed back.
    func sheetDrag(minimumDistance: CGFloat, fromContent: Bool) -> some Gesture {
        DragGesture(minimumDistance: minimumDistance, coordinateSpace: .global)
            .onChanged { v in
                if fromContent {
                    if contentDrag == nil { contentDrag = abs(v.translation.height) > abs(v.translation.width) }
                    guard contentDrag == true else { return }
                }
                if !tracking { tracking = true; settle = nil }
                drag = v.translation.height
            }
            .onEnded { v in
                defer { if fromContent { contentDrag = nil } }
                guard !fromContent || contentDrag == true else { return }
                release(translation: v.translation.height, velocityDown: v.velocity.height)
            }
    }

    /// Snap by projected velocity (Kit `SheetSnap.target`) and settle with a spring that starts at the finger's speed.
    func release(translation: CGFloat, velocityDown: CGFloat) {
        let visible = Double(Self.height(for: detent, available: available) - translation)
        let idx = SheetSnap.target(heights: heights, visible: visible, velocityDown: Double(velocityDown))
        let target = Detent(rawValue: idx) ?? detent
        let v0 = SheetSnap.initialVelocity(visible: visible, target: heights[idx], velocityDown: Double(velocityDown))
        let anim: Animation = reduceMotion ? .easeOut(duration: 0.15)
            : .interpolatingSpring(Spring(duration: 0.4, bounce: 0.04), initialVelocity: v0)
        settle = anim
        withAnimation(anim) {
            tracking = false
            drag = 0
            detent = target
        } completion: {
            if !tracking { settle = nil }
        }
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
