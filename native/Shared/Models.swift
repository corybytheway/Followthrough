// Created by Cory McCabe
import Foundation

enum JSONValue: Codable, Sendable, Equatable {
    case string(String), number(Double), bool(Bool), array([JSONValue]), object([String: JSONValue]), null
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let v = try? c.decode(Bool.self) { self = .bool(v) }
        else if let v = try? c.decode(Double.self) { self = .number(v) }
        else if let v = try? c.decode(String.self) { self = .string(v) }
        else if let v = try? c.decode([JSONValue].self) { self = .array(v) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let v): try c.encode(v)
        case .number(let v): try c.encode(v)
        case .bool(let v): try c.encode(v)
        case .array(let v): try c.encode(v)
        case .object(let v): try c.encode(v)
        case .null: try c.encodeNil()
        }
    }
}
enum Priority: String, Codable, CaseIterable, Identifiable, Sendable {
    case top, high, medium, low
    var id: String { rawValue }
    var title: String { rawValue.capitalized }
    var rank: Int { Self.allCases.firstIndex(of: self)! }
}
struct FTStep: Codable, Identifiable, Hashable, Sendable { var id: String; var title: String; var done: Bool }
struct FTProject: Codable, Identifiable, Hashable, Sendable {
    var id: String; var name: String; var shortName: String?; var aliases: [String]; var description: String; var color: String
    var label: String { shortName?.isEmpty == false ? shortName! : name }
    static func alphabetically(_ a: Self, _ b: Self) -> Bool {
        let order = a.name.compare(b.name, options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
        if order != .orderedSame { return order == .orderedAscending }
        if a.name != b.name { return a.name < b.name }
        return a.id < b.id
    }
}
enum ProjectKeywords {
    static func normalized(_ value: String) -> String {
        value.folding(options: .diacriticInsensitive, locale: Locale(identifier: "en_US_POSIX"))
            .lowercased().components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { !$0.isEmpty }.joined(separator: " ")
    }
    static func unique(_ values: [String]) -> [String] {
        var seen = Set<String>()
        return values.compactMap { value in
            let value = value.split(whereSeparator: \.isWhitespace).joined(separator: " ")
            guard !value.isEmpty else { return nil }
            let key = normalized(value)
            guard seen.insert(key.isEmpty ? value.lowercased() : key).inserted else { return nil }
            return value
        }
    }
    static func shortName(_ name: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "&"))
        let words = name.replacingOccurrences(of: "&", with: " & ")
            .components(separatedBy: allowed.inverted).filter { !$0.isEmpty }
        guard words.count >= 2 else { return name.trimmingCharacters(in: .whitespacesAndNewlines) }
        return words.map { ["and", "&"].contains($0.lowercased()) ? "&" : String($0.prefix(1)).uppercased() }.joined()
    }
    static func suggestions(name: String, shortName: String = "", projects: [FTProject] = [], projectID: String? = nil) -> [String] {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized(name).isEmpty else { return [] }
        let label = shortName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? Self.shortName(name) : shortName.trimmingCharacters(in: .whitespacesAndNewlines)
        let spaced = name.replacingOccurrences(of: "([a-z])([A-Z])", with: "$1 $2", options: .regularExpression)
            .replacingOccurrences(of: "\\bMc ([A-Z])", with: "Mc$1", options: .regularExpression)
        var candidates = [name.filter { !$0.isWhitespace }, spaced,
            name.replacingOccurrences(of: "&", with: "and"),
            name.replacingOccurrences(of: "\\band\\b", with: "&", options: [.regularExpression, .caseInsensitive])]
        if name.range(of: "^.+\\.[a-z]{2,}$", options: [.regularExpression, .caseInsensitive]) != nil,
           let dot = name.lastIndex(of: "."), let spacedDot = spaced.lastIndex(of: ".") {
            let suffix = name[name.index(after: dot)...]
            candidates += ["\(name[..<dot]) dot \(suffix)", "\(spaced[..<spacedDot]) dot \(suffix)"]
        }
        if label.range(of: "^[A-Z]{2,6}$", options: .regularExpression) != nil { candidates.append(label.map(String.init).joined(separator: " ")) }
        for (pattern, replacement) in [("Studios\\b", "Studio"), ("Notes\\b", "Note"), ("\\bBlanc\\b", "Blank"), ("\\bThomson\\b", "Thompson")] {
            if name.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil {
                candidates.append(name.replacingOccurrences(of: pattern, with: replacement, options: [.regularExpression, .caseInsensitive]))
            }
        }
        if normalized(name).replacingOccurrences(of: " ", with: "") == "metanote" { candidates += ["Meta Note", "Minnow", "Meta Notes", "Metta Note"] }
        if normalized(name) == "followthrough" { candidates.append("Follow through") }
        var excluded = Set([name, label].map(normalized))
        for project in projects where project.id != projectID {
            excluded.formUnion(([project.name, project.label] + project.aliases).map(normalized))
        }
        return Array(unique(candidates).filter { !$0.isEmpty && $0.utf16.count <= 100 && !excluded.contains(normalized($0)) }.prefix(8))
    }
}
struct FTTask: Codable, Identifiable, Hashable, Sendable {
    var id: String; var title: String; var projectId: String?; var notes: String; var source: String
    var steps: [FTStep]; var estimateMinutes: Int; var remainingMinutes: Int; var priority: Priority
    var status: String; var dueDate: String?; var notBefore: String?; var blockers: [String]; var splittable: Bool
    var createdAt: String; var updatedAt: String; var completedAt: String?; var deletedAt: String?
    var estimateProvisional: Bool?
    var captureGroupId: String?
    var captureIndex: Int?
    var active: Bool { deletedAt == nil && status != "archived" && status != "done" }
    func displayTitle(project: FTProject?, scopedProjectID: String? = nil) -> String {
        guard let project else { return title }
        guard scopedProjectID == project.id, projectId == project.id else {
            return "\(project.label): \(title)"
        }
        // Older imports can include project labels in the saved title. Hide
        // only this project's leading labels, without changing the task.
        var name = title.replacingOccurrences(of: "^(?:\\s*⚡[\\uFE0E\\uFE0F]?\\s*)+", with: "", options: .regularExpression)
            .replacingOccurrences(of: "^\\s+", with: "", options: .regularExpression)
        let labels = [project.label, project.name] + project.aliases
        while let range = labels.compactMap({ name.range(of: $0 + ": ", options: [.anchored, .caseInsensitive]) }).first {
            name.removeSubrange(range)
        }
        return name
    }
    var remainingLabel: String { Self.duration(remainingMinutes) }
    static func duration(_ minutes: Int) -> String {
        let hours = minutes / 60, rest = minutes % 60
        return hours > 0 ? "\(hours)h" + (rest > 0 ? " \(rest)m" : "") : "\(rest)m"
    }
}
struct FTBlock: Codable, Identifiable, Hashable, Sendable {
    var id: String; var taskId: String; var start: String; var end: String
    var startDate: Date { Date.iso(start) ?? .distantPast }
    var endDate: Date { Date.iso(end) ?? .distantPast }
}
struct FTBusy: Codable, Identifiable, Hashable, Sendable { var id: String; var title: String; var start: String; var end: String; var source: String }
struct FTWarning: Codable, Hashable, Sendable { var taskId: String; var reason: String; var message: String }
struct FTSettings: Codable, Hashable, Sendable {
    var timeZone: String; var workStart: String; var workEnd: String; var workDays: [Int]
    var maxBlockMinutes: Int; var breakEveryMinutes: Int; var breakMinutes: Int
}
struct Workspace: Codable, Sendable {
    var projects: [FTProject]; var tasks: [FTTask]; var busy: [FTBusy]; var blocks: [FTBlock]
    var settings: FTSettings; var plannedAt: String?; var currentDate: String; var revision: Int; var warnings: [FTWarning]
    var projectsAlphabetically: [FTProject] { projects.sorted(by: FTProject.alphabetically) }
    func project(_ id: String?) -> FTProject? { projects.first { $0.id == id } }
    func hasUnfinishedPrerequisites(for task: FTTask) -> Bool {
        task.blockers.contains { id in tasks.first(where: { $0.id == id })?.status != "done" }
    }
    func label(_ task: FTTask) -> String { project(task.projectId).map { "\($0.label): \(task.title)" } ?? task.title }
    var availableTasks: [FTTask] { tasks.filter(\.active).sorted { a,b in
        if a.priority != b.priority { return a.priority.rank < b.priority.rank }
        return (a.dueDate ?? "9999", a.createdAt, a.id) < (b.dueDate ?? "9999", b.createdAt, b.id)
    } }
    func tasksForList(includeCompleted: Bool) -> [FTTask] {
        let outstanding = tasks.filter(\.active).sorted {
            ($0.priority.rank, $0.createdAt, $0.id) < ($1.priority.rank, $1.createdAt, $1.id)
        }
        guard includeCompleted else { return outstanding }
        let completed = tasks.filter { $0.deletedAt == nil && $0.status == "done" }.sorted { a, b in
            // Server timestamps are normalized ISO 8601 strings. Keep older
            // completions stable when a finished task's details are edited.
            let aCompleted = a.completedAt.flatMap { $0.isEmpty ? nil : $0 } ?? (a.updatedAt.isEmpty ? a.createdAt : a.updatedAt)
            let bCompleted = b.completedAt.flatMap { $0.isEmpty ? nil : $0 } ?? (b.updatedAt.isEmpty ? b.createdAt : b.updatedAt)
            if aCompleted != bCompleted { return aCompleted > bCompleted }
            if a.createdAt != b.createdAt { return a.createdAt > b.createdAt }
            return a.id < b.id
        }
        return outstanding + completed
    }
    /// Search the whole workspace independently of the normal list filters.
    func tasksMatchingSearch(_ query: String) -> [FTTask] {
        guard !TaskSearch.normalizedQuery(query).isEmpty else { return [] }
        let archived = tasks.filter { $0.deletedAt == nil && $0.status == "archived" }.sorted {
            ($0.createdAt, $0.id) < ($1.createdAt, $1.id)
        }
        return (tasksForList(includeCompleted: true) + archived).filter {
            TaskSearch.matches($0, project: project($0.projectId), query: query)
        }
    }
    var todayTasks: [FTTask] {
        let ids = Set(blocks.filter { $0.endDate > Date() && day($0.startDate) == day(Date()) }.map(\.taskId))
        return availableTasks.filter { ids.contains($0.id) }
    }
    func day(_ date: Date) -> String {
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: settings.timeZone); formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }
}
struct NativeSession: Codable, Sendable {
    var accessToken: String; var refreshToken: String; var expiresAt: Double; var ownerId: String; var sessionId: String
}
struct PendingMutation: Codable, Identifiable, Sendable {
    var id: String = UUID().uuidString
    var endpoint: String
    var body: [String: JSONValue]
    var title: String
    var createdAt = Date()
    var baseTask: FTTask?
}
struct MutationResult: Decodable, Sendable {
    struct Result: Decodable, Sendable { var tasks: [FTTask]? }
    var state: Workspace
    var result: Result?

