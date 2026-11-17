# Internationalization Follow-ups

Open work left after the [internationalization design](i18n-design.md) rollout. Each item can be
taken up on its own.

## Features

### Entity titles in notifications

Notification messages pass entity titles as plain text arguments, for example `entityTitle` in the
kernel `notification.reminder-due` message built by
`kernel/backend/src/modules/definitions/kernel-scripts/notification.sandbox.ts`. The title stays in
whatever language it was stored in. Add an entity-reference message argument that the delivery job
resolves through the entity localization module in the recipient's content language. The design
lists it under [Notifications and email](i18n-design.md#notifications-and-email).

### Validation issue copy

`ValidationFailed` (`packages/contract/src/errors.ts`) returns each issue as a
`ValidationIssueCode` with its path, but the client renders only the generic
`error.validation.invalid` reason. Add kernel catalog messages for the issue codes and render them
next to the affected fields where a form can map the path.

## Enforcement

### Email templates under the literal-text lint

The `react/jsx-no-literals` override in `.oxlintrc.json` does not cover `packages/email-templates`.
The delivered `emails/generic.tsx` already renders messages in the recipient's locale. Its
`layout.tsx` keeps the `Ryot` brand name as literal text (`alt` and the footer). Bring the templates
the backend delivers under the lint, passing the brand name as an expression. The contact and
purchase emails belong to the English-only website.

### One lint scope for the kernel client

The same override lists about 30 `kernel/client/src/modules/*` globs from the incremental rollout.
The unlisted modules already pass, so replace the list with `kernel/client/src/**/*.tsx` to cover
new modules automatically.

## Validation

### Legacy migration on real dumps

Run the [Validation Runbook](../apps/server/src/migrations/README.md#validation-runbook) on
`tmp/file.sql` and `tmp/file2.sql` for this rollout's migration changes (message-shaped names and
descriptions, user locale settings, plugin revision catalogs, credit role codes). Before migrating,
list every distinct V1 credit role with its count from `metadata_to_person.role`,
`metadata_group_to_person.role` and `metadata.free_creators[*].role`, and compare it with
`legacyCreditRoleCodes` in `apps/server/src/migrations/legacy-credit-roles.ts`. Unmapped roles keep
their provider text and render untranslated.
