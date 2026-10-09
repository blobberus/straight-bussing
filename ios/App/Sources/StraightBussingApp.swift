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
                .preferredColorScheme(model.colorScheme)
                .task { model.start() }
                .onOpenURL { url in
                    // straightbussing://trip (Live Activity tap) opens the trip progress.
                    if url.host == "trip" { model.select(.current) }
                }
        }
        .onChange(of: scenePhase) { _, phase in
            // Never poll in the background: live data is only fetched while the app is open.
            if phase == .active { model.resumePolling() } else if phase == .background { model.pausePolling() }
        }
    }
}
