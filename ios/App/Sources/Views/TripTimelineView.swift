import SwiftUI
import StraightBussingKit

/// Current trip timeline, Google-Maps-transit style (web ui/views/tripprogress.js): "Trip to <destination>",
/// arrive ~clock est., End trip; a one-glance status card for the phase; then walk rows on a dotted line and each
/// bus leg like the route detail stop timeline, with the followed bus as a chip ON the line between the right stops.
/// Passed stops are dimmed AND say "Passed"; the bus position is also written out, never color alone. Data:
/// Kit `TripFollow` (web core/tripprogress.js), words: Kit `TripText`.
struct TripTimelineView: View {
    @Environment(AppModel.self) private var model
    let progress: TripFollow
    let trip: ActiveTrip

    var body: some View {
        let p = progress
        VStack(alignment: .leading, spacing: 10) {
            Card {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Trip to \(p.to)").font(.headline).accessibilityAddTraits(.isHeader)
                        HStack(spacing: 4) {
                            Text(TripText.arriveLine(p, now: model.now)).font(.subheadline).foregroundStyle(.secondary)
                            if p.arriveT != nil { EstTag(text: "est.") }
                        }
                    }
                    Spacer()
                    Button("End trip", role: .destructive) { model.endTrip() }
                        .buttonStyle(.bordered)
                        .frame(minHeight: 44)
                        .accessibilityIdentifier("endTrip")
                }
                .padding(.vertical, 8)
            }
            if p.stale == .old || p.stale == .err {
                Label("Live data delayed. Bus position and times may be off.", systemImage: "exclamationmark.triangle.fill")
                    .font(.footnote.weight(.semibold)).foregroundStyle(.orange)
                    .accessibilityAddTraits(.updatesFrequently)
            }
            NowCardView(progress: p)
            Card {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(p.legs.enumerated()), id: \.offset) { item in
                        switch item.element {
                        case .walk(let w): TripWalkRow(progress: p, index: item.offset, leg: w)
                        case .bus(let b): TripBusLeg(progress: p, leg: b, legIndex: item.offset)
                        }
                    }
                    TripDestinationRow(progress: p)
                }
                .padding(.vertical, 6)
                .accessibilityElement(children: .contain)
                .accessibilityLabel("Trip timeline")
            }
            HStack(spacing: 8) {
                Button {
                    if model.page != .directions { model.push(.directions) }
                } label: { Text("Trip steps").frame(maxWidth: .infinity, minHeight: 44) }
                    .buttonStyle(.bordered)
                PickButton()
            }
            Text(TripText.footnote(p)).font(.caption).foregroundStyle(.secondary)
            if p.stale == .err { OfficialContact() }
        }
    }
}

/// The status card for the current phase (walk to the stop + when to leave / bus N stops away / N stops to your
/// stop / walk to the destination), with the big ETA on the right.
struct NowCardView: View {
    @Environment(AppModel.self) private var model
    let progress: TripFollow
    var body: some View {
        let c = TripText.nowCard(progress, routes: model.staticData.routes, now: model.now)
        Card {
            HStack(alignment: .top, spacing: 12) {
                switch c.icon {
                case .walk: Image(systemName: "figure.walk").font(.title2).foregroundStyle(.blue).frame(width: 32).accessibilityHidden(true)
                case .route(let rid): RouteChip(route: model.route(rid), rid: rid)
                case .pin: Image(systemName: "mappin.circle.fill").font(.title2).foregroundStyle(.red).frame(width: 32).accessibilityHidden(true)
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text(c.prim).font(.title3.weight(.bold)).fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("tripHeadline")
                    ForEach(c.sec, id: \.self) { Text($0).font(.subheadline).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
                }
                Spacer(minLength: 0)
                if let t = c.eta { EtaText(t: t, now: model.now, stale: c.etaApprox) }
            }
            .padding(.vertical, 10)
            .accessibilityElement(children: .contain)
        }
    }
}

/// A walking row on a dotted line ("Walk 4 min to Ratner Center" / "Walked to …" + leave guidance).
struct TripWalkRow: View {
    @Environment(AppModel.self) private var model
    let progress: TripFollow
    let index: Int
    let leg: TripFollow.WalkStep
    var body: some View {
        let t = TripText.walkRow(progress, index, now: model.now)
        let done = leg.state == .done, active = leg.state == .active
        HStack(alignment: .top, spacing: 10) {
            VStack(spacing: 2) {
                Image(systemName: done ? "checkmark.circle.fill" : "figure.walk.circle.fill")
                    .font(.title3)
                    .foregroundStyle(done ? Color.secondary : (active ? Color.blue : Color.gray))
                Rectangle().fill(.clear).frame(width: 3, height: 20)
                    .overlay(DottedLine().stroke(Color.gray, style: StrokeStyle(lineWidth: 3, lineCap: .round, dash: [1, 6])))
            }
            .frame(width: 32)
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(t.head).font(.subheadline.weight(active ? .bold : .medium)).foregroundStyle(done ? .secondary : .primary)
                if !t.sub.isEmpty { Text(t.sub).font(.caption).foregroundStyle(.secondary) }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
        .accessibilityValue(active ? "Now" : done ? "Done" : "")
    }
}

struct DottedLine: Shape {
    func path(in r: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: r.midX, y: r.minY))
        p.addLine(to: CGPoint(x: r.midX, y: r.maxY))
        return p
    }
}

