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
            // one forced Live Activity update so the Lock Screen starts from fresh numbers. Back in the app,
            // re-read the notification permission (it may have changed in iOS Settings).
            if phase == .active {
                model.resumePolling()
                model.refreshNotifPermission()
            } else if phase == .background {
                model.flushLiveActivity()
                model.pausePolling()
            }
        }
    }
}
