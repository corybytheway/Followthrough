# Followthrough for iPhone and Mac — local development

Created by Cory McCabe.

This branch adds locally runnable SwiftUI clients to Followthrough. The app can use either an isolated development workspace or your existing Followthrough account. TestFlight, public native distribution, and subscriptions remain separate later steps.

## Open and run

Open `native/Followthrough.xcodeproj`. The shared schemes are `FollowthroughMac` and `FollowthroughIOS`. Use Debug for local testing. Mac and simulator Debug builds default to `http://localhost:4318`; physical iPhone builds default to the live HTTPS workspace. All isolated test tasks belong to the local Sites identity, `seedy@sites.test`.

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
- Project editors offer the selected Electric palette (Blue, Violet, Magenta, Rose, Orange, Lime, Green, and Cyan) and Apple's system color picker. Existing custom colors are retained, and only Save writes the selected color. New projects start with Electric Blue (`#4465FF`).
- Today, schedule, task search, project editing, task details, suggested-step completion, `Blocked by`, and expanded selectable original input.
- Task rows show the server's deadline/capacity warnings, using the same first matching warning as the website. The messages wrap below task metadata in Today, Tasks, and project views.
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

The iOS simulator retains its local-only application/keychain identifier. Physical iPhone builds use the confirmed App Store Connect identifier `com.ethos.followthrough`, with `.widgets` and `.share` extension identifiers and the `group.com.ethos.followthrough` App Group. All three targets use automatic development signing for the Ethos Apps team. Mac Debug and simulator identifiers/storage remain unchanged; Mac Release uses the same `com.ethos.followthrough` app identifier and shared group as iPhone. The earlier installed `dev.ethosapps.followthrough` phone build is a separate development app and is retained; a future install with the confirmed identifier needs its own workspace sign-in.

To run on a connected iPhone, sign in to the Ethos Apps developer account in **Xcode → Settings → Apple Accounts**, choose the `FollowthroughIOS` scheme and the physical phone, then Run. Xcode registers the device and prepares the development profiles. The installed app is named **Followthrough**; the build product filename remains `Followthrough Local.app` so existing schemes and local tooling stay compatible.

For a terminal build, use the connected device's actual UDID:

```sh
xcodebuild -project native/Followthrough.xcodeproj -scheme FollowthroughIOS \
  -configuration Debug -destination 'platform=iOS,id=DEVICE_UDID' \
  -derivedDataPath native/DerivedDataDevice \
  -allowProvisioningUpdates -allowProvisioningDeviceRegistration build
python3 native/Scripts/run-device.py --device DEVICE_UDID \
  --app 'native/DerivedDataDevice/Build/Products/Debug-iphoneos/Followthrough Local.app'
```

Keep the phone unlocked for launch. The launcher requires an explicit device and validates the physical app and extensions before installation.

Physical iPhone builds connect to `https://followthrough.corymccabe.com` and exclude the local test-session injection path. Sign in on the phone and approve **Connect this device** for the intended workspace; never copy the Mac's credentials. Physical-device calendar permissions, share-sheet integration, and widget refresh remain separate acceptance checks. No App Store Connect app record or TestFlight upload is needed for development installation.

## Connect your existing account

In native Settings, choose **Connect my Followthrough account**. The browser uses a fresh sign-in session so a different ChatGPT account in your normal browser does not silently select the wrong workspace. Check the email shown before **Connect this device** approval. **Switch account** opens that same flow after connection. Pending local changes must finish syncing first. The app changes workspaces only after the new session is saved to Keychain; it does not import local test tasks into your real account.

The canonical workspace remains `https://followthrough.corymccabe.com`. Native API requests use the existing actions relay, which forwards only an explicit native route/method allowlist using a server-held hosting credential. Native bearer authorization remains mandatory on the primary server, and the website stays invite-only. Calendar credentials remain server-side.

Use `run-local.py mac --no-session` when launching with a real account; the optional test-session launcher is only for loopback fixtures. The minimal deployed API support is maintained separately from this branch's experimental calendar destination and scheduler changes.

## Validation

On October 14, 2026, development builds succeeded for Mac and a physical iPhone 17e (iOS 27.2). The app, widget, and share extension profiles were verified against the connected phone and matching App Group. The final device launcher installed and launched `dev.ethosapps.followthrough`; Cory confirmed that sign-in loaded his real projects and tasks. Mac's existing connected workspace remained available. Physical widget/share usage, new task capture, and end-to-end calendar publication were not exercised during this signing pass.

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
