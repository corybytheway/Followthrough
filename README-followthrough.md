# Followthrough

Created by Cory McCabe.

A private, invite-only planner built with React, vinext, shadcn, and Cloudflare D1 on Sites.

The locally runnable SwiftUI iPhone and Mac apps are in [`native/`](native/README.md). Their development API uses this server's existing workspace, capture, and scheduling logic. Native setup and validation are separate from deployment or TestFlight.

## Working in this version

- Persistent projects, tasks, estimates, dates, priorities, notes, and checklist completion.
- One outcome per task; calendar sessions are separate from checklist steps and task identity.
- Task prerequisites, completion, reopening, holding, archiving, search, and project filtering.
- Scheduling within configurable local work hours, work days, breaks, and session lengths.
- Meeting avoidance using manual busy times and selected Google/iCloud calendars; deadline and capacity warnings.
- Google OAuth with offline access, encrypted per-account credentials, calendar selection, and task blocks on each account's primary Google calendar. iCloud uses an app-specific password and CalDAV.
- Explicit start/pause/sync controls. Sync reads both providers before publishing, updates only marked Followthrough events, and stops on incomplete availability or concurrent plan changes.
- Replanning on changes, on opening the app, and every minute through the private background timer for connected accounts. Time passing never completes work.
- One-tap Complete, Postpone, and Delete links in Google task events. The public relay does not expose workspace access; each action is signed for one task version and submits with POST only after a real browser opens it.
- Four WebMCP tools using the same actions as the visible app: list, create task, update task, create project.
- Authenticated stateless Streamable HTTP MCP endpoint at /mcp.
- Authenticated JSON backup and calendar snapshot downloads.
- Direct Talk or Type capture from a signed Apple Shortcut, with a server-confirmed save and no browser opening. One-time pairing in Settings creates a revocable, create-only connection.
- Captures become Ready and are scheduled automatically without requiring a deadline. Without an AI-generated plan, a labeled temporary 30-minute estimate reserves time. User-entered deadlines remain separate from flexible planned calendar times.
- Durable capture identifiers prevent duplicate requests even after the ordinary request cache expires. The old URL capture path remains supported.

## One-person beta

Sites access remains restricted to the owner until an invitee is chosen. Each authenticated user gets an independent D1 workspace, calendar connection, Shortcut key, and AI usage counter. New users start with no projects or tasks and choose their own work hours. The existing owner's saved workspace is unchanged. Invitees may use the owner's Followthrough Google OAuth application and the app-held OpenAI connection without receiving either credential. Their Google refresh token and iCloud password, if connected, are encrypted under their own user ID. AI calls are limited to 100 requests per user per UTC day.

The one-minute private scheduler discovers enabled calendar connections, processes up to twenty due accounts per invocation with four concurrent workers, and keeps the existing owner-bound email relay. Calendar action links include an opaque account handle inside the signed task parameter; old owner links remain valid. The app offers export and an invitee-only data erasure control. Email capture remains available to the original owner and is hidden for invitees. The beta data notice is at `/privacy`.

To invite someone later, confirm their Google OAuth access in the Google app configuration if required, then add their ChatGPT sign-in email to the Site's custom access allowlist. Keep the Site in custom access mode. Test that they see an empty workspace, can connect their own Google Calendar and Shortcut, and cannot see the owner's tasks. Do not add their email until they are ready to join.

## Development

Use Node 24 LTS (the scaffold requires at least 22.13), then npm install and npm run dev. Sign in using the development-only simulated Sites identity at /signin-with-chatgpt. Production uses Sites authentication and a custom allowlist. Every application query is partitioned by the authenticated user ID.

Schema lives in db/schema.ts. Generate append-only migrations with npm run db:generate. Apply generated SQL to the local D1 binding before running the app; Sites applies packaged migrations during publication. Do not put schema-changing SQL in request handlers.

The personal workspace document is committed atomically with a revision check. Request IDs prevent duplicate retries; task editors also check their original task timestamp. Secrets never belong in this document. The current storage bounds are 1,000 tasks, 100 projects, and a 1.8 MB document.

The original owner's encrypted OpenAI connection is shared server-side with beta invitees when no global `OPENAI_API_KEY` secret is configured. A global Sites secret can replace that arrangement later. `OPENAI_MODEL` optionally overrides the model. Never paste credentials into source, browser storage, or chat. Local runtime credentials, if used, belong in an ignored .dev.vars file.

## Validation

- `python3 scripts/verify-shortcut-local.py`: authentication, direct durable saves, no workspace-reading permission for the capture key, automatic planning, Unicode, duplicate/concurrent retries, invalid actions, key rotation, rate limiting, and revocation. Test records are removed from local D1.

