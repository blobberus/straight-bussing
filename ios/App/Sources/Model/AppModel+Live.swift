import Foundation
import StraightBussingKit

/// Loading, polling, location, directions and the started trip.
extension AppModel {
    /// Boot: bundled static data, prefs, then live polling (or the demo feed).
    func start() {
        guard staticData.isEmpty else { return }
        if let dir = Bundle.main.url(forResource: "data", withExtension: nil) {
            let loaded = StaticLoader.load(from: dir)
            staticData = loaded.data
            staticFailed = loaded.failed
            places = StaticLoader.loadPlaces(from: dir)
        } else {
            staticFailed = ["data (bundle folder missing)"]
        }
        predictor = SchedulePredictor(segments: staticData.segments, routeStops: staticData.routeStops)
        loadPrefs()
        location.onUpdate = { [weak self] p, st in
            guard let self, !self.config.demo else { return }
            self.locState = st
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
        startClock()
        resumePolling()
        if config.demo { applyLaunchScreen() }
    }

    // MARK: Polling

    func resumePolling() {
        guard pollTask == nil, !staticData.isEmpty || !staticFailed.isEmpty else { return }   // after start()
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
            poll = await FeedClient().poll()
        }
        let t = Date().timeIntervalSince1970
        live = live.applying(poll, staticData: staticData, now: t)
        failures = live.failed ? failures + 1 : 0
        now = t
        refreshTrip()
    }

    func startClock() {
        clockTask?.cancel()
        clockTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 15_000_000_000)
                guard let self else { return }
                self.now = Date().timeIntervalSince1970
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
                    trips: live.trips, buses: live.buses)
    }

    func openDirections(to: Endpoint? = nil) {
        if dir.from == nil, let u = user { dir.from = Endpoint(label: "My location", coord: u, isMe: true) }
        if let to { dir.to = to }
        if page != .directions { push(.directions) }
        replan()
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

    func replan() {
        guard let f = dir.from, let t = dir.to else { dir.result = nil; return }
        dir.result = Planner.plan(from: f.coord, to: t.coord, now: now, data: plannerData, predict: predictor)
        dir.selected = 0
        if let o = dir.result?.options.first { fit(planPoints(o)) }
    }

    func planPoints(_ o: TripOption) -> [LatLon] {
        o.legs.flatMap { l -> [LatLon] in
            switch l {
            case .walk(let w): return [w.from.coord, w.to.coord]
            case .bus(let b): return b.path
            }
        }
    }

    /// Station + local place suggestions for a typed query (all on device).
    func suggestions(_ q: String) -> [Endpoint] {
        let n = PlaceIndex.norm(q)
        var out: [Endpoint] = []
        if n.isEmpty || "my location".hasPrefix(n), let u = user { out.append(Endpoint(label: "My location", coord: u, isMe: true)) }
        guard n.count >= 2 else { return out }
        let stops = staticData.stops.values.filter { PlaceIndex.norm($0.name).contains(n) }.sorted { $0.name < $1.name }.prefix(4)
        out += stops.map { Endpoint(label: $0.name, coord: $0.coord, stopId: $0.id) }
        out += (places?.search(q) ?? []).map { Endpoint(label: $0.label, coord: $0.coord) }
        return out
    }

    func placeSubtitle(_ e: Endpoint) -> String {
        if e.isMe { return "Current location" }
        if let id = e.stopId { return "Shuttle stop" + (staticData.addresses[id].map { " · " + $0.address } ?? "") }
        return places?.search(e.label, limit: 1).first?.sub ?? "Place"
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
        refreshTrip()
        if notify.liveActivity, let snap = tripProgress?.snapshot(staticData: staticData) {
            liveActivity.start(title: "To \(label)", state: snap)
        }
        fit(planPoints(o))
    }

    func endTrip() {
        if let snap = tripProgress?.snapshot(staticData: staticData) { liveActivity.end(final: snap) } else { liveActivity.end() }
        activeTrip = nil
        tripProgress = nil
        routeState.journey = nil
    }

    func refreshTrip() {
        guard let trip = activeTrip else { return }
        let p = TripProgress.compute(option: trip.option, staticData: staticData, live: live, now: now)
        tripProgress = p
        if let snap = p.snapshot(staticData: staticData) { liveActivity.update(snap) }
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
        return Endpoint(label: hit?.label ?? DemoConfig.destinationLabel, coord: hit?.coord ?? DemoConfig.destination)
    }

    /// Open the screen named by `-screen` (simulator screenshots).
    func applyLaunchScreen() {
        Task { @MainActor in
            await pollOnce()
            switch config.screen ?? "current" {
            case "trip":
                openDirections(to: demoDestination)
                if let o = dir.result?.options.first(where: { !$0.busLegs.isEmpty }) { startTrip(o, label: demoDestination.label) }
            case "routes": select(.routes)
            case "route": select(.routes); push(.route(staticData.routes[DemoConfig.routeForDetail] != nil ? DemoConfig.routeForDetail : staticData.routeIds.first ?? ""))
            case "myroutes": select(.myroutes); apply(Custom.applyCustom(routeState, "demo-commute"))
            case "directions": openDirections(to: demoDestination)
            case "stop": push(.stop(DemoConfig.stopForDetail))
            case "settings": showSettings = true
            case "liveactivity":
                openDirections(to: demoDestination)
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
        openDirections(to: demoDestination)
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
