import SwiftUI
import StraightBussingKit

/// My Routes tab (ui/views/myroutes.js): custom route sets (tap = show on the map / stop showing; swipe left or
/// long-press = Details / Edit / Delete, a full swipe never runs an action, Delete asks first), favorite stations
/// with their next bus (Edit = reorder / remove), Service alerts, About and Settings.
struct MyRoutesView: View {
    @Environment(AppModel.self) private var model
    @State private var favEdit = false

    var body: some View {
        let s = model.routeState
        let favs = s.favStops.filter { model.staticData.stops[$0] != nil }
        List {
            Section {
                if s.customRoutes.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Save the routes you ride").font(.headline)
                        Text("Group routes into a named set, like your commute, and show just those on the map with one tap.")
                            .font(.subheadline).foregroundStyle(.secondary)
                        Button { model.push(.editCustom(nil)) } label: {
                            Label("New custom route", systemImage: "plus").frame(maxWidth: .infinity, minHeight: 44)
                        }
                        .buttonStyle(.borderedProminent)
                    }
                    .padding(.vertical, 6)
                }
                ForEach(s.customRoutes) { c in
                    CustomRouteRow(c: c, active: s.activeCustom == c.id)
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            // Trailing edge: first button sits at the edge -> reads Details | Edit | Delete.
                            Button { model.requestDelete(c, from: "list") } label: { Text("Delete") }
                                .tint(.red)
                            Button { model.push(.editCustom(c.id)) } label: { Text("Edit") }
                                .tint(.orange)
                            Button { model.push(.customRoute(c.id)) } label: { Text("Details") }
                                .tint(.gray)
                        }
                        .contextMenu {
                            Button { model.push(.customRoute(c.id)) } label: { Label("Details", systemImage: "info.circle") }
                            Button { model.push(.editCustom(c.id)) } label: { Label("Edit", systemImage: "pencil") }
                            Button(role: .destructive) { model.requestDelete(c, from: "list") } label: { Label("Delete", systemImage: "trash") }
                        }
                }
            } header: {
                HStack {
                    Text("Custom routes")
                    Spacer()
                    if !s.customRoutes.isEmpty {
                        Button { model.push(.editCustom(nil)) } label: { Label("New", systemImage: "plus") }
                            .font(.subheadline).textCase(nil)
                            .accessibilityLabel("New custom route")
                    }
                }
            } footer: {
                if !s.customRoutes.isEmpty {
                    Text("Tap a custom route to show it on the map. Swipe left or touch and hold for details, edit or delete.")
                }
            }

            Section {
                if favs.isEmpty {
                    HStack(spacing: 10) {
                        Image(systemName: "star").font(.title2).foregroundStyle(.orange).accessibilityHidden(true)
                        Text("Open a station on the map and tap Favorite. It will show up here with its next bus.")
                            .font(.subheadline).foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)
                }
                ForEach(favs, id: \.self) { id in FavoriteRow(id: id, editing: favEdit) }
                    .onMove { from, to in model.moveFavorites(from: from, to: to) }
                    .onDelete { idx in for i in idx { model.removeFavorite(favs[i]) } }
                    .deleteDisabled(!favEdit)
                    .moveDisabled(!favEdit)
            } header: {
                HStack {
                    Text("Favorite stations")
                    Spacer()
                    if !favs.isEmpty {
                        Button(favEdit ? "Done" : "Edit") { favEdit.toggle() }
                            .font(.subheadline).textCase(nil)
                            .accessibilityValue(favEdit ? "Editing" : "")
                    }
                }
            }

            Section {
                let n = model.activeAlerts.count
                Button { model.push(.alerts) } label: {
                    HStack {
                        Label {
                            VStack(alignment: .leading, spacing: 1) {
                                Text("Service alerts").foregroundStyle(.primary)
                                Text(n > 0 ? "\(n) active alert\(n == 1 ? "" : "s")" : "None right now").font(.caption).foregroundStyle(.secondary)
                            }
                        } icon: { Image(systemName: "exclamationmark.triangle") }
                        Spacer()
                        if n > 0 {
                            Text("\(n)").font(.caption.weight(.bold)).foregroundStyle(.white)
                                .padding(.horizontal, 7).padding(.vertical, 2).background(.red, in: Capsule())
                                .accessibilityHidden(true)
                        }
                    }
                }
                .accessibilityLabel("Service alerts, \(n > 0 ? "\(n) active" : "none right now")")
                Button { model.push(.about) } label: {
                    Label {
                        VStack(alignment: .leading, spacing: 1) {
                            Text("About this app").foregroundStyle(.primary)
                            Text("Unofficial. Privacy, theme, official contact").font(.caption).foregroundStyle(.secondary)
                        }
                    } icon: { Image(systemName: "info.circle") }
                }
                Button { model.showSettings = true } label: { Label("Settings", systemImage: "gearshape") }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .environment(\.editMode, .constant(favEdit ? .active : .inactive))
        .accessibilityIdentifier("myRoutesList")
    }
}

