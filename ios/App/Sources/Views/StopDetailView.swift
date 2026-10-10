import SwiftUI
import StraightBussingKit

/// Stop detail (ui/views/stop.js): arrivals (route chip, name, Live, ETA), routes serving it, address,
/// "Updated Ns ago", Directions from/to here.
struct StopDetailView: View {
    @Environment(AppModel.self) private var model
    let stopId: String

    var body: some View {
        let stop = model.staticData.stops[stopId]
        let arrivals = Array(model.arrivals(at: stopId).prefix(8))
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                if let a = model.staticData.addresses[stopId] {
                    Label(a.address + (a.neighborhood.map { ", \($0)" } ?? ""), systemImage: "mappin.and.ellipse")
                        .font(.subheadline).foregroundStyle(.secondary)
                }
                HStack(spacing: 6) {
                    ForEach(model.staticData.stopRoutes[stopId] ?? [], id: \.self) { RouteChip(route: model.route($0), rid: $0) }
                }
                SectionTitle(text: "Arrivals")
                Card {
                    if arrivals.isEmpty {
                        // silent feed while this stop's routes are scheduled: say so (rider safety)
                        let why = model.liveLoaded && model.silentService ? model.silentText(among: Set(model.staticData.stopRoutes[stopId] ?? [])) : nil
                        EmptyStateView(title: "No live arrivals",
                                       message: why ?? (model.liveLoaded ? "No bus reports this stop right now." : "Loading live data…"),
                                       showOfficial: model.liveLoaded)
                    }
                    ForEach(Array(arrivals.enumerated()), id: \.offset) { item in
                        if item.offset > 0 { Divider() }
                        ArrivalRow(a: item.element)
                    }
                }
                Text("Updated \(TimeFmt.ago(model.lastOk, from: model.now)). Times are live predictions (estimates).")
                    .font(.caption).foregroundStyle(.secondary)
                if let stop {
                    HStack {
                        Button {
                            model.dir.from = Endpoint(label: stop.name, coord: stop.coord, stopId: stopId)
                            model.dir.to = nil
                            model.openDirections()
                        } label: { Label("From here", systemImage: "arrow.up.circle").frame(maxWidth: .infinity, minHeight: 44) }
                        .buttonStyle(.bordered)
                        Button {
                            model.openDirections(to: Endpoint(label: stop.name, coord: stop.coord, stopId: stopId))
                        } label: { Label("Directions here", systemImage: "arrow.triangle.turn.up.right.circle.fill").frame(maxWidth: .infinity, minHeight: 44) }
                        .buttonStyle(.borderedProminent)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
        }
    }
}
