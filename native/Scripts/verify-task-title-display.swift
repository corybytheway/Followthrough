// Created by Cory McCabe
import Foundation

// Used by the shared task rows on macOS and iOS. No UI or saved workspace access.
// xcrun swiftc native/Shared/Models.swift native/Scripts/verify-task-title-display.swift -o /tmp/followthrough-task-title-display
@main
struct VerifyTaskTitleDisplay {
    struct Failure: Error { let message: String }
    static func expect(_ actual: String, _ expected: String) throws {
        guard actual == expected else { throw Failure(message: "Expected \(expected), received \(actual)") }
    }
    static func main() throws {
        let project = FTProject(id: "blanc", name: "Blanc Media", shortName: "BM", aliases: ["Shawn Blanc"], description: "Client work", color: "#4465FF")
        var task = FTTask(id: "task", title: "Update workbook", projectId: project.id, notes: "Keep notes", source: "Keep original input",
                          steps: [], estimateMinutes: 30, remainingMinutes: 30, priority: .medium, status: "ready",
                          dueDate: nil, notBefore: nil, blockers: [], splittable: true,
                          createdAt: "2026-10-17T00:00:00Z", updatedAt: "2026-10-17T00:00:00Z", completedAt: nil, deletedAt: nil)
        let original = task
        for _ in 0..<3 {
            // General Tasks -> project -> Today/global search -> project -> Tasks.
            for scope: String? in [nil, project.id, nil, project.id, nil, "other"] {
                try expect(task.displayTitle(project: project, scopedProjectID: scope), scope == project.id ? "Update workbook" : "BM: Update workbook")
            }
        }
        guard task == original else { throw Failure(message: "Rendering changed the task") }
        print("PASS: repeated scoped/unscoped rendering preserves task data")
        for title in ["Update workbook", "BM: Update workbook", "blanc media: Update workbook", "Shawn Blanc: Update workbook", "⚡️ BM: Blanc Media: Shawn Blanc: Update workbook"] {
            task.title = title
            let saved = task
            try expect(task.displayTitle(project: project, scopedProjectID: project.id), "Update workbook")
            guard task == saved else { throw Failure(message: "Rendering changed an imported title") }
        }
        task.title = "Review BM: draft"
        try expect(task.displayTitle(project: project, scopedProjectID: project.id), task.title)
        task.title = "Other: Update workbook"
        try expect(task.displayTitle(project: project, scopedProjectID: project.id), task.title)
        print("PASS: imported labels are hidden only at the start and only for the scoped project")
        var custom = project
        custom.shortName = "Rodeo"
        task.title = "Rodeo: Send quote"
        try expect(task.displayTitle(project: custom, scopedProjectID: project.id), "Send quote")
        custom.shortName = nil
        task.title = "Blanc Media: Send quote"
        try expect(task.displayTitle(project: custom, scopedProjectID: project.id), "Send quote")
        task.title = "Send quote"
        try expect(task.displayTitle(project: custom), "Blanc Media: Send quote")
        task.projectId = nil
        task.title = "Personal: Send quote"
        try expect(task.displayTitle(project: nil, scopedProjectID: project.id), task.title)
        try expect(task.displayTitle(project: project, scopedProjectID: project.id), "BM: Personal: Send quote")
        print("PASS: custom/legacy labels, missing projects, and mismatched scope")
    }
}
