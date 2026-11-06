// Created by Cory McCabe
import Foundation
#if os(macOS)
import AppKit
#elseif os(iOS)
import UIKit
#endif

enum AIAssistant: String, CaseIterable, Codable, Sendable {
    case chatgpt, claude, gemini
    case geminiAIStudio = "gemini_ai_studio"
    case grok, perplexity, copilot

    var displayName: String {
        switch self {
        case .chatgpt: "ChatGPT"
        case .claude: "Claude"
        case .gemini: "Gemini"
        case .geminiAIStudio: "Gemini (AI Studio)"
        case .grok: "Grok"
        case .perplexity: "Perplexity"
        case .copilot: "Copilot"
        }
    }
    var supportsBrowserDraft: Bool { [.chatgpt, .claude, .geminiAIStudio, .grok].contains(self) }
    var needsCopiedBrief: Bool { ![.chatgpt, .claude, .geminiAIStudio].contains(self) }
    var macBundleIdentifiers: [String] {
        switch self {
        case .chatgpt: ["com.openai.codex"]
        case .claude: ["com.anthropic.claudefordesktop"]
        case .gemini: ["com.google.gemini"]
        case .geminiAIStudio: []
        case .grok: ["ai.x.GrokApp"]
        case .perplexity: ["ai.perplexity.macv3", "ai.perplexity.app"]
        case .copilot: ["com.microsoft.m365copilot", "com.microsoft.copilot-mac", "com.microsoft.officemobile"]
        }
    }
    var browserBase: String {
        switch self {
        case .chatgpt: "https://chatgpt.com/"
        case .claude: "https://claude.ai/new"
        case .gemini: "https://gemini.google.com/app"
        case .geminiAIStudio: "https://aistudio.google.com/prompts/new_chat"
        case .grok: "https://grok.com/"
        case .perplexity: "https://www.perplexity.ai/search"
        case .copilot: "https://copilot.cloud.microsoft/"
        }
    }
    func mobileAppURLs(browserURL: URL) -> [URL] {
        switch self {
        case .gemini: return [URL(string: "https://gemini.google.com/app/download/mobile")!]
        case .grok:
            var app = URLComponents(url: browserURL, resolvingAgainstBaseURL: false)!
            app.queryItems = app.queryItems?.filter { $0.name != "stay_in_browser" }
            if app.queryItems?.isEmpty == true { app.queryItems = nil }
            // Removing only this association-file flag preserves app-first routing.
            app.percentEncodedQuery = app.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
            return [app.url!]
        case .copilot: return [URL(string: browserBase)!, URL(string: "https://copilot.microsoft.com/tasks")!]
        default: return [browserURL]
        }
    }

    func acceptsWebAppURL(_ url: URL) -> Bool {
        guard needsCopiedBrief, url.scheme == "https", url.user == nil, url.password == nil,
              let host = url.host?.lowercased() else { return false }
        switch self {
        case .grok:
            return ["grok.com", "www.grok.com"].contains(host)
                || (host == "x.com" && (url.path == "/i/grok" || url.path.hasPrefix("/i/grok/")))
        case .gemini: return host == "gemini.google.com"
        case .perplexity: return ["perplexity.ai", "www.perplexity.ai"].contains(host)
        case .copilot: return ["copilot.cloud.microsoft", "m365.cloud.microsoft", "copilot.microsoft.com", "copilot.com"].contains(host)
        default: return false
        }
    }

