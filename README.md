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
| **Apple Shortcuts & Siri** | A native **Capture a task** App Intent, plus a paired **Followthrough Task** shortcut for talking or typing requests directly into your workspace. |
| **iPhone Action Button** | Assign the Followthrough Task shortcut to the Action Button on a supported iPhone. |
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

The Swift apps expose **Capture a task** through App Intents. Use it in a shortcut or with Siri phrases such as “Capture a task in Followthrough” and “Add a task to Followthrough.” The action opens the app and saves the request on the device; it joins your plan when the app next connects.

### Followthrough Task shortcut

The paired shortcut lets you **talk or type a request**, saves it directly to the server, and returns a save confirmation without opening a browser.

1. Open the Shortcut connection controls in Followthrough's web Settings and install **Followthrough Task**.
2. Create a connection code, then edit the shortcut and replace `{}` in its first Text action with the entire code.
3. Run the shortcut from Shortcuts, or assign it through **iPhone Settings → Action Button → Shortcut → Followthrough Task** on a supported device.

This connection can create tasks only, and you can revoke or replace it in Settings. Keep your personal connection code private. See the [Shortcut connection details](README-followthrough.md#shortcut-connection) for the implementation.

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
