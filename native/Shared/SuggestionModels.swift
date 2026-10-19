// Created by Cory McCabe
import Foundation

struct SuggestionDraft: Codable, Identifiable, Hashable, Sendable {
    var id = UUID()
    enum CodingKeys: String, CodingKey { case title, projectId, estimateMinutes, priority, dueDate, notBefore, notes, steps, blockedByTaskIndexes, waitingFor, followsTaskIndexes }
    var title: String
    var projectId: String?
    var estimateMinutes: Int
    var priority: String
    var dueDate: String?
    var notBefore: String?
    var notes: String
    var steps: [String]
    var blockedByTaskIndexes: [Int]
    var waitingFor: String? = nil
    var followsTaskIndexes: [Int]? = nil
}
struct SuggestionBasis: Codable, Hashable, Sendable {
    var kind: String
    var count: Int
}
struct SuggestionSource: Codable, Hashable, Sendable {
    var kind: String
    var label: String
    var taskTitle: String?
    var basis: SuggestionBasis? = nil
    var url: String?
    var sender: String?
    var subject: String?
    var messageDate: String?
    var date: Date? {
        guard let messageDate else { return nil }
        let parser = ISO8601DateFormatter(); parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return parser.date(from: messageDate) ?? ISO8601DateFormatter().date(from: messageDate)
    }
}
struct TaskSuggestion: Codable, Identifiable, Hashable, Sendable {
    var id: String
    var patternId: String
    var version: Int
    var createdAt: String?
    var kind: String
    var reason: String
    var source: SuggestionSource
    var drafts: [SuggestionDraft]
    var targetTaskId: String?
    var feedback: String?
    func expired(at now: Date = .now) -> Bool {
        guard let createdAt else { return true }
        let parser = ISO8601DateFormatter(); parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = parser.date(from: createdAt) ?? ISO8601DateFormatter().date(from: createdAt) else { return true }
        return now.timeIntervalSince(date) >= 30 * 86_400
    }
    var basisLabel: String {
        switch kind {
        case "gmail": return String(localized: "Gmail")
        case "frequency": return String(localized: "Recurring routine for")
        case "workflow": return String(localized: "Usual next step after")
        default:
            if let basis = source.basis {
                if basis.kind == "postponements" { return String(localized: "Moved later \(basis.count) times:") }
                if basis.kind == "inactivity" {
                    return basis.count == 1 ? String(localized: "1 day without recorded progress on") : String(localized: "\(basis.count) days without recorded progress on")
                }
            }
            return String(localized: "Task history for")
        }
    }
    var sourceTitle: String {
        switch kind { case "gmail": "Gmail"; case "frequency": "Task frequency"; case "workflow": "Your workflow"; default: "Task history" }
    }
}
struct SuggestionStatus: Codable, Sendable {
    var available: Bool
    var gmailEnabled: Bool
    var googleConnected: Bool
    var googleAccount: String
    var lastChecked: String?
    var checking: Bool
    var error: String?
    var queued: Int
    var feedbackCount: Int
}
struct SuggestionResponse: Codable, Sendable {
    var suggestions: [TaskSuggestion]
    var status: SuggestionStatus
}
struct CachedSuggestions: Codable {
    var identity: String
    var response: SuggestionResponse
}

/// Keep a confirmed suggestion in its original position during the same
/// brief checkmark acknowledgment used by ordinary task completion.
struct SuggestionAcceptanceFeedback: Sendable {
    let id = UUID()
    let before: TaskSuggestion
    let followingIDs: [String]

    static func presenting(_ pending: [TaskSuggestion], holding feedback: [String: Self]) -> [TaskSuggestion] {
        var result = pending.filter { feedback[$0.id] == nil }
        for held in feedback.values {
            let nextID = held.followingIDs.first { id in result.contains { $0.id == id } }
            let index = nextID.flatMap { id in result.firstIndex { $0.id == id } } ?? result.count
            result.insert(held.before, at: index)
        }
        return result
    }
}
