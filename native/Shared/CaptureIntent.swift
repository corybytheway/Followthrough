// Created by Cory McCabe
import AppIntents
import Foundation

struct CaptureTaskIntent: AppIntent {
    static let title: LocalizedStringResource = "Capture a task"
    static let description = IntentDescription("Save a request to your signed-in Followthrough workspace without opening the app.")
    static let openAppWhenRun = false
    @available(iOS 26.0, macOS 26.0, watchOS 26.0, *)
    static var supportedModes: IntentModes { .background }
    @Parameter(title: "What do you need to do?", requestValueDialog: "What do you need to do?") var request: String
    init() {}
    init(request: String) { self.request = request }

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        #if os(watchOS)
        try await WatchCaptureRelay.shared.capture(request)
        return .result(dialog: "Saved on your Watch. It will sync through your iPhone.")
        #else
        let count = try await WorkspaceStore.shared.captureFromShortcut(request)
        if let count {
            let dialog: IntentDialog = count == 1 ? "1 task added to Followthrough." : "\(count) tasks added to Followthrough."
            return .result(dialog: dialog)
        }
        return .result(dialog: "Saved on this device; waiting to sync with Followthrough.")
        #endif
    }
}

struct FollowthroughShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: CaptureTaskIntent(), phrases: ["Capture a task in \(.applicationName)", "Add a task to \(.applicationName)"], shortTitle: "Capture task", systemImageName: "bolt.fill")
    }
}

#if os(iOS)
// Keep previously saved copies working; input is now supplied by Shortcuts.
struct TalkOrTypeTaskIntent: AppIntent {
    static let title: LocalizedStringResource = "Talk or type a task"
    static let description = IntentDescription("Enter your task in Shortcuts, then save it to Followthrough in the background.")
    static let isDiscoverable = false
    static let openAppWhenRun = false
    @available(iOS 26.0, *)
    static var supportedModes: IntentModes { .background }
    @Parameter(title: "What do you need to do?", requestValueDialog: "What do you need to do?") var request: String

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        try await CaptureTaskIntent(request: request).perform()
    }
}
#endif
