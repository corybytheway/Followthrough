# Followthrough for iPhone and Mac — local development

Created by Cory McCabe.

This branch adds locally runnable SwiftUI clients to Followthrough. The app can use either an isolated development workspace or your existing Followthrough account. TestFlight, public native distribution, and subscriptions remain separate later steps.

## Open and run

Open `native/Followthrough.xcodeproj`. The shared schemes are `FollowthroughMac` and `FollowthroughIOS`. Use Debug for local testing. The default server is `http://localhost:4318` and all test tasks belong to the local Sites identity, `seedy@sites.test`.

From the repository root:

```sh
npm install
npx wrangler d1 migrations apply DB --local --config native/Config/wrangler.local.json --persist-to .wrangler/state
npm run dev -- --host 127.0.0.1 --port 4318
```

Leave that terminal running. In another terminal, create isolated sample data and test device sessions:

```sh
node native/Scripts/verify-local.mjs
```

The runner writes ignored, owner-readable `native/local-session.json` and `native/local-session-ios.json` files. These are local bearer credentials: do not commit or share them. They are optional; **Local development → Connect to development server** exercises browser sign-in, workspace approval, and the real PKCE callback against the loopback server. The primary **Connect your workspace** action opens the live service. `/signin-with-chatgpt` uses the Sites local-only identity. Production credentials are never needed for that test.

Mac:

```sh
xcodebuild -project native/Followthrough.xcodeproj -scheme FollowthroughMac \
  -configuration Debug -derivedDataPath native/DerivedData \
  CODE_SIGN_IDENTITY='Apple Development: Cory McCabe (PB32N9RX37)' \
  DEVELOPMENT_TEAM=6G252Y8692 ONLY_ACTIVE_ARCH=YES build
python3 native/Scripts/run-local.py mac
```

iPhone simulator:

```sh
xcodebuild -project native/Followthrough.xcodeproj -scheme FollowthroughIOS \
  -configuration Debug -sdk iphonesimulator \
  -derivedDataPath native/DerivedData ONLY_ACTIVE_ARCH=YES build
python3 native/Scripts/run-local.py ios --simulator SIMULATOR_UDID
```

Use an available booted simulator from `xcrun simctl list devices available`; do not replace another project's active simulator. Tested destinations on this Mac are **Native Local Planning iPhone**, iPhone 18 Pro / iOS 27.0 (`F2368C08-6127-4D79-A918-A691D4CB6C4D`), and **Native Local Planning**, iPhone Duo / iOS 27.1 (`B9514E15-4871-4702-B821-6B340F7E7F66`). The installed 27.1 runtime supports Duo only.

Pass `--no-session` to the launcher to use browser sign-in or the Keychain session instead of the optional test credential file. Stop a previously launched Mac instance before relaunching it.

## What is implemented

- Shared task/project models and SwiftUI views; native iPhone tabs and Mac sidebar.
- Mac projects open directly from colored folders in the sidebar. The section's plus creates a project; the project toolbar or context menu opens its editor. iPhone keeps a Projects tab with a remembered grid/list choice, starting in grid view.
- Today, schedule, task search, project editing, task details, suggested-step completion, prerequisites, and expanded selectable original input.
- Capture on Today; Return submits and Shift-Return adds a line. Mac Command-N opens quick capture, Command-Return submits it, and Command-R synchronizes. A menu-bar entry provides quick capture and the next task.
- Task completion, postponement, next-workweek move, adding an hour, deletion, and the full-context handoff to Codex on Mac and ChatGPT on iPhone. The handoff starts with a request to plan before acting; the app does not assert that a URL can force the recipient's native Plan-mode setting.
- A WidgetKit next-task widget, an App Intent for Shortcuts/Siri/Action Button, and an iOS text/URL share extension. Shared captures are persisted locally and uploaded when the main app next connects. Widgets show cached information and its update time.
- Optional EventKit access validation that lists device calendars without changing their events.
- Existing capture pipeline, planner, project names, priorities, and calendar rules remain on the server. Without a local AI connection, the existing basic fallback preserves the source and uses a provisional estimate; no AI key is bundled in the app.

## Authentication and synchronization

`/native/connect` displays the signed-in workspace identity before an explicit approval. The authorization code lasts two minutes, is single-use, and requires the device's SHA-256 PKCE proof. Native APIs require their own bearer session; web cookies are not accepted as native API authorization. Server records store token hashes. Access tokens last 15 minutes, refresh credentials expire absolutely after 90 days, and disconnect revokes the device session.

