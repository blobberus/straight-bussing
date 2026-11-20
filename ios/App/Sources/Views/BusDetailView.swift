import SwiftUI
import StraightBussingKit

/// The bus menu (owner 2026-11-20: "There should be an ability for the user to click a particular bus on the map which
/// will show its next stop, line, and schedule. In this menu, at the bottom should be report and feedback ... for now
/// gray this button out"; web ui/views/bus.js). A bus tap on the map opens it; the sheet title names the line, the header
/// shows its badge and "Bus 2". In order: where the bus heads and when (live, or "~5 min" with "est."), "location from 2
/// min ago" when the report is old, "Transitioning to new line" (then no times); Next stops for one lap, each opening its
/// stop; Line schedule (today's hours, Scheduled now / Not scheduled now); See the whole route (the route page with this
/// bus picked); Report and feedback at the very bottom, grayed out with "Coming soon" until `SiteLinks.busReport` is set.
/// A bus gone from the feed for 45 s: "This bus is no longer reporting". Words and rules: Kit `BusMenu`.
struct BusDetailView: View {
    @Environment(AppModel.self) private var model
    let rid: String
    let key: String
    @ScaledMetric(relativeTo: .subheadline) private var rowH: CGFloat = 44

    var body: some View {
        let m = model.busMenuModel(rid: rid, key: key)
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                if m.status == .gone || m.status == .away {
                    let away = m.status == .away
                    EmptyStateView(title: away ? BusMenu.Words.awayTitle : BusMenu.Words.goneTitle,
                                   message: away ? BusMenu.Words.awayBody : BusMenu.Words.goneBody)
                    wholeRoute(m)
                    schedule(m)
                } else {
                    status(m)
                    if m.status == .ok {
                        stops(m)
                        Text(LiveText.staleNote(model.staleLevel, BusMenu.Words.stale) ?? BusMenu.Words.live)
                            .font(.footnote).foregroundStyle(Palette.text2)
                        if m.anyEst { Text(BusMenu.Words.estFoot).font(.footnote).foregroundStyle(Palette.text2) }
                    }
                    schedule(m)
                    wholeRoute(m)
                }
                report(m)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
        }
        // Passio moved the bus to another line: the menu follows it (web menuSync), in place of this one
        .onChange(of: BusMenu.movedTo(model.live, key: key, rid: rid, routes: model.staticData.routes)) { _, r in
            if let r, model.page == .bus(rid, key) { model.showPage(.bus(r, key)); model.syncMapFocus() }
        }
    }

    /// Where the bus heads now and when (or that it is transitioning / has no time).
    @ViewBuilder func status(_ m: BusMenu.Model) -> some View {
        let lbl = LiveText.liveLabel(model.staleLevel)
        let seen = m.stale ? "\(BusMenu.Words.seenPrefix) \(TimeFmt.ago(m.seen, from: model.now))" : nil
        Card {
            if m.status == .transitioning {
                VStack(alignment: .leading, spacing: 2) {
                    Text(Seen.transitionText).font(.headline)
                    if let seen { Text(seen.prefix(1).uppercased() + seen.dropFirst()).font(.footnote).foregroundStyle(Palette.warn) }
                }
                .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(BusMenu.statusSay(m, now: model.now))
            } else if let next = m.next {
                let t = BusMenu.timeText(next, now: model.now, staleFeed: model.isStale)
                HStack(alignment: .center, spacing: 10) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(BusMenu.Words.heading).font(.caption.weight(.semibold)).foregroundStyle(Palette.text2)
                        Text(next.name).font(.headline).foregroundStyle(Palette.text).lineLimit(3)
                        HStack(spacing: 4) {
                            if !t.text.isEmpty {
                                if next.kind == .est { EstTag(text: StationTimes.Words.est) } else { LiveDot(level: model.staleLevel); Text(lbl.text) }
                            }
                            if let seen { Text((t.text.isEmpty ? "" : ", ") + seen).foregroundStyle(Palette.warn) }
                        }
                        .font(.caption).foregroundStyle(Palette.text2)
                    }
                    Spacer(minLength: 6)
                    if !t.text.isEmpty {
                        Text(t.text).font(.title3.weight(.bold)).monospacedDigit()
                            .foregroundStyle(t.now ? Palette.live : Palette.text)
                            .fixedSize().layoutPriority(1)
                    }
                }
                .frame(minHeight: 52)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(BusMenu.statusSay(m, now: model.now, staleFeed: model.isStale, liveSay: lbl.spoken))
            } else {
                Text(BusMenu.Words.noTimes).font(.subheadline).foregroundStyle(Palette.text2).frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
            }
        }
        .accessibilityIdentifier("busStatus")
    }

    /// Next stops: one lap in travel order, each row opens its stop; the first is where the bus heads now.
    @ViewBuilder func stops(_ m: BusMenu.Model) -> some View {
        if !m.rows.isEmpty {
            let lbl = LiveText.liveLabel(model.staleLevel)
            let color = Color(hex: m.route?.color)
            SectionTitle(text: BusMenu.Words.nextStops)
            Card {
                ForEach(Array(m.rows.enumerated()), id: \.offset) { item in
                    let i = item.offset, r = item.element
                    let t = BusMenu.timeText(r, now: model.now, staleFeed: model.isStale)
                    if i > 0 { Divider() }
                    Button { model.push(.stop(r.stopId)) } label: {
                        HStack(spacing: 10) {
                            Circle().fill(i == 0 ? color : Palette.card).overlay(Circle().stroke(color, lineWidth: 2.5))
                                .frame(width: 11, height: 11).accessibilityHidden(true)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(r.name).font(.subheadline).foregroundStyle(Palette.text).lineLimit(2)
                                if i == 0 { Text(BusMenu.Words.next).font(.caption2.weight(.bold)).foregroundStyle(Palette.text2) }
                            }
                            Spacer(minLength: 6)
                            if !t.text.isEmpty {
                                VStack(alignment: .trailing, spacing: 0) {
                                    Text(t.text).font(.subheadline.weight(.semibold)).monospacedDigit()
                                        .foregroundStyle(t.now ? Palette.live : Palette.text)
                                    if !t.tag.isEmpty { Text(t.tag).font(.footnote).foregroundStyle(Palette.text2) }
                                }
                                .fixedSize()
                            }
                        }
                        .frame(minHeight: rowH)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("\(r.name)\(i == 0 ? ", " + BusMenu.Words.next.lowercased() : ""), "
                                        + (t.say.isEmpty ? "no time yet" : t.say + (r.kind == .est ? "" : ", " + lbl.spoken)))
                    .accessibilityAddTraits(.isButton)
                    .accessibilityHint("Opens the stop")
                }
            }
            if !m.loopTo.isEmpty {
                Label("\(BusMenu.Words.loop) \(m.loopTo)", systemImage: "arrow.triangle.2.circlepath")
                    .font(.footnote).foregroundStyle(Palette.text2)
            }
        }
    }

    /// Line schedule: today's hours in the route page's words + Scheduled now / Not scheduled now.
    @ViewBuilder func schedule(_ m: BusMenu.Model) -> some View {
        SectionTitle(text: BusMenu.Words.lineSchedule)
        Card {
            VStack(alignment: .leading, spacing: 4) {
                if let h = m.hours {
                    (Text(h.k).bold() + Text(" " + h.label + (h.note.isEmpty ? "" : " " + h.note))).font(.subheadline)
                    if let on = h.on {
                        Text(on ? BusMenu.Words.scheduledNow : BusMenu.Words.notScheduledNow)
                            .font(.subheadline.weight(.semibold)).foregroundStyle(on ? Palette.live : Palette.text2)
                    }
                } else {
                    Text(BusMenu.Words.noSchedule).font(.subheadline).foregroundStyle(Palette.text2)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .padding(.vertical, 4)
            .accessibilityElement(children: .combine)
        }
    }

    /// See the whole route: the route page, with this bus picked while it is still in the feed.
    @ViewBuilder func wholeRoute(_ m: BusMenu.Model) -> some View {
        if m.route != nil {
            Button { model.openWholeRoute(m) } label: {
                Label(BusMenu.Words.wholeRoute, systemImage: "map").frame(maxWidth: .infinity, minHeight: 44)
            }
            .secondaryButtonStyle()
            .accessibilityIdentifier("busWholeRoute")
        }
    }

    /// Report and feedback, the very bottom: the Google Form with only the line, bus, next stop, Chicago time and app
    /// version filled in once `SiteLinks.busReport` is set; until then grayed out (VoiceOver: dimmed) with "Coming soon".
    @ViewBuilder func report(_ m: BusMenu.Model) -> some View {
        VStack(spacing: 6) {
            if let url = model.busReportURL(m) {
                Link(destination: url) {
                    Label(BusMenu.Words.report, systemImage: "exclamationmark.bubble").frame(maxWidth: .infinity, minHeight: 44)
                }
                .secondaryButtonStyle()
                .accessibilityHint(BusMenu.Words.reportSay)
                Text(BusMenu.Words.reportOn).font(.footnote).foregroundStyle(Palette.text2).multilineTextAlignment(.center)
            } else {
                Button {} label: {
                    Label(BusMenu.Words.report, systemImage: "exclamationmark.bubble").frame(maxWidth: .infinity, minHeight: 44)
                }
                .secondaryButtonStyle()
                .disabled(true)
                .accessibilityHint(BusMenu.Words.reportSoon)
                Text(BusMenu.Words.reportSoon).font(.footnote).foregroundStyle(Palette.text2).multilineTextAlignment(.center)
                    .accessibilityHidden(true)   // read as the button's hint
            }
        }
        .padding(.top, 14)
        .accessibilityIdentifier("busReport")
    }
}
