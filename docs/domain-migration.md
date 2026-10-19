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
