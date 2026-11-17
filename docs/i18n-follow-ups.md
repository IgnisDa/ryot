# Internationalization Follow-ups

The follow-ups from the [internationalization design](i18n-design.md) are implemented.

## Migration validation

Both original dumps were restored into separate disposable PostgreSQL databases and asset buckets,
with rebuilt shipped archives and server assembly. Migration-only runs and completed restarts passed.
The [runbook](../apps/server/src/migrations/README.md#validation-runbook) includes the i18n checks.

| Dump | Deployment TZ | Users | Retained credit rows checked | Free-creator entities checked | Migration seconds |
| --- | --- | ---: | ---: | ---: | ---: |
| `tmp/file.sql` | `Asia/Kolkata` | 1 | 1,262 | 122 | 89 |
| `tmp/file2.sql` | `UTC` | 299 | 10,348 | 1,157 | 1,185 |

The complete [pre-migration credit role inventory](i18n-credit-roles.md) includes every distinct
provider role, count, and mapping decision across all three legacy sources. Retained mapped roles
use codes; unmapped roles retain their exact provider text. Credit and free-creator comparisons
found no mismatches after accounting for the existing removal of null object properties.

Every migrated user has null interface/content language overrides and the correct reporting zone.
Both shipped plugin revisions have message-shaped names and descriptions, resolving in their
English, German, and pseudo-locale catalogs. Catalog hashes match across dumps. Environment config
revisions match active plugin revisions, and all 2 / 598 migrated installations are ready.
Automation triggers, recipients, runs, attempts, notifications, and deliveries remain empty.
Completed restarts preserve counts, preferences, plugin identities, credits, and creator records.

An isolated interrupted run changed the migrated user's preferences to `de`, `fr`, and
`Europe/London`, then restarted with `TZ=UTC` while legacy tables remained. All three stored
preferences survived unchanged.
