import SwiftUI
import UIKit
import StraightBussingKit

/// "Current trip" tab (web ui/views/nearby.js, view id `nearby`): service alert banner, the trip in progress
/// (Google-Maps-style timeline) or "No trip in progress" + "Routes to station…", then one glance: favorites, the
/// next buses at the nearest stops with "Leave in N min" walking guidance, or (without location) a station search,
/// "Type an address or place" and "Arriving soon". Never a dead end; location off is a first-class state.
struct CurrentTripView: View {
    @Environment(AppModel.self) private var model
    @State private var query = ""
    @State private var placeMode = false
    @State private var places = PlaceUI()

    /// Farthest stop still called "nearby" (meters).
    static let nearbyMaxM = 5000.0
    /// Favorites shown here (the rest are in My Routes).
    static let favMax = 3

    struct SearchKey: Equatable { var q: String; var place: Bool; var exact: Bool }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                AlertsBanner()
                tripRegion
                if model.user == nil { locBlock }
                SearchField(placeholder: placeMode ? "Address, building or place" : "Search stations", text: $query,
                            identifier: "nearbySearch", onSubmit: submit)
                if placeMode {
                    Button("Search stations instead") { placeMode = false; places = PlaceUI() }.font(.subheadline).frame(minHeight: 44)
                    PhotonNote()
                } else {
                    Button("Type an address or place") { placeMode = true }.font(.subheadline).frame(minHeight: 44)
                }
                if !query.trimmingCharacters(in: .whitespaces).isEmpty { results } else { bodyRegion }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
        }
        .accessibilityIdentifier("currentTrip")
        .task(id: SearchKey(q: query, place: placeMode, exact: places.exact)) {
            guard placeMode else { return }
            await PlaceSearchFlow.run(query, exact: places.exact, model: model, update: { places = $0 }, current: { places })
        }
    }

    // MARK: Trip region

    @ViewBuilder var tripRegion: some View {
        if let p = model.tripFollow, let trip = model.activeTrip {
            TripTimelineView(progress: p, trip: trip)
        } else {
            Card {
                VStack(alignment: .leading, spacing: 2) {
                    Text("No trip in progress").font(.headline)
                    Text("Search for a destination above, choose a route and tap Start.").font(.subheadline).foregroundStyle(Palette.text2)
                }
                .padding(.vertical, 10)
                .accessibilityElement(children: .combine)
            }
            PickButton()
        }
    }

    // MARK: Location

    @ViewBuilder var locBlock: some View {
        switch model.locState {
        case .asking:
            Hint("Finding your location\u{2026}").accessibilityAddTraits(.updatesFrequently)
        case .denied:
            Card {
                Label {
                    Text("**Location is off.** To see stops near you, allow location for Straight Bussing in iOS Settings. You can still search below.")
                        .font(.subheadline)
                } icon: { Image(systemName: "location.slash") }
                .padding(.vertical, 10)
            }
            Button {
                if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
            } label: { Text("Open iOS Settings").frame(maxWidth: .infinity, minHeight: 44) }
                .secondaryButtonStyle()
        default:
            Button { model.locate() } label: {
                Label("Use my location", systemImage: "location.fill").frame(maxWidth: .infinity, minHeight: 44)
            }
            .primaryButtonStyle()
            .accessibilityHint("Your location stays on this iPhone")
        }
    }

    // MARK: Typed query

    func submit() {
        if placeMode { if let p = places.items.first { choosePlace(p) } ; return }
        if let first = StationSearch.match(model.staticData.stops, stopRoutes: model.staticData.stopRoutes, query, max: 1).first {
            model.push(.stop(first.id))
        }
    }

    func choosePlace(_ p: PlaceHit) {
        model.nearAnchor = Endpoint(label: p.label, coord: p.coord, sub: p.sub)
        query = ""; placeMode = false; places = PlaceUI()
        model.flyTo(p.coord, span: 0.01)
    }

    @ViewBuilder var results: some View {
        if placeMode {
            PlaceList(state: places, typed: query, errorTitle: "Could not search places right now",
                      errorBody: "Check your connection, or search a station by name.", onPick: choosePlace,
                      onExact: { on in places.fix = on ? places.assumed : nil; places.exact = on })
        } else {
            let m = StationSearch.match(model.staticData.stops, stopRoutes: model.staticData.stopRoutes, query, max: 8)
            if m.isEmpty {
                EmptyStateView(title: "No matching stations", message: "Check the spelling, or type an address instead.")
                Button { placeMode = true } label: { Text("Search addresses and places").frame(maxWidth: .infinity, minHeight: 44) }
                    .secondaryButtonStyle()
            } else {
                Card {
                    ForEach(Array(m.enumerated()), id: \.offset) { item in
                        if item.offset > 0 { Divider() }
                        Button { model.push(.stop(item.element.id)) } label: {
                            HStack(spacing: 10) {
                                Image(systemName: "bus").frame(width: 22).foregroundStyle(Palette.text2).accessibilityHidden(true)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(item.element.name).foregroundStyle(Palette.text)
                                    Text((model.staticData.stopRoutes[item.element.id] ?? []).map(model.shortName).joined(separator: ", "))
                                        .font(.caption).foregroundStyle(Palette.text2)
                                }
                                Spacer(minLength: 0)
                            }
                            .frame(minHeight: 48).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    // MARK: Body (nothing typed)

    @ViewBuilder var bodyRegion: some View {
        FavoritesCard()
        if let u = model.user {
            if near(u).isEmpty {
                EmptyStateView(title: "No stops near you", message: "You seem to be more than 5 km from the shuttle network. Search a station or place above.")
                soonList
            } else {
                nearListView(u, guide: true)
            }
        } else if let a = model.nearAnchor {
            Card {
                HStack {
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Showing stops near").font(.caption).foregroundStyle(Palette.text2)
                        Text(a.label).font(.subheadline.weight(.semibold))
                    }
                    Spacer()
                    Button("Clear") { model.nearAnchor = nil }.frame(minWidth: 44, minHeight: 44)
                        .accessibilityLabel("Clear place \(a.label)")
                }
            }
            if near(a.coord).isEmpty {
                EmptyStateView(title: "No stops within 5 km of this place", message: "Try another place or search a station.")
            } else {
                nearListView(a.coord, guide: false)
            }
        } else {
            soonList
        }
    }

    func near(_ p: LatLon) -> [Geo.NearStop] {
        StationSearch.near(model.staticData, p, maxM: Self.nearbyMaxM, max: 3, hidden: Set(model.hidden))
    }

    /// The nearest stop (3 arrivals, the hero card) and two more (1 each).
    @ViewBuilder func nearListView(_ p: LatLon, guide: Bool) -> some View {
        let stops = near(p)
        ForEach(Array(stops.enumerated()), id: \.element.id) { item in
            if item.offset == 1 { SectionTitle(text: "Also nearby") }
            StopCard(stop: item.element, max: item.offset == 0 ? 3 : 1, hero: item.offset == 0, guide: guide)
        }
        if guide && !stops.isEmpty {
            Text("Leave times use a walking estimate (80 m a minute) and live bus times. Allow extra time.")
                .font(.caption).foregroundStyle(Palette.text2)
        }
        if model.silentService { NoServiceView() }   // say why the cards have no times
    }

    @ViewBuilder var soonList: some View {
        if !model.liveLoaded {
            SectionTitle(text: "Arriving soon")
            Card { SkeletonRows(count: 3) }
        } else {
            let soon = soonest
            if soon.isEmpty {
                NoServiceView()
            } else {
                SectionTitle(text: "Arriving soon")
                Card {
                    ForEach(Array(soon.enumerated()), id: \.offset) { item in
                        if item.offset > 0 { Divider() }
                        Button { model.push(.stop(item.element.stop)) } label: {
                            SoonRow(stopName: model.staticData.stops[item.element.stop]?.name ?? item.element.stop, a: item.element.a)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    /// The next visible arrival per served stop, soonest first (top 6), from the per-poll arrival index.
    var soonest: [(stop: String, a: Arrival)] {
        let hidden = Set(model.hidden), now = model.now
        var all: [(stop: String, a: Arrival)] = []
        for (sid, list) in model.arrivalIndex where !(model.staticData.stopRoutes[sid] ?? []).isEmpty {
            if let a = list.first(where: { $0.t > now - 30 && !hidden.contains($0.rid) }) { all.append((stop: sid, a: a)) }
        }
        return Array(all.sorted { $0.a.t < $1.a.t || ($0.a.t == $1.a.t && $0.stop < $1.stop) }.prefix(6))
    }
}

/// "Routes to station…" (opens the chooser: current location / select a station / type an address or place).
struct PickButton: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        Button { model.pickMode = nil; model.push(.pick) } label: {
            Text("Routes to station\u{2026}").frame(maxWidth: .infinity, minHeight: 44)
        }
        .secondaryButtonStyle()
        .accessibilityIdentifier("pickOpen")
    }
}

/// Why there are no arrivals (web nearby.js noService): a feed outage is not a service outage, and an empty feed
/// during scheduled service is not "no shuttles running".
struct NoServiceView: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        if model.liveOutage {
            EmptyStateView(title: "Live times unavailable",
                           message: "Can't reach the shuttle feed, so we can't tell which shuttles are running. Check with the official service.", showOfficial: true)
        } else if !model.buses.isEmpty {
            EmptyStateView(title: "No upcoming arrivals", message: "No bus on your visible routes has a predicted arrival right now.", showOfficial: true)
        } else if model.silentService, let why = model.silentText() {
            EmptyStateView(title: "No live locations right now", message: why, showOfficial: true)
        } else {
            EmptyStateView(title: "No shuttles running right now", message: "Check the official schedule for service hours.", showOfficial: true)
        }
    }
}

/// A stop with its next arrivals (nearby.js stopCard). With `guide`, each row says when to leave (walking estimate)
/// or that you cannot walk there in time; one more arrival is listed when none of the first can be caught.
struct StopCard: View {
    @Environment(AppModel.self) private var model
    let stop: Geo.NearStop
    let max: Int
    let hero: Bool
    let guide: Bool

    var body: some View {
        let walkM = guide ? TripInfo.stopWalkMin(stop.d) : nil
        let all = model.arrivals(at: stop.id)
        let list = pick(all, walkM)
        Card {
            Button { model.push(.stop(stop.id)) } label: {
                HStack {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(stop.name).font(hero ? .headline : .subheadline.weight(.semibold)).foregroundStyle(Palette.text).lineLimit(2)
                        Text(TripInfo.walkText(stop.d)).font(.caption).foregroundStyle(Palette.text2)
                    }
                    Spacer()
                    Image(systemName: "chevron.right").font(.caption).foregroundStyle(Palette.text3).accessibilityHidden(true)
                }
                .frame(minHeight: 44).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint("Opens the stop")
            if !model.liveLoaded {
                Divider()
                SkeletonRows(count: hero ? 2 : 1)
            } else if list.isEmpty {
                HStack(spacing: 6) {
                    Text(model.liveOutage ? "Live times unavailable" : model.silentService ? "No live times right now" : "No upcoming arrivals")
                        .font(.subheadline).foregroundStyle(Palette.text2)
                    Spacer(minLength: 0)
                    ForEach((model.staticData.stopRoutes[stop.id] ?? []).filter { !model.hidden.contains($0) }, id: \.self) {
                        RouteChip(route: model.route($0), rid: $0, size: 11)
                    }
                }
                .padding(.bottom, 8)
            } else {
                ForEach(list, id: \.self) { a in
                    Divider()
                    if let w = walkM {
                        let c = TripInfo.catchNote(a.t, walkMin: w, now: model.now)
                        ArrivalButton(a: a, sub: c.text, miss: c.kind == .miss, aria: c.aria)
                    } else {
                        ArrivalButton(a: a)
                    }
                }
            }
        }
    }

    /// The first `max`, plus one more when none of those can be caught on foot (nearby.js pickArrivals).
    func pick(_ all: [Arrival], _ walkM: Double?) -> [Arrival] {
        var list = Array(all.prefix(max))
        if let w = walkM, !list.isEmpty, all.count > max,
           list.allSatisfy({ TripInfo.catchNote($0.t, walkMin: w, now: model.now).kind == .miss }) { list.append(all[max]) }
        return list
    }
}

/// "Arriving soon" row: stop name, route, ETA.
struct SoonRow: View {
    @Environment(AppModel.self) private var model
    let stopName: String
    let a: Arrival
    var body: some View {
        let m = Swift.max(0, TimeFmt.minsUntil(a.t, from: model.now))
        HStack(spacing: 10) {
            RouteChip(route: model.route(a.rid), rid: a.rid)
            VStack(alignment: .leading, spacing: 1) {
                Text(stopName).font(.subheadline.weight(.medium)).foregroundStyle(Palette.text).lineLimit(1)
                Text(model.route(a.rid)?.long ?? "").font(.caption).foregroundStyle(Palette.text2).lineLimit(1)
            }
            Spacer()
            EtaText(t: a.t, now: model.now, stale: model.isStale)
        }
        .frame(minHeight: 48).contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Route \(model.shortName(a.rid)) at \(stopName), \(m < 1 ? "arriving now" : "in \(m) minutes")\(model.isStale ? ", estimate" : "")")
    }
}

/// Favorites card: up to 3 favorite stations with their next visible arrival, and "All favorites".
struct FavoritesCard: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        let ids = model.routeState.favStops.filter { model.staticData.stops[$0] != nil }
        if !ids.isEmpty {
            HStack {
                SectionTitle(text: "Favorites")
                Spacer()
                Button("All favorites") { model.select(.myroutes) }.font(.footnote.weight(.semibold)).frame(minHeight: 44)
            }
            Card {
                ForEach(Array(ids.prefix(CurrentTripView.favMax).enumerated()), id: \.element) { item in
                    if item.offset > 0 { Divider() }
                    row(item.element)
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Favorite stations")
        }
    }

    func row(_ id: String) -> some View {
        let name = model.staticData.stops[id]?.name ?? id
        let a = model.liveLoaded ? model.arrivals(at: id).first : nil
        let unknown = model.liveOutage || model.silentService
        let m = a.map { Swift.max(0, TimeFmt.minsUntil($0.t, from: model.now)) } ?? 0
        let label = a.map { "Favorite \(name): route \(model.shortName($0.rid)) \(m < 1 ? "arriving now" : "in \(m) minutes")\(model.isStale ? ", estimate" : "")" }
            ?? "Favorite \(name): \(unknown ? "live times unavailable" : model.liveLoaded ? "no upcoming arrivals" : "loading")"
        return Button { model.push(.stop(id)) } label: {
            HStack(spacing: 10) {
                if let a { RouteChip(route: model.route(a.rid), rid: a.rid) }
                else { Image(systemName: "star.fill").foregroundStyle(Palette.star).frame(width: 24).accessibilityHidden(true) }
                VStack(alignment: .leading, spacing: 1) {
                    Text(name).font(.subheadline.weight(.medium)).foregroundStyle(Palette.text).lineLimit(1)
                    if let a { Text(model.route(a.rid)?.long ?? "").font(.caption).foregroundStyle(Palette.text2).lineLimit(1) }
                }
                Spacer()
                if let a { EtaText(t: a.t, now: model.now, stale: model.isStale) }
                else { Text(unknown ? "No live times" : model.liveLoaded ? "No buses soon" : "").font(.caption).foregroundStyle(Palette.text2) }
            }
            .frame(minHeight: 48).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityAddTraits(.isButton)
    }
}

/// Service alerts banner (web alerts.js alertBanner): count + first title, opens Alerts. Not color alone: the
/// warning icon and the words "Service alert(s)" carry the state.
struct AlertsBanner: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        if model.liveLoaded, let b = LiveText.alertBanner(model.activeAlerts) {
            Button { model.push(.alerts) } label: {
                HStack(spacing: 10) {
                    Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Palette.warn).accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(b.head).font(.subheadline.weight(.semibold)).foregroundStyle(Palette.text)
                        Text(b.line).font(.subheadline).foregroundStyle(Palette.text2).lineLimit(2)
                    }
                    Spacer()
                    Image(systemName: "chevron.right").font(.caption).foregroundStyle(Palette.text3).accessibilityHidden(true)
                }
                .padding(12)
                .frame(minHeight: 44)
                .background(Palette.warnBg, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(b.head): \(b.line). Open alerts")
            .accessibilityAddTraits(.isButton)
            .accessibilityIdentifier("alertBanner")
        }
    }
}