/// One bus leg: head (route, stops, where the bus is; opens the route) + its stops on a rail in the route color.
struct TripBusLeg: View {
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledMetric(relativeTo: .subheadline) private var rowH: CGFloat = 52
    let progress: TripFollow
    let leg: TripFollow.BusStep
    let legIndex: Int
    static let railW: CGFloat = 32

    var body: some View {
        let r = model.route(leg.rid)
        let color = Color(hex: r?.color)
        let late = progress.stale != .fresh
        let shown = TripText.shownStops(leg)
        let lead = TripText.leadRow(leg)
        let v = leg.state == .active ? leg.vehicle : nil
        let showV = v != nil && v!.idx < shown.stops.count
        let name = !(r?.long ?? "").isEmpty ? r!.long : !(r?.short ?? "").isEmpty ? r!.short : "Route"
        let meta = TripText.busMeta(leg)
        let whereLine = TripText.whereLine(leg, now: model.now)
        VStack(alignment: .leading, spacing: 0) {
            Button { model.push(.route(leg.rid)) } label: {
                HStack(spacing: 8) {
                    RouteChip(route: r, rid: leg.rid)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(name).font(.subheadline.weight(.semibold)).foregroundStyle(.primary)
                        Text(meta.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
                        if !whereLine.isEmpty {
                            Text(whereLine).font(.caption.weight(.medium)).foregroundStyle(v?.stale == true ? Color.orange : Color.secondary)
                        }
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
                }
                .padding(.vertical, 6)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(name): \(meta.joined(separator: ", "))\(whereLine.isEmpty ? "" : ". " + whereLine). Open route details")
            .accessibilityAddTraits(.isButton)
            ZStack(alignment: .topLeading) {
                VStack(spacing: 0) {
                    if let lead {
                        LeadRow(text: lead.text, passed: lead.passed, color: color, rowH: rowH)
                    }
                    ForEach(Array(shown.stops.enumerated()), id: \.element.id) { item in
                        TripStopRow(stop: item.element, k: item.offset, count: shown.stops.count, leg: leg, shown: shown,
                                    color: color, late: late, hasLead: lead != nil, rowH: rowH)
                    }
                }
                if showV, let v {
                    let n = Double(shown.stops.count + (lead != nil ? 1 : 0))
                    let raw = lead != nil ? (v.idx < 0 ? 0 : v.pos + 1) : v.pos
                    let vpos = (raw * 5).rounded() / 5
                    let y = CGFloat(min(max(vpos, -0.4), n - 0.6) + 0.5) * rowH
                    BusChip(label: v.label, color: color, textColor: Color.textOn(hex: r?.color), stale: v.stale)
                        .offset(x: Self.railW / 2 - BusChip.w / 2, y: y - BusChip.h / 2)
                        .animation(reduceMotion ? nil : .easeInOut(duration: 0.8), value: y)
                        .accessibilityHidden(true)   // the head line and the row labels say where the bus is
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Stops from \(leg.boardName) to \(leg.alightName)")
        }
    }
}

/// The stop the bus just left (passed, outside your trip) or "2 more stops before X".
struct LeadRow: View {
    let text: String
    let passed: Bool
    let color: Color
    let rowH: CGFloat
    var body: some View {
        HStack(spacing: 10) {
            VStack(spacing: 0) {
                Rectangle().fill(Color.gray.opacity(0.4)).frame(width: 4)
            }
            .frame(width: TripBusLeg.railW)
            Text(text).font(.caption).foregroundStyle(.secondary).lineLimit(2)
            Spacer(minLength: 0)
            if passed { Text("Passed").font(.caption.weight(.semibold)).foregroundStyle(.secondary) }
        }
        .frame(height: rowH)
        .accessibilityElement(children: .combine)
    }
}

/// One stop of a bus leg: rail + dot, name with "Board here" / "Get off here" / bus pill, ETA or "Passed".
struct TripStopRow: View {
    @Environment(AppModel.self) private var model
    let stop: TripFollow.StopRow
    let k: Int
    let count: Int
    let leg: TripFollow.BusStep
    let shown: (stops: [TripFollow.StopRow], boardIdx: Int, alightIdx: Int)
    let color: Color
    let late: Bool
    let hasLead: Bool
    let rowH: CGFloat

    /// The rail between row j and j+1 is dimmed before boarding and once the bus has passed it.
    func dimSeg(_ j: Int) -> Bool {
        if j + 1 <= shown.boardIdx { return true }
        guard j + 1 < shown.stops.count else { return false }
        let s = shown.stops[j + 1].state
        return s == .passed || s == .current
    }

    var body: some View {
        let passed = stop.state == .passed
        let key = stop.role == .board || stop.role == .alight
        let topDim = (k > 0 && dimSeg(k - 1)) || (k == 0 && hasLead)
        let botDim = k < count - 1 && dimSeg(k)
        let eta = TripText.stopEta(stop, leg, now: model.now, late: late)
        let pill = TripText.busPill(stop, k: k, leg)
        Button { model.push(.stop(stop.id)) } label: {
            HStack(spacing: 10) {
                ZStack {
                    VStack(spacing: 0) {
                        Rectangle().fill(k == 0 && !hasLead ? Color.clear : (topDim ? Color.gray.opacity(0.4) : color)).frame(width: 4)
                        Rectangle().fill(k == count - 1 ? Color.clear : (botDim ? Color.gray.opacity(0.4) : color)).frame(width: 4)
                    }
                    Circle()
                        .fill(key ? color : Color(.systemBackground))
                        .overlay(Circle().stroke(passed ? Color.gray : color, lineWidth: key ? 0 : 2.5))
                        .frame(width: key ? 18 : 12, height: key ? 18 : 12)
                }
                .frame(width: TripBusLeg.railW)
                VStack(alignment: .leading, spacing: 2) {
                    Text(stop.name)
                        .font(.subheadline.weight(key ? .bold : .regular))
                        .foregroundStyle(passed || stop.role == .before ? .secondary : .primary)
                        .lineLimit(1).minimumScaleFactor(0.8)
                    HStack(spacing: 4) {
                        if stop.role == .board { RoleTag(text: "Board here") }
                        if stop.role == .alight { RoleTag(text: "Get off here") }
                        if let pill { Text(pill).font(.caption2.weight(.bold)).foregroundStyle(.white).padding(.horizontal, 6).padding(.vertical, 1).background(color, in: Capsule()) }
                    }
                }
                Spacer(minLength: 0)
                HStack(spacing: 3) {
                    Text(eta.text).font(.subheadline.weight(eta.text == "Now" ? .bold : .semibold)).monospacedDigit()
                        .foregroundStyle(passed ? Color.secondary : eta.text == "Now" ? Color.green : Color.primary)
                    if eta.est { EstTag(text: "est.") }
                }
            }
            .frame(height: rowH)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(TripText.stopSay(stop, k: k, leg, now: model.now, late: late))
        .accessibilityAddTraits(.isButton)
    }
}

struct RoleTag: View {
    let text: String
    var body: some View {
        Text(text).font(.caption2.weight(.semibold)).padding(.horizontal, 5).padding(.vertical, 1)
            .overlay(Capsule().stroke(Color.secondary.opacity(0.6), lineWidth: 1))
            .foregroundStyle(.secondary)
    }
}

/// The followed bus on the rail.
struct BusChip: View {
    static let w: CGFloat = 52
    static let h: CGFloat = 22
    let label: String
    let color: Color
    let textColor: Color
    let stale: Bool
    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: "bus.fill").font(.system(size: 10, weight: .bold))
            Text(label.count > 5 ? String(label.suffix(5)) : (label.isEmpty ? "Bus" : label)).font(.caption2.weight(.heavy)).monospacedDigit()
        }
        .frame(width: Self.w, height: Self.h)
        .foregroundStyle(textColor)
        .background(color, in: Capsule())
        .overlay(Capsule().stroke(.white, lineWidth: 2))
        .opacity(stale ? 0.6 : 1)
        .shadow(color: .black.opacity(0.25), radius: 2, y: 1)
    }
}

/// The destination row at the end of the timeline.
struct TripDestinationRow: View {
    @Environment(AppModel.self) private var model
    let progress: TripFollow
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "mappin.circle.fill").font(.title3).foregroundStyle(.red).frame(width: TripBusLeg.railW).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(progress.to).font(.subheadline.weight(progress.phase == .arrived ? .bold : .semibold))
                if let a = progress.arriveT {
                    HStack(spacing: 4) {
                        Text("Arrive about \(TimeFmt.clock(a))").font(.caption).foregroundStyle(.secondary)
                        EstTag(text: "est.")
                    }
                } else {
                    Text("Destination").font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
    }
}

/// The bus on the route detail rail (route.js busMarker).
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
