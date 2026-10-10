import SwiftUI
import StraightBussingKit

/// "Routes to station…" (ui/views/pick.js): first asks how to find the station (current location / select a
/// station / type an address or place); NOTHING is highlighted until you choose. Then the stops within 1.5 km (or
/// the matching stations) are listed and ring-highlighted on the map; choosing one shows only the routes serving
/// it on the list and map ("Routes to <station>"). Works without location permission.
struct PickView: View {
    @Environment(AppModel.self) private var model
    @State private var query = ""
    @State private var places = PlaceUI()
    @State private var anchor: Endpoint?
    @State private var waiting = false

    static let radiusM = 1500.0

    struct Key: Equatable { var q: String; var exact: Bool; var mode: PickMode? }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                if let mode = model.pickMode {
                    head(mode)
                    Toggle(isOn: Binding(get: { model.pickOnly }, set: { model.pickOnly = $0 })) {
                        VStack(alignment: .leading, spacing: 1) {
                            Text("Only show the chosen station's routes")
                            Text("Hides other routes on the map until you clear the station").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .frame(minHeight: 44)
                    list(mode)
                    otherModes(mode)
                } else {
                    Hint("Find the station first. Nothing is shared until you choose.")
                    chooser
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
        }
        .accessibilityIdentifier("pickView")
        .onAppear { highlight(fit: true) }
        .onChange(of: highlightKey) { _, _ in highlight(fit: false) }
        .onChange(of: fitKey) { _, _ in highlight(fit: true) }
        .task(id: Key(q: query, exact: places.exact, mode: model.pickMode)) {
            guard model.pickMode == .addr, anchor == nil else { return }
            await PlaceSearchFlow.run(query, exact: places.exact, model: model, update: { places = $0 }, current: { places })
        }
    }

    // MARK: Modes

    var chooser: some View {
        Card {
            VStack(spacing: 0) {
                modeRow(.loc, "Use current location", "Stops within 1.5 km of you", "location")
                Divider()
                modeRow(.sel, "Select a station", "Search by station name", "bus")
                Divider()
                modeRow(.addr, "Type an address or place", "Find stops near a building or street", "mappin.and.ellipse")
            }
        }
    }

