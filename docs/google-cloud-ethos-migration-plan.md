# Ethos Google Cloud organization migration plan

Created by Cory McCabe. Prepared October 19, 2026. This is a preparation checklist; no organization, billing, IAM, or policy change is performed by this document.

## Known state and boundary

The prior console inspection places project followthrough-508105 under the original Behind the Film organization. hello@ethosapps.dev accepted project Owner access. The observed destination is ethosapps.dev, organization 689515864250. Reconfirm both organization IDs and effective permissions immediately before a move; project Owner access alone does not establish organization-level migration permissions. Public OAuth branding already uses Ethos. Removing the old authorized domain or callback now would break retained compatibility, so handle that only after installed clients and automation have migrated.

## Prepare the concrete move

1. Recheck the source parent and destination in Resource Manager. Inventory effective IAM, enabled APIs, service accounts, keys, OAuth client, Apps Script projects/triggers, billing, Shared VPC, and VPC Service Controls dependencies. Cloud project movement does not establish that separate Apps Script or external API-provider ownership changed.
2. Verify the same migration principal has project IAM administration, permission to move from the source parent, and permission to create/move the project at the destination as applicable. Verify organization-policy administration on both sides before proposing temporary policy changes. [Required permissions](https://docs.cloud.google.com/resource-manager/docs/assign-iam-roles)
3. Read the effective allowedExportDestinations/allowedImportSources policies and destination security/domain restrictions. Prepare narrowly scoped changes preserving existing policies. Do not replace unrelated organization policy entries. [Migration policies](https://docs.cloud.google.com/resource-manager/docs/configure-org-policy)
4. Prepare an exact change set showing the source/destination, temporary roles/policies, retained administrators, affected integrations, and recovery procedure. Obtain action-time approval before widening access, changing organization security policies, or removing the original owner.
5. Move the existing project after that review. Retain its project number, existing OAuth client and tokens; do not create replacement credentials merely to change the business organization. Verify inherited policies, Ethos administration, OAuth callbacks, Gmail/Calendar refresh, and background automations. [Perform and verify the move](https://docs.cloud.google.com/resource-manager/docs/perform-migration)
6. Remove temporary migration permissions/policies after validation. Review direct and inherited access separately; removing a direct project Owner does not remove organization-inherited administration. Remove original-business access only after Ethos control and recovery are verified.

## Separate owner decisions

- Confirm Ethos's legal entity name and the administrator/recovery owner. The Google dashboard previously displayed an October 20 MFA deadline; account security setup requires the account owner.
- Confirm whether billing should change. A project move retains its billing association; any billing change is a separate decision, and Marketplace subscriptions need review first. [Billing and migration](https://docs.cloud.google.com/resource-manager/docs/perform-migration)
- Inventory the OpenAI API organization/project and any external automations separately. No ownership transfer, new security-sensitive grant, assessor contract, or payment is authorized by this checklist.

This migration can be planned while the demo is exported. It is separate from Google's sensitive/restricted-scope approval and cannot itself remove the unverified-app warning.
