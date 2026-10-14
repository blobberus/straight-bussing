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
struct MapScreen: View {
    @Environment(AppModel.self) private var model

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
        MapReader { proxy in
        Map(position: $camera.position) {
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
            if let w = walkOnly, let end = w.last {
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
            // the trip's stops: "Board here" under the boarding stop, the get-off count above the alighting stop
            // (the card's and the alerts' numbers); never in the way of a tap
            ForEach(labels, id: \.self) { l in
                let board = l.text == "Board here"
                Annotation("", coordinate: l.point.cl, anchor: board ? UnitPoint.top : UnitPoint.bottom) {
                    TripStopLabel(text: l.text, off: !board)
                        .padding(board ? Edge.Set.top : Edge.Set.bottom, 12)
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
        // a tap on empty map lowers the sheet to peek (web onMapTap). Simultaneous, so it never blocks the stop / bus
        // buttons; `mapTapped` ignores a tap that also hit one of them.
        .simultaneousGesture(TapGesture().onEnded { model.mapTapped() })
        .accessibilityLabel("Shuttle map")
        // follow camera (AppModel+Follow.swift), watched by a child view so this body does not re-run on a pan or a
        // settled sheet
        .background { FollowWatcher(camera: model.mapCamera, you: you) { followCheck(proxy) } }
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
        .opacity(stale && youText == nil ? 0.5 : 1)
        .accessibilityLabel(youText ?? "\(route?.displayName ?? "Shuttle") bus\(stale ? ", location may be old" : "")")
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