    func modeRow(_ m: PickMode, _ title: String, _ sub: String, _ icon: String) -> some View {
        Button { setMode(m) } label: {
            HStack(spacing: 12) {
                Image(systemName: icon).frame(width: 24).foregroundStyle(Color.accentColor).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 1) {
                    Text(title).foregroundStyle(.primary)
                    Text(sub).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
            }
            .frame(minHeight: 52).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("pick.\(m.rawValue)")
    }

    func setMode(_ m: PickMode) {
        query = ""; places = PlaceUI(); anchor = nil
        model.pickMode = m
        if m == .loc && model.user == nil {
            waiting = true
            model.locate()
        }
    }

    @ViewBuilder func head(_ mode: PickMode) -> some View {
        switch mode {
        case .sel:
            SearchField(placeholder: "Search station name", text: $query, identifier: "pickQuery") {
                if let first = items.first { model.chooseStation(first.id) }
            }
        case .addr:
            if let a = anchor {
                Card {
                    HStack {
                        VStack(alignment: .leading, spacing: 1) {
                            Text("Stops within 1.5 km of").font(.caption).foregroundStyle(.secondary)
                            Text(a.label).font(.subheadline.weight(.semibold))
                        }
                        Spacer()
                        Button("Change") { anchor = nil; query = "" }.frame(minWidth: 44, minHeight: 44)
                    }
                }
            } else {
                SearchField(placeholder: "Address, building or place", text: $query, identifier: "pickQuery") {
                    if let p = places.items.first { anchor = Endpoint(label: p.label, coord: p.coord, sub: p.sub) }
                }
                PhotonNote()
            }
        case .loc:
            Hint("Nearest stops within 1.5 km of you. Tap one to see its routes.")
        }
    }

    /// Stops to list / highlight for the mode (pick.js pickItems).
    var items: [Geo.NearStop] {
        let S = model.staticData
        switch model.pickMode {
        case .loc?: return model.user.map { StationSearch.near(S, $0, maxM: Self.radiusM) } ?? []
        case .addr?: return anchor.map { StationSearch.near(S, $0.coord, maxM: Self.radiusM) } ?? []
        case .sel?:
            return StationSearch.match(S.stops, stopRoutes: S.stopRoutes, query, max: 40).map { m in
                Geo.NearStop(id: m.id, name: m.name, lat: m.coord.lat, lon: m.coord.lon, d: model.user.map { Geo.hav($0, m.coord) } ?? -1)
            }
        case nil: return []
        }
    }

    @ViewBuilder func list(_ mode: PickMode) -> some View {
        if mode == .addr && anchor == nil {
            PlaceList(state: places, typed: query, errorTitle: "Could not search places right now",
                      errorBody: "Check your connection, or select a station by name.",
                      onPick: { p in anchor = Endpoint(label: p.label, coord: p.coord, sub: p.sub) },
                      onExact: { on in places.fix = on ? places.assumed : nil; places.exact = on })
        } else if mode == .loc && model.user == nil {
            if waiting && model.locState != .denied || model.locState == .asking {
                Hint("Finding your location\u{2026}")
            } else {
                EmptyStateView(title: "Location unavailable", message: "You can still find a station without sharing your location.")
                modeButton(.sel, "Select a station", primary: true)
                modeButton(.addr, "Type an address or place", primary: false)
            }
        } else if items.isEmpty {
            if mode == .sel {
                EmptyStateView(title: "No matching stations", message: "Check the spelling, or type an address instead.")
                modeButton(.addr, "Type an address or place", primary: false)
            } else {
                EmptyStateView(title: "No stops within 1.5 km of \(mode == .addr ? anchor?.label ?? "this place" : "you")",
                               message: "Try another place or select a station by name.")
                modeButton(.sel, "Select a station", primary: true)
            }
        } else {
            Card {
                ForEach(Array(items.enumerated()), id: \.element.id) { item in
                    if item.offset > 0 { Divider() }
                    let s = item.element
                    Button { model.chooseStation(s.id) } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(s.name).foregroundStyle(.primary)
                                Text((s.d >= 0 ? TripInfo.walkText(s.d) + " · " : "") + (model.staticData.stopRoutes[s.id] ?? []).map(model.shortName).joined(separator: ", "))
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary).accessibilityHidden(true)
                        }
                        .frame(minHeight: 48).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    func modeButton(_ m: PickMode, _ title: String, primary: Bool) -> some View {
        Group {
            if primary {
                Button { setMode(m) } label: { Text(title).frame(maxWidth: .infinity, minHeight: 44) }.buttonStyle(.borderedProminent)
            } else {
                Button { setMode(m) } label: { Text(title).frame(maxWidth: .infinity, minHeight: 44) }.buttonStyle(.bordered)
            }
        }
    }

    func otherModes(_ cur: PickMode) -> some View {
        let label: [PickMode: String] = [.loc: "Use my location", .sel: "Select a station", .addr: "Type an address"]
        return HStack(spacing: 16) {
            ForEach([PickMode.loc, .sel, .addr].filter { $0 != cur }, id: \.self) { m in
                Button(label[m] ?? "") { setMode(m) }.font(.subheadline).frame(minHeight: 44)
            }
        }
    }

    // MARK: Map highlight

    /// What is highlighted: nothing until a mode has something to show (the chooser highlights nothing).
    var highlightIds: [String] {
        let show = model.pickMode == .loc || (model.pickMode == .addr && anchor != nil) || (model.pickMode == .sel && !query.trimmingCharacters(in: .whitespaces).isEmpty)
        return show ? Array(items.prefix(12).map(\.id)) : []
    }
    var highlightKey: [String] { highlightIds }
    var fitKey: String { "\(model.pickMode?.rawValue ?? "")|\(anchor?.label ?? "")|\(model.user != nil)" }

    func highlight(fit: Bool) {
        let ids = highlightIds
        if model.pickHighlights != ids { model.pickHighlights = ids }
        if model.user != nil { waiting = false }
        guard fit, !ids.isEmpty else { return }
        var pts = ids.compactMap { model.staticData.stops[$0]?.coord }
        if model.pickMode == .addr, let a = anchor { pts.append(a.coord) }
        if model.pickMode == .loc, let u = model.user { pts.append(u) }
        model.fit(pts)
    }
}
