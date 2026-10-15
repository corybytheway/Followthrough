# Followthrough

Created by Cory McCabe.

Followthrough turns captured requests into tasks and plans work around connected calendars. This repository contains the SwiftUI iPhone and Mac apps, the website, and the shared server-side capture and scheduling logic.

## Repository and Apple app

- Canonical local checkout: `/Users/corymccabe/Documents/GitHub/Followthrough`
- Private repository: [corybytheway/Followthrough](https://github.com/corybytheway/Followthrough)
- App Store Connect: [Followthrough: Task Planner](https://appstoreconnect.apple.com/apps/6823012880/distribution/info), Apple ID `6823012880`
- Platforms: iOS and macOS; SKU: `followthrough`; app bundle ID: `com.ethos.followthrough`

Apple rejected the bare listing name “Followthrough” as already in use. The draft listing uses “Followthrough: Task Planner”; the device display name remains “Followthrough.” The earlier Codex checkout is retained as a fallback; continue development in the canonical checkout above.

## Native development

Open `native/Followthrough.xcodeproj` in Xcode. Use `FollowthroughIOS` for iPhone and `FollowthroughMac` for Mac. See [native setup and signing instructions](native/README.md) for local builds, device sign-in, and isolated test data.

The server owns scheduling and calendar publication. Native apps cache tasks and queue offline changes, then synchronize with the same workspace used by the website.

## Web development

See [web application setup](README-followthrough.md). Install JavaScript dependencies with `npm ci`. Keep environment files, local databases, credentials, build outputs, and development sessions outside Git.

## Branches and release status

- `main`: current native development and shared source.
- `web-production`: preserved website source baseline before native development.
- `feature/native-live-api`: preserved native API deployment work.

Creating an App Store Connect record does not submit or distribute an app. TestFlight, public distribution, subscriptions, and App Store submission remain separate, owner-directed steps.

The confirmed bundle ID has passed a signed physical-iPhone Debug build and a signed Mac Release build. The signed bundles were inspected for `com.ethos.followthrough` and `group.com.ethos.followthrough`. This setup created the app record only; no build was uploaded or submitted. The currently installed development apps remain in place.
