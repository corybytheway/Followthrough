// Created by Cory McCabe
import Foundation

enum PhotoCaptureError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let message) = self { return message }; return nil }
}

enum PhotoDraftEvidence {
    static func projects(in source: String, from projects: [FTProject]) -> [FTProject] {
        let text = " " + normalized(source) + " "
        return projects.filter { project in
            ([project.name, project.label] + project.aliases).contains { label in
                mentions(label, in: text)
            }
        }
    }

    static func repeatedProject(in source: String, among matches: [FTProject]) -> FTProject? {
        guard matches.count == 1, let project = matches.first else { return nil }
        let lines = Set(source.split(whereSeparator: \.isNewline)
            .map { " " + normalized(String($0)) + " " })
        let labels = [project.name, project.label] + project.aliases
        // A lone mention can be app chrome. Require the full name and a second
        // distinct line referring to the same project before filling a blank.
        guard lines.contains(where: { mentions(project.name, in: $0) }),
              lines.filter({ line in labels.contains { mentions($0, in: line) } }).count > 1 else { return nil }
        return project
    }

    private static func mentions(_ label: String, in normalizedText: String) -> Bool {
        let keyword = normalized(label)
        return !keyword.isEmpty && normalizedText.contains(" " + keyword + " ")
    }

    private static func normalized(_ value: String) -> String {
        // Emoji presentation selectors can survive the alphanumeric split.
        ProjectKeywords.normalized(value.replacingOccurrences(of: "[\\uFE0E\\uFE0F]", with: "", options: .regularExpression))
    }

    static func calendarDays(in source: String) -> Set<String> {
        guard let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.date.rawValue) else { return [] }
        // A clock time is interpreted as a date on the current day by NSDataDetector.
        let text = source.replacingOccurrences(
            of: #"(?i)\b(?:\d{1,2}:\d{2}(?::\d{2})?(?:[ \t]*[ap]\.?m\.?)?|\d{1,2}[ \t]*[ap]\.?m\.?)\b"#,
            with: " ", options: .regularExpression
        ).replacingOccurrences(
            // "Due December 12" can otherwise be detected as a range starting today.
            of: #"(?i)\bdue(?:[ \t]+on)?[ \t]*:?[ \t]+"#, with: " ", options: .regularExpression
        )
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withFullDate]
        formatter.timeZone = .current
        return Set(detector.matches(in: text, range: NSRange(text.startIndex..., in: text))
            .compactMap { $0.date.map { formatter.string(from: $0) } })
    }
}

/// Images remain in the device inbox for Apple Intelligence; they are never uploaded.
struct PhotoCaptureIntake: Codable, Identifiable, Equatable, Sendable {
    var id = UUID().uuidString
    var identity: String
    var source: String
    var imageCount: Int
    var warnings: [String]
    var createdAt = Date()
    var drafts: [PhotoTaskDraft]?
    var imageNames: [String]?
    var interpretation: String?
    var interpretationWarnings: [String]?
    var draftOrigin: String?
    var approvedInShareSheet: Bool?
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

