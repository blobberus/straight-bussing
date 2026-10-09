import SwiftUI
import StraightBussingKit

/// My Routes tab (ui/views/myroutes.js): custom route sets (tap = show on the map / stop showing; swipe left
/// = Details / Edit / Delete, a full swipe never runs an action, Delete asks first), favorite stations, About.
struct MyRoutesView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let s = model.routeState
        List {
            Section {
                if s.customRoutes.isEmpty {
                    Text("No custom routes yet. Save the routes you use as a set and show only those on the map with one tap.")
                        .font(.subheadline).foregroundStyle(.secondary)
                }
                ForEach(s.customRoutes) { c in
                    CustomRouteRow(c: c, active: s.activeCustom == c.id)
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            // Trailing edge: first button sits at the edge -> reads Details | Edit | Delete.
                            // Words, not icons, like the web tray (Details / Edit / Delete).
                            Button { model.confirmDelete = c } label: { Text("Delete") }
                                .tint(.red)
                            Button { model.push(.editCustom(c.id)) } label: { Text("Edit") }
                                .tint(.orange)
                            Button { model.push(.customRoute(c.id)) } label: { Text("Details") }
                                .tint(.gray)
                        }
                }
                Button { model.push(.editCustom(nil)) } label: { Label("New custom route", systemImage: "plus.circle.fill") }
                    .frame(minHeight: 44)
                Button {
                    let made = Custom.saveVisibleAsCustom(s, name: "Visible routes")
                    model.apply(made.patch)
                } label: { Label("Save visible routes as a custom route", systemImage: "square.and.arrow.down") }
                    .frame(minHeight: 44)
            } header: {
                Text("Custom routes")
            } footer: {
                Text("Tap to show a custom route on the map. Swipe left for Details, Edit and Delete.")
            }

            Section("Favorite stations") {
                if s.favStops.isEmpty {
                    Text("Tap the star on a station to keep it here.").font(.subheadline).foregroundStyle(.secondary)
                }
                ForEach(s.favStops, id: \.self) { id in
                    Button { model.push(.stop(id)) } label: {
                        HStack {
                            Image(systemName: "star.fill").foregroundStyle(.orange)
                            Text(model.staticData.stops[id]?.name ?? id).foregroundStyle(.primary)
                            Spacer()
                            if let a = model.arrivals(at: id).first {
                                RouteChip(route: model.route(a.rid), rid: a.rid, size: 11)
                                EtaText(t: a.t, now: model.now)
                            }
                        }
                        .frame(minHeight: 44)
                    }
                }
            }

            Section {
                Button { model.push(.about) } label: { Label("About Straight Bussing", systemImage: "info.circle") }
                Button { model.showSettings = true } label: { Label("Settings", systemImage: "gearshape") }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .accessibilityIdentifier("myRoutesList")
    }
}

/// Fixed-height row with a check circle (aria-pressed in the web); tap toggles showing it on the map.
struct CustomRouteRow: View {
    @Environment(AppModel.self) private var model
    let c: CustomRoute
    let active: Bool

    var body: some View {
        Button {
            let s = model.routeState
            model.apply(active ? Custom.clearCustom(s) : Custom.applyCustom(s, c.id))
        } label: {
            HStack(spacing: 12) {
                Image(systemName: active ? "checkmark.circle.fill" : "circle")
                    .font(.title2)
                    .foregroundStyle(active ? Color.accentColor : Color.secondary)
                VStack(alignment: .leading, spacing: 4) {
                    Text(c.name).font(.body.weight(.semibold)).foregroundStyle(.primary)
                    HStack(spacing: 4) {
                        ForEach(c.rids.prefix(5), id: \.self) { RouteChip(route: model.route($0), rid: $0, size: 11) }
                        if c.rids.count > 5 { Text("+\(c.rids.count - 5)").font(.caption).foregroundStyle(.secondary) }
                    }
                }
                Spacer()
            }
            .frame(height: 52)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(c.name), \(c.rids.count) routes")
        .accessibilityValue(active ? "Shown on the map" : "Not shown")
        .accessibilityAddTraits(active ? .isSelected : [])
        .accessibilityIdentifier("custom.\(c.id)")
    }
}

/// Details of a custom route: its routes with highlight stars, show/stop showing, edit, delete.
struct CustomRouteDetailView: View {
    @Environment(AppModel.self) private var model
    let id: String

    var body: some View {
        let s = model.routeState
        if let c = s.customRoutes.first(where: { $0.id == id }) {
            List {
                Section {
                    Button(s.activeCustom == id ? "Stop showing on the map" : "Show on the map") {
                        model.apply(s.activeCustom == id ? Custom.clearCustom(s) : Custom.applyCustom(s, id))
                    }
                    if s.activeCustom == id && !Custom.matchesCurrent(s, c) {
                        Text("You changed the visible routes since applying it.").font(.caption).foregroundStyle(.secondary)
                    }
                }
                Section {
                    ForEach(c.rids, id: \.self) { rid in
                        HStack {
                            RouteChip(route: model.route(rid), rid: rid)
                            Text(model.route(rid)?.displayName ?? rid)
                            Spacer()
                            Button { model.apply(Custom.toggleHighlight(s, id, rid)) } label: {
                                Image(systemName: c.highlight.contains(rid) ? "star.fill" : "star").foregroundStyle(.orange).tapTarget()
                            }
                            .buttonStyle(.borderless)
                            .accessibilityLabel(c.highlight.contains(rid) ? "Stop emphasizing on the map" : "Emphasize on the map")
                        }
                    }
                } header: {
                    Text("Routes")
                } footer: {
                    Text("Starred routes are emphasized on the map while this custom route is shown.")
                }
                Section {
                    Button("Edit") { model.push(.editCustom(id)) }
                    Button("Delete", role: .destructive) { model.confirmDelete = c }
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
        } else {
            EmptyStateView(title: "Custom route not found", message: "It may have been deleted.")
        }
    }
}

/// Create / edit a custom route: name + route checklist.
struct CustomRouteEditor: View {
    @Environment(AppModel.self) private var model
    let id: String?
    @State private var name = ""
    @State private var picked: Set<String> = []
    @State private var loaded = false

    var body: some View {
        List {
            Section("Name") {
                TextField("My route", text: $name).textInputAutocapitalization(.words)
            }
            Section("Routes") {
                ForEach(model.staticData.routeIds, id: \.self) { rid in
                    Button {
                        if picked.contains(rid) { picked.remove(rid) } else { picked.insert(rid) }
                    } label: {
                        HStack {
                            RouteChip(route: model.route(rid), rid: rid)
                            Text(model.route(rid)?.displayName ?? rid).foregroundStyle(.primary)
                            Spacer()
                            if picked.contains(rid) { Image(systemName: "checkmark").foregroundStyle(Color.accentColor) }
                        }
                        .frame(minHeight: 40)
                    }
                    .accessibilityAddTraits(picked.contains(rid) ? .isSelected : [])
                }
            }
            Section {
                Button("Save") { save() }.disabled(picked.isEmpty).font(.headline)
                Button("Cancel", role: .cancel) { model.back() }
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
                picked = Set(Custom.visibleRids(model.routeState))
            }
        }
    }

    func save() {
        let order = model.staticData.routeIds.filter { picked.contains($0) }
        if let id {
            model.apply(Custom.updateCustom(model.routeState, id, name: name, rids: order))
        } else {
            model.apply(Custom.createCustom(model.routeState, name: name, rids: order).patch)
        }
        model.back()
    }
}
