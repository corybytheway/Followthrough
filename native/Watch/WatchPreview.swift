// Created by Cory McCabe
#if DEBUG && targetEnvironment(simulator)
import Foundation
import SwiftUI
import WidgetKit

/// Opt-in, fictional UI fixtures for the unpaired Watch simulator.
/// This code is excluded from device and release builds.
enum WatchPreview {
    static var screen: String? {
        let value = ProcessInfo.processInfo.environment["FOLLOWTHROUGH_WATCH_PREVIEW"]
        return ["capture", "tasks", "details", "actions", "saving", "queued", "saved", "multiple", "priorities", "complication", "complication-corner"].contains(value) ? value : nil
    }
    static let workspaceID = String(repeating: "a", count: 64)
    static let taskID = "watch-preview-followthrough"
    static let captureID = "DDDC42CF-D7EB-43BA-8547-9460EEB43346"
    static func result(multiple: Bool = false) -> WatchCaptureResult {
        let tasks = Array(plan.listedTasks.prefix(multiple ? 2 : 1))
        return WatchCaptureResult(id: captureID, workspaceID: workspaceID, tasks: tasks, totalTaskCount: tasks.count)
    }
    static var plan: WatchPlanSnapshot {
        let now = Date.now
        let first = WatchPlanTask(id: taskID, title: "Task Name", project: "FT",
            remainingMinutes: 240, updatedAt: "preview", canComplete: true,
            projectName: "Followthrough", projectColor: "#35EAB1", estimateMinutes: 240,
            priority: screen == "priorities" ? .top : .low, dueDate: "2026-11-02", status: "ready")
        let second = WatchPlanTask(id: "watch-preview-orbit", title: "Make next release", project: "Orbit",
            remainingMinutes: 240, updatedAt: "preview", canComplete: true,
            projectName: "Orbit", projectColor: "#A035EA", estimateMinutes: 240,
            priority: screen == "priorities" ? .high : .medium, dueDate: "2026-11-02", status: "ready")
        let third = WatchPlanTask(id: "watch-preview-board", title: "Fix Focus controls", project: "BM",
            remainingMinutes: 240, updatedAt: "preview", canComplete: true,
            projectName: "The Board Meeting", projectColor: "#3571EA", estimateMinutes: 240,
            priority: .medium, dueDate: "2026-11-02", status: "ready")
        return WatchPlanSnapshot(workspaceID: workspaceID, updatedAt: now,
            blocks: [WatchPlanBlock(task: first, start: now, end: now.addingTimeInterval(3600))],
            tasks: [first, second, third], totalTaskCount: 3)
    }
}

/// Displays the exact extension view in a host app for artwork checks only.
/// Watch-face placement and system accent processing still require face testing.
struct WatchComplicationPreview: View {
    let corner: Bool
    var body: some View {
        VStack(spacing: 18) {
            WatchCaptureComplicationArtwork(circular: !corner, fullColor: true)
                .frame(width: 52, height: 52)
            Text(corner ? "Corner capture" : "Circular capture")
                .font(.footnote).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.black)
    }
}
#endif
