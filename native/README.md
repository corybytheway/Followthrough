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

For an isolated visual review, Mac and simulator Debug builds accept a simple storage label through `FOLLOWTHROUGH_LOCAL_STORAGE` (for example, `suggested-tasks-mac`). This keeps the local session/cache/outbox under `Application Support/Followthrough Reviews/<label>` instead of the normal app-group location. Labels allow letters, digits, underscores and hyphens only. This override is excluded from Release and physical-device builds. Keep the server/session pointed at the disposable loopback workspace as well; storage isolation does not change the connected account.

To run the Mac navigation regression, start `python3 native/Scripts/serve-navigation-fixture.py`, then run `FollowthroughMacUITests/testNumberedNavigationShortcuts` from the FollowthroughMac scheme. The fixture serves a fictional read-only workspace on loopback port 4397; the test uses separate local storage. macOS must authorize the UI test runner.

For page-state regression tests, start `python3 native/Scripts/serve-page-state-fixture.py`, then run `testTaskPageRetainsScrollAndSearchAcrossNavigation` and `testRetainedTaskPageReceivesBackgroundSync` in the same test target. This fixture supplies scrollable fictional data on port 4519 and a fixture-only control endpoint for simulating a server update. It never connects to a real workspace.

For Watch checks, compile `Shared/Models.swift`, `Shared/PhoneOutbox.swift`, `Shared/WatchPlan.swift`, `Shared/WatchCapture.swift`, `App/WatchTaskActionPolicy.swift`, and `Scripts/verify-watch-capture.swift` together with `swiftc -parse-as-library`, then run the executable. These checks use disposable files to cover account-bound delivery, restart recovery, queue migration, phone acknowledgment ownership, scheduled timeline transitions, graduated added time, and postponement workdays/time zones/deadlines. The Watch's Up next complication follows the menu bar: only unexpired blocks starting today in the workspace time zone qualify, and the app's priority/deadline task order chooses among them. Otherwise it shows “That’s it for today!” Future days remain cached, with local-midnight timeline entries to make their work eligible on the correct day. Regression checks compare the Watch directly with `Workspace.todayTasks(at:)`, including weekends, UTC midnight, and a daylight-saving transition. Opening the Watch app actively requests the paired phone’s account link and plan; **Connect to iPhone** retries it. Build **FollowthroughWatch** for the app and its embedded **FollowthroughWatchWidgets** extension. Real paired devices and watch-face placement are still required to verify delivery and complication interactions.

Debug iPhone builds write `Library/Caches/watch-connection-status.json` and a bounded `Library/Caches/native-sync-status.log` for device setup diagnostics. They contain connection flags, timestamps, API paths/status codes and pending counts, never task text, account IDs, bodies, or credentials. Debug Watch builds show their build number in connection details.

## What is implemented

