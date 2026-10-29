// Created by Cory McCabe
import Foundation

@main struct VerifyServerRouting {
    struct Failure: Error { let message: String }
    static func expect(_ description: String, _ condition: Bool) throws {
        guard condition else { throw Failure(message: description) }
        print("PASS: " + description)
    }
    static func main() throws {
        let live = "https://followthrough.link"
        let relay = "https://actions.followthrough.link"
        let servers = [live, live + "/", "https://followthrough.site", "https://followthrough.site/", "https://followthrough.site:443/", "https://followthrough.corymccabe.com",
                       "https://followthrough.corymccabe.com/", "https://followthrough.corybytheway.chatgpt.site",
                       "https://followthrough.corybytheway.chatgpt.site:443/"]
        for server in servers {
            let api = try APIClient(server: server)
            try expect("Canonical website for \(server)", api.baseURL.absoluteString == live)
            try expect("Sign-in uses current website", api.url(for: "native/connect").absoluteString == live + "/native/connect")
            try expect("Settings uses current website", api.url(for: "settings").absoluteString == live + "/settings")
            for path in ["api/native/session", "api/native/workspace", "api/native/inbox", "api/native/calendars", "api/native/suggestions"] {
                try expect("Native route retains authenticated relay: \(path)", api.url(for: path).absoluteString == relay + "/" + path)
            }
        }
        for server in ["http://localhost:4318", "http://127.0.0.1:4319", "https://example.com",
                       "https://followthrough.link.example.com", "https://followthrough.link:8443", "https://followthrough.site.example.com", "https://followthrough.site:8443",
                       "https://followthrough.corymccabe.com:8443"] {
            let api = try APIClient(server: server)
            try expect("Custom and local servers stay isolated: \(server)", api.baseURL.absoluteString == server)
            try expect("Custom and local APIs avoid live relay", api.url(for: "api/native/workspace").absoluteString == server + "/api/native/workspace")
        }
        for server in ["http://followthrough.link", "https://user:password@followthrough.link", "http://followthrough.site", "https://user:password@followthrough.site",
                       live + "/other", live + "?server=other", live + "#other"] {
            do {
                _ = try APIClient(server: server)
                throw Failure(message: "Invalid server accepted: \(server)")
            } catch APIError.invalidServer {
                print("PASS: Invalid server rejected: \(server)")
            }
        }
    }
}
