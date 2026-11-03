import SwiftUI
import StraightBussingKit

/// The map's feedback button (owner 2026-11-02; web ui/feedback-button.js, #feedbackBtn): under the locate button, its
/// size and shape, the speech bubble in the accent on the accent tint (never the green live color) with a badge dot.
/// A ping (AppModel `feedbackPing`) = two soft ring pulses on the badge; Reduce Motion: none, the badge stays.
struct FeedbackButton: View {
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        Button { model.showFeedback = true } label: {
            Image(systemName: "text.bubble")
                .font(.title3)
                .foregroundStyle(Palette.accent)
                .frame(width: 44, height: 44)
                .background(Palette.accentBg, in: RoundedRectangle(cornerRadius: Radius.control, style: .continuous))
                .overlay(alignment: .topTrailing) { FeedbackBadge(ping: model.feedbackPing, still: reduceMotion).padding(6) }
                .shadow(color: Palette.shadow.opacity(0.15), radius: 6, y: 2)
        }
        .accessibilityLabel(FeedbackAsk.label)
        .accessibilityHint("Opens a short request for beta feedback")
        .accessibilityIdentifier("feedbackButton")
    }
}

/// The badge dot, ringed in the tint; each change of `ping` plays two soft ring pulses (transform + opacity), unless
/// `still` (Reduce Motion).
struct FeedbackBadge: View {
    let ping: Int
    let still: Bool

    struct Pulse {
        var scale = 1.0
        var opacity = 0.0
    }

    var body: some View {
        Circle()
            .fill(Palette.accent)
            .frame(width: 10, height: 10)
            .background(Circle().stroke(Palette.accentBg, lineWidth: 4))
            .overlay {
                if !still {
                    Circle()
                        .fill(Palette.accent)
                        .keyframeAnimator(initialValue: Pulse(), trigger: ping) { view, v in
                            view.scaleEffect(v.scale).opacity(v.opacity)
                        } keyframes: { _ in
                            KeyframeTrack(\.scale) {
                                CubicKeyframe(3.4, duration: FeedbackAsk.pingS / 2)
                                MoveKeyframe(1)
                                CubicKeyframe(3.4, duration: FeedbackAsk.pingS / 2)
                            }
                            KeyframeTrack(\.opacity) {
                                MoveKeyframe(0.5)
                                LinearKeyframe(0, duration: FeedbackAsk.pingS / 2)
                                MoveKeyframe(0.5)
                                LinearKeyframe(0, duration: FeedbackAsk.pingS / 2)
                            }
                        }
                }
            }
            .accessibilityHidden(true)
    }
}

/// The feedback sheet (web: the panel in the Settings overlay's shell): built like Settings (title, Done), the tinted
/// card with the ask, Send feedback (the form in Safari), the note that the button then disappears, and under it the
/// quieter "I already gave feedback". Either choice removes the map button for good (AppModel `markFeedback`);
/// Settings > Give feedback stays.
struct FeedbackSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack(spacing: 12) {
                            Image(systemName: "text.bubble")
                                .font(.title3)
                                .foregroundStyle(.white)
                                .frame(width: 40, height: 40)
                                .background(Palette.accentFill, in: Circle())
                                .accessibilityHidden(true)
                            Text(FeedbackAsk.lead)
                                .font(.headline)
                                .foregroundStyle(Palette.text)
                        }
                        Text(FeedbackAsk.body)
                            .font(.subheadline)
                            .foregroundStyle(Palette.text2)
                        Button {
                            openURL(SiteLinks.feedback)
                            model.markFeedback(.gave)
                            dismiss()
                            model.showInfo(FeedbackAsk.thanks)
                        } label: {
                            HStack(spacing: 8) {
                                Text(FeedbackAsk.send)
                                Image(systemName: "arrow.up.forward.square").accessibilityHidden(true)
                            }
                            .frame(maxWidth: .infinity)
                        }
                        .primaryButtonStyle()
                        .accessibilityHint("Opens the feedback form in Safari")
                        .accessibilityIdentifier("feedbackSend")
                        Text(FeedbackAsk.gone)
                            .font(.footnote)
                            .foregroundStyle(Palette.text2)
                    }
                    .padding(.vertical, 6)
                    .listRowBackground(Palette.accentBg)
                }
                Section {
                    Button {
                        model.markFeedback(.silenced)
                        dismiss()
                        model.showInfo(FeedbackAsk.silenced)
                    } label: {
                        Text(FeedbackAsk.silence)
                            .font(.subheadline)
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .accessibilityIdentifier("feedbackSilence")
                } footer: {
                    Text(FeedbackAsk.note).foregroundStyle(Palette.text2)
                }
            }
            .tint(Palette.accent)
            .navigationTitle(FeedbackAsk.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() }.accessibilityIdentifier("feedbackDone") }
            }
        }
    }
}
