// Created by Cory McCabe
import Foundation

/// Ask the paired phone for its account link without transferring credentials.
struct WatchWorkspaceLink: Equatable, Sendable {
    let workspaceID: String?
    let plan: WatchPlanSnapshot?

    init(workspaceID: String?, plan: WatchPlanSnapshot? = nil) {
        self.workspaceID = workspaceID
        self.plan = plan
    }

    static var request: [String: Any] { ["kind": "workspaceRequest", "version": 1] }
    static func isRequest(_ message: [String: Any]) -> Bool {
        message["kind"] as? String == "workspaceRequest" && message["version"] as? Int == 1
    }

    var message: [String: Any] {
        var message: [String: Any] = ["kind": "workspaceContext", "version": 1, "workspace": workspaceID ?? ""]
        if let plan, let data = try? JSONEncoder().encode(plan) { message["plan"] = data }
        return message
    }

    init?(message: [String: Any]) {
        guard message["kind"] as? String == "workspaceContext", message["version"] as? Int == 1,
              let workspace = message["workspace"] as? String,
              workspace.isEmpty || (workspace.count == 64 && workspace.allSatisfy({ $0.isHexDigit })) else { return nil }
        workspaceID = workspace.isEmpty ? nil : workspace
        if let data = message["plan"] as? Data {
            guard data.count <= 45_000, let snapshot = try? JSONDecoder().decode(WatchPlanSnapshot.self, from: data),
                  snapshot.valid, snapshot.workspaceID == workspaceID else { return nil }
            plan = snapshot
        } else { plan = nil }
    }
}

/// Watch requests retain their identity and account across delivery retries.
struct WatchCaptureRequest: Codable, Identifiable, Equatable, Sendable {
    let id: String
    let workspaceID: String
    let source: String
    let taskAction: WatchTaskAction?

    init(id: String = UUID().uuidString, workspaceID: String, source: String) throws {
        let source = source.trimmingCharacters(in: .whitespacesAndNewlines)
        guard UUID(uuidString: id) != nil, workspaceID.count == 64,
              workspaceID.allSatisfy({ $0.isHexDigit }), !source.isEmpty,
              source.utf16.count <= 8000 else { throw WatchCaptureError.invalidRequest }
        self.id = id; self.workspaceID = workspaceID; self.source = source; self.taskAction = nil
    }

    init(id: String = UUID().uuidString, workspaceID: String, taskAction: WatchTaskAction) throws {
        guard UUID(uuidString: id) != nil, workspaceID.count == 64,
              workspaceID.allSatisfy(\.isHexDigit), taskAction.valid else { throw WatchCaptureError.invalidRequest }
        self.id = id; self.workspaceID = workspaceID; self.source = ""; self.taskAction = taskAction
    }

    init?(message: [String: Any]) {
        guard message["version"] as? Int == 1, let id = message["id"] as? String,
              let workspace = message["workspace"] as? String else { return nil }
        if message["kind"] as? String == "taskAction", let data = message["taskAction"] as? Data,
           data.count <= 4000, let action = try? JSONDecoder().decode(WatchTaskAction.self, from: data),
           let value = try? Self(id: id, workspaceID: workspace, taskAction: action) { self = value }
        else if message["kind"] as? String == "capture", let source = message["source"] as? String,
                let value = try? Self(id: id, workspaceID: workspace, source: source) { self = value }
        else { return nil }
    }

    var message: [String: Any] {
        if let taskAction, let data = try? JSONEncoder().encode(taskAction) {
            return ["kind": "taskAction", "version": 1, "id": id, "workspace": workspaceID, "taskAction": data]
        }
        return ["kind": "capture", "version": 1, "id": id, "workspace": workspaceID, "source": source]
    }

    func acknowledgment(error: String? = nil, confirmed: WatchCaptureResult? = nil) -> [String: Any] {
        var result: [String: Any] = ["kind": "acknowledgment", "id": id, "workspace": workspaceID, "accepted": error == nil]
        if let error { result["error"] = error }
        if error == nil, let confirmed, confirmed.id == id, confirmed.workspaceID == workspaceID,
           confirmed.valid, let data = try? JSONEncoder().encode(confirmed), data.count <= 44_000 {
            result["captureResult"] = data
        }
        return result
    }
}

/// Sent only after this exact request's server capture batch has been confirmed.
/// A phone ownership acknowledgment alone is never a saved-task result.
struct WatchCaptureResult: Codable, Equatable, Identifiable, Sendable {
    let id: String
    let workspaceID: String
    let tasks: [WatchPlanTask]
    let totalTaskCount: Int

