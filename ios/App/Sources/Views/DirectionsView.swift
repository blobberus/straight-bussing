import SwiftUI
import UIKit
import StraightBussingKit

/// Directions' typed text, focused field and suggestions (owner spec 2026-10-12: the Start / Destination fields sit
/// in a card at the top of the screen, where the search bar was, and the suggestions and trip options in the sheet
/// below). Owned by RootView and shared by both through the environment. Keystrokes never touch AppModel, so the map
/// and the rest of the UI don't redraw while typing.
@MainActor @Observable
final class DirectionsUI {
    enum Field: Hashable { case from, to }
    var focus: Field?
    var fromText = ""
    var toText = ""
    var items: [Endpoint] = []
    var places = PlaceUI()
    var itemsQuery: String?

    var query: String { focus == .from ? fromText : focus == .to ? toText : "" }

    func sync(_ model: AppModel) {
        fromText = model.dir.from?.label ?? ""
        toText = model.dir.to?.label ?? ""
    }

    /// A suggestion picked (or Return on the field): set the endpoint, show its name, drop the keyboard.
    func choose(_ e: Endpoint, for f: Field, model: AppModel) {
        if e.isMe {
            model.useMyLocation(to: f == .to)
        } else {
            model.setEndpoint(f == .from ? \DirectionsState.from : \DirectionsState.to, e)
        }
        sync(model)
        focus = nil
    }
}

/// The Start / Destination card at the top of the screen (it replaces the search bar while Directions is open, and
/// turns back into it when Directions closes; RootView). Collapsing the sheet drops the keyboard and leaves the card
/// in place, so the map shows between the card and the collapsed sheet.
struct DirectionsCard: View {
    @Environment(AppModel.self) private var model
    @Environment(DirectionsUI.self) private var ui
    @FocusState private var focus: DirectionsUI.Field?

    var body: some View {
        @Bindable var ui = ui
        HStack(spacing: 8) {
            VStack(spacing: 0) {
                field(.from, text: $ui.fromText, placeholder: "Start")
                Divider().padding(.leading, 28)
                field(.to, text: $ui.toText, placeholder: "Destination")
            }
            Button { model.swapEndpoints(); ui.sync(model) } label: {
                Image(systemName: "arrow.up.arrow.down").font(.body.weight(.semibold)).tapTarget()
            }
            .accessibilityLabel("Swap start and destination")
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 4)
        .background(Palette.card, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
        .shadow(color: Palette.shadow.opacity(0.15), radius: 8, y: 2)
        // map chrome: grows with text size, but not so far that it hides the map
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("directionsCard")
        .onAppear {
            ui.sync(model)
            ui.places = PlaceUI()
            ui.items = []
            ui.itemsQuery = nil
            if let q = model.demoQuery { model.demoQuery = nil; ui.toText = q; setFocus(.to) }
            else if model.dir.to == nil { setFocus(.to) } else if model.dir.from == nil { setFocus(.from) }
        }
        .onDisappear { ui.focus = nil }
        .onChange(of: model.dir.from) { _, e in ui.fromText = e?.label ?? "" }
        .onChange(of: model.dir.to) { _, e in ui.toText = e?.label ?? "" }
        .onChange(of: focus) { _, f in
            if ui.focus != f { ui.focus = f }
            if let f {
                model.dirActiveTo = f == .to
                ui.places.exact = false
                ui.places.fix = nil
                if model.detent == .peek { model.detent = .full }   // typing: the suggestions need the sheet
            }
        }
        .onChange(of: ui.focus) { _, f in if focus != f { focus = f } }
        // collapsing the sheet drops the keyboard; the card stays where it is
        .onChange(of: model.detent) { _, d in if d == .peek { setFocus(nil) } }
    }

    func setFocus(_ f: DirectionsUI.Field?) {
        focus = f
        ui.focus = f
    }

    /// Start = hollow ring, destination = the red pin of the map's destination marker (green is for live data only).
    func field(_ f: DirectionsUI.Field, text: Binding<String>, placeholder: String) -> some View {
        HStack(spacing: 10) {
            Group {
                if f == .from { Circle().strokeBorder(Palette.text2, lineWidth: 2.5) } else { Circle().fill(.red) }
            }
            .frame(width: 11, height: 11)
            .accessibilityHidden(true)
            TextField(placeholder, text: text)
                .focused($focus, equals: f)
                .submitLabel(.search)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .frame(minHeight: 44)
                .onSubmit { if let first = ui.items.first { ui.choose(first, for: f, model: model) } }
                .accessibilityLabel("\(placeholder): station or place")
                .accessibilityIdentifier(f == .from ? "dirFrom" : "dirTo")
            if !text.wrappedValue.isEmpty && focus == f {
                Button { text.wrappedValue = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Palette.text2).tapTarget() }
                    .accessibilityLabel("Clear")
            }
        }
    }
}