    /// Count only this request's durable batch, including an idempotent retry
    /// whose response contains only a duplicate flag. Never diff the workspace:
    /// another device may have created or edited tasks at the same time.
    func confirmedCapture(group: String) -> [FTTask]? {
        let tasks = state.tasks.filter { $0.captureGroupId == group }.sorted {
            let aIndex = $0.captureIndex ?? 0, bIndex = $1.captureIndex ?? 0
            if aIndex != bIndex { return aIndex < bIndex }
            return $0.id < $1.id
        }
        guard !tasks.isEmpty, Set(tasks.map(\.id)).count == tasks.count else { return nil }
        if let returned = result?.tasks,
           Set(returned.map(\.id)) != Set(tasks.map(\.id)) { return nil }
        return tasks
    }
}
struct CaptureReceipt: Identifiable, Sendable {
    enum Phase: Equatable, Sendable {
        case queued(String?)
        case sending
        case needsAttention(String)
        case saved([FTTask])
    }
    let id: String
    let source: String
    var phase: Phase
}
struct SharedPreview: Codable, Sendable {
    var title: String; var taskId: String?; var project: String?; var remaining: String?; var updatedAt: Date
}
extension Date {
    static func iso(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
}
struct SharedCapture: Codable { var identity: String; var source: String }
enum SharedStorage {
    static let group: String = {
        if let configured = Bundle.main.object(forInfoDictionaryKey: "FollowthroughAppGroup") as? String,
           !configured.isEmpty, !configured.contains("$(") {
            return configured
        }
        #if os(macOS)
        return "6G252Y8692.dev.ethosapps.followthrough.local"
        #elseif targetEnvironment(simulator)
        return "group.dev.ethosapps.followthrough.local"
        #else
        return "group.com.ethos.followthrough"
        #endif
    }()
    static let directory: URL = {
        let fm = FileManager.default
        if let shared = fm.containerURL(forSecurityApplicationGroupIdentifier: group) {
            do {
                try fm.createDirectory(at:shared,withIntermediateDirectories:true)
                let probe = shared.appendingPathComponent(UUID().uuidString + ".probe")
                try Data().write(to:probe,options:.atomic); try fm.removeItem(at:probe)
                return shared
            } catch { /* A local ad-hoc Mac build may not have App Group access. */ }
        }
        #if os(macOS) || targetEnvironment(simulator)
        let directoryName = "Followthrough Local"
        #else
        let directoryName = "Followthrough"
        #endif
        let local = fm.urls(for:.applicationSupportDirectory,in:.userDomainMask)[0].appendingPathComponent(directoryName,isDirectory:true)
        try? fm.createDirectory(at:local,withIntermediateDirectories:true)
        return local
    }()
    static var extensionsAvailable: Bool { directory == FileManager.default.containerURL(forSecurityApplicationGroupIdentifier:group) }
    static func savePreview(_ preview: SharedPreview) {
        if let data = try? JSONEncoder().encode(preview) { try? data.write(to: directory.appendingPathComponent("widget.json"), options: .atomic) }
    }
    static func preview() -> SharedPreview? {
        guard let data = try? Data(contentsOf: directory.appendingPathComponent("widget.json")) else { return nil }
        return try? JSONDecoder().decode(SharedPreview.self, from: data)
    }
    static func bind(_ identity: String) throws {
        try Data(identity.utf8).write(to:directory.appendingPathComponent("identity"),options:.atomic)
    }
    static func unbind() {
        try? FileManager.default.removeItem(at:directory.appendingPathComponent("identity"))
        try? FileManager.default.removeItem(at:directory.appendingPathComponent("widget.json"))
    }
    static func capture(_ source: String) throws {
        guard let identity = try? String(contentsOf:directory.appendingPathComponent("identity"),encoding:.utf8), !identity.isEmpty else { throw NSError(domain:"Followthrough",code:1,userInfo:[NSLocalizedDescriptionKey:"Open Followthrough and connect your workspace first."]) }
        let source = source.trimmingCharacters(in:.whitespacesAndNewlines)
        guard !source.isEmpty, source.utf16.count <= 8000 else { throw NSError(domain:"Followthrough",code:2,userInfo:[NSLocalizedDescriptionKey:"Enter a task with up to 8,000 characters."]) }
        let folder = directory.appendingPathComponent("Inbox", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try JSONEncoder().encode(SharedCapture(identity:identity,source:source)).write(to: folder.appendingPathComponent(UUID().uuidString + ".json"), options: .atomic)
    }
}


/// Shared search matching and bounded context for the native task lists.
enum TaskSearch {
    struct Excerpt: Equatable {
        enum Field { case originalInput, notes, step }
        let field: Field
        let text: String
        let matchingText: String
    }

