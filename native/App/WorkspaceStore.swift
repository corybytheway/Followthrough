// Created by Cory McCabe
import SwiftUI
import AuthenticationServices
import CryptoKit
import WidgetKit
import Security

@MainActor @Observable final class WorkspaceStore: NSObject {
    var workspace: Workspace?
    var pending: [PendingMutation] = []
    var error: String?
    var syncing = false
    var connected = false
    var authorizing = false
    var capturePresented = false
    var selectedTask: FTTask?
    var selectedSection = "today"
    var lastSynced: Date?
    var blockedMutation = false
    var storageError: String?
    var server: String = UserDefaults.standard.string(forKey: "server") ?? {
        #if DEBUG
        return "http://localhost:4318"
        #else
        return "https://followthrough.corymccabe.com"
        #endif
    }()
    @ObservationIgnored private var session: NativeSession?
    @ObservationIgnored private var authSession: ASWebAuthenticationSession?
    @ObservationIgnored private var verifier = ""
    @ObservationIgnored private var authState = ""
    @ObservationIgnored private var authorizationServer: String?
    @ObservationIgnored private var started = false
    @ObservationIgnored private var refreshTask: Task<NativeSession, Error>?
    @ObservationIgnored private var pendingTaskID: String?

    var cacheURL: URL { SharedStorage.directory.appendingPathComponent("workspace.json") }
    var queueURL: URL { SharedStorage.directory.appendingPathComponent("outbox.json") }
    var client: APIClient { get throws { try APIClient(server: server) } }
    var isLocalWorkspace: Bool { ["localhost", "127.0.0.1", "::1"].contains(URL(string: server)?.host ?? "") }
    func connectLiveWorkspace() {
        connect(to: "https://followthrough.corymccabe.com")
    }
    func start() async {
        guard !started else { return }; started = true
        if let data = Keychain.load(server), let saved = try? JSONDecoder().decode(NativeSession.self, from: data) { session = saved; connected = true }
        #if DEBUG
        // Local integration tests provision a real PKCE-issued session. This is
        // never compiled into distribution builds and cannot target remote hosts.
        if session == nil, ["localhost", "127.0.0.1"].contains(URL(string: server)?.host ?? ""),
           let encoded = ProcessInfo.processInfo.environment["FOLLOWTHROUGH_SESSION"], let data = Data(base64Encoded: encoded),
           let supplied = try? JSONDecoder().decode(NativeSession.self, from: data) {
            do { try accept(supplied) } catch { self.error = error.localizedDescription }
        }
        #endif
        if session != nil {
            try? SharedStorage.bind(identity)
            if let data = try? Data(contentsOf: cacheURL), let cache = try? JSONDecoder().decode(CachedWorkspace.self, from: data), cache.identity == identity { workspace = cache.workspace }
            if let data = try? Data(contentsOf: queueURL), let queue = try? JSONDecoder().decode(CachedOutbox.self, from: data), queue.identity == identity { pending = queue.operations }
            openPendingTask()
        }
        await sync()
    }
    private var identity: String { server + ":" + (session?.ownerId ?? "") }
    func connect(to destination: String? = nil) {
        do {
            guard !authorizing, !syncing, refreshTask == nil else { return }
            let target = destination ?? server
            if session != nil { importSharedCaptures() }
            if target != server && !pending.isEmpty {
                error = "Sync your saved changes before switching workspaces. They are still safe on this device."
                Task { await sync() }
                return
            }
            let api = try APIClient(server: target)
            authorizationServer = target
            error = nil
            verifier = try Self.random(); authState = try Self.random()
            let challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64EncodedString().urlSafe
            var components = URLComponents(url: api.baseURL.appendingPathComponent("native/connect"), resolvingAgainstBaseURL: false)!
            components.queryItems = [URLQueryItem(name:"challenge",value:challenge),URLQueryItem(name:"state",value:authState)]
            let session = ASWebAuthenticationSession(url: components.url!, callbackURLScheme: "followthrough") { [weak self] url, failure in
                Task { @MainActor in
                    guard let self else { return }
                    if let url { await self.completeSignIn(url) }
                    else {
                        self.authorizing = false; self.authorizationServer = nil
                        if let failure, (failure as NSError).code != ASWebAuthenticationSessionError.canceledLogin.rawValue { self.error = failure.localizedDescription }
                    }
                }
            }
            session.presentationContextProvider = self
            // Use a fresh account choice instead of silently reusing another
            // ChatGPT account from the browser's current profile.
            session.prefersEphemeralWebBrowserSession = true
            authSession = session; authorizing = true
            if !session.start() { authorizing = false; authorizationServer = nil; error = "Could not open sign-in. Try again." }
        } catch { authorizing = false; authorizationServer = nil; self.error = error.localizedDescription }
    }
    func completeSignIn(_ url: URL) async {
        guard url.host == "auth", let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.queryItems?.first(where: {$0.name == "state"})?.value == authState,
              let code = parts.queryItems?.first(where: {$0.name == "code"})?.value, !verifier.isEmpty,
              let target = authorizationServer else {
            authorizing = false; authorizationServer = nil
            verifier = ""; authState = ""
            error = "Sign-in could not be verified. Connect your workspace again."
            return
        }
        do {
            let result: NativeSession = try await APIClient(server: target).send("api/native/session", method:"POST", body:["code":.string(code),"verifier":.string(verifier),"deviceName":.string(Self.deviceName)])
            // Captures may arrive from a shortcut while the browser is open.
            // Preserve them even when a different account uses the same host.
            if session != nil { importSharedCaptures() }
            if (target != server || session?.ownerId != result.ownerId) && !pending.isEmpty {
                let _: [String: Bool]? = try? await APIClient(server: target).send("api/native/session", method: "DELETE", token: result.accessToken)
                throw APIError.response(0, "Your previous workspace still has saved changes. Reconnect to that account and sync them before switching.")
            }
            // Do not discard the current workspace until the new login succeeds
            // and its credential is securely stored. Never move its outbox.
            try Keychain.save(JSONEncoder().encode(result), account: target)
            if target != server || session?.ownerId != result.ownerId { clearLocalData() }
            server = target
            UserDefaults.standard.set(target, forKey: "server")
            verifier = ""; authState = ""; authorizationServer = nil
            try accept(result)
            authorizing = false
            await sync()
        } catch { authorizing = false; authorizationServer = nil; self.error = error.localizedDescription }
    }
    private func accept(_ value: NativeSession) throws {
        if let existing = session, existing.ownerId != value.ownerId { clearLocalData() }
        try Keychain.save(JSONEncoder().encode(value), account: server)
        session = value; connected = true
        try SharedStorage.bind(identity)
    }
    private func access() async throws -> String {
        guard var value = session else { throw APIError.response(401, "Connect your workspace first.") }
        if value.expiresAt < Date().timeIntervalSince1970 * 1000 + 60_000 {
            // Settings and foreground sync can request access together. Share one
            // refresh so they cannot invalidate each other's new access token.
            if refreshTask == nil {
                let api = try client, refreshToken = value.refreshToken
                refreshTask = Task { try await api.send("api/native/session", method:"POST", body:["refreshToken":.string(refreshToken)]) }
            }
            defer { refreshTask = nil }
            value = try await refreshTask!.value
            try accept(value)
        }
        return value.accessToken
    }
    func sync() async {
        guard connected, !syncing, !authorizing else { return }
        syncing = true; defer { syncing = false }
        do {
            let token = try await access()
            importSharedCaptures()
            if !blockedMutation {
                while let operation = pending.first {
                    var body = operation.body; body["requestId"] = .string(operation.id)
                    do {
                        let result: MutationResult = try await client.send(operation.endpoint, method:"POST", body:body, token:token)
                        workspace = result.state; pending.removeFirst()
                        guard persist() else {
                            pending.insert(operation, at: 0)
                            throw APIError.response(0, storageError ?? "Could not save synchronization progress on this device.")
                        }
                    } catch let failure as APIError {
                        if failure.status == 409 || failure.status == 400 { blockedMutation = true }
                        throw failure
                    }
                }
            }
            workspace = try await client.send("api/native/workspace", token:token)
            openPendingTask()
            lastSynced = .now; persist(); if !blockedMutation { error = storageError }; updateWidget()
        } catch {
            self.error = error.localizedDescription
            if (error as? APIError)?.status == 401 { connected = false }
            if blockedMutation, let token = session?.accessToken, let latest: Workspace = try? await client.send("api/native/workspace",token:token) { workspace = latest; persist() }
        }
    }
    @discardableResult func capture(_ source: String) -> Bool {
        let source = source.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !source.isEmpty else { return false }
        guard source.utf16.count <= 8000 else { error = "Keep a capture under 8,000 characters. Your text is still here."; return false }
        return enqueue(.init(endpoint:"api/native/inbox",body:["source":.string(source)],title:source))
    }
    @discardableResult func mutate(action: String, title: String, fields: [String: JSONValue] = [:]) -> Bool {
        var body = fields; body["action"] = .string(action)
        return enqueue(.init(endpoint:"api/native/workspace",body:body,title:title))
    }
    @discardableResult private func enqueue(_ operation: PendingMutation) -> Bool {
        guard !authorizing else { error = "Finish connecting your workspace before saving a task."; return false }
        pending.append(operation)
        guard persist() else { pending.removeLast(); return false }
        Task { await sync() }; return true
    }
    @discardableResult func updateTask(_ task: FTTask, fields: [String: JSONValue]) -> Bool {
        var patch = fields; patch["expectedUpdatedAt"] = .string(task.updatedAt)
        return mutate(action:"update_task",title:task.title,fields:["id":.string(task.id),"task":.object(patch)])
    }
    @discardableResult func complete(_ task: FTTask) -> Bool { updateTask(task,fields:["status":.string(task.status == "done" ? "ready" : "done")]) }
    @discardableResult func postpone(_ task: FTTask, nextWeek: Bool) -> Bool {
        guard let workspace else { return false }
        var calendar = Calendar(identifier:.gregorian); calendar.timeZone = TimeZone(identifier:workspace.settings.timeZone) ?? .current
        var day = calendar.startOfDay(for:.now)
        if nextWeek {
            calendar.firstWeekday = 2
            let week = calendar.dateInterval(of:.weekOfYear,for:day)!.start
            day = calendar.date(byAdding:.day,value:7,to:week)!
            for _ in 0..<7 { if workspace.settings.workDays.contains(calendar.component(.weekday,from:day)-1) { break }; day = calendar.date(byAdding:.day,value:1,to:day)! }
        } else { for _ in 0..<7 { day = calendar.date(byAdding:.day,value:1,to:day)!; if workspace.settings.workDays.contains(calendar.component(.weekday,from:day)-1) { break } } }
        return updateTask(task, fields:["notBefore":.string(workspace.day(day))])
    }
    func discardFirstPending() {
        guard !pending.isEmpty else { return }
        let removed = pending.removeFirst()
        guard persist() else { pending.insert(removed, at: 0); return }
        blockedMutation = false; error = nil; Task { await sync() }
    }
    func retry() { blockedMutation = false; Task { await sync() } }
    func disconnect() async {
        do {
            let _: [String: Bool] = try await client.send("api/native/session",method:"DELETE",token:try await access())
        } catch {
            // A 401 already means this credential is unusable. For other failures,
            // retain the session so disconnection cannot falsely report revocation.
            if (error as? APIError)?.status != 401 { self.error = "Connect to the server to disconnect this device securely. " + error.localizedDescription; return }
        }
        Keychain.remove(server); session = nil; connected = false; clearLocalData(); updateWidget()
    }
    private func clearLocalData() {
        workspace = nil; pending = []; error = nil; blockedMutation = false
        selectedSection = "today"; selectedTask = nil; capturePresented = false
        pendingTaskID = nil
        try? FileManager.default.removeItem(at:cacheURL); try? FileManager.default.removeItem(at:queueURL)
        SharedStorage.unbind()
    }
    @discardableResult private func persist() -> Bool {
        guard session != nil else { return false }
        do {
            // Commit the outbox first. Never acknowledge offline capture on a failed write.
            try JSONEncoder().encode(CachedOutbox(identity:identity,operations:pending)).write(to:queueURL,options:.atomic)
        } catch { storageError = "Could not save on this device: " + error.localizedDescription; self.error = storageError; return false }
        do {
            if let workspace { try JSONEncoder().encode(CachedWorkspace(identity:identity,workspace:workspace)).write(to:cacheURL,options:.atomic) }
            storageError = nil
        } catch { storageError = "Your changes are saved, but the offline task cache could not update: " + error.localizedDescription; self.error = storageError }
        return true
    }
    private func importSharedCaptures() {
        let folder = SharedStorage.directory.appendingPathComponent("Inbox")
        guard let files = try? FileManager.default.contentsOfDirectory(at:folder,includingPropertiesForKeys:nil) else { return }
        for file in files.sorted(by: {$0.lastPathComponent < $1.lastPathComponent}) {
            guard let data = try? Data(contentsOf:file), let capture = try? JSONDecoder().decode(SharedCapture.self,from:data), capture.identity == identity else { continue }
            let source = capture.source
            let id = file.deletingPathExtension().lastPathComponent
            if !pending.contains(where: {$0.id == id}) { pending.append(.init(id:id,endpoint:"api/native/inbox",body:["source":.string(source)],title:source)) }
            if persist() { try? FileManager.default.removeItem(at:file) }
        }
    }
    private func updateWidget() {
        let next = workspace?.todayTasks.first
        SharedStorage.savePreview(.init(title:next?.title ?? (connected ? "That’s it for today!" : "Open Followthrough"),taskId:next?.id,project:workspace?.project(next?.projectId)?.name,remaining:next?.remainingLabel,updatedAt:.now))
        WidgetCenter.shared.reloadAllTimelines()
    }
    func calendars() async throws -> NativeCalendarStatus { try await client.send("api/native/calendars",token:try await access()) }
    func handoff(_ task: FTTask) async throws -> URL {
        struct HandoffResponse: Decodable, Sendable { var prompt: String }
        let response: HandoffResponse = try await client.send("api/native/handoff",method:"POST",body:["id":.string(task.id),"expectedUpdatedAt":.string(task.updatedAt)],token:try await access())
        #if os(macOS)
        var parts = URLComponents(string:"codex://new")!
        parts.queryItems = [URLQueryItem(name:"mode",value:"codex"), URLQueryItem(name:"prompt",value:response.prompt)]
        #else
        var parts = URLComponents(string:"https://chatgpt.com/")!
        parts.queryItems = [URLQueryItem(name:"prompt",value:response.prompt)]
        #endif
        return parts.url!
    }
    func open(_ url: URL) {
        if url.host == "auth" { Task { await completeSignIn(url) }; return }
        if url.host == "capture" { capturePresented = true }
        let id = URLComponents(url:url,resolvingAgainstBaseURL:false)?.queryItems?.first(where:{$0.name == "task"})?.value ?? (url.host == "task" ? url.lastPathComponent : nil)
        if let id { pendingTaskID = id; openPendingTask() }
    }
    private func openPendingTask() {
        guard let id = pendingTaskID, let task = workspace?.tasks.first(where: { $0.id == id }) else { return }
        selectedTask = task; pendingTaskID = nil
    }
    private static func random() throws -> String {
        var bytes = [UInt8](repeating:0,count:32)
        guard SecRandomCopyBytes(kSecRandomDefault,bytes.count,&bytes) == errSecSuccess else { throw APIError.response(0, "Could not prepare secure sign-in. Try again.") }
        return Data(bytes).base64EncodedString().urlSafe
    }
    static var deviceName: String {
        #if os(macOS)
        return "Followthrough on Mac"
        #else
        return "Followthrough on iPhone"
        #endif
    }
}
extension WorkspaceStore: ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        #if os(macOS)
        return NSApplication.shared.keyWindow ?? NSApplication.shared.windows.first ?? ASPresentationAnchor()
        #else
        return UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows).first(where:\.isKeyWindow) ?? ASPresentationAnchor()
        #endif
    }
}
extension String { var urlSafe: String { replacingOccurrences(of:"+",with:"-").replacingOccurrences(of:"/",with:"_").replacingOccurrences(of:"=",with:"") } }
private struct CachedWorkspace: Codable { var identity: String; var workspace: Workspace }
private struct CachedOutbox: Codable { var identity: String; var operations: [PendingMutation] }
