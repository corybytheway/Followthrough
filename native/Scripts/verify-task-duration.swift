// Created by Cory McCabe
import Foundation

// xcrun swiftc native/Shared/Models.swift native/Scripts/verify-task-duration.swift -o /tmp/followthrough-task-duration
@main
struct VerifyTaskDuration {
    static func main() {
        precondition(FTTask.durationPresets.map(FTTask.duration) == [
            "15m", "30m", "45m", "1h", "2h", "3h", "4h", "6h", "8h", "1d", "2d", "3d", "1w"
        ])
        precondition(FTTask.durationPresets[9] == 24 * 60)
        precondition(FTTask.durationPresets[12] == 7 * 24 * 60)
        for (minutes, expected) in [(1, 15), (15, 15), (16, 30), (46, 60),
            (75, 120), (90, 120), (241, 360), (361, 480), (481, 1440),
            (1800, 2880), (4321, 10080), (10080, 10080), (10155, 10080), (60000, 10080)] {
            precondition(FTTask.durationPreset(minutes) == expected)
        }
        for minutes in 1...60000 {
            let rounded = FTTask.durationPreset(minutes)
            precondition(FTTask.durationPresets.contains(rounded))
            precondition(FTTask.durationPreset(rounded) == rounded)
            precondition(minutes > 10080 ? rounded == 10080 : rounded >= minutes)
        }
        precondition(FTTask.duration(1800) == "1d 6h")
        precondition(FTTask.duration(10155) == "1w 1h 15m")
        precondition(FTTask.duration(60000) == "5w 6d 16h")
        precondition(FTTask.duration(0) == "0m")
        print("PASS: duration rounding, one-week cap, and exact labels on macOS and iOS")
    }
}
