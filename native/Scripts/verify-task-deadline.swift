// Created by Cory McCabe
import Foundation

// xcrun swiftc native/Shared/Models.swift native/Scripts/verify-task-deadline.swift -o /tmp/followthrough-task-deadline
@main
struct VerifyTaskDeadline {
    static func deadline(_ day: String?, now: String, zone: String = "America/Chicago") -> TaskDeadline? {
        TaskDeadline(day: day, relativeTo: Date.iso(now)!, timeZone: TimeZone(identifier: zone)!)
    }

    static func main() {
        let now = "2026-11-04T19:00:00Z"
        precondition(deadline("2026-11-04", now: now)?.dayOffset == 0)
        precondition(deadline("2026-11-05", now: now)?.dayOffset == 1)
        precondition(deadline("2026-11-03", now: now)?.dayOffset == -1)
        precondition(deadline("2026-11-06", now: now)?.dayOffset == 2)
        precondition(deadline("2026-11-06", now: now)?.includesYear == false)
        precondition(deadline("2027-01-02", now: now)?.includesYear == true)
        precondition(deadline("2025-12-31", now: now)?.includesYear == true)

        // A date stays due for its entire day in the workspace, even when UTC
        // or the device's own time zone has already advanced to tomorrow.
        let midnightUTC = "2026-11-05T02:00:00Z"
        precondition(deadline("2026-11-04", now: midnightUTC)?.dayOffset == 0)
        precondition(deadline("2026-11-04", now: midnightUTC, zone: "Asia/Tokyo")?.dayOffset == -1)
        precondition(deadline("2026-11-05", now: "2026-11-04T12:30:00Z", zone: "Pacific/Kiritimati")?.dayOffset == 0)
        precondition(deadline("2026-11-04", now: "2026-11-05T05:59:59Z")?.dayOffset == 0)
        precondition(deadline("2026-11-04", now: "2026-11-05T06:00:00Z")?.dayOffset == -1)

        // Calendar-day arithmetic stays correct through both DST transitions,
        // leap days, and the year boundary.
        precondition(deadline("2026-03-09", now: "2026-03-08T06:30:00Z")?.dayOffset == 1)
        precondition(deadline("2026-11-02", now: "2026-11-01T05:30:00Z")?.dayOffset == 1)
        precondition(deadline("2028-02-29", now: "2028-02-28T18:00:00Z")?.dayOffset == 1)
        precondition(deadline("2027-01-01", now: "2026-12-31T18:00:00Z")?.dayOffset == 1)

        for invalid: String? in [nil, "", "2026-02-29", "2026-13-01", "2026-11-31", "2026-1-04", "2026-11-04T00:00:00Z", "not-a-date"] {
            precondition(deadline(invalid, now: now) == nil)
        }
        print("PASS: deadline days, workspace time zones, midnight, DST, years, leap days, and missing/invalid dates")
    }
}
