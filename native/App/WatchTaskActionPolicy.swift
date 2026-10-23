// Created by Cory McCabe
import Foundation

/// Match the existing task-duration and calendar-action rules on the phone.
enum WatchTaskActionPolicy {
    static func addedTime(estimate: Int, remaining: Int) throws -> (estimate: Int, remaining: Int) {
        let normalized = FTTask.editorDurations(estimate: estimate, remaining: remaining)
        let next = normalized.estimate <= FTTask.workdayMinutes
            ? FTTask.durationPreset(max(60, normalized.estimate * 2)) : normalized.estimate + 240
        let remaining = normalized.remaining + next - normalized.estimate
        guard max(next, remaining) <= FTTask.maxTaskMinutes else { throw WatchTaskActionError.maximumTime }
        return (next, remaining)
    }

    static func postpone(from anchor: Date, timeZone: String, workDays: [Int], dueDate: String?, nextWeek: Bool = false) throws -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: timeZone) ?? .current
        var day = calendar.startOfDay(for: anchor)
        guard workDays.contains(where: { (0...6).contains($0) }) else { throw WatchTaskActionError.workdays }
        if nextWeek {
            // The calendar action uses the Monday after the scheduled task's day.
            let daysToMonday = (9 - calendar.component(.weekday, from: day)) % 7
            day = calendar.date(byAdding: .day, value: daysToMonday == 0 ? 7 : daysToMonday, to: day)!
        } else {
            day = calendar.date(byAdding: .day, value: 1, to: day)!
        }
        for _ in 0..<7 {
            if workDays.contains(calendar.component(.weekday, from: day) - 1) { break }
            day = calendar.date(byAdding: .day, value: 1, to: day)!
        }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        let until = formatter.string(from: day)
        guard dueDate == nil || dueDate! >= until else { throw WatchTaskActionError.deadline }
        return until
    }
}
