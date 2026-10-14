// Created by Cory McCabe
import AppIntents
import Foundation

struct CaptureTaskIntent: AppIntent {
    static let title: LocalizedStringResource = "Capture a task"
    static let description = IntentDescription("Save a request in Followthrough. It joins your plan when the app next connects.")
    static let openAppWhenRun = true
    @Parameter(title:"What do you need to do?") var request: String
    init() {}
    init(request: String) { self.request = request }
    func perform() async throws -> some IntentResult & ProvidesDialog {
        try SharedStorage.capture(request)
        return .result(dialog:"Saved to Followthrough on this device.")
    }
}
struct FollowthroughShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent:CaptureTaskIntent(),phrases:["Capture a task in \(.applicationName)","Add a task to \(.applicationName)"],shortTitle:"Capture task",systemImageName:"bolt.fill")
    }
}
