import Foundation
import SwiftUI
import UIKit
import StraightBussingKit

/// Loading, polling, location, directions and the started trip.
extension AppModel {
    /// Service alerts change rarely: fetched every 60 s; vehicles + trip updates every 10 s.
    static let alertsEveryS = 60.0

    /// Boot: bundled static data, prefs, then live polling (or the demo feed). Idempotent.
    func start() {
        guard !booted else { return }
        booted = true
        Task { await boot() }
    }

    func boot() async {
        guard let dir = Bundle.main.url(forResource: "data", withExtension: nil) else {
            staticFailed = ["data (bundle folder missing)"]
            finishBoot()
            return
        }
        // JSON parsing and the place index are pure work on Sendable values: keep them off the main thread.
        let staticTask = Task.detached(priority: .userInitiated) { StaticLoader.load(from: dir) }
        let placesTask = Task.detached(priority: .utility) { StaticLoader.loadPlaces(from: dir) }
        let loaded = await staticTask.value
        staticData = loaded.data
        staticFailed = loaded.failed
        staticVersion += 1
        finishBoot()
        places = await placesTask.value
        if config.demo { applyLaunchScreen() }
    }

    /// Everything that needs the static data: predictor, prefs, location, clock, polling.
    func finishBoot() {
        predictor = SchedulePredictor(segments: staticData.segments, routeStops: staticData.routeStops)
        loadPrefs()
        location.onUpdate = { [weak self] p, st in
            guard let self, !self.config.demo else { return }
            if self.locState != st { self.locState = st }
            if let p { self.user = p; self.userMoved(p) }
            if st == .denied, self.pendingMe != nil { self.pendingMe = nil; self.dirMeDenied = true }
        }
        if config.demo {
            user = DemoConfig.origin
            locState = .granted
            seedDemo()
        } else {
            locState = location.state
            location.resumeIfAuthorized()
        }
        startBusAlerts()
        startClock()
        resumePolling()
    }

    // MARK: Polling

