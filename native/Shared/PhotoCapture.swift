// Created by Cory McCabe
import Foundation

enum PhotoCaptureError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let message) = self { return message }; return nil }
}

/// Image bytes never enter the shared inbox or the task-generation request.
struct PhotoCaptureIntake: Codable, Identifiable, Equatable, Sendable {
    var id = UUID().uuidString
    var identity: String
    var source: String
    var imageCount: Int
    var warnings: [String]
    var createdAt = Date()
    var drafts: [PhotoTaskDraft]?
}

struct PhotoTaskDraft: Codable, Identifiable, Equatable, Sendable {
    var id = UUID()
    enum CodingKeys: String, CodingKey {
        case title, projectId, steps, estimateMinutes, estimateProvisional, priority, dueDate, notBefore
        case notes, rationale, blockedByTaskIndexes, captureMode
    }
    var title: String
    var projectId: String?
    var steps: [String]
    var estimateMinutes: Int
    var estimateProvisional: Bool?
    var priority: String
    var dueDate: String?
    var notBefore: String?
    var notes: String
    var rationale: String
    var blockedByTaskIndexes: [Int]
    var captureMode: String

    static func basic() -> Self {
        .init(title: "Review shared photo", steps: ["Check the extracted text and clarify the action to take."],
              estimateMinutes: 30, estimateProvisional: true, priority: "medium", notes: "",
              rationale: "Basic draft. Review the task and estimate before adding it to your plan.",
              blockedByTaskIndexes: [], captureMode: "basic")
    }

    static func validate(_ drafts: [Self], source: String, projects: [FTProject]) throws {
        try PhotoCaptureInbox.validateSource(source)
        guard (1...20).contains(drafts.count) else { throw PhotoCaptureError.message("Review between 1 and 20 task drafts.") }
        for (index, draft) in drafts.enumerated() {
            guard !draft.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, draft.title.utf16.count <= 200,
                  (1...60000).contains(draft.estimateMinutes), ["top", "high", "medium", "low"].contains(draft.priority),
                  ["basic", "ai"].contains(draft.captureMode), draft.notes.utf16.count <= 10000,
                  draft.steps.count <= 50, draft.steps.allSatisfy({ !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && $0.utf16.count <= 500 }) else {
                throw PhotoCaptureError.message("Check task \(index + 1): use a title up to 200 characters, valid steps, and an estimate from 1 to 60,000 minutes.")
            }
            if let project = draft.projectId, !projects.contains(where: { $0.id == project }) {
                throw PhotoCaptureError.message("Choose an existing project for task \(index + 1).")
            }
            for day in [draft.dueDate, draft.notBefore].compactMap({ $0 }) {
                let parser = DateFormatter()
                parser.locale = Locale(identifier: "en_US_POSIX"); parser.timeZone = TimeZone(secondsFromGMT: 0)
                parser.dateFormat = "yyyy-MM-dd"; parser.isLenient = false
                guard day.range(of: "^\\d{4}-\\d{2}-\\d{2}$", options: .regularExpression) != nil,
                      let date = parser.date(from: day), parser.string(from: date) == day else {
                    throw PhotoCaptureError.message("Choose a valid date for task \(index + 1).")
                }
            }
            if let start = draft.notBefore, let due = draft.dueDate, start > due {
                throw PhotoCaptureError.message("The deadline must be on or after the start date for task \(index + 1).")
            }
            guard Set(draft.blockedByTaskIndexes).count == draft.blockedByTaskIndexes.count,
                  draft.blockedByTaskIndexes.allSatisfy({ drafts.indices.contains($0) && $0 != index }) else {
                throw PhotoCaptureError.message("The draft prerequisites need to be generated again.")
            }
        }
        var visited = Set<Int>(), visiting = Set<Int>()
        func visit(_ index: Int) throws {
            if visited.contains(index) { return }
            guard visiting.insert(index).inserted else { throw PhotoCaptureError.message("The draft prerequisites form a cycle. Generate the drafts again.") }
            for dependency in drafts[index].blockedByTaskIndexes { try visit(dependency) }
            visiting.remove(index); visited.insert(index)
        }
        for index in drafts.indices { try visit(index) }
    }

    func taskBody(source: String) throws -> JSONValue {
        guard case .object(var body) = try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(self)) else {
            throw PhotoCaptureError.message("Could not prepare this task. Your draft is still saved.")
        }
        body["source"] = .string(source); body["status"] = .string("ready")
        // Optional dates/projects must remain explicit nulls, not absent fields.
        body["projectId"] = projectId.map(JSONValue.string) ?? .null
        body["dueDate"] = dueDate.map(JSONValue.string) ?? .null
        body["notBefore"] = notBefore.map(JSONValue.string) ?? .null
        return .object(body)
    }
}

enum PhotoCaptureInbox {
    static func validateSource(_ source: String) throws {
        guard !source.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, source.utf16.count <= 8000 else {
            throw PhotoCaptureError.message("Add or edit the photo's text and context to use between 1 and 8,000 characters.")
        }
    }
    /// Match the native relay's existing 100 KB JSON-body limit before enqueueing.
    static func validateSubmission(_ body: [String: JSONValue], requestID: String) throws {
        var body = body
        body["requestId"] = .string(requestID)
        guard try JSONEncoder().encode(body).count <= 100000 else {
            throw PhotoCaptureError.message("This batch is too large to send. Shorten the original text or notes, or remove some drafts, then try again.")
        }
    }
    static func boundIdentity(directory: URL = SharedStorage.directory) -> String? {
        guard let identity = try? String(contentsOf: directory.appendingPathComponent("identity"), encoding: .utf8), !identity.isEmpty else { return nil }
        return identity
    }
    static func save(_ intake: PhotoCaptureIntake, directory: URL = SharedStorage.directory) throws {
        guard intake.source.utf16.count <= 64000 else { throw PhotoCaptureError.message("Shorten the photo text before saving your edits.") }
        guard UUID(uuidString: intake.id) != nil, !intake.identity.isEmpty, (1...5).contains(intake.imageCount) else {
            throw PhotoCaptureError.message("Share between 1 and 5 photos into a connected workspace.")
        }
        let folder = directory.appendingPathComponent("PhotoInbox", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try JSONEncoder().encode(intake).write(to: folder.appendingPathComponent(intake.id + ".json"), options: .atomic)
    }
    static func load(identity: String, directory: URL = SharedStorage.directory) throws -> [PhotoCaptureIntake] {
        let folder = directory.appendingPathComponent("PhotoInbox", isDirectory: true)
        guard FileManager.default.fileExists(atPath: folder.path) else { return [] }
        return try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil).compactMap { file in
            guard file.pathExtension == "json", let data = try? Data(contentsOf: file),
                  let intake = try? JSONDecoder().decode(PhotoCaptureIntake.self, from: data),
                  intake.identity == identity, UUID(uuidString: intake.id) != nil,
                  file.lastPathComponent == intake.id + ".json" else { return nil }
            return intake
        }.sorted { ($0.createdAt, $0.id) < ($1.createdAt, $1.id) }
    }
    static func remove(_ id: String, directory: URL = SharedStorage.directory) throws {
        guard UUID(uuidString: id) != nil else { return }
        let file = directory.appendingPathComponent("PhotoInbox").appendingPathComponent(id + ".json")
        if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) }
    }
}
