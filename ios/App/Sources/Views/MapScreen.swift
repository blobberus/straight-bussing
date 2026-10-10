import MapKit
import SwiftUI
import StraightBussingKit

/// The live map (web/js/map): route lines in route colors stacked by draw order (focused routes on top,
/// others dimmed), stops, live buses with heading, the user's position, and a started/selected trip.
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
        Map(position: $camera.position) {
            ForEach(layers.lines) { l in
                MapPolyline(coordinates: l.coords)
                    .stroke(l.color, style: StrokeStyle(lineWidth: l.width, lineCap: .round, lineJoin: .round))
            }
            if let o = plan {
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
                    StopDot(isFav: s.isFav, faded: plan != nil, ring: ringed.contains(s.id)) { model.stopTapped(s.id) }
                        .accessibilityLabel(s.isFav ? "Favorite stop \(s.stop.name)" : "Stop \(s.stop.name)")
                }
                .annotationTitles(.hidden)
            }
            ForEach(buses) { b in
                Annotation(b.label, coordinate: b.coord.cl, anchor: .center) {
                    Button { model.busTapped(b.rid) } label: {
                        BusMarker(route: model.route(b.rid), bearing: b.bearing, stale: b.stale).frame(minWidth: 44, minHeight: 44)
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint("Opens the route")
                }
                .annotationTitles(.hidden)
            }
            // Demo mode: a fixed simulated position. Real location: MapKit's own user dot.
            if model.config.demo, let u = model.user {
                Annotation("My location", coordinate: u.cl, anchor: .center) { UserDot() }
                    .annotationTitles(.hidden)
            }
            if !model.config.demo {
                UserAnnotation()
            }
        }
        .mapStyle(.standard(elevation: .flat, pointsOfInterest: .excludingAll))
        .mapControls { MapCompass() }
        // a tap on empty map lowers the sheet to peek (web onMapTap). Simultaneous, so it never blocks the stop / bus
        // buttons; `mapTapped` ignores a tap that also hit one of them.
        .simultaneousGesture(TapGesture().onEnded { model.mapTapped() })
        .accessibilityLabel("Shuttle map")
    }

    /// Stops with a ring: the Routes to station candidates, else the open stop (web highlightStops / setSelectedStop).
    var ringed: Set<String> {
        if !model.pickHighlights.isEmpty { return Set(model.pickHighlights) }
        if case .stop(let id)? = model.page { return [id] }
        return []
    }
}

struct StopDot: View {
    var isFav: Bool
    /// A plan is drawn: favorite stars step back (web map/favorites.js).
    var faded = false
    /// Highlighted (Routes to station candidate or the open stop).
    var ring = false
    var action: () -> Void
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

/// Rounded-square badge in the route color with the route chip text and a heading triangle (map/layers.js).
struct BusMarker: View {
    let route: Route?
    let bearing: Double?
    var stale = false
    var body: some View {
        ZStack {
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
        .accessibilityLabel("\(route?.displayName ?? "Shuttle") bus\(stale ? ", location may be old" : "")")
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
