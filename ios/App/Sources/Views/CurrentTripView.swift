import SwiftUI
import UIKit
import StraightBussingKit

/// "Current trip" tab (web ui/views/nearby.js, view id `nearby`). Ship checklist item 3: the next bus in one glance,
/// no taps, fully visible at the half detent (owner decision 2026-10-11). Order:
/// 1. the trip in progress (timeline, its next step first) if one is started; else the next bus: the nearest stop
///    and its next arrivals (location known, or a place chosen), else the favorite stations' next buses, else
///    "Use my location" as the one primary action with the station search right under it;
/// 2. the service alert row, one line, right under that block;
/// 3. more of the same glance: "Also nearby", the walking footnote, favorites;
/// 4. secondary actions: station / place search, "Routes to station…", "Arriving soon" without a location, and a
///    quiet "No trip in progress" line (no card).
/// A typed search shows its results right under the field and hides the rest. Never a dead end; location off is a
/// first-class state.
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

    /// What the first block under the title is built from.
    enum Lead: Equatable { case here(LatLon), place(Endpoint), favorites, nothing }

    var lead: Lead {
        if let u = model.user { return .here(u) }
        if let a = model.nearAnchor { return .place(a) }
        return model.routeState.favStops.contains { model.staticData.stops[$0] != nil } ? .favorites : .nothing
    }

    var tripOn: Bool { model.tripFollow != nil && model.activeTrip != nil }
    var typing: Bool { !query.trimmingCharacters(in: .whitespaces).isEmpty }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                // the search field keeps one place in this stack (typing never moves focus): the content around it
                // hides while a search is typed, so the results sit right under the field
                if !typing { leading }
                searchBlock
                if typing { results } else { trailing }
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

    // MARK: Blocks above the search field

    @ViewBuilder var leading: some View {
        if let p = model.tripFollow, let trip = model.activeTrip {
            TripTimelineView(progress: p, trip: trip)   // its now card first, the alert row under it
        }
        switch lead {
        case .here(let u):
            nearBlock(u, guide: true)
            FavoritesCard()
        case .place(let a):
            anchorRow(a)
            nearBlock(a.coord, guide: false)
            FavoritesCard()
            locBlock
        case .favorites:
            FavoritesCard()
            if !tripOn { AlertsBanner() }
            locBlock
        case .nothing:
            locBlock   // the one primary action, right under the title; the station search comes next
        }
    }

    // MARK: Blocks under the search field

    @ViewBuilder var trailing: some View {
        if lead == .nothing {
            if !tripOn { AlertsBanner() }
            soonList
        } else if lead == .favorites {
            soonList
        }
        if !tripOn {
            PickButton().padding(.top, 4)
            Text("No trip in progress. To start one, search for a destination and tap Start.")
                .font(.caption).foregroundStyle(Palette.text2)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 2)
        }
    }

    @ViewBuilder var searchBlock: some View {
        SearchField(placeholder: placeMode ? "Address, building or place" : "Search stations", text: $query,
                    identifier: "nearbySearch", onSubmit: submit)
            .padding(.top, typing ? 0 : 6)
        if placeMode {
            Button("Search stations instead") { placeMode = false; places = PlaceUI() }.font(.subheadline).frame(minHeight: 44)
            PhotonNote()
        } else {
            Button("Type an address or place") { placeMode = true }.font(.subheadline).frame(minHeight: 44)
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
            .accessibilityIdentifier("useMyLocation")
        }
    }

    func anchorRow(_ a: Endpoint) -> some View {
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

    // MARK: The next bus

    func near(_ p: LatLon) -> [Geo.NearStop] {
        StationSearch.near(model.staticData, p, maxM: Self.nearbyMaxM, max: 3, hidden: Set(model.hidden))
    }

    /// The nearest stop with its next arrivals (the hero card, fully visible at the half detent), the alert row,
    /// then two more stops (1 arrival each) and the walking footnote.
    @ViewBuilder func nearBlock(_ p: LatLon, guide: Bool) -> some View {
        let stops = near(p)
        if stops.isEmpty {
            EmptyStateView(title: guide ? "No stops near you" : "No stops within 5 km of this place",
                           message: guide ? "You seem to be more than 5 km from the shuttle network. Search a station or place below."
                                          : "Try another place or search a station.")
            if !tripOn { AlertsBanner() }
            if guide { soonList }
        } else {
            ForEach(Array(stops.enumerated()), id: \.element.id) { item in
                if item.offset == 0 {
                    StopCard(stop: item.element, max: 3, hero: true, guide: guide)
                        .accessibilityElement(children: .contain)
                        .accessibilityIdentifier("nextBusBlock")
                    if !tripOn { AlertsBanner() }
                    // no bus is reporting: why, the operator's alert in full and whom to call, before more stops
                    if model.liveLoaded && model.buses.isEmpty { NoServiceView() }
                } else {
                    if item.offset == 1 { SectionTitle(text: "Also nearby") }
                    StopCard(stop: item.element, max: 1, hero: false, guide: guide)
                }
            }
            if guide {
                Text("Leave times use a walking estimate (80 m a minute) and live bus times. Allow extra time.")
                    .font(.caption).foregroundStyle(Palette.text2)
            }
        }
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
                           message: "Can't reach the shuttle feed, so we can't tell which shuttles are running. Check with the official service.",
                           showOfficial: true, operatorAlerts: true)
        } else if !model.buses.isEmpty {
            EmptyStateView(title: "No upcoming arrivals", message: "No bus on your visible routes has a predicted arrival right now.", showOfficial: true)
        } else if model.silentService, let why = model.silentText() {
            EmptyStateView(title: "No live locations right now", message: why, showOfficial: true, operatorAlerts: true)
        } else {
            EmptyStateView(title: "No shuttles running right now", message: "Check the official schedule for service hours.", showOfficial: true,
                           operatorAlerts: true)
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

    /// The first `max`, plus one more when none of those can be caught on foot (nearby.js pickArrivals). The hero
    /// card keeps its 3 rows (it must fit the half detent): its last row becomes the first bus you can still catch.
    func pick(_ all: [Arrival], _ walkM: Double?) -> [Arrival] {
        var list = Array(all.prefix(max))
        guard let w = walkM, !list.isEmpty, all.count > max else { return list }
        func miss(_ a: Arrival) -> Bool { TripInfo.catchNote(a.t, walkMin: w, now: model.now).kind == .miss }
        guard list.allSatisfy(miss) else { return list }
        if hero {
            if let next = all[max...].first(where: { !miss($0) }) { list[list.count - 1] = next }
        } else {
            list.append(all[max])
        }
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
                Text(stopName).font(.subheadline.weight(.medium)).foregroundStyle(Palette.text).lineLimit(2)   // wrap, never cut a stop name
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

/// Service alerts row (web alerts.js alertBanner): "Service alert: <first title>" on one line, opens Alerts. Compact,
/// so the next bus above it stays fully visible at the half detent; at accessibility text sizes it wraps instead of
/// truncating. Not color alone: the warning icon and the words "Service alert(s)" carry the state.
struct AlertsBanner: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dynamicTypeSize) private var typeSize
    var body: some View {
        if model.liveLoaded, let b = LiveText.alertBanner(model.activeAlerts) {
            Button { model.push(.alerts) } label: {
                HStack(spacing: 10) {
                    Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Palette.warn).accessibilityHidden(true)
                    (Text(b.head + ": ").fontWeight(.semibold).foregroundStyle(Palette.text) + Text(b.line).foregroundStyle(Palette.text2))
                        .font(.subheadline)
                        .lineLimit(typeSize.isAccessibilitySize ? 4 : 1)
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right").font(.caption).foregroundStyle(Palette.text3).accessibilityHidden(true)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 4)
                .frame(minHeight: 44)
                .background(Palette.warnBg, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
                .contentShape(RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(b.head): \(b.line). Open alerts")
            .accessibilityAddTraits(.isButton)
            .accessibilityIdentifier("alertBanner")
        }
    }
}