    #if os(macOS)
    /// Safari web apps have unique bundle IDs; verify their saved provider URL.
    @MainActor func installedSafariWebApp() -> URL? {
        guard needsCopiedBrief else { return nil }
        let manager = FileManager.default
        let directories = [FileManager.SearchPathDomainMask.localDomainMask, .userDomainMask]
            .flatMap { manager.urls(for: .applicationDirectory, in: $0) }
        for directory in directories {
            let applications = (try? manager.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil, options: .skipsHiddenFiles)) ?? []
            for application in applications where application.pathExtension == "app" {
                guard let bundle = Bundle(url: application),
                      bundle.bundleIdentifier?.hasPrefix("com.apple.Safari.WebApp.") == true,
                      let manifest = bundle.infoDictionary?["Manifest"] as? [String: Any],
                      let value = manifest["start_url"] as? String,
                      let startURL = URL(string: value), acceptsWebAppURL(startURL) else { continue }
                return application
            }
        }
        // The sandbox redirects the user Applications directory and denies
        // enumeration of the real one. LaunchServices can still resolve a
        // registered app by its exact name, including Safari's per-install IDs.
        guard let path = NSWorkspace.shared.fullPath(forApplication: displayName) else { return nil }
        let application = URL(fileURLWithPath: path)
        guard application.lastPathComponent.caseInsensitiveCompare(displayName + ".app") == .orderedSame else { return nil }
        if let info = Bundle(url: application)?.infoDictionary {
            guard (info["CFBundleIdentifier"] as? String)?.hasPrefix("com.apple.Safari.WebApp.") == true,
                  let manifest = info["Manifest"] as? [String: Any],
                  let value = manifest["start_url"] as? String,
                  let startURL = URL(string: value), acceptsWebAppURL(startURL) else { return nil }
        }
        return application
    }
    #endif
}

extension AIAssistant {
    var settingsInstructions: LocalizedStringResource {
        switch self {
        case .chatgpt:
            #if os(macOS)
            return "Tries the ChatGPT Mac app first, then a prefilled browser draft. Very long briefs are copied for pasting."
            #else
            return "Tries the ChatGPT iPhone or iPad app first, then your browser, with task details prefilled for review. Very long briefs are copied for pasting."
            #endif
        case .claude:
            #if os(macOS)
            return "Tries Claude’s Mac app first. Its Mac app and browser chat support prefilled drafts. Very long briefs are copied for pasting."
            #else
            return "Tries Claude’s iPhone or iPad app first, then its browser chat. Browser drafts prefill task details; prefill in its iPhone and iPad app has not been verified. Very long briefs are copied for pasting."
            #endif
        case .geminiAIStudio:
            return "Opens Gemini in Google AI Studio in your browser with task details filled in for review. This choice is browser-only. Very long briefs are copied for pasting."
        case .grok:
            #if os(macOS)
            return "Grok’s browser chat fills in task details automatically. A copy is kept as a backup. Paste only if the Mac app opens with an empty message box. Very long briefs require pasting."
            #else
            return "Grok’s browser chat fills in task details automatically. A copy is kept as a backup. Paste only if the iPhone or iPad app opens with an empty message box. Very long briefs require pasting."
            #endif
        case .gemini:
            #if os(macOS)
            return "Tries the Gemini Mac app first, then your browser. This Gemini handoff copies task details for you to paste. Choose Gemini (AI Studio) for browser prefill."
            #else
            return "Tries the Gemini iPhone or iPad app first, then your browser. This Gemini handoff copies task details for you to paste. Choose Gemini (AI Studio) for browser prefill."
            #endif
        case .perplexity, .copilot:
            #if os(macOS)
            return "Tries \(displayName)’s Mac app first, then your browser. A copy of the task details is available. Paste it only if the message box is empty."
            #else
            return "Tries \(displayName)’s iPhone or iPad app first, then your browser. A copy of the task details is available. Paste it only if the message box is empty."
            #endif
        }
    }
}

struct TaskHandoff: Sendable {
    let appURL: URL
    let browserURL: URL
    let prompt: String
    let assistant: AIAssistant
    let requiresPaste: Bool
    let browserPrefillsPrompt: Bool
    var pasteInstructions: LocalizedStringResource {
        if browserPrefillsPrompt {
            return "If \(assistant.displayName) opens with an empty message box, paste the copied details. Its browser link fills them in automatically."
        }
        #if os(macOS)
        return "After \(assistant.displayName) opens, press ⌘V to paste the task details if its message box is empty."
        #else
        return "After \(assistant.displayName) opens, paste the copied task details if its message box is empty."
        #endif
    }
    var mobileAppURLs: [URL] { assistant.mobileAppURLs(browserURL: browserURL) }

