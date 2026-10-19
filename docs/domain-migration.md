# Followthrough domain migration

Created by Cory McCabe. Updated October 19, 2026.

The existing Sites projects remain authoritative; no workspace or credentials are copied to a replacement service.

| Experience | Canonical hostname | Existing compatible hosts |
| --- | --- | --- |
| Invite-only planner | https://followthrough.site | followthrough.corymccabe.com, followthrough.corybytheway.chatgpt.site |
| Public information, privacy, signed calendar actions, Codex context, native API, signed email webhook | https://actions.followthrough.site | follow.corymccabe.com, followthrough-actions.corybytheway.chatgpt.site |

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
