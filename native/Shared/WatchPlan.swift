// Created by Cory McCabe
import Foundation

struct WatchPlanTask: Codable, Equatable, Identifiable, Sendable {
    let id: String
    let title: String
    let project: String?
    let remainingMinutes: Int
    let updatedAt: String
    let canComplete: Bool
    var projectName: String? = nil
    var projectColor: String? = nil
    var estimateMinutes: Int? = nil
    var priority: WatchTaskPriority? = nil
    var dueDate: String? = nil
    var status: String? = nil

    var remainingLabel: String { Self.duration(remainingMinutes) }
    var durationLabel: String { Self.duration(estimateMinutes ?? remainingMinutes) }
    var canPostpone: Bool { status == nil || status == "ready" }

    private static func duration(_ value: Int) -> String {
        let hours = value / 60, minutes = value % 60
        if hours == 0 { return "\(minutes)m" }
        return minutes == 0 ? "\(hours)h" : "\(hours)h \(minutes)m"
    }

    var valid: Bool {
        !id.isEmpty && id.utf16.count <= 200 && !title.isEmpty && title.utf16.count <= 4000
            && (0...60000).contains(remainingMinutes) && updatedAt.utf16.count <= 100
            && estimateMinutes.map { (0...60000).contains($0) } != false
            && project.map { $0.utf16.count <= 200 } != false
            && projectName.map { $0.utf16.count <= 400 } != false
            && projectColor.map { $0.utf16.count <= 20 } != false
            && dueDate.map { WatchCalendarDay.date($0) != nil } != false
            && status.map { $0.utf16.count <= 40 } != false
    }
}

enum WatchTaskPriority: String, Codable, Sendable {
    case top, high, medium, low
    var title: LocalizedStringResource {
        switch self {
        case .top: "Top"
        case .high: "High"
        case .medium: "Medium"
        case .low: "Low"
        }
    }
    var listLabel: LocalizedStringResource {
        switch self {
        case .top: "Top priority"
        case .high: "High priority"
        case .medium: "Medium priority"
        case .low: "Low priority"
        }
    }
}

/// Deadlines are calendar days, not midnight UTC timestamps.
enum WatchCalendarDay {
    static func date(_ value: String, calendar: Calendar = Calendar(identifier: .gregorian)) -> Date? {
        let parts = value.split(separator: "-")
        guard parts.count == 3, parts[0].count == 4, parts[1].count == 2, parts[2].count == 2,
              let year = Int(parts[0]), let month = Int(parts[1]), let day = Int(parts[2]),
              let date = calendar.date(from: DateComponents(year: year, month: month, day: day, hour: 12)),
              calendar.component(.year, from: date) == year, calendar.component(.month, from: date) == month,
              calendar.component(.day, from: date) == day else { return nil }
        return date
    }
}

struct WatchPlanBlock: Codable, Equatable, Sendable {
    let task: WatchPlanTask
    let start: Date
    let end: Date
}

/// A bounded, account-bound copy of active tasks and scheduled work. No credentials.
struct WatchPlanSnapshot: Codable, Equatable, Sendable {
    let workspaceID: String
    let updatedAt: Date
    let blocks: [WatchPlanBlock]
    var tasks: [WatchPlanTask]? = nil
    var totalTaskCount: Int? = nil
    var timeZone: String? = nil
    /// The app's priority/deadline order, independent of block or task-list order.
    var taskOrder: [String]? = nil

    /// Older cached plans contain scheduled blocks only. Keep them usable offline.
    var listedTasks: [WatchPlanTask] {
        if let tasks { return tasks }
        var seen = Set<String>()
        return blocks.sorted { $0.start < $1.start }.compactMap {
            seen.insert($0.task.id).inserted ? $0.task : nil
        }
    }

    /// Leave room in WatchConnectivity's message for the account and envelope.
    static func bounded(workspaceID: String, updatedAt: Date, blocks: [WatchPlanBlock], tasks: [WatchPlanTask],
                        timeZone: String? = nil, taskOrder: [String]? = nil) -> Self {
        let retainedBlocks = Array(blocks.prefix(24))
        let scheduledIDs = Set(retainedBlocks.map { $0.task.id })
        var result = Self(workspaceID: workspaceID, updatedAt: updatedAt, blocks: retainedBlocks,
                          tasks: Array(tasks.prefix(128)), totalTaskCount: tasks.count,
                          timeZone: timeZone, taskOrder: taskOrder?.filter { scheduledIDs.contains($0) })
        while ((try? JSONEncoder().encode(result).count) ?? Int.max) > 44_000 {
            if result.tasks?.isEmpty == false { result.tasks?.removeLast() }
            else if result.blocks.count > 1 {
                result = Self(workspaceID: workspaceID, updatedAt: updatedAt, blocks: Array(result.blocks.dropLast()),
                              tasks: result.tasks, totalTaskCount: tasks.count,
                              timeZone: result.timeZone, taskOrder: result.taskOrder)
            } else { break }
        }
        return result
    }

