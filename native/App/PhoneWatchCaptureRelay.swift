// Created by Cory McCabe
#if os(iOS)
import Foundation
import WatchConnectivity

@MainActor final class PhoneWatchCaptureRelay: NSObject, WCSessionDelegate {
    static let shared = PhoneWatchCaptureRelay()
    private var waitingCaptures: [String: WatchCaptureRequest] = [:]
    private override init() {
        super.init()
        if WCSession.isSupported() {
            WCSession.default.delegate = self
            WCSession.default.activate()
            recordConnection("activation_requested")
        }
    }

    func publishWorkspace() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        recordConnection("context_attempt")
        guard session.activationState == .activated, session.isPaired, session.isWatchAppInstalled else { return }
        do {
            let store = WorkspaceStore.shared
            try session.updateApplicationContext(WatchWorkspaceLink(workspaceID: store.watchWorkspaceID, plan: store.watchPlan).message)
            recordConnection("context_sent")
        } catch {
            recordConnection("context_failed", errorCode: (error as NSError).code)
        }
    }

    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        Task { @MainActor in WorkspaceStore.shared.prepareWatchConnection(); publishWorkspace() }
    }
    nonisolated func sessionWatchStateDidChange(_ session: WCSession) {
        Task { @MainActor in publishWorkspace() }
    }
    nonisolated func sessionDidBecomeInactive(_ session: WCSession) {}
    nonisolated func sessionDidDeactivate(_ session: WCSession) { session.activate() }

    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
        if WatchWorkspaceLink.isRequest(message) {
            Task { @MainActor in replyHandler(workspaceLink()) }
            return
        }
        guard let request = WatchCaptureRequest(message: message) else {
            replyHandler(["accepted": false]); return
        }
        Task { @MainActor in replyHandler(receive(request)) }
    }

    nonisolated func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
        if WatchWorkspaceLink.isRequest(userInfo) {
            Task { @MainActor in
                let reply = workspaceLink()
                if session.activationState == .activated { session.transferUserInfo(reply) }
            }
            return
        }
        guard let request = WatchCaptureRequest(message: userInfo) else { return }
        Task { @MainActor in
            let acknowledgment = receive(request)
            if session.activationState == .activated { session.transferUserInfo(acknowledgment) }
        }
    }

    private func workspaceLink() -> [String: Any] {
        WorkspaceStore.shared.prepareWatchConnection()
        publishWorkspace()
        recordConnection("workspace_reply")
        return WatchWorkspaceLink(workspaceID: WorkspaceStore.shared.watchWorkspaceID, plan: WorkspaceStore.shared.watchPlan).message
    }

    private func receive(_ request: WatchCaptureRequest) -> [String: Any] {
        do {
            try WorkspaceStore.shared.captureFromWatch(request)
            recordConnection("capture_accepted")
            if request.taskAction == nil {
                let confirmed = WorkspaceStore.shared.watchCaptureResult(for: request)
                if confirmed == nil {
                    if waitingCaptures.count >= 64, waitingCaptures[request.id] == nil { waitingCaptures.removeAll() }
                    waitingCaptures[request.id] = request
                } else { waitingCaptures.removeValue(forKey: request.id) }
                return request.acknowledgment(error: WorkspaceStore.shared.watchCaptureFailure(for: request), confirmed: confirmed)
            }
            return request.acknowledgment()
        } catch {
            publishWorkspace()
            recordConnection("capture_failed", errorCode: (error as NSError).code)
            return request.acknowledgment(error: error.localizedDescription)
        }
    }

    /// Best-effort immediate delivery plus a system-owned background transfer.
    /// The Watch also polls its retained request, so a phone restart is safe.
    func captureSaved(requestID: String) {
        guard let request = waitingCaptures[requestID],
              let result = WorkspaceStore.shared.watchCaptureResult(for: request),
              !result.message.isEmpty, WCSession.default.activationState == .activated else { return }
        let session = WCSession.default
        if !session.outstandingUserInfoTransfers.contains(where: {
            $0.userInfo["kind"] as? String == "captureResult" && $0.userInfo["id"] as? String == requestID
        }) { session.transferUserInfo(result.message) }
        if session.isReachable { session.sendMessage(result.message, replyHandler: nil, errorHandler: { _ in }) }
        waitingCaptures.removeValue(forKey: requestID)
    }

    /// Local development diagnostics contain connection flags, never account or task data.
    private func recordConnection(_ event: String, errorCode: Int? = nil) {
        #if DEBUG
        let session = WCSession.default
        var snapshot: [String: Any] = [
            "version": 1,
            "build": Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "",
            "event": event,
            "activationState": session.activationState.rawValue,
            "paired": session.isPaired,
            "watchAppInstalled": session.isWatchAppInstalled,
            "reachable": session.isReachable,
            "accountAvailable": WorkspaceStore.shared.watchWorkspaceID != nil,
            "updatedAt": Date.now.ISO8601Format()
        ]
        if let errorCode { snapshot["errorCode"] = errorCode }
        let directory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        guard let data = try? JSONSerialization.data(withJSONObject: snapshot, options: [.sortedKeys]) else { return }
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try? data.write(to: directory.appendingPathComponent("watch-connection-status.json"), options: .atomic)
        #endif
    }
}
#endif
