import SwiftUI

/// Straight Bussing: unofficial live campus shuttle tracker (native SwiftUI draft of the web app in web/).
@main
struct StraightBussingApp: App {
    @State private var model = AppModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                // one accent for every action, selection and switch (toggles default to green, which means live data)
                .tint(Palette.accent)
                .preferredColorScheme(model.colorScheme)
                .task { model.start() }
                .onOpenURL { url in
                    // straightbussing://trip (Live Activity tap) opens the trip progress.
                    if url.host == "trip" { model.select(.current) }
                }
        }
        .onChange(of: scenePhase) { _, phase in
            // Never poll in the background: live data is only fetched while the app is open. On the way out,
            // one forced Live Activity update so the Lock Screen starts from fresh numbers. Back in the app, the
            // freshness flags are re-checked at once, then polling resumes; the notification permission is
            // re-read (it may have changed in iOS Settings) and the daily schedule check runs if due.
            if phase == .active {
                model.checkSimulatedOnReturn()   // simulated buses end after a long absence
                model.didBecomeActive()
            } else if phase == .background {
                model.didEnterBackground()
                model.noteBackground()
            }
        }
    }
}
