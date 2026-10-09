import Foundation

/// Custom routes ("My Routes"), map order, show/hide all, favorites (web/js/core/custom.js). Every function
/// takes the current state and returns a `StatePatch`; nothing here touches storage.
///
/// Applying a custom route rewrites hiddenRoutes to "everything not in the set" and remembers the previous
/// hiddenRoutes in prevHidden, so clearing it restores what the user had. One custom route at a time.
public enum Custom {
    static let maxName = 60

    /// A short unique id ('c' + base-36 time + 4 random chars).
    public static func newId() -> String {
        let ms = Int64(Date().timeIntervalSince1970 * 1000)
        let alphabet = Array("abcdefghijklmnopqrstuvwxyz0123456789")
        return "c" + String(ms, radix: 36) + String((0..<4).map { _ in alphabet.randomElement()! })
    }

    /// Trimmed, whitespace-collapsed, length-limited name ('My route' when empty).
    public static func cleanName(_ name: String?) -> String {
        let words = (name ?? "").split(whereSeparator: { $0.isWhitespace })
        let s = String(words.joined(separator: " ").prefix(maxName)).trimmingCharacters(in: .whitespaces)
        return s.isEmpty ? "My route" : s
    }

    static func unique(_ xs: [String]) -> [String] {
        var seen = Set<String>()
        return xs.filter { seen.insert($0).inserted }
    }

    /// Route ids visible from the user's hidden list (data order).
    public static func visibleRids(_ s: RouteState) -> [String] {
        let hidden = Set(s.hiddenRoutes)
        return s.routeIds.filter { !hidden.contains($0) }
    }

    /// Hidden list that shows exactly `rids`.
    public static func hiddenFor(_ s: RouteState, _ rids: [String]) -> [String] {
        let keep = Set(rids)
        return s.routeIds.filter { !keep.contains($0) }
    }

    /// Does the current hiddenRoutes show exactly this custom route's set?
    public static func matchesCurrent(_ s: RouteState, _ c: CustomRoute) -> Bool {
        let known = Set(s.routeIds)
        return Set(visibleRids(s)) == Set(c.rids.filter { known.contains($0) })
    }

    /// Create a custom route (not applied).
    public static func createCustom(_ s: RouteState, name: String, rids: [String], id: String = newId()) -> (patch: StatePatch, id: String) {
        let c = CustomRoute(id: id, name: cleanName(name), rids: unique(rids), highlight: [])
        return (StatePatch(customRoutes: s.customRoutes + [c]), id)
    }

    /// Create a custom route from what is visible now and mark it applied.
    public static func saveVisibleAsCustom(_ s: RouteState, name: String, id: String = newId()) -> (patch: StatePatch, id: String) {
        let made = createCustom(s, name: name, rids: visibleRids(s), id: id)
        var p = made.patch
        p.activeCustom = .some(made.id)
        p.prevHidden = []
        return (p, made.id)
    }

    /// Update name / rids / highlight. Re-applies it if it is the active one. Empty patch if not found.
    public static func updateCustom(_ s: RouteState, _ id: String, name: String? = nil, rids: [String]? = nil,
                                    highlight: [String]? = nil) -> StatePatch {
        guard let i = s.customRoutes.firstIndex(where: { $0.id == id }) else { return .empty }
        var c = s.customRoutes[i]
        if let name { c.name = cleanName(name) }
        if let rids { c.rids = unique(rids) }
        if let highlight { c.highlight = unique(highlight) }
        c.highlight = c.highlight.filter { c.rids.contains($0) }
        var next = s.customRoutes
        next[i] = c
        var p = StatePatch(customRoutes: next)
        if s.activeCustom == id { p.hiddenRoutes = hiddenFor(s, c.rids) }
        return p
    }

    /// Toggle one route in a custom route's highlight list.
    public static func toggleHighlight(_ s: RouteState, _ id: String, _ rid: String) -> StatePatch {
        guard let c = s.customRoutes.first(where: { $0.id == id }) else { return .empty }
        let h = c.highlight
        return updateCustom(s, id, highlight: h.contains(rid) ? h.filter { $0 != rid } : h + [rid])
    }

    /// Delete a custom route (clears it first if applied).
    public static func deleteCustom(_ s: RouteState, _ id: String) -> StatePatch {
        let base = s.activeCustom == id ? clearCustom(s) : .empty
        return base.merging(StatePatch(customRoutes: s.customRoutes.filter { $0.id != id }))
    }

