# Followthrough domain migration

Current status: the web app and primary task email use `.link`; `.site` app/action links and `tasks@followthrough.site` remain compatible. The email cutover used the existing Resend plan.

Created by Cory McCabe. Updated October 28, 2026.

The existing Sites projects remain authoritative; no workspace or credentials are copied to a replacement service.

| Experience | Canonical hostname | Existing compatible hosts |
| --- | --- | --- |
| Invite-only planner | https://followthrough.link | followthrough.site, followthrough.corymccabe.com, followthrough.corybytheway.chatgpt.site |
| Public information, privacy, signed calendar actions, Codex context, native API, signed email webhook | https://actions.followthrough.link | actions.followthrough.site, follow.corymccabe.com, followthrough-actions.corybytheway.chatgpt.site |
| Primary task capture and confirmations | tasks@followthrough.link | tasks@followthrough.site |

The relay forwards allowlisted native requests and signed email/Codex requests using its existing server-held gateway credential. Calendar actions POST through the existing Google Apps Script bridge. Neither task signatures nor gateway/native credentials change. Signed GET links remain on their original host and only POST after the existing browser flow. Old public information pages redirect to the new relay hostname. Old planner document navigation preserves paths and queries; API, MCP, native authorization and hosting/Google callbacks retain their original transport.

Hover DNS for followthrough.site now has apex A records 162.159.143.30 and 172.66.3.26; actions CNAME custom-domains.chatgpt.site; and the four provider-issued verification TXT records. The wildcard parking record is retained. No corymccabe.com DNS was changed. Sites reports both custom domains and SSL active.

Published source: planner Sites version 140, commit 82dcb5e3add1f6b00707bdf482c2ba05e67ad58a; relay version 20, commit fb69c7851be406b5e8dbd0572a43619f1d2a5638. These are the production Sites source repositories, distinct from GitHub main. Existing audiences remain custom allowlist and public respectively.

Validation: 300 planner tests, 24 relay tests, TypeScript, and production builds passed. Node 22.9 tests need --experimental-sqlite. The new planner completed ChatGPT sign-in and displayed the existing owner's workspace. The new public information and privacy pages return 200. Unsigned actions return 400 and unauthenticated native APIs return 401. Both old public hosts redirect to actions.followthrough.site. An old planner task URL opened at followthrough.site with its path/query preserved.

The existing Google OAuth client now accepts https://followthrough.site/api/calendars/google/callback alongside the old callback (saved and reread in Google Cloud). CALENDAR_APP_ORIGIN is set to https://followthrough.site in environment revision 9, used by Sites version 140. The OAuth client ID and secret are retained. Google state and PKCE remain server-side and owner-scoped. Refresh tokens and encryption keys stay unchanged. Confirm the Google branding/verification state before modifying its authorized domains or resubmitting verification.

Existing installed native apps, signed Apple Shortcuts, Apps Script bridge and background automation may retain older service URLs; those endpoints remain compatible. Native source defaults and relay mapping are prepared in this GitHub branch; a new installed native release has not been delivered. Existing saved server preferences are retained.

Google Cloud project followthrough-508105 is under the original organization, with the original Google account its project Owner and inherited Organization Administrator. hello@ethosapps.dev was granted the project Owner role with explicit approval; the saved IAM policy lists both owners. The owner invitation was accepted: the pending warning disappeared on rereading IAM. The user also supplied a screenshot of the project opened in the business account. Ethos authenticated successfully in the Google Cloud browser. An organization migration is a separate operation. No billing or organization transfer is implied by this domain cutover.

Google data access remains unverified. Support and developer contacts are saved as hello@ethosapps.dev, with the public homepage and privacy link on actions.followthrough.site. Ethos verified followthrough.site ownership through a retained Hover DNS TXT record. Google re-verified the branding and Publish branding succeeded; the console confirms it is being shown to users. No scope change, billing change, or organization transfer was submitted. See google-oauth-verification-audit.md for remaining requirements.

Signed native macOS Debug and iOS simulator builds passed. Physical iPhone, Sandbox/App Store release, and installed-client updates were not performed.

Live OAuth verification: reconnected the original Google account through Google using the new callback; returned to https://followthrough.site/?calendar=connected. Four Google accounts and Gmail suggestions remained connected, along with Apple/Zoho, email capture and the existing Shortcut. Background sync remained active. Gmail displayed an existing source-grounding analysis error both before and after the reconnect; no claim is made that Gmail analysis is error-free.

