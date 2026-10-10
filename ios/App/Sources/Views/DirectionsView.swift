import SwiftUI
import StraightBussingKit

/// Directions (ui/views/directions.js): Start / Destination with station + place suggestions (on-device first,
/// Photon only when fewer than 5 local matches, spelling-fix note), swap, up to 4 option cards ranked least walking
/// > earliest arrival > shortest wait with "what it minimizes", walk + leave guidance lines, steps for the selected
/// card, Start (trip progress + Live Activity). While a trip is on, a trip bar heads the results and picking
/// another card makes the timeline follow it; changing an endpoint ends the trip.
struct DirectionsView: View {
    @Environment(AppModel.self) private var model
    enum Field: Hashable { case from, to }
    @FocusState private var focus: Field?
    /// Typed text stays in this view: keystrokes never touch AppModel, so the map and the rest of the UI
    /// don't redraw while typing.
    @State private var fromText = ""
    @State private var toText = ""
    @State private var items: [Endpoint] = []
    @State private var places = PlaceUI()
    @State private var itemsQuery: String?

    struct SuggestionKey: Equatable {
        var field: Field?
        var text: String
        var exact: Bool
    }

    var query: String { focus == .from ? fromText : focus == .to ? toText : "" }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                Card {
                    HStack(spacing: 8) {
                        VStack(spacing: 0) {
                            field(.from, text: $fromText, placeholder: "Start", pin: .green)
                            Divider().padding(.leading, 28)
                            field(.to, text: $toText, placeholder: "Destination", pin: .red)
                        }
                        Button { model.swapEndpoints(); syncTexts() } label: {
                            Image(systemName: "arrow.up.arrow.down").font(.body.weight(.semibold)).tapTarget()
                        }
                        .accessibilityLabel("Swap start and destination")
                    }
                }
                if let f = focus { suggestions(for: f) } else { results }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
        }
        .onAppear {
            syncTexts()
            if let q = model.demoQuery { model.demoQuery = nil; toText = q; focus = .to }
            else if model.dir.to == nil { focus = .to } else if model.dir.from == nil { focus = .from }
        }
        .onChange(of: model.dir.from) { _, e in fromText = e?.label ?? "" }
        .onChange(of: model.dir.to) { _, e in toText = e?.label ?? "" }
        .onChange(of: focus) { _, f in if let f { model.dirActiveTo = f == .to; places.exact = false; places.fix = nil } }
        .task(id: SuggestionKey(field: focus, text: query, exact: places.exact)) { await loadSuggestions() }
    }

    func syncTexts() {
        fromText = model.dir.from?.label ?? ""
        toText = model.dir.to?.label ?? ""
    }

    /// On-device suggestions right away; Photon merged in when it answers (only if the index has < 5 matches).
    func loadSuggestions() async {
        guard focus != nil else { return }
        let q = query, user = model.user, S = model.staticData
        // one "use my location" action per screen (web DESIGN "Copy"): with no start yet, the Start field offers it
        let dropMe = focus == .to && model.dir.from == nil && user == nil
        func sugs(_ places: [PlaceHit], _ assumed: SearchAssumption?) -> [Endpoint] {
            let all = AppModel.suggestions(q, user: user, staticData: S, places: places, assumed: assumed)
            return dropMe ? all.filter { !$0.isMe } : all
        }
        if itemsQuery != nil { try? await Task.sleep(nanoseconds: 60_000_000) }   // typing: coalesce a burst of keystrokes
        guard !Task.isCancelled else { return }
        await PlaceSearchFlow.run(q, exact: places.exact, model: model, update: { st in
            places = st
            items = sugs(st.items, st.assumed)
            itemsQuery = q
        }, current: { places })
        if PlaceIndex.norm(q).count < 2 && !Task.isCancelled {
            items = sugs([], nil)
            itemsQuery = q
        }
    }

    func field(_ f: Field, text: Binding<String>, placeholder: String, pin: Color) -> some View {
        HStack(spacing: 10) {
            Circle().fill(pin).frame(width: 10, height: 10).accessibilityHidden(true)
            TextField(placeholder, text: text)
                .focused($focus, equals: f)
                .submitLabel(.search)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .frame(minHeight: 44)
                .onSubmit { if let first = items.first { choose(first, for: f) } }
                .accessibilityLabel("\(placeholder): station or place")
                .accessibilityIdentifier(f == .from ? "dirFrom" : "dirTo")
            if !text.wrappedValue.isEmpty && focus == f {
                Button { text.wrappedValue = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary).tapTarget() }
                    .accessibilityLabel("Clear")
            }
        }
    }

    func choose(_ e: Endpoint, for f: Field) {
        if e.isMe {
            model.useMyLocation(to: f == .to)
        } else {
            model.setEndpoint(f == .from ? \DirectionsState.from : \DirectionsState.to, e)
        }
        syncTexts()
        focus = nil
    }

    @ViewBuilder func suggestions(for f: Field) -> some View {
        let q = (f == .from ? fromText : toText).trimmingCharacters(in: .whitespaces)
        let mine = q.count >= 2 && places.q == q
        if mine { AssumeNote(state: places) { on in places.fix = on ? places.assumed : nil; places.exact = on } }
        if !items.isEmpty {
            Card {
                ForEach(Array(items.enumerated()), id: \.offset) { item in
                    if item.offset > 0 { Divider() }
                    Button { choose(item.element, for: f) } label: {
                        HStack(spacing: 10) {
                            Image(systemName: item.element.isMe ? "location.fill" : item.element.stopId != nil ? "bus" : "mappin")
                                .frame(width: 22).foregroundStyle(.secondary).accessibilityHidden(true)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(item.element.label).foregroundStyle(.primary).lineLimit(1)
                                Text(model.placeSubtitle(item.element)).font(.caption).foregroundStyle(.secondary).lineLimit(2)
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
        if mine && places.status == .busy {
            Hint(items.contains { $0.stopId == nil && !$0.isMe } ? "Searching more places\u{2026}" : "Searching places\u{2026}")
        }
        if mine && places.status == .err { Hint("Couldn\u{2019}t search places right now. Station names still work.") }
        if items.isEmpty && (q.count >= 2 && itemsQuery == q) && places.status == .idle {
            Hint("No stations or places match. Try another name or an address.")
        }
        if model.dirMeDenied { Hint("Location is off. Allow it in iOS Settings, or type a start.") }
        if q.count >= 2 { PhotonNote() }
    }

    @ViewBuilder var results: some View {
        if model.dir.from == nil || model.dir.to == nil {
            Hint("Choose a start and a destination. Type a station name, a place, or an address.")
            if model.dir.from == nil && model.user == nil {
                Button { model.useMyLocation(to: false) } label: {
                    Label("Start from my location", systemImage: "location.fill").frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.bordered)
            }
        } else if let r = model.dir.result {
            TripBar()
            if model.staleLevel != .fresh {
                Text("Live data delayed. Bus times may be off.").font(.subheadline.weight(.semibold)).foregroundStyle(.orange)
            }
            if r.options.isEmpty {
                let running = !model.buses.isEmpty
                if model.liveOutage {   // a feed outage is not "no shuttles running" (rider safety)
                    EmptyStateView(title: "Can't plan shuttle trips right now",
                                   message: "The live shuttle feed can't be reached, so we can't tell which buses are running.", showOfficial: true)
                } else {
                    let idle: String = (model.silentService ? model.silentText() : nil) ?? "No shuttles are running right now."
                    EmptyStateView(title: "No practical shuttle route right now",
                                   message: r.missedAll ? "The next buses leave before you could reach the stop."
                                       : running ? "Nothing runs close enough to both places." : idle,
                                   showOfficial: !running)
                }
                walkOnlyCard(r)
                refiningNote
            } else {
                ForEach(Array(r.options.prefix(Planner.maxOpts).enumerated()), id: \.element.key) { item in
                    OptionCard(option: item.element, index: item.offset, showCriteria: r.options.count > 1,
                               selected: item.offset == model.dir.selected)
                }
                Text("Walking the whole way: \(TripInfo.mins(r.walkOnlyMin)) min (\(r.walkOnlyM) m), \(walkSourceText(r))")
                    .font(.footnote).foregroundStyle(.secondary)
                refiningNote
                Text("Bus times are estimates from schedules and live predictions. They will get more accurate as we collect more ride data.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        } else {
            HStack(spacing: 8) {
                ProgressView()
                Text("Finding trips\u{2026}").font(.subheadline).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, minHeight: 44)
        }
    }

    /// Where walking times come from (web directions.js walkTag): Apple Maps sidewalks or the straight line.
    func walkSourceText(_ r: PlanResult) -> String { r.walkOnlySource == .router ? "sidewalk route" : "estimate" }

    /// Shown while Apple Maps walking routes replace the straight-line estimates.
    @ViewBuilder var refiningNote: some View {
        if model.dir.refining {
            Text("Checking sidewalk routes\u{2026}").font(.footnote).foregroundStyle(.secondary)
                .accessibilityIdentifier("dirRefining")
        }
    }

    /// Walk-only fallback (directions.js): minutes + source tag, arrival clock, "Walk the whole way", meters.
    func walkOnlyCard(_ r: PlanResult) -> some View {
        Card {
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text("\(TripInfo.mins(r.walkOnlyMin))").font(.title2.weight(.bold)).monospacedDigit()
                    Text("min").font(.subheadline).foregroundStyle(.secondary)
                    EstTag(text: walkSourceText(r))
                    Spacer()
                    Text("Arrive \(TimeFmt.clock(model.now + r.walkOnlyMin * 60))").font(.subheadline.weight(.semibold))
                }
                HStack {
                    Label("Walk the whole way", systemImage: "figure.walk").font(.subheadline.weight(.semibold))
                    Spacer()
                    Text("\(r.walkOnlyM) m").font(.subheadline).foregroundStyle(.secondary)
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
                    Circle().fill(.green).frame(width: 10, height: 10).accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Trip to \(trip.label)").font(.subheadline.weight(.semibold))
                        HStack(spacing: 4) {
                            Text(trip.journey.rids.count > 1 ? "Map shows only these routes" : "Map shows only this route")
                                .font(.caption).foregroundStyle(.secondary)
                            ForEach(trip.journey.rids, id: \.self) { RouteChip(route: model.route($0), rid: $0, size: 11) }
                        }
                    }
                    Spacer()
                    Button("End trip") { model.endTrip() }.buttonStyle(.bordered).frame(minHeight: 44)
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
                        Text(crit).font(.caption.weight(.bold)).foregroundStyle(Color.accentColor)
                            .accessibilityIdentifier("criteria.\(index)")
                    }
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text("~\(option.totalMin)").font(.title2.weight(.bold)).monospacedDigit()
                        Text("min").font(.subheadline).foregroundStyle(.secondary)
                        EstTag(text: "est.")
                        Spacer()
                        Text("Arrive \(TimeFmt.clock(option.arrive))").font(.subheadline.weight(.semibold))
                    }
                    summary
                    if let lines {
                        Text(lines.first).font(.caption).foregroundStyle(.secondary)
                        Text(lines.second).font(.caption.weight(lines.leaveNow ? .bold : .regular))
                            .foregroundStyle(lines.leaveNow ? Color.primary : Color.secondary)
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
                        .buttonStyle(.borderedProminent)
                        .accessibilityIdentifier("startTrip")
                    Text("Shows only this trip\u{2019}s routes on the map. Follow the bus stop by stop in Current trip, on the Lock Screen and in the Dynamic Island.")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .padding(14)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(selected ? Color.accentColor : .clear, lineWidth: 2))
    }

    var summary: some View {
        HStack(spacing: 4) {
            ForEach(Array(option.legs.enumerated()), id: \.offset) { item in
                if item.offset > 0 { Image(systemName: "chevron.right").font(.caption2).foregroundStyle(.tertiary) }
                switch item.element {
                case .walk(let w):
                    HStack(spacing: 1) {
                        Image(systemName: "figure.walk").font(.caption)
                        Text(TripInfo.walkMins(w.min)).font(.caption.weight(.semibold))
                    }
                    .foregroundStyle(.secondary)
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
                                Text(sub).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
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
