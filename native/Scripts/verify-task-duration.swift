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
        for current in [1, 75, 90, 1800, 60000] {
            let options = FTTask.durationOptions(current: current)
            precondition(options.contains(current))
            precondition(FTTask.durationPresets.allSatisfy(options.contains))
            precondition(options.count == FTTask.durationPresets.count + 1)
        }
        precondition(FTTask.durationOptions(current: 60) == FTTask.durationPresets)
        precondition(FTTask.duration(1800) == "1d 6h")
        precondition(FTTask.duration(10155) == "1w 1h 15m")
        precondition(FTTask.duration(60000) == "5w 6d 16h")
        precondition(FTTask.duration(0) == "0m")
        print("PASS: duration presets, units, and existing values on macOS and iOS")
    }
}
