import SwiftUI
import StraightBussingKit

/// Google-Maps-style progress of a started trip: walk to the stop, every stop of the bus leg with the live bus
/// moving between them (passed / next / upcoming, like the web route detail's stop timeline + bus rail),
/// live ETAs per stop, then the final walk. Built from `TripProgress` (StraightBussingKit).
struct TripTimelineView: View {
    @Environment(AppModel.self) private var model
    let progress: TripProgress
    let trip: ActiveTrip

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            header
            Card {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(progress.steps.enumerated()), id: \.offset) { item in
                        switch item.element {
                        case .walk(_, let leg, let start, let end, let done, let active):
                            WalkStepRow(leg: leg, start: start, end: end, done: done, active: active, isLast: item.offset == progress.steps.count - 1)
                        case .bus(let seg):
                            BusSegmentView(seg: seg)
                        }
                    }
                }
                .padding(.vertical, 6)
            }
            Text("Times are estimates from live predictions and the schedule. Unofficial: check the official app if in doubt.")
                .font(.caption).foregroundStyle(.secondary)
        }
    }

    var header: some View {
        Card {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    ForEach(trip.option.busLegs, id: \.boardT) { b in RouteChip(route: model.route(b.rid), rid: b.rid) }
                    Text("To \(trip.label)").font(.subheadline.weight(.semibold)).lineLimit(1)
                    Spacer()
                    EstTag(text: progress.currentSegment?.live == true ? "est. · live" : "est.")
                }
                Text(progress.headline)
                    .font(.title3.weight(.bold))
                    .accessibilityIdentifier("tripHeadline")
                if !progress.detail.isEmpty { Text(progress.detail).font(.subheadline).foregroundStyle(.secondary) }
                HStack {
                    Text("Arrive about \(TimeFmt.clock(progress.arrive))").font(.subheadline.weight(.semibold))
                    Spacer()
                    Button("End trip", role: .destructive) { model.endTrip() }
                        .buttonStyle(.bordered)
                        .accessibilityIdentifier("endTrip")
                }
            }
            .padding(.vertical, 8)
        }
    }
}

/// A walking step (dotted rail).
struct WalkStepRow: View {
    let leg: WalkLeg
    let start: Double
    let end: Double
    let done: Bool
    let active: Bool
    let isLast: Bool
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(spacing: 2) {
                Image(systemName: done ? "checkmark.circle.fill" : "figure.walk.circle.fill")
                    .font(.title3)
                    .foregroundStyle(done ? Color.secondary : (active ? Color.blue : Color.gray))
                if !isLast {
                    Rectangle().fill(.clear).frame(width: 3, height: 22)
                        .overlay(Line().stroke(Color.gray, style: StrokeStyle(lineWidth: 3, lineCap: .round, dash: [1, 6])))
                }
            }
            .frame(width: 30)
            VStack(alignment: .leading, spacing: 2) {
                Text("Walk to \(leg.to.name == "Destination" ? "your destination" : leg.to.name)")
                    .font(.subheadline.weight(active ? .bold : .medium))
                    .foregroundStyle(done ? .secondary : .primary)
                Text("About \(max(1, Int(leg.min.rounded()))) min · \(Int(leg.m)) m (est.)")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Text(TimeFmt.clock(end)).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
        .accessibilityValue(done ? "Done" : active ? "Now" : "")
    }
}

struct Line: Shape {
    func path(in r: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: r.midX, y: r.minY))
        p.addLine(to: CGPoint(x: r.midX, y: r.maxY))
        return p
    }
}

/// The stops of one bus leg on a vertical rail in the route color, with the live bus between stops.
struct BusSegmentView: View {
    @Environment(AppModel.self) private var model
    let seg: TripProgress.BusSegment
    static let rowH: CGFloat = 46

