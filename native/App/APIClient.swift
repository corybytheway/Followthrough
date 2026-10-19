// Created by Cory McCabe
import Foundation
import Security
import OSLog

enum APIError: LocalizedError {
    case response(Int, String)
    case invalidServer
    var errorDescription: String? {
        switch self { case .response(_, let message): message; case .invalidServer: "Use an HTTPS server, or localhost for local development." }
    }
    var status: Int? { if case .response(let code, _) = self { return code }; return nil }
}
struct APIClient: Sendable {
    let baseURL: URL
    // Sites keeps the web workspace behind sign-in. Native requests use its
    // dedicated relay, which still requires the device's scoped bearer token.
    private var transportURL: URL {
        ["followthrough.site", "followthrough.corymccabe.com"].contains(baseURL.host ?? "")
            ? URL(string: "https://actions.followthrough.site")!
            : baseURL
    }
    private static let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.urlCache = nil
        return URLSession(configuration: configuration, delegate: NativeRedirectPolicy(), delegateQueue: nil)
    }()
    init(server: String) throws {
        guard let url = URL(string: server), url.user == nil, url.password == nil,
              url.query == nil, url.fragment == nil, url.path.isEmpty || url.path == "/",
              url.scheme == "https" || (url.scheme == "http" && ["localhost", "127.0.0.1", "::1"].contains(url.host ?? ""))
        else { throw APIError.invalidServer }
        baseURL = url
    }
    func send<T: Decodable & Sendable>(_ path: String, method: String = "GET", body: [String: JSONValue]? = nil, token: String? = nil) async throws -> T {
        let destination = path.hasPrefix("api/native/") ? transportURL : baseURL
        var request = URLRequest(url: destination.appendingPathComponent(path)); request.httpMethod = method
        request.timeoutInterval = 60
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body { request.httpBody = try JSONEncoder().encode(body) }
        let data: Data, rawResponse: URLResponse
        do { (data, rawResponse) = try await Self.session.data(for: request) }
        catch {
            NativeSyncLog.record("transport_failed", path: path, method: method, status: (error as NSError).code)
            throw error
        }
        let response = rawResponse
        guard let response = response as? HTTPURLResponse else { throw APIError.response(0, "The server did not return a response.") }
        if method != "GET" || !(200..<300).contains(response.statusCode) {
            NativeSyncLog.record("response", path: path, method: method, status: response.statusCode)
        }
        guard (200..<300).contains(response.statusCode) else {
            let message = (try? JSONDecoder().decode([String: String].self, from: data))?["error"] ?? "The server could not complete the request (\(response.statusCode))."
            throw APIError.response(response.statusCode, message)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
}
// A signed-in API request must never forward its bearer credential to a redirect.
private final class NativeRedirectPolicy: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
enum Keychain {
    static let service = "dev.ethosapps.followthrough.local"
    static func load(_ account: String) -> Data? {
        let query: [String: Any] = [kSecClass as String:kSecClassGenericPassword, kSecAttrService as String:service, kSecAttrAccount as String:account, kSecReturnData as String:true, kSecMatchLimit as String:kSecMatchLimitOne]
        var value: CFTypeRef?; guard SecItemCopyMatching(query as CFDictionary, &value) == errSecSuccess else { return nil }
        return value as? Data
    }
    static func save(_ data: Data, account: String) throws {
        let query: [String: Any] = [kSecClass as String:kSecClassGenericPassword, kSecAttrService as String:service, kSecAttrAccount as String:account]
        let update = SecItemUpdate(query as CFDictionary, [kSecValueData as String:data] as CFDictionary)
        if update == errSecItemNotFound {
            var item = query; item[kSecValueData as String] = data; item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { throw APIError.response(0, "Could not save the device session securely (Keychain).") }
        } else if update != errSecSuccess { throw APIError.response(0, "Could not update the device session.") }
    }
    static func remove(_ account: String) { SecItemDelete([kSecClass as String:kSecClassGenericPassword, kSecAttrService as String:service, kSecAttrAccount as String:account] as CFDictionary) }
}


/// Bounded, content-free diagnostics for Xcode/Console and device investigation.
/// Never record task text, account identifiers, request bodies, or credentials.
enum NativeSyncLog {
    private static let logger = Logger(subsystem: "com.ethos.followthrough", category: "Synchronization")
    private static let lock = NSLock()
    static func record(_ event: String, path: String = "", method: String = "", status: Int? = nil, count: Int? = nil) {
        let line = "\(ISO8601DateFormatter().string(from: .now)) \(event) \(method) \(path) status=\(status.map(String.init) ?? "-") pending=\(count.map(String.init) ?? "-")"
        logger.info("\(line, privacy: .public)")
        lock.lock(); defer { lock.unlock() }
        let url = SharedStorage.directory.appendingPathComponent("sync-diagnostics.log")
        let previous = (try? String(contentsOf: url, encoding: .utf8)) ?? ""
        let lines = (previous.split(separator: "\n").suffix(149).map(String.init) + [line]).joined(separator: "\n") + "\n"
        try? Data(lines.utf8).write(to: url, options: .atomic)
    }
}
