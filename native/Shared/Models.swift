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
}
struct FTTask: Codable, Identifiable, Hashable, Sendable {
    var id: String; var title: String; var projectId: String?; var notes: String; var source: String
    var steps: [FTStep]; var estimateMinutes: Int; var remainingMinutes: Int; var priority: Priority
    var status: String; var dueDate: String?; var notBefore: String?; var blockers: [String]; var splittable: Bool
    var createdAt: String; var updatedAt: String; var completedAt: String?; var deletedAt: String?
    var estimateProvisional: Bool?
    var active: Bool { deletedAt == nil && status != "archived" && status != "done" }
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
    func project(_ id: String?) -> FTProject? { projects.first { $0.id == id } }
    func label(_ task: FTTask) -> String { project(task.projectId).map { "\($0.label): \(task.title)" } ?? task.title }
    var availableTasks: [FTTask] { tasks.filter(\.active).sorted { a,b in
        if a.priority != b.priority { return a.priority.rank < b.priority.rank }
        return (a.dueDate ?? "9999", a.createdAt, a.id) < (b.dueDate ?? "9999", b.createdAt, b.id)
    } }
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
}
struct MutationResult: Decodable, Sendable { var state: Workspace }
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