    func next(at date: Date = .now) -> WatchPlanBlock? {
        let calendar = calendar
        let ranks = Dictionary(uniqueKeysWithValues: (taskOrder ?? []).enumerated().map { ($0.element, $0.offset) })
        return blocks.filter { $0.end > date && calendar.isDate($0.start, inSameDayAs: date) }.sorted {
            let a = ranks[$0.task.id] ?? Int.max, b = ranks[$1.task.id] ?? Int.max
            if a != b { return a < b }
            if $0.start != $1.start { return $0.start < $1.start }
            return $0.task.id < $1.task.id
        }.first
    }

    func task(_ id: String) -> WatchPlanTask? { tasks?.first { $0.id == id } ?? blocks.first { $0.task.id == id }?.task }

    func nextBlock(for id: String, at date: Date = .now) -> WatchPlanBlock? {
        blocks.filter { $0.task.id == id && $0.end > date }.min { $0.start < $1.start }
    }

    private var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone.flatMap(TimeZone.init(identifier:)) ?? .current
        return calendar
    }

    /// Advance at block boundaries and local midnight without needing the phone.
    func timelineDates(from now: Date) -> [Date] {
        [now] + Set(blocks.flatMap { [calendar.startOfDay(for: $0.start), $0.start, $0.end] }.filter { $0 > now }).sorted()
    }

    var valid: Bool {
        workspaceID.count == 64 && workspaceID.allSatisfy(\.isHexDigit) && blocks.count <= 64
            && blocks.allSatisfy { $0.task.valid && $0.start < $0.end }
            && tasks.map { $0.count <= 128 && $0.allSatisfy(\.valid) && Set($0.map(\.id)).count == $0.count } != false
            && totalTaskCount.map { $0 >= (tasks?.count ?? 0) } != false
            && timeZone.map { TimeZone(identifier: $0) != nil } != false
            && taskOrder.map { $0.count <= 64 && Set($0).count == $0.count
                && $0.allSatisfy { !$0.isEmpty && $0.utf16.count <= 200 } } != false
    }
}

enum WatchTaskActionKind: String, Codable, CaseIterable, Sendable {
    case complete, addTime, postpone, nextWeek, trash
}

struct WatchTaskAction: Codable, Equatable, Sendable {
    let taskID: String
    let updatedAt: String
    let kind: WatchTaskActionKind
    var valid: Bool { !taskID.isEmpty && taskID.utf16.count <= 200 && !updatedAt.isEmpty && updatedAt.utf16.count <= 100 }
}

enum WatchTaskActionError: LocalizedError {
    case stale, unavailable, blocked, maximumTime, deadline, workdays
    var errorDescription: String? {
        switch self {
        case .stale: "This task changed. Its details are updating. Try the action again in a moment."
        case .unavailable: "This task is no longer available."
        case .blocked: "Finish this task’s blockers before marking it complete."
        case .maximumTime: "This task has reached the maximum duration."
        case .deadline: "Postponing would pass this task’s deadline. Change its deadline in Followthrough first."
        case .workdays: "Choose at least one workday in Followthrough before postponing a task."
        }
    }
}

/// Only the Watch app and its complication extension share this cache.
enum WatchPlanStorage {
    static var file: URL? {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "FollowthroughWatchAppGroup") as? String,
              let root = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) else { return nil }
        return root.appendingPathComponent("Library/Application Support/WatchPlan/plan.json")
    }
    static func load() -> WatchPlanSnapshot? {
        guard let file, let data = try? Data(contentsOf: file),
              let value = try? JSONDecoder().decode(WatchPlanSnapshot.self, from: data), value.valid else { return nil }
        return value
    }
    static func save(_ snapshot: WatchPlanSnapshot?) throws {
        guard let file else { throw WatchCaptureError.storage }
        if let snapshot {
            guard snapshot.valid else { throw WatchCaptureError.invalidRequest }
            try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            try JSONEncoder().encode(snapshot).write(to: file, options: .atomic)
        } else if FileManager.default.fileExists(atPath: file.path) {
            try FileManager.default.removeItem(at: file)
        }
    }
}
