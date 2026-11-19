// Created by Cory McCabe
import AppIntents
import Foundation
#if os(iOS)
import OSLog
import UIKit
import UserNotifications
#endif

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
final class FollowthroughIOSAppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        center.setNotificationCategories([ControlCaptureNotifications.category])
        return true
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter, willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        let request = notification.request
        if request.content.categoryIdentifier == ControlCaptureNotifications.categoryID ||
            ControlCaptureNotifications.isReceipt(request) {
            return [.banner, .list]
        }
        return []
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse
    ) async {
        let content = response.notification.request.content
        if let target = ControlCaptureNotifications.receiptTarget(in: content) {
            if response.actionIdentifier == ControlCaptureNotifications.openTaskID ||
                response.actionIdentifier == UNNotificationDefaultActionIdentifier {
                WorkspaceStore.shared.openControlCaptureReceipt(target)
            }
            return
        }
        guard content.categoryIdentifier == ControlCaptureNotifications.categoryID else { return }

        let logger = ControlCaptureNotifications.logger
        let receipt: UNMutableNotificationContent
        if response.actionIdentifier == ControlCaptureNotifications.replyID,
           let reply = response as? UNTextInputNotificationResponse {
            logger.notice("Control capture reply received")
            do {
                try await WorkspaceStore.shared.captureFromControl(reply.userText)
                return
            } catch {
                logger.error("Control capture reply failed: \((error as? APIError)?.status ?? 0, privacy: .public)")
                receipt = UNMutableNotificationContent()
                receipt.title = String(localized: "Capture needs attention")
                receipt.body = String(localized: "Open Followthrough to check the capture.")
            }
        } else if let action = ControlCaptureTaskAction(rawValue: response.actionIdentifier),
                  let target = ControlCaptureNotifications.target(in: content),
                  let requestID = content.userInfo[ControlCaptureNotifications.requestKey] as? String,
                  UUID(uuidString: requestID) != nil {
            receipt = await taskActionReceipt(action, target: target, requestID: requestID)
        } else {
            return
        }
        do {
            try await center.add(UNNotificationRequest(
                identifier: ControlCaptureNotifications.receiptID, content: receipt, trigger: nil
            ))
        } catch {
            logger.error("Control capture receipt failed: \((error as NSError).code, privacy: .public)")
        }
    }

    private func taskActionReceipt(
        _ action: ControlCaptureTaskAction, target: ControlCaptureTarget, requestID: String
    ) async -> UNMutableNotificationContent {
        let logger = ControlCaptureNotifications.logger
        let receipt = UNMutableNotificationContent()
        do {
            let synced = try await WorkspaceStore.shared.applyControlCaptureAction(action, target: target, requestID: requestID)
            logger.notice("Up Next action handled, synced: \(synced, privacy: .public)")
            if synced {
                receipt.title = action == .complete ? String(localized: "Task marked complete") : String(localized: "Task postponed")
            } else {
                receipt.title = String(localized: "Task change saved on this device")
                receipt.body = String(localized: "Waiting to sync with Followthrough.")
            }
        } catch {
            logger.notice("Up Next action could not be applied")
            receipt.title = String(localized: "Couldn’t update Up Next")
            receipt.body = String(localized: "Tap Capture Task again to refresh the preview.")
        }
        return receipt
    }
}

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
