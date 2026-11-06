// Created by Cory McCabe
import Foundation

@main struct VerifyTaskHandoff {
    static func main() throws {
        let completion = "https://actions.followthrough.link/api/tasks/complete?k=task-specific-token"
        let prompt = "Complete ⚡️ task: quotes \" & +\nTask notes: ✨\nCompletion webhook: \(completion)\nOriginal input:\r\n  Keep spacing"
        let small = try TaskHandoff(prompt: prompt)
        precondition(!small.requiresPaste)
        precondition(small.prompt == prompt)
        precondition(!small.browserURL.absoluteString.contains("+"))
        precondition(!small.appURL.absoluteString.contains("+"))
        precondition(URLComponents(url: small.browserURL, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "prompt" })?.value == prompt)
        #if os(macOS)
        precondition(URLComponents(url: small.appURL, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "prompt" })?.value == prompt)
        #endif
        let full = prompt + String(repeating: "\nOriginal email history ✨ & +", count: 800)
        let large = try TaskHandoff(prompt: full)
        precondition(large.requiresPaste)
        precondition(large.prompt == full)
        precondition(large.browserURL.absoluteString.utf8.count < 7000)
        precondition(large.appURL.absoluteString.utf8.count < 7000)
        precondition(!large.browserURL.absoluteString.contains("codex/context"))
        precondition(!large.appURL.absoluteString.contains("tasks?task="))
        for assistant in AIAssistant.allCases {
            let selected = try TaskHandoff(prompt: prompt, assistant: assistant)
            precondition(selected.assistant == assistant)
            precondition(selected.prompt == prompt)
            precondition(!selected.browserURL.absoluteString.contains("+"))
            precondition(!selected.appURL.absoluteString.contains("+"))
            let long = try TaskHandoff(prompt: full, assistant: assistant)
            precondition(long.requiresPaste && long.prompt == full)
            precondition(!long.browserPrefillsPrompt)
            if assistant == .geminiAIStudio {
                precondition(!selected.requiresPaste && selected.browserPrefillsPrompt)
                precondition(selected.browserURL.host == "aistudio.google.com")
                precondition(URLComponents(url: selected.browserURL, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "prompt" })?.value == prompt)
                precondition(assistant.macBundleIdentifiers.isEmpty)
                precondition(URLComponents(url: long.browserURL, resolvingAgainstBaseURL: false)?.query == nil)
            }
            if assistant == .claude {
                precondition(selected.browserURL.host == "claude.ai")
                precondition(URLComponents(url: selected.browserURL, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "q" })?.value == prompt)
                #if os(macOS)
                precondition(selected.appURL.scheme == "claude")
                #else
                precondition(selected.appURL.scheme == "https")
                #endif
            }
            if assistant.needsCopiedBrief {
                precondition(selected.requiresPaste)
                if assistant == .grok {
                    precondition(selected.browserPrefillsPrompt)
                    precondition(URLComponents(url: selected.browserURL, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "stay_in_browser" })?.value == "true")
                    precondition(selected.mobileAppURLs.allSatisfy { URLComponents(url: $0, resolvingAgainstBaseURL: false)?.queryItems?.contains(where: { $0.name == "stay_in_browser" }) != true })
                    precondition(selected.mobileAppURLs.allSatisfy { URLComponents(url: $0, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "q" })?.value == prompt })
                    precondition(URLComponents(url: selected.browserURL, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "q" })?.value == prompt)
                } else {
                    precondition(!selected.browserPrefillsPrompt)
                    precondition(URLComponents(url: selected.browserURL, resolvingAgainstBaseURL: false)?.query == nil)
                }
                precondition(selected.mobileAppURLs.allSatisfy { $0.scheme == "https" })
            }
        }
        precondition(AIAssistant.grok.acceptsWebAppURL(URL(string: "https://x.com/i/grok")!))
        precondition(AIAssistant.grok.acceptsWebAppURL(URL(string: "https://grok.com/")!))
        for invalid in ["https://x.com/home", "https://x.com/i/grok-fake", "https://grok.com.evil.example/", "http://grok.com/", "https://user:secret@grok.com/"] {
            precondition(!AIAssistant.grok.acceptsWebAppURL(URL(string: invalid)!))
        }
        precondition(AIAssistant.perplexity.acceptsWebAppURL(URL(string: "https://www.perplexity.ai/computer")!))
        precondition(AIAssistant.copilot.acceptsWebAppURL(URL(string: "https://copilot.cloud.microsoft/")!))
        precondition(!AIAssistant.copilot.acceptsWebAppURL(URL(string: "https://microsoft.com/")!))
        precondition(AIAssistant.allCases.count == 7)
        let copilot = try TaskHandoff(prompt: prompt, assistant: .copilot)
        precondition(copilot.mobileAppURLs.map(\.host) == ["copilot.cloud.microsoft", "copilot.microsoft.com"])
        print("Task handoff checks passed: all assistant destinations, Unicode, full brief, bounded launch URLs, copy fallback")
    }
}
