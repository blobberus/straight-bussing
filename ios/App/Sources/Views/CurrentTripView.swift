import SwiftUI
import StraightBussingKit

/// "Current trip" tab (web view id `nearby`): the trip in progress (Google-Maps-style timeline) or a hint,
/// service alerts, then the next buses at the nearest stops in one glance (or "Arriving soon" without
/// location). Never dead-ends.
struct CurrentTripView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                if let p = model.tripProgress, let trip = model.activeTrip {
                    TripTimelineView(progress: p, trip: trip)
                } else {
                    Card {
                        HStack(spacing: 12) {
                            Image(systemName: "point.bottomleft.forward.to.point.topright.scurvepath").font(.title2).foregroundStyle(.blue)
                            VStack(alignment: .leading, spacing: 2) {
                                Text("No trip in progress").font(.headline)
                                Text("Search for a destination, pick an option and tap Start to follow your bus here, stop by stop.")
                                    .font(.subheadline).foregroundStyle(.secondary)
                            }
                        }
                        .padding(.vertical, 10)
                    }
                }
                AlertsBanner()
                if model.user != nil { nearest } else { noLocation }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
        }
        .accessibilityIdentifier("currentTrip")
    }

    @ViewBuilder var nearest: some View {
        SectionTitle(text: "Nearest stops")
        let stops = model.nearestStops()
        if stops.isEmpty {
            EmptyStateView(title: "No stops nearby", message: "No campus shuttle stop is within 1.5 km.", showOfficial: true)
        }
        ForEach(stops, id: \.id) { s in
            Card {
                Button { model.push(.stop(s.id)) } label: {
                    HStack {
                        Text(s.name).font(.headline).foregroundStyle(.primary).lineLimit(1)
                        Spacer()
                        Text("\(Int(Geo.walkMin(s.d * Geo.walkDetour).rounded(.up))) min walk").font(.caption).foregroundStyle(.secondary)
                        Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
                    }
                    .frame(minHeight: 40)
                }
                .buttonStyle(.plain)
                let arr = Array(model.arrivals(at: s.id).prefix(3))
                if arr.isEmpty {
                    Text(model.live.loaded ? "No live arrivals right now" : "Loading live data…")
                        .font(.subheadline).foregroundStyle(.secondary).padding(.bottom, 8)
                } else {
                    ForEach(arr, id: \.self) { a in
                        Divider()
                        ArrivalRow(a: a)
                    }
                }
            }
        }
    }

    @ViewBuilder var noLocation: some View {
        Card {
            VStack(alignment: .leading, spacing: 8) {
                Text(model.locState == .denied ? "Location is off" : "See the next bus at your stop")
                    .font(.headline)
                Text(model.locState == .denied
                     ? "You can still search a destination or browse routes and stations. Turn location on in iOS Settings to see nearby stops."
                     : "Your location stays on this iPhone.")
                    .font(.subheadline).foregroundStyle(.secondary)
                if model.locState != .denied {
                    Button { model.locate() } label: {
                        Label("Use my location", systemImage: "location.fill").frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
            .padding(.vertical, 10)
        }
        SectionTitle(text: "Arriving soon")
        let soon = soonest
        if soon.isEmpty {
            EmptyStateView(title: "No live arrivals", message: "No shuttles report arrivals right now.", showOfficial: true)
        } else {
            Card {
                ForEach(Array(soon.enumerated()), id: \.offset) { item in
                    if item.offset > 0 { Divider() }
                    Button { model.push(.stop(item.element.stop)) } label: {
                        VStack(alignment: .leading, spacing: 0) {
                            Text(model.staticData.stops[item.element.stop]?.name ?? "").font(.caption).foregroundStyle(.secondary).padding(.top, 6)
                            ArrivalRow(a: item.element.a)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    /// The next arrival per stop, soonest first (top 6).
    var soonest: [(stop: String, a: Arrival)] {
        var best: [String: Arrival] = [:]
        let hidden = Set(model.hidden)
        for tu in model.live.trips {
            guard let rid = tu.trip.routeId, !hidden.contains(rid) else { continue }
            for u in tu.stopTimeUpdates {
                guard let sid = u.stopId, u.time > model.now - 30 else { continue }
                if best[sid] == nil || u.time < best[sid]!.t { best[sid] = Arrival(rid: rid, t: u.time, bus: tu.vehicle.label, tripId: tu.trip.tripId) }
            }
        }
        let all: [(stop: String, a: Arrival)] = best.map { (stop: $0.key, a: $0.value) }
        return Array(all.sorted { $0.a.t < $1.a.t }.prefix(6))
    }
}

/// Active service alerts (count + first headline); full list in Settings.
struct AlertsBanner: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        let alerts = model.activeAlerts
        if let first = alerts.first {
            Button { model.showSettings = true } label: {
                HStack(spacing: 10) {
                    Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(alerts.count == 1 ? "Service alert" : "\(alerts.count) service alerts").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                        Text(first.header.isEmpty ? first.description : first.header).font(.subheadline).foregroundStyle(.primary).lineLimit(2)
                    }
                    Spacer()
                    Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
                }
                .padding(12)
                .background(Color.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 14))
            }
            .buttonStyle(.plain)
        }
    }
}
