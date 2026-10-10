import SwiftUI
import StraightBussingKit

/// Routes tab (ui/views/routes.js): Edit map order (header), the custom-route / journey bar ("Make this a custom
/// route", "Showing <name>", "<name> · edited" with Update / Save as new, "Only showing routes for …"), the
/// "Routes to <station>" filter chip, Show all / Hide all, then Running / Scheduled, no live location / Not
/// running / Hidden groups with a per-route eye toggle (persisted), official contact at the bottom. A scheduled
/// route with no reporting bus is never "Not running" (rider safety), and a feed outage is "Live status unknown".
struct RoutesView: View {
    @Environment(AppModel.self) private var model
    @State private var naming = false
    @State private var draft = ""
    @FocusState private var nameFocused: Bool

    var body: some View {
        List {
            // every section's rows on the token card color (Group hands the modifier to each section)
            Group {
                if model.editingOrder { orderSection } else { listSections }
            }
            .listRowBackground(Palette.card)
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .environment(\.editMode, .constant(model.editingOrder ? .active : .inactive))
        .accessibilityIdentifier("routesList")
    }

    var orderSection: some View {
        let order = RouteVisibility.drawOrder(model.routeState)
        return Section {
            ForEach(Array(order.enumerated()), id: \.element) { item in
                let rid = item.element
                HStack(spacing: 10) {
                    RouteChip(route: model.route(rid), rid: rid)
                    Text(model.longName(rid))
                }
                .accessibilityElement(children: .combine)
                .accessibilityValue("Position \(item.offset + 1) of \(order.count)")
                .accessibilityAction(named: "Move up") { model.moveRoute(rid, by: -1) }
                .accessibilityAction(named: "Move down") { model.moveRoute(rid, by: 1) }
            }
            .onMove { from, to in
                guard let i = from.first else { return }
                model.moveRoute(order[i], to: to > i ? to - 1 : to)
            }
            if !model.routeState.routeOrder.isEmpty {
                Button("Reset order") { model.resetMapOrder() }
            }
        } header: {
            Text("Map order").foregroundStyle(Palette.text2)
        } footer: {
            Text("Drag a route by its handle. Routes higher in this list are drawn on top on the map.").foregroundStyle(Palette.text2)
        }
        .listRowBackground(Palette.card)
    }

    // MARK: List

    struct Groups { var running: [String] = [], scheduled: [String] = [], idle: [String] = [], hidden: [String] = [] }

    /// Running / scheduled with no live bus ([] in a feed outage) / not running / hidden (routes.js groupRoutes).
    var groups: Groups {
        let hidden = Set(model.hidden), outage = model.liveOutage, svc = model.staticData.service
        var g = Groups()
        for id in model.routeList() {
            if hidden.contains(id) { g.hidden.append(id) }
            else if model.running(id) > 0 { g.running.append(id) }
            else if !outage && Operating.scheduledNoLive(id, buses: model.buses, service: svc, now: model.now) { g.scheduled.append(id) }
            else { g.idle.append(id) }
        }
        return g
    }

    @ViewBuilder var listSections: some View {
        let s = model.routeState
        let g = groups
        let total = g.running.count + g.scheduled.count + g.idle.count + g.hidden.count
        topBar
        if let f = s.routeFilter {
            Section {
                HStack {
                    Text("Routes to \(f.label)").font(.subheadline.weight(.semibold))
                    Spacer()
                    Button { model.clearRouteFilter() } label: { Image(systemName: "xmark.circle.fill").tapTarget() }
                        .buttonStyle(.borderless)
                        .accessibilityLabel("Clear station filter, show all routes")
                }
                if model.activeTrip == nil {
                    let on = s.journey?.kind == .station
                    Button(on ? "Show all routes" : "Only show these routes") { model.toggleStationJourney() }
                        .accessibilityAddTraits(on ? .isSelected : [])
                }
            }
        }
        if total == 0 {
            Section {
                if s.routeFilter != nil {
                    EmptyStateView(title: "No routes at this station", message: "Clear the filter to see every route.")
                } else {
                    EmptyStateView(title: "No routes", message: "The schedule data did not load. Reload the app.", showOfficial: true)
                }
            }
        } else {
            let empty = model.liveLoaded && model.buses.isEmpty
            if s.routeFilter == nil && (model.liveOutage || empty) {
                Section {
                    if model.liveOutage {
                        EmptyStateView(title: "Live bus status unavailable", message: "Can't reach the shuttle feed. Routes are listed below for reference.")
                    } else if model.silentService {
                        EmptyStateView(title: "No live locations right now",
                                       message: Operating.silentText(g.scheduled, routes: model.staticData.routes, service: model.staticData.service,
                                                                     now: model.now, phone: LiveText.phone))
                    } else {
                        EmptyStateView(title: "No shuttles running right now", message: "Routes are listed below for reference.")
                    }
                }
            }
            if s.journey == nil {
                Section {
                    let scope = s.routeFilter != nil ? " at this station" : ""
                    HStack {
                        Button("Show all") { model.showAllRoutes() }.secondaryButtonStyle().disabled(g.hidden.isEmpty)
                            .accessibilityLabel("Show all routes\(scope)")
                        Spacer()
                        Button("Hide all") { model.hideAllRoutes() }.secondaryButtonStyle().disabled(g.running.isEmpty && g.scheduled.isEmpty && g.idle.isEmpty)
                            .accessibilityLabel("Hide all routes\(scope)")
                    }
                }
            }
            if !g.running.isEmpty { Section(header: ListHeader("Running")) { ForEach(g.running, id: \.self) { RouteRow(rid: $0, hidden: false) } } }
            if !g.scheduled.isEmpty { Section(header: ListHeader("Scheduled, no live location")) { ForEach(g.scheduled, id: \.self) { RouteRow(rid: $0, hidden: false) } } }
            if !g.idle.isEmpty {
                Section(header: ListHeader(model.liveOutage ? "Live status unknown" : "Not running")) {
                    ForEach(g.idle, id: \.self) { RouteRow(rid: $0, hidden: false).opacity(empty ? 0.75 : 1) }
                }
            }
            if !g.hidden.isEmpty { Section(header: ListHeader(s.journey != nil ? "Not on this trip" : "Hidden")) { ForEach(g.hidden, id: \.self) { RouteRow(rid: $0, hidden: true) } } }
        }
        Section {
            OfficialContact()
        } footer: {
            Text("Unofficial app. Schedules come from the published GTFS feed; live positions from the public shuttle feed.")
                .foregroundStyle(Palette.text2)
        }
    }

    /// The custom-route / journey bar above the list (routes.js topBarHTML).
    @ViewBuilder var topBar: some View {
        let s = model.routeState
        if let j = s.journey {
            Section {
                HStack {
                    Text("Only showing routes for \(j.label)").font(.subheadline)
                    Spacer()
                    Button("Show all") { model.endJourney() }.buttonStyle(.borderless)
                }
                .accessibilityElement(children: .contain)
            }
        } else if naming {
            Section(header: ListHeader("Name this custom route")) {
                TextField("My route", text: $draft)
                    .textInputAutocapitalization(.words)
                    .submitLabel(.done)
                    .focused($nameFocused)
                    .onSubmit(saveName)
                    .accessibilityIdentifier("routesName")
                HStack {
                    Button("Cancel") { naming = false; draft = "" }.secondaryButtonStyle()
                    Spacer()
                    Button("Save") { saveName() }.primaryButtonStyle().controlSize(.large)
                }
            }
        } else if let c = RouteVisibility.activeCustomRoute(s) {
            Section {
                HStack {
                    if Custom.matchesCurrent(s, c) {
                        (Text("Showing ") + Text(c.name).bold()).font(.subheadline)
                    } else {
                        (Text(c.name).bold() + Text(" \u{00B7} edited")).font(.subheadline)
                    }
                    Spacer()
                    Button("Clear") { model.apply(Custom.clearCustom(model.routeState)) }.buttonStyle(.borderless)
                        .accessibilityLabel("Clear \(c.name), show your usual routes")
                }
                if !Custom.matchesCurrent(s, c) {
                    HStack {
                        Button("Update") { model.updateActiveCustomToVisible() }.secondaryButtonStyle()
                            .accessibilityLabel("Update \(c.name)")
                        Spacer()
                        Button("Save as new") { startNaming() }.secondaryButtonStyle()
                    }
                }
            }
        } else if !s.hiddenRoutes.isEmpty && !Custom.visibleRids(s).isEmpty {
            Section {
                Button { startNaming() } label: { Text("Make this a custom route").frame(maxWidth: .infinity, minHeight: 44) }
                    .accessibilityIdentifier("makeCustom")
            }
        }
    }

    func startNaming() {
        draft = Custom.defaultName(model.routeState)
        naming = true
        nameFocused = true
    }

    func saveName() {
        model.saveVisibleAsCustom(name: draft)
        naming = false
        draft = ""
        nameFocused = false
    }
}

struct RouteRow: View {
    @Environment(AppModel.self) private var model
    let rid: String
    let hidden: Bool

