import Foundation
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
            if let p { self.user = p }
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
                let delay: Double = self.config.demo ? 5 : (self.failures >= 3 ? 30 : 10)
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
        if config.demo {
            poll = DemoFeed.poll(staticData: staticData, now: Date().timeIntervalSince1970, epoch: epoch)
        } else {
            let started = Date().timeIntervalSince1970
            let withAlerts = started - lastAlertsPoll >= Self.alertsEveryS
            poll = await FeedClient().poll(alerts: withAlerts)
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

    /// Stale level and bus marker staleness for `now`, written only when they change.
    func refreshStatus() {
        let level = liveState.staleLevel(now: now)
        if staleLevel != level { staleLevel = level }
        let t = now
        let markers = liveState.buses.enumerated().map { i, b in
            MapBus(id: b.vehicle.id ?? "bus-\(i)", rid: b.trip.routeId ?? "", label: b.displayLabel, coord: b.coord,
                   bearing: b.bearing, stale: b.timestamp > 0 && t - b.timestamp > 60)
        }
        if mapBuses != markers { mapBuses = markers }
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

    func setEndpoint(_ which: WritableKeyPath<DirectionsState, Endpoint?>, _ e: Endpoint?) {
        dir[keyPath: which] = e
        replan()
    }

    func swapEndpoints() {
        let f = dir.from
        dir.from = dir.to
        dir.to = f
        replan()
    }

    /// New endpoints: plan on a background thread, then select the first option and frame it on the map.
    @discardableResult
    func replan() -> Task<Void, Never>? {
        planTask?.cancel()
        planTask = nil
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
        }
        planTask = task
        return task
    }

    /// Minimum seconds between background re-plans of the open Directions.
    static let dirRefreshS = 8.0

    /// New live data while Directions is open: re-plan in the background with the new predictions (like the
    /// web's replan on trips/buses changes) so "(live)" boarding times and waits stay current. Keeps the
    /// selected option (by route key), never moves the map, skipped while a new-endpoint plan is running.
    func refreshDirections() {
        // `dir.result` is nil while a new-endpoint plan runs (replan clears it), so this never races it.
        guard page == .directions, let f = dir.from, let t = dir.to, dir.result != nil,
              dirRefreshTask == nil, !liveState.failed else { return }
        let wall = Date().timeIntervalSince1970
        guard wall - lastDirRefresh >= Self.dirRefreshS else { return }
        lastDirRefresh = wall
        dirRefreshTask = Task { [weak self] in
            guard let self else { return }
            let r = await self.computePlan(from: f.coord, to: t.coord)
            self.dirRefreshTask = nil
            // Drop it if the endpoints changed meanwhile (a fresh plan is coming) or Directions closed.
            guard self.page == .directions, self.dir.from == f, self.dir.to == t, let old = self.dir.result else { return }
            let key = old.options.indices.contains(self.dir.selected) ? old.options[self.dir.selected].key : nil
            self.dir.result = r
            self.dir.selected = key.flatMap { k in r.options.firstIndex { $0.key == k } } ?? min(self.dir.selected, max(0, r.options.count - 1))
        }
    }

    /// `Planner.plan` off the main thread (its inputs are Sendable value snapshots).
    func computePlan(from: LatLon, to: LatLon) async -> PlanResult {
        let data = plannerData, predict = predictor, t = Date().timeIntervalSince1970
        return await Task.detached(priority: .userInitiated) {
            Planner.plan(from: from, to: to, now: t, data: data, predict: predict)
        }.value
    }

    func planPoints(_ o: TripOption) -> [LatLon] {
        o.legs.flatMap { l -> [LatLon] in
            switch l {
            case .walk(let w): return [w.from.coord, w.to.coord]
            case .bus(let b): return b.path
            }
        }
    }

    /// Station + local place suggestions for a typed query (all on device). Pure and nonisolated, so
    /// DirectionsView runs it off the main thread.
    nonisolated static func suggestions(_ q: String, user: LatLon?, stops: [Stop], places: PlaceIndex?) -> [Endpoint] {
        let n = PlaceIndex.norm(q)
        var out: [Endpoint] = []
        if n.isEmpty || "my location".hasPrefix(n), let u = user { out.append(Endpoint(label: "My location", coord: u, isMe: true)) }
        guard n.count >= 2 else { return out }
        let hits = stops.filter { PlaceIndex.norm($0.name).contains(n) }.sorted { $0.name < $1.name }.prefix(4)
        out += hits.map { Endpoint(label: $0.name, coord: $0.coord, stopId: $0.id) }
        out += (places?.search(q) ?? []).map { Endpoint(label: $0.label, coord: $0.coord, sub: $0.sub) }
        return out
    }

    func placeSubtitle(_ e: Endpoint) -> String {
        if e.isMe { return "Current location" }
        if let id = e.stopId { return "Shuttle stop" + (staticData.addresses[id].map { " · " + $0.address } ?? "") }
        return e.sub ?? "Place"
    }

    // MARK: Trip

    /// Start the selected option: only its routes on the map, Current trip shows the progress timeline,
    /// and the Live Activity starts (if enabled).
    func startTrip(_ o: TripOption, label: String) {
        activeTrip = ActiveTrip(option: o, label: label, startedAt: now)
        routeState.journey = Journey(rids: o.busLegs.map(\.rid), label: label, kind: .plan)
        paths[.current] = []
        tab = .current
        detent = .half
        location.setTripMode(true)
        refreshTrip()
        if notify.liveActivity, let snap = tripProgress?.snapshot(staticData: staticData) {
            liveActivity.start(title: "To \(label)", state: snap)
            lastActivityPush = (snap: snap, at: Date().timeIntervalSince1970)
        }
        fit(planPoints(o))
    }

    func endTrip() {
        if let snap = tripProgress?.snapshot(staticData: staticData) { liveActivity.end(final: snap) } else { liveActivity.end() }
        activeTrip = nil
        tripProgress = nil
        lastActivityPush = nil
        routeState.journey = nil
        location.setTripMode(false)
    }

    func refreshTrip(forceActivity: Bool = false) {
        guard let trip = activeTrip else { return }
        let p = TripProgress.compute(option: trip.option, staticData: staticData, live: liveState, now: now)
        tripProgress = p
        if let snap = p.snapshot(staticData: staticData) { pushLiveActivity(snap, force: forceActivity) }
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
        showSettings = true
        await pause(3)
        showSettings = false
        select(.current)
        await pause(3)
    }
}