    var body: some View {
        let route = model.route(seg.rid)
        let color = Color(hex: route?.color)
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                RouteChip(route: route, rid: seg.rid)
                Text(route?.displayName ?? seg.rid).font(.subheadline.weight(.semibold))
                Spacer()
                Text(statusText).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            }
            .padding(.vertical, 6)
            if seg.hiddenBefore > 0 {
                Text("Bus is \(seg.hiddenBefore) more stop\(seg.hiddenBefore == 1 ? "" : "s") further back")
                    .font(.caption).foregroundStyle(.secondary).padding(.leading, 40).padding(.bottom, 2)
            }
            ZStack(alignment: .topLeading) {
                VStack(spacing: 0) {
                    ForEach(Array(seg.rows.enumerated()), id: \.element.id) { item in
                        StopRowView(row: item.element, index: item.offset, count: seg.rows.count, color: color,
                                    busRow: seg.busRow, now: model.now)
                            .frame(height: Self.rowH)
                    }
                }
                if let r = seg.busRow {
                    let y = max(0, (CGFloat(r) - 1 + CGFloat(seg.busFrac)) * Self.rowH + Self.rowH / 2)
                    BusRailMarker(route: route, label: seg.vehicleLabel)
                        .offset(x: 3, y: y - 12)
                        .animation(.easeInOut(duration: 0.8), value: y)
                }
            }
        }
        .accessibilityElement(children: .contain)
    }

    var statusText: String {
        if seg.pastAlight { return "Done" }
        if seg.boarded { return seg.stopsLeft == 0 ? "Next stop: get off" : "\(seg.stopsLeft ?? 0) stops left" }
        if let a = seg.stopsAway, seg.located { return a == 0 ? "Bus arriving" : "Bus \(a) stop\(a == 1 ? "" : "s") away" }
        return "Bus at \(TimeFmt.clock(seg.boardEta)) (est.)"
    }
}

struct StopRowView: View {
    let row: TripProgress.StopRow
    let index: Int
    let count: Int
    let color: Color
    let busRow: Int?
    let now: Double

    var body: some View {
        let passed = row.state == .passed
        let key = row.role == .board || row.role == .alight
        let railColor = row.role == .approach ? color.opacity(0.35) : (passed ? Color.gray.opacity(0.5) : color)
        HStack(spacing: 10) {
            ZStack {
                VStack(spacing: 0) {
                    Rectangle().fill(index == 0 ? .clear : railColor).frame(width: 5)
                    Rectangle().fill(index == count - 1 ? .clear : railColor).frame(width: 5)
                }
                Circle()
                    .fill(key ? color : Color(.systemBackground))
                    .overlay(Circle().stroke(passed ? Color.gray : color, lineWidth: key ? 0 : 2.5))
                    .frame(width: key ? 16 : 11, height: key ? 16 : 11)
            }
            .frame(width: 30)
            VStack(alignment: .leading, spacing: 1) {
                Text(row.name)
                    .font(.subheadline.weight(key ? .bold : .regular))
                    .foregroundStyle(passed || row.role == .approach ? .secondary : .primary)
                    .lineLimit(1)
                if let label = roleLabel { Text(label).font(.caption).foregroundStyle(.secondary) }
            }
            Spacer()
            if let t = row.eta, !passed {
                VStack(alignment: .trailing, spacing: 0) {
                    Text(TimeFmt.etaLabel(t, now: now)).font(.subheadline.weight(.semibold)).monospacedDigit()
                    Text(row.etaLive ? "live" : "sched.").font(.caption2).foregroundStyle(.secondary)
                }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(row.name)\(roleLabel.map { ", " + $0 } ?? "")\(row.eta.map { ", " + TimeFmt.etaLabel($0, now: now) + " estimate" } ?? "")\(passed ? ", passed" : "")")
    }

    var roleLabel: String? {
        switch row.role {
        case .board: return "Board here"
        case .alight: return "Get off here"
        case .approach: return row.state == .next ? "Bus heading here" : nil
        case .ride: return nil
        }
    }
}

/// The bus on the rail.
struct BusRailMarker: View {
    let route: Route?
    let label: String?
    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "bus.fill").font(.system(size: 12, weight: .bold))
            if let label { Text(label).font(.caption2.weight(.heavy)).monospacedDigit() }
        }
        .padding(.horizontal, 6).frame(height: 24)
        .foregroundStyle(Color.textOn(hex: route?.color))
        .background(Color(hex: route?.color), in: Capsule())
        .overlay(Capsule().stroke(.white, lineWidth: 2))
        .shadow(color: .black.opacity(0.25), radius: 2, y: 1)
        .accessibilityLabel("Live bus position")
    }
}
