// Created by Cory McCabe
import Foundation

// Compile alongside the shared model so this checks the ordering used by both apps:
// xcrun swiftc native/Shared/Models.swift native/Scripts/verify-task-order.swift -o /tmp/followthrough-task-order
@main
struct VerifyTaskOrder {
    struct Failure: Error, CustomStringConvertible {
        let description: String
    }

    static func task(
        _ id: String,
        priority: Priority = .medium,
        status: String = "ready",
        created: String = "2026-10-01T09:00:00Z",
        updated: String = "2026-10-01T09:00:00Z",
        completed: String? = nil,
        deleted: String? = nil,
        due: String? = nil
    ) -> FTTask {
        FTTask(
            id: id, title: id, projectId: nil, notes: "", source: "",
            steps: [], estimateMinutes: 30, remainingMinutes: status == "done" ? 0 : 30,
            priority: priority, status: status, dueDate: due, notBefore: nil,
            blockers: [], splittable: true, createdAt: created, updatedAt: updated,
            completedAt: completed, deletedAt: deleted, estimateProvisional: false
        )
    }

    static func workspace(_ tasks: [FTTask]) -> Workspace {
        Workspace(
            projects: [], tasks: tasks, busy: [], blocks: [],
            settings: FTSettings(
                timeZone: "America/Chicago", workStart: "09:00", workEnd: "17:00",
                workDays: [1, 2, 3, 4, 5], maxBlockMinutes: 120,
                breakEveryMinutes: 120, breakMinutes: 15
            ),
            plannedAt: nil, currentDate: "2026-10-15", revision: 1, warnings: []
        )
    }

    static func expect(
        _ label: String, _ tasks: [FTTask], _ expected: [String],
        includeCompleted: Bool = true
    ) throws {
        let actual = workspace(tasks).tasksForList(includeCompleted: includeCompleted).map(\.id)
        guard actual == expected else {
            throw Failure(description: "\(label): expected \(expected), received \(actual)")
        }
        print("PASS: \(label)")
    }

    static func main() throws {
        let outstanding = task("outstanding-low", priority: .low)
        let earlier = task(
            "completed-earlier-top", priority: .top, status: "done",
            created: "2026-10-14T10:00:00Z", updated: "2026-10-16T12:00:00Z",
            completed: "2026-10-14T11:00:00Z"
        )
        let recent = task(
            "completed-recent-low", priority: .low, status: "done",
            created: "2026-09-01T09:00:00Z", updated: "2026-10-15T11:00:00Z",
            completed: "2026-10-15T11:00:00Z"
        )
        try expect(
            "Outstanding tasks precede every completed task regardless of priority",
            [earlier, recent, outstanding],
            [outstanding.id, recent.id, earlier.id]
        )
        try expect(
            "Show completed off hides completed tasks",
            [earlier, outstanding, recent], [outstanding.id], includeCompleted: false
        )
        try expect(
            "Completion time wins over creation time and later edits",
            [earlier, recent], [recent.id, earlier.id]
        )

        let activeAlpha = task("active-alpha", priority: .top, created: "2026-10-01T09:00:00Z")
        let activeZulu = task("active-zulu", priority: .top, created: "2026-10-01T09:00:00Z")
        let activeNewer = task("active-newer", priority: .top, created: "2026-10-02T09:00:00Z")
        let activeHigh = task("active-high", priority: .high, due: "2026-09-01")
        try expect(
            "Outstanding priority, ascending creation, and ID order is preserved",
            [activeHigh, activeZulu, activeNewer, activeAlpha, outstanding],
            [activeAlpha.id, activeZulu.id, activeNewer.id, activeHigh.id, outstanding.id]
        )

        let legacyMissing = task(
            "legacy-missing", status: "done", updated: "2026-10-14T12:00:00Z"
        )
        let legacyEmpty = task(
            "legacy-empty", status: "done", updated: "2026-10-15T12:00:00Z", completed: ""
        )
        let legacyCreated = task(
            "legacy-created", status: "done", created: "2026-10-13T12:00:00Z",
            updated: "", completed: ""
        )
        try expect(
            "Legacy completions fall back to update time then creation time",
            [legacyCreated, legacyMissing, legacyEmpty],
            [legacyEmpty.id, legacyMissing.id, legacyCreated.id]
        )

        let tieAlpha = task(
            "tie-alpha", status: "done", created: "2026-10-03T09:00:00Z",
            completed: "2026-10-15T12:00:00Z"
        )
        let tieZulu = task(
            "tie-zulu", status: "done", created: "2026-10-03T09:00:00Z",
            completed: "2026-10-15T12:00:00Z"
        )
        let tieOlder = task(
            "tie-older", status: "done", created: "2026-10-01T09:00:00Z",
            completed: "2026-10-15T12:00:00Z"
        )
        let tied = [tieOlder, tieZulu, tieAlpha]
        for offset in tied.indices {
            let permutation = Array(tied[offset...] + tied[..<offset])
            try expect(
                "Equal completion timestamps have stable creation/ID ties (rotation \(offset))",
                permutation, [tieAlpha.id, tieZulu.id, tieOlder.id]
            )
        }

        let deleted = task(
            "deleted-completion", priority: .top, status: "done",
            completed: "2026-10-17T12:00:00Z", deleted: "2026-10-17T13:00:00Z"
        )
        let archived = task("archived", priority: .top, status: "archived")
        let deletedOutstanding = task("deleted-outstanding", priority: .top, deleted: "2026-10-17T13:00:00Z")
        for includeCompleted in [false, true] {
            try expect(
                "Archived and deleted tasks stay hidden (completed \(includeCompleted))",
                [deleted, archived, outstanding, deletedOutstanding], [outstanding.id],
                includeCompleted: includeCompleted
            )
        }

        var reopened = earlier
        reopened.status = "ready"
        reopened.completedAt = nil
        reopened.remainingMinutes = 30
        reopened.updatedAt = "2026-10-16T13:00:00Z"
        try expect(
            "Reopened tasks return to outstanding order",
            [outstanding, recent, reopened], [reopened.id, outstanding.id, recent.id]
        )
        reopened.status = "done"
        reopened.completedAt = "2026-10-16T14:00:00Z"
        reopened.updatedAt = "2026-10-16T14:00:00Z"
        reopened.remainingMinutes = 0
        try expect(
            "Recompleted tasks use their newest completion time",
            [recent, reopened, outstanding], [outstanding.id, reopened.id, recent.id]
        )
        try expect("Empty workspace stays empty", [], [])
        print("Task-list ordering regression checks passed.")
    }
}
