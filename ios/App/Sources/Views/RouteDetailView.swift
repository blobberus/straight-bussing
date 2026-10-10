import SwiftUI
import StraightBussingKit

/// Route detail (ui/views/route.js): status + today's hours (calendar exceptions named), where each bus is in
/// words, the stop timeline in travel order with the next ETA per stop, "Bus N heading here" pills, direction
/// chevrons and the buses on the rail, the loop note, then "Hours & service" from the official schedule (week,
/// schedule changes incl. this route's service alerts, scheduled buses by hour).
struct RouteDetailView: View {
    @Environment(AppModel.self) private var model
    let rid: String
    /// Stop row height on the rail: 44 pt at the default text size, more with Dynamic Type.
    @ScaledMetric(relativeTo: .subheadline) private var rowH: CGFloat = 44

    var body: some View {
        if let r = model.route(rid) {
            content(r)
        } else {
            VStack(spacing: 10) {
                EmptyStateView(title: "Route not found", message: "This route is not in the current schedule.")
                Button { model.popToRoot(); model.select(.routes) } label: { Text("See all routes").frame(maxWidth: .infinity, minHeight: 44) }
                    .secondaryButtonStyle()
            }
            .padding(16)
        }
    }

    func content(_ r: Route) -> some View {
        let n = model.running(rid)
        let svc = model.staticData.service
        // scheduled but no bus reporting: "Scheduled until 4:29 AM, no live location", never "Not running" (rider safety)
        let quiet: String? = n == 0 && !model.liveOutage ? Operating.noLiveStatus(rid, buses: model.buses, service: svc, now: model.now) : nil
        let status: String = n > 0 ? "\(n) bus\(n == 1 ? "" : "es") running"
            : model.liveOutage ? "Live status unavailable" : quiet ?? "Not running right now"
        let ids = RouteText.stopOrder(model.staticData.routeStops[rid])
        let list = model.staticData.routeStops[rid] ?? []
        let loop = list.count > 2 && list.first == list.last
        let spots = model.liveLoaded ? RouteText.busPositions(model.staticData, buses: model.buses, rid: rid, now: model.now) : []
        return ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 6) {
                    if n > 0 { LiveDot() }
                    Text(status).font(.subheadline.weight(.semibold))
                    if !r.short.isEmpty && !r.long.isEmpty { Text("· \(r.short)").font(.subheadline).foregroundStyle(Palette.text2) }
                }
                .accessibilityElement(children: .combine)
                if quiet != nil {
                    Text("No bus on this route is sending its location, so we can't confirm it's running. Call 773.702.8181 before you rely on it.")
                        .font(.footnote).foregroundStyle(Palette.text2)
                }
                if let h = Schedule.hoursOn(svc, rid, model.now) {
                    let on = Schedule.isScheduledNow(svc, rid, model.now)
                    (Text("Today ").bold() + Text(h.label + RouteText.exceptionNote(h)) + Text(on == nil ? "" : on! ? " · Scheduled now" : " · Not scheduled now"))
                        .font(.footnote).foregroundStyle(Palette.text2)
                }
                if model.hidden.contains(rid) {
                    if model.routeState.journey != nil {
                        Text("This route is not part of the current journey, so it is hidden on the map.").font(.subheadline).foregroundStyle(Palette.text2)
                    } else {
                        HStack {
                            Text("This route is hidden from the map and arrival times.").font(.subheadline)
                            Spacer()
                            Button("Show") { model.toggleRouteHidden(rid) }.secondaryButtonStyle()
                        }
                    }
                }
                if n == 0 && model.liveLoaded && model.buses.isEmpty { OfficialContact() }
                if ids.isEmpty {
                    EmptyStateView(title: "No stops listed", message: "The schedule has no stops for this route.")
                } else {
                    if !spots.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            ForEach(Array(spots.enumerated()), id: \.offset) { item in
                                HStack(alignment: .firstTextBaseline, spacing: 6) {
                                    Image(systemName: "bus.fill").font(.caption2).foregroundStyle(Palette.text2).accessibilityHidden(true)
                                    Text(item.element.text).font(.footnote).foregroundStyle(item.element.stale ? Palette.warn : Palette.text2)
                                }
                            }
                        }
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel("Where the buses are: " + spots.map(\.text).joined(separator: ". "))
                    }
                    SectionTitle(text: "Stops")
                    Card { stopTimeline(ids: ids, loop: loop, spots: spots, color: Color(hex: r.color), route: r) }
                    if loop, let first = ids.first {
                        Label("Loop: continues to \(model.staticData.stops[first]?.name ?? first)", systemImage: "arrow.triangle.2.circlepath")
                            .font(.footnote).foregroundStyle(Palette.text2)
                    }
                    if model.liveLoaded {
                        Text(model.isStale ? "Live data delayed. Times and bus positions may be off." : "Times are live predictions. Bus positions are approximate.")
                            .font(.footnote).foregroundStyle(Palette.text2)
                    }
                }
                RouteScheduleView(rid: rid, day: Self.localDay(model.now), t: model.now, alertIds: routeAlerts.map(\.id)).equatable()
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
        }
    }

    var routeAlerts: [ServiceAlert] { model.activeAlerts.filter { $0.routeIds.contains(rid) } }

    func stopTimeline(ids: [String], loop: Bool, spots: [RouteText.BusSpot], color: Color, route: Route) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(ids.enumerated()), id: \.offset) { item in
                let i = item.offset, id = item.element
                let next = model.arrivals(at: id, routeId: rid).first
                let here = spots.filter { $0.next == i }
                let onRail = spots.filter { ($0.prev ?? $0.next) == i }   // a marker lives in the row it is leaving
                let last = i == ids.count - 1
                let eta = TimeFmt.etaLabel(next?.t, now: model.now, stale: model.isStale)
                let name = model.staticData.stops[id]?.name ?? id
                HStack(spacing: 10) {
                    ZStack(alignment: .top) {
                        VStack(spacing: 0) {
                            Rectangle().fill(i == 0 && !loop ? .clear : color).frame(width: 5)
                            Rectangle().fill(last && !loop ? .clear : color).frame(width: 5)
                        }
                        Circle().fill(Palette.card).overlay(Circle().stroke(color, lineWidth: 2.5)).frame(width: 11, height: 11)
                            .offset(y: rowH / 2 - 5.5)
                        if !(last && !loop) {
                            Image(systemName: "chevron.down").font(.system(size: 8, weight: .heavy)).foregroundStyle(Color.textOn(hex: route.color))
                                .offset(y: rowH - 6)
                        }
                        ForEach(Array(onRail.enumerated()), id: \.offset) { b in
                            BusRailMarker(route: route, label: b.element.label).fixedSize()
                                .opacity(b.element.stale ? 0.55 : 1)
                                .offset(y: b.element.prev == nil ? 2 : rowH / 2 + CGFloat(b.element.frac) * rowH - 12)
                        }
                    }
                    .frame(width: 40, height: rowH)
                    .zIndex(1)
                    .accessibilityHidden(true)
                    Button { model.push(.stop(id)) } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(name).font(.subheadline).foregroundStyle(Palette.text).lineLimit(2)
                                ForEach(Array(here.enumerated()), id: \.offset) { b in
                                    Text("Bus \(b.element.label) heading here\(b.element.stale ? " · seen \(TimeFmt.ago(b.element.seen, from: model.now))" : "")")
                                        .font(.caption2.weight(.bold)).foregroundStyle(Color.textOn(hex: route.color))
                                        .padding(.horizontal, 6).padding(.vertical, 1)
                                        .background(color.opacity(b.element.stale ? 0.55 : 1), in: Capsule())
                                }
                            }
                            Spacer()
                            if !eta.isEmpty {
                                Text(eta).font(.subheadline.weight(.semibold)).monospacedDigit()
                                    .foregroundStyle(eta == "Now" ? Palette.live : Palette.text)
                            }
                        }
                        .frame(minHeight: rowH)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("\(name)\(eta.isEmpty ? ", no prediction" : ", next bus " + (eta == "Now" ? "now" : "in " + eta.replacingOccurrences(of: "~", with: "about ")))\(here.isEmpty ? "" : ", a bus is heading here")")
                    .accessibilityAddTraits(.isButton)
                }
            }
        }
    }

    /// Local (America/Chicago) date of `t`, e.g. "2026-10-9": the schedule section only changes with it.
    static func localDay(_ t: Double) -> String {
        let p = Schedule.localParts(t)
        return "\(p.y)-\(p.m)-\(p.d)"
    }
}

