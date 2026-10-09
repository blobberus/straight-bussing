import Foundation
import MapKit
import Observation
import SwiftUI
import StraightBussingKit

enum Tab: String, CaseIterable, Identifiable {
    case current, routes, myroutes
    var id: String { rawValue }
    var title: String {
        switch self {
        case .current: return "Current trip"
        case .routes: return "Routes"
        case .myroutes: return "My Routes"
        }
    }
    var icon: String {
        switch self {
        case .current: return "location.north.line.fill"
        case .routes: return "point.topleft.down.to.point.bottomright.curvepath"
        case .myroutes: return "bookmark.fill"
        }
    }
}

/// Pages pushed on a tab inside the bottom sheet (the web's router views).
enum SheetPage: Hashable {
    case route(String), stop(String), customRoute(String), editCustom(String?), about, directions
}

enum Detent: Int, CaseIterable { case peek, half, full }

/// A directions endpoint (the web's {lat, lon, label, stop?, me?}).
struct Endpoint: Hashable {
    var label: String
    var coord: LatLon
    var stopId: String? = nil
    var isMe = false
    /// Subtitle shown in suggestions (place kind · address · walk to the nearest stop).
    var sub: String? = nil
}

struct DirectionsState {
    var from: Endpoint?
    var to: Endpoint?
    var fromText = ""
    var toText = ""
    var result: PlanResult?
    var selected = 0
}

/// A started trip (Directions > option > Start).
struct ActiveTrip: Equatable {
    var option: TripOption
    var label: String
    var startedAt: Double
}

/// The app store (web/js/state.js) as an Observable model. Pure rules live in StraightBussingKit; this type
/// only holds state, persists prefs, polls feeds and routes the UI.
@MainActor @Observable
final class AppModel {
    let config: LaunchConfig
    @ObservationIgnored let prefsStore: Prefs
    @ObservationIgnored let location = LocationProvider()
    @ObservationIgnored let liveActivity = LiveActivityController()
    @ObservationIgnored var pollTask: Task<Void, Never>?
    @ObservationIgnored var clockTask: Task<Void, Never>?
    @ObservationIgnored let epoch = Date().timeIntervalSince1970
    @ObservationIgnored var failures = 0

    // Static
    var staticData = StaticData()
    var staticFailed: [String] = []
    var places: PlaceIndex?
    var predictor: SchedulePredictor?
    // Live
    var live = LiveState()
    // Prefs + visibility (persisted subset saved on change)
    var routeState = RouteState(routeIds: [])
    var notify = NotifyPrefs()
    var theme = "auto"
    // User
    var user: LatLon?
    var locState: LocationProvider.State = .unknown
    // Navigation
    var tab: Tab = .current
    var paths: [Tab: [SheetPage]] = [:]
    var detent: Detent = .half
    var showSettings = false
    var showLiveActivityPreview = false
    var editingOrder = false
    var confirmDelete: CustomRoute?
    // Directions + trip
    var dir = DirectionsState()
    var activeTrip: ActiveTrip?
    var tripProgress: TripProgress?
    // Clock for countdowns
    var now = Date().timeIntervalSince1970
    // Map
    var camera: MapCameraPosition = .region(AppModel.campusRegion)