The device stores credentials in Keychain. API requests refuse redirects and use HTTPS except for loopback development. Session data is excluded from widgets and share extensions.

Task snapshots and the mutation outbox are scoped to server + workspace identity. Captures and edits are written atomically before the UI acknowledges them. The client drains changes in order, refreshes when foregrounded, and polls every 20 seconds while open. Capture IDs remain stable across retries and app restarts. Task edits/deletions require the version that the editor opened; a conflicting edit pauses the queue instead of overwriting a newer task. The saved change can be discarded explicitly after reviewing the server version.

The server is the only scheduling/publication authority. Device suspension does not become a scheduling dependency. Existing private scheduled invocations remain responsible for provider polling and publication. This branch raises the per-invocation batch from 2 to 20 workspaces with at most 4 concurrent workers; it is bounded capacity, not a guarantee for unlimited accounts.

## Calendar destinations

The web calendar settings now offer Google or a connected Apple calendar as the task destination. Native Settings opens that same account-scoped manager. The iCloud writer uses deterministic event IDs, an owner marker, `If-None-Match` for creation, and ETags for changes/deletion. It validates the whole listing before writing, refuses objects outside the chosen calendar, and never deletes unmarked appointments. A destination change retains a cleanup checkpoint until old owned events have been removed.

All selected calendar providers must return availability before the plan is published. Existing recurrence/time-zone handling, own-event exclusion, revision checks, calendar locks, and failure handling remain in force.

Use **dedicated test calendars** for the next provider acceptance pass. No real Google, iCloud, or Zoho connection has been imported into this local database. Protocol tests are not evidence of successful writes to a live Apple account.

## Signing and physical devices

The local Mac build uses the existing Ethos Apps development certificate. Its team-prefixed App Group (`6G252Y8692.dev.ethosapps.followthrough.local`) supports shared widget/intent storage without creating a distribution profile. See [Apple's Mac App Group guidance](https://developer.apple.com/documentation/xcode/accessing-app-group-containers). An ad-hoc Mac build can run with `CODE_SIGNING_ALLOWED=NO` and `run-local.py mac --ad-hoc`, but shared extensions may be unavailable; the app detects this and retains normal task storage in its own container.

The iOS simulator uses a local-only application/keychain identifier. A physical device needs development signing and a provisioned App Group, plus an HTTPS development API reachable from that device. `localhost` on a phone points to the phone. Physical-device calendar permissions, share-sheet integration, and widget refresh are separate acceptance checks; no TestFlight is required for them.

## Connect your existing account

In native Settings, choose **Connect my Followthrough account**. The browser uses a fresh sign-in session so a different ChatGPT account in your normal browser does not silently select the wrong workspace. Check the email shown before **Connect this device** approval. **Switch account** opens that same flow after connection. Pending local changes must finish syncing first. The app changes workspaces only after the new session is saved to Keychain; it does not import local test tasks into your real account.

The canonical workspace remains `https://followthrough.corymccabe.com`. Native API requests use the existing actions relay, which forwards only an explicit native route/method allowlist using a server-held hosting credential. Native bearer authorization remains mandatory on the primary server, and the website stays invite-only. Calendar credentials remain server-side.

Use `run-local.py mac --no-session` when launching with a real account; the optional test-session launcher is only for loopback fixtures. The minimal deployed API support is maintained separately from this branch's experimental calendar destination and scheduler changes.

## Validation

```sh
npm test
npx tsc --noEmit
node native/Scripts/verify-local.mjs
xcodebuild -project native/Followthrough.xcodeproj -scheme FollowthroughIOS \
  -destination 'platform=iOS Simulator,id=SIMULATOR_UDID' \
  -derivedDataPath native/DerivedData ONLY_ACTIVE_ARCH=YES \
  -collect-test-diagnostics never test
```

The Xcode test targets are `FollowthroughUITests` and `FollowthroughMacUITests`. They act only on this local app and loopback test workspace. Offline tests require coordinating the local server stop/restart; see the test source and `VALIDATION.md` for recorded results. Use `python3 native/Scripts/generate-project.py` after adding/removing native source files; the generator preserves deterministic project identifiers.

The release boundary remains explicit: TestFlight, public distribution, subscriptions, and App Store submission wait for Cory's direction after local acceptance.
