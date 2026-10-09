import Foundation

/// A named set of routes ("My Routes").
public struct CustomRoute: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var rids: [String]
    /// Routes emphasized on the map while applied (a subset of `rids`).
    public var highlight: [String]
    public init(id: String, name: String, rids: [String], highlight: [String] = []) {
        self.id = id; self.name = name; self.rids = rids; self.highlight = highlight
    }
}

/// "Only show relevant routes" while a trip or station journey is on (not persisted).
public struct Journey: Codable, Hashable, Sendable {
    public enum Kind: String, Codable, Sendable { case plan, station }
    public var rids: [String]
    public var label: String
    public var kind: Kind
    public init(rids: [String], label: String, kind: Kind = .plan) { self.rids = rids; self.label = label; self.kind = kind }
}

/// "Routes to <station>" filter.
public struct RouteFilter: Codable, Hashable, Sendable {
    public var ids: [String]
    public var label: String
    public init(ids: [String], label: String) { self.ids = ids; self.label = label }
}

/// The visibility-relevant slice of the web app's store (state.js): user prefs plus the bits of navigation
/// that change map focus. Value type; every change goes through a `StatePatch` (core/custom.js style).
public struct RouteState: Codable, Hashable, Sendable {
    /// Known route ids in data order.
    public var routeIds: [String]
    public var hiddenRoutes: [String] = []
    /// Map draw priority, first = drawn on top. May be partial.
    public var routeOrder: [String] = []
    public var customRoutes: [CustomRoute] = []
    public var activeCustom: String? = nil
    public var prevHidden: [String] = []
    public var favStops: [String] = []
    public var journey: Journey? = nil
    public var routeFilter: RouteFilter? = nil
    /// Current view id ('route' focuses `routeId`).
    public var view: String = "nearby"
    public var routeId: String? = nil

    public init(routeIds: [String], hiddenRoutes: [String] = [], routeOrder: [String] = [], customRoutes: [CustomRoute] = [],
                activeCustom: String? = nil, prevHidden: [String] = [], favStops: [String] = [], journey: Journey? = nil,
                routeFilter: RouteFilter? = nil, view: String = "nearby", routeId: String? = nil) {
        self.routeIds = routeIds; self.hiddenRoutes = hiddenRoutes; self.routeOrder = routeOrder
        self.customRoutes = customRoutes; self.activeCustom = activeCustom; self.prevHidden = prevHidden
        self.favStops = favStops; self.journey = journey; self.routeFilter = routeFilter; self.view = view
        self.routeId = routeId
    }

    /// Apply a patch like `store.set(patch)` would (shallow merge).
    public mutating func apply(_ p: StatePatch) {
        if let v = p.hiddenRoutes { hiddenRoutes = v }
        if let v = p.routeOrder { routeOrder = v }
        if let v = p.customRoutes { customRoutes = v }
        if let v = p.activeCustom { activeCustom = v }
        if let v = p.prevHidden { prevHidden = v }
        if let v = p.favStops { favStops = v }
        if let v = p.routeFilter { routeFilter = v }
    }

    public func applying(_ p: StatePatch) -> RouteState { var s = self; s.apply(p); return s }
}

/// A store patch (the object core/custom.js functions return). nil = key absent; for the optional fields a
/// `.some(nil)` value means "set to null".
public struct StatePatch: Hashable, Sendable {
    public var hiddenRoutes: [String]? = nil
    public var routeOrder: [String]? = nil
    public var customRoutes: [CustomRoute]? = nil
    public var activeCustom: String?? = nil
    public var prevHidden: [String]? = nil
    public var favStops: [String]? = nil
    public var routeFilter: RouteFilter?? = nil

    public init(hiddenRoutes: [String]? = nil, routeOrder: [String]? = nil, customRoutes: [CustomRoute]? = nil,
                activeCustom: String?? = nil, prevHidden: [String]? = nil, favStops: [String]? = nil,
                routeFilter: RouteFilter?? = nil) {
        self.hiddenRoutes = hiddenRoutes; self.routeOrder = routeOrder; self.customRoutes = customRoutes
        self.activeCustom = activeCustom; self.prevHidden = prevHidden; self.favStops = favStops; self.routeFilter = routeFilter
    }

    /// `{}`.
    public static let empty = StatePatch()
    public var isEmpty: Bool { self == .empty }

    /// `{...self, ...other}`.
    public func merging(_ o: StatePatch) -> StatePatch {
        var p = self
        if let v = o.hiddenRoutes { p.hiddenRoutes = v }
        if let v = o.routeOrder { p.routeOrder = v }
        if let v = o.customRoutes { p.customRoutes = v }
        if let v = o.activeCustom { p.activeCustom = .some(v) }
        if let v = o.prevHidden { p.prevHidden = v }
        if let v = o.favStops { p.favStops = v }
        if let v = o.routeFilter { p.routeFilter = .some(v) }
        return p
    }
}

/// One answer to "which routes does the user see right now" (web/js/core/visibility.js).
public enum RouteVisibility {
    /// Route ids hidden right now (a journey wins over the user's hidden list).
    public static func effectiveHidden(_ s: RouteState) -> [String] {
        if let j = s.journey, !j.rids.isEmpty {
            let keep = Set(j.rids)
            return s.routeIds.filter { !keep.contains($0) }
        }
        return s.hiddenRoutes
    }

    public static func isVisible(_ s: RouteState, _ rid: String) -> Bool { !effectiveHidden(s).contains(rid) }

    /// The applied custom route, or nil.
    public static func activeCustomRoute(_ s: RouteState) -> CustomRoute? {
        guard let id = s.activeCustom else { return nil }
        return s.customRoutes.first { $0.id == id }
    }

    /// Routes to emphasize on the map (others dimmed), or nil for no focus.
    /// Precedence: route view > journey (already hidden down) > station filter > custom highlight.
    public static func mapFocus(_ s: RouteState) -> [String]? {
        if s.view == "route", let rid = s.routeId { return [rid] }
        if let j = s.journey, !j.rids.isEmpty { return nil }
        if let f = s.routeFilter?.ids, !f.isEmpty { return f }
        if let c = activeCustomRoute(s), !c.highlight.isEmpty { return c.highlight }
        return nil
    }

    /// Draw order, top-most first: focus, then routeOrder, then data order. Unknown ids dropped.
    public static func drawOrder(_ s: RouteState, focus: [String]? = nil) -> [String] {
        let known = Set(s.routeIds)
        var out: [String] = []
        var seen = Set<String>()
        for rid in (focus ?? []) + s.routeOrder + s.routeIds where known.contains(rid) && seen.insert(rid).inserted { out.append(rid) }
        return out
    }

    public struct MapVisibility: Hashable, Sendable {
        public var hidden: [String]
        public var focus: [String]?
        public var order: [String]
    }

    /// Everything the map needs to know about visibility, in one call.
    public static func mapVisibility(_ s: RouteState) -> MapVisibility {
        let focus = mapFocus(s)
        return MapVisibility(hidden: effectiveHidden(s), focus: focus, order: drawOrder(s, focus: focus))
    }
}