    var valid: Bool {
        UUID(uuidString: id) != nil && workspaceID.count == 64 && workspaceID.allSatisfy(\.isHexDigit)
            && !tasks.isEmpty && tasks.count <= 16 && tasks.allSatisfy(\.valid)
            && Set(tasks.map(\.id)).count == tasks.count && totalTaskCount >= tasks.count
    }

    var message: [String: Any] {
        guard valid, let data = try? JSONEncoder().encode(self), data.count <= 44_000 else { return [:] }
        return ["kind": "captureResult", "version": 1, "id": id, "workspace": workspaceID, "captureResult": data]
    }

    static func from(_ message: [String: Any]) -> Self? {
        let isResult = message["kind"] as? String == "captureResult" && message["version"] as? Int == 1
        let isAcknowledgment = message["kind"] as? String == "acknowledgment" && message["accepted"] as? Bool == true
        guard isResult || isAcknowledgment, let data = message["captureResult"] as? Data, data.count <= 44_000,
              let result = try? JSONDecoder().decode(Self.self, from: data), result.valid,
              result.id == message["id"] as? String, result.workspaceID == message["workspace"] as? String else { return nil }
        return result
    }
}

enum WatchCaptureError: LocalizedError {
    case invalidRequest, connectPhone, accountChanged, storage
    var errorDescription: String? {
        switch self {
        case .invalidRequest: "Enter a task with up to 8,000 characters."
        case .connectPhone: "Open Followthrough on your iPhone and sign in once to connect your Watch."
        case .accountChanged: "This request belongs to another account. Sign back into that account on your iPhone to sync it."
        case .storage: "Could not save your request on this Watch. Try again."
        }
    }
}

/// A failed write never replaces the last durable queue or acknowledges input.
struct WatchCaptureOutbox {
    private struct Contents: Codable {
        var requests: [WatchCaptureRequest]
        var results: [WatchCaptureResult]
    }
    private let file: URL
    private(set) var requests: [WatchCaptureRequest]
    private(set) var results: [WatchCaptureResult] = []

    init(file: URL) throws {
        self.file = file
        if FileManager.default.fileExists(atPath: file.path) {
            let data = try Data(contentsOf: file)
            if let legacy = try? JSONDecoder().decode([WatchCaptureRequest].self, from: data) { requests = legacy }
            else {
                let contents = try JSONDecoder().decode(Contents.self, from: data)
                requests = contents.requests
                results = contents.results
                guard results.count <= 8, results.allSatisfy(\.valid),
                      Set(results.map(\.id)).count == results.count else { throw WatchCaptureError.storage }
            }
            for request in requests {
                if let action = request.taskAction {
                    _ = try WatchCaptureRequest(id: request.id, workspaceID: request.workspaceID, taskAction: action)
                } else {
                    _ = try WatchCaptureRequest(id: request.id, workspaceID: request.workspaceID, source: request.source)
                }
            }
            guard Set(requests.map(\.id)).count == requests.count else { throw WatchCaptureError.storage }
        } else { requests = [] }
    }

    mutating func append(_ request: WatchCaptureRequest) throws {
        if let existing = requests.first(where: { $0.id == request.id }) {
            guard existing == request else { throw WatchCaptureError.invalidRequest }
            return
        }
        try replace(requests + [request])
    }

    mutating func acknowledge(id: String, workspaceID: String) throws {
        try replace(requests.filter { $0.id != id || $0.workspaceID != workspaceID })
    }

    /// Commit the confirmed task details and removal of its input in one write.
    /// Unknown, cross-account and action receipts cannot replace a capture.
    @discardableResult mutating func complete(_ result: WatchCaptureResult) throws -> Bool {
        guard result.valid else { throw WatchCaptureError.invalidRequest }
        guard requests.contains(where: { $0.id == result.id && $0.workspaceID == result.workspaceID && $0.taskAction == nil }) else {
            return results.contains(result)
        }
        let remaining = requests.filter { $0.id != result.id || $0.workspaceID != result.workspaceID }
        let saved = Array((results.filter { $0.id != result.id } + [result]).suffix(8))
        try replace(remaining, results: saved)
        return true
    }

    private mutating func replace(_ values: [WatchCaptureRequest], results saved: [WatchCaptureResult]? = nil) throws {
        let saved = saved ?? results
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(Contents(requests: values, results: saved)).write(to: file, options: .atomic)
        requests = values
        results = saved
    }
}
