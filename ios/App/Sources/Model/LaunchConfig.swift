import Foundation
import StraightBussingKit

/// Launch arguments (used by CI to drive the simulator deterministically):
///   -demo                 simulated buses (DemoFeed), fixed location on campus, separate prefs storage. No demo
///                         label anywhere (screenshots look like real use); the Settings switch is what riders get
///   -screen <name>        open a screen: current | trip | routes | route | myroutes | directions | stop |
///                         settings | settingsdemo | liveactivity | about | alerts | pick | search | custom |
///                         editor | order | tripstop (UI test: a stop opened during a started trip) |
///                         livestates | livestatesend (the Live Activity in each arrival state, top / scrolled to the end)
///   -detent peek|full   (the sheet's two states; "half" is read as full)
///   -tour                 walk through the main screens automatically (for the screen recording)
///   -theme light|dark     force the color scheme
///   -noloc                with -demo: no location and no favorites (the "Use my location" first state)
///   -nobus                with -demo: no bus reporting, with the operator's real help alert (the no-bus state)
struct LaunchConfig {
    var demo = false
    var screen: String?
    var detent: String?
    var tour = false
    var theme: String?
    var noLocation = false
    var noBus = false

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
        c.noLocation = c.demo && args.contains("-noloc")
        c.noBus = c.demo && args.contains("-nobus")
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

    /// `-nobus`: the shuttle operator's own help alert, word for word as the live serviceAlerts feed sends it (the
    /// Kit's Fixtures/serviceAlerts.json), so the no-bus screenshots show its number as the primary call. CI only.
    static let operatorAlert = ServiceAlert(
        id: "1", header: "UGo Bus Route Assistance",
        description: "During normal service hours, if you do not see arrival times or buses on route in the app, please contact 773-655-9934 for assistance.")

    /// The `-nobus` poll: the feeds answer, no bus reports, the operator's alert is up.
    static func noBusPoll(now: Double) -> FeedPoll { DemoFeed.noBus(now: now, alerts: [operatorAlert]) }

    static func customRoutes(_ s: StaticData) -> [CustomRoute] {
        let known = Set(s.routeIds)
        return [
            CustomRoute(id: "demo-commute", name: "Morning commute", rids: ["1077", "1078"].filter(known.contains), highlight: ["1077"]),
            CustomRoute(id: "demo-night", name: "Night shuttles", rids: ["1075", "1076"].filter(known.contains)),
            CustomRoute(id: "demo-metra", name: "Metra connections", rids: ["5700", "5703", "5716"].filter(known.contains)),
        ]
    }
}
