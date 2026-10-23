// Created by Cory McCabe
import Foundation
import Observation
import WatchConnectivity
import WatchKit
import WidgetKit

@MainActor @Observable final class WatchCaptureRelay: NSObject, WCSessionDelegate {
    static let shared = WatchCaptureRelay()
    private(set) var pendingRequestIDs: Set<String> = []
    var pendingCount: Int { pendingRequestIDs.count }
    private(set) var connected = false
    private(set) var phoneNeedsSignIn = false
    private(set) var error: String?
    private(set) var plan: WatchPlanSnapshot?
    private(set) var captureResults: [WatchCaptureResult] = []
    private(set) var acceptedCaptureIDs: Set<String> = []
    private(set) var captureFailures: [String: String] = [:]
    private(set) var sentActions: [String: String] = [:]
    private(set) var rejectedRequestIDs: Set<String> = []
    @ObservationIgnored private var workspaceID: String?
    @ObservationIgnored private var outbox: WatchCaptureOutbox?
    @ObservationIgnored private var sending: Set<String> = []
    @ObservationIgnored private var requestingConnection = false
    @ObservationIgnored private var backgroundTasks: [WKWatchConnectivityRefreshBackgroundTask] = []
    @ObservationIgnored private var pendingObservation: NSKeyValueObservation?

    private override init() {
        super.init()
        #if DEBUG && targetEnvironment(simulator)
        if WatchPreview.screen != nil {
            // Opt-in rendering data never opens a real account or a transfer queue.
            workspaceID = WatchPreview.workspaceID
            plan = WatchPreview.plan
            connected = true
            return
        }
        #endif
        workspaceID = UserDefaults.standard.string(forKey: "phoneWorkspace")
        let cached = WatchPlanStorage.load()
        plan = cached?.workspaceID == workspaceID ? cached : nil
        sentActions = UserDefaults.standard.dictionary(forKey: "sentTaskActions") as? [String: String] ?? [:]
        do {
            let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            outbox = try WatchCaptureOutbox(file: directory.appendingPathComponent("WatchCaptures/outbox.json"))
            pendingRequestIDs = Set(outbox?.requests.map(\.id) ?? [])
            captureResults = outbox?.results ?? []
            acceptedCaptureIDs = Set(UserDefaults.standard.stringArray(forKey: "phoneAcceptedCaptures") ?? []).intersection(pendingRequestIDs)
        } catch { self.error = WatchCaptureError.storage.localizedDescription }
        WCSession.default.delegate = self
        pendingObservation = WCSession.default.observe(\.hasContentPending, options: [.new]) { [weak self] _, _ in
            Task { @MainActor in self?.completeBackgroundTasks() }
        }
        WCSession.default.activate()
    }

    @discardableResult
    func capture(_ source: String, id: String = UUID().uuidString) async throws -> String {
        if workspaceID == nil {
            await waitForActivation()
            refreshConnection()
            for _ in 0..<50 {
                if workspaceID != nil || phoneNeedsSignIn { break }
                try await Task.sleep(for: .milliseconds(100))
            }
        }
        guard let workspaceID else { throw WatchCaptureError.connectPhone }
        let existing = outbox?.requests.first { $0.id == id }
        if let existing, existing.workspaceID != workspaceID { throw WatchCaptureError.accountChanged }
        let input = source.isEmpty ? existing?.source ?? "" : source
        let request = try WatchCaptureRequest(id: id, workspaceID: workspaceID, source: input)
        guard outbox != nil else { throw WatchCaptureError.storage }
        do { try outbox?.append(request) }
        catch { throw WatchCaptureError.storage }
        pendingRequestIDs = Set(outbox?.requests.map(\.id) ?? [])
        error = nil
        captureFailures.removeValue(forKey: id)
        // Give a cold-launched intent time to hand its durable copy to the
        // system transfer service before Shortcuts suspends the Watch app.
        await waitForActivation()
        flush()
        return request.id
    }

    func hasCapture(_ id: String) -> Bool {
        outbox?.requests.contains { $0.id == id && $0.taskAction == nil && $0.workspaceID == workspaceID } == true
    }

    func captureResult(_ id: String) -> WatchCaptureResult? {
        captureResults.first { $0.id == id && $0.workspaceID == workspaceID }
    }

    func checkCaptureResult(_ id: String) {
        captureFailures.removeValue(forKey: id)
        flush(forceCaptureID: id)
    }

    func actionPending(for task: WatchPlanTask) -> Bool {
        sentActions[task.id] == task.updatedAt || (!pendingRequestIDs.isEmpty && outbox?.requests.contains(where: { $0.taskAction?.taskID == task.id }) == true)
    }

    func failedAction(for task: WatchPlanTask) -> Bool {
        !rejectedRequestIDs.isEmpty && outbox?.requests.contains(where: { $0.taskAction?.taskID == task.id && rejectedRequestIDs.contains($0.id) }) == true
    }

