# Followthrough

Created by Cory McCabe.

A private personal planner built with React, vinext, shadcn, and Cloudflare D1 on Sites.

## Working in this version

- Persistent projects, tasks, estimates, dates, priorities, notes, and checklist completion.
- One outcome per task; calendar sessions are separate from checklist steps and task identity.
- Task prerequisites, completion, reopening, holding, archiving, search, and project filtering.
- Scheduling within configurable local work hours, work days, breaks, and session lengths.
- Meeting avoidance using manually entered busy times; deadline and capacity warnings.
- Replanning on changes, on opening the app, and every minute while its tab is visible. Time passing never completes work.
- Four WebMCP tools using the same actions as the visible app: list, create task, update task, create project.
- Authenticated stateless Streamable HTTP MCP endpoint at /mcp.
- Authenticated JSON backup and calendar snapshot downloads.
- Direct Talk or Type capture from a signed Apple Shortcut, with a server-confirmed save and no browser opening. One-time pairing in Settings creates a revocable, create-only connection.
- Uninterpreted captures are saved to Inbox and excluded from the schedule until planned. AI-enabled captures become ready tasks; AI failure preserves the request in Inbox.
- Durable capture identifiers prevent duplicate requests even after the ordinary request cache expires. The old URL capture path remains supported.

## Remaining before replacing Motion

- Connect an OpenAI API key to activate semantic interpretation inside the app. The structured-output endpoint and task-granularity instructions are implemented. Without a key, capture is explicitly a basic draft with project alias matching and a placeholder estimate. No model call has been verified yet.
- Implement and authorize Google Calendar and iCloud adapters for reading live availability and reconciling only Followthrough-owned events. Existing connector access in a Codex conversation does not give this hosted app calendar credentials.
- Connect an always-running scheduler that invokes reconciliation while browsers and the Mac are asleep. This version has no autonomous background worker or cron trigger.
- Pair the direct Followthrough Task shortcut on the iPhone and verify its Action button and dictation. The capture API is tested with local D1; physical-phone execution remains unverified.
- Confirm MCP OAuth connection in Codex/ChatGPT after publication. WebMCP works in a supported open browser tab; that is different from installing a remote MCP server.

Motion data, calendars, subscriptions, booking links, and meeting notes have not been modified or migrated.

## Development

Use Node 24 LTS (the scaffold requires at least 22.13), then npm install and npm run dev. Sign in using the development-only simulated Sites identity at /signin-with-chatgpt. Production uses Sites authentication and owner-only access. Every application query is partitioned by the authenticated user ID.

Schema lives in db/schema.ts. Generate append-only migrations with npm run db:generate. Apply generated SQL to the local D1 binding before running the app; Sites applies packaged migrations during publication. Do not put schema-changing SQL in request handlers.

The personal workspace document is committed atomically with a revision check. Request IDs prevent duplicate retries; task editors also check their original task timestamp. Secrets never belong in this document. The current storage bounds are 1,000 tasks, 100 projects, and a 1.8 MB document.

Configure OPENAI_API_KEY as a Sites runtime secret and optionally OPENAI_MODEL (default gpt-5-mini). Use the OpenAI Developers key workflow with user approval. Never paste credentials into source, browser storage, or chat. Local runtime credentials, if used, belong in an ignored .dev.vars file.

## Validation

- `python3 scripts/verify-shortcut-local.py`: authentication, direct durable saves, no workspace-reading permission for the capture key, Inbox behavior, Unicode, duplicate/concurrent retries, invalid actions, key rotation, rate limiting, and revocation. Test records are removed from local D1.

- npm test: 18 domain checks covering task granularity, conflicts, deadlines, priority, missed sessions, preserved current sessions, prerequisites, cycles, time zones/DST, breaks, unschedulable work, progress, invalid input, basic capture, and tool semantics.
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
