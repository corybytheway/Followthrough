// Created by Cory McCabe
import Foundation

@main
struct VerifyCaptureReceipt {
    struct Failure: Error { let message: String }
    static func task(_ id: String, group: String, index: Int) -> FTTask {
        FTTask(id: id, title: id, projectId: nil, notes: "", source: "Original request", steps: [],
               estimateMinutes: 30, remainingMinutes: 30, priority: .medium, status: "ready", dueDate: nil,
               notBefore: nil, blockers: [], splittable: true, createdAt: "2026-10-15T12:00:00Z",
               updatedAt: "2026-10-15T12:00:00Z", completedAt: nil, deletedAt: nil,
               estimateProvisional: false, captureGroupId: group, captureIndex: index)
    }
    static func response(_ tasks: [FTTask], returned: [FTTask]? = nil) -> MutationResult {
        MutationResult(state: Workspace(projects: [], tasks: tasks, busy: [], blocks: [],
            settings: FTSettings(timeZone: "America/Chicago", workStart: "09:00", workEnd: "17:00",
                                 workDays: [1,2,3,4,5], maxBlockMinutes: 120, breakEveryMinutes: 120, breakMinutes: 15),
            plannedAt: nil, currentDate: "2026-10-15", revision: 1, warnings: []),
            result: returned.map { MutationResult.Result(tasks: $0) })
    }
    static func check(_ label: String, _ value: Bool) throws {
        guard value else { throw Failure(message: label) }
        print("PASS: " + label)
    }
    static func main() throws {
        let first = task("first", group: "request-a", index: 0)
        let second = task("second", group: "request-a", index: 1)
        let other = task("concurrent-other-device", group: "request-b", index: 0)
        try check("Count and order only this request's batch", response([other, second, first], returned: [first, second]).confirmedCapture(group: "request-a")?.map(\.id) == ["first", "second"])
        try check("Duplicate retry recovers the same batch without a result list", response([other, second, first]).confirmedCapture(group: "request-a")?.map(\.id) == ["first", "second"])
        try check("An unrelated workspace change cannot become capture success", response([other]).confirmedCapture(group: "request-a") == nil)
        try check("Empty responses stay unconfirmed", response([], returned: []).confirmedCapture(group: "request-a") == nil)
        try check("Inconsistent partial responses stay unconfirmed", response([first], returned: [first, second]).confirmedCapture(group: "request-a") == nil)
        try check("A confirmed smaller batch reports its actual count", response([other, first], returned: [first]).confirmedCapture(group: "request-a")?.count == 1)
        try check("Duplicate workspace IDs cannot inflate the count", response([first, first], returned: [first]).confirmedCapture(group: "request-a") == nil)
    }
}
