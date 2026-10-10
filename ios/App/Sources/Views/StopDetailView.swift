import SwiftUI
import StraightBussingKit

/// Stop detail (ui/views/stop.js): address, "Routes at this stop" (visible routes, each opens its route),
/// Directions to here / From here, live arrivals (route chip, name, Live / Live, delayed / Last known, ETA; each
/// opens its route), hidden routes counted with Show, and the freshness line. Favorite is the star in the header.
struct StopDetailView: View {
    @Environment(AppModel.self) private var model
    let stopId: String
    static let maxArrivals = 10

    var body: some View {
        if let stop = model.staticData.stops[stopId] {
            content(stop)
        } else {
            VStack(spacing: 10) {
                EmptyStateView(title: "Stop not found", message: "This stop is not in the current schedule.")
                Button { model.popToRoot(); model.select(.current) } label: { Text("Back to Current trip").frame(maxWidth: .infinity, minHeight: 44) }
                    .buttonStyle(.bordered)
            }
            .padding(16)
        }
    }

    func content(_ stop: Stop) -> some View {
        let hidden = Set(model.hidden)
        var all: [String] = []
        for r in model.staticData.stopRoutes[stopId] ?? [] where !all.contains(r) { all.append(r) }
        let shown = all.filter { !hidden.contains($0) }, hid = all.filter { hidden.contains($0) }
        let arrivals = Array(model.arrivals(at: stopId).prefix(Self.maxArrivals))
        return ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                Label(model.staticData.addresses[stopId]?.address ?? "Address not available", systemImage: "mappin.and.ellipse")
                    .font(.subheadline).foregroundStyle(Palette.text2)
                Text("Routes at this stop").font(.footnote.weight(.semibold)).foregroundStyle(Palette.text2).accessibilityAddTraits(.isHeader)
                if shown.isEmpty {
                    Text(all.isEmpty ? "No routes listed for this stop." : "None of your visible routes stop here.").font(.subheadline).foregroundStyle(Palette.text2)
                } else {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(shown, id: \.self) { rid in
                                Button { model.push(.route(rid)) } label: {
                                    RouteChip(route: model.route(rid), rid: rid).frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
                                }
                                    .buttonStyle(.plain)
                                    .accessibilityLabel("Route \(model.longName(rid))")
                            }
                        }
                    }
                }
                ViewThatFits(in: .horizontal) {
                    HStack { directionButtons(stop) }
                    VStack { directionButtons(stop) }
                }
                SectionTitle(text: "Arrivals")
                if !model.liveLoaded {
                    Card { SkeletonRows(count: 3) }
                } else if arrivals.isEmpty {
                    emptyArrivals(shown: shown)
                } else {
                    Card {
                        ForEach(Array(arrivals.enumerated()), id: \.offset) { item in
                            if item.offset > 0 { Divider() }
                            ArrivalButton(a: item.element)
                        }
                    }
                }
                if !hid.isEmpty {
                    let n = "+\(hid.count) hidden route\(hid.count > 1 ? "s" : "") also stop\(hid.count > 1 ? "" : "s") here"
                    if model.routeState.journey != nil {
                        Text("\(n) (hidden during your trip).").font(.subheadline).foregroundStyle(Palette.text2)
                    } else {
                        HStack {
                            Text("\(n).").font(.subheadline).foregroundStyle(Palette.text2)
                            Spacer()
                            Button("Show") { model.unhideRoutes(at: stopId) }.secondaryButtonStyle()
                                .accessibilityLabel("Show the hidden routes that stop here")
                        }
                    }
                }
                Text(LiveText.updatedText(lastOk: model.lastOk, failed: model.liveFailed, level: model.staleLevel, now: model.now))
                    .font(.caption.weight(model.staleLevel == .err ? .semibold : .regular))
                    .foregroundStyle(model.staleLevel == .err ? Palette.warn : Palette.text2)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
        }
    }

    /// "Directions" (to this stop; the primary action) and "From here". Labels never wrap: ViewThatFits stacks them.
    @ViewBuilder func directionButtons(_ stop: Stop) -> some View {
        Button {
            let to = Endpoint(label: stop.name, coord: stop.coord, stopId: stopId)
            if model.dir.from == nil || model.dir.from?.stopId == stopId {
                model.dir.from = model.user.map { Endpoint(label: "My location", coord: $0, isMe: true) }
            }
            model.dirActiveTo = false
            model.openDirections(to: to)
        } label: {
            Label("Directions", systemImage: "arrow.triangle.turn.up.right.circle.fill").lineLimit(1)
                .frame(maxWidth: .infinity, minHeight: 44)
        }
        .primaryButtonStyle()
        .accessibilityLabel("Directions to \(stop.name)")
        Button {
            model.dir.from = Endpoint(label: stop.name, coord: stop.coord, stopId: stopId)
            model.dir.to = nil
            model.dirActiveTo = true
            model.openDirections()
        } label: {
            Label("From here", systemImage: "arrow.up.circle").lineLimit(1)
                .frame(maxWidth: .infinity, minHeight: 44)
        }
        .buttonStyle(.bordered)
        .accessibilityLabel("Directions from \(stop.name)")
    }

    /// Why there is no time (stop.js): feed outage, silent scheduled service at this stop, nothing predicted.
    @ViewBuilder func emptyArrivals(shown: [String]) -> some View {
        let running = !model.buses.isEmpty
        let silent = !running && model.silentService
        let here = silent ? model.silentText(among: Set(shown)) : nil
        if model.liveOutage {
            EmptyStateView(title: "Live times unavailable", message: "Can't reach the shuttle feed, so we can't tell when the next bus comes.", showOfficial: true)
        } else if let here {
            EmptyStateView(title: "No live times right now", message: here, showOfficial: true)
        } else {
            EmptyStateView(title: "No upcoming arrivals",
                           message: running ? "Nothing is predicted at this stop right now." : silent ? "No visible route at this stop is scheduled right now." : "No shuttles are running right now.",
                           showOfficial: !running)
        }
    }
}
