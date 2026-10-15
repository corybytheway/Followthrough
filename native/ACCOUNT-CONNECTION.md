<!-- Created by Cory McCabe -->
# Native account connection verification

October 14, 2026. This is a local native build connected to the existing invite-only Followthrough service. No TestFlight or native public release was created.

## Deployed support

- Primary app: version 102, commit `4f6b68e0cb381dcb647f37af7fa6f295155dfd81`, deployment `appgdep_6ad013a569b081919b9363bcdc76e0df` succeeded.
- Existing actions relay: version 14, commit `b34fe91bd6e053eb600cf57431795418485ad168`, deployment `appgdep_6ad013d05e688191be63cc79f2c3a5e6` succeeded.
- Both additive native authorization/session tables were confirmed in live D1. No manual migration was required.
- Native workspace without a bearer, invalid code exchange, and unknown route returned 401, 401, and 404 respectively. Responses were JSON with no-store headers. The primary site still enforces its invite-only browser gate.

Primary support lives in `../../followthrough-native-live-api`; the relay lives in `../../followthrough-native-api-relay`. Their deployment includes the native API and authentication layer only. Experimental native-branch calendar publication/capacity changes were not deployed.

## Actual Mac connection

The first browser session reused another ChatGPT account and returned that account's empty workspace. No task data was lost. Fresh browser authentication and an explicit Switch account action were added.

Cory completed fresh sign-in as `cory@corymccabe.com`. At 6:52:10 PM Chicago, a new active Mac session was issued; read-only database inspection confirmed its owner matches the existing populated workspace. The native app displayed the existing Orbit task “Update cell-reception screenshots,” including project, notes, suggested steps, prerequisites, and original input. The app's real-workspace evidence is saved at `../outputs/design-qa/connected-real-task.png`.

The app retains native credentials in Keychain and uses a fixed HTTPS relay for device APIs. Calendar passwords remain on the server. Account switching checks pending changes both before browser launch and after callback, including captures arriving from a shortcut. Different identities cannot silently discard the previous outbox. Invalid callbacks reset sign-in so the UI can retry.

## Validation and limits

Primary backend: 112 tests, TypeScript, and production build passed. Relay: 21 tests and build passed. Isolated integration exercised PKCE rejection/replay, approval origin validation, bearer-only APIs, capture/scheduling, retry deduplication, web/native readback, stale-edit409, refresh/revocation, calendars, and handoff.

Mac and iPhone builds passed. Native editor tests covered editing and cancellation without modifying real tasks. The iPhone simulator remains on the isolated local workspace. Actual live task capture, a second-device real-account login, and physical-device behavior were not exercised in this pass. Existing calendar connections and live tasks were not rewritten for verification.
