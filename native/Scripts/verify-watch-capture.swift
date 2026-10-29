// Created by Cory McCabe
import Foundation

@main struct VerifyWatchCapture {
    struct Failure: Error { let message: String }
    static func check(_ name: String, _ condition: Bool) throws {
        guard condition else { throw Failure(message: name) }
        print("PASS: " + name)
    }
    static func verifyUpNext(account: String) throws {
        func date(_ value: String) -> Date { Date.iso(value)! }
        func task(_ id: String, priority: Priority, due: String? = nil, created: String = "2026-10-01T00:00:00Z") -> FTTask {
            FTTask(id: id, title: id, projectId: nil, notes: "", source: "", steps: [],
                   estimateMinutes: 60, remainingMinutes: 60, priority: priority, status: "ready",
                   dueDate: due, notBefore: nil, blockers: [], splittable: true,
                   createdAt: created, updatedAt: created)
        }
        let low = task("low", priority: .low)
        let laterDeadline = task("later-deadline", priority: .high, due: "2026-11-04")
        let newer = task("newer", priority: .high, due: "2026-11-03", created: "2026-10-02T00:00:00Z")
        let first = task("a-first", priority: .high, due: "2026-11-03")
        let tied = task("b-tied", priority: .high, due: "2026-11-03")
        let tasks = [low, laterDeadline, newer, tied, first]
        let blocks = tasks.enumerated().map { index, task in
            FTBlock(id: task.id, taskId: task.id,
                    start: "2026-10-30T\(16 + index):00:00Z", end: "2026-10-30T\(17 + index):00:00Z")
        } + [FTBlock(id: "monday", taskId: low.id, start: "2026-11-02T17:00:00Z", end: "2026-11-02T18:00:00Z")]
        let workspace = Workspace(projects: [], tasks: tasks, busy: [], blocks: blocks,
            settings: .init(timeZone: "America/Los_Angeles", workStart: "09:00", workEnd: "17:00",
                            workDays: [1,2,3,4,5], maxBlockMinutes: 120, breakEveryMinutes: 120, breakMinutes: 15),
            currentDate: "2026-10-30", revision: 1, warnings: [])
        func watchTask(_ task: FTTask) -> WatchPlanTask {
            .init(id: task.id, title: task.title, project: nil, remainingMinutes: task.remainingMinutes,
                  updatedAt: task.updatedAt, canComplete: true)
        }
        let snapshot = WatchPlanSnapshot.bounded(workspaceID: account, updatedAt: date("2026-10-30T15:00:00Z"),
            blocks: blocks.map { block in
                .init(task: watchTask(tasks.first { $0.id == block.taskId }!), start: block.startDate, end: block.endDate)
            },
            tasks: tasks.map(watchTask), timeZone: workspace.settings.timeZone, taskOrder: workspace.availableTasks.map(\.id))
        let decoded = try JSONDecoder().decode(WatchPlanSnapshot.self, from: JSONEncoder().encode(snapshot))
        try check("The phone delivers its workspace time zone and Up next task order", decoded == snapshot && decoded.valid)
        for stamp in ["2026-10-30T15:00:00Z", "2026-10-30T16:30:00Z", "2026-10-30T21:00:00Z",
                      "2026-10-31T01:00:00Z", "2026-10-31T19:00:00Z", "2026-11-02T07:59:59Z", "2026-11-02T08:00:00Z"] {
            let now = date(stamp)
            try check("Watch and menu bar agree at \(stamp)", decoded.next(at: now)?.task.id == workspace.todayTasks(at: now).first?.id)
        }
        try check("Up next follows priority, deadline, creation and ID order before scheduled time",
                  decoded.next(at: date("2026-10-30T16:30:00Z"))?.task.id == first.id)
        try check("The Watch does not show Monday's task after Friday or on the weekend",
                  decoded.next(at: date("2026-10-31T01:00:00Z")) == nil && decoded.next(at: date("2026-10-31T19:00:00Z")) == nil)
        try check("Cached timelines advance at local midnight after the daylight-saving change",
                  decoded.timelineDates(from: date("2026-11-01T20:00:00Z")).contains(date("2026-11-02T08:00:00Z")))

        let evening = WatchPlanBlock(task: watchTask(low), start: date("2026-10-30T23:00:00Z"), end: date("2026-10-31T02:00:00Z"))
        let latePlan = WatchPlanSnapshot(workspaceID: account, updatedAt: evening.start, blocks: [evening], timeZone: "America/Los_Angeles")
        try check("Today's work stays visible across UTC midnight in the workspace time zone",
                  latePlan.next(at: date("2026-10-31T01:00:00Z")) == evening && latePlan.next(at: evening.end) == nil)
        var invalid = decoded
        invalid.timeZone = "invalid"
        try check("Invalid workspace time zones are rejected", !invalid.valid)
        invalid = decoded
        invalid.taskOrder = [first.id, first.id]
        try check("Duplicate ordering IDs are rejected", !invalid.valid)
    }
    static func main() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("ft-watch-queue-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("outbox.json")
        let accountA = String(repeating: "a", count: 64), accountB = String(repeating: "b", count: 64)
        let link = WatchWorkspaceLink(workspaceID: accountA)
        try check("A Watch can request its account after being installed", WatchWorkspaceLink.isRequest(WatchWorkspaceLink.request))
        try check("The phone account link contains only an opaque workspace ID", Set(link.message.keys) == ["kind", "version", "workspace"] && WatchWorkspaceLink(message: link.message) == link)
        let signedOut = WatchWorkspaceLink(workspaceID: nil)
        try check("An explicit signed-out response clears the Watch account", WatchWorkspaceLink(message: signedOut.message) == signedOut)
        try check("Malformed account links are rejected", WatchWorkspaceLink(message: ["kind": "workspaceContext", "version": 1, "workspace": "invalid"]) == nil)
        try check("Unsupported connection requests are rejected", !WatchWorkspaceLink.isRequest(["kind": "workspaceRequest", "version": 2]))
        let first = try WatchCaptureRequest(workspaceID: accountA, source: "  Watch test request  ")
        let second = try WatchCaptureRequest(workspaceID: accountB, source: "Other account request")
        try check("Wire format preserves the request ID and account", WatchCaptureRequest(message: first.message) == first)
        var queue = try WatchCaptureOutbox(file: file)
        try queue.append(first); try queue.append(second)
        queue = try WatchCaptureOutbox(file: file)
        try check("Requests survive a Watch process restart", queue.requests == [first, second])
        try queue.append(first)
        try check("Repeated delivery keeps one durable request", queue.requests.count == 2)
        try queue.acknowledge(id: first.id, workspaceID: accountB)
        try check("An acknowledgment from another account cannot remove input", queue.requests == [first, second])
        try queue.acknowledge(id: first.id, workspaceID: accountA)
        try check("Acknowledging one request preserves other accounts", try WatchCaptureOutbox(file: file).requests == [second])

        do {
            try queue.append(WatchCaptureRequest(id: second.id, workspaceID: accountB, source: "Changed text"))
            throw Failure(message: "ID collision replaced an existing request")
        } catch is WatchCaptureError { print("PASS: Conflicting request IDs are rejected") }

        let blocked = directory.appendingPathComponent("not-a-directory")
        try Data().write(to: blocked)
        var unavailable = try WatchCaptureOutbox(file: blocked.appendingPathComponent("outbox.json"))
        do {
            try unavailable.append(first)
            throw Failure(message: "A failed write was acknowledged")
        } catch is Failure { throw Failure(message: "A failed write was acknowledged") }
        catch { try check("A failed write leaves the in-memory queue unchanged", unavailable.requests.isEmpty) }

        try Data("corrupt queue".utf8).write(to: file)
        do {
            _ = try WatchCaptureOutbox(file: file)
            throw Failure(message: "A corrupt queue was silently replaced")
        } catch is Failure { throw Failure(message: "A corrupt queue was silently replaced") }
        catch { try check("A corrupt queue is preserved for recovery", try Data(contentsOf: file) == Data("corrupt queue".utf8)) }
        let action = WatchTaskAction(taskID: "task-qa", updatedAt: "2026-10-23T06:00:00Z", kind: .addTime)
        let actionRequest = try WatchCaptureRequest(workspaceID: accountA, taskAction: action)
        try check("Task actions preserve the operation, version, account and request ID", WatchCaptureRequest(message: actionRequest.message) == actionRequest)
        let actionFile = directory.appendingPathComponent("actions.json")
        var actions = try WatchCaptureOutbox(file: actionFile)
        try actions.append(actionRequest)
        try check("Task actions survive a Watch process restart", try WatchCaptureOutbox(file: actionFile).requests == [actionRequest])
        try actions.acknowledge(id: actionRequest.id, workspaceID: accountB)
        try check("Another account cannot acknowledge a queued task action", actions.requests == [actionRequest])
        var unsupported = actionRequest.message
        unsupported["taskAction"] = Data("{\"taskID\":\"task-qa\",\"updatedAt\":\"x\",\"kind\":\"delete\"}".utf8)
        try check("Unsupported task operations are rejected", WatchCaptureRequest(message: unsupported) == nil)

        let legacyFile = directory.appendingPathComponent("legacy.json")
        try JSONSerialization.data(withJSONObject: [["id": first.id, "workspaceID": accountA, "source": first.source]]).write(to: legacyFile)
        try check("The existing capture queue remains readable after the update", try WatchCaptureOutbox(file: legacyFile).requests == [first])

        let now = Date(timeIntervalSince1970: 1_000_000)
        let task = WatchPlanTask(id: "task-qa", title: "Disposable test task", project: nil, remainingMinutes: 30, updatedAt: "stamp", canComplete: true)
        let current = WatchPlanBlock(task: task, start: now.addingTimeInterval(-60), end: now.addingTimeInterval(60))
        let nextTask = WatchPlanTask(id: "task-next", title: "Next scheduled task", project: nil, remainingMinutes: 15, updatedAt: "stamp", canComplete: true)
        let future = WatchPlanBlock(task: nextTask, start: now.addingTimeInterval(120), end: now.addingTimeInterval(180))
        let past = WatchPlanBlock(task: task, start: now.addingTimeInterval(-180), end: now.addingTimeInterval(-120))
        let plan = WatchPlanSnapshot(workspaceID: accountA, updatedAt: now, blocks: [future, past, current])
        try check("Up next chooses the current scheduled task, independent of array order", plan.next(at: now) == current)
        try check("The cached complication advances at the current task end", plan.next(at: current.end) == future)
        try check("A finished cached plan shows no task", plan.next(at: future.end) == nil)
        try check("Complication timelines include every future transition once", plan.timelineDates(from: now) == [now, current.end, future.start, future.end])
        try verifyUpNext(account: accountA)
        let context = WatchWorkspaceLink(workspaceID: accountA, plan: plan)
        try check("The phone can deliver a bounded plan to its paired account", WatchWorkspaceLink(message: context.message) == context)
        var wrongAccount = context.message
        wrongAccount["workspace"] = accountB
        try check("A plan from another account is rejected", WatchWorkspaceLink(message: wrongAccount) == nil)

        var detailedTask = task
        detailedTask.projectName = "Followthrough"
        detailedTask.projectColor = "#35EAB1"
        detailedTask.estimateMinutes = 60
        detailedTask.priority = .high
        detailedTask.dueDate = "2026-11-02"
        detailedTask.status = "ready"
        let taskList = WatchPlanSnapshot(workspaceID: accountA, updatedAt: now, blocks: [current],
                                        tasks: [detailedTask, nextTask], totalTaskCount: 2)
        let decodedList = try JSONDecoder().decode(WatchPlanSnapshot.self, from: JSONEncoder().encode(taskList))
        try check("Task metadata and unscheduled tasks survive delivery", decodedList == taskList && decodedList.task(nextTask.id) == nextTask && decodedList.task(task.id)?.projectName == "Followthrough")
        try check("Task details prefer fresh list metadata over a repeated block", taskList.task(task.id)?.estimateMinutes == 60)
        try check("A legacy plan deduplicates split tasks in scheduled order", plan.listedTasks.map(\.id) == [task.id, nextTask.id])
        try check("Existing cached task details remain readable", try JSONDecoder().decode(WatchPlanTask.self, from: JSONSerialization.data(withJSONObject: [
            "id": "old", "title": "Legacy task", "remainingMinutes": 30, "updatedAt": "stamp", "canComplete": true
        ])).estimateMinutes == nil)
        try check("Invalid calendar dates are rejected", WatchCalendarDay.date("2026-02-30") == nil && WatchCalendarDay.date("2026-11-02") != nil)
        var duplicateList = taskList
        duplicateList.tasks = [task, task]
        try check("Duplicate task IDs are rejected before reaching the list", !duplicateList.valid)
        let oversizedTasks = (0..<180).map { index in
            WatchPlanTask(id: "task-\(index)", title: String(repeating: "🌲", count: 300), project: "Project",
                          remainingMinutes: 30, updatedAt: "stamp", canComplete: true,
                          projectName: String(repeating: "p", count: 200), projectColor: "#35EAB1",
                          estimateMinutes: 60, priority: .medium, dueDate: "2026-11-02", status: "ready")
        }
        let bounded = WatchPlanSnapshot.bounded(workspaceID: accountA, updatedAt: now, blocks: [current], tasks: oversizedTasks,
                                               timeZone: "UTC", taskOrder: [task.id])
        try check("Large task lists fit the account-bound transport without losing the total count",
                  bounded.valid && (try JSONEncoder().encode(bounded).count) <= 44_000
                  && bounded.totalTaskCount == 180 && bounded.listedTasks.count < 128 && bounded.next(at: now) == current
                  && bounded.timeZone == "UTC" && bounded.taskOrder == [task.id])
        let boundedLink = WatchWorkspaceLink(workspaceID: accountA, plan: bounded)
        try check("The largest emitted task list passes the receiver's payload guard", WatchWorkspaceLink(message: boundedLink.message) == boundedLink)
        let completion = WatchCaptureResult(id: first.id, workspaceID: accountA, tasks: [detailedTask], totalTaskCount: 1)
        try check("A phone ownership receipt is not a saved-task confirmation",
                  WatchCaptureResult.from(first.acknowledgment()) == nil)
        try check("A server confirmation preserves the exact request and task metadata",
                  WatchCaptureResult.from(completion.message) == completion
                  && WatchCaptureResult.from(first.acknowledgment(confirmed: completion)) == completion)
        var mismatchedCompletion = completion.message
        mismatchedCompletion["workspace"] = accountB
        try check("A completion cannot change accounts in its envelope", WatchCaptureResult.from(mismatchedCompletion) == nil)
        mismatchedCompletion = completion.message
        mismatchedCompletion["id"] = second.id
        try check("A completion cannot change requests in its envelope", WatchCaptureResult.from(mismatchedCompletion) == nil)
        let unconfirmed = WatchCaptureResult(id: first.id, workspaceID: accountA, tasks: [], totalTaskCount: 0)
        try check("An empty or unconfirmed task result cannot open details", !unconfirmed.valid && unconfirmed.message.isEmpty)
        let completionFile = directory.appendingPathComponent("completed-captures.json")
        var completionQueue = try WatchCaptureOutbox(file: completionFile)
        try completionQueue.append(first)
        let otherAccountCompletion = WatchCaptureResult(id: first.id, workspaceID: accountB, tasks: [task], totalTaskCount: 1)
        try check("A result from another account cannot remove captured input",
                  try !completionQueue.complete(otherAccountCompletion) && completionQueue.requests == [first] && completionQueue.results.isEmpty)
        try check("Confirmed details and removal of input commit together", try completionQueue.complete(completion)
                  && completionQueue.requests.isEmpty && completionQueue.results == [completion])
        completionQueue = try WatchCaptureOutbox(file: completionFile)
        try check("The created task survives a Watch restart after its input is acknowledged",
                  completionQueue.requests.isEmpty && completionQueue.results == [completion])
        try check("Repeated result delivery does not create another receipt", try completionQueue.complete(completion)
                  && completionQueue.results.count == 1)
        let multiple = WatchCaptureResult(id: second.id, workspaceID: accountB, tasks: [task, nextTask], totalTaskCount: 2)
        try check("Multiple created tasks keep their exact batch count and order", WatchCaptureResult.from(multiple.message) == multiple)
        var failedCompletionQueue = try WatchCaptureOutbox(file: blocked.appendingPathComponent("results.json"))
        do {
            try failedCompletionQueue.append(first)
            throw Failure(message: "A blocked result store accepted a request")
        } catch is WatchCaptureError { print("PASS: Failed capture storage never acknowledges input") }
        catch is Failure { throw Failure(message: "A blocked result store accepted a request") }
        catch { try check("Failed capture storage preserves its in-memory state", failedCompletionQueue.requests.isEmpty && failedCompletionQueue.results.isEmpty) }
        let interruptedDirectory = directory.appendingPathComponent("interrupted")
        let interruptedFile = interruptedDirectory.appendingPathComponent("outbox.json")
        var interrupted = try WatchCaptureOutbox(file: interruptedFile)
        try interrupted.append(first)
        try FileManager.default.removeItem(at: interruptedFile)
        try FileManager.default.removeItem(at: interruptedDirectory)
        try Data().write(to: interruptedDirectory)
        do {
            _ = try interrupted.complete(completion)
            throw Failure(message: "A result was published after its atomic write failed")
        } catch is Failure { throw Failure(message: "A result was published after its atomic write failed") }
        catch { try check("A failed result write retains the original request and publishes no task",
                         interrupted.requests == [first] && interrupted.results.isEmpty) }
        for kind in [WatchTaskActionKind.nextWeek, .trash] {
            let request = try WatchCaptureRequest(workspaceID: accountA,
                taskAction: WatchTaskAction(taskID: task.id, updatedAt: task.updatedAt, kind: kind))
            try check("\(kind.rawValue) actions retain their account and stable identity", WatchCaptureRequest(message: request.message) == request)
        }

        let phoneFile = directory.appendingPathComponent("phone-outbox.json")
        let phoneOperation = PendingMutation(id: actionRequest.id, endpoint: "api/native/workspace", body: [:], title: "Disposable task")
        var phoneOutbox = CachedOutbox(identity: accountA, operations: [phoneOperation], acceptedWatchActions: [actionRequest.id])
        try JSONEncoder().encode(phoneOutbox).write(to: phoneFile, options: .atomic)
        phoneOutbox = try JSONDecoder().decode(CachedOutbox.self, from: Data(contentsOf: phoneFile))
        try check("Phone ownership receipts commit with the queued action", phoneOutbox.operations.first?.id == phoneOutbox.acceptedWatchActions?.first)
        phoneOutbox.operations = []
        try JSONEncoder().encode(phoneOutbox).write(to: phoneFile, options: .atomic)
        let saved = try JSONDecoder().decode(CachedOutbox.self, from: Data(contentsOf: phoneFile))
        try check("A server-saved action remains acknowledged after phone restart", saved.operations.isEmpty && saved.acceptedWatchActions == [actionRequest.id])
        let oldOutbox = try JSONSerialization.data(withJSONObject: ["identity": accountA, "operations": []])
        try check("Existing phone outboxes migrate without discarding requests", try JSONDecoder().decode(CachedOutbox.self, from: oldOutbox).acceptedWatchActions == nil)

        let short = try WatchTaskActionPolicy.addedTime(estimate: 30, remaining: 20)
        try check("Add time follows the existing graduated rule and preserves worked time", short.estimate == 60 && short.remaining == 50)
        let long = try WatchTaskActionPolicy.addedTime(estimate: 960, remaining: 720)
        try check("Long tasks gain four hours without resetting progress", long.estimate == 1200 && long.remaining == 960)
        do {
            _ = try WatchTaskActionPolicy.addedTime(estimate: 60000, remaining: 60000)
            throw Failure(message: "The maximum task duration was exceeded")
        } catch is WatchTaskActionError { print("PASS: Add time enforces the maximum duration") }
        let friday = Date.iso("2026-10-23T18:00:00Z")!
        try check("Postpone skips non-workdays", try WatchTaskActionPolicy.postpone(from: friday, timeZone: "America/Chicago", workDays: [1,2,3,4,5], dueDate: nil) == "2026-10-26")
        let lateThursday = Date.iso("2026-10-23T00:30:00Z")!
        try check("Postpone respects the workspace time zone", try WatchTaskActionPolicy.postpone(from: lateThursday, timeZone: "America/Chicago", workDays: [1,2,3,4,5], dueDate: nil) == "2026-10-23")
        do {
            _ = try WatchTaskActionPolicy.postpone(from: friday, timeZone: "America/Chicago", workDays: [1,2,3,4,5], dueDate: "2026-10-25")
            throw Failure(message: "Postpone passed the task deadline")
        } catch is WatchTaskActionError { print("PASS: Postpone cannot pass the task deadline") }
        try check("Next week advances to Monday in the workspace time zone",
                  try WatchTaskActionPolicy.postpone(from: friday, timeZone: "America/Chicago", workDays: [1,2,3,4,5], dueDate: nil, nextWeek: true) == "2026-10-26")
        try check("Pushing a Monday task means the following week and respects custom workdays",
                  try WatchTaskActionPolicy.postpone(from: Date.iso("2026-10-26T18:00:00Z")!, timeZone: "America/Chicago", workDays: [2,4], dueDate: nil, nextWeek: true) == "2026-11-03")
        do {
            _ = try WatchTaskActionPolicy.postpone(from: friday, timeZone: "America/Chicago", workDays: [1,2,3,4,5], dueDate: "2026-10-25", nextWeek: true)
            throw Failure(message: "Next week passed the task deadline")
        } catch is WatchTaskActionError { print("PASS: Next week cannot pass the task deadline") }
        do {
            _ = try WatchTaskActionPolicy.postpone(from: friday, timeZone: "America/Chicago", workDays: [], dueDate: nil, nextWeek: true)
            throw Failure(message: "An empty workweek silently postponed a task")
        } catch is WatchTaskActionError { print("PASS: An empty workweek cannot silently postpone a task") }
        print("All Watch capture, complication timeline, and task-action checks passed.")
    }
}