    static func normalizedText(_ value: String) -> String {
        value.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    }
    static func normalizedQuery(_ value: String) -> String { normalizedText(value) }

    static func ranges(in text: String, query: String) -> [Range<String.Index>] {
        let query = normalizedQuery(query)
        guard !query.isEmpty else { return [] }
        var matches: [Range<String.Index>] = []
        var cursor = text.startIndex
        while cursor < text.endIndex,
              let range = text.range(of: query, options: [.caseInsensitive, .diacriticInsensitive], range: cursor..<text.endIndex, locale: .current) {
            guard !range.isEmpty else { break }
            matches.append(range)
            cursor = range.upperBound
        }
        return matches
    }

    private static func contains(_ value: String, query: String) -> Bool {
        normalizedText(value).range(of: normalizedQuery(query), options: [.caseInsensitive, .diacriticInsensitive], locale: .current) != nil
    }

    static func matches(_ task: FTTask, project: FTProject?, query: String) -> Bool {
        let query = normalizedQuery(query)
        guard !query.isEmpty else { return true }
        let fields = [task.title, task.source, task.notes] + task.steps.map(\.title)
            + (project.map { [$0.name, $0.label] } ?? [])
        return fields.contains { contains($0, query: query) }
    }

    static func excerpt(for task: FTTask, query: String) -> Excerpt? {
        let query = normalizedQuery(query)
        guard !query.isEmpty else { return nil }
        let fields: [(Excerpt.Field, String)] = [(.originalInput, task.source), (.notes, task.notes)]
            + task.steps.map { (.step, $0.title) }
        for (field, value) in fields {
            let text = normalizedText(value)
            guard let match = text.range(of: query, options: [.caseInsensitive, .diacriticInsensitive], locale: .current) else { continue }
            // Keep previews within 80 characters including clipping marks,
            // with just enough lead-in to recognize the highlighted match.
            let previewLimit = 78
            let matchOffset = text.distance(from: text.startIndex, to: match.lowerBound)
            let leading = text.count <= previewLimit ? matchOffset : min(16, matchOffset)
            let start = text.index(match.lowerBound, offsetBy: -leading)
            let end = text.index(start, offsetBy: previewLimit, limitedBy: text.endIndex) ?? text.endIndex
            let clippedMatchEnd = min(end, match.upperBound)
            let matchingText = String(text[match.lowerBound..<clippedMatchEnd])
            let excerpt = (start > text.startIndex ? "…" : "") + String(text[start..<end]) + (end < text.endIndex ? "…" : "")
            return Excerpt(field: field, text: excerpt, matchingText: matchingText)
        }
        return nil
    }
}


/// Compare only the fields a person actually changed. A newer timestamp alone
/// is not a conflict when another device changed a different field.
enum TaskEditReconciliation {
    enum Resolution {
        case retry(PendingMutation)
        case alreadyApplied
        case review
    }

