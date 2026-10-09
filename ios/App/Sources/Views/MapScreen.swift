import MapKit
import SwiftUI
import StraightBussingKit

/// The live map (web/js/map): route lines in route colors stacked by draw order (focused routes on top,
/// others dimmed), stops, live buses with heading, the user's position, and a started/selected trip.
struct MapScreen: View {
    @Environment(AppModel.self) private var model
    var bottomInset: CGFloat

    struct Line: Identifiable {
        let id: String
        let coords: [CLLocationCoordinate2D]
        let color: Color
        let width: CGFloat
    }

    /// Route lines bottom -> top (MapKit draws later content above earlier content).
    var lines: [Line] {
        let vis = model.mapVisibility
        let hidden = Set(vis.hidden), focus = vis.focus.map { Set($0) }
        var out: [Line] = []
        for rid in vis.order.reversed() where !hidden.contains(rid) {
            guard let r = model.route(rid) else { continue }
            let dim = focus != nil && !(focus!.contains(rid))
            for (i, line) in (model.staticData.shapes[rid] ?? []).enumerated() {
                out.append(Line(id: "\(rid)-\(i)", coords: line.map(\.cl), color: Color(hex: r.color).opacity(dim ? 0.25 : 1),
                                width: dim ? 3 : 5))
            }
        }
        return out
    }

    /// Stops served by a visible route.
    var stops: [Stop] {
        let hidden = Set(model.hidden)
        var ids = Set<String>()
        for (rid, list) in model.staticData.routeStops where !hidden.contains(rid) { ids.formUnion(list) }
        return ids.compactMap { model.staticData.stops[$0] }.sorted { $0.id < $1.id }
    }

    var buses: [VehiclePosition] {
        let hidden = Set(model.hidden)
        return model.live.buses.filter { !hidden.contains($0.trip.routeId ?? "") }
    }

    /// The trip drawn on the map: the started one, else the selected Directions option.
    var plan: TripOption? {
        if let t = model.activeTrip { return t.option }
        if model.page == .directions, let r = model.dir.result, r.options.indices.contains(model.dir.selected) { return r.options[model.dir.selected] }
        return nil
    }

    var body: some View {
        @Bindable var model = model
        Map(position: $model.camera) {
            ForEach(lines) { l in
                MapPolyline(coordinates: l.coords)
                    .stroke(l.color, style: StrokeStyle(lineWidth: l.width, lineCap: .round, lineJoin: .round))
            }
            if let o = plan {
                ForEach(Array(o.walkLegs.enumerated()), id: \.offset) { item in
                    MapPolyline(coordinates: (item.element.coords ?? [item.element.from.coord, item.element.to.coord]).map(\.cl))
                        .stroke(.blue, style: StrokeStyle(lineWidth: 4, lineCap: .round, dash: [2, 7]))
                }
                ForEach(Array(o.busLegs.enumerated()), id: \.offset) { item in
                    MapPolyline(coordinates: item.element.path.map(\.cl))
                        .stroke(Color(hex: model.route(item.element.rid)?.color), style: StrokeStyle(lineWidth: 8, lineCap: .round, lineJoin: .round))
                }
                if let last = o.legs.last {
                    let end = last.walk?.to.coord ?? last.bus?.alight.coord ?? LatLon(lat: 0, lon: 0)
                    Marker("Destination", systemImage: "mappin", coordinate: end.cl).tint(.red)
                }
            }
            ForEach(stops) { s in
                Annotation(s.name, coordinate: s.coord.cl, anchor: .center) {
                    StopDot(isFav: model.isFav(s.id)) { model.push(.stop(s.id)) }
                        .accessibilityLabel("Stop \(s.name)")
                }
            }
            ForEach(buses, id: \.vehicle.id) { b in
                Annotation(b.displayLabel, coordinate: b.coord.cl, anchor: .center) {
                    BusMarker(route: model.route(b.trip.routeId ?? ""), bearing: b.bearing,
                              stale: b.timestamp > 0 && model.now - b.timestamp > 60)
                }
            }
            if let u = model.user {
                Annotation("My location", coordinate: u.cl, anchor: .center) { UserDot() }
            }
        }
        .mapStyle(.standard(elevation: .flat, pointsOfInterest: .excludingAll))
        .annotationTitles(.hidden)
        .mapControls { MapCompass() }
        .safeAreaPadding(.bottom, bottomInset)
        .accessibilityLabel("Shuttle map")
    }
}

struct StopDot: View {
    var isFav: Bool
    var action: () -> Void
    var body: some View {
        Button(action: action) {
            ZStack {
                if isFav {
                    Image(systemName: "star.circle.fill").font(.system(size: 18)).foregroundStyle(.white, .orange)
                } else {
                    Circle().fill(.white).frame(width: 9, height: 9).overlay(Circle().stroke(.gray, lineWidth: 2))
                }
            }
            .frame(width: 30, height: 30)
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
                .background(Color(hex: route?.color), in: RoundedRectangle(cornerRadius: 7))
                .overlay(RoundedRectangle(cornerRadius: 7).stroke(.white, lineWidth: 2))
                .shadow(color: .black.opacity(0.3), radius: 2, y: 1)
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
