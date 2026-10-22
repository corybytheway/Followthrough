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
        for (estimate, remaining, roundedEstimate, roundedRemaining) in [(75, 30, 120, 75), (120, 75, 120, 75), (75, 75, 120, 120)] {
            let rounded = FTTask.editorDurations(estimate: estimate, remaining: remaining)
            precondition(rounded.estimate == roundedEstimate && rounded.remaining == roundedRemaining)
        }
        let reopened = FTTask.editorDurations(estimate: 2640, remaining: 255)
        precondition(reopened.estimate == 2640 && reopened.remaining == 255)
        let options = FTTask.durationOptions([2400, 2640, 2640])
        precondition(options.contains(2640) && options == FTTask.durationOptions(options + [60]))
        for (minutes, label) in [(720, "1d 4h"), (960, "2d"), (1800, "3d 6h"), (2640, "1w 4h"), (60000, "25w"), (0, "0m")] {
            precondition(FTTask.duration(minutes) == label)
        }
        print("PASS: workday/week labels, editor rounding, calendar-derived durations, and progress preservation on macOS and iOS")
    }
}
