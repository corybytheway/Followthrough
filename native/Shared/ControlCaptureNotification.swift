// Created by Cory McCabe
#if os(iOS)
import CryptoKit
import Foundation
import OSLog
import UserNotifications

struct ControlCaptureTarget: Codable, Equatable {
    let workspaceID: String
    let taskID: String
    let updatedAt: String
}

enum ControlCaptureTaskAction: String, Codable {
    case complete = "followthrough.capture.complete"
    case postpone = "followthrough.capture.postpone"

    var notificationAction: UNNotificationAction {
        switch self {
        case .complete:
            UNNotificationAction(
                identifier: rawValue, title: String(localized: "Mark Complete"),
                options: [.authenticationRequired], icon: UNNotificationActionIcon(systemImageName: "checkmark.circle")
            )
        case .postpone:
            UNNotificationAction(
                identifier: rawValue, title: String(localized: "Postpone to Next Workday"),
                options: [.authenticationRequired], icon: UNNotificationActionIcon(systemImageName: "calendar.badge.clock")
            )
        }
    }
}

struct ControlCapturePreview: Codable {
    let target: ControlCaptureTarget
    let title: String
    let projectLabel: String?
    let actions: [ControlCaptureTaskAction]

    private static var url: URL { SharedStorage.directory.appendingPathComponent("control-capture.json") }

    static func read() -> Self? {
        guard let data = try? Data(contentsOf: url),
              let preview = try? JSONDecoder().decode(Self.self, from: data),
              ControlCaptureNotifications.sharedWorkspaceID == preview.target.workspaceID
        else { return nil }
        return preview
    }

    static func publish(_ preview: Self?) {
        guard let preview else {
            try? FileManager.default.removeItem(at: url)
            return
        }
        do {
            // Keep the task title in protected shared storage. The alert itself
            // carries only the reference to the task shown when it was posted.
            try JSONEncoder().encode(preview).write(to: url, options: [.atomic, .completeFileProtection])
        } catch {
            try? FileManager.default.removeItem(at: url)
        }
    }
}

enum ControlCaptureNotifications {
    static let categoryID = "followthrough.capture"
    static let promptID = "followthrough.capture.prompt"
    static let replyID = "followthrough.capture.reply"
    static let receiptID = "followthrough.capture.receipt"
    static let requestKey = "captureRequest"
    static let targetKey = "captureTarget"
    static let logger = Logger(subsystem: "com.ethos.followthrough", category: "ControlCapture")

    static var sharedWorkspaceID: String? {
        guard let identity = try? Data(contentsOf: SharedStorage.directory.appendingPathComponent("identity")) else { return nil }
        return SHA256.hash(data: identity).map { String(format: "%02x", $0) }.joined()
    }

    static var replyAction: UNTextInputNotificationAction {
        UNTextInputNotificationAction(
            identifier: replyID,
            title: String(localized: "Capture Task"),
            options: [.authenticationRequired],
            icon: UNNotificationActionIcon(systemImageName: "square.and.pencil"),
            textInputButtonTitle: String(localized: "Save Task"),
            textInputPlaceholder: String(localized: "What do you need to do?")
        )
    }

    static var category: UNNotificationCategory {
        UNNotificationCategory(identifier: categoryID, actions: [replyAction], intentIdentifiers: [])
    }

    static func target(in content: UNNotificationContent) -> ControlCaptureTarget? {
        guard let data = content.userInfo[targetKey] as? Data else { return nil }
        return try? JSONDecoder().decode(ControlCaptureTarget.self, from: data)
    }
}
#endif