Live rejection probes: new relay Codex context rejects a synthetic invalid signature with HTTP 401 from the primary app; calendar-action bridge rejects a synthetic invalid token with HTTP 400; unsigned email webhook returns HTTP 401. These checks do not mutate real tasks or deliver a real email. Happy-path task mutations and physical-device behavior were not exercised.

Business account Google Cloud dashboard reported a requirement to enable two-step verification by October 20, 2026. Security setup remains for the account owner.

Ethos support contact follow-up: relay version 21 (23f5633cfa84739306d30b64f120f845e5a91920) is deployed; anonymous homepage and privacy requests show hello@ethosapps.dev. Planner contact source was pushed in commit 353855ed8e2ea99d425b042e0ac24541674ec81e and retained by concurrent settings work in saved version 141 (9409f3cb02046f18b24c17434454e0789becb322); that version had no deployment when checked.

Google verification follow-up: the current native mint bolt logo was uploaded, verified and published. Relay version 24 (c0716293defbbc1d24ff72ea9cce0fd69608b1e0) publishes the complete Gmail privacy disclosures, preserving the concurrent landing-page work. Google now has Email productivity and the saved 662-character Gmail justification. Prepare for verification lists the missing demo video and disables Confirm. The private planner privacy contact was inspected live as hello@ethosapps.dev. See the demo recording plan and assessment handoff for remaining owner inputs and external review.

PR reconciliation: PR #19 through 89d3789744566fe88b4908e4e41808be2dbda4b2 is incorporated into PR #18, including legacy native connection routing, retained Keychain/outbox identities, the new-domain signed Shortcut and its Apple-root trust checks. The canonical redirect now assigns pathname/search separately so leading double slashes cannot change the destination host. All 301 web tests, TypeScript, 65 native routing checks, four Shortcut certificate regression tests, signed workflow/source verification, and macOS/iOS Simulator Release builds passed. Release builds used CODE_SIGNING_ALLOWED=NO; they are build verification, not installation or distribution evidence.

Planner Sites version 146, source cfb6f416a60b3d8ad0007d4a2b338a68725066af, deployed successfully with environment revision 9. It includes the redirect repair and Shortcut download version 7, applied to the latest hosted source while preserving concurrent UI work. Existing sharing, runtime secrets and storage bindings were retained. Native distribution, the exported demo, Google data-access approval, assessment and organization migration remain separate outstanding states.

Final privacy alignment: planner version 147 (f7fc6a1178df81557025683a579cb920ece0c858, environment revision 9) and public relay version 25 (86337c4a4fdd6e3ed6d43adbadd6d335fb78fe69, environment revision 2) deployed successfully. Both policies now describe task events on the user-selected owned Google calendar, including the primary calendar, matching the current multi-account/calendar behavior. Both production builds and all five relay public-route tests passed for this wording update. The revised Calendar justification is prepared in the submission packet; Google disables Save while the required video field is empty, so the existing saved justification and scopes are retained.

## Initial calendar-action-only setup on .link (superseded by full cutover)

New calendar action links use `https://actions.followthrough.link/action` through the planner's `CALENDAR_ACTION_URL` runtime setting. This hostname is an alias of the existing public Followthrough Actions Site, with a DNS-only CNAME to `custom-domains.chatgpt.site` and the provider-issued verification TXT records.

The planner remains at `https://followthrough.site`; Manage Task links, Google sign-in callbacks, native API routing, email webhooks, and Codex context URLs retain their existing addresses. Keep `actions.followthrough.site`, `follow.corymccabe.com`, and the original Sites action hostname attached and working. Existing signed links retain their tokens and original transport; do not bulk rewrite calendar events as part of this change. Future event creation or normal event updates use the configured action hostname.

## October 28, 2026 cutover

The apex custom domain is active with TLS. Planner version 160 (source `79a89fbe8450bd379ebe65662508f00a8b7ed755`, environment revision 11) and relay version 26 (source `3639aceb24f1cd2ab72d34cb747d32f202e822f2`, environment revision 2) deployed successfully. Existing custom/public audiences, database bindings, encrypted credentials and legacy custom domains remain in place.

Google Search Console verified `followthrough.link`. Google retains all old authorized domains and callback URLs, plus the new `.link` callback. The public homepage and privacy URL now use `actions.followthrough.link`. Branding and data-access verification remain under review; the Verification Center lists demo-video and minimum-scope issues. No OAuth scopes were added or removed for the migration.

