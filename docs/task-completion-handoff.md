# Task completion handoff

Created by Cory McCabe

“Do this for me” sends the complete task brief to the selected AI assistant. The brief adds only one Followthrough URL: a signed, task-specific completion webhook. It includes project context and aliases, checklist progress, notes, estimates, priority/status, deadline/start restrictions, time zone, prerequisites, scheduled sessions, any source reference, and the verbatim original input. Existing URLs in the user's source are preserved. No Followthrough login or context-fetch URL is needed by the assistant.

## Completion contract

`POST https://actions.followthrough.link/api/tasks/complete?k=<signed-token>` takes no request body, cookies, or account authorization header. The URL is a private bearer capability for completing one task version. The brief directs the assistant to perform and verify the work before posting, keep the token private, and confirm success only from JSON `ok: true`. It specifies a browser-style User-Agent because hosting bot protection rejected Python's default header in live checks. The selected assistant still needs HTTP POST tools and access to the services where the work occurs.

The public Actions service forwards the token with its existing server-held gateway credential. The planner verifies the signature, completion action, owner handle, task ID and version. GET/HEAD return JSON405 without mutation. Successful retries for an already-completed task are idempotent. Edited, reopened, archived, deleted, or blocked tasks cannot be completed by a stale handoff. Completion retries workspace revision conflicts and preserves successful completion when calendar refresh is temporarily unavailable.

The companion Actions service lives in a separate Sites source repository. Its deployed version34, commit `e77b61c12510ac781140f87894ed2a4d49228c15`, already supplies the public completion endpoint and calendar continuation. Deploy that companion before publishing a planner version that generates these URLs. This GitHub change contains the planner/native implementation, not an additional copy of that separately hosted service. No database migration, new secret, assistant API key, or audience change is required.

## Shared preference and launch behavior

`settings.aiAssistant` accepts `chatgpt`, `claude`, `gemini`, `gemini_ai_studio`, `grok`, `perplexity`, and `copilot`, defaulting older workspaces to ChatGPT. Web, Mac, and iPhone read the same owner workspace. Settings updates patch only supplied fields, preserving concurrent changes and existing work hours. Native handoffs wait for a queued assistant preference to save; older native clients get an update error for unsupported AI Studio.

The web Settings card is titled “Hand off your tasks”. Its platform-specific footer distinguishes browser prefill, native-app evidence and copied-text delivery. Native Settings has the same shared choice and OS-specific guidance.

Native macOS explicitly tries the installed app before browser fallback, including narrowly validated Safari web apps. Native iOS uses provider universal links with `universalLinksOnly` before opening a browser. AI Studio is intentionally browser-only. Desktop web protocol fallback is best-effort because browsers do not expose reliable installation detection; focus/visibility changes cancel the fallback. iPadOS desktop-style user agents are recognized using touch capability.

Short supported prompts open an unsent draft. Oversized briefs are copied in full rather than truncated or replaced with a context URL. Copied-text handoffs present instructions before opening; Cancel opens nothing and Open refreshes the clipboard. Web clipboard denial exposes the full brief for manual copying. Native clipboard failure stays in Followthrough with an error. There is no separate “Copy for another assistant” action.

Task details show no helper text for browser-draft-capable assistants (ChatGPT, Claude, AI Studio, Grok). Gemini, Perplexity and Copilot show “Copy task details and open [assistant]”. iOS uses a branded confirmation sheet with violet/white Open, neutral Cancel, adaptive message text, and an expandable layout. macOS retains its native confirmation and default keyboard action. Saved native work-session/break durations remain visible in the web selectors even when absent from presets.

See [assistant compatibility](assistant-prefill-compatibility.md) for verified platform support and remaining limits.

## Validation

- `npm test` and `node node_modules/typescript/bin/tsc --noEmit` cover the planner and SQLite-backed handoff/API paths: signing, account isolation, persisted preferences, field preservation, retries, stale/invalid/blocked tasks, concurrent edits, calendar-refresh failure and compatibility links.
- `swiftc native/Shared/TaskHandoff.swift native/Scripts/verify-task-handoff.swift -o /tmp/verify-task-handoff` and the resulting binary check all seven destinations, Unicode, full long briefs, bounded URLs, copied-text fallback and Safari-origin restrictions.
- `native/Scripts/serve-ai-assistant-fixture.py` supplies a loopback-only fictional workspace/session for UI verification. It allows only preference changes and synthetic handoffs and rejects task completion.
- Real-client preference propagation and app/browser routing, actual Mac task handoff, isolated iOS task-button behavior and light/dark confirmation checks have been exercised. Exact evidence and scope are summarized in the compatibility document. Simulator checks do not establish physical-device behavior.
