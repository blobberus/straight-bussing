import Foundation

/// Simulated live feed for the demo build (`-demo` launch argument): screenshots and the simulator recording
/// must not depend on whether real shuttles are running. Generated from the bundled static data (so it can
/// never drift from it): buses placed along each route's stops, moving with time from `epoch`, with trip
/// updates timed by segments.json. Clearly labeled: it adds a "Demo mode" service alert.
public enum DemoFeed {
    public static let alertHeader = "Demo mode: simulated buses"
    public static let alertBody = "These buses are generated for screenshots and testing. They are not live data."

    /// Seconds to travel segment i of a route order (loops close back to the first stop).
    static func segSeconds(_ S: StaticData, _ rid: String, _ order: [String]) -> [Double] {
        let segs = S.segments?.routes[rid]?.seg ?? []
        return order.indices.map { i in
            if i < segs.count, let v = segs[i], v.isFinite, v > 0 { return max(20, v) }
            guard let a = S.stops[order[i]], let b = S.stops[order[(i + 1) % order.count]] else { return 60 }
            return max(30, Geo.hav(a.coord, b.coord) / (18000.0 / 60) * 60)
        }
    }

    /// A deterministic poll result at `now` (buses advance as `now - epoch` grows).
    public static func poll(staticData S: StaticData, now: Double, epoch: Double) -> FeedPoll {
        var buses: [VehiclePosition] = []
        var trips: [TripUpdate] = []
        for (ri, rid) in S.routeStopIds.enumerated() {
            let order = Notify.routeOrder(S.routeStops[rid]).order.filter { S.stops[$0] != nil }
            guard order.count >= 3 else { continue }
            let secs = segSeconds(S, rid, order)
            let cycle = secs.reduce(0, +)
            let count = order.count >= 10 ? 2 : 1
            for b in 0..<count {
                let phase0 = (b == 0 ? 0.12 : 0.62) + Double(ri % 5) * 0.05
                var p = (phase0 + (now - epoch) / cycle).truncatingRemainder(dividingBy: 1)
                if p < 0 { p += 1 }
                var at = p * cycle, k = 0
                while k < secs.count - 1 && at >= secs[k] { at -= secs[k]; k += 1 }
                let f = min(1, max(0, at / secs[k]))
                let a = S.stops[order[k]]!.coord, c = S.stops[order[(k + 1) % order.count]]!.coord
                let pos = LatLon(lat: a.lat + (c.lat - a.lat) * f, lon: a.lon + (c.lon - a.lon) * f)
                let label = String(1600 + ri * 7 + b * 3)
                let vid = "demo-\(rid)-\(b)", tid = "demo-trip-\(rid)-\(b)"
                buses.append(VehiclePosition(vehicle: .init(id: vid, label: label), latitude: pos.lat, longitude: pos.lon,
                                             bearing: Geo.bearing(a, c), speed: 6, trip: .init(tripId: tid, routeId: rid),
                                             timestamp: now - 4, stopId: order[(k + 1) % order.count]))
                var ups: [StopTimeUpdate] = []
                var t = now + (secs[k] - at)
                for s in 1...min(order.count, 14) {
                    let idx = (k + s) % order.count
                    ups.append(StopTimeUpdate(stopId: order[idx], arrival: t.rounded(), departure: t.rounded() + 10))
                    t += secs[idx] + 10
                }
                trips.append(TripUpdate(trip: .init(tripId: tid, routeId: rid), vehicle: .init(id: vid, label: label), stopTimeUpdates: ups))
            }
        }
        let alert = ServiceAlert(id: "demo", header: alertHeader, description: alertBody)
        let ts = now - 3
        return FeedPoll(vehicles: .success(Feed(timestamp: ts, entities: buses)),
                        trips: .success(Feed(timestamp: ts, entities: trips)),
                        alerts: .success(Feed(timestamp: ts, entities: [alert])))
    }
}
