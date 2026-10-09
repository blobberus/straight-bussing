import SwiftUI
import StraightBussingKit

/// Route detail (ui/views/route.js): status + today's hours, stop timeline in travel order with the next
/// ETA per stop and live buses on the rail, then "Hours & service" from the official schedule.
struct RouteDetailView: View {
    @Environment(AppModel.self) private var model
    let rid: String

    var body: some View {
        let r = model.route(rid)
        let n = model.running(rid)
        let svc = model.staticData.service
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 6) {
                    if n > 0 { LiveDot() }
                    Text(n > 0 ? "\(n) bus\(n == 1 ? "" : "es") running" : "Not running right now").font(.subheadline.weight(.semibold))
                    if let r, !r.short.isEmpty { Text("· \(r.short)").font(.subheadline).foregroundStyle(.secondary) }
                }
                if let h = Schedule.hoursOn(svc, rid, model.now) {
                    let on = Schedule.isScheduledNow(svc, rid, model.now)
                    Text("Today \(h.label)\(on == nil ? "" : on! ? " · Scheduled now" : " · Not scheduled now")")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                if model.hidden.contains(rid) {
                    HStack {
                        Text("This route is hidden on the map.").font(.subheadline)
                        Spacer()
                        Button("Show") { model.apply(Custom.toggleHidden(model.routeState, rid)) }.buttonStyle(.bordered)
                    }
                }
                SectionTitle(text: "Stops")
                Card { stopTimeline(color: Color(hex: r?.color)) }
                service(svc)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
        }
    }

    func stopTimeline(color: Color) -> some View {
        let order = Notify.routeOrder(model.staticData.routeStops[rid]).order
        let busesByStop = Dictionary(grouping: model.live.buses.filter { $0.trip.routeId == rid && $0.stopId != nil }, by: { $0.stopId! })
        return VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(order.enumerated()), id: \.offset) { item in
                let id = item.element
                let next = Arrivals.arrivalsFor(trips: model.live.trips, stopId: id, routeId: rid, now: model.now).first
                HStack(spacing: 10) {
                    ZStack {
                        VStack(spacing: 0) {
                            Rectangle().fill(item.offset == 0 ? .clear : color).frame(width: 5)
                            Rectangle().fill(item.offset == order.count - 1 ? .clear : color).frame(width: 5)
                        }
                        Circle().fill(Color(.systemBackground)).overlay(Circle().stroke(color, lineWidth: 2.5)).frame(width: 11, height: 11)
                        if let b = busesByStop[id]?.first {
                            BusRailMarker(route: model.route(rid), label: b.vehicle.label).offset(y: -20).fixedSize()
                        }
                    }
                    .frame(width: 34)
                    Button { model.push(.stop(id)) } label: {
                        HStack {
                            Text(model.staticData.stops[id]?.name ?? id).font(.subheadline).foregroundStyle(.primary).lineLimit(1)
                            Spacer()
                            if let next {
                                Text(TimeFmt.etaLabel(next.t, now: model.now, stale: model.staleLevel != .fresh))
                                    .font(.subheadline.weight(.semibold)).monospacedDigit()
                            }
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
                .frame(height: 44)
            }
        }
    }

    @ViewBuilder func service(_ svc: ServiceData) -> some View {
        let week = Schedule.weekSummary(svc, rid)
        if !week.isEmpty {
            SectionTitle(text: "Hours & service")
            Card {
                ForEach(week, id: \.days) { w in
                    HStack {
                        Text(w.days).font(.subheadline.weight(.semibold))
                        Spacer()
                        Text(w.label).font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.trailing)
                    }
                    .frame(minHeight: 36)
                }
            }
            let changes = Schedule.upcomingChanges(svc, rid, model.now)
            if changes.isEmpty {
                Text("No schedule changes in the next 30 days.").font(.footnote).foregroundStyle(.secondary)
            } else {
                Card {
                    ForEach(changes, id: \.date) { c in
                        HStack { Text(c.label).font(.subheadline.weight(.semibold)); Spacer(); Text(c.text).font(.subheadline) }.frame(minHeight: 36)
                    }
                }
            }
            busesChart(svc)
            Text("Hours and bus counts come from the official published schedule. Live service may differ.")
                .font(.caption).foregroundStyle(.secondary)
        }
    }

    @ViewBuilder func busesChart(_ svc: ServiceData) -> some View {
        let key = Schedule.dayKey(model.now)
        let list = Schedule.busesByHour(svc, rid, key)
        let maxN = list.map(\.buses).max() ?? 0
        if maxN > 1 {
            SectionTitle(text: "Scheduled buses by hour, today")
            Card {
                HStack(alignment: .bottom, spacing: 3) {
                    ForEach(list, id: \.hour) { x in
                        VStack(spacing: 2) {
                            Text("\(x.buses)").font(.system(size: 9)).foregroundStyle(.secondary)
                            RoundedRectangle(cornerRadius: 2).fill(Color.accentColor.opacity(0.8))
                                .frame(height: CGFloat(x.buses) / CGFloat(maxN) * 60)
                            Text(x.hour % 3 == 0 ? Schedule.hourLabel(x.hour).replacingOccurrences(of: " ", with: "") : " ")
                                .font(.system(size: 8)).foregroundStyle(.secondary).lineLimit(1).fixedSize()
                        }
                        .frame(maxWidth: .infinity)
                    }
                }
                .padding(.vertical, 8)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Schedule.groupHours(list).map { "\(Schedule.hourLabel($0.from)) to \(Schedule.hourLabel($0.to)): \($0.buses) buses" }.joined(separator: ", "))
            }
        }
    }
}