/// Directions in the sheet (ui/views/directions.js), under the top card: station + place suggestions for the field
/// being typed in (on-device first, Photon only when fewer than 5 local matches, spelling-fix note), else up to 4
/// option cards ranked least walking > earliest arrival > shortest wait with "what it minimizes", walk + leave
/// guidance lines, steps for the selected card, Start (trip progress + Live Activity). While a trip is on, a trip bar
/// heads the results and picking another card makes the timeline follow it; changing an endpoint ends the trip.
struct DirectionsView: View {
    @Environment(AppModel.self) private var model
    @Environment(DirectionsUI.self) private var ui

    struct SuggestionKey: Equatable {
        var field: DirectionsUI.Field?
        var text: String
        var exact: Bool
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                if let f = ui.focus { suggestions(for: f) } else { results }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
        }
        .task(id: SuggestionKey(field: ui.focus, text: ui.query, exact: ui.places.exact)) { await loadSuggestions() }
    }

    /// On-device suggestions right away; Photon merged in when it answers (only if the index has < 5 matches).
    func loadSuggestions() async {
        guard ui.focus != nil else { return }
        let q = ui.query, user = model.user, S = model.staticData
        // one "use my location" action per screen (web DESIGN "Copy"): with no start yet, the Start field offers it
        let dropMe = ui.focus == .to && model.dir.from == nil && user == nil
        let destination = ui.focus == .to   // only the destination is held to the shuttle area (Coverage)
        func sugs(_ places: [PlaceHit], _ assumed: SearchAssumption?) -> [Endpoint] {
            let all = AppModel.suggestions(q, user: user, staticData: S, places: places, assumed: assumed,
                                           destination: destination)
            return dropMe ? all.filter { !$0.isMe } : all
        }
        if ui.itemsQuery != nil { try? await Task.sleep(nanoseconds: 60_000_000) }   // typing: coalesce a burst of keystrokes
        guard !Task.isCancelled else { return }
        await PlaceSearchFlow.run(q, exact: ui.places.exact, model: model, update: { st in
            ui.places = st
            ui.items = sugs(st.items, st.assumed)
            ui.itemsQuery = q
        }, current: { ui.places })
        if PlaceIndex.norm(q).count < 2 && !Task.isCancelled {
            ui.items = sugs([], nil)
            ui.itemsQuery = q
        }
    }

    @ViewBuilder func suggestions(for f: DirectionsUI.Field) -> some View {
        let q = (f == .from ? ui.fromText : ui.toText).trimmingCharacters(in: .whitespaces)
        let mine = q.count >= 2 && ui.places.q == q
        if mine { AssumeNote(state: ui.places) { on in ui.places.fix = on ? ui.places.assumed : nil; ui.places.exact = on } }
        if !ui.items.isEmpty {
            Card {
                ForEach(Array(ui.items.enumerated()), id: \.offset) { item in
                    if item.offset > 0 { Divider() }
                    Button { ui.choose(item.element, for: f, model: model) } label: {
                        HStack(spacing: 10) {
                            Image(systemName: item.element.isMe ? "location.fill" : item.element.stopId != nil ? "bus" : "mappin")
                                .frame(width: 22).foregroundStyle(Palette.text2).accessibilityHidden(true)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(item.element.label).foregroundStyle(Palette.text).lineLimit(1)
                                Text(model.placeSubtitle(item.element)).font(.caption).foregroundStyle(Palette.text2).lineLimit(2)
                            }
                            Spacer()
                        }
                        .frame(minHeight: 48)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        if mine && ui.places.status == .busy {
            Hint(ui.items.contains { $0.stopId == nil && !$0.isMe } ? "Searching more places\u{2026}" : "Searching places\u{2026}")
        }
        if mine && ui.places.status == .err { Hint("Couldn\u{2019}t search places right now. Station names still work.") }
        let settled = q.count >= 2 && ui.itemsQuery == q && ui.places.status == .idle
        // the destination, searched and settled, with no station or place left inside the shuttle area (owner
        // 2026-10-15, web directions.js): say what the app covers instead of "No stations or places match"
        if f == .to && q.count >= 3 && mine && settled && !model.staticData.isEmpty && ui.items.isEmpty
            && !"my location".hasPrefix(q.lowercased()) {   // typing "my location" is not a miss (web: same rule)
            Hint(Coverage.text)
                .accessibilityIdentifier("dirCoverage")
                .onAppear { UIAccessibility.post(notification: .announcement, argument: Coverage.text) }
        } else if ui.items.isEmpty && settled {
            Hint("No stations or places match. Try another name or an address.")
        }
        if model.dirMeDenied { Hint("Location is off. Allow it in iOS Settings, or type a start.") }
        if q.count >= 2 { PhotonNote() }
    }

    @ViewBuilder var results: some View {
        if let t = model.dir.to, !model.covered(t) {
            // outside the shuttle area (owner 2026-10-15; set by Swap or My location too, with or without a start, as
            // web resHTML): no plan, no walk-only line
            EmptyStateView(title: Coverage.text)
                .accessibilityIdentifier("dirCoverageResult")
        } else if model.dir.from == nil || model.dir.to == nil {
            Hint("Choose a start and a destination. Type a station name, a place, or an address.")
            if model.dir.from == nil && model.user == nil {
                Button { model.useMyLocation(to: false) } label: {
                    Label("Start from my location", systemImage: "location.fill").frame(maxWidth: .infinity, minHeight: 44)
                }
                .secondaryButtonStyle()
            }
        } else if let r = model.dir.result {
            TripBar()
            if model.staleLevel != .fresh {
                Text("Live data delayed. Bus times may be off.").font(.subheadline.weight(.semibold)).foregroundStyle(Palette.warn)
            }
            if r.options.isEmpty {
                let running = !model.buses.isEmpty
                if model.liveOutage {   // a feed outage is not "no shuttles running" (rider safety)
                    EmptyStateView(title: "Can't plan shuttle trips right now",
                                   message: "The live shuttle feed can't be reached, so we can't tell which buses are running.",
                                   showOfficial: true, operatorAlerts: true)
                } else {
                    let idle: String = (model.silentService ? model.silentText() : nil) ?? "No shuttles are running right now."
                    EmptyStateView(title: "No practical shuttle route right now",
                                   message: r.missedAll ? "The next buses leave before you could reach the stop."
                                       : running ? "Nothing runs close enough to both places." : idle,
                                   showOfficial: !running, operatorAlerts: !running)
                }
                walkOnlyCard(r)
                refiningNote
            } else {
                ForEach(Array(r.options.prefix(Planner.maxOpts).enumerated()), id: \.element.key) { item in
                    OptionCard(option: item.element, index: item.offset, showCriteria: r.options.count > 1,
                               selected: item.offset == model.dir.selected)
                }
                Text("Walking the whole way: \(TripInfo.mins(r.walkOnlyMin)) min (\(r.walkOnlyM) m), \(walkSourceText(r))")
                    .font(.footnote).foregroundStyle(Palette.text2)
                refiningNote
                Text("Bus times are estimates from schedules and live predictions. They will get more accurate as we collect more ride data.")
                    .font(.footnote).foregroundStyle(Palette.text2)
            }
        } else {
            HStack(spacing: 8) {
                ProgressView()
                Text("Finding trips\u{2026}").font(.subheadline).foregroundStyle(Palette.text2)
            }
            .frame(maxWidth: .infinity, minHeight: 44)
        }
    }

    /// Where walking times come from (web directions.js walkTag): Apple Maps sidewalks or the straight line.
    func walkSourceText(_ r: PlanResult) -> String { r.walkOnlySource == .router ? "sidewalk route" : "estimate" }

    /// Shown while Apple Maps walking routes replace the straight-line estimates.
    @ViewBuilder var refiningNote: some View {
        if model.dir.refining {
            Text("Checking sidewalk routes\u{2026}").font(.footnote).foregroundStyle(Palette.text2)
                .accessibilityIdentifier("dirRefining")
        }
    }

    /// Walk-only fallback (directions.js): minutes + source tag, arrival clock, "Walk the whole way", meters.
    func walkOnlyCard(_ r: PlanResult) -> some View {
        Card {
            VStack(alignment: .leading, spacing: 4) {
                let mins = Text("\(TripInfo.mins(r.walkOnlyMin))").font(.title2.weight(.bold)).monospacedDigit()
                let arrive = Text("Arrive \(TimeFmt.clock(model.now + r.walkOnlyMin * 60))").font(.subheadline.weight(.semibold))
                ViewThatFits(in: .horizontal) {   // large text: the arrival under the minutes, never broken inside the clock
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        mins
                        Text("min").font(.subheadline).foregroundStyle(Palette.text2)
                        EstTag(text: walkSourceText(r))
                        Spacer()
                        arrive
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            mins
                            Text("min").font(.subheadline).foregroundStyle(Palette.text2)
                            EstTag(text: walkSourceText(r))
                        }
                        arrive
                    }
                }
                HStack {
                    Label("Walk the whole way", systemImage: "figure.walk").font(.subheadline.weight(.semibold))
                    Spacer()
                    Text("\(r.walkOnlyM) m").font(.subheadline).foregroundStyle(Palette.text2)
                }
            }
            .padding(.vertical, 8)
            .accessibilityElement(children: .combine)
        }
    }
}