- Shared task/project models and SwiftUI views; native iPhone tabs and Mac sidebar.
- Mac navigation shortcuts: Command–1 opens Today, Command–2 opens Tasks, and Command–3 opens the Projects overview without requesting a scroll to the top, including when the page is already selected. These are also available in the Navigate menu. Command–T continues to return to Today and scroll to the top.
- On iPhone Duo with iOS 27.1, the system's `toolbarVerticalEdge` chooses when to show the native vertical tab bar. Top to bottom: Settings, Projects, Tasks, Today, then the prominent New task action at the bottom. Its full mint circle and navy plus match the horizontal capture control. A noninteractive surface follows the native item's public frame; the native control retains placement, accessibility, and tap handling. New task opens the shared capture overlay without changing the selected page. Horizontal bars retain the centered mint plus and their Today, Tasks, New task, Projects, Settings order. Opening, closing, folding, and rotating the device retain the content's identity and let the system choose the bar placement.
- With at least 744 points of usable width, Today places "Your day" on the left and the date, capture, and tasks on the right. An active vertical folding region sets the column widths and gap so Book divides them at the hinge. Narrow layouts and accessibility text sizes stack tasks before the schedule, within the roomier panel when folded. The same capture editor remains alive across these changes. Welcome and floating capture also use the roomier flat panel; welcome centers short content and scrolls when larger text or a smaller window needs more room.
- Today uses the lightning bolt. The Mac sidebar omits the redundant app-name row and pins a Settings gear at the bottom; its label expands only while hovered and collapses back to the gear when the pointer leaves, including while Settings is selected. On Mac, Today uses its inline capture box and other pages retain the toolbar New task action. iPhone uses one centered mint capture button in its bottom glass navigation on every page, with no duplicate top capture buttons. Native scroll containers reserve space above that navigation. Pushed Settings detail pages use native Back navigation without the bottom bar, keeping calendar controls and final rows unobstructed.
- Native primary actions use navy (`#15243B`) fills with mint (`#35EAB1`) text in Light, and mint fills with navy text in Dark. Capture-card actions keep mint fills with navy text on their blue surface. Secondary controls and disabled states remain neutral. The logo uses the same Vivid Mint fill and retains its existing bolt geometry. Task handoff uses violet, shows opening progress, and falls back to the same full-context browser link if macOS rejects the app link.
- Mac projects open directly from colored folders in the sidebar. The section's plus creates a project; the project toolbar or context menu opens its editor. iPhone keeps a Projects tab with a remembered grid/list choice, starting in grid view. Its single options menu contains New project and the view picker. Tapping a project opens its tasks; list swipe actions and grid context menus offer Edit and Delete. Project deletion preserves tasks under No project and rejects a stale project snapshot.
- Project editors offer 16 Electric presets (Blue, Indigo, Violet, Orchid, Magenta, Rose, Red, Coral, Orange, Amber, Yellow, Lime, Green, Teal, Cyan, and Sky) plus Apple's system color picker. The adaptive grid retains 44-point targets and wraps to the available width on Mac and iPhone. Existing preset and custom colors are retained, and only Save writes the selected color. New projects start with Electric Blue (`#4465FF`).
- Project keywords are visible, editable, and removable in the project editor. New projects start with local suggestions based on spacing, initials, and familiar dictation variants; existing projects offer suggestions without silently adding them. The website uses the same persisted keyword list. Custom variants participate in capture matching, while ambiguous shared keywords stay unassigned. Project edits carry the original snapshot so a stale device cannot overwrite another device’s keywords.
- Today, schedule, task search, project editing, task details, suggested-step completion, `Blocked by`, and expanded selectable original input. The Tasks toolbar filter menu combines a checkable Show completed item with All projects, No project, and each project. Individual project pages use one neutral Project settings menu containing Show completed, a separator, and Edit project. Project editors contain editing controls only; project navigation is outside the editor. Task details use the system Cancel and confirmation controls: the checkmark is disabled until a valid edit exists, and unsaved changes require an explicit discard before dismissal.
- iPhone task lists use the standard Search field. On Mac, a compact magnifying glass reveals “Search” on hover; clicking or ⌘F opens a bounded input that stays open for a query. Escape clears the query, then closes the empty field. Search matches task titles, original input, notes, suggested steps, and project names/calendar labels without case or accent sensitivity. Matching text is highlighted in the title/project label and in a bounded excerpt from the original input, notes, or a step. Long excerpts include ellipses and keep the first matching phrase near the beginning; original stored text is unchanged.
- Task rows show the server's deadline/capacity warnings, using the same first matching warning as the website. The messages wrap below task metadata in Today, Tasks, and project views.
- Capture shows one card on Mac and iPhone. Today's blue card stays in the scroll view and focuses in place, without creating a second editor or delaying input. Opening capture on Today scrolls to the very top, including its heading, in 160 ms. On iPhone this also restores the expanded large date title using the native expanded top inset; the surrounding content retains the original 8-point blur while the card stays clear. The existing card keeps its width and identity; repeated capture shortcuts also return the page to the top. The iPhone center plus, a Mac New task action, or Command-N focuses Today’s existing card, or opens the editor over the current page when on another section; the selected tab and any pushed project page stay in place when capture opens, closes, or submits. iPhone navigation animates away with the keyboard and returns when it dismisses, including the native vertical Duo bar. Reduce Motion removes the automatic scroll animation. There is no separate quick-capture sheet. Dismissing a confirmed result or selecting one of its tasks resets capture to a fresh editor; unsent drafts and unconfirmed requests remain available. The shared draft survives dismissing focus; Return or Command-Return submits, Shift-Return adds a line, and tapping outside dismisses focus. Mac also supports Escape and a close control; iPhone has no close button. Focused cards share a broad soft shadow on both platforms. Mac shows the global capture shortcut; iPhone omits keyboard hints. The Mac menu-bar panel shows Up next, a compact task-duration label, completion and handoff actions, and an inline New task composer. Its submission shows progress in the panel before opening this same main-window confirmation; it shares the durable capture queue, draft, and exact request-batch count. Command-R synchronizes. Adding to plan keeps the overlay visible through progress and a confirmed task-count receipt. Review is optional; Done returns to the same page, and Add another starts a fresh request. Offline/failed requests show their durable device copy with a safe retry, while rejected requests can be edited without losing their source. Retries keep the same request ID; counts use only its confirmed server capture batch.
- Work hours edit directly in Settings with AM/PM start/end pickers in 30-minute increments, work-day selection, longest-session and break-length pickers. Valid edits save as partial settings changes through the persisted mutation queue; there is no Edit work hours sheet or separate Save step. The native app adopts the device time zone when connected or foregrounded and when the system zone changes. The website adopts the browser's device zone; its periodic checks do not fight a zone change from another device. Manual time-zone controls and zone labels are hidden on both clients.
- Native calendar settings show the connected provider's account identity when available, with separate account rows for Google, Apple Calendar, and Zoho. Calendars that block your tasks opens a checklist grouped by provider, with account addresses on a separate header line. Tapping a calendar selects it; its options menu chooses Timed events only or Timed & all-day events. The mandatory task calendar is labeled Always checked, and saving appears only on the affected row. Failed writes restore the previous selection. Task calendar opens a native list of connected calendar destinations with a checkmark on the current choice; unsupported choices explain why they are disabled. Provider connection setup remains available through the Manage connections link. Device calendar access has a compact status row and a dedicated permission/details page. The former Synchronization section and its counting timestamp are removed. A fixed transparent toolbar slot shows a plain spinner during queued writes and nothing after saving. An orange warning appears only when sync or a saved change needs attention; tapping it opens details and Retry. The slot has no shared Liquid Glass background, and saving/errors never insert a banner above the page or move nearby controls. Background refreshes with no pending edits remain invisible.
- Task completion, postponement, next-workweek move, deletion, and the full-context handoff to Codex on Mac and ChatGPT on iPhone. Task editors use duration dropdowns with 8-hour days and 40-hour weeks. Graduated Add time is available through calendar event actions: 15m/30m tasks grow to 1h, estimates through one workday approximately double, and longer tasks gain 4h. The estimate and remaining time receive the same increase to preserve logged work. The handoff starts with a request to plan before acting; the app does not assert that a URL can force the recipient's native Plan-mode setting.
- A WidgetKit next-task widget, a background **Capture a task** App Intent for Shortcuts/Siri/Action Button, and an iOS text/URL share extension. The intent uses the signed-in app’s durable queue and attempts synchronization without opening the app; offline requests remain saved for retry. The optional **Followthrough Talk or Type** workflow uses Apple Shortcuts’ menu, dictation, and text-input actions and requires a one-time Add Shortcut. Share-extension captures upload when the main app next connects. Widgets show cached information and its update time.
- The **FollowthroughWatch** companion uses two vertically paged screens: a centered mint plus with a soft glow, then active task cards with project colors, remaining duration, priority, and due dates. Top priority is bold red and High priority bold amber (#FFAE00), matching the shared iOS/macOS task row; blocked tasks keep muted priority text. The same styling applies to the Priority detail field. Task cards push labeled details with native Back navigation, a completion ring, and recoverable swipe-to-Trash. Connection and queue status live below the task list. The account-bound cache includes up to 128 tasks and 24 scheduled blocks, trimmed to a 44 KB transport budget; a partial list shows its count and directs people to the full iPhone list. Its plus opens Apple’s native text-input controller for dictation or typing. **Done** immediately submits; the plus changes to a loading indicator, and the confirmed task opens in the shared details sheet with a close control. Multiple created tasks open a batch list. There is no review/Save screen or capture helper text. It has no custom recording or transcription. The draft and stable submission ID persist across relaunch; input clears only after a durable Watch save. A 20-second foreground wait falls back to a tappable queued receipt. Receipts distinguish a local Watch save, phone ownership, and a request-bound server-confirmed task result. The same background capture intent remains available in Shortcuts. Watch requests are written atomically before acknowledgment, stay bound to an opaque workspace ID, and transfer to the paired iPhone through Watch Connectivity. The phone durably enqueues each stable request ID before replying. Phone ownership alone does not remove the Watch copy. The Watch atomically saves the exact confirmed task batch and removes its input together. Its queue migrates legacy arrays to an envelope with up to eight recent results. The phone pushes saved results through Watch Connectivity; foreground status checks reuse the original request ID, recovering after a phone restart without duplicate capture. Background transfers remain available when the phone is away. No phone credentials or app microphone permissions are needed on the Watch. Open the signed-in iPhone app once after installation to establish the account connection.
- **FollowthroughWatchWidgets** supplies circular/corner bolt capture and rectangular Up next complications. In full-color mode the circular capture complication has the logo's navy (#15243B) disc and mint (#35EAB1) bolt. The disc is content, so watch-face container-background removal keeps it visible; accented faces use the system accessory background and tint. Up next uses the current or next scheduled block, with cached timeline entries at future start/end boundaries. Its deep link pushes the same task details as the list. **Task actions** contains **Mark complete**, graduated **Add more time**, **Postpone 1 day** (next allowed workday), and **Push to next week** (next Monday, advanced to a workday). Both postpone actions respect the workspace time zone and deadline. Details refresh automatically and omit synchronization timestamps and a manual refresh row. Actions retain a stable request ID across Watch retries; the phone commits ownership receipts atomically with its outbox, and rejects stale task versions and account mismatches. The Watch app and widget extension share an account-bound plan snapshot through an App Group, with no phone credentials. Watch-face color modes control the final complication tint.
- Optional EventKit access validation that lists device calendars without changing their events.
- Existing capture pipeline, planner, project names, priorities, and calendar rules remain on the server. Without a local AI connection, the existing basic fallback preserves the source and uses a provisional estimate; no AI key is bundled in the app.

## Authentication and synchronization

`/native/connect` displays the signed-in workspace identity before an explicit approval. The authorization code lasts two minutes, is single-use, and requires the device's SHA-256 PKCE proof. Native APIs require their own bearer session; web cookies are not accepted as native API authorization. Server records store token hashes. Access tokens last 15 minutes, refresh credentials expire absolutely after 90 days, and disconnect revokes the device session.

The device stores credentials in Keychain. API requests refuse redirects and use HTTPS except for loopback development. Session data is excluded from widgets and share extensions.

Task snapshots and the mutation outbox are scoped to server + workspace identity. Captures and edits are written atomically before the UI acknowledges them. The client drains changes in order, refreshes when foregrounded, and polls every 20 seconds while open. Capture IDs remain stable across retries and app restarts. Task edits send only changed fields and keep their original field values with the durable operation. A stale timestamp triggers a fresh read: already-applied edits drain without another write, and edits to different fields merge with a bounded retry against the new version. Same-field conflicts, deleted tasks, and old outboxes without an original baseline remain protected. The warning offers Review saved task, with current/saved values and per-field choices; applying the review replaces only that pending operation and resumes the remaining queue. Cancel preserves it all. Keeping the current task removes only that one edit after confirmation. Task deletion still requires the opened version. Repeated identical pending edits are deduplicated. Each request renews access if necessary; an unexpected authorization rejection gets one refresh/retry with its original request ID.

The server is the only scheduling/publication authority. Device suspension does not become a scheduling dependency. Existing private scheduled invocations remain responsible for provider polling and publication. This branch raises the per-invocation batch from 2 to 20 workspaces with at most 4 concurrent workers; it is bounded capacity, not a guarantee for unlimited accounts.

## Calendar destinations

The deployed service currently supports task publication to the connected account's primary Google calendar. Apple Calendar and Zoho calendars can supply conflict availability, including per-calendar all-day rules; that availability support does not imply task-publication support. Native Settings edits conflict choices and presents task destinations directly rather than opening the website for those controls. The destination list may show every connected calendar, but secondary Google calendars, Zoho destinations, and unsupported Apple destinations are disabled with an explanation. The server's `taskOutputProviders` capability controls whether Apple task destinations can be selected. Selecting the current Google primary destination is a no-op.

The canonical development source also contains an experimental iCloud task writer and `set_output` support. These are separate from the deployed Google-primary-only service. The iCloud writer uses deterministic event IDs, an owner marker, `If-None-Match` for creation, and ETags for changes/deletion. It validates the whole listing before writing, refuses objects outside the chosen calendar, and never deletes unmarked appointments. A destination change retains a cleanup checkpoint until old owned events have been removed. Do not enable that capability in production merely because the native picker can display Apple calendars.

Native conflict-selection updates send the original six selected-calendar/all-day arrays as `expectedSelection`. Matching server support checks the snapshot under the calendar lock and rejects stale edits with HTTP 409; the native app reloads those choices for review. Older web clients may omit that snapshot. Native selection writes also require POST support for `/api/native/calendars` in the actions relay; a local app build alone does not establish that the server/relay update is deployed.

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

Physical iPhone builds connect to `https://followthrough.link` and exclude the local test-session injection path. Sign in on the phone and approve **Connect this device** for the intended workspace; never copy the Mac's credentials. Physical-device calendar permissions, share-sheet integration, and widget refresh remain separate acceptance checks. No App Store Connect app record or TestFlight upload is needed for development installation.

## Connect your existing account

In native Settings, choose **Connect my Followthrough account**. The browser uses a fresh sign-in session so a different ChatGPT account in your normal browser does not silently select the wrong workspace. Check the email shown before **Connect this device** approval. **Switch account** opens that same flow after connection. Pending local changes must finish syncing first. The app changes workspaces only after the new session is saved to Keychain; it does not import local test tasks into your real account.

The canonical workspace is `https://followthrough.link`. Native API requests use `https://actions.followthrough.link`, which forwards only an explicit native route/method allowlist using a server-held hosting credential. Native bearer authorization remains mandatory on the primary server, and the website stays invite-only. Calendar credentials remain server-side. Saved connections using either previous workspace domain resolve browser links and sign-in to the new domain while retaining their original Keychain and local storage identities, including pending changes.

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

Verify current and legacy website routing, native relay selection, local/custom server isolation, and server URL validation without contacting a live workspace:

```sh
xcrun swiftc native/Shared/Models.swift native/App/APIClient.swift \
  native/Scripts/verify-server-routing.swift -o /tmp/followthrough-server-routing
/tmp/followthrough-server-routing
```

The release boundary remains explicit: TestFlight, public distribution, subscriptions, and App Store submission wait for Cory's direction after local acceptance.

Native sync diagnostics use the `com.ethos.followthrough` / `Synchronization` unified-log category (Xcode or Console), plus `sync-diagnostics.log` alongside the outbox. The local log retains 150 lines of route/method/status and queue counts. It excludes task text, account identifiers, request bodies, and credentials.

Task completion in Today and Tasks uses a 44-point hit target and immediate local checkmark feedback after the outbox is written. After a short acknowledgment, the row animates out or moves below outstanding tasks when Show completed is enabled. Pending completion/reopen intent survives an offline relaunch; authoritative server state stays separate, and a genuine same-task conflict returns to the existing review flow. Reduce Motion disables the added symbol and row animations. Run the shared projection checks with `xcrun swiftc native/Shared/Models.swift native/Scripts/verify-task-completion.swift -o /tmp/followthrough-task-completion` and `/tmp/followthrough-task-completion`.


`Blocked by` choices are grouped by project in both native apps and the website. The project currently selected in the editor comes first, followed by other nonempty projects alphabetically, then No project (first for an unassigned task). Colored folder/name headers sit inside the existing bounded picker. Only other ready/on-hold tasks are offered; completed, archived, and deleted tasks are excluded. Grouping never rewrites selected blocker IDs or removes existing completed-history links. The shared native checks run with `xcrun swiftc native/Shared/Models.swift native/Scripts/verify-task-prerequisites.swift -o /tmp/followthrough-task-prerequisites` and `/tmp/followthrough-task-prerequisites`.


## Native brand colors

`Shared/BrandColors.swift` is shared by the Mac app, iPhone app, widgets, and share extension. Primary action fills adapt between navy `#15243B` with mint `#35EAB1` text in Light and mint with navy text in Dark. Checked controls and actions on the blue capture card retain mint fills with navy glyphs. Selected iPhone tabs use navigation blue (`#245BDF` in Light, `#7AA2FF` in Dark) in both horizontal and native Duo vertical bars. The capture action retains its mint/navy surface. Active project filters use a filled mint circle with a navy filter glyph inside the native glass button, matching the Apple Mail selection treatment. All projects returns to the neutral icon. The selection circle keeps the same frame in both states so the toolbar does not shift. Project colors remain user data and do not inherit the brand palette. Native icon generation retains the bolt geometry with the same mint fill; web CSS and favicon use matching brand values.

iOS Settings actions use brighter green (`#00865E`) text in Light and mint in Dark, on the standard row background. Work days use borderless 40-point circles inside 44-point tap targets, with three-letter labels on both Apple platforms and web. Selected days use #A5E5CE with #07563E text in Light and #2D654E with #B5FFE0 text in Dark; off days use #ECEEF1/#667085 in Light and #303236/#CFD2D8 in Dark. Each day retains its full weekday accessibility label and selected state.


Task search is global while a non-whitespace query is present, including completed and archived tasks across projects. It searches titles, project names/calendar labels, notes, original input, and suggested steps. Normal filters return when the query is cleared. Outstanding results come first, followed by completed results in newest-completion order. Run search checks with `xcrun swiftc native/Shared/Models.swift native/Scripts/verify-task-search.swift -o /tmp/followthrough-task-search` and `/tmp/followthrough-task-search`.

## Mac global capture shortcut

Control–Option–F uses the same workspace capture as Command–N while the main Followthrough window is active. From another app, or with the workspace hidden or closed, it opens the menu bar popover. Its “New task… (⌃⌥F)” field is immediately ready for typing; repeated presses while the popover is open preserve the draft and refocus the field. Clicking the menu bar icon uses the same popover. Command–Comma opens Settings and dismisses capture focus. Return submits and Shift–Return inserts a new line. Existing capture submission, result review, task-edit protection, and queue behavior are retained.

Watch UI rendering fixtures are available only in Debug simulator builds. Launch with `FOLLOWTHROUGH_WATCH_PREVIEW=capture`, `tasks`, `details`, `actions`, `saving`, `queued`, `saved`, `multiple`, or `priorities` to use fictional data without credentials, a real outbox, or Watch Connectivity delivery. `complication` and `complication-corner` render the shared full-color capture artwork in an app host; actual watch-face placement and system accent processing require face testing. Device and Release builds exclude this fixture code.

Domain compatibility: saved `.site` and older server identities retain their Keychain, cache, and outbox keys; APIClient routes their network requests to `.link`. Keep all old server endpoints active for installed clients and old Shortcuts.
