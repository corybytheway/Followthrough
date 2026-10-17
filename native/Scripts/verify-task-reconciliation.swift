// Created by Cory McCabe
import Foundation

@main struct VerifyTaskReconciliation {
    struct Failure: Error { let message: String }
    static var checks = 0
    static func expect(_ description: String, _ condition: Bool) throws {
        guard condition else { throw Failure(message: description) }
        checks += 1; print("PASS: " + description)
    }
    static func task() -> FTTask {
        FTTask(id: "test", title: "Original title", projectId: nil, notes: "Original notes", source: "Original request", steps: [], estimateMinutes: 30, remainingMinutes: 30, priority: .medium, status: "ready", dueDate: nil, notBefore: nil, blockers: [], splittable: true, createdAt: "2026-10-01T09:00:00Z", updatedAt: "2026-10-15T09:00:00Z")
    }
    static func edit(_ patch: [String: JSONValue], base: FTTask?) -> PendingMutation {
        var patch = patch; patch["expectedUpdatedAt"] = .string(task().updatedAt)
        return PendingMutation(endpoint: "api/native/workspace", body: ["action": .string("update_task"), "id": .string("test"), "task": .object(patch)], title: "Test", baseTask: base)
    }
    static func isReview(_ resolution: TaskEditReconciliation.Resolution) -> Bool {
        if case .review = resolution { return true }; return false
    }
    static func main() throws {
        let base = task()
        let patch: [String: JSONValue] = ["title": .string("Edited title"), "notes": .string(base.notes), "projectId": .null, "expectedUpdatedAt": .string(base.updatedAt)]
        try expect("Editor sends only changed fields", TaskEditReconciliation.changedFields(patch, from: base) == ["title": .string("Edited title")])
        var latest = base; latest.notes = "Notes from another device"; latest.updatedAt = "2026-10-15T09:01:00Z"
        let operation = edit(["title": .string("Edited title")], base: base)
        if case .retry(let retry) = TaskEditReconciliation.resolve(operation, latest: latest) {
            try expect("Nonoverlapping edit is safely rebased", TaskEditReconciliation.patch(retry) == ["title": .string("Edited title")])
            try expect("Retry preserves request ID and creation date", retry.id == operation.id && retry.createdAt == operation.createdAt)
            guard case .object(let body) = retry.body["task"] else { throw Failure(message: "Missing task patch") }
            try expect("Retry checks exact reviewed server version", body["expectedUpdatedAt"] == .string(latest.updatedAt))
            try expect("Rebase preserves remote notes", retry.baseTask?.notes == latest.notes)
        } else { throw Failure(message: "Nonoverlapping edit incorrectly blocked") }
        latest.title = "Conflicting remote title"
        try expect("Same-field conflict remains protected", isReview(TaskEditReconciliation.resolve(operation, latest: latest)))
        latest.title = "Edited title"
        if case .alreadyApplied = TaskEditReconciliation.resolve(operation, latest: latest) { try expect("Already applied edit clears without resending", true) }
        else { throw Failure(message: "Already applied edit not recognized") }
        let legacy = edit(["status": .string("done")], base: nil)
        latest = base; latest.status = "done"; latest.completedAt = "2026-10-15T09:01:00Z"
        if case .alreadyApplied = TaskEditReconciliation.resolve(legacy, latest: latest) { try expect("Legacy duplicate completion can safely drain", true) }
        else { throw Failure(message: "Legacy completion not recognized") }
        latest = base; latest.notes = "Changed remotely"
        try expect("Unknown legacy baseline requires explicit review", isReview(TaskEditReconciliation.resolve(legacy, latest: latest)))
        latest.deletedAt = "2026-10-15T09:01:00Z"
        try expect("A deleted task cannot be silently changed", isReview(TaskEditReconciliation.resolve(operation, latest: latest)))
        latest = base; latest.status = "archived"
        try expect("An archived task cannot be silently changed", isReview(TaskEditReconciliation.resolve(operation, latest: latest)))
        latest = base; latest.status = "done"
        try expect("Remote completion protects an unrelated stale edit", isReview(TaskEditReconciliation.resolve(operation, latest: latest)))
        latest = base; latest.id = "different"
        try expect("A different task is never rebased", isReview(TaskEditReconciliation.resolve(operation, latest: latest)))
        let oldData = try JSONEncoder().encode(legacy)
        let decoded = try JSONDecoder().decode(PendingMutation.self, from: oldData)
        try expect("Old outbox without a baseline decodes", decoded.baseTask == nil && decoded.id == legacy.id)
        let newDecoded = try JSONDecoder().decode(PendingMutation.self, from: JSONEncoder().encode(operation))
        try expect("New outbox persists its baseline", newDecoded.baseTask == base)
        latest = base; latest.projectId = "remote-project"; latest.updatedAt = "2026-10-15T09:02:00Z"
        let assign = edit(["projectId": .string("saved-project")], base: base)
        try expect("Competing project assignment requires review", isReview(TaskEditReconciliation.resolve(assign, latest: latest)))
        let notes = edit(["notes": .string("New notes")], base: base)
        if case .retry(let retry) = TaskEditReconciliation.resolve(notes, latest: latest) { try expect("Unrelated project assignment is preserved", retry.baseTask?.projectId == "remote-project") }
        else { throw Failure(message: "Unrelated project assignment blocked notes") }
        var confirmed = base; confirmed.notes = "First local edit"; confirmed.title = "Unrelated remote title"; confirmed.updatedAt = "2026-10-15T09:03:00Z"
        let first = edit(["notes": .string("First local edit")], base: base)
        let second = edit(["notes": .string("Second local edit")], base: base)
        let advanced = TaskEditReconciliation.advance(second, after: first, confirmed: confirmed)
        try expect("Own acknowledged edit advances later local baseline", advanced.baseTask?.notes == "First local edit")
        try expect("Advancing local baseline does not adopt unrelated remote fields", advanced.baseTask?.title == base.title)
        if case .retry = TaskEditReconciliation.resolve(advanced, latest: confirmed) { try expect("Rapid successive local changes do not falsely conflict", true) }
        else { throw Failure(message: "Own sequential edit blocked") }
        let competingTitle = edit(["title": .string("My new title")], base: base)
        let protectedTitle = TaskEditReconciliation.advance(competingTitle, after: first, confirmed: confirmed)
        try expect("Unrelated same-field remote change stays protected after acknowledgment", isReview(TaskEditReconciliation.resolve(protectedTitle, latest: confirmed)))
        let unchangedLegacy = TaskEditReconciliation.advance(legacy, after: first, confirmed: confirmed)
        try expect("Advancement never invents a legacy baseline", unchangedLegacy.baseTask == nil && unchangedLegacy.body == legacy.body)
        print("\(checks) task reconciliation checks passed")
    }
}