/// Trip bar at the top of the results while a trip is on (journey.js tripBarHTML).
struct TripBar: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        if let trip = model.activeTrip {
            Card {
                HStack(spacing: 10) {
                    Circle().fill(Palette.accent).frame(width: 10, height: 10).accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Trip to \(trip.label)").font(.subheadline.weight(.semibold))
                        HStack(spacing: 4) {
                            Text(trip.journey.rids.count > 1 ? "Map shows only these routes" : "Map shows only this route")
                                .font(.caption).foregroundStyle(Palette.text2)
                            ForEach(trip.journey.rids, id: \.self) { RouteChip(route: model.route($0), rid: $0, size: 11) }
                        }
                    }
                    Spacer()
                    Button("End trip") { model.endTrip() }.secondaryButtonStyle(destructive: true)
                }
                .padding(.vertical, 8)
                .accessibilityElement(children: .contain)
                .accessibilityLabel("Trip in progress")
            }
        }
    }
}

/// One ranked option: what it minimizes, total, arrival, leg summary, walk + leave lines; expanded steps + Start
/// when selected.
struct OptionCard: View {
    @Environment(AppModel.self) private var model
    let option: TripOption
    let index: Int
    let showCriteria: Bool
    let selected: Bool

    var body: some View {
        let crit = showCriteria ? Rank.criteriaText(option.meets) : ""
        let lines = TripInfo.optionLines(option, now: model.now)
        VStack(alignment: .leading, spacing: 6) {
            Button { model.selectOption(index) } label: {
                VStack(alignment: .leading, spacing: 6) {
                    if !crit.isEmpty {
                        Text(crit).font(.caption.weight(.bold)).foregroundStyle(Palette.accent)
                            .accessibilityIdentifier("criteria.\(index)")
                    }
                    // large text: the arrival goes under the total instead of breaking inside "6:37 AM"
                    ViewThatFits(in: .horizontal) {
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            total
                            Spacer()
                            arrive
                        }
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(alignment: .firstTextBaseline, spacing: 6) { total }
                            arrive
                        }
                    }
                    summary
                    if let lines {
                        Text(lines.first).font(.caption).foregroundStyle(Palette.text2)
                        Text(lines.second).font(.caption.weight(lines.leaveNow ? .bold : .regular))
                            .foregroundStyle(lines.leaveNow ? Color.primary : Palette.text2)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(TripInfo.optionLabel(option, index: index, criteria: crit, routes: model.staticData.routes, now: model.now))
            .accessibilityAddTraits(selected ? [.isSelected, .isButton] : .isButton)
            if selected {
                Divider()
                StepList(option: option)
                if model.activeTrip == nil, !option.busLegs.isEmpty {
                    Button {
                        model.startTrip(option, label: model.dir.to?.label ?? "destination")
                    } label: { Text("Start").font(.headline).frame(maxWidth: .infinity, minHeight: 44) }
                        .primaryButtonStyle()
                        .accessibilityIdentifier("startTrip")
                    Text("Shows only this trip\u{2019}s routes on the map. Follow the bus stop by stop in Current trip, on the Lock Screen and in the Dynamic Island.")
                        .font(.caption).foregroundStyle(Palette.text2)
                }
            }
        }
        .padding(14)
        .background(Palette.card, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Radius.card, style: .continuous).stroke(selected ? Palette.accent : .clear, lineWidth: 2))
    }

