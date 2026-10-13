// Created by Cory McCabe
import AppKit
import Security
import CryptoKit

final class MacQueueClient {
    static let service = "com.corymccabe.followthrough-codex.runner"
    var secret: String?
    init() {
        var item: CFTypeRef?
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: Self.service, kSecAttrAccount as String: "device", kSecReturnData as String: true]
        if SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data { secret = String(data: data, encoding: .utf8) }
    }
    func prepareConnection() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw BridgeError(message: "Could not create a secure Mac connection.") }
        let value = "fr_" + bytes.map { String(format: "%02x", $0) }.joined()
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: Self.service, kSecAttrAccount as String: "device"]
        let data = Data(value.utf8)
        let updated = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if updated == errSecItemNotFound {
            var record = query; record[kSecValueData as String] = data
            guard SecItemAdd(record as CFDictionary, nil) == errSecSuccess else { throw BridgeError(message: "Could not save this Mac connection in Keychain.") }
        } else if updated != errSecSuccess { throw BridgeError(message: "Allow the helper to save its own connection in Keychain, then try again.") }
        secret = value
        return bytes.prefix(5).map { String(format: "%02X", $0) }.joined()
    }
    func request(_ values: [String: Any]) async throws -> [String: Any] {
        guard let secret else { throw BridgeError(message: "Choose Connect Followthrough first.") }
        var body = values; body["secret"] = secret
        var request = URLRequest(url: URL(string: "https://followthrough-actions.corybytheway.chatgpt.site/api/codex/device")!)
        request.httpMethod = "POST"; request.timeoutInterval = 25
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let result = try JSONSerialization.jsonObject(with: data) as? [String: Any], (response as? HTTPURLResponse)?.statusCode == 200, result["ok"] as? Bool == true else {
            throw BridgeError(message: "The Mac connection is unavailable. Check Followthrough Settings or connect it again.")
        }
        return result
    }
}