/// "Hours & service" from the official schedule. Its calendar maths (week summary, changes in the next 30 days,
/// scheduled buses by hour) depends only on the route, the local date and the route's alerts, so the view is
/// equatable on those and is not rebuilt on every live poll or clock tick.
struct RouteScheduleView: View, Equatable {
    @Environment(AppModel.self) private var model
    let rid: String
    let day: String
    /// A time on `day` (used for the 30-day window and the weekday).
    let t: Double
    /// This route's active service alerts (shown under "Schedule changes").
    let alertIds: [String]

    nonisolated static func == (a: RouteScheduleView, b: RouteScheduleView) -> Bool { a.rid == b.rid && a.day == b.day && a.alertIds == b.alertIds }

    var body: some View { service(model.staticData.service) }

    @ViewBuilder func service(_ svc: ServiceData) -> some View {
        let week = Schedule.weekSummary(svc, rid)
        let alerts = model.alerts.filter { alertIds.contains($0.id) }
        let has = Schedule.routeService(svc, rid) != nil
        if has || !alerts.isEmpty {
            SectionTitle(text: "Hours & service")
            if !week.isEmpty {
                Card {
                    ForEach(week, id: \.days) { w in
                        HStack {
                            Text(w.days).font(.subheadline.weight(.semibold))
                            Spacer()
                            Text(w.label).font(.subheadline).foregroundStyle(Palette.text2).multilineTextAlignment(.trailing)
                        }
                        .frame(minHeight: 36)
                        .accessibilityElement(children: .combine)
                    }
                }
            }
            let changes = Schedule.upcomingChanges(svc, rid, t)
            if !changes.isEmpty || !alerts.isEmpty {
                Text("Schedule changes").font(.subheadline.weight(.semibold)).padding(.top, 4).accessibilityAddTraits(.isHeader)
                Card {
                    ForEach(alerts) { a in
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Text("Service alert").font(.caption.weight(.bold)).foregroundStyle(Palette.warn)
                                .padding(.horizontal, 5).padding(.vertical, 1)
                                .background(Palette.warnBg, in: RoundedRectangle(cornerRadius: Radius.tag, style: .continuous))
                                .fixedSize()
                            Text(a.header.isEmpty ? (a.description.isEmpty ? "Service alert" : a.description) : a.header).font(.subheadline)
                        }
                        .frame(minHeight: 36, alignment: .leading)
                    }
                    ForEach(changes, id: \.date) { c in
                        HStack { Text(c.label).font(.subheadline.weight(.semibold)); Spacer(); Text(c.text).font(.subheadline) }
                            .frame(minHeight: 36)
                            .accessibilityElement(children: .combine)
                    }
                }
            } else if has {
                Text("No schedule changes in the next 30 days.").font(.footnote).foregroundStyle(Palette.text2)
            }
            busesChart(svc)
            if has {
                Text("Hours and bus counts come from the official published schedule. Live service may differ.")
                    .font(.caption).foregroundStyle(Palette.text2)
            }
        }
    }

    @ViewBuilder func busesChart(_ svc: ServiceData) -> some View {
        if let chart = RouteText.busesChart(svc, rid: rid, now: t) {
            let list = chart.list
            let maxN = max(1, list.map(\.buses).max() ?? 1)
            let first = list[0].hour
            let span = (list[list.count - 1].hour - first + 24) % 24 + 1
            let by = Dictionary(list.map { ($0.hour, $0.buses) }, uniquingKeysWith: { a, _ in a })
            let bars = (0..<span).map { i -> (hour: Int, buses: Int) in let h = (first + i) % 24; return (h, by[h] ?? 0) }
            SectionTitle(text: "Scheduled buses by hour, \(chart.when)")
            Card {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .bottom, spacing: 3) {
                        ForEach(bars, id: \.hour) { x in
                            VStack(spacing: 2) {
                                Text(x.buses > 0 ? "\(x.buses)" : " ").font(.system(size: 9)).foregroundStyle(Palette.text2)
                                RoundedRectangle(cornerRadius: 2).fill(Palette.accent.opacity(x.buses > 0 ? 0.8 : 0.2))
                                    .frame(height: max(2, CGFloat(x.buses) / CGFloat(maxN) * 60))
                                Text(x.hour % 3 == 0 ? Schedule.hourLabel(x.hour).replacingOccurrences(of: " ", with: "") : " ")
                                    .font(.system(size: 8)).foregroundStyle(Palette.text2).lineLimit(1).fixedSize()
                            }
                            .frame(maxWidth: .infinity)
                        }
                    }
                    .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        ForEach(RouteText.hoursLines(list), id: \.self) { Text($0).font(.caption).foregroundStyle(Palette.text2) }
                    }
                }
                .padding(.vertical, 8)
            }
        }
    }
}