    /// "~10 min est." (the card's headline number).
    @ViewBuilder var total: some View {
        Text("~\(option.totalMin)").font(.title2.weight(.bold)).monospacedDigit()
        Text("min").font(.subheadline).foregroundStyle(Palette.text2)
        EstTag(text: "est.")
    }

    var arrive: some View {
        Text("Arrive \(TimeFmt.clock(option.arrive))").font(.subheadline.weight(.semibold))
    }

    var summary: some View {
        HStack(spacing: 4) {
            ForEach(Array(option.legs.enumerated()), id: \.offset) { item in
                if item.offset > 0 { Image(systemName: "chevron.right").font(.caption2).foregroundStyle(Palette.text3) }
                switch item.element {
                case .walk(let w):
                    HStack(spacing: 1) {
                        Image(systemName: "figure.walk").font(.caption)
                        Text(TripInfo.walkMins(w.min)).font(.caption.weight(.semibold))
                    }
                    .foregroundStyle(Palette.text2)
                case .bus(let b):
                    RouteChip(route: model.route(b.rid), rid: b.rid, size: 12)
                }
            }
        }
        .accessibilityHidden(true)
    }
}

/// Step list for an option (tripinfo.js stepsHTML): the walk to the first stop and to the destination are
/// always shown; stop names and clock times in bold; every derived time tagged.
struct StepList: View {
    @Environment(AppModel.self) private var model
    let option: TripOption
    var body: some View {
        let steps = TripInfo.steps(option, now: model.now, fromLabel: model.dir.from?.label, toLabel: model.dir.to?.label)
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(steps.enumerated()), id: \.offset) { item in
                let s = item.element
                HStack(alignment: .top, spacing: 10) {
                    Group {
                        switch s.kind {
                        case .walk: Image(systemName: "figure.walk").frame(width: 28)
                        case .bus(let rid): RouteChip(route: model.route(rid), rid: rid, size: 11).frame(width: 28)
                        case .arrive: Image(systemName: "mappin.circle.fill").foregroundStyle(.red).frame(width: 28)
                        }
                    }
                    .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(alignment: .firstTextBaseline, spacing: 4) {
                            s.title.reduce(Text("")) { acc, r in acc + (r.bold ? Text(r.text).bold() : Text(r.text)) }
                                .font(.subheadline)
                                .fixedSize(horizontal: false, vertical: true)
                            if let t = s.tag { EstTag(text: t) }
                        }
                        if let sub = s.sub {
                            HStack(alignment: .firstTextBaseline, spacing: 4) {
                                Text(sub).font(.caption).foregroundStyle(Palette.text2).fixedSize(horizontal: false, vertical: true)
                                if let t = s.subTag { EstTag(text: t) }
                            }
                        }
                    }
                }
                .accessibilityElement(children: .combine)
            }
        }
    }
}
