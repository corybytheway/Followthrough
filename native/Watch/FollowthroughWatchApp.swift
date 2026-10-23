// Created by Cory McCabe
import SwiftUI
import WatchKit

@main struct FollowthroughWatchApp: App {
    @WKApplicationDelegateAdaptor(WatchAppDelegate.self) private var delegate
    var body: some Scene {
        WindowGroup {
            #if DEBUG && targetEnvironment(simulator)
            if WatchPreview.screen == "complication" || WatchPreview.screen == "complication-corner" {
                WatchComplicationPreview(corner: WatchPreview.screen == "complication-corner")
            } else { WatchHomeView() }
            #else
            WatchHomeView()
            #endif
        }
    }
}

final class WatchAppDelegate: NSObject, WKApplicationDelegate {
    func handle(_ backgroundTasks: Set<WKRefreshBackgroundTask>) {
        Task { @MainActor in
            for task in backgroundTasks {
                if let connectivity = task as? WKWatchConnectivityRefreshBackgroundTask {
                    WatchCaptureRelay.shared.handle(connectivity)
                } else { task.setTaskCompletedWithSnapshot(false) }
            }
        }
    }
}
