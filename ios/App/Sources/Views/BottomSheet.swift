import SwiftUI
import StraightBussingKit

/// Custom bottom sheet with three detents (peek / half / full) that rests on the tab bar (the web's
/// ui/sheet.js). The grab handle and header drag it; a fling snaps by velocity; VoiceOver can adjust it.
struct BottomSheet<Content: View>: View {
    @Binding var detent: Detent
    let available: CGFloat
    @ViewBuilder var content: Content
    @GestureState private var drag: CGFloat = 0
    static var shape: UnevenRoundedRectangle { UnevenRoundedRectangle(topLeadingRadius: 16, topTrailingRadius: 16) }

    static func height(for d: Detent, available: CGFloat) -> CGFloat {
        switch d {
        case .peek: return min(available, 132)
        case .half: return max(220, available * 0.46)
        case .full: return available
        }
    }

    var body: some View {
        let base = Self.height(for: detent, available: available)
        let h = min(available, max(Self.height(for: .peek, available: available) - 40, base - drag))
        VStack(spacing: 0) {
            Capsule()
                .fill(Color.secondary.opacity(0.45))
                .frame(width: 38, height: 5)
                .padding(.top, 7)
                .padding(.bottom, 4)
                .frame(maxWidth: .infinity, minHeight: 22)
                .contentShape(Rectangle())
                .gesture(dragGesture)
                .accessibilityElement()
                .accessibilityLabel("Resize panel")
                .accessibilityValue(["Collapsed", "Half", "Expanded"][detent.rawValue])
                .accessibilityAdjustableAction { dir in
                    switch dir {
                    case .increment: detent = Detent(rawValue: min(2, detent.rawValue + 1)) ?? .full
                    case .decrement: detent = Detent(rawValue: max(0, detent.rawValue - 1)) ?? .peek
                    @unknown default: break
                    }
                }
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .frame(height: h, alignment: .top)
        .frame(maxWidth: .infinity)
        .clipShape(Self.shape)
        // The shadow belongs to the background shape, not to the clipped content: a shadow on content makes
        // SwiftUI render the whole sheet offscreen on every drag frame; on a filled shape it is cheap.
        .background(
            Self.shape
                .fill(Color(.systemGroupedBackground))
                .shadow(color: .black.opacity(0.18), radius: 10, y: -2)
        )
        .animation(.spring(response: 0.35, dampingFraction: 0.86), value: detent)
    }

    var dragGesture: some Gesture {
        DragGesture(minimumDistance: 4)
            .updating($drag) { v, state, _ in state = v.translation.height }
            .onEnded { v in
                let base = Self.height(for: detent, available: available)
                let projected = base - v.predictedEndTranslation.height
                let options = Detent.allCases.map { ($0, Self.height(for: $0, available: available)) }
                detent = options.min { abs($0.1 - projected) < abs($1.1 - projected) }?.0 ?? detent
            }
    }
}

/// Header (back button + title) and the current page of the selected tab.
struct SheetContent: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        VStack(spacing: 0) {
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
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityIdentifier("sheetTitle")
                Spacer()
                trailing
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 6)
            page
        }
    }

    @ViewBuilder var trailing: some View {
        switch model.page {
        case .stop(let id):
            Button { model.apply(Custom.toggleFav(model.routeState, id)) } label: {
                Image(systemName: model.isFav(id) ? "star.fill" : "star").font(.title3).foregroundStyle(.orange).tapTarget()
            }
            .accessibilityLabel(model.isFav(id) ? "Remove favorite" : "Add favorite")
        case nil where model.tab == .routes:
            Button(model.editingOrder ? "Done" : "Edit map order") { model.editingOrder.toggle() }
                .font(.subheadline.weight(.semibold))
        default:
            EmptyView()
        }
    }

    @ViewBuilder var page: some View {
        switch model.page {
        case .route(let rid): RouteDetailView(rid: rid)
        case .stop(let id): StopDetailView(stopId: id)
        case .customRoute(let id): CustomRouteDetailView(id: id)
        case .editCustom(let id): CustomRouteEditor(id: id)
        case .about: AboutView()
        case .directions: DirectionsView()
        case nil:
            switch model.tab {
            case .current: CurrentTripView()
            case .routes: RoutesView()
            case .myroutes: MyRoutesView()
            }
        }
    }
}
