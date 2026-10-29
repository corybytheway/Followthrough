# Followthrough .link migration release

Created by Cory McCabe. October 29, 2026.

## Reconciled source

This change starts from GitHub main `abaf6a7` and incorporates the deployed .link domain, retained .site email aliases, OAuth callback continuity, signed legacy Shortcut, Apps Script URL updates, and CalDAV fixed-offset time-zone repair. Critical migration files were compared with Sites version 166, source `13fb3db4c0b43a184504f0c9665a985324a8b368`. The hosted source retains its existing duration-module split; the GitHub implementation keeps its current equivalent model import.

Newer main-branch App Intent Shortcut and Watch behavior is retained. Unrelated primary-checkout UI changes are excluded. Production Site access, DNS, credentials, Google scopes, and email connections are unchanged by this source reconciliation. Both .site domains must remain registered and their endpoints active.

## Validation

- All 317 web tests passed, including old-domain document/deep-link routing, in-flight OAuth callbacks, both task email aliases, and CalDAV offset/DST regressions.
- Production web build passed.
- Native server-routing checks passed for canonical, legacy, local and custom hosts.
- Apple-signed legacy Shortcut verification and certificate regressions passed.
- Live browser opened `https://followthrough.site/today`, redirected to `https://followthrough.link/today`, and loaded the existing signed-in workspace.

## Native release

Prepare signed Mac and iPhone version 1.0 (10) archives from this reconciled source. The owner explicitly authorized upload to App Store Connect. Signing, upload, processing, and tester availability are recorded separately in the release receipt; an archive or upload alone does not establish tester availability. Native saved .site identities keep their Keychain, cache, and pending-edit storage keys while network requests use .link.