    var failedActions: [WatchCaptureRequest] {
        guard !rejectedRequestIDs.isEmpty else { return [] }
        return outbox?.requests.filter { $0.taskAction != nil && rejectedRequestIDs.contains($0.id) } ?? []
    }

    func dismissFailedAction(id: String) throws {
        guard let request = failedActions.first(where: { $0.id == id }) else { return }
        try outbox?.acknowledge(id: request.id, workspaceID: request.workspaceID)
        rejectedRequestIDs.remove(id)
        pendingRequestIDs = Set(outbox?.requests.map(\.id) ?? [])
        for transfer in WCSession.default.outstandingUserInfoTransfers where transfer.userInfo["id"] as? String == id { transfer.cancel() }
        error = nil
        refreshConnection()
    }

    @discardableResult
    func perform(_ kind: WatchTaskActionKind, on task: WatchPlanTask) async throws -> String {
        guard let workspaceID else { throw WatchCaptureError.connectPhone }
        guard !actionPending(for: task) else { throw WatchTaskActionError.stale }
        let action = WatchTaskAction(taskID: task.id, updatedAt: task.updatedAt, kind: kind)
        let request = try WatchCaptureRequest(workspaceID: workspaceID, taskAction: action)
        guard outbox != nil else { throw WatchCaptureError.storage }
        do { try outbox?.append(request) } catch { throw WatchCaptureError.storage }
        pendingRequestIDs = Set(outbox?.requests.map(\.id) ?? [])
        error = nil
        await waitForActivation()
        flush()
        return request.id
    }

    func dismissFailedAction(for task: WatchPlanTask) throws {
        for request in outbox?.requests ?? [] where request.taskAction?.taskID == task.id && rejectedRequestIDs.contains(request.id) {
            try outbox?.acknowledge(id: request.id, workspaceID: request.workspaceID)
            rejectedRequestIDs.remove(request.id)
            for transfer in WCSession.default.outstandingUserInfoTransfers where transfer.userInfo["id"] as? String == request.id { transfer.cancel() }
        }
        pendingRequestIDs = Set(outbox?.requests.map(\.id) ?? [])
        error = nil
        refreshConnection()
    }

    private func waitForActivation() async {
        for _ in 0..<50 {
            if WCSession.default.activationState == .activated { return }
            if Task.isCancelled { return }
            try? await Task.sleep(for: .milliseconds(100))
        }
    }

    func refreshConnection() {
        let session = WCSession.default
        guard session.activationState == .activated else { return }
        // The Watch may be installed after the phone's initial context update.
        // A request wakes the phone and asks it to load its saved account again.
        if !session.outstandingUserInfoTransfers.contains(where: { WatchWorkspaceLink.isRequest($0.userInfo) }) {
            session.transferUserInfo(WatchWorkspaceLink.request)
        }
        guard !requestingConnection else { return }
        requestingConnection = true
        session.sendMessage(WatchWorkspaceLink.request, replyHandler: { reply in
            Task { @MainActor in
                self.requestingConnection = false
                if let link = WatchWorkspaceLink(message: reply) { self.apply(link) }
            }
        }, errorHandler: { _ in
            Task { @MainActor in self.requestingConnection = false }
        })
    }

    func flush(forceCaptureID: String? = nil) {
        let session = WCSession.default
        guard session.activationState == .activated else { return }
        for request in outbox?.requests ?? [] where request.workspaceID == workspaceID && !rejectedRequestIDs.contains(request.id) {
            // The system keeps this delivery alive if the Watch app suspends.
            if !acceptedCaptureIDs.contains(request.id),
               !session.outstandingUserInfoTransfers.contains(where: { $0.userInfo["id"] as? String == request.id }) {
                session.transferUserInfo(request.message)
            }
            // A foreground Watch can wake the phone to query its retained
            // capture even when the phone isn't currently marked reachable.
            guard (session.isReachable || request.id == forceCaptureID), !sending.contains(request.id) else { continue }
            sending.insert(request.id)
            session.sendMessage(request.message, replyHandler: { reply in
                Task { @MainActor in
                    self.sending.remove(request.id)
                    self.accept(reply)
                }
            }, errorHandler: { _ in
                Task { @MainActor in self.sending.remove(request.id) }
            })
        }
        completeBackgroundTasks()
    }

    private func updateContext(_ context: [String: Any]) {
        guard let workspace = context["workspace"] as? String else { return }
        var message = context
        message["kind"] = "workspaceContext"; message["version"] = 1; message["workspace"] = workspace
        guard let link = WatchWorkspaceLink(message: message) else { return }
        apply(link)
    }

