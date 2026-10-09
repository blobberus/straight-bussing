import Foundation
import StraightBussingKit

/// Launch arguments (used by CI to drive the simulator deterministically):
///   -demo                 simulated buses (DemoFeed), fixed location on campus, separate prefs storage
///   -screen <name>        open a screen: current | trip | routes | route | myroutes | directions | stop |
///                         settings | liveactivity | about
///   -detent peek|half|full
///   -tour                 walk through the main screens automatically (for the screen recording)
///   -theme light|dark     force the color scheme
struct LaunchConfig {
    var demo = false
    var screen: String?
    var detent: String?
    var tour = false
    var theme: String?

    static func parse(_ args: [String] = ProcessInfo.processInfo.arguments) -> LaunchConfig {
        var c = LaunchConfig()
        func value(after flag: String) -> String? {
            guard let i = args.firstIndex(of: flag), i + 1 < args.count else { return nil }
            return args[i + 1]
        }
        c.demo = args.contains("-demo")
        c.tour = args.contains("-tour")
        c.screen = value(after: "-screen")
        c.detent = value(after: "-detent")
        c.theme = value(after: "-theme")
        return c
    }
}

/// Fixed inputs of the demo build (kept equal to DemoFeedTests in the Kit tests).
enum DemoConfig {
    /// On the Main Quad, about 100 m from Reynolds Club.
    static let origin = LatLon(lat: 41.7905, lon: -87.5990)
    /// Chipotle, 1522 E 53rd St (a local places.json entry).
    static let destination = LatLon(lat: 41.7997, lon: -87.588)
    static let destinationLabel = "Chipotle"
    static let favoriteStops = ["8579", "8633"]   // Reynolds Club, Regenstein Library (N)
    static let routeForDetail = "1077"           // East
    static let stopForDetail = "8579"

    static func customRoutes(_ s: StaticData) -> [CustomRoute] {
        let known = Set(s.routeIds)
        return [
            CustomRoute(id: "demo-commute", name: "Morning commute", rids: ["1077", "1078"].filter(known.contains), highlight: ["1077"]),
            CustomRoute(id: "demo-night", name: "Night shuttles", rids: ["1075", "1076"].filter(known.contains)),
            CustomRoute(id: "demo-metra", name: "Metra connections", rids: ["5700", "5703", "5716"].filter(known.contains)),
        ]
    }
}
