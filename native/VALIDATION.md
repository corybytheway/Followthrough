# Local validation — October 14, 2026

Created by Cory McCabe.

Branch: `feature/native-local`. All task and authentication tests use the loopback server at `http://localhost:4318`, its local D1 database, and the simulated Sites workspace. No production workspace, calendar credentials, or real appointments were imported. This record distinguishes implementation from provider and device acceptance.

## Confirmed

| Area | Evidence |
| --- | --- |
| Server | 117 Node tests passed; TypeScript check and production web build passed. No deployment performed. |
| API sign-in | PKCE proof, one-use authorization code, browser approval origin, native bearer requirement, token refresh, and session revocation passed the local HTTP runner. |
| Workspace linking | iPhone browser sign-in displayed the local workspace approval and returned to the app with a saved Keychain session. |
| Shared workspace | A capture scheduled on the server, appeared through another device session and the website, and retained an edited title. Concurrent capture retries from two sessions produced exactly one task. A stale simultaneous edit returned 409. |
| iPhone core flow | Capture, restart, task search, edit/save/reopen, complete original input, projects, work-hours editor, and quick-capture presentation passed XCTest. |
| Offline recovery | With the backend stopped, capture survived app termination/relaunch. After restart, the iPhone found exactly one matching task. Independent server readback found one task and one scheduled session. |
| Mac | Development-signed build and launch passed. The final 25-second UI test passed Today capture with Enter, Command-N quick capture, Command-Return submission, Tasks, Projects, and Settings. Native sidebar, capture, and schedule were visually inspected in dark mode. Testing exposed and fixed a conflict with the default New Window shortcut. |
| Shared Mac storage | The development-signed App Group contains workspace, outbox, and widget cache files. An ad-hoc build's lack of shared access is reported and falls back to app-local storage. |
| Native share capture | The iPhone share extension saved text and a URL, then the main app imported exactly one task and displayed the complete original input. A fresh extension invocation showed the corrected save instructions. |
| Widgets | A small widget displayed a real cached task with a wrapped title. Tapping it with the app closed opened that exact task. The medium widget's Add link opened Quick capture. |
| Device calendar access | The real simulator EventKit prompt was granted. Settings listed three default simulator calendars and explicitly reported that no events were changed. Revoking permission hid the calendar list and displayed system-settings recovery guidance without a crash; permission was then restored through the system prompt. No personal calendar account was connected. |
| Server planning with apps closed | With both native main apps stopped, an isolated web API busy-time change displaced a 6:30–7:15 PM task to 7:15–8 PM, with zero overlaps. Reopening the iPhone verified both rows and their updated times. This verifies server-owned replanning, not live provider polling. Evidence: `outputs/native-ui-verification/closed-apps.json`. |
| Calendar contracts | Existing tests cover recurrence instances, IANA and embedded time zones, DST, all-day filtering, incomplete availability, provider authentication failures, conflict avoidance, and preserved current sessions. |
| Apple task publication | New protocol tests prove stable event IDs, retry deduplication, owner marking, ETag preflight, appointment preservation, collection confinement, and workspace-version checks. They do not contact a real Apple account. |
| Capacity | A bounded-worker test processes 20 selected workspaces with at most 4 concurrent workers. This is a capacity increase, not an unlimited-scale guarantee. |

Xcode 27.1 builds the Mac and iOS apps. The dedicated regular-iPhone simulator is iPhone 18 Pro on iOS 27.0; the installed iOS 27.1 runtime supports the additional Duo test simulator. The existing Orbit simulator was left alone.

The iPhone test evidence is saved in ignored `outputs/native-ui-verification/iphone/`, and the final Mac screenshots and accessibility hierarchies in `outputs/native-ui-verification/mac-final/`. Xcode result bundles remain in `native/DerivedData/Logs/Test/` and `/tmp/followthrough-*.xcresult`. Local credentials are ignored and are not part of this record.

## Acceptance still requiring a configured development environment

- Physical iPhone development signing, a provisioned App Group, and an HTTPS test API reachable from the phone. Simulator localhost is not a physical-device endpoint.
- Live Google and Apple task writes, destination migration, provider revocation, and external recurring-calendar changes using dedicated test calendars. Unit/protocol tests establish safeguards; they are not a claim of live-provider success.
- Provider-triggered and timed background scheduling with both apps closed. The production scheduler remains unchanged in the running service because this branch has not been deployed.
- Production native API admission at the invite-only hosting gateway. The application still authenticates every native request with a workspace-bound session; the deployed gateway also needs an explicit native-route policy before use.
- A local AI connection for real model-generated task planning. The isolated environment currently exercises the existing basic fallback and preserves the full input with a provisional estimate.

TestFlight, public distribution, subscriptions, and App Store submission remain outside this local development pass and require Cory's later direction.
