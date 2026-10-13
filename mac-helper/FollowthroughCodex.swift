// Created by Cory McCabe
import AppKit
import CryptoKit

struct BridgeError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

// RPC state is serialized on the private queue; UI callbacks run on the main queue.
final class CodexConnection: @unchecked Sendable {
    let process = Process()
    let input = Pipe()
    let output = Pipe()
    private let queue = DispatchQueue(label: "Followthrough.CodexRPC")
    private var buffer = Data()
    private var nextID = 1
    private var pending: [Int: CheckedContinuation<[String: Any], Error>] = [:]
    var notification: (([String: Any]) -> Void)?
    var approval: (([String: Any], @escaping ([String: Any]) -> Void) -> Void)?

    func start() throws {
        guard let app = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.openai.codex") else {
            throw BridgeError(message: "Install and sign in to Codex on this Mac, then try again.")
        }
        let executable = app.appendingPathComponent("Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex")
        guard FileManager.default.isExecutableFile(atPath: executable.path) else {
            throw BridgeError(message: "This Codex installation does not include its app server.")
        }
        process.executableURL = executable
        process.arguments = ["app-server", "--stdio"]
        process.standardInput = input
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        output.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            self?.queue.async { self?.receive(data) }
        }
        process.terminationHandler = { [weak self] _ in
            self?.queue.async {
                guard let self else { return }
                for continuation in self.pending.values { continuation.resume(throwing: BridgeError(message: "Codex closed its connection. Reopen the task in Codex to continue.")) }
                self.pending.removeAll()
            }
        }
        try process.run()
    }

    private func receive(_ data: Data) {
        buffer.append(data)
        while let newline = buffer.firstIndex(of: 10) {
            let line = buffer.prefix(upTo: newline)
            buffer.removeSubrange(...newline)
            guard let value = try? JSONSerialization.jsonObject(with: line) as? [String: Any] else { continue }
            if let id = value["id"] as? Int, value["method"] == nil, let continuation = pending.removeValue(forKey: id) {
                if let error = value["error"] as? [String: Any] {
                    continuation.resume(throwing: BridgeError(message: error["message"] as? String ?? "Codex could not start this task."))
                } else { continuation.resume(returning: value["result"] as? [String: Any] ?? [:]) }
            } else if value["id"] != nil, value["method"] != nil {
                DispatchQueue.main.async { [weak self] in
                    self?.approval?(value) { result in
                        self?.write(["jsonrpc": "2.0", "id": value["id"]!, "result": result])
                    }
                }
            } else {
                DispatchQueue.main.async { [weak self] in self?.notification?(value) }
            }
        }
    }

    private func write(_ value: [String: Any]) {
        guard var data = try? JSONSerialization.data(withJSONObject: value) else { return }
        data.append(10)
        try? input.fileHandleForWriting.write(contentsOf: data)
    }

    func call(_ method: String, _ params: [String: Any] = [:]) async throws -> [String: Any] {
        try await withCheckedThrowingContinuation { continuation in
            queue.async {
                let id = self.nextID
                self.nextID += 1
                self.pending[id] = continuation
                self.write(["jsonrpc": "2.0", "id": id, "method": method, "params": params])
                self.queue.asyncAfter(deadline: .now() + 90) {
                    self.pending.removeValue(forKey: id)?.resume(throwing: BridgeError(message: "Codex did not respond. Open Codex and try again."))
                }
            }
        }
    }
    func notify(_ method: String) { queue.async { self.write(["jsonrpc": "2.0", "method": method, "params": [:]]) } }
}