    init(prompt: String, assistant: AIAssistant = .chatgpt) throws {
        self.prompt = prompt
        self.assistant = assistant
        var full = URLComponents(string: "https://chatgpt.com/")!
        full.queryItems = [URLQueryItem(name: "prompt", value: prompt)]
        let tooLong = (full.percentEncodedQuery?.utf8.count ?? 0) > 7000
        requiresPaste = assistant.needsCopiedBrief || tooLong
        browserPrefillsPrompt = !tooLong && assistant.supportsBrowserDraft
        let openingPrompt = requiresPaste
            ? "The complete Followthrough task details have been copied to your clipboard. Paste them into this chat before beginning; they include the task-specific completion webhook."
            : prompt
        var browser = URLComponents(string: assistant.browserBase)!
        if assistant == .geminiAIStudio {
            browser.queryItems = browserPrefillsPrompt ? [URLQueryItem(name: "prompt", value: prompt)] : nil
        } else if assistant == .grok {
            // Grok's published association file excludes this flag from app routing.
            browser.queryItems = [URLQueryItem(name: "stay_in_browser", value: "true")]
            if browserPrefillsPrompt { browser.queryItems?.append(URLQueryItem(name: "q", value: prompt)) }
        } else {
            browser.queryItems = assistant.needsCopiedBrief ? nil : [URLQueryItem(name: assistant == .claude ? "q" : "prompt", value: openingPrompt)]
        }
        // Web/Electron query parsers treat an unescaped plus as a space.
        browser.percentEncodedQuery = browser.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
        guard let browserURL = browser.url else { throw URLError(.badURL) }
        self.browserURL = browserURL
        #if os(macOS)
        var app = URLComponents(string: assistant == .claude ? "claude://claude.ai/new" : assistant == .chatgpt ? "codex://new" : assistant == .grok ? "xai-grok://" : assistant.browserBase)!
        if assistant == .geminiAIStudio { app.queryItems = browser.queryItems }
        if assistant == .claude { app.queryItems = [URLQueryItem(name: "q", value: openingPrompt)] }
        if assistant == .chatgpt { app.queryItems = [URLQueryItem(name: "mode", value: "codex"), URLQueryItem(name: "prompt", value: openingPrompt)] }
        app.percentEncodedQuery = app.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
        guard let appURL = app.url else { throw URLError(.badURL) }
        self.appURL = appURL
        #else
        self.appURL = assistant.mobileAppURLs(browserURL: browserURL)[0]
        #endif
    }

    @MainActor func prepareForOpening() throws {
        guard requiresPaste else { return }
        #if os(macOS)
        NSPasteboard.general.clearContents()
        guard NSPasteboard.general.setString(prompt, forType: .string) else {
            throw CocoaError(.fileWriteUnknown, userInfo: [NSLocalizedDescriptionKey: "Could not copy the full task details. Try again."])
        }
        #elseif os(iOS)
        UIPasteboard.general.string = prompt
        #endif
    }

    /// Never asks a browser to handle the app attempt. A false result permits browser fallback.
    @MainActor func openApp() async -> Bool {
        // AI Studio is an explicitly selected browser destination, separate from Gemini's app.
        guard assistant != .geminiAIStudio else { return false }
        #if os(macOS)
        var application = assistant.macBundleIdentifiers.lazy.compactMap {
            NSWorkspace.shared.urlForApplication(withBundleIdentifier: $0)
        }.first
        if application == nil && assistant == .grok {
            // Grok's own client registers this desktop scheme.
            application = NSWorkspace.shared.urlForApplication(toOpen: appURL)
        }
        if application == nil { application = assistant.installedSafariWebApp() }
        guard let application else { return false }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        return await withCheckedContinuation { continuation in
            if assistant.needsCopiedBrief {
                NSWorkspace.shared.openApplication(at: application, configuration: configuration) { app, error in
                    continuation.resume(returning: app != nil && error == nil)
                }
            } else {
                NSWorkspace.shared.open([appURL], withApplicationAt: application, configuration: configuration) { app, error in
                    continuation.resume(returning: app != nil && error == nil)
                }
            }
        }
        #elseif os(iOS)
        for url in mobileAppURLs {
            if await UIApplication.shared.open(url, options: [.universalLinksOnly: true]) { return true }
        }
        return false
        #else
        return false
        #endif
    }
}
