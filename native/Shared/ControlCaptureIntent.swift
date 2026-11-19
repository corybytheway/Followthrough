// Created by Cory McCabe
#if os(iOS)
import AppIntents
import UserNotifications

struct ControlCaptureIntent: AppIntent {
    static let title: LocalizedStringResource = "Capture Task"
    static let authenticationPolicy: IntentAuthenticationPolicy = .requiresLocalDeviceAuthentication
    static let isDiscoverable = false
    static let openAppWhenRun = false

    @available(iOS 26.0, *)
    static var supportedModes: IntentModes { .background }

    @available(iOS 27.0, *)
    static var allowedExecutionTargets: IntentExecutionTargets { .main }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        guard settings.authorizationStatus == .authorized else {
            ControlCaptureNotifications.logger.notice("Control capture needs notification permission")
            return .result(dialog: "Enable Control Center Capture in Followthrough Settings.")
        }

        let content = UNMutableNotificationContent()
        content.title = String(localized: "New Task")
        content.body = String(localized: "Press and hold to enter task details.")
        content.categoryIdentifier = ControlCaptureNotifications.categoryID
        if settings.showPreviewsSetting != .never,
           let preview = ControlCapturePreview.read(),
           let target = try? JSONEncoder().encode(preview.target) {
            content.userInfo = [
                ControlCaptureNotifications.requestKey: UUID().uuidString,
                ControlCaptureNotifications.targetKey: target
            ]
        }
        do {
            try await center.add(UNNotificationRequest(
                identifier: ControlCaptureNotifications.promptID, content: content, trigger: nil
            ))
            ControlCaptureNotifications.logger.notice("Control capture prompt scheduled")
        } catch {
            ControlCaptureNotifications.logger.error("Control capture notification failed: \((error as NSError).code, privacy: .public)")
            throw error
        }
        return .result(dialog: "Press and hold the Followthrough notification to enter a task.")
    }
}
#endif
