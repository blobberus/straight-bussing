import Foundation
import SwiftUI
import StraightBussingKit

/// User actions with the same confirmations as the web (its ctx.toast lines, read out by VoiceOver too).
extension AppModel {
    // MARK: Routes list

    /// Route ids sorted by short name (numbers in numeric order), restricted to the station filter (routes.js routeIds).
    func routeList() -> [String] {
        let R = staticData.routes
        func key(_ id: String) -> String { let r = R[id]; return !(r?.short ?? "").isEmpty ? r!.short : !(r?.long ?? "").isEmpty ? r!.long : id }
        var ids = staticData.routeIds.sorted { key($0).compare(key($1), options: [.numeric, .caseInsensitive]) == .orderedAscending }
        if let f = routeState.routeFilter { ids = ids.filter { f.ids.contains($0) } }
        return ids
    }

    /// Show all / Hide all act on the station filter's routes, else on every route.
    var bulkScope: [String]? { routeState.routeFilter == nil ? nil : routeList() }

    func toggleRouteHidden(_ rid: String) {
        let hide = !routeState.hiddenRoutes.contains(rid)
        apply(Custom.toggleHidden(routeState, rid))
        showInfo("\(route(rid)?.long.isEmpty == false ? route(rid)!.long : "Route") \(hide ? "hidden" : "shown")")
    }

    func showAllRoutes() {
        apply(Custom.showAll(routeState, bulkScope))
        showInfo("All routes shown")
    }

    func hideAllRoutes() {
        apply(Custom.hideAll(routeState, bulkScope))
        showInfo("All routes hidden. Show them again here.")
    }

    func moveRoute(_ rid: String, to index: Int) {
        let p = Custom.moveToIndex(routeState, rid, index)
        guard p.routeOrder != nil else { return }
        apply(p)
        showInfo("\(longName(rid)) moved to position \(index + 1)")
    }

    func moveRoute(_ rid: String, by delta: Int) {
        let p = Custom.moveInOrder(routeState, rid, delta)
        guard p.routeOrder != nil else { return }
        apply(p)
    }

    func resetMapOrder() {
        apply(StatePatch(routeOrder: []))
        showInfo("Map order reset")
    }

    /// Show the hidden routes that serve a stop (stop.js "Show").
    func unhideRoutes(at stopId: String) {
        let serve = Set(staticData.stopRoutes[stopId] ?? [])
        apply(StatePatch(hiddenRoutes: routeState.hiddenRoutes.filter { !serve.contains($0) }))
    }

    // MARK: Favorites

    func toggleFavorite(_ stopId: String) {
        let p = Custom.toggleFav(routeState, stopId)
        apply(p)
        showInfo((p.favStops ?? []).contains(stopId) ? "Added to favorites in My Routes" : "Removed from favorites")
    }

    func moveFavorites(from: IndexSet, to: Int) {
        var f = routeState.favStops
        f.move(fromOffsets: from, toOffset: to)
        apply(StatePatch(favStops: f))
    }

    func removeFavorite(_ stopId: String) {
        apply(StatePatch(favStops: routeState.favStops.filter { $0 != stopId }))
    }

    // MARK: Custom routes

    /// Frame a set of routes' shapes on the map.
    func fitRoutes(_ rids: [String]) {
        let pts = rids.flatMap { (staticData.shapes[$0] ?? []).flatMap { $0 } }
        if !pts.isEmpty { fit(pts) }
    }

    /// Row tap in My Routes: show the custom route on the map, or stop showing it (stays on the list).
    func toggleCustom(_ c: CustomRoute) {
        if routeState.activeCustom == c.id {
            apply(Custom.clearCustom(routeState))
            showInfo("Showing your usual routes")
        } else {
            apply(Custom.applyCustom(routeState, c.id))
            fitRoutes(c.rids)
        }
    }

    /// Routes tab "Make this a custom route" > Save: what is visible now, applied.
    @discardableResult
    func saveVisibleAsCustom(name: String) -> String {
        let made = Custom.saveVisibleAsCustom(routeState, name: Custom.cleanName(name))
        apply(made.patch)
        showInfo("Saved to My Routes")
        return made.id
    }

    /// Routes tab "Update <name>": the applied custom route takes the routes visible now.
    func updateActiveCustomToVisible() {
        guard let c = RouteVisibility.activeCustomRoute(routeState) else { return }
        apply(Custom.updateCustom(routeState, c.id, rids: Custom.visibleRids(routeState)))
        showInfo("Updated \(c.name)")
    }

    /// Editor Save for a new custom route: create it, show it on the map, back to the list.
    func createCustomRoute(name: String, rids: [String]) {
        let made = Custom.createCustom(routeState, name: name, rids: rids)
        apply(made.patch)
        apply(Custom.applyCustom(routeState, made.id))
        back()
        fitRoutes(rids)
        let saved = routeState.customRoutes.first { $0.id == made.id }?.name ?? "custom route"
        showInfo("Saved \u{201C}\(saved)\u{201D}. Showing it on the map.")
    }

    /// Editor Save for an existing custom route.
    func saveCustomRoute(id: String, name: String, rids: [String]) {
        apply(Custom.updateCustom(routeState, id, name: name, rids: rids))
        back()
        if routeState.activeCustom == id { fitRoutes(rids) }
    }

    /// Ask before deleting (every delete confirms, web ui/confirm.js). `from`: list | detail | edit.
    func requestDelete(_ c: CustomRoute, from: String) {
        confirmDeleteFrom = from
        confirmDelete = c
    }

    func deleteCustomConfirmed(_ c: CustomRoute) {
        guard routeState.customRoutes.contains(where: { $0.id == c.id }) else { return }
        apply(Custom.deleteCustom(routeState, c.id))   // if it was showing, the usual routes come back
        showInfo("Deleted \u{201C}\(c.name)\u{201D}")
        switch confirmDeleteFrom {
        case "detail": back()
        case "edit": paths[tab] = []; syncMapFocus()   // the detail behind the editor is gone too
        default: break
        }
    }

    // MARK: Bus alerts

    /// The routes watched at the alert station (Settings checklist; at least one stays checked).
    func toggleAlertRoute(_ rid: String) {
        var cur = Notify.watchedRoutes(notify, staticData: staticData, hidden: hidden)
        if let i = cur.firstIndex(of: rid) { cur.remove(at: i) } else { cur.append(rid) }
        if cur.isEmpty { showInfo("Keep at least one route"); return }
        updateNotify { $0.rids = cur }
    }

    func turnOffBusAlerts() {
        setAlertStation(nil)
        showInfo("Bus alerts turned off")
    }
}
