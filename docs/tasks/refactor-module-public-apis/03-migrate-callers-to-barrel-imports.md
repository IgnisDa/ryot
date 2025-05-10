# Migrate All Callers to Barrel Imports

**Parent Plan:** [Refactor: Module Public APIs via Barrel Files](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Update every file that currently imports from a module sub-path to import from the module root
instead. All barrel files created in Tasks 01 and 02 must exist before starting this task.

No logic changes — this is purely import path rewriting. The complete list of files to update:

| File | Sub-path imports to replace |
|------|-----------------------------|
| `lib/views/definition.ts` | `saved-views/schemas`, `query-engine/schemas`, `query-engine/query-builder`, `property-schemas/schemas` |
| `lib/views/validator.ts` | `saved-views/schemas`, `query-engine/schemas` |
| `lib/test-fixtures/saved-views.ts` | `saved-views/schemas`, `saved-views/service` |
| `lib/test-fixtures/entity-schemas.ts` | `entity-schemas/schemas`, `entity-schemas/service` |
| `lib/test-fixtures/event-schemas.ts` | `event-schemas/schemas`, `event-schemas/service` |
| `lib/test-fixtures/events.ts` | `events/schemas`, `events/service` |
| `lib/test-fixtures/entities.ts` | `entities/schemas`, `entities/service` |
| `lib/test-fixtures/trackers.ts` | `trackers/schemas`, `trackers/service` |
| `lib/sandbox/host-functions/get-entity-schemas.ts` | `entity-schemas/service` |
| `modules/authentication/bootstrap/manifests.ts` | `saved-views/constants` |
| `modules/media/service.ts` | `query-engine/schemas` |
| `app/runtime.ts` | `system/service` |
| `app/server.ts` | `system/middleware` |

**Exemption:** `app/api.ts` is the composition root and intentionally imports `routes.ts` directly
from each module. Do not change it.

After all imports are updated, verify the full test suite passes.

## Acceptance criteria

- [ ] All files in the table above import from `~/modules/X` (module root) instead of `~/modules/X/subpath`
- [ ] No new sub-path imports have been introduced
- [ ] `bun tsc --noEmit` passes with no new errors
- [ ] `bun test` passes (all existing tests still green)
- [ ] `app/api.ts` is unchanged

## Blocked by

- [Task 01](./01-barrel-files-high-traffic-modules.md)
- [Task 02](./02-barrel-files-remaining-modules.md)

## User stories addressed

- Completes the refactor end-to-end: every cross-module import now goes through a stable public contract
