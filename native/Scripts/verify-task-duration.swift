// Created by Cory McCabe
import Foundation

// xcrun swiftc native/Shared/Models.swift native/Scripts/verify-task-duration.swift -o /tmp/followthrough-task-duration
@main
struct VerifyTaskDuration {
    static func main() {
        precondition(FTTask.durationPresets.map(FTTask.duration) == [
            "15m", "30m", "45m", "1h", "2h", "3h", "4h", "6h", "1d", "2d", "3d", "1w"
        ])
        precondition(FTTask.workdayMinutes == 480 && FTTask.workweekMinutes == 2400)
        precondition(Set(FTTask.durationPresets).count == FTTask.durationPresets.count)
        for (minutes, expected) in [(1, 15), (15, 15), (16, 30), (46, 60),
            (75, 120), (90, 120), (241, 360), (361, 480), (481, 720),
            (1800, 1920), (2401, 2640), (10080, 10080), (59999, 60000), (60000, 60000)] {
            precondition(FTTask.durationPreset(minutes) == expected)
        }
        for minutes in 1...FTTask.maxTaskMinutes {
            let rounded = FTTask.durationPreset(minutes)
            precondition(FTTask.durationPreset(rounded) == rounded)
            precondition(rounded >= minutes && rounded <= FTTask.maxTaskMinutes)
        }
        for (minutes, expected) in [(15, 60), (30, 60), (45, 120), (60, 120),
            (120, 240), (180, 360), (240, 480), (360, 720), (480, 960),
            (720, 960), (960, 1200), (1440, 1680), (2400, 2640), (2640, 2880), (59760, 60000)] {
            let next = FTTask.addedTime(estimate: minutes, remaining: minutes)
            precondition(next?.estimate == expected && next?.remaining == expected)
        }
        for (estimate, remaining, roundedEstimate, roundedRemaining) in [(75, 30, 120, 75), (120, 75, 120, 75), (75, 75, 120, 120)] {
            let rounded = FTTask.editorDurations(estimate: estimate, remaining: remaining)
            precondition(rounded.estimate == roundedEstimate && rounded.remaining == roundedRemaining)
        }
        let next = FTTask.addedTime(estimate: 120, remaining: 30)!
        let legacy = FTTask.addedTime(estimate: 75, remaining: 30)!
        precondition(legacy.estimate == 240 && legacy.remaining == 195)
        precondition(next.estimate == 240 && next.remaining == 150)
        let reopened = FTTask.editorDurations(estimate: next.estimate, remaining: next.remaining)
        precondition(reopened == next)
        let week = FTTask.addedTime(estimate: 2400, remaining: 15)!
        precondition(week.estimate == 2640 && week.remaining == 255)
        precondition(FTTask.addedTime(estimate: 60000, remaining: 30) == nil)
        precondition(FTTask.addedTime(estimate: 59999, remaining: 30) == nil)
        precondition(FTTask.addedTime(estimate: 120, remaining: 59999) == nil)
        let options = FTTask.durationOptions([2400, 2640, 2640])
        precondition(options.contains(2640) && options == FTTask.durationOptions(options + [60]))
        for estimate in stride(from: 15, through: FTTask.maxTaskMinutes, by: 15) {
            let remaining = max(15, estimate - 90)
            guard let next = FTTask.addedTime(estimate: estimate, remaining: remaining) else { continue }
            precondition(next.estimate - next.remaining == estimate - remaining)
            precondition(next.estimate > estimate && next.remaining > remaining)
        }
        for (minutes, label) in [(720, "1d 4h"), (960, "2d"), (1800, "3d 6h"), (2640, "1w 4h"), (60000, "25w"), (0, "0m")] {
            precondition(FTTask.duration(minutes) == label)
        }
        print("PASS: graduated Add time, workday/week labels, progress preservation, and duration limits on macOS and iOS")
    }
}
