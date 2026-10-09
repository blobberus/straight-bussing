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
struct Endpoint: Hashable, Sendable {
    var label: String
    var coord: LatLon
    var stopId: String? = nil
    var isMe = false
    /// Subtitle shown in suggestions (place kind · address · walk to the nearest stop).
    var sub: String? = nil
}

/// Directions endpoints and the plan. The typed field text lives in DirectionsView (@State), so keystrokes
/// never redraw views that read `dir` (the map draws the selected option).
struct DirectionsState {
    var from: Endpoint?
    var to: Endpoint?
    var result: PlanResult?
    var selected = 0
}

/// A started trip (Directions > option > Start).
struct ActiveTrip: Equatable {
    var option: TripOption
    var label: String
    var startedAt: Double
}

/// The map camera in its own observable: fits and user pans only redraw the Map, never views reading AppModel.
@MainActor @Observable
final class MapCameraModel {
    static let campus = MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: 41.7920, longitude: -87.5960),
                                           span: MKCoordinateSpan(latitudeDelta: 0.03, longitudeDelta: 0.03))
    var position: MapCameraPosition = .region(MapCameraModel.campus)
}

/// A route polyline ready for MapKit (coordinates converted and color parsed once per visibility change).
struct MapLine: Identifiable {
    let id: String
    let coords: [CLLocationCoordinate2D]
    let color: Color
    let width: CGFloat
}

struct MapStop: Identifiable {
    let stop: Stop
    let isFav: Bool
    var id: String { stop.id }
}

/// Route lines (bottom -> top) and the stops served by a visible route.
struct MapLayers {
    var lines: [MapLine] = []
    var stops: [MapStop] = []
    var hidden: Set<String> = []
}

/// A bus marker. `stale` (report older than 60 s) is computed when live data or the clock updates, so the map
/// never reads the clock.
struct MapBus: Identifiable, Equatable {
    let id: String
    let rid: String
    let label: String
    let coord: LatLon
    let bearing: Double?
    let stale: Bool
}

/// The app store (web/js/state.js) as an Observable model. Pure rules live in StraightBussingKit; this type
/// only holds state, persists prefs, polls feeds and routes the UI.
///
/// Performance rule: views redraw when a property they read is *assigned*, even with an equal value, so live
/// slices, the stale level and the map focus are only written when they actually change, and derived map
/// data (route lines, stops) is cached.
@MainActor @Observable
final class AppModel {
    let config: LaunchConfig
    @ObservationIgnored let prefsStore: Prefs
    @ObservationIgnored let location = LocationProvider()
    @ObservationIgnored let liveActivity = LiveActivityController()
    @ObservationIgnored let mapCamera = MapCameraModel()
    @ObservationIgnored var pollTask: Task<Void, Never>?
    @ObservationIgnored var clockTask: Task<Void, Never>?
    @ObservationIgnored var planTask: Task<Void, Never>?
    /// Background re-plan of the open Directions with new live data (see `refreshDirections`).
    @ObservationIgnored var dirRefreshTask: Task<Void, Never>?
    @ObservationIgnored var lastDirRefresh: Double = 0
    @ObservationIgnored let epoch = Date().timeIntervalSince1970
    @ObservationIgnored var failures = 0
    @ObservationIgnored var booted = false
    @ObservationIgnored var lastAlertsPoll: Double = 0
    /// Last content sent to the Live Activity (ActivityKit updates are throttled; see `pushLiveActivity`).
    @ObservationIgnored var lastActivityPush: (snap: LiveTripSnapshot, at: Double)?
    /// The merged feed state (`LiveState.applying` works on it). Views read the observed slices below.
    @ObservationIgnored var liveState = LiveState()

    // Static
    var staticData = StaticData()
    var staticFailed: [String] = []
    /// Bumped whenever `staticData` is replaced (part of the map layer cache key).
    var staticVersion = 0
    var places: PlaceIndex?
    var predictor: SchedulePredictor?
    // Live: each slice is assigned only when it changes (see `applyLive`).
    var buses: [VehiclePosition] = []
    var trips: [TripUpdate] = []
    var alerts: [ServiceAlert] = []
    var liveLoaded = false
    var liveFailed = false
    var lastOk: Double = 0
    var feedTs: Double = 0
    /// Stored, not derived from `now`: the layout only reacts when the level changes.
    var staleLevel: StaleLevel = .err
    /// Stop id -> live arrivals (`Arrivals.index`), rebuilt once per change of `trips`.
    var arrivalIndex: [String: [Arrival]] = [:]
    var mapBuses: [MapBus] = []
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
        case .route(let rid): detent = .half; fitRoute(rid)   // only choosing a route moves the map (web main.js openRoute)
        case .stop: if detent == .peek { detent = .half }     // stop taps keep the user's map view
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

