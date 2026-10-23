# Followthrough

**Capture what's next. Make time to follow through.**

Followthrough brings task capture, project organization, and calendar planning to **native SwiftUI apps for iPhone and Mac**, with a synchronized web workspace. Capture a request when it comes to mind, give it a clear next step, and plan the work around your connected calendars.

**Swift · SwiftUI · iOS · macOS · Apple Shortcuts · Web**

[Visit the Followthrough website](https://actions.followthrough.site/) · [Open the web app (invite-only beta)](https://followthrough.site/)

Created by Cory McCabe.

## Built for iPhone and Mac

The Apple apps are written in **Swift and SwiftUI**, with platform-specific navigation and system integrations alongside shared task models and workspace synchronization.

| Platform or integration | What it brings to your workflow |
| --- | --- |
| **iPhone · iOS** | Native tabs for Today, Tasks, Projects, and Settings; quick task capture; search; and project and task editing. |
| **Mac · macOS** | A native sidebar, project navigation, keyboard shortcuts, and a menu-bar panel for your next task and quick capture. Use **⌘N** to capture and **⌘R** to sync while in the app. |
| **Apple Shortcuts & Siri** | A native **Capture a task** action that saves in the background, plus an editable **Talk or Type** workflow using Apple’s input actions. |
| **iPhone Action Button** | Assign the **Followthrough Talk or Type** workflow to the Action Button on a supported iPhone. |
| **Apple Watch** | Capture directly in the Watch app using Apple’s dictation or text entry, with a durable queue that syncs through the paired iPhone’s signed-in workspace. |
| **Share extension · iOS** | Send text and links to Followthrough from another app's share sheet. |
| **WidgetKit** | See your next task from the last synchronized workspace, with its update time and a shortcut into capture. |
| **Web** | Capture, organize, and plan work in the browser using the same workspace and shared scheduling logic. |

The native apps cache your workspace and persist pending captures and edits on the device. When connected, they synchronize with the server, which owns scheduling and calendar publication.

## From a captured thought to a plan

- **Capture in your own words.** Turn requests into tasks with estimates, priorities, notes, and suggested steps. Keep the original input available for context.
- **Keep projects moving.** Organize tasks by project, customize project colors and capture keywords, and use **Blocked by** relationships to represent work that must happen first.
- **Plan around your calendar.** Schedule work within your working hours, work days, breaks, and session lengths, using connected calendars to avoid conflicts. Surface deadline and capacity warnings when work does not fit.
- **Adjust as the day changes.** Complete, postpone, hold, or reopen tasks and let the shared planner update the plan. A calendar session and a task's checklist remain separate from the task itself.
- **Pick up on another device.** Work with the same projects, tasks, and plan from iPhone, Mac, or the web.

Calendar availability integrations include Google Calendar, Apple/iCloud Calendar, and Zoho. Task-publication destinations depend on the deployed server's capabilities; see the [calendar destination details](native/README.md#calendar-destinations).

## Apple Shortcuts: two ways to capture

### Native app action

The Swift apps expose **Capture a task** through App Intents. Installing the app makes this action available in Shortcuts, along with Siri phrases such as “Capture a task in Followthrough” and “Add a task to Followthrough.” The action uses the signed-in workspace and saves in the background without opening Followthrough. It confirms the server’s task count when connected; requests that cannot sync remain in the device’s durable queue for retry.

For an explicit Talk / Type choice, add the [**Followthrough Talk or Type** workflow](public/shortcuts/Followthrough%20Talk%20or%20Type.shortcut) once. It uses Apple’s **Choose from Menu**, **Dictate Text**, and **Ask for Input** actions, then passes the result to **Capture a task**. Apple Shortcuts owns the input UI and permissions; Followthrough supplies the background save. The complete menu workflow requires this one-time addition and is not installed automatically with the app. Assign it through **iPhone Settings → Action Button → Shortcut → Followthrough Talk or Type**.

To change the native save action, edit [`native/Shared/CaptureIntent.swift`](native/Shared/CaptureIntent.swift) and ship an app update. To customize Talk / Type, edit the workflow’s actions in Apple Shortcuts. The web guidance in this branch should be published with the native release that supports background capture.

The workflow’s source is [`shortcuts/Followthrough Talk or Type.plist`](shortcuts/Followthrough%20Talk%20or%20Type.plist). Rebuild with `python3 scripts/build-native-shortcut.py --unsigned-output /tmp/Followthrough-native-unsigned.shortcut`, then sign with `shortcuts sign --mode anyone --input /tmp/Followthrough-native-unsigned.shortcut --output 'public/shortcuts/Followthrough Talk or Type.shortcut'`.

### Apple Watch

Open the companion Watch app and tap the large mint **+** to use Apple’s system keyboard or dictation. Tap **Done** to save immediately. The plus becomes a loading indicator until the exact capture batch is confirmed by the server, then its task details open in a sheet with the standard close control. Several created tasks appear together in a result list. There is no review screen or second Save step. Input and a stable request ID persist before submission; a failed local save keeps the input. After 20 seconds without confirmation, the plus returns with a tappable queued receipt instead of an indefinite spinner. **Saved on Watch** means the request is durably queued locally, while **Sent to iPhone** means the paired phone accepted it into its durable queue. Neither queued status claims the server has finished planning. The Watch uses the same queue and background delivery as its **Capture a task** action, without opening Followthrough on the phone.

Swipe or turn the Digital Crown to page 2 for active tasks, with project colors, duration, priority, and due dates. Tap a task to open labeled details, then use Back to return to the same list. The completion ring marks a task complete, and swiping left reveals a recoverable Trash action. The Watch keeps a bounded task cache; if a large workspace does not fit, the list states how many tasks are available and points to the full iPhone list. Connection and queued-request details are at the bottom of the list.

Two WidgetKit complications are included: **Capture a task** provides a bolt for circular or corner slots, and **Up next** provides a rectangular view of the current or next scheduled task. The bolt opens system text entry; Up next opens the same task details with a **Task actions** section: **Mark complete**, **Add more time**, **Postpone 1 day**, and **Push to next week**. Postpone uses the next workday; Push to next week uses the next Monday and advances to an allowed workday. Task actions use the same account-bound, durable Watch-to-phone queue; repeated delivery retains one request ID. The phone commits its queue and ownership receipts together before acknowledgment. Add time uses the existing graduated duration rule, while postpone respects workdays, the workspace time zone, and deadlines. The plan cache advances at scheduled block boundaries while the phone is away; opening the app or task refreshes automatically without an update timestamp or manual refresh row. The Watch app and complications share only this plan cache through an App Group. Watch-face color modes can override the mint accent.

The optional Shortcuts workflow still works on the Watch: enable **Show on Apple Watch** in its Details to use Apple Shortcuts’ Talk / Type actions and the same background save.

The first connection uses the account already signed into the iPhone app. Opening the Watch app requests that account link from the paired phone, including when the Watch app was installed after phone sign-in. **Connect to iPhone** retries the handoff without another login. The Watch receives an opaque workspace identifier, never the phone’s credentials. Requests stay bound to that identifier across account changes and retain one request ID across immediate delivery, background delivery, and server retries. Watch capture requires the paired iPhone for server sync; it is not a standalone cellular client. Watch Connectivity background delivery must be verified on real paired devices.

### Older Followthrough Task shortcuts

Previously paired **Followthrough Task** shortcuts can keep saving directly to the server. To stop using one, open **Settings → Apple Shortcuts → Older shortcuts → Disconnect older shortcut**. New installations use the built-in app actions above. See the [Shortcut connection details](README-followthrough.md#shortcut-connection) for the older integration's implementation.

## Explore the repository

| Location | Contents |
| --- | --- |
| [`native/App/`](native/App/) | SwiftUI iPhone and Mac apps, native navigation, capture, settings, and workspace synchronization. |
| [`native/Shared/`](native/Shared/) | Shared Swift models, App Intents, storage, and task handoff. |
| [`native/Widgets/`](native/Widgets/) | WidgetKit next-task widget. |
| [`native/Share/`](native/Share/) | iOS text and URL share extension. |
| [`shortcuts/`](shortcuts/) | Apple Shortcut source; the installable shortcut is in [`public/shortcuts/`](public/shortcuts/). |
| [`app/`](app/) and [`components/`](components/) | Web workspace and API routes, built with TypeScript and React on vinext. |
| [`lib/`](lib/) | Shared server-side capture, planning, calendar integrations, and workspace logic. |
| [`db/`](db/) and [`drizzle/`](drizzle/) | Cloudflare D1 schema and database migrations. |

## Development

### iPhone and Mac

Open [`native/Followthrough.xcodeproj`](native/Followthrough.xcodeproj) in Xcode:

- **FollowthroughIOS** — iPhone app.
- **FollowthroughMac** — Mac app.

Follow the [native setup and signing instructions](native/README.md) for local builds, device sign-in, isolated test data, and platform validation.

### Web and shared server

See the [web application setup](README-followthrough.md) for the local runtime, database migrations, calendar configuration, and validation commands. Install JavaScript dependencies with `npm ci`. Keep environment files, local databases, credentials, build outputs, and development sessions outside Git.

Source code is public. Hosted workspace access, TestFlight access, and App Store distribution are managed separately.