final class BridgeDelegate: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    let status = NSTextField(wrappingLabelWithString: "Ready. Use Send to Codex in Followthrough or your calendar.")
    let detail = NSTextView()
    var connections: [String: CodexConnection] = [:]
    var starting = Set<String>()
    var latestThread: String?
    static let configuration = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Followthrough Codex/projects.json")
    let preferences = UserDefaults.standard

    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 640, height: 440), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Followthrough → Codex"
        let stack = NSStackView()
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 16
        stack.edgeInsets = NSEdgeInsets(top: 22, left: 22, bottom: 22, right: 22)
        status.font = .systemFont(ofSize: 17, weight: .semibold)
        stack.addArrangedSubview(status)
        let scroll = NSScrollView()
        scroll.hasVerticalScroller = true
        detail.isEditable = false
        detail.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        detail.isVerticallyResizable = true
        detail.textContainer?.widthTracksTextView = true
        scroll.documentView = detail
        stack.addArrangedSubview(scroll)
        let open = NSButton(title: "Open task in Codex", target: self, action: #selector(openTask))
        stack.addArrangedSubview(open)
        stack.addArrangedSubview(NSButton(title: "Check Codex connection", target: self, action: #selector(checkConnection)))
        window.contentView = stack
        scroll.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([scroll.widthAnchor.constraint(equalTo: stack.widthAnchor, constant: -44), scroll.heightAnchor.constraint(greaterThanOrEqualToConstant: 280)])
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls {
            guard url.scheme == "followthrough-codex", url.host == "handoff",
                  let token = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "k" })?.value,
                  token.range(of: "^[A-Za-z0-9_-]{65,110}$", options: .regularExpression) != nil else {
                status.stringValue = "This Followthrough handoff link is invalid."
                continue
            }
            Task { await handoff(token) }
        }
    }

    @objc func checkConnection() {
        Task { @MainActor in
            let connection = CodexConnection()
            do {
                status.stringValue = "Checking Codex…"
                try connection.start()
                _ = try await connection.call("initialize", ["clientInfo": ["name": "followthrough_mac", "title": "Followthrough", "version": "1.0.0"]])
                connection.notify("initialized")
                let result = try await connection.call("account/read", ["refreshToken": false])
                guard result["account"] is [String: Any] else { throw BridgeError(message: "Sign in to Codex before sending a task.") }
                status.stringValue = "Connected to Codex. Ready to start tasks on this Mac."
            } catch { status.stringValue = "Could not connect: \(error.localizedDescription)" }
            if connection.process.isRunning { connection.process.terminate() }
        }
    }

    func workspace(for handoff: [String: Any]) throws -> String {
        let file = try? Data(contentsOf: Self.configuration)
        let projects = file.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [[String: String]] } ?? []
        func normalize(_ value: String) -> String { value.lowercased().unicodeScalars.filter(CharacterSet.alphanumerics.contains).map(String.init).joined() }
        let names = [handoff["projectName"] as? String ?? ""] + (handoff["projectAliases"] as? [String] ?? [])
        let requested = names.map(normalize).filter { !$0.isEmpty }
        let matches = projects.filter { record in
            let label = normalize(record["name"] ?? "")
            return requested.contains(label) || requested.contains(where: { label == "a" + $0 })
        }
        if matches.count == 1, let path = matches[0]["path"], path.hasPrefix("/"), FileManager.default.fileExists(atPath: path) { return path }
        let folder = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Documents/Codex/Followthrough Tasks")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder.path
    }

    @MainActor func handoff(_ token: String) async {
        let key = SHA256.hash(data: Data(token.utf8)).map { String(format: "%02x", $0) }.joined()
        if let thread = preferences.dictionary(forKey: "startedHandoffs")?[key] as? String {
            latestThread = thread
            status.stringValue = "This task is already in Codex. Opening it now."
            openTask()
            return
        }
        guard !starting.contains(key) else { return }
        starting.insert(key)
        defer { starting.remove(key) }
        status.stringValue = "Getting the full task context…"
        window?.makeKeyAndOrderFront(nil)
        do {
            var request = URLRequest(url: URL(string: "https://followthrough-actions.corybytheway.chatgpt.site/api/codex/handoff")!)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: ["k": token])
            request.timeoutInterval = 30
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let payload = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  (response as? HTTPURLResponse)?.statusCode == 200, payload["ok"] as? Bool == true,
                  let context = payload["handoff"] as? [String: Any],
                  let prompt = context["prompt"] as? String, prompt.utf8.count <= 200_000 else {
                throw BridgeError(message: "This task link could not be read. Try again from its latest calendar event.")
            }
            detail.string = prompt
            let cwd = try workspace(for: context)
            status.stringValue = "Starting Codex in \(URL(fileURLWithPath: cwd).lastPathComponent)…"
            let connection = CodexConnection()
            connections[key] = connection
            connection.approval = { [weak self] request, reply in self?.requestApproval(request, reply: reply) }
            connection.notification = { [weak self] message in
                if message["method"] as? String == "turn/completed" {
                    let turn = (message["params"] as? [String: Any])?["turn"] as? [String: Any]
                    self?.status.stringValue = turn?["status"] as? String == "completed" ? "Codex finished its turn. Review the result in Codex." : "Codex stopped. Open the task to review what it needs."
                }
            }
            try connection.start()
            _ = try await connection.call("initialize", ["clientInfo": ["name": "followthrough_mac", "title": "Followthrough", "version": "1.0.0"]])
            connection.notify("initialized")
            let result = try await connection.call("thread/start", ["cwd": cwd, "serviceName": "followthrough"])
            guard let thread = (result["thread"] as? [String: Any])?["id"] as? String else { throw BridgeError(message: "Codex did not return a task ID.") }
            latestThread = thread
            _ = try await connection.call("turn/start", ["threadId": thread, "input": [["type": "text", "text": prompt]]])
            var saved = preferences.dictionary(forKey: "startedHandoffs") ?? [:]
            saved[key] = thread
            preferences.set(saved, forKey: "startedHandoffs")
            status.stringValue = "Started in Codex. Its normal permissions and approvals still apply."
            openTask()
        } catch { status.stringValue = "Could not start: \(error.localizedDescription)" }
    }

    func requestApproval(_ request: [String: Any], reply: @escaping ([String: Any]) -> Void) {
        let method = request["method"] as? String ?? ""
        let params = request["params"] as? [String: Any] ?? [:]
        let alert = NSAlert()
        alert.messageText = "Codex needs your input"
        alert.informativeText = params["reason"] as? String ?? params["command"] as? String ?? method
        if method == "item/tool/requestUserInput", let questions = params["questions"] as? [[String: Any]] {
            var answers: [String: Any] = [:]
            for question in questions {
                let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 440, height: 28))
                alert.informativeText = question["question"] as? String ?? "Enter your answer."
                alert.accessoryView = field
                if alert.buttons.isEmpty { alert.addButton(withTitle: "Answer"); alert.addButton(withTitle: "Cancel") }
                guard alert.runModal() == .alertFirstButtonReturn else { reply(["answers": [:]]); return }
                if let id = question["id"] as? String { answers[id] = ["answers": [field.stringValue]] }
            }
            reply(["answers": answers]); return
        }
        if ["item/commandExecution/requestApproval", "item/fileChange/requestApproval"].contains(method) {
            alert.addButton(withTitle: "Approve")
            alert.addButton(withTitle: "Decline")
            reply(["decision": alert.runModal() == .alertFirstButtonReturn ? "accept" : "decline"])
        } else {
            alert.informativeText = "Open the task in Codex to respond to this request: \(method)"
            alert.addButton(withTitle: "Open Codex")
            alert.runModal()
            openTask()
            reply(["decision": "decline"])
        }
    }

    @objc func openTask() {
        guard let latestThread, let url = URL(string: "codex://threads/\(latestThread)") else { return }
        NSWorkspace.shared.open(url)
    }
}

@main struct FollowthroughCodex {
    static func main() throws {
        if CommandLine.arguments.contains("--configure-projects") {
            let data = FileHandle.standardInput.readDataToEndOfFile()
            guard let projects = try JSONSerialization.jsonObject(with: data) as? [[String: String]], projects.allSatisfy({ ($0["path"] ?? "").hasPrefix("/") && $0["name"] != nil }) else { throw BridgeError(message: "Invalid project mapping.") }
            try FileManager.default.createDirectory(at: BridgeDelegate.configuration.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: BridgeDelegate.configuration, options: .atomic)
            print("Local Codex projects configured.")
            return
        }
        let app = NSApplication.shared
        let delegate = BridgeDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        withExtendedLifetime(delegate) { app.run() }
    }
}