/// A favorite station with its next visible bus (myroutes.js favRow).
struct FavoriteRow: View {
    @Environment(AppModel.self) private var model
    let id: String
    let editing: Bool
    var body: some View {
        let name = model.staticData.stops[id]?.name ?? id
        let a = model.liveLoaded ? model.arrivals(at: id).first : nil
        let sub = a.map { model.longName($0.rid) } ?? (model.liveOutage ? "Live times unavailable"
            : model.liveLoaded ? "No upcoming buses on your visible routes" : "Waiting for live data")
        let m = a.map { max(0, TimeFmt.minsUntil($0.t, from: model.now)) } ?? 0
        Button { if !editing { model.push(.stop(id)) } } label: {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(name).foregroundStyle(.primary).lineLimit(1)
                    HStack(spacing: 4) {
                        if let a { RouteChip(route: model.route(a.rid), rid: a.rid, size: 11) }
                        Text(sub).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                Spacer()
                if let a, !editing { EtaText(t: a.t, now: model.now, stale: model.isStale) }
            }
            .frame(minHeight: 48)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(name + (a.map { ", next bus \(model.longName($0.rid)) in \(m) min" } ?? ", " + sub))
        .accessibilityAddTraits(.isButton)
    }
}

/// Fixed-height row with a check circle (aria-pressed in the web); tap toggles showing it on the map.
struct CustomRouteRow: View {
    @Environment(AppModel.self) private var model
    let c: CustomRoute
    let active: Bool

    var body: some View {
        let rids = c.rids.filter { model.route($0) != nil }
        Button { model.toggleCustom(c) } label: {
            HStack(spacing: 12) {
                Image(systemName: active ? "checkmark.circle.fill" : "circle")
                    .font(.title2)
                    .foregroundStyle(active ? Color.accentColor : Color.secondary)
                VStack(alignment: .leading, spacing: 4) {
                    Text(c.name).font(.body.weight(.semibold)).foregroundStyle(.primary).lineLimit(1)
                    HStack(spacing: 4) {
                        if rids.isEmpty { Text("No routes").font(.caption).foregroundStyle(.secondary) }
                        ForEach(rids.prefix(6), id: \.self) { RouteChip(route: model.route($0), rid: $0, size: 11) }
                        if rids.count > 6 { Text("+\(rids.count - 6)").font(.caption).foregroundStyle(.secondary) }
                    }
                }
                Spacer()
            }
            .frame(height: 52)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(c.name), \(rids.count) route\(rids.count == 1 ? "" : "s"). Show on the map")
        .accessibilityValue(active ? "Shown on the map" : "Not shown")
        .accessibilityAddTraits(active ? .isSelected : [])
        .accessibilityIdentifier("custom.\(c.id)")
    }
}

/// Details of a custom route (myroutes.js renderCustom): showing or not, Show on map / Stop showing, Edit /
/// Delete, its routes with live status, the next bus at the stop nearest you, and Highlight toggles.
struct CustomRouteDetailView: View {
    @Environment(AppModel.self) private var model
    let id: String