    var body: some View {
        let r = model.route(rid)
        let n = model.running(rid)
        // hidden only by the trip / station journey: no eye (the journey bar has Show all)
        let tripOff = hidden && model.routeState.journey != nil && !model.routeState.hiddenRoutes.contains(rid)
        HStack(spacing: 10) {
            Button { model.push(.route(rid)) } label: {
                HStack(spacing: 10) {
                    RouteChip(route: r, rid: rid)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(model.longName(rid)).font(.body.weight(.medium)).foregroundStyle(hidden ? Palette.text2 : Palette.text)
                        HStack(spacing: 4) {
                            if n > 0 && !hidden { LiveDot() }
                            Text(subtitle(n, tripOff: tripOff)).font(.caption).foregroundStyle(Palette.text2).lineLimit(2)
                        }
                    }
                    Spacer()
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if !tripOff {
                Button { model.toggleRouteHidden(rid) } label: {
                    Image(systemName: hidden ? "eye.slash" : "eye").font(.body).tapTarget()
                }
                .buttonStyle(.borderless)
                .accessibilityLabel(hidden ? "Show route \(r?.short ?? "") \(model.longName(rid))" : "Hide route \(r?.short ?? "") \(model.longName(rid))")
                .accessibilityValue(hidden ? "Hidden" : "Shown")
                .accessibilityIdentifier("eye.\(rid)")
            }
        }
        .frame(minHeight: 44)
    }

    func subtitle(_ n: Int, tripOff: Bool) -> String {
        if tripOff { return "Not part of this trip" }
        if hidden { return "Hidden from map and times" }
        if n > 0 { return "\(n) bus\(n == 1 ? "" : "es") running" }
        if model.liveOutage { return "Live status unknown" }   // a feed outage is not "not running"
        if let s = Operating.noLiveStatus(rid, buses: model.buses, service: model.staticData.service, now: model.now) { return s }
        // iOS adds today's hours to "Not running" (one glance without opening the route)
        if let h = Schedule.hoursOn(model.staticData.service, rid, model.now), h.first != nil { return "Not running · Today \(h.label)" }
        return "Not running"
    }
}