extension BridgeDelegate {
    @objc func connectFollowthrough() {
        guard !processingQueueJob, connections.isEmpty else {
            status.stringValue = "Finish the current Codex task before changing the Mac connection."
            return
        }
        Task { @MainActor in
            do {
                let client = queueClient ?? MacQueueClient(); queueClient = client
                let code = try client.prepareConnection()
                _ = try await client.request(["action": "begin", "code": code, "name": Host.current().localizedName ?? "My Mac"])
                preferences.set(code, forKey: "pendingPairCode")
                status.stringValue = "Approve this Mac in Followthrough Settings. Pairing code: \(code.prefix(5))-\(code.suffix(5))"
                NSWorkspace.shared.open(URL(string: "https://followthrough.corybytheway.chatgpt.site/settings?codex_pair=\(code)#codex-connection")!)
            } catch { status.stringValue = "Could not connect: \(error.localizedDescription)" }
        }
    }
    func startQueueReceiver() {
        queueClient = MacQueueClient()
        queueTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.pollQueue() }
        }
        Task { @MainActor in await pollQueue() }
    }
    func reportQueueResult(_ id: String, state: String, thread: String?) async {
        var pending = preferences.dictionary(forKey: "pendingQueueResults") as? [String: [String: String]] ?? [:]
        var value = ["state": state]; if let thread { value["threadId"] = thread }
        pending[id] = value; preferences.set(pending, forKey: "pendingQueueResults"); preferences.synchronize()
        await flushQueueResults()
    }
    func flushQueueResults() async {
        guard let client = queueClient else { return }
        let pending = preferences.dictionary(forKey: "pendingQueueResults") as? [String: [String: String]] ?? [:]
        for (id, value) in pending {
            var body: [String: Any] = ["action": "result", "id": id, "state": value["state"] ?? "needs_attention"]
            if let thread = value["threadId"] { body["threadId"] = thread }
            do {
                _ = try await client.request(body)
                var latest = preferences.dictionary(forKey: "pendingQueueResults") as? [String: [String: String]] ?? [:]
                // Preserve a later completion that arrived while an earlier acknowledgement was sending.
                if latest[id] == value { latest.removeValue(forKey: id); preferences.set(latest, forKey: "pendingQueueResults") }
            } catch { return }
        }
    }
    func pollQueue() async {
        guard !pollingQueue, let client = queueClient, client.secret != nil else { return }
        pollingQueue = true; defer { pollingQueue = false }
        await flushQueueResults()
        let pending = preferences.dictionary(forKey: "pendingQueueResults") as? [String: [String: String]] ?? [:]
        do {
            let result = try await client.request(["action": "poll", "busy": processingQueueJob || !pending.isEmpty])
            guard result["paired"] as? Bool == true else { return }
            preferences.set(true, forKey: "queueConnected")
            preferences.removeObject(forKey: "pendingPairCode")
            if !processingQueueJob { status.stringValue = "Connected. Waiting for tasks sent from your calendar or Followthrough." }
            guard !processingQueueJob, let job = result["job"] as? [String: Any], let id = job["id"] as? String,
                  let context = job["handoff"] as? [String: Any] else { return }
            processingQueueJob = true
            Task { @MainActor in await runQueuedTask(id, context: context, cloudThread: job["threadId"] as? String) }
        } catch {
            if !processingQueueJob { status.stringValue = "Waiting for the connection. Queued tasks stay saved in Followthrough." }
        }
    }
    func runQueuedTask(_ id: String, context: [String: Any], cloudThread: String?) async {
        let key = "queue_" + id
        var records = preferences.dictionary(forKey: "queuedHandoffs") as? [String: [String: String]] ?? [:]
        let record = records[id]
        var taskThread = record?["thread"] ?? cloudThread
        if let thread = record?["thread"], record?["phase"] == "sent" {
            latestThread = thread
            // A previous process already submitted the turn. Do not run its actions a second time after a restart.
            await reportQueueResult(id, state: "needs_attention", thread: thread)
            processingQueueJob = false
            return
        }
        let connection = CodexConnection(); connections[key] = connection
        do {
            guard let prompt = context["prompt"] as? String, prompt.utf8.count <= 200_000 else { throw BridgeError(message: "The task context is invalid.") }
            detail.string = prompt
            let cwd = try workspace(for: context)
            status.stringValue = "Starting \(context["title"] as? String ?? "task") in Codex…"
            connection.approval = { [weak self] request, reply in self?.requestApproval(request, reply: reply) }
            connection.closed = { [weak self] in
                Task { @MainActor in
                    guard let self, self.connections[key] === connection else { return }
                    await self.reportQueueResult(id, state: "needs_attention", thread: taskThread)
                    self.processingQueueJob = false
                    self.status.stringValue = "Codex closed its connection. Open the task in Codex to continue."
                    connection.notification = nil; connection.approval = nil; connection.closed = nil
                    self.connections.removeValue(forKey: key)
                }
            }
            connection.notification = { [weak self] message in
                guard message["method"] as? String == "turn/completed" else { return }
                let turn = (message["params"] as? [String: Any])?["turn"] as? [String: Any]
                let state = turn?["status"] as? String == "completed" ? "completed" : "needs_attention"
                Task { @MainActor in
                    guard let self else { return }
                    await self.reportQueueResult(id, state: state, thread: taskThread)
                    self.processingQueueJob = false
                    self.status.stringValue = state == "completed" ? "Codex finished its turn. The result is saved in Codex." : "Codex needs attention. Open the task to review it."
                    connection.notification = nil; connection.approval = nil; connection.closed = nil
                    if connection.process.isRunning { connection.process.terminate() }
                    self.connections.removeValue(forKey: key)
                }
            }
            try connection.start()
            _ = try await connection.call("initialize", ["clientInfo": ["name": "followthrough_mac", "title": "Followthrough", "version": "2.0.0"]])
            connection.notify("initialized")
            let knownThread = record?["thread"] ?? cloudThread
            let thread: String
            if let knownThread {
                thread = knownThread
                let old = try await connection.call("thread/read", ["threadId": thread, "includeTurns": true])
                if let turns = (old["thread"] as? [String: Any])?["turns"] as? [[String: Any]], !turns.isEmpty {
                    latestThread = thread
                    let state = turns.last?["status"] as? String == "completed" ? "completed" : "needs_attention"
                    await reportQueueResult(id, state: state, thread: thread)
                    processingQueueJob = false
                    connection.notification = nil; connection.approval = nil; connection.closed = nil
                    if connection.process.isRunning { connection.process.terminate() }
                    connections.removeValue(forKey: key)
                    return
                }
                _ = try await connection.call("thread/resume", ["threadId": thread])
            } else {
                let result = try await connection.call("thread/start", ["cwd": cwd, "serviceName": "followthrough"])
                guard let value = (result["thread"] as? [String: Any])?["id"] as? String else { throw BridgeError(message: "Codex did not return a task ID.") }
                thread = value
            }
            latestThread = thread
            taskThread = thread
            records[id] = ["thread": thread, "phase": "created"]
            preferences.set(records, forKey: "queuedHandoffs"); preferences.synchronize()
            await reportQueueResult(id, state: "claimed", thread: thread)
            let initialTurn = try await connection.call("turn/start", ["threadId": thread, "input": [["type": "text", "text": prompt]]])
            if let state = (initialTurn["turn"] as? [String: Any])?["status"] as? String, ["failed", "interrupted"].contains(state) {
                throw BridgeError(message: "Codex could not start its turn. Open Codex to check its account and permissions.")
            }
            records[id] = ["thread": thread, "phase": "sent"]
            preferences.set(records, forKey: "queuedHandoffs"); preferences.synchronize()
            await reportQueueResult(id, state: "started", thread: thread)
            status.stringValue = "Started in Codex. You can follow its progress in Codex; normal approvals apply."
        } catch {
            status.stringValue = "Could not start: \(error.localizedDescription)"
            await reportQueueResult(id, state: "needs_attention", thread: taskThread)
            processingQueueJob = false
            connection.notification = nil; connection.approval = nil; connection.closed = nil
            if connection.process.isRunning { connection.process.terminate() }
            connections.removeValue(forKey: key)
        }
    }
}