    var body: some View {
        let s = model.routeState
        if let c = s.customRoutes.first(where: { $0.id == id }) {
            let on = s.activeCustom == id
            let rids = c.rids.filter { model.route($0) != nil }
            List {
                Section {
                    Label(on ? "Showing on the map \u{00B7} \(rids.count) route\(rids.count == 1 ? "" : "s")" : "Not showing on the map \u{00B7} \(rids.count) route\(rids.count == 1 ? "" : "s")",
                          systemImage: on ? "checkmark.circle.fill" : "circle")
                        .font(.subheadline.weight(.semibold))
                    Button {
                        if on { model.apply(Custom.clearCustom(s)) } else { model.apply(Custom.applyCustom(s, id)); model.fitRoutes(c.rids) }
                    } label: { Text(on ? "Stop showing" : "Show on map").frame(maxWidth: .infinity, minHeight: 44) }
                        .buttonStyle(.borderedProminent)
                    if on && !Custom.matchesCurrent(s, c) {
                        Text("You changed the visible routes since applying it.").font(.caption).foregroundStyle(.secondary)
                    }
                    HStack {
                        Button { model.push(.editCustom(id)) } label: { Label("Edit", systemImage: "pencil").frame(maxWidth: .infinity, minHeight: 44) }
                            .buttonStyle(.bordered)
                        Button(role: .destructive) { model.requestDelete(c, from: "detail") } label: {
                            Label("Delete", systemImage: "trash").frame(maxWidth: .infinity, minHeight: 44)
                        }
                        .buttonStyle(.bordered)
                    }
                }
                Section {
                    if rids.isEmpty {
                        Text("None of these routes are in the current schedule. Edit to choose others.").font(.subheadline).foregroundStyle(.secondary)
                    }
                    ForEach(rids, id: \.self) { rid in CustomRouteLine(customId: id, rid: rid, highlighted: c.highlight.contains(rid)) }
                } header: {
                    Text("Routes")
                } footer: {
                    if rids.count > 1 {
                        Text(on ? "Highlight dims the other routes in this set on the map." : "Highlights apply while this custom route is showing.")
                    }
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
        } else {
            VStack(spacing: 10) {
                EmptyStateView(title: "Custom route not found", message: "It may have been deleted.")
                Button { model.popToRoot() } label: { Text("Back to My Routes").frame(maxWidth: .infinity, minHeight: 44) }.buttonStyle(.bordered)
            }
            .padding(16)
        }
    }
}

/// A route in a custom route: live status + the next bus at your nearest stop, and a Highlight toggle.
struct CustomRouteLine: View {
    @Environment(AppModel.self) private var model
    let customId: String
    let rid: String
    let highlighted: Bool

    /// Next arrival of the route at its stop nearest you (within 1.5 km), or nil without location.
    var nearestNext: (t: Double, stop: String)? {
        guard let u = model.user, model.liveLoaded else { return nil }
        var best: (sid: String, d: Double)? = nil
        for sid in Set(model.staticData.routeStops[rid] ?? []) {
            guard let s = model.staticData.stops[sid] else { continue }
            let d = Geo.hav(u, s.coord)
            if best == nil || d < best!.d { best = (sid, d) }
        }
        guard let b = best, b.d <= 1500, let a = model.arrivals(at: b.sid, routeId: rid).first else { return nil }
        return (a.t, model.staticData.stops[b.sid]?.name ?? b.sid)
    }

    var body: some View {
        let n = model.running(rid)
        let run = n > 0 ? "\(n) bus\(n == 1 ? "" : "es") running" : model.liveOutage ? "Live status unavailable"
            : Operating.noLiveStatus(rid, buses: model.buses, service: model.staticData.service, now: model.now) ?? "Not running right now"
        let next = nearestNext.map { " \u{00B7} \(model.isStale ? "~" : "")\(max(0, TimeFmt.minsUntil($0.t, from: model.now))) min at \($0.stop)" } ?? ""
        HStack(spacing: 10) {
            Button { model.push(.route(rid)) } label: {
                HStack(spacing: 10) {
                    RouteChip(route: model.route(rid), rid: rid)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(model.longName(rid)).foregroundStyle(.primary)
                        HStack(spacing: 4) {
                            if n > 0 { LiveDot() }
                            Text(run + next).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            Button { model.apply(Custom.toggleHighlight(model.routeState, customId, rid)) } label: {
                Label("Highlight", systemImage: highlighted ? "checkmark.circle.fill" : "circle")
                    .font(.caption.weight(.semibold))
                    .frame(minWidth: 44, minHeight: 44)
            }
            .buttonStyle(.borderless)
            .accessibilityLabel("Highlight \(model.longName(rid))")
            .accessibilityValue(highlighted ? "On" : "Off")
            .accessibilityAddTraits(highlighted ? .isSelected : [])
        }
        .frame(minHeight: 48)
    }
}

/// Create / edit a custom route (myroutes.js renderEditor): name ("My route N" by default) and routes grouped
/// Running now / Scheduled, no live location / Not running; "Choose at least one route." next to the list.
struct CustomRouteEditor: View {
    @Environment(AppModel.self) private var model
    let id: String?
    @State private var name = ""
    @State private var picked: Set<String> = []
    @State private var loaded = false
    @State private var error = ""

    var body: some View {
        let all = model.staticData.routeIds
        let running = all.filter { model.running($0) > 0 }
        let sched = model.liveOutage ? [] : all.filter { !running.contains($0) && Operating.scheduledNoLive($0, buses: model.buses, service: model.staticData.service, now: model.now) }
        let idle = all.filter { !running.contains($0) && !sched.contains($0) }
        List {
            Section("Name") {
                TextField("My route", text: $name).textInputAutocapitalization(.words).accessibilityIdentifier("customName")
            }
            if !error.isEmpty {
                Section { Label(error, systemImage: "exclamationmark.circle").foregroundStyle(.red).font(.subheadline) }
            }
            group("Running now", running)
            group("Scheduled, no live location", sched)
            group(model.liveOutage ? "Live status unknown" : "Not running", idle)
            Section {
                HStack {
                    Button("Cancel") { model.back() }.buttonStyle(.bordered)
                    Spacer()
                    Button("Save") { save() }.buttonStyle(.borderedProminent).font(.headline).accessibilityIdentifier("customSave")
                }
                if let id, let c = model.routeState.customRoutes.first(where: { $0.id == id }) {
                    Button(role: .destructive) { model.requestDelete(c, from: "edit") } label: {
                        Label("Delete custom route", systemImage: "trash").frame(maxWidth: .infinity, minHeight: 44)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .onAppear {
            guard !loaded else { return }
            loaded = true
            if let id, let c = model.routeState.customRoutes.first(where: { $0.id == id }) {
                name = c.name
                picked = Set(c.rids)
            } else {
                name = Custom.defaultName(model.routeState)   // never suggest a name already taken
            }
        }
    }

    @ViewBuilder func group(_ title: String, _ rids: [String]) -> some View {
        if !rids.isEmpty {
            Section(title) {
                ForEach(rids, id: \.self) { rid in
                    Button {
                        if picked.contains(rid) { picked.remove(rid) } else { picked.insert(rid) }
                        error = ""
                    } label: {
                        HStack {
                            RouteChip(route: model.route(rid), rid: rid)
                            Text(model.longName(rid)).foregroundStyle(.primary)
                            Spacer()
                            Image(systemName: picked.contains(rid) ? "checkmark.circle.fill" : "circle")
                                .foregroundStyle(picked.contains(rid) ? Color.accentColor : Color.secondary)
                        }
                        .frame(minHeight: 44)
                    }
                    .accessibilityValue(picked.contains(rid) ? "Selected" : "Not selected")
                    .accessibilityAddTraits(picked.contains(rid) ? .isSelected : [])
                }
            }
        }
    }

    func save() {
        let order = model.staticData.routeIds.filter { picked.contains($0) }
        guard !order.isEmpty else { error = "Choose at least one route."; return }
        if let id, model.routeState.customRoutes.contains(where: { $0.id == id }) {
            model.saveCustomRoute(id: id, name: name, rids: order)
        } else {
            model.createCustomRoute(name: name, rids: order)
        }
    }
}