- npm test: domain and provider-contract checks covering task granularity, conflicts, deadlines, priority, missed sessions, preserved current sessions, prerequisites, cycles, time zones/DST, breaks, unschedulable work, progress, invalid input, basic capture, and tool semantics.
- npm exec tsx -- scripts/verify-local.ts: local-only HTTP checks for authentication, durable state, idempotency, stale revisions, stale task edits, origin checks, invalid input, dependency release, checklist completion, MCP listing, and exports.
- npm run lint: app and domain code. Unmodified generated shadcn components and its mobile hook are excluded because their scaffold contains lint violations; no vendor components were rewritten.
- All four WebMCP actions were exercised in a supported browser context with valid and invalid inputs and saved-state readback. No broad visual browser QA or iPhone verification was performed.
- npm run build: production Worker and client build.

## Implementation references

- [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [MCP Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
- [WebMCP](https://webmachinelearning.github.io/webmcp/)

## Shortcut connection

`SHORTCUT_GATEWAY_TOKEN` is the existing Sites identity-less API gateway token, kept as a server secret. A signed-in owner creates a separate random create-only key in Settings; D1 stores only its SHA-256 hash. The private setup code combines the two credentials for Shortcuts. The distributed shortcut contains neither credential. Replacing or disconnecting the connection invalidates the old capture key. The gateway token alone cannot read or change the workspace through app endpoints.

The `/api/shortcuts/capture` GET issues only a request ID; POST accepts only source text and that ID, then returns the save confirmation. It cannot update, delete, list, or complete tasks. Requests are limited to twenty per minute per connection.

## Calendar setup

Task blocks go on each account's primary Google calendar. Read availability from selected Google and iCloud calendars; never select Motion/flexible task calendars as fixed busy time. This release supports one Google account and one iCloud account per owner.

- `CALENDAR_ENCRYPTION_KEY`: 32 random bytes as 64 lowercase hexadecimal characters, stored as a Sites secret. Do not replace after pairing without a credential migration. AES-GCM ciphertext is bound to the workspace owner. Credentials are excluded from task exports, snapshots, and MCP.
- `CALENDAR_APP_ORIGIN`: the canonical live HTTPS origin. The Google web-client redirect URI must be `<origin>/api/calendars/google/callback`.
- `CALENDAR_ACTION_URL`: the public Followthrough action relay `/action` URL. Its GET page only auto-submits a same-origin POST in a browser, limiting accidental action from link-preview fetches; the relay then calls the private Apps Script connection server-side.
- `CALENDAR_ACTION_SECRET`: a separate 32-byte lowercase hexadecimal Sites secret. It signs a single task ID, action, and task version, so links cannot be changed or replayed after the task updates.
- The original owner can manage the Google **web** OAuth client. Invitees use that client registration without seeing its secret, then authorize their own Google account. Google scopes are defined in `lib/google-calendar.ts` and include read-only calendar listing, free/busy reads, and management of Followthrough task events on calendars the account owns.
- OAuth state is random, hashed, owner-bound, expires after ten minutes, and is consumed once. PKCE protects the authorization code. External Testing grants expire after seven days; for this personal Workspace deployment prefer an Internal audience when suitable, or finish External production consent setup.
- iCloud: enter the Apple Account email and a Followthrough app-specific password directly in Settings. Discovery and redirects are restricted to Apple CalDAV HTTPS hosts. Recurrences are expanded on the provider; incomplete expansion stops sync. Busy imports preserve all-day/DST semantics and ignore transparent/cancelled instances.
- Start sync schedules ready tasks on the primary Google calendar. Google event IDs are deterministic. Provider event markers and ETags protect unrelated or concurrently edited events. Failed availability reads leave prior busy data and task events untouched. Later publishing failures report partial completion and are safe to retry.
- Sync runs on app focus, every minute while visible, and through the installed one-minute Apps Script timer. The same private script relays signed one-tap calendar actions without exposing its stored scheduler credentials.
- Pausing/disconnecting leaves Google task blocks in place. The UI explains this; disconnect removes that account's imported availability and pauses publication. Completing or modifying tasks should happen in Followthrough; dragging/deleting its Google blocks does not change task state.
- Apply the append-only migrations in `drizzle/`; the beta adds action-owner handles and per-account AI usage in `0005_serious_madelyne_pryor.sql`.

Provider references: [Google scopes](https://developers.google.com/workspace/calendar/api/auth), [Google offline OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [Apple app-specific passwords](https://support.apple.com/102654), [tsdav expanded events](https://tsdav.vercel.app/docs/caldav/fetchCalendarObjects).