    /// Apply a custom route: show only its routes, remember the previous hidden list, clear the station filter.
    public static func applyCustom(_ s: RouteState, _ id: String) -> StatePatch {
        guard let c = s.customRoutes.first(where: { $0.id == id }) else { return .empty }
        let prev = s.activeCustom != nil ? s.prevHidden : s.hiddenRoutes
        return StatePatch(hiddenRoutes: hiddenFor(s, c.rids), activeCustom: .some(id), prevHidden: prev, routeFilter: .some(nil))
    }

    /// Stop applying the custom route and restore the hidden list from before.
    public static func clearCustom(_ s: RouteState) -> StatePatch {
        guard s.activeCustom != nil else { return .empty }
        return StatePatch(hiddenRoutes: s.prevHidden, activeCustom: .some(nil), prevHidden: [])
    }

    /// The full draw-priority list: saved order (known ids) then every missing route in data order.
    static func fullOrder(_ s: RouteState) -> [String] {
        let known = Set(s.routeIds)
        var order = s.routeOrder.filter { known.contains($0) }
        for r in s.routeIds where !order.contains(r) { order.append(r) }
        return order
    }

    /// Move a route up (-1) or down (+1) in the draw-priority list.
    public static func moveInOrder(_ s: RouteState, _ rid: String, _ delta: Int) -> StatePatch {
        var order = fullOrder(s)
        guard let i = order.firstIndex(of: rid) else { return .empty }
        let j = i + delta
        guard j >= 0, j < order.count else { return .empty }
        order.swapAt(i, j)
        return StatePatch(routeOrder: order)
    }

    /// Move a route to an absolute position (drag and drop), clamped. Empty patch if unknown or unchanged.
    public static func moveToIndex(_ s: RouteState, _ rid: String, _ index: Int) -> StatePatch {
        var order = fullOrder(s)
        guard let i = order.firstIndex(of: rid), !order.isEmpty else { return .empty }
        let j = max(0, min(order.count - 1, index))
        if i == j { return .empty }
        order.remove(at: i)
        order.insert(rid, at: j)
        return StatePatch(routeOrder: order)
    }

    /// Show every route (optionally only `rids`), dropping an applied custom route.
    public static func showAll(_ s: RouteState, _ rids: [String]? = nil) -> StatePatch {
        let hidden = rids.map { only in s.hiddenRoutes.filter { !Set(only).contains($0) } } ?? []
        return StatePatch(hiddenRoutes: hidden, activeCustom: .some(nil), prevHidden: [])
    }

    /// Hide every route (optionally only `rids`), dropping an applied custom route.
    public static func hideAll(_ s: RouteState, _ rids: [String]? = nil) -> StatePatch {
        let add = rids ?? s.routeIds
        return StatePatch(hiddenRoutes: unique(s.hiddenRoutes + add), activeCustom: .some(nil), prevHidden: [])
    }

    /// Toggle a favorite station.
    public static func toggleFav(_ s: RouteState, _ stopId: String) -> StatePatch {
        let f = s.favStops
        return StatePatch(favStops: f.contains(stopId) ? f.filter { $0 != stopId } : f + [stopId])
    }

    /// Toggle one route's eye (hidden list), like the Routes list does.
    public static func toggleHidden(_ s: RouteState, _ rid: String) -> StatePatch {
        let h = s.hiddenRoutes
        return StatePatch(hiddenRoutes: h.contains(rid) ? h.filter { $0 != rid } : h + [rid])
    }

    /// Validate persisted custom routes (state.js cleanCustom): string ids, trimmed names, unique ids,
    /// highlight a subset of rids; bad entries dropped.
    public static func cleanCustom(_ list: [CustomRoute]) -> [CustomRoute] {
        var out: [CustomRoute] = []
        for c in list {
            let name = String(c.name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(maxName))
            if c.id.isEmpty || name.isEmpty || out.contains(where: { $0.id == c.id }) { continue }
            let rids = unique(c.rids.filter { !$0.isEmpty })
            out.append(CustomRoute(id: c.id, name: name, rids: rids, highlight: unique(c.highlight).filter { rids.contains($0) }))
        }
        return out
    }
}