    static func fields(_ task: FTTask) -> [String: JSONValue] {
        guard let data = try? JSONEncoder().encode(task),
              let value = try? JSONDecoder().decode(JSONValue.self, from: data),
              case .object(let fields) = value else { return [:] }
        return fields
    }

    static func changedFields(_ proposed: [String: JSONValue], from task: FTTask) -> [String: JSONValue] {
        let original = fields(task)
        return proposed.filter { $0.key != "expectedUpdatedAt" && $0.value != (original[$0.key] ?? .null) }
    }

    static func patch(_ operation: PendingMutation) -> [String: JSONValue]? {
        guard operation.endpoint == "api/native/workspace", operation.body["action"] == .string("update_task"),
              case .object(let fields) = operation.body["task"] else { return nil }
        return fields.filter { $0.key != "expectedUpdatedAt" }
    }

    /// Only the most recent edit can be a duplicate. An older matching
    /// patch may have been intentionally reversed by a later queued change.
    static func isLatestQueuedPatch(_ patch: [String: JSONValue], taskID: String, operations: [PendingMutation]) -> Bool {
        guard let latest = operations.last(where: {
            $0.endpoint == "api/native/workspace" && $0.body["action"] == .string("update_task") && $0.body["id"] == .string(taskID)
        }) else { return false }
        return Self.patch(latest) == patch
    }