    static func nonblankSteps(_ steps: [String]) -> [String] {
        steps.filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }

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
    static func save(_ intake: PhotoCaptureIntake, images: [Data], directory: URL = SharedStorage.directory) throws {
        guard let names = intake.imageNames, names.count == images.count, !images.isEmpty else {
            throw PhotoCaptureError.message("The photos could not be saved. Share them again.")
        }
        let folder = try imageFolder(intake, directory: directory)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        do {
            for (name, data) in zip(names, images) {
                try data.write(to: folder.appendingPathComponent(name), options: .atomic)
            }
            var values = URLResourceValues(); values.isExcludedFromBackup = true
            var imageDirectory = folder; try imageDirectory.setResourceValues(values)
            try save(intake, directory: directory)
        } catch {
            try? FileManager.default.removeItem(at: folder)
            throw error
        }
    }
    private static func imageFolder(_ intake: PhotoCaptureIntake, directory: URL) throws -> URL {
        guard UUID(uuidString: intake.id) != nil, let names = intake.imageNames,
              (1...5).contains(names.count), Set(names).count == names.count,
              names.allSatisfy({ $0.range(of: "^[1-5]\\.jpg$", options: .regularExpression) != nil }) else {
            throw PhotoCaptureError.message("The saved photo references are invalid. Share the photos again.")
        }
        return directory.appendingPathComponent("PhotoInbox/Images", isDirectory: true).appendingPathComponent(intake.id, isDirectory: true)
    }
    static func imageURLs(_ intake: PhotoCaptureIntake, directory: URL = SharedStorage.directory) throws -> [URL] {
        let folder = try imageFolder(intake, directory: directory)
        return try (intake.imageNames ?? []).map { name in
            let url = folder.appendingPathComponent(name)
            guard FileManager.default.fileExists(atPath: url.path) else {
                throw PhotoCaptureError.message("A saved photo is missing. Share it again or use the text fallback.")
            }
            return url
        }
    }
    static func load(identity: String, directory: URL = SharedStorage.directory) throws -> [PhotoCaptureIntake] {
        let folder = directory.appendingPathComponent("PhotoInbox", isDirectory: true)
        guard FileManager.default.fileExists(atPath: folder.path) else { return [] }
        return try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil).compactMap { file in
            guard file.pathExtension == "json", let data = try? Data(contentsOf: file),
                  var intake = try? JSONDecoder().decode(PhotoCaptureIntake.self, from: data),
                  intake.identity == identity, UUID(uuidString: intake.id) != nil,
                  file.lastPathComponent == intake.id + ".json" else { return nil }
            intake.drafts = intake.drafts?.map { draft in
                var draft = draft
                draft.steps = PhotoTaskDraft.nonblankSteps(draft.steps)
                return draft
            }
            return intake
        }.sorted { ($0.createdAt, $0.id) < ($1.createdAt, $1.id) }
    }
    static func remove(_ id: String, directory: URL = SharedStorage.directory) throws {
        guard UUID(uuidString: id) != nil else { return }
        let file = directory.appendingPathComponent("PhotoInbox").appendingPathComponent(id + ".json")
        let images = directory.appendingPathComponent("PhotoInbox/Images").appendingPathComponent(id)
        if FileManager.default.fileExists(atPath: images.path) { try FileManager.default.removeItem(at: images) }
        if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) }
    }
}

/// Small on-device models sometimes emit one draft per step of the same outcome.
/// Merge only identical titles/projects/dates; distinct outcomes remain separate.
enum PhotoDraftConsolidation {
    private struct Key: Hashable {
        var title: String; var project: String?; var due: String?; var start: String?
    }
    static func merge(_ drafts: [PhotoTaskDraft]) -> [PhotoTaskDraft] {
        var result: [PhotoTaskDraft] = [], indexes: [Key: Int] = [:]
        func unique(_ values: [String]) -> [String] {
            var seen = Set<String>()
            return values.filter { seen.insert($0.trimmingCharacters(in: .whitespacesAndNewlines)).inserted }
        }
        for draft in drafts {
            let title = draft.title.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "en_US_POSIX"))
                .split(whereSeparator: \.isWhitespace).joined(separator: " ")
            let placeholder = title.trimmingCharacters(in: .whitespacesAndNewlines.union(.punctuationCharacters))
            guard !["", "none", "n/a", "no task", "no tasks", "no clear task", "no actionable task",
                    "no tasks found", "no tasks could be determined", "identify project context"].contains(placeholder) else { continue }
            let key = Key(title: title, project: draft.projectId, due: draft.dueDate, start: draft.notBefore)
            if let index = indexes[key] {
                result[index].steps = unique(result[index].steps + draft.steps)
                result[index].notes = unique([result[index].notes, draft.notes]).filter { !$0.isEmpty }.joined(separator: "\n\n")
                result[index].estimateMinutes = max(result[index].estimateMinutes, draft.estimateMinutes)
            } else {
                indexes[key] = result.count; result.append(draft)
            }
        }
        return result
    }
}