    private func apply(_ link: WatchWorkspaceLink) {
        let accountChanged = workspaceID != link.workspaceID
        let previousPlan = plan
        workspaceID = link.workspaceID
        UserDefaults.standard.set(workspaceID, forKey: "phoneWorkspace")
        connected = workspaceID != nil
        phoneNeedsSignIn = workspaceID == nil
        if accountChanged || workspaceID == nil { plan = nil; sentActions = [:] }
        if let latest = link.plan { plan = latest }
        if let plan {
            sentActions = sentActions.filter { plan.task($0.key)?.updatedAt == $0.value }
        }
        UserDefaults.standard.set(sentActions, forKey: "sentTaskActions")
        if rejectedRequestIDs.isEmpty { error = nil }
        if plan != previousPlan || accountChanged {
            do { try WatchPlanStorage.save(plan); WidgetCenter.shared.reloadAllTimelines() }
            catch { self.error = "Could not update your Watch complications. Open Followthrough again to retry." }
        }
        for transfer in WCSession.default.outstandingUserInfoTransfers where WatchWorkspaceLink.isRequest(transfer.userInfo) { transfer.cancel() }
        flush()
    }

    private func accept(_ reply: [String: Any]) {
        if let result = WatchCaptureResult.from(reply) {
            do {
                guard try outbox?.complete(result) == true else { return }
                captureResults = outbox?.results ?? []
                acceptedCaptureIDs.remove(result.id)
                captureFailures.removeValue(forKey: result.id)
                UserDefaults.standard.set(Array(acceptedCaptureIDs), forKey: "phoneAcceptedCaptures")
                pendingRequestIDs = Set(outbox?.requests.map(\.id) ?? [])
                cancelTransfer(id: result.id)
                error = nil
                refreshConnection()
            } catch { self.error = WatchCaptureError.storage.localizedDescription }
            completeBackgroundTasks()
            return
        }
        guard reply["kind"] as? String == "acknowledgment",
              let id = reply["id"] as? String, let workspace = reply["workspace"] as? String,
              outbox?.requests.contains(where: { $0.id == id && $0.workspaceID == workspace }) == true else { return }
        guard reply["accepted"] as? Bool == true else {
            error = reply["error"] as? String
            if outbox?.requests.first(where: { $0.id == id })?.taskAction != nil { rejectedRequestIDs.insert(id) }
            else { captureFailures[id] = error ?? "Your request is saved but needs attention on your iPhone." }
            completeBackgroundTasks(); return
        }
        if outbox?.requests.first(where: { $0.id == id })?.taskAction == nil {
            // The phone owns a durable copy, but the task is not confirmed yet.
            // Retain our input until its exact server result is saved atomically.
            acceptedCaptureIDs.insert(id)
            captureFailures.removeValue(forKey: id)
            UserDefaults.standard.set(Array(acceptedCaptureIDs), forKey: "phoneAcceptedCaptures")
            cancelTransfer(id: id)
            error = nil
            completeBackgroundTasks()
            return
        }
        do {
            if let action = outbox?.requests.first(where: { $0.id == id })?.taskAction {
                sentActions[action.taskID] = action.updatedAt
                UserDefaults.standard.set(sentActions, forKey: "sentTaskActions")
            }
            try outbox?.acknowledge(id: id, workspaceID: workspace)
            rejectedRequestIDs.remove(id)
            pendingRequestIDs = Set(outbox?.requests.map(\.id) ?? [])
            for transfer in WCSession.default.outstandingUserInfoTransfers where transfer.userInfo["id"] as? String == id { transfer.cancel() }
            error = nil
        } catch { self.error = WatchCaptureError.storage.localizedDescription }
        completeBackgroundTasks()
    }

    private func cancelTransfer(id: String) {
        for transfer in WCSession.default.outstandingUserInfoTransfers where transfer.userInfo["id"] as? String == id {
            transfer.cancel()
        }
    }

    func handle(_ task: WKWatchConnectivityRefreshBackgroundTask) {
        backgroundTasks.append(task)
        completeBackgroundTasks()
    }
    private func completeBackgroundTasks() {
        guard WCSession.default.activationState == .activated, !WCSession.default.hasContentPending else { return }
        for task in backgroundTasks { task.setTaskCompletedWithSnapshot(false) }
        backgroundTasks = []
    }

    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        Task { @MainActor in
            connected = workspaceID != nil
            updateContext(session.receivedApplicationContext)
            refreshConnection()
            flush()
        }
    }
    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        Task { @MainActor in refreshConnection(); flush() }
    }
    nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        Task { @MainActor in updateContext(applicationContext) }
    }
    nonisolated func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
        Task { @MainActor in
            if let link = WatchWorkspaceLink(message: userInfo) { apply(link) }
            else { accept(userInfo) }
        }
    }
    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        Task { @MainActor in accept(message) }
    }
    nonisolated func session(_ session: WCSession, didFinish userInfoTransfer: WCSessionUserInfoTransfer, error: Error?) {
        Task { @MainActor in completeBackgroundTasks() }
    }
}
