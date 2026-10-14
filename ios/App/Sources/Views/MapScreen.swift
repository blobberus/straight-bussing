import MapKit
import SwiftUI
import StraightBussingKit

/// The live map (web/js/map): route lines in route colors stacked by draw order (focused routes on top,
/// others dimmed), stops, live buses with heading, the user's position, and a started/selected trip. During a
/// started trip (Kit `TripYou`, web ui/tripmap.js) you are drawn where the trip says: on the bus you ride (a ring and
/// "You" on its marker; the GPS dot steps back), the boarding stop as a guess ("You (est.)") without GPS, else the
/// normal GPS dot; your stops carry "Board here" / the get-off count, the same numbers as the card and the alerts.
///
/// Cheap to re-evaluate on purpose: lines and stops come from `AppModel.mapLayers` (cached per visibility
/// change), bus staleness is computed at poll time, the camera lives in its own observable, the real user
/// location is MapKit's `UserAnnotation` (no redraw per location update) and the bottom inset is applied by
/// the caller, so this body only re-runs when buses, the trip/plan or the visible routes change.
///
/// Building and place names (owner 2026-10-13, web map/landmarks.js): text annotations under everything else, placed
/// by the Kit (`Landmarks.place`) when the camera stops moving (`layoutLabels`), kept in `AppModel.mapLabels`; Apple's
/// own points of interest stay off (they would name places twice).
struct MapScreen: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dynamicTypeSize) private var typeSize

    /// The trip drawn on the map: the started one, else the selected Directions option.
    var plan: TripOption? {
        if let t = model.activeTrip { return t.option }
        if model.page == .directions, let r = model.dir.result, r.options.indices.contains(model.dir.selected) { return r.options[model.dir.selected] }
        return nil
    }

    /// Directions with no shuttle option: the walk the whole way (sidewalk route once refined), like the web.
    var walkOnly: [LatLon]? {
        guard model.activeTrip == nil, model.page == .directions, let r = model.dir.result, r.options.isEmpty,
              let f = model.dir.from?.coord, let t = model.dir.to?.coord else { return nil }
        return r.walkOnlyCoords ?? [f, t]
    }

    var body: some View {
        @Bindable var camera = model.mapCamera
        let layers = model.mapLayers
        let buses = model.mapBuses.filter { !layers.hidden.contains($0.rid) }
        let drawn = plan, ring = ringed   // once per body, not once per stop
        // you on the started trip (Kit TripYou, the same evaluation as the card, the alerts and the Live Activity)
        let you = model.activeTrip != nil ? model.tripYou : nil
        let youBus: String? = you.flatMap { $0.onBus && $0.point != nil ? $0.vehicleId : nil }
        let youOnDrawnBus = youBus != nil && buses.contains { $0.id == youBus }
        let labels = you?.stopLabels ?? []
        // a marker of its own: the boarding stop as a guess (no GPS), or the bus you ride when its marker is not drawn
        let youMark: (at: LatLon, guess: Bool)? = you.flatMap { y in
            guard let p = y.point else { return nil }
            if y.source == .stop { return (p, true) }
            if y.onBus && !youOnDrawnBus { return (p, false) }
            return nil
        }
        let hideDot = you?.onBus == true   // on the bus: the GPS dot steps back (same place, or worse)
        let walk = walkOnly
        // the map labels: drawn from the last layout; laid out again on camera end or when what they avoid changes
        let placed = model.mapLabels.placed
        let labelScale = MapLabelModel.scale(typeSize)
        let labelSig = labelSignature(layers, ring: ring, tripLabels: labels, youGuess: youMark.flatMap { $0.guess ? $0.at : nil },
                                      plan: drawn, walkEnd: walk?.last)
        MapReader { proxy in
        Map(position: $camera.position) {
            // building and place names first: stops, buses, the trip and you are drawn over them, and they never take a tap
            ForEach(placed, id: \.drawKey) { p in
                Annotation("", coordinate: p.landmark.coord.cl, anchor: p.anchor.unitPoint) {
                    LandmarkLabel(label: p).equatable()
                }
                .annotationTitles(.hidden)
            }
            ForEach(layers.lines) { l in
                MapPolyline(coordinates: l.coords)
                    .stroke(l.color, style: StrokeStyle(lineWidth: l.width, lineCap: .round, lineJoin: .round))
            }
            if let o = drawn {
                ForEach(Array(o.walkLegs.enumerated()), id: \.offset) { item in
                    MapPolyline(coordinates: (item.element.coords ?? [item.element.from.coord, item.element.to.coord]).map(\.cl))
                        .stroke(.blue, style: StrokeStyle(lineWidth: 4, lineCap: .round, dash: [2, 7]))
                }
                // bus legs along the route's road shape between the stops (Kit Geometry.alongShape), cached
                ForEach(Array(o.busLegs.enumerated()), id: \.offset) { item in
                    MapPolyline(coordinates: model.roadPath(item.element).map(\.cl))
                        .stroke(Color(hex: model.route(item.element.rid)?.color), style: StrokeStyle(lineWidth: 8, lineCap: .round, lineJoin: .round))
                }
                if let last = o.legs.last {
                    let end = last.walk?.to.coord ?? last.bus?.alight.coord ?? LatLon(lat: 0, lon: 0)
                    Marker("Destination", systemImage: "mappin", coordinate: end.cl).tint(.red)
                }
            }
            if let w = walk, let end = w.last {
                MapPolyline(coordinates: w.map(\.cl))
                    .stroke(.blue, style: StrokeStyle(lineWidth: 4, lineCap: .round, dash: [2, 7]))
                Marker("Destination", systemImage: "mappin", coordinate: end.cl).tint(.red)
            }
            // direction-of-travel chevrons along 1-3 focused routes (decorative, never intercept taps)
            ForEach(layers.chevrons) { c in
                Annotation("", coordinate: c.coord, anchor: .center) {
                    Image(systemName: "chevron.up")
                        .font(.system(size: 9, weight: .black))
                        .foregroundStyle(.white)
                        .padding(2)
                        .background(c.color, in: Circle())
                        .rotationEffect(.degrees(c.bearing))
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
                .annotationTitles(.hidden)
            }
            ForEach(layers.stops) { s in
                Annotation(s.stop.name, coordinate: s.stop.coord.cl, anchor: .center) {
                    StopDot(id: s.id, isFav: s.isFav, faded: drawn != nil, ring: ring.contains(s.id)) { model.stopTapped(s.id) }
                        .equatable()
                        .accessibilityLabel(s.isFav ? "Favorite stop \(s.stop.name)" : "Stop \(s.stop.name)")
                }
                .annotationTitles(.hidden)
            }
            // the trip's stops: "Board here" and the get-off count (the card's and the alerts' numbers) under their
            // stops, as on the web (the destination marker and the You pill sit above their points); never in the way of a tap
            ForEach(labels, id: \.self) { l in
                let board = l.text == "Board here"
                Annotation("", coordinate: l.point.cl, anchor: UnitPoint.top) {
                    TripStopLabel(text: l.text, off: !board)
                        .padding(.top, 12)
                        .allowsHitTesting(false)
                        .accessibilityLabel("\(l.text), \(l.stopName)")
                }
                .annotationTitles(.hidden)
            }
            if let m = youMark, let y = you {
                Annotation("", coordinate: m.at.cl, anchor: .center) {
                    YouMarker(guess: m.guess)
                        .allowsHitTesting(false)
                        .accessibilityLabel(y.text)
                }
                .annotationTitles(.hidden)
            }
            ForEach(buses) { b in
                let isYou = youOnDrawnBus && b.id == youBus
                Annotation(b.label, coordinate: b.coord.cl, anchor: .center) {
                    Button { model.busTapped(b.rid) } label: {
                        BusMarker(route: model.route(b.rid), bearing: b.bearing, stale: b.stale, youText: isYou ? you?.text : nil)
                            .frame(minWidth: 44, minHeight: 44)
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint("Opens the route")
                }
                .annotationTitles(.hidden)
            }
            // Demo mode: a fixed simulated position. Real location: MapKit's own user dot. Both step back while you
            // are drawn on the bus.
            if model.config.demo, !hideDot, let u = model.user {
                Annotation("My location", coordinate: u.cl, anchor: .center) { UserDot() }
                    .annotationTitles(.hidden)
            }
            if !model.config.demo && !hideDot {
                UserAnnotation()
            }
        }
        .mapStyle(.standard(elevation: .flat, pointsOfInterest: .excludingAll))
        .mapControls { MapCompass() }
        // the names are laid out when the camera stops, not on every frame of a pan or zoom: each frame only notes the
        // time, the layout runs once the camera has been still for 0.3 s (with .onEnd alone, the names stayed where an
        // earlier camera had put them after the app's own camera glides in the CI simulator)
        .onMapCameraChange(frequency: .continuous) { _ in model.mapLabels.cameraMoved { layoutLabels(proxy, scale: labelScale) } }
        // a tap on empty map lowers the sheet to peek (web onMapTap). Simultaneous, so it never blocks the stop / bus
        // buttons; `mapTapped` ignores a tap that also hit one of them.
        .simultaneousGesture(TapGesture().onEnded { model.mapTapped() })
        .accessibilityLabel("Shuttle map")
        // follow camera (AppModel+Follow.swift), watched by a child view so this body does not re-run on a pan or a
        // settled sheet
        .background { FollowWatcher(camera: model.mapCamera, you: you) { followCheck(proxy) } }
        .background {
            LabelWatcher(camera: model.mapCamera, labels: model.mapLabels, signature: labelSig, scale: labelScale) {
                layoutLabels(proxy, scale: labelScale)
            }
        }
        }
    }

    /// Is every point of the trip's frame inside the visible map (above the sheet, below the chrome)? Then nothing
    /// moves; else the model frames it (and on a phase or leg change).
    func followCheck(_ proxy: MapProxy) {
        let cam = model.mapCamera
        guard cam.follow, model.activeTrip != nil, let y = model.tripYou else { return }
        let r = cam.visibleRect.insetBy(dx: -2, dy: -2)
        let out = y.frame.contains { p in
            guard let pt = proxy.convert(p.cl, to: .global) else { return true }
            return !r.contains(pt)
        }
        model.followTrip(y, outOfView: out)
    }

    /// Stops with a ring: the Routes to station candidates, else the open stop (web highlightStops / setSelectedStop).
    var ringed: Set<String> {
        if !model.pickHighlights.isEmpty { return Set(model.pickHighlights) }
        if case .stop(let id)? = model.page { return [id] }
        return []
    }
}

// MARK: Map labels (building and place names)

extension MapScreen {
    /// Lay the names out for the camera now (web map/landmarks.js refresh): the zoom from the ground scale at the center
    /// of the visible map (the web's zoom; a rotated map keeps it), the names shown at that zoom inside the visible box,
    /// projected by MapKit, then the Kit's placement inside the visible map (below the floating chrome, above the
    /// sheet). Called on camera end, a resized visible map, new obstacles, new landmarks or a new text size; it reads
    /// the model outside any view body, so only a changed result redraws the map.
    func layoutLabels(_ proxy: MapProxy, scale: Double) {
        let labels = model.mapLabels
        let view = model.mapCamera.visibleRect
        // the expanded sheet covers the map: no names under it
        guard !labels.landmarks.isEmpty, view.width >= 80, view.height >= 60 else { labels.show([]); return }
        let mid = CGPoint(x: view.midX, y: view.midY)
        guard let a = proxy.convert(CGPoint(x: mid.x - 50, y: mid.y), from: .global),
              let b = proxy.convert(CGPoint(x: mid.x + 50, y: mid.y), from: .global) else { return }
        let la = LatLon(lat: a.latitude, lon: a.longitude), lb = LatLon(lat: b.latitude, lon: b.longitude)
        guard la.isValid, lb.isValid else { return }
        let zoom = Landmarks.zoom(metersPerPoint: Geo.hav(la, lb) / 100, latitude: (la.lat + lb.lat) / 2)
        let corners = [CGPoint(x: view.minX, y: view.minY), CGPoint(x: view.maxX, y: view.minY),
                       CGPoint(x: view.minX, y: view.maxY), CGPoint(x: view.maxX, y: view.maxY)]
        let geo = corners.compactMap { proxy.convert($0, from: .global) }.map { LatLon(lat: $0.latitude, lon: $0.longitude) }
        guard geo.count >= 2, let box = GeoBox(geo) else { return }
        var cands: [Landmarks.Candidate] = []
        for m in Landmarks.visible(labels.landmarks, zoom: zoom, in: box) {
            if let p = proxy.convert(m.coord.cl, to: .global) { cands.append(.init(landmark: m, x: Double(p.x), y: Double(p.y))) }
        }
        let placed = cands.isEmpty ? [] : Landmarks.place(cands, zoom: zoom, scale: scale, viewport: LabelRect(view),
                                                          obstacles: labelObstacles(proxy, view: view))
        labels.show(placed)
    }

    /// Screen boxes no name may cover: every stop (the web's 13 pt square; favorite stars and rings larger) and, on the
    /// iPhone also, the trip's stop labels, you at the boarding stop, the destination marker, your location and the
    /// locate button. Buses are left out on purpose, as on the web: they move every poll, so names would blink in and
    /// out as buses pass (and the CI screenshots would depend on where the simulated buses happen to be); buses are
    /// drawn over the names.
    func labelObstacles(_ proxy: MapProxy, view: CGRect) -> [LabelRect] {
        var out: [LabelRect] = []
        let area = view.insetBy(dx: -40, dy: -40)
        func at(_ p: LatLon, _ w: Double, _ h: Double, dy: Double = 0) {
            guard p.isValid, let s = proxy.convert(p.cl, to: .global), area.contains(s) else { return }
            out.append(LabelRect(centerX: Double(s.x), centerY: Double(s.y) + dy, width: w, height: h))
        }
        let ring = ringed
        for s in model.mapLayers.stops {
            // StopDot: ring 26 + its 3 pt stroke, star 18, dot 9 + its border (the web's stop circle: 2 x LABEL.STOP_R)
            let d: Double = ring.contains(s.id) ? 30 : s.isFav ? 20 : 2 * Landmarks.stopR
            at(s.stop.coord, d, d)
        }
        if model.activeTrip != nil, let y = model.tripYou {
            // "Board here" / the get-off count: 12 pt bold in a tag, 12 pt under its stop (TripStopLabel)
            for l in y.stopLabels { at(l.point, Landmarks.textWidth(l.text, size: 12) + 20, 24, dy: 12 + 12) }
            // "You (est.)" at the boarding stop: the 44 pt marker with its pill above
            if let p = y.point, y.source == .stop { at(p, 90, 70, dy: -12) }
        }
        // the destination balloon above its point, with its title under it
        if let o = plan, let last = o.legs.last, let end = last.walk?.to.coord ?? last.bus?.alight.coord { at(end, 84, 64, dy: -12) }
        if let w = walkOnly, let end = w.last { at(end, 84, 64, dy: -12) }
        if let u = model.user { at(u, 30, 30) }
        if model.detent != .full {   // the locate button, right under the floating chrome (RootView)
            out.append(LabelRect(minX: Double(view.maxX) - 52, minY: Double(view.minY) - 4, maxX: Double(view.maxX) + 8, maxY: Double(view.minY) + 48))
        }
        return out
    }

    /// What the names avoid besides the camera, as one value for `LabelWatcher`: a change lays them out again (a route
    /// shown or hidden, a favorite, a ring, the trip's stop labels, you at the boarding stop, a plan's destination).
    func labelSignature(_ layers: MapLayers, ring: Set<String>, tripLabels: [TripYou.StopLabel], youGuess: LatLon?,
                        plan: TripOption?, walkEnd: LatLon?) -> Int {
        var h = Hasher()
        h.combine(layers.stops.count)
        for s in layers.stops { h.combine(s.id); h.combine(s.isFav) }
        h.combine(ring)
        h.combine(tripLabels)
        h.combine(youGuess)
        if let last = plan?.legs.last { h.combine(last.walk?.to.coord ?? last.bus?.alight.coord) }
        h.combine(walkEnd)
        return h.finalize()
    }
}

/// The map labels' triggers besides the camera's end: a camera moved by the app (fit, fly to, the follow frame), a
/// resized visible map (the sheet settled, the chrome changed), new landmarks, what they avoid, the text size; each
/// lays out now and once the move has settled (`MapLabelModel.layoutSoon`). Its own view, so only this empty view
/// re-runs when they change.
struct LabelWatcher: View {
    let camera: MapCameraModel
    let labels: MapLabelModel
    let signature: Int
    let scale: Double
    let layout: () -> Void
    var body: some View {
        Color.clear
            .allowsHitTesting(false)
            .accessibilityHidden(true)
            .onAppear { labels.layoutSoon(layout) }
            .onChange(of: camera.position) { _, _ in labels.layoutSoon(now: false, layout) }
            .onChange(of: camera.visibleRect) { _, _ in labels.layoutSoon(layout) }
            .onChange(of: labels.version) { _, _ in labels.layoutSoon(layout) }
            .onChange(of: signature) { _, _ in labels.layoutSoon(layout) }
            .onChange(of: scale) { _, _ in labels.layoutSoon(layout) }
    }
}

/// A building or place name on the map (web .sb-lm): bold slate-blue text with a halo in the map's background color (8
/// offset copies: SwiftUI has no text stroke) on a faint plate (the halo color at 50%, corner radius 5), in exactly the
/// line breaks and the box the Kit placed (each line 1.12 em tall), padded on the side facing its building by the
/// placement's gap. Decorative: never takes a tap (the stops and buses near it keep theirs) and hidden from VoiceOver
/// (stops and buses keep their own labels). Equatable, so a map redraw for a bus move does not redraw the names.
struct LandmarkLabel: View, Equatable {
    let label: PlacedLandmark

    static let haloOffsets: [CGSize] = (0..<8).map { i in
        let a = Double(i) * .pi / 4
        return CGSize(width: cos(a) * Landmarks.halo, height: sin(a) * Landmarks.halo)
    }

    var body: some View {
        let size = CGFloat(label.size), lineH = CGFloat(label.size * Landmarks.lineHeightEm)
        let lines = VStack(spacing: 0) {
            ForEach(Array(label.lines.enumerated()), id: \.offset) { item in
                Text(item.element).font(.system(size: size, weight: .bold)).lineLimit(1).fixedSize().frame(height: lineH)
            }
        }
        ZStack {
            ForEach(0..<Self.haloOffsets.count, id: \.self) { i in
                lines.foregroundStyle(Palette.mapLabelHalo).offset(Self.haloOffsets[i])
            }
            lines.foregroundStyle(Palette.mapLabel)
        }
        .frame(width: CGFloat(label.plateWidth), height: CGFloat(label.plateHeight))
        .background(Palette.mapLabelHalo.opacity(0.5), in: RoundedRectangle(cornerRadius: 5, style: .continuous))
        .padding(.top, CGFloat(label.padTop))
        .padding(.bottom, CGFloat(label.padBottom))
        .padding(.leading, CGFloat(label.padLeading))
        .padding(.trailing, CGFloat(label.padTrailing))
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// The follow camera's triggers: the rider dragging or zooming the map turns it off (`positionedByUser`); a new you,
/// a resized visible map or the follow switch turning on runs the check. Its own view, so only this empty view
/// re-runs when the camera or the sheet moves.
struct FollowWatcher: View {
    let camera: MapCameraModel
    let you: TripYou?
    let check: () -> Void
    var body: some View {
        Color.clear
            .allowsHitTesting(false)
            .accessibilityHidden(true)
            .onChange(of: camera.position.positionedByUser) { _, byUser in
                if byUser && camera.follow { camera.follow = false }
            }
            .onChange(of: camera.visibleRect) { _, _ in check() }
            .onChange(of: camera.follow) { _, on in if on { check() } }
            .onChange(of: you) { _, _ in check() }
    }
}

/// Equatable on what it shows (the tap closure is new on every map body, so without this SwiftUI would redraw all
/// ~90 stops whenever buses move). Annotation content must not read the model from the environment: MapKit hosts
/// it outside the normal view tree.
struct StopDot: View, Equatable {
    var id: String
    var isFav: Bool
    /// A plan is drawn: favorite stars step back (web map/favorites.js).
    var faded = false
    /// Highlighted (Routes to station candidate or the open stop).
    var ring = false
    var action: () -> Void

    static func == (a: StopDot, b: StopDot) -> Bool {
        a.id == b.id && a.isFav == b.isFav && a.faded == b.faded && a.ring == b.ring
    }

    var body: some View {
        Button(action: action) {
            ZStack {
                if ring {
                    Circle().stroke(Palette.accent, lineWidth: 3).frame(width: 26, height: 26)
                        .background(Circle().fill(Palette.accent.opacity(0.18)))
                }
                if isFav {
                    Image(systemName: "star.circle.fill").font(.system(size: 18)).foregroundStyle(.white, Palette.starBadge)
                        .opacity(faded ? 0.45 : 1)
                } else {
                    Circle().fill(.white).frame(width: 9, height: 9).overlay(Circle().stroke(.gray, lineWidth: 2))
                }
            }
            .frame(width: 44, height: 44)   // 44 pt tap target (web: 44 px halo)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// Rounded-square badge in the route color with the route chip text and a heading triangle (map/layers.js). The bus
/// you ride on a started trip (`youText` set, TripYou.text) gets an accent ring and a "You" pill: it moves with the
/// bus, glide included; VoiceOver reads the trip sentence ("You are on Bus 101. Get off in 2 stops: X").
struct BusMarker: View {
    let route: Route?
    let bearing: Double?
    var stale = false
    var youText: String? = nil
    var body: some View {
        ZStack {
            if youText != nil {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(Palette.accentFill, lineWidth: 3)
                    .frame(width: 44, height: 38)
                    .background(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(.white, lineWidth: 7))
                YouPill(text: "You").offset(y: -34)
            }
            if let bearing {
                Image(systemName: "triangle.fill")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(Color(hex: route?.color))
                    .offset(y: -19)
                    .rotationEffect(.degrees(bearing))
            }
            Text(route?.chipText ?? "Bus")
                .font(.system(size: 11, weight: .heavy, design: .rounded))
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .foregroundStyle(Color.textOn(hex: route?.color))
                .frame(width: 30, height: 24)
                .background(Color(hex: route?.color), in: RoundedRectangle(cornerRadius: Radius.badge, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: Radius.badge, style: .continuous).stroke(.white, lineWidth: 2))
                .shadow(color: Palette.shadow.opacity(0.3), radius: 2, y: 1)
        }
        .opacity(stale ? 0.5 : 1)
        .accessibilityLabel((youText ?? "\(route?.displayName ?? "Shuttle") bus") + (stale ? ", location may be old" : ""))
    }
}

/// The small "You" pill (accent fill, white text 4.6:1; the word carries the meaning, not the color).
struct YouPill: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.system(size: 11, weight: .heavy, design: .rounded))
            .lineLimit(1)
            .fixedSize()
            .foregroundStyle(.white)
            .padding(.horizontal, 7).padding(.vertical, 2)
            .background(Palette.accentFill, in: Capsule())
            .overlay(Capsule().stroke(.white, lineWidth: 1.5))
            .shadow(color: Palette.shadow.opacity(0.25), radius: 2, y: 1)
    }
}

/// You on a started trip as a marker of its own (web map.js renderYou): the boarding stop as a guess (no GPS: a dashed
/// hollow ring, pill "You (est.)"), or the bus you ride while its marker is not drawn (a filled dot, pill "You").
struct YouMarker: View {
    let guess: Bool
    var body: some View {
        ZStack {
            if guess {
                Circle().fill(Palette.card).frame(width: 22, height: 22)
                    .overlay(Circle().stroke(Palette.accentFill, style: StrokeStyle(lineWidth: 3, dash: [4, 3])))
            } else {
                Circle().fill(Palette.accentFill).frame(width: 20, height: 20).overlay(Circle().stroke(.white, lineWidth: 3))
            }
            YouPill(text: guess ? "You (est.)" : "You").offset(y: -24)
        }
        .frame(width: 44, height: 44)
        .shadow(color: Palette.shadow.opacity(0.25), radius: 2, y: 1)
    }
}

/// A label on one of the trip's stops ("Board here", "Get off in 2 stops"); the get-off label has an accent outline.
struct TripStopLabel: View {
    let text: String
    let off: Bool
    var body: some View {
        Text(text)
            .font(.system(size: 12, weight: .bold))
            .lineLimit(1)
            .fixedSize()
            .foregroundStyle(Palette.text)
            .padding(.horizontal, 8).padding(.vertical, 2)
            .background(Palette.card, in: RoundedRectangle(cornerRadius: Radius.tag, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Radius.tag, style: .continuous)
                .stroke(off ? Palette.accentFill : Palette.text3.opacity(0.5), lineWidth: off ? 2 : 1))
            .shadow(color: Palette.shadow.opacity(0.2), radius: 2, y: 1)
            .dynamicTypeSize(...DynamicTypeSize.xxLarge)
    }
}

struct UserDot: View {
    var body: some View {
        ZStack {
            Circle().fill(.blue.opacity(0.18)).frame(width: 34, height: 34)
            Circle().fill(.blue).frame(width: 14, height: 14).overlay(Circle().stroke(.white, lineWidth: 3))
        }
        .accessibilityLabel("My location")
    }
}
