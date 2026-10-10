import SwiftUI
import StraightBussingKit

/// Routes tab (ui/views/routes.js): Edit map order first, Show all / Hide all, Running / Scheduled, no live
/// location / Not running / Hidden groups with a per-route eye toggle (persisted), official contact at the
/// bottom. A scheduled route with no reporting bus is never "Not running" (Operating silent service; rider
/// safety), and a feed outage is "Live status unknown".
struct RoutesView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        List {
            if model.editingOrder { orderSection } else { listSections }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .environment(\.editMode, .constant(model.editingOrder ? .active : .inactive))
        .accessibilityIdentifier("routesList")
    }

    var orderSection: some View {
        let order = RouteVisibility.drawOrder(model.routeState)
        return Section {
            ForEach(order, id: \.self) { rid in
                HStack(spacing: 10) {
                    RouteChip(route: model.route(rid), rid: rid)
                    Text(model.route(rid)?.displayName ?? rid)
                }
            }
            .onMove { from, to in
                guard let i = from.first else { return }
                model.apply(Custom.moveToIndex(model.routeState, order[i], to > i ? to - 1 : to))
            }
        } header: {
            Text("Map order")
        } footer: {
            Text("Routes higher in the list are drawn on top of the others on the map.")
        }
    }

    @ViewBuilder var listSections: some View {
        let s = model.routeState
        let hidden = Set(model.hidden)
        let all = model.staticData.routeIds
        Section {
            HStack {
                Button("Show all") { model.apply(Custom.showAll(s)) }.buttonStyle(.bordered)
                Spacer()
                Button("Hide all") { model.apply(Custom.hideAll(s)) }.buttonStyle(.bordered)
            }
        }
        if let c = RouteVisibility.activeCustomRoute(s) {
            Section {
                HStack {
                    Label("Showing \u{201C}\(c.name)\u{201D}", systemImage: "bookmark.fill")
                    Spacer()
                    Button("Clear") { model.apply(Custom.clearCustom(s)) }
                }
            }
        }
        if let j = s.journey, !j.rids.isEmpty {
            Section {
                Text("Only the routes of your trip to \(j.label) are shown. End the trip in Current trip to see all routes.")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
        }
        let svc = model.staticData.service
        let outage = model.liveOutage
        let running = all.filter { !hidden.contains($0) && model.running($0) > 0 }
        let scheduled: [String] = outage ? [] : all.filter {
            !hidden.contains($0) && model.running($0) == 0 && Operating.scheduledNoLive($0, buses: model.buses, service: svc, now: model.now)
        }
        let idle = all.filter { !hidden.contains($0) && model.running($0) == 0 && !scheduled.contains($0) }
        let off = all.filter { hidden.contains($0) }
        if model.silentService {   // fresh but empty feed while routes are scheduled
            Section {
                VStack(alignment: .leading, spacing: 4) {
                    Text("No live locations right now").font(.headline)
                    Text(Operating.silentText(scheduled, routes: model.staticData.routes, service: svc, now: model.now, phone: "773.702.8181"))
                        .font(.subheadline).foregroundStyle(.secondary)
                }
                .accessibilityElement(children: .combine)
            }
        }
        if !running.isEmpty { Section("Running") { ForEach(running, id: \.self) { RouteRow(rid: $0, hidden: false) } } }
        if !scheduled.isEmpty { Section("Scheduled, no live location") { ForEach(scheduled, id: \.self) { RouteRow(rid: $0, hidden: false) } } }
        let idleTitle: String = outage ? "Live status unknown" : "Not running"
        if !idle.isEmpty { Section(idleTitle) { ForEach(idle, id: \.self) { RouteRow(rid: $0, hidden: false) } } }
        if !off.isEmpty { Section("Hidden") { ForEach(off, id: \.self) { RouteRow(rid: $0, hidden: true) } } }
        Section {
            OfficialContact()
        } footer: {
            Text("Unofficial app. Schedules come from the published GTFS feed; live positions from the public shuttle feed.")
        }
    }
}

struct RouteRow: View {
    @Environment(AppModel.self) private var model
    let rid: String
    let hidden: Bool

    var body: some View {
        let r = model.route(rid)
        let n = model.running(rid)
        HStack(spacing: 10) {
            Button { model.push(.route(rid)) } label: {
                HStack(spacing: 10) {
                    RouteChip(route: r, rid: rid)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(r?.displayName ?? rid).font(.body.weight(.medium)).foregroundStyle(hidden ? .secondary : .primary)
                        Text(subtitle(n)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                    Spacer()
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            Button { model.apply(Custom.toggleHidden(model.routeState, rid)) } label: {
                Image(systemName: hidden ? "eye.slash" : "eye").font(.body).tapTarget()
            }
            .buttonStyle(.borderless)
            .accessibilityLabel(hidden ? "Show \(r?.displayName ?? rid) on the map" : "Hide \(r?.displayName ?? rid) on the map")
            .accessibilityIdentifier("eye.\(rid)")
        }
        .frame(minHeight: 44)
    }

    func subtitle(_ n: Int) -> String {
        if n > 0 { return "\(n) bus\(n == 1 ? "" : "es") running" }
        if model.liveOutage { return "Live status unknown" }   // a feed outage is not "not running"
        if let s = Operating.noLiveStatus(rid, buses: model.buses, service: model.staticData.service, now: model.now) { return s }
        if let h = Schedule.hoursOn(model.staticData.service, rid, model.now) { return "Today: \(h.label)" }
        return "Not running right now"
    }
}
