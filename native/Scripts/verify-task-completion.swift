// Created by Cory McCabe
import Foundation

// Run alongside Models.swift; exercises the projection shared by iPhone and Mac.
@main struct VerifyTaskCompletion {
    struct Failure: Error { let message: String }
    static var checks = 0
    static func expect(_ description: String, _ condition: Bool) throws {
        guard condition else { throw Failure(message: description) }
        checks += 1; print("PASS: " + description)
    }
    static func task(_ id: String = "test") -> FTTask {
        FTTask(id: id, title: id, projectId: "project", notes: "Keep notes", source: "Keep source", steps: [], estimateMinutes: 30, remainingMinutes: 30, priority: .medium, status: "ready", dueDate: nil, notBefore: nil, blockers: [], splittable: true, createdAt: "2026-10-01T09:00:00Z", updatedAt: "2026-10-15T09:00:00Z")
    }
    static func edit(_ task: FTTask, status: String, at seconds: TimeInterval = 1_760_520_000) -> PendingMutation {
        PendingMutation(endpoint: "api/native/workspace", body: ["action": .string("update_task"), "id": .string(task.id), "task": .object(["status": .string(status), "expectedUpdatedAt": .string(task.updatedAt)])], title: task.title, createdAt: Date(timeIntervalSince1970: seconds), baseTask: task)
    }
    static func workspace(_ tasks: [FTTask], blocks: [FTBlock] = []) -> Workspace {
        Workspace(projects: [FTProject(id: "project", name: "Test project", aliases: [], description: "Keep description", color: "#f3cc25")], tasks: tasks, busy: [], blocks: blocks, settings: FTSettings(timeZone: "America/Chicago", workStart: "09:00", workEnd: "17:00", workDays: [1,2,3,4,5], maxBlockMinutes: 120, breakEveryMinutes: 120, breakMinutes: 15), plannedAt: nil, currentDate: "2026-10-15", revision: 1, warnings: [])
    }
    static func main() throws {
        let original = task(), completion = edit(task(), status: "done")
        let queued = TaskCompletionPresentation.task(original, operations: [completion], blocked: nil)
        try expect("Persisted completion is visible before the response", queued.status == "done" && queued.completedAt != nil)
        try expect("Projection never mutates the server baseline", original.status == "ready" && original.completedAt == nil && original.updatedAt == "2026-10-15T09:00:00Z")
        try expect("Completion leaves task details untouched", queued.title == original.title && queued.notes == original.notes && queued.source == original.source && queued.remainingMinutes == original.remainingMinutes && queued.projectId == original.projectId)
        let reopening = edit(queued, status: "ready", at: 1_760_520_001)
        let reopened = TaskCompletionPresentation.task(original, operations: [completion, reopening], blocked: nil)
        try expect("Later reopen wins and clears completion time", reopened.status == "ready" && reopened.completedAt == nil)
        let recompletion = edit(reopened, status: "done", at: 1_760_520_002)
        try expect("An immediate repeated completion is deduplicated", TaskEditReconciliation.isLatestQueuedPatch(["status": .string("done")], taskID: original.id, operations: [completion]))
        try expect("An intervening reopen permits a new intentional completion", !TaskEditReconciliation.isLatestQueuedPatch(["status": .string("done")], taskID: original.id, operations: [completion, reopening]))
        try expect("An intervening completion permits another intentional reopen", !TaskEditReconciliation.isLatestQueuedPatch(["status": .string("ready")], taskID: original.id, operations: [completion, reopening, recompletion]))
        try expect("Other tasks do not break same-task duplicate detection", TaskEditReconciliation.isLatestQueuedPatch(["status": .string("done")], taskID: original.id, operations: [completion, edit(task("other"), status: "ready")]))
        let completedAgain = TaskCompletionPresentation.task(original, operations: [completion, reopening, recompletion], blocked: nil)
        try expect("Recompletion receives the newer completion time", completedAgain.completedAt != queued.completedAt && completedAgain.status == "done")
        let blocked = TaskCompletionPresentation.task(original, operations: [completion], blocked: completion)
        try expect("Genuine same-task conflict shows the authoritative state", blocked == original)
        let other = edit(task("other"), status: "done")
        try expect("Unrelated blocked edit does not hide this saved completion", TaskCompletionPresentation.task(original, operations: [completion], blocked: other).status == "done")
        var deleted = original; deleted.deletedAt = "2026-10-15T10:00:00Z"
        try expect("Pending status cannot revive a deleted task", TaskCompletionPresentation.task(deleted, operations: [completion], blocked: nil) == deleted)
        var archived = original; archived.status = "archived"
        try expect("Pending status cannot revive an archived task", TaskCompletionPresentation.task(archived, operations: [completion], blocked: nil) == archived)
        var unrelated = completion; unrelated.endpoint = "api/another-route"
        try expect("Other endpoints cannot change completion presentation", TaskCompletionPresentation.task(original, operations: [unrelated], blocked: nil) == original)
        var details = completion; details.body["task"] = .object(["notes": .string("Waiting notes")])
        try expect("Unrelated pending fields do not imply completion", TaskCompletionPresentation.task(original, operations: [details], blocked: nil) == original)
        var acknowledged = queued; acknowledged.completedAt = "2026-10-15T10:30:00Z"
        try expect("Already-acknowledged completion retains its server time", TaskCompletionPresentation.task(acknowledged, operations: [completion], blocked: nil).completedAt == acknowledged.completedAt)
        let block = FTBlock(id: "block", taskId: original.id, start: "2026-10-15T15:00:00Z", end: "2026-10-15T15:30:00Z")
        let feedback = TaskCompletionFeedback(before: original, status: "done", blocks: [block])
        let fresh = workspace([acknowledged, task("outstanding")])
        let held = TaskCompletionPresentation.workspace(fresh, operations: [], blocked: nil, feedback: [original.id: feedback])
        try expect("Fast acknowledgment holds the row while the check is shown", held.tasks.first?.status == "ready" && held.tasks.first?.completedAt == nil)
        try expect("Fast acknowledgment holds the original schedule block briefly", held.blocks == [block])
        let released = TaskCompletionPresentation.workspace(fresh, operations: [], blocked: nil, feedback: [:])
        try expect("After acknowledgment the row leaves outstanding and its block exits", released.tasksForList(includeCompleted: false).map(\.id) == ["outstanding"] && released.blocks.isEmpty)
        let offline = TaskCompletionPresentation.workspace(workspace([original, task("outstanding")], blocks: [block]), operations: [completion], blocked: nil, feedback: [:])
        try expect("Offline completion stays completed after visual feedback expires", offline.tasks.first?.status == "done" && offline.blocks.isEmpty)
        let restoredOperation = try JSONDecoder().decode(PendingMutation.self, from: JSONEncoder().encode(completion))
        try expect("Relaunch reconstructs completion from the durable outbox", TaskCompletionPresentation.workspace(workspace([original]), operations: [restoredOperation], blocked: nil, feedback: [:]).tasks.first?.status == "done")
        var legacy = completion; legacy.baseTask = nil
        try expect("Legacy pending completion is still visible without invented baseline", TaskCompletionPresentation.task(original, operations: [legacy], blocked: nil).status == "done" && legacy.baseTask == nil)
        let withBlock = TaskCompletionPresentation.workspace(workspace([original], blocks: [block]), operations: [completion], blocked: nil, feedback: [original.id: feedback])
        try expect("Check acknowledgment never duplicates calendar blocks", withBlock.blocks == [block])
        let conflicted = TaskCompletionPresentation.workspace(fresh, operations: [completion], blocked: completion, feedback: [original.id: feedback])
        try expect("Conflict cancels the temporary hold and block restoration", conflicted.tasks.first == acknowledged && conflicted.blocks.isEmpty)
        let moreRecent = edit(task("newer"), status: "done", at: 1_760_520_005)
        let sorted = TaskCompletionPresentation.workspace(workspace([original, task("newer"), task("outstanding")]), operations: [completion, moreRecent], blocked: nil, feedback: [:])
        try expect("Outstanding first then newest completion applies offline too", sorted.tasksForList(includeCompleted: true).map(\.id) == ["outstanding", "newer", "test"])
        try expect("Project and settings data are unchanged", held.projects == fresh.projects && held.settings == fresh.settings && held.busy == fresh.busy && held.revision == fresh.revision)
        print("\(checks) task completion checks passed")
    }
}
