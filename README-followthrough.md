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
- Dictated-text capture through a URL fragment, with Shortcut setup instructions in Settings.

## Remaining before replacing Motion

- Connect an OpenAI API key to activate semantic interpretation inside the app. The structured-output endpoint and task-granularity instructions are implemented. Without a key, capture is explicitly a basic draft with project alias matching and a placeholder estimate. No model call has been verified yet.
- Implement and authorize Google Calendar and iCloud adapters for reading live availability and reconciling only Followthrough-owned events. Existing connector access in a Codex conversation does not give this hosted app calendar credentials.
- Connect an always-running scheduler that invokes reconciliation while browsers and the Mac are asleep. This version has no autonomous background worker or cron trigger.
- Install and test the iPhone Shortcut on the user's phone. The current flow opens a draft for review; it does not silently create a task from Siri.
- Confirm MCP OAuth connection in Codex/ChatGPT after publication. WebMCP works in a supported open browser tab; that is different from installing a remote MCP server.

Motion data, calendars, subscriptions, booking links, and meeting notes have not been modified or migrated.

## Development

Use Node 24 LTS (the scaffold requires at least 22.13), then npm install and npm run dev. Sign in using the development-only simulated Sites identity at /signin-with-chatgpt. Production uses Sites authentication and owner-only access. Every application query is partitioned by the authenticated user ID.

Schema lives in db/schema.ts. Generate append-only migrations with npm run db:generate. Apply generated SQL to the local D1 binding before running the app; Sites applies packaged migrations during publication. Do not put schema-changing SQL in request handlers.

The personal workspace document is committed atomically with a revision check. Request IDs prevent duplicate retries; task editors also check their original task timestamp. Secrets never belong in this document. The current storage bounds are 1,000 tasks, 100 projects, and a 1.8 MB document.

Configure OPENAI_API_KEY as a Sites runtime secret and optionally OPENAI_MODEL (default gpt-5-mini). Use the OpenAI Developers key workflow with user approval. Never paste credentials into source, browser storage, or chat. Local runtime credentials, if used, belong in an ignored .dev.vars file.

## Validation

- npm test: 15 domain checks covering task granularity, conflicts, deadlines, priority, missed sessions, preserved current sessions, prerequisites, cycles, time zones/DST, breaks, unschedulable work, progress, invalid input, basic capture, and tool semantics.
- npm exec tsx -- scripts/verify-local.ts: local-only HTTP checks for authentication, durable state, idempotency, stale revisions, stale task edits, origin checks, invalid input, dependency release, checklist completion, MCP listing, and exports.
- npm run lint: app and domain code. Unmodified generated shadcn components and its mobile hook are excluded because their scaffold contains lint violations; no vendor components were rewritten.
- All four WebMCP actions were exercised in a supported browser context with valid and invalid inputs and saved-state readback. No broad visual browser QA or iPhone verification was performed.
- npm run build: production Worker and client build.

## Implementation references

- [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [MCP Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
- [WebMCP](https://webmachinelearning.github.io/webmcp/)