    static let campusRegion = MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: 41.7920, longitude: -87.5960),
                                                 span: MKCoordinateSpan(latitudeDelta: 0.03, longitudeDelta: 0.03))

    init(config: LaunchConfig = .parse()) {
        self.config = config
        self.prefsStore = Prefs(demo: config.demo)
    }

    var colorScheme: ColorScheme? {
        let t = config.theme ?? theme
        return t == "dark" ? .dark : t == "light" ? .light : nil
    }

    // MARK: Prefs

    @ObservationIgnored private var loadingPrefs = false

    func loadPrefs() {
        loadingPrefs = true
        defer { loadingPrefs = false }
        let p = prefsStore.load()
        var s = RouteState(routeIds: staticData.routeIds)
        s.hiddenRoutes = p.hiddenRoutes; s.routeOrder = p.routeOrder; s.customRoutes = p.customRoutes
        s.activeCustom = p.activeCustom; s.prevHidden = p.prevHidden; s.favStops = p.favStops
        routeState = s
        notify = p.notify
        theme = p.theme
    }

    func savePrefs() {
        guard !loadingPrefs else { return }
        let s = routeState
        prefsStore.save(Prefs.Stored(hiddenRoutes: s.hiddenRoutes, routeOrder: s.routeOrder, customRoutes: s.customRoutes,
                                     activeCustom: s.activeCustom, prevHidden: s.prevHidden, favStops: s.favStops,
                                     notify: notify, theme: theme))
    }

    /// Apply a core/custom.js-style patch and persist.
    func apply(_ p: StatePatch) {
        routeState.apply(p)
        savePrefs()
    }

    func updateNotify(_ change: (inout NotifyPrefs) -> Void) {
        change(&notify)
        savePrefs()
    }

    func setTheme(_ t: String) {
        theme = t
        savePrefs()
    }

    // MARK: Navigation

    var path: [SheetPage] { paths[tab] ?? [] }
    var page: SheetPage? { path.last }

    func select(_ t: Tab) {
        if t == tab { paths[t] = [] } else { tab = t }
        editingOrder = false
        if detent == .peek { detent = .half }
        syncMapFocus()
    }

    func push(_ p: SheetPage) {
        paths[tab, default: []].append(p)
        switch p {
        case .directions, .about, .editCustom: detent = .full
        case .route(let rid): detent = .half; fitRoute(rid)
        case .stop(let id): if detent == .peek { detent = .half }; flyTo(staticData.stops[id]?.coord)
        case .customRoute: detent = .half
        }
        syncMapFocus()
    }

    func back() {
        guard !path.isEmpty else { return }
        paths[tab]?.removeLast()
        syncMapFocus()
    }

    func popToRoot() { paths[tab] = []; syncMapFocus() }

    /// The route detail view focuses its route on the map (core/visibility.js mapFocus).
    func syncMapFocus() {
        if case .route(let rid) = page { routeState.view = "route"; routeState.routeId = rid }
        else { routeState.view = "nearby"; routeState.routeId = nil }
    }

    var title: String {
        switch page {
        case .route(let rid): return staticData.routes[rid]?.displayName ?? "Route"
        case .stop(let id): return staticData.stops[id]?.name ?? "Stop"
        case .customRoute(let id): return routeState.customRoutes.first { $0.id == id }?.name ?? "Custom route"
        case .editCustom(let id): return id == nil ? "New custom route" : "Edit custom route"
        case .about: return "About"
        case .directions: return "Directions"
        case nil: return tab.title
        }
    }

    // MARK: Map camera

    func fitRoute(_ rid: String) {
        let pts = (staticData.shapes[rid] ?? []).flatMap { $0 }
        fit(pts.isEmpty ? (staticData.routeStops[rid] ?? []).compactMap { staticData.stops[$0]?.coord } : pts)
    }

    func fit(_ pts: [LatLon]) {
        let ok = pts.filter(\.isValid)
        guard let minLat = ok.map(\.lat).min(), let maxLat = ok.map(\.lat).max(),
              let minLon = ok.map(\.lon).min(), let maxLon = ok.map(\.lon).max() else { return }
        let span = MKCoordinateSpan(latitudeDelta: max(0.006, (maxLat - minLat) * 1.35), longitudeDelta: max(0.006, (maxLon - minLon) * 1.35))
        withAnimation(.easeInOut(duration: 0.6)) {
            camera = .region(MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: (minLat + maxLat) / 2, longitude: (minLon + maxLon) / 2), span: span))
        }
    }

    func flyTo(_ p: LatLon?, span: Double = 0.008) {
        guard let p, p.isValid else { return }
        withAnimation(.easeInOut(duration: 0.6)) {
            camera = .region(MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: p.lat, longitude: p.lon),
                                                span: MKCoordinateSpan(latitudeDelta: span, longitudeDelta: span)))
        }
    }

    // MARK: Derived

    var staleLevel: StaleLevel { live.staleLevel(now: now) }
    var hidden: [String] { RouteVisibility.effectiveHidden(routeState) }
    var mapVisibility: RouteVisibility.MapVisibility { RouteVisibility.mapVisibility(routeState) }

    func route(_ rid: String) -> Route? { staticData.routes[rid] }
    func running(_ rid: String) -> Int { Arrivals.runningCount(buses: live.buses, rid: rid) }
    func arrivals(at stopId: String, routeId: String? = nil) -> [Arrival] {
        Arrivals.arrivalsFor(trips: live.trips, stopId: stopId, routeId: routeId, hidden: hidden, now: now)
    }
    var activeAlerts: [ServiceAlert] { Arrivals.activeAlerts(live.alerts, now: now) }
    func isFav(_ stopId: String) -> Bool { routeState.favStops.contains(stopId) }
}
