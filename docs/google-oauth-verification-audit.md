# Google OAuth verification audit

Created by Cory McCabe. Checked October 19, 2026.

## Why users see a warning

The Google Auth Platform console reports Followthrough is External and In production. Branding was previously verified, but the requested data access is not verified. Data Access explicitly marks calendar.events.owned and gmail.readonly as not yet verified. The Audience screen currently reports 4 users against the 100-user unverified-scope cap. Moving contacts to Ethos or publishing the app does not approve these scopes. [Google app-state documentation](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview)

## Current scope inventory

| Scope suffix | Console classification | Purpose/status |
| --- | --- | --- |
| calendar.calendarlist.readonly | Non-sensitive | List calendars for the user's availability selection. |
| calendar.events.freebusy | Non-sensitive | Read selected calendars' busy windows. |
| calendar.app.created | Non-sensitive | Existing dedicated-calendar compatibility; review its continued necessity before the next submission without breaking legacy events. |
| calendar.events.owned | Sensitive; not verified | Publish/reconcile Followthrough task events on the user's existing primary calendar. A 754-character justification is already saved. |
| gmail.readonly | Restricted; not verified | Optional user-enabled email-to-task suggestions. Email productivity and a 662-character justification are saved. The demonstration-video URL is still blank. |

The source requests exactly these five scopes, with Gmail requested when the user enables the optional feature. Google classifies gmail.readonly as restricted even though it cannot send or modify mail. [Gmail scope documentation](https://developers.google.com/workspace/gmail/api/auth/scopes)

## Saved Gmail submission text

Saved in Google Auth Platform with category **Email productivity**, confirmed in Prepare for verification:

> Gmail read-only powers optional, user-enabled task suggestions. After explicit consent, Followthrough reads recent Inbox conversations and sent replies to identify clear requests tied to the user’s existing projects, then proposes tasks for review. It never sends, edits or deletes email. Selected plain-text content and headers are sent to OpenAI to generate suggestions, with an in-app disclosure. gmail.metadata cannot supply the message bodies needed to understand requests and replies; add-on-only scopes cannot support background checks. Limited evidence and proposals are encrypted and expire. Users can turn off the feature and clear pending suggestions.

## Outstanding work before submission

1. **Domain ownership:** verify the DNS-level followthrough.site property in Google Search Console under hello@ethosapps.dev, now an accepted project Owner. Completed: the approved Hover TXT record was added, checked against authoritative DNS and Google DNS, and Search Console reported Ownership verified for Ethos. Keep the record in place. Google requires an Owner/Editor of the Cloud project to verify authorized domains. Retain the older authorized domain while compatible old callbacks remain registered. [Google verification requirements](https://support.google.com/cloud/answer/13464321?hl=en)
2. **Public privacy disclosure — complete:** https://actions.followthrough.site/privacy now explains the optional Gmail feature, bounded email access and fields, selected content/context sent to OpenAI, encrypted storage, expiry/cleanup, accepted tasks, disable/disconnect/revoke/export/erase controls and Limited Use. Relay version 24, source c0716293defbbc1d24ff72ea9cce0fd69608b1e0, deployed successfully. Anonymous browser inspection confirmed the rendered disclosures. All 24 relay tests passed, the changed public routes were rechecked after preserving concurrent landing-page edits, and the production build passed. The policy accurately distinguishes store:false from Zero Data Retention.
3. **Branding re-verification:** support and developer contacts have been saved as hello@ethosapps.dev. Homepage is https://actions.followthrough.site/ and privacy is https://actions.followthrough.site/privacy. These are public; the planner root is invite-only. Google completed re-verification, then Publish branding succeeded. The console now states: Your branding has been verified and is being shown to users. No Terms of Service page exists in either source tree, so the field is blank. An initial verification attempt showed homepage-login, missing-purpose and name-mismatch issues from the previous attempt. Anonymous requests with normal and Googlebot user agents returned HTTP 200, correct Followthrough name/purpose and no login page at the configured public homepage. After domain ownership was confirmed, a new request passed and the verified branding was published. The current native mint bolt PNG was subsequently uploaded; re-verification and publication also succeeded for that logo.
4. **Demo video:** record and upload an English-language demonstration showing the complete OAuth grant, the requested scopes, calendar availability/task-event behavior, Gmail opt-in and suggested-task review, and user controls to disable/disconnect/delete. Use a controlled review account and avoid exposing private correspondence. The console's YouTube URL is empty. [Google demonstration requirements](https://support.google.com/cloud/answer/13464321?hl=en)
5. **Gmail scope justification and use case — saved:** Email productivity and the 662-character text above are persisted, alongside the retained 754-character Calendar justification. The submission page lists only demo video as the missing data-access field and disables Confirm. No scopes were added or removed.
6. **Restricted-data security assessment:** Google requires an annual assessment for restricted data accessed through servers unless an applicable exception applies. Followthrough reads Gmail server-side and sends selected text to an AI provider, so plan for Google's restricted-scope review and CASA assessment process; do not claim an exemption or completed assessment. [Restricted-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)
7. **Submit and respond:** submit the completed data-access review and monitor hello@ethosapps.dev for reviewer requests. No completed Google data-access review, scope approval or removed warning is claimed by this audit.

## Business separation

The published OAuth support/developer contacts now use Ethos. Public support/privacy contact links now show hello@ethosapps.dev on the deployed relay. The authenticated planner privacy page was also inspected live and shows hello@ethosapps.dev. The existing Cloud project still belongs to the original organization and retains its original owner's access. Full organization migration and removal of inherited access are separate security-sensitive operations, requiring inspection of destination organization permissions and migration policies. Do not remove the current owner before verifying business-account management and migration readiness. Historical validation notes describe the original account generically; their factual sequence is preserved.

## Native verification record

PR #18 is pushed at feature/followthrough-site-domain. All 300 branch tests and TypeScript pass. The signed Mac Debug build and iOS Debug build pass; the iOS app installed and launched on the dedicated Followthrough New Domain / iOS 27.1 simulator. The user reports both apps signed in and loaded live data. The user confirmed the dedicated simulator by name. Independent recapture subsequently showed a signed-in browser at followthrough.site awaiting the final Connect this device approval; a native workspace screenshot remains outstanding. Native UI automation encountered Device Hub timeouts and ScreenCaptureKit failures; these are verification limits, not demonstrated product failures.

## Prepared handoff materials

See [demo recording plan](google-verification-demo.md) for sample data, the full grant/feature walkthrough, privacy precautions and the unlisted YouTube handoff. See [security assessment handoff](google-security-assessment-handoff.md) for the data flow, source evidence, missing operational evidence and inputs needed from the account owner. No video was recorded or uploaded, no assessor was contracted, and no Letter of Assessment or Google data-access approval is claimed.