The live Apps Script scheduler and Gmail-suggestions source URLs now use `.link`. The existing web-app deployment was updated in place to version 7, retaining its URL, script properties, execute-as identity and audience. Calendar background sync has a pre-existing CalDAV time-zone error (the app reports its last successful sync as October 27); this domain migration does not resolve that calendar issue.

Resend's existing email.received webhook now targets `https://actions.followthrough.link/api/email/capture` with its original signing secret. The owner selected retirement of only the older `followthrough.corymccabe.com` email domain to free a slot. That domain was removed; `followthrough.site` and `metanote.pro` remain verified. The new `followthrough.link` domain verified sending and receiving using Resend's exact DNS records: DKIM TXT at `resend._domainkey`, DNS-only CNAMEs `rsend` and `send`, MX priority 10 to `receive.forge.rmta.net`, and the supplied DMARC TXT. The app's stored primary forwarding and confirmation address is now `tasks@followthrough.link`, with its original encrypted credentials and six accepted senders retained. `tasks@followthrough.site` remains an alias of that same connection. No plan upgrade or added monthly charge was incurred.

The deployed planner passed 330 tests and the relay passed 24, with successful type checks and production builds. Live checks confirm the new public homepage/privacy return 200, legacy public pages redirect to `.link`, unsigned service requests are rejected, and signed-in legacy planner navigation preserves path/query at `.link`. Synthetic invalid action/context tokens are rejected through both new and old relays. A new signed Shortcut is available. Native routing tests and unsigned Mac/iPhone Release builds passed; no installed native release or App Store distribution was performed.

Local source integration preserves unrelated working changes and the full earlier migration history. The GitHub checkout is older than the production Sites source for some email-confirmation and settings work; the production repositories remain authoritative for deployment. The migration changes were applied to matching local source, with the alias/address-update regression tests, without replacing unrelated production-only features or local UI changes.

Planner version 161 (`5cf68eb378681afdfa04c0851db1dbac0e619f75`, environment revision 11) subsequently deployed successfully with the address-change help corrected to reflect the retained `.site` alias. A replay of an already processed `.site` email at the new Resend webhook endpoint returned HTTP 200 with `duplicate: true` and `ignored: false`, confirming authenticated delivery to the same workspace without another task. The local checkout passed 313 tests; its app/test source type check passed when excluding the existing incomplete archived files under `outputs/` (the unfiltered repository type check still reports those artifact errors).

The owner chose the no-upgrade alternative: retire only Resend's older `followthrough.corymccabe.com` email domain, freeing its third slot for `followthrough.link` while retaining `followthrough.site` and `metanote.pro`. This retirement and the new domain's verification are complete.

The Shortcut downloaded from `https://followthrough.link/shortcuts/Followthrough%20Task.shortcut?v=8` exactly matches the Apple-signed build (SHA-256 `569cdd2eb7b5c2d2b23f298ba3ae48c500ce81576122f2643169b8ce25362b1c`).

A real email from the owner's existing account to `tasks@followthrough.link` created exactly one marked test task, retained the original email source and requested start constraint, and generated a confirmation from `Followthrough <tasks@followthrough.link>`. The temporary task was then archived. Spark's queued-send history reported cancellation, but the actual captured task and received confirmation establish delivery; no second send attempt was made. Earlier replay of a processed `.site` email through the new webhook returned HTTP 200 with `duplicate: true`, preserving the existing idempotency record. Pure alias-resolution tests cover both recipient domains before and after the primary-address change.

Keep both `followthrough.link` and `followthrough.site` domains renewed and their web/email DNS records active. Only the still older `followthrough.corymccabe.com` mail domain was retired; its web hostname remains attached and compatible. Google review completion, the existing CalDAV time-zone sync failure, and native installation/distribution are separate follow-ups.

Completion record: planner version 162 (`b056371ad818c1f329d1554c23b58b5968907335`, environment revision 11) deployed successfully, retaining relay version 26. After the primary email-address change, synthetic webhook requests for both owned aliases reached signature verification and were rejected with HTTP 401; an unknown recipient was ignored with HTTP 200. These probes never retrieved an email, sent a message, or created a task. The `.link` email delivery test task is archived.

Calendar follow-up resolved: the GMT-0500 CalDAV fixed-offset repair is live in planner version 164. Manual and automatic background sync succeeded on October 28. See [the recovery record](caldav-timezone-recovery.md).