    /// Later edits from this device may have been queued before the first
    /// save returned. Advance only values proven to be our acknowledged write;
    /// unrelated remote fields must still be checked against the older base.
    static func advance(_ next: PendingMutation, after sent: PendingMutation, confirmed: FTTask) -> PendingMutation {
        guard next.body["id"] == .string(confirmed.id), sent.body["id"] == .string(confirmed.id),
              let nextBase = next.baseTask, let sentBase = sent.baseTask,
              nextBase.id == confirmed.id, sentBase.id == confirmed.id,
              let sentPatch = patch(sent), patch(next) != nil else { return next }
        var baseline = fields(nextBase)
        let original = fields(sentBase), current = fields(confirmed)
        for (key, value) in sentPatch where (baseline[key] ?? .null) == (original[key] ?? .null) && (current[key] ?? .null) == value {
            baseline[key] = value
        }
        guard let data = try? JSONEncoder().encode(JSONValue.object(baseline)),
              let advanced = try? JSONDecoder().decode(FTTask.self, from: data) else { return next }
        var next = next; next.baseTask = advanced
        return next
    }

    static func resolve(_ operation: PendingMutation, latest: FTTask) -> Resolution {
        guard operation.body["id"] == .string(latest.id), latest.deletedAt == nil,
              latest.status != "archived", let patch = patch(operation), !patch.isEmpty else { return .review }
        let current = fields(latest)
        if patch.allSatisfy({ $0.value == (current[$0.key] ?? .null) }) { return .alreadyApplied }
        // Old outboxes did not store the original fields. Preserve those edits
        // for explicit review instead of guessing which version should win.
        guard let base = operation.baseTask, base.id == latest.id,
              base.deletedAt == nil, base.status != "archived" else { return .review }
        let original = fields(base)
        // Do not change the lifecycle of a task that was completed/reopened on
        // another device while a different edit was waiting locally.
        guard latest.status == base.status || patch["status"] == .string(latest.status) else { return .review }
        guard patch.allSatisfy({ key, value in
            let now = current[key] ?? .null
            return now == (original[key] ?? .null) || now == value
        }) else { return .review }
        var retry = operation
        var fields = patch
        fields["expectedUpdatedAt"] = .string(latest.updatedAt)
        retry.body["task"] = .object(fields)
        retry.baseTask = latest
        return .retry(retry)
    }
}

struct TaskSyncConflict: Identifiable {
    var id: String { operation.id }
    let operation: PendingMutation
    let latest: FTTask
    var patch: [String: JSONValue] { TaskEditReconciliation.patch(operation) ?? [:] }
}


/// Transient visual acknowledgment; the durable intent remains in the outbox.
struct TaskCompletionFeedback: Sendable {
    let id = UUID()
    let before: FTTask
    let status: String
    let blocks: [FTBlock]
}

enum TaskCompletionPresentation {
    static func blockedTaskID(_ operation: PendingMutation?) -> String? {
        guard let operation, case .string(let id) = operation.body["id"] else { return nil }
        return id
    }
    static func task(_ task: FTTask, operations: [PendingMutation], blocked: PendingMutation?) -> FTTask {
        guard task.deletedAt == nil, task.status != "archived", blockedTaskID(blocked) != task.id else { return task }
        var result = task
        for operation in operations where operation.endpoint == "api/native/workspace" && operation.body["action"] == .string("update_task") && operation.body["id"] == .string(task.id) {
            guard let fields = TaskEditReconciliation.patch(operation), case .string(let status) = fields["status"], ["ready", "waiting", "done"].contains(status) else { continue }
            if status == "done" && result.status != "done" {
                let format = ISO8601DateFormatter(); format.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                result.completedAt = format.string(from: operation.createdAt)
            } else if status != "done" { result.completedAt = nil }
            result.status = status
        }
        return result
    }
    static func workspace(_ workspace: Workspace, operations: [PendingMutation], blocked: PendingMutation?, feedback: [String: TaskCompletionFeedback]) -> Workspace {
        var result = workspace
        let blockedID = blockedTaskID(blocked)
        result.tasks = workspace.tasks.map { task in
            var result = Self.task(task, operations: operations, blocked: blocked)
            if task.deletedAt == nil, task.status != "archived", blockedID != task.id, let held = feedback[task.id] {
                // Keep the row in place long enough to see the checkmark, even
                // if a fast response has already completed/reordered the task.
                result.status = held.before.status
                result.completedAt = held.before.completedAt
            }
            return result
        }
        let active = Set(result.tasks.filter(\.active).map(\.id))
        let existing = Set(result.blocks.map(\.id))
        result.blocks += feedback.values.filter { blockedID != $0.before.id }.flatMap(\.blocks).filter { !existing.contains($0.id) }
        result.blocks = result.blocks.filter { active.contains($0.taskId) }
        return result
    }
}


struct TaskPrerequisiteGroup: Identifiable, Sendable {
    let project: FTProject?
    let tasks: [FTTask]
    var id: String { project.map { "project:" + $0.id } ?? "unassigned" }
}

enum TaskPrerequisites {
    static func groups(tasks: [FTTask], projects: [FTProject], excluding taskID: String, projectID: String?) -> [TaskPrerequisiteGroup] {
        let knownProjects = Set(projects.map(\.id))
        let candidates = tasks.filter { $0.id != taskID && $0.deletedAt == nil && ["ready", "waiting"].contains($0.status) }.sorted { a, b in
            let order = a.title.compare(b.title, options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
            if order != .orderedSame { return order == .orderedAscending }
            if a.title != b.title { return a.title < b.title }
            return a.id < b.id
        }
        let current = projects.first { $0.id == projectID }
        func group(_ project: FTProject?) -> TaskPrerequisiteGroup {
            TaskPrerequisiteGroup(project: project, tasks: candidates.filter { task in
                if let project { return task.projectId == project.id }
                return task.projectId.map { !knownProjects.contains($0) } ?? true
            })
        }
        var result = [group(current)]
        for project in projects.sorted(by: FTProject.alphabetically) where project.id != current?.id {
            let next = group(project)
            if !next.tasks.isEmpty { result.append(next) }
        }
        if current != nil {
            let unassigned = group(nil)
            if !unassigned.tasks.isEmpty { result.append(unassigned) }
        }
        return result
    }
}

extension Array where Element == String {
    subscript(prerequisite taskID: String) -> Bool {
        get { contains(taskID) }
        set {
            if newValue && !contains(taskID) { append(taskID) }
            else if !newValue { removeAll { $0 == taskID } }
        }
    }
}
