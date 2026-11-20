import Foundation
import StraightBussingKit

/// The bus menu and station times (owner 2026-11-20; web ui/views/bus.js, core/eta.js). Pure rules: Kit `BusMenu`,
/// `StationTimes`. This file only feeds them the observed live slices, so a view that calls them redraws when they change.
extension AppModel {
    /// The live slices the station times read: the operating buses and their trip updates, plus which buses are
    /// transitioning (shown without their times) and which are away from their route.
    var stationLive: LiveState {
        var s = live
        s.transitioning = transitioning
        s.awayBuses = away
        return s
    }

    /// Scheduled riding minutes between two stops of a route (segments.json through `SchedulePredictor`), the source the
    /// trip timeline's estimates use.
    var stationRide: StationTimes.Ride {
        let p = predictor, t = now
        return { rid, a, b in p?.rideMinutes(rid: rid, from: a, to: b, when: t).min }
    }

    /// The app's version for the bus report (About shows the same).
    var appVersion: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "" }

    /// The bus menu's model for the bus with `key` on line `rid`, now (Kit `BusMenu.model`, with its 45 s hold).
    func busMenuModel(rid: String, key: String) -> BusMenu.Model {
        let L = stationLive
        let h = BusMenu.held(busMenuMemory, L, key: key, now: now)
        busMenuMemory = h.memory
        return BusMenu.model(staticData, L, key: key, held: h, rid: rid, now: now, numbers: busNumbers, ride: stationRide)
    }

    /// The sheet title of a bus menu: the line the bus is on now (web busTitle).
    func busMenuTitle(rid: String, key: String) -> String {
        let r = BusMenu.bus(live, key: key)?.trip.routeId.flatMap { staticData.routes[$0] } ?? staticData.routes[rid]
        guard let r else { return "Bus" }
        return !r.long.isEmpty ? r.long : !r.short.isEmpty ? r.short : "Bus"
    }

    /// See the whole route (web bus:route): the route page, the map framed on the line, with this bus picked while it is
    /// still in the feed (each station then shows its own time). Back returns to the bus menu.
    func openWholeRoute(_ m: BusMenu.Model) {
        guard staticData.routes[m.rid] != nil else { return }
        push(.route(m.rid))
        if (m.status == .ok || m.status == .transitioning), let key = m.key { selectedBus = SelectedBus(rid: m.rid, vehicleId: key) }
    }

    /// The report form with only the five details filled in, or nil while no form is set (the button stays grayed out).
    func busReportURL(_ m: BusMenu.Model) -> URL? {
        BusMenu.reportLink(BusMenu.reportInfo(m, now: now, version: appVersion), url: SiteLinks.busReport, entries: SiteLinks.busReportEntries)
    }
}
