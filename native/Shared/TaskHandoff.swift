// Created by Cory McCabe
import Foundation

struct TaskHandoff: Sendable {
    let appURL: URL
    let browserURL: URL

    init(prompt: String) throws {
        var browser = URLComponents(string: "https://chatgpt.com/")!
        browser.queryItems = [URLQueryItem(name: "prompt", value: prompt)]
        guard let browserURL = browser.url else { throw URLError(.badURL) }
        self.browserURL = browserURL
        #if os(macOS)
        var app = URLComponents(string: "codex://new")!
        app.queryItems = [URLQueryItem(name: "mode", value: "codex"), URLQueryItem(name: "prompt", value: prompt)]
        guard let appURL = app.url else { throw URLError(.badURL) }
        self.appURL = appURL
        #else
        self.appURL = browserURL
        #endif
    }
}
