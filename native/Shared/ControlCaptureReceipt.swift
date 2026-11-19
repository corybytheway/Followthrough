// Created by Cory McCabe
#if os(iOS)
import Foundation
import OSLog
import UserNotifications

struct ControlCaptureReceiptTarget: Codable {
    let workspaceID: String
    let requestID: String
    let taskID: String
}

struct ControlCaptureReceiptTask: Codable {
    let task: FTTask
    let projectName: String?
    let blockers: [String]
    let timeZone: String

    init(task: FTTask, workspace: Workspace) {
        self.task = task
        projectName = workspace.project(task.projectId)?.name
        blockers = task.blockers.compactMap { id in
            workspace.tasks.first { $0.id == id && $0.deletedAt == nil }.map {
                $0.displayTitle(project: workspace.project($0.projectId))
            }
        }
        timeZone = workspace.settings.timeZone
    }
}

struct ControlCaptureReceipt: Codable {
    let workspaceID: String
    let tasks: [ControlCaptureReceiptTask]

    private static var folder: URL { SharedStorage.directory.appendingPathComponent("CaptureReceipts", isDirectory: true) }

    static func details(for target: ControlCaptureReceiptTarget) -> ControlCaptureReceiptTask? {
        guard target.workspaceID == ControlCaptureNotifications.sharedWorkspaceID,
              let id = UUID(uuidString: target.requestID),
              let data = try? Data(contentsOf: file(for: id)),
              let receipt = try? JSONDecoder().decode(Self.self, from: data),
              receipt.workspaceID == target.workspaceID else { return nil }
        return receipt.tasks.first { $0.task.id == target.taskID }
    }

    func write(requestID: UUID) throws {
        try FileManager.default.createDirectory(at: Self.folder, withIntermediateDirectories: true)
        // Sync can finish after the phone relocks. The receipt can be written
        // then, and once closed it can only be read after the next unlock.
        try JSONEncoder().encode(self).write(to: Self.file(for: requestID), options: [.atomic, .completeFileProtectionUnlessOpen])
    }

    static func prune(retaining ids: Set<UUID>) {
        guard let files = try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil) else { return }
        for file in files {
            guard file.pathExtension == "json", let id = UUID(uuidString: file.deletingPathExtension().lastPathComponent),
                  !ids.contains(id) else { continue }
            try? FileManager.default.removeItem(at: file)
        }
    }

    static func clear() {
        try? FileManager.default.removeItem(at: folder)
    }

    private static func file(for id: UUID) -> URL {
        folder.appendingPathComponent(id.uuidString).appendingPathExtension("json")
    }
}

extension ControlCaptureNotifications {
    static let openTaskID = "followthrough.capture.open-task"
    private static let receiptTargetKey = "receiptTarget"
    private static let receiptThreadID = "followthrough.capture.receipts"

    static var openTaskAction: UNNotificationAction {
        UNNotificationAction(
            identifier: openTaskID, title: String(localized: "Open task"),
            options: [.foreground, .authenticationRequired],
            icon: UNNotificationActionIcon(systemImageName: "arrow.up.right")
        )
    }

    static func receiptTarget(in content: UNNotificationContent) -> ControlCaptureReceiptTarget? {
        guard let data = content.userInfo[receiptTargetKey] as? Data else { return nil }
        return try? JSONDecoder().decode(ControlCaptureReceiptTarget.self, from: data)
    }

    static func isReceipt(_ request: UNNotificationRequest) -> Bool {
        request.identifier == receiptID || request.identifier.hasPrefix(receiptID + ".")
    }

    static func showCaptureProblem(requestID: String) {
        let content = UNMutableNotificationContent()
        content.title = String(localized: "Capture needs attention")
        content.body = String(localized: "Open Followthrough to check the capture.")
        content.threadIdentifier = receiptThreadID
        UNUserNotificationCenter.current().add(UNNotificationRequest(
            identifier: savedReceiptID(requestID), content: content, trigger: nil
        ), withCompletionHandler: nil)
    }

    static func removeCaptureStatus(requestID: String) {
        let identifiers = [savedReceiptID(requestID)]
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: identifiers)
        center.removeDeliveredNotifications(withIdentifiers: identifiers)
    }

    @MainActor static func showSavedReceipt(
        requestID: String, workspaceID: String, tasks: [FTTask], workspace: Workspace
    ) async {
        guard let uuid = UUID(uuidString: requestID), !tasks.isEmpty else { return }
        let center = UNUserNotificationCenter.current()
        let delivered = await center.deliveredNotifications().map(\.request)
        guard sharedWorkspaceID == workspaceID else { return }

        let receipt = ControlCaptureReceipt(
            workspaceID: workspaceID,
            tasks: tasks.map { ControlCaptureReceiptTask(task: $0, workspace: workspace) }
        )
        do { try receipt.write(requestID: uuid) }
        catch { logger.error("Could not store the capture receipt preview") }

        let shownIDs = Set(delivered.filter { receiptTarget(in: $0.content) != nil }.map(\.identifier))
        var posted = 0
        for (index, task) in tasks.enumerated() {
            guard sharedWorkspaceID == workspaceID else { return }
            let identifier = savedReceiptID(requestID, index: index)
            guard !shownIDs.contains(identifier) else { continue }
            let content = UNMutableNotificationContent()
            content.title = String(localized: "Task added")
            content.body = String(localized: "Press and hold for details.")
            content.categoryIdentifier = categoryID
            content.threadIdentifier = receiptThreadID
            let target = ControlCaptureReceiptTarget(workspaceID: workspaceID, requestID: requestID, taskID: task.id)
            guard let data = try? JSONEncoder().encode(target) else { continue }
            content.userInfo = [receiptTargetKey: data]
            do {
                try await center.add(UNNotificationRequest(identifier: identifier, content: content, trigger: nil))
                posted += 1
            } catch {
                logger.error("Could not post the capture receipt: \((error as NSError).code, privacy: .public)")
            }
        }
        let retained = Set(delivered.compactMap { request in
            receiptTarget(in: request.content).flatMap { UUID(uuidString: $0.requestID) }
        }).union([uuid])
        ControlCaptureReceipt.prune(retaining: retained)
        logger.notice("Capture receipt notifications posted: \(posted, privacy: .public)")
    }

    private static func savedReceiptID(_ requestID: String, index: Int = 0) -> String {
        "\(receiptID).\(requestID).\(index)"
    }
}
#endif