    /// The route detail view focuses its route on the map (core/visibility.js mapFocus). Writes only on a
    /// real change: every write would redraw the map and every view reading `routeState`.
    func syncMapFocus() {
        var view = "nearby", rid: String? = nil
        if case .route(let r) = page { view = "route"; rid = r }
        if routeState.view != view { routeState.view = view }
        if routeState.routeId != rid { routeState.routeId = rid }
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
            mapCamera.position = .region(MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: (minLat + maxLat) / 2, longitude: (minLon + maxLon) / 2), span: span))
        }
    }

    func flyTo(_ p: LatLon?, span: Double = 0.008) {
        guard let p, p.isValid else { return }
        withAnimation(.easeInOut(duration: 0.6)) {
            mapCamera.position = .region(MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: p.lat, longitude: p.lon),
                                                            span: MKCoordinateSpan(latitudeDelta: span, longitudeDelta: span)))
        }
    }

    // MARK: Map layers (cached)

    private struct LayersKey: Equatable {
        var vis: RouteVisibility.MapVisibility
        var favs: [String]
        var version: Int
    }

    @ObservationIgnored private var layersMemo: (key: LayersKey, layers: MapLayers)?

    /// Route lines + stops for the map. Rebuilt only when visibility, focus, map order, favorites or the static
    /// data change (about 4,000 shape points and every route color), never on a poll, clock tick or location update.
    var mapLayers: MapLayers {
        let key = LayersKey(vis: mapVisibility, favs: routeState.favStops, version: staticVersion)
        if let memo = layersMemo, memo.key == key { return memo.layers }
        let layers = Self.buildLayers(key.vis, favs: key.favs, staticData)
        layersMemo = (key: key, layers: layers)
        return layers
    }

    static func buildLayers(_ vis: RouteVisibility.MapVisibility, favs: [String], _ S: StaticData) -> MapLayers {
        let hidden = Set(vis.hidden), focus = vis.focus.map { Set($0) }
        var lines: [MapLine] = []
        // Bottom -> top: MapKit draws later content above earlier content.
        for rid in vis.order.reversed() where !hidden.contains(rid) {
            guard let r = S.routes[rid] else { continue }
            let dim = focus.map { !$0.contains(rid) } ?? false
            let color = Color(hex: r.color).opacity(dim ? 0.25 : 1)
            for (i, line) in (S.shapes[rid] ?? []).enumerated() {
                lines.append(MapLine(id: "\(rid)-\(i)", coords: line.map(\.cl), color: color, width: dim ? 3 : 5))
            }
        }
        var ids = Set<String>()
        for (rid, list) in S.routeStops where !hidden.contains(rid) { ids.formUnion(list) }
        let fav = Set(favs)
        let stops = ids.compactMap { S.stops[$0] }.sorted { $0.id < $1.id }.map { MapStop(stop: $0, isFav: fav.contains($0.id)) }
        return MapLayers(lines: lines, stops: stops, hidden: hidden)
    }

    // MARK: Derived

    var hidden: [String] { RouteVisibility.effectiveHidden(routeState) }
    var mapVisibility: RouteVisibility.MapVisibility { RouteVisibility.mapVisibility(routeState) }

    func route(_ rid: String) -> Route? { staticData.routes[rid] }
    func running(_ rid: String) -> Int { Arrivals.runningCount(buses: buses, rid: rid) }
    /// Live arrivals at a stop from the per-poll index (same result as `Arrivals.arrivalsFor`).
    func arrivals(at stopId: String, routeId: String? = nil) -> [Arrival] {
        Arrivals.arrivals(in: arrivalIndex, stopId: stopId, routeId: routeId, hidden: routeId == nil ? Set(hidden) : [], now: now)
    }
    var activeAlerts: [ServiceAlert] { Arrivals.activeAlerts(alerts, now: now) }
    func isFav(_ stopId: String) -> Bool { routeState.favStops.contains(stopId) }

    /// The merged live state for Kit functions called from views (built from the observed slices, so the
    /// calling view redraws when they change).
    var live: LiveState {
        var s = LiveState()
        s.buses = buses; s.trips = trips; s.alerts = alerts; s.feedTs = feedTs; s.lastOk = lastOk
        s.failed = liveFailed; s.loaded = liveLoaded
        return s
    }
}