    func resumePolling() {
        guard pollTask == nil, !staticData.isEmpty || !staticFailed.isEmpty else { return }   // after boot
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                await self.pollOnce()
                let delay: Double = self.feedSimulated ? 5 : (self.failures >= 3 ? 30 : 10)
                try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            }
        }
    }

    func pausePolling() {
        pollTask?.cancel()
        pollTask = nil
    }

    func pollOnce() async {
        let poll: FeedPoll
        let gen = feedGeneration
        if feedSimulated {
            poll = DemoFeed.poll(staticData: staticData, now: Date().timeIntervalSince1970, epoch: epoch)
        } else {
            let started = Date().timeIntervalSince1970
            let withAlerts = started - lastAlertsPoll >= Self.alertsEveryS
            poll = await FeedClient().poll(alerts: withAlerts)
            guard gen == feedGeneration else { return }   // switched to simulated buses meanwhile: never mix
            if withAlerts, (try? poll.alerts.get()) != nil { lastAlertsPoll = started }   // a failed fetch retries next poll
        }
        let t = Date().timeIntervalSince1970
        applyLive(liveState.applying(poll, staticData: staticData, now: t), now: t)
        failures = liveState.failed ? failures + 1 : 0
        refreshTrip()
        refreshDirections()
        checkBusAlerts()
    }

    /// Publish a merged poll: every observed slice is assigned only when it differs, so a view that reads
    /// `alerts` is not redrawn because buses moved, and an unchanged feed redraws nothing but the clock.
    func applyLive(_ s: LiveState, now t: Double) {
        liveState = s
        if buses != s.buses { buses = s.buses }
        if trips != s.trips {
            trips = s.trips
            arrivalIndex = Arrivals.index(trips: s.trips)
        }
        if alerts != s.alerts { alerts = s.alerts }
        if liveLoaded != s.loaded { liveLoaded = s.loaded }
        if liveFailed != s.failed { liveFailed = s.failed }
        if lastOk != s.lastOk { lastOk = s.lastOk }
        if feedTs != s.feedTs { feedTs = s.feedTs }
        now = t
        refreshStatus()
    }

    /// Stale level, status pill and bus marker staleness for `now`, written only when they change.
    func refreshStatus() {
        let level = liveState.staleLevel(now: now)
        if staleLevel != level { staleLevel = level }
        let pill = LiveText.pill(level: level, polled: liveLoaded, lastOk: lastOk, feedTs: feedTs, loaded: liveLoaded,
                                 busCount: buses.count, silent: silentService)
        if statusPill != pill { statusPill = pill }
        let t = now
        let markers = liveState.buses.enumerated().map { i, b in
            MapBus(id: b.vehicle.id ?? "bus-\(i)", rid: b.trip.routeId ?? "", label: b.displayLabel, coord: b.coord,
                   bearing: b.bearing, stale: b.timestamp > 0 && t - b.timestamp > 60)
        }
        // buses glide to their new position (web drawBuses "smooth glide"), still under reduced motion
        if mapBuses != markers {
            if UIAccessibility.isReduceMotionEnabled { mapBuses = markers }
            else { withAnimation(.easeInOut(duration: 1.0)) { mapBuses = markers } }
        }
    }

    func startClock() {
        clockTask?.cancel()
        clockTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 15_000_000_000)
                guard let self else { return }
                self.now = Date().timeIntervalSince1970
                self.refreshStatus()
            }
        }
    }

    // MARK: Location

    func locate() {
        if config.demo { user = DemoConfig.origin; locState = .granted; flyTo(user, span: 0.012); return }
        location.request()
        if let u = user { flyTo(u, span: 0.012) }
    }

    func nearestStops(max: Int = 3) -> [Geo.NearStop] {
        guard let u = user else { return [] }
        return Geo.nearestStops(staticData.stops, u, max: max, maxM: 1500, routeStops: staticData.routeStops)
    }

    // MARK: Directions

    var plannerData: PlannerData {
        PlannerData(stops: staticData.stops, routeStops: staticData.routeStops, routeOrder: staticData.routeStopIds,
                    trips: liveState.trips, buses: liveState.buses)
    }

    /// Open Directions (optionally to a destination) and plan. Returns the planning task (demo screens await it).
    @discardableResult
    func openDirections(to: Endpoint? = nil) -> Task<Void, Never>? {
        if dir.from == nil, let u = user { dir.from = Endpoint(label: "My location", coord: u, isMe: true) }
        if let to { dir.to = to }
        if page != .directions { push(.directions) }
        return replan()
    }

    /// New endpoints mean a new trip: a started one ends (web directions.js endPlanJourney).
    func setEndpoint(_ which: WritableKeyPath<DirectionsState, Endpoint?>, _ e: Endpoint?) {
        if activeTrip != nil { endTrip() }
        dir[keyPath: which] = e
        replan()
    }

    func swapEndpoints() {
        if activeTrip != nil { endTrip() }
        let f = dir.from
        dir.from = dir.to
        dir.to = f
        replan()
    }

    /// "My location" for a Directions field: now when known, else after the location prompt (web useMyLocation).
    func useMyLocation(to: Bool) {
        dirMeDenied = false
        if let u = user {
            setEndpoint(to ? \DirectionsState.to : \DirectionsState.from, Endpoint(label: "My location", coord: u, isMe: true))
            return
        }
        if locState == .denied { dirMeDenied = true; return }
        pendingMe = to
        locate()
    }

    /// A new location: fill a pending "My location", keep a my-location start current (moves over 50 m re-plan,
    /// like the web), and re-follow the started trip.
    func userMoved(_ p: LatLon) {
        if let to = pendingMe {
            pendingMe = nil
            setEndpoint(to ? \DirectionsState.to : \DirectionsState.from, Endpoint(label: "My location", coord: p, isMe: true))
        } else if page == .directions, dir.from?.isMe == true, Geo.hav(lastUserForDirections ?? dir.from!.coord, p) > 50 {
            lastUserForDirections = p
            dir.from = Endpoint(label: "My location", coord: p, isMe: true)
            replan()
        }
        if activeTrip != nil { refreshTrip() }
    }

    /// A card tapped in Directions: select and frame it; during a trip the timeline follows that option (web
    /// syncJourney(picked) replaces the stops and bus to follow, even on the same route).
    func selectOption(_ i: Int) {
        guard let r = dir.result, r.options.indices.contains(i) else { return }
        dir.selected = i
        fit(planPoints(r.options[i]))
        if let trip = activeTrip, let j = TripJourney.plan(r.options[i], to: trip.label), j.legSignature != trip.journey.legSignature {
            activeTrip = ActiveTrip(option: r.options[i], label: trip.label, startedAt: trip.startedAt, journey: j)
            routeState.journey = Journey(rids: j.rids, label: j.label, kind: .plan)
            refreshTrip(forceActivity: true)
        }
    }

    /// New endpoints: plan on a background thread, then select the first option and frame it on the map, then
    /// swap in sidewalk routes (`refineDirections`). Cancelling the task (new endpoints) drops both results.
    @discardableResult
    func replan() -> Task<Void, Never>? {
        planTask?.cancel()
        planTask = nil
        if dir.refining { dir.refining = false }
        guard let f = dir.from, let t = dir.to else {
            if dir.result != nil { dir.result = nil }
            return nil
        }
        dir.result = nil
        dir.selected = 0
        let task = Task { [weak self] in
            guard let self else { return }
            let r = await self.computePlan(from: f.coord, to: t.coord)
            guard !Task.isCancelled, self.dir.from == f, self.dir.to == t else { return }
            self.dir.result = r
            self.dir.selected = 0
            if let o = r.options.first { self.fit(self.planPoints(o)) }
            await self.refineDirections(r, from: f, to: t)
        }
        planTask = task
        return task
    }

    /// Sidewalk routes for the plan on screen (web directions.js replan): the straight-line estimates show first,
    /// then the routed walks replace them (never shorter than the straight line, every time still "est."),
    /// options are re-ranked and dropped if their bus would now be missed, and the walk-only line is routed.
    /// Keeps the card the rider picked (by route key); a newer plan (cancelled task, new endpoints) wins.
    func refineDirections(_ r: PlanResult, from f: Endpoint, to t: Endpoint) async {
        guard let router = walkCache?.router else { return }
        dir.refining = true
        let data = plannerData, predict = predictor
        let refined = await Planner.refinePlan(r, from: f.coord, to: t.coord, walkRoute: router, data: data, predict: predict)
        guard !Task.isCancelled, dir.from == f, dir.to == t, let cur = dir.result else { return }
        let opts = cur.options
        let oldKey = opts.indices.contains(dir.selected) ? opts[dir.selected].key : nil
        let picked = dir.selected != 0
        let sel = (picked ? oldKey.flatMap { k in refined.options.firstIndex { $0.key == k } } : nil) ?? 0
        dir.result = refined
        dir.selected = sel
        dir.refining = false
        // re-ranking can put another route first: frame that one
        if refined.options.indices.contains(sel), refined.options[sel].key != oldKey { fit(planPoints(refined.options[sel])) }
    }

    /// Minimum seconds between background re-plans of the open Directions.
    static let dirRefreshS = 8.0

    /// New live data while Directions is open: re-plan in the background with the new predictions (like the
    /// web's replan on trips/buses changes) so "(live)" boarding times and waits stay current. Keeps the
    /// selected option (by route key), never moves the map, skipped while a new-endpoint plan is running.
    func refreshDirections() {
        // `dir.result` is nil while a new-endpoint plan runs (replan clears it), so this never races it.
        guard page == .directions, let f = dir.from, let t = dir.to, dir.result != nil, !dir.refining,
              dirRefreshTask == nil, !liveState.failed else { return }
        let wall = Date().timeIntervalSince1970
        guard wall - lastDirRefresh >= Self.dirRefreshS else { return }
        lastDirRefresh = wall
        dirRefreshTask = Task { [weak self] in
            guard let self else { return }
            var r = await self.computePlan(from: f.coord, to: t.coord)
            if let router = self.walkCache?.router {   // cached sidewalk routes: the walks stay routed
                r = await Planner.refinePlan(r, from: f.coord, to: t.coord, walkRoute: router, data: self.plannerData,
                                             predict: self.predictor)
            }
            self.dirRefreshTask = nil
            // Drop it if the endpoints changed meanwhile (a fresh plan is coming) or Directions closed.
            guard self.page == .directions, self.dir.from == f, self.dir.to == t, let old = self.dir.result else { return }
            let key = old.options.indices.contains(self.dir.selected) ? old.options[self.dir.selected].key : nil
            self.dir.result = r
            self.dir.selected = key.flatMap { k in r.options.firstIndex { $0.key == k } } ?? min(self.dir.selected, max(0, r.options.count - 1))
            // a live re-plan never moves the boarding stop of a started trip; only another set of routes replaces it
            if let trip = self.activeTrip, r.options.indices.contains(self.dir.selected),
               let j = TripJourney.plan(r.options[self.dir.selected], to: trip.label), Set(j.rids) != Set(trip.journey.rids) {
                self.activeTrip = ActiveTrip(option: r.options[self.dir.selected], label: trip.label, startedAt: trip.startedAt, journey: j)
                self.routeState.journey = Journey(rids: j.rids, label: j.label, kind: .plan)
                self.refreshTrip()
            }
        }
    }

    /// `Planner.plan` off the main thread (its inputs are Sendable value snapshots).
    func computePlan(from: LatLon, to: LatLon) async -> PlanResult {
        let data = plannerData, predict = predictor, t = Date().timeIntervalSince1970
        return await Task.detached(priority: .userInitiated) {
            Planner.plan(from: from, to: to, now: t, data: data, predict: predict)
        }.value
    }

    /// Everything the map draws for an option (sidewalk walks, road-following bus legs), for framing it.
    func planPoints(_ o: TripOption) -> [LatLon] {
        o.legs.flatMap { l -> [LatLon] in
            switch l {
            case .walk(let w): return w.coords ?? [w.from.coord, w.to.coord]
            case .bus(let b): return roadPath(b)
            }
        }
    }

    /// Directions suggestions for a field's text (web directions.js computeSugs): My location, then stations whose
    /// name has the whole typed word(s), strong nearby places (on-device, whole-word name match), stations that only
    /// partly match, other places (Photon's merged in). With a spelling assumption, stations are matched with the
    /// corrected text too. Pure and nonisolated, so it runs off the main thread.
    nonisolated static func suggestions(_ q: String, user: LatLon?, staticData S: StaticData, places: [PlaceHit],
                                        assumed: SearchAssumption?) -> [Endpoint] {
        let t = q.trimmingCharacters(in: .whitespacesAndNewlines)
        var out: [Endpoint] = []
        if t.isEmpty || "my location".hasPrefix(t.lowercased()) {
            out.append(Endpoint(label: "My location", coord: user ?? LatLon(lat: .nan, lon: .nan), isMe: true,
                                sub: user != nil ? "Use current location" : "Allow location access"))
        }
        guard !t.isEmpty else { return out }
        let qw = PlaceIndex.norm(t).split(separator: " ").map(String.init)
        var found = StationSearch.match(S.stops, stopRoutes: S.stopRoutes, t, max: 5)
        if found.isEmpty, let a = assumed { found = StationSearch.match(S.stops, stopRoutes: S.stopRoutes, a.to, max: 5) }
        func routesText(_ id: String) -> String {
            (S.stopRoutes[id] ?? []).map { rid in
                guard let r = S.routes[rid] else { return rid }
                return !r.short.isEmpty ? r.short : !r.long.isEmpty ? r.long : rid
            }.joined(separator: ", ")
        }
        let stops = found.map { m -> (e: Endpoint, whole: Bool) in
            let words = Set(PlaceIndex.norm(m.name).split(separator: " ").map(String.init))
            return (Endpoint(label: m.name, coord: m.coord, stopId: m.id, sub: "Shuttle stop · " + routesText(m.id)), qw.allSatisfy { words.contains($0) })
        }
        let pl = places.map { (e: Endpoint(label: $0.label, coord: $0.coord, sub: $0.sub.isEmpty ? "Place" : $0.sub), strong: $0.local && $0.score >= 85) }
        out += stops.filter(\.whole).map(\.e) + pl.filter(\.strong).map(\.e) + stops.filter { !$0.whole }.map(\.e) + pl.filter { !$0.strong }.map(\.e)
        return out
    }

    func placeSubtitle(_ e: Endpoint) -> String {
        if e.isMe { return e.sub ?? "Current location" }
        if let sub = e.sub { return sub }
        if let id = e.stopId { return "Shuttle stop" + (staticData.addresses[id].map { " · " + $0.address } ?? "") }
        return "Place"
    }

    // MARK: Routes to station (web ui/views/pick.js)

    /// Choose the station: only the routes serving it on the list and map ("Routes to <station>"); with
    /// "Only show the chosen station's routes" also a station journey hiding the others. Opens Routes.
    func chooseStation(_ id: String) {
        var rids: [String] = []
        for r in staticData.stopRoutes[id] ?? [] where !rids.contains(r) { rids.append(r) }
        guard !rids.isEmpty else { return }
        let label = staticData.stops[id]?.name ?? "station"
        apply(StatePatch(routeFilter: .some(RouteFilter(ids: rids, label: label))))
        if pickOnly && activeTrip == nil { routeState.journey = stationJourney() }
        pickHighlights = []
        pickMode = nil
        paths[.current] = (paths[.current] ?? []).filter { $0 != .pick }
        paths[.routes] = []
        tab = .routes
        if detent == .peek { detent = .half }
        syncMapFocus()
        fit(rids.flatMap { (staticData.shapes[$0] ?? []).flatMap { $0 } })
    }

    /// Journey for the station filter: its routes the user has not hidden (all of them if every one is hidden).
    func stationJourney() -> Journey? {
        guard let f = routeState.routeFilter, !f.ids.isEmpty else { return nil }
        let hiddenByUser = Set(routeState.hiddenRoutes)
        let vis = f.ids.filter { !hiddenByUser.contains($0) }
        return Journey(rids: vis.isEmpty ? f.ids : vis, label: f.label, kind: .station)
    }

    /// Clear "Routes to <station>" (a station journey ends with it).
    func clearRouteFilter() {
        apply(StatePatch(routeFilter: .some(nil)))
        if routeState.journey?.kind == .station { routeState.journey = nil }
    }

    /// "Only show these routes" / "Show all routes" for the station filter.
    func toggleStationJourney() {
        if routeState.journey?.kind == .station { routeState.journey = nil }
        else if activeTrip == nil { routeState.journey = stationJourney() }
    }

    /// "Show all" on the map context bar / journey bar: ends the trip or the station journey (web journey:end).
    func endJourney() {
        guard let j = routeState.journey else { return }
        if j.kind == .plan { endTrip() } else { routeState.journey = nil; apply(StatePatch(routeFilter: .some(nil))) }
    }

    /// A tap on empty map lowers the sheet to peek (web onMapTap), never right after a stop or bus tap.
    func mapTapped() {
        let at = Date().timeIntervalSince1970
        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 180_000_000)
            // a stop / bus tap delivered just before or after this one: that was not the empty map
            guard let self, self.lastAnnotationTap < at - 0.4 else { return }
            if self.detent != .peek { self.detent = .peek }
        }
    }

    /// A bus tapped on the map opens its route WITHOUT moving the map (web main.js openRoute(rid, false)).
    func busTapped(_ rid: String) {
        lastAnnotationTap = Date().timeIntervalSince1970
        guard staticData.routes[rid] != nil else { return }
        paths[tab, default: []].append(.route(rid))
        if detent == .peek { detent = .half }
        syncMapFocus()
    }

    /// A stop tapped on the map: picks it in Routes to station or fills the Directions field being edited (web
    /// onStopTap), else opens the stop.
    func stopTapped(_ id: String) {
        lastAnnotationTap = Date().timeIntervalSince1970
        switch page {
        case .pick?: chooseStation(id)
        case .directions?:
            guard let st = staticData.stops[id] else { return }
            let e = Endpoint(label: st.name, coord: st.coord, stopId: id)
            setEndpoint(dirActiveTo ? \DirectionsState.to : \DirectionsState.from, e)
        default: push(.stop(id))
        }
    }

    // MARK: Trip

    /// Start the selected option: only its routes on the map ("Only showing routes for: To X"), Current trip shows
    /// the progress timeline following the planned bus, and the Live Activity starts (if enabled).
    func startTrip(_ o: TripOption, label: String) {
        guard let j = TripJourney.plan(o, to: label) else { return }
        activeTrip = ActiveTrip(option: o, label: label, startedAt: now, journey: j)
        routeState.journey = Journey(rids: j.rids, label: j.label, kind: .plan)
        paths[.current] = []
        tab = .current
        detent = .half
        location.setTripMode(true)
        refreshTrip()
        if notify.liveActivity, let snap = tripFollow?.snapshot(staticData: staticData, now: now) {
            liveActivity.start(title: "To \(label)", state: snap, simulated: feedSimulated)
            lastActivityPush = (snap: snap, at: Date().timeIntervalSince1970)
        }
        fit(planPoints(o))
    }

    func endTrip() {
        if let snap = tripFollow?.snapshot(staticData: staticData, now: now) { liveActivity.end(final: snap) } else { liveActivity.end() }
        activeTrip = nil
        tripFollow = nil
        lastActivityPush = nil
        if routeState.journey?.kind == .plan { routeState.journey = nil }
        location.setTripMode(false)
    }

    func refreshTrip(forceActivity: Bool = false) {
        guard let trip = activeTrip else { return }
        let p = TripFollow.compute(trip.journey, staticData: staticData, live: liveState, user: user, now: now)
        if tripFollow != p { tripFollow = p }
        if let snap = p?.snapshot(staticData: staticData, now: now) { pushLiveActivity(snap, force: forceActivity) }
    }

    /// The Live Activity refresh interval when nothing visible changed (it marks itself stale 120 s after the
    /// last update, so this keeps it fresh while the app runs).
    static let activityRefreshS = 60.0

    /// Send `snap` to the Live Activity only when what it shows changed (asOf ignored, countdown targets within
    /// 20 s count as equal) or the last update is `activityRefreshS` old. ActivityKit updates cost battery
    /// and the system budgets them; the countdown ticks on its own in between.
    func pushLiveActivity(_ snap: LiveTripSnapshot, force: Bool = false) {
        guard liveActivity.isRunning else { return }
        let t = Date().timeIntervalSince1970
        if !force, let last = lastActivityPush, last.snap.sameContent(as: snap), t - last.at < Self.activityRefreshS { return }
        liveActivity.update(snap)
        lastActivityPush = (snap: snap, at: t)
    }

    /// Going to the background: one fresh update so the Lock Screen starts from current numbers (its stale
    /// mark then appears 120 s later if no push server takes over).
    func flushLiveActivity() {
        guard activeTrip != nil else { return }
        now = Date().timeIntervalSince1970
        refreshTrip(forceActivity: true)
    }

    // MARK: Demo

    func seedDemo() {
        var s = routeState
        s.customRoutes = DemoConfig.customRoutes(staticData)
        s.favStops = DemoConfig.favoriteStops.filter { staticData.stops[$0] != nil }
        routeState = s
        notify.stopId = DemoConfig.favoriteStops.first
    }

    var demoDestination: Endpoint {
        let hit = places?.search(DemoConfig.destinationLabel).first { abs($0.lat - DemoConfig.destination.lat) < 0.002 }
        return Endpoint(label: hit?.label ?? DemoConfig.destinationLabel, coord: hit?.coord ?? DemoConfig.destination, sub: hit?.sub)
    }

    /// Open the screen named by `-screen` (simulator screenshots).
    func applyLaunchScreen() {
        Task { @MainActor in
            await pollOnce()
            switch config.screen ?? "current" {
            case "trip":
                _ = await openDirections(to: demoDestination)?.value
                if let o = dir.result?.options.first(where: { !$0.busLegs.isEmpty }) { startTrip(o, label: demoDestination.label) }
            case "routes": select(.routes)
            case "route": select(.routes); push(.route(staticData.routes[DemoConfig.routeForDetail] != nil ? DemoConfig.routeForDetail : staticData.routeIds.first ?? ""))
            case "myroutes": select(.myroutes); apply(Custom.applyCustom(routeState, "demo-commute"))
            case "directions": _ = await openDirections(to: demoDestination)?.value
            case "stop": push(.stop(DemoConfig.stopForDetail))
            case "settings": showSettings = true
            case "liveactivity":
                _ = await openDirections(to: demoDestination)?.value
                if let o = dir.result?.options.first(where: { !$0.busLegs.isEmpty }) { startTrip(o, label: demoDestination.label) }
                showLiveActivityPreview = true
            case "about": select(.myroutes); push(.about)
            case "alerts": push(.alerts)
            case "custom": select(.myroutes); apply(Custom.applyCustom(routeState, "demo-commute")); push(.customRoute("demo-commute"))
            case "editor": select(.myroutes); push(.editCustom("demo-commute"))
            case "order": select(.routes); editingOrder = true
            case "settingsdemo": showSettings = true   // SettingsView scrolls to the Demo section
            case "pick": pickMode = .loc; push(.pick)
            case "search":
                openDirections()
                demoQuery = "regnstien"
            default: break
            }
            if let d = config.detent { detent = d == "full" ? .full : d == "peek" ? .peek : .half }
            if config.tour { await runTour() }
        }
    }

    /// Automatic walk-through for the simulator recording (~25 s).
    func runTour() async {
        func pause(_ s: Double) async { try? await Task.sleep(nanoseconds: UInt64(s * 1_000_000_000)) }
        await pause(2.5)
        _ = await openDirections(to: demoDestination)?.value
        await pause(3)
        if dir.result?.options.count ?? 0 > 1 { dir.selected = 1; await pause(1.5); dir.selected = 0; await pause(1) }
        if let o = dir.result?.options.first(where: { !$0.busLegs.isEmpty }) { startTrip(o, label: demoDestination.label) }
        await pause(3)
        detent = .full
        await pause(3)
        detent = .half
        select(.routes)
        await pause(2.5)
        push(.route(DemoConfig.routeForDetail))
        await pause(3)
        select(.myroutes)
        await pause(2.5)
        push(.alerts)
        await pause(2)
        showSettings = true
        await pause(3)
        showSettings = false
        select(.current)
        await pause(3)
    }
}
