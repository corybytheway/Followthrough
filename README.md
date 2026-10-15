# Followthrough

Created by Cory McCabe.

Followthrough turns captured requests into tasks and plans work around connected calendars. This repository contains the SwiftUI iPhone and Mac apps, the website, and the shared server-side capture and scheduling logic.

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
