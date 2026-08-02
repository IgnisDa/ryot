# Saved-View Migration

**Parent Plan:** [RyotQL](./README.md)

**Status:** completed

## What to build

Migrate saved views as one bounded vertical slice. Change all built-in and user-created saved-view producers, validation, persistence typing, cloning, updating, retrieval, execution, rendering, and tests from legacy query documents to expanded RyotQL documents. Do not add dual-format records, document-shape detection, recipe-name persistence, or user-data compatibility behavior.

Saved views persist the expanded named-query document returned by recipes. Management commands remain explicit domain endpoints. Routine saved-view reads and execution use RyotQL where appropriate, and superseded read endpoints may be removed once no caller remains. Dynamic renderers continue receiving `{ kind, value }` fields and must handle named query results explicitly.

The legacy `apps/app-client-backup/` renderer is outside this migration. The active `apps/app-client/` saved-view route is still a placeholder and has no existing renderer or execution consumer to cut over.

## Acceptance criteria

- [x] Saved-view contract and persistence types accept expanded RyotQL documents and no longer accept legacy query documents
- [x] All built-in saved-view definitions and create/update/clone inputs produce RyotQL documents directly
- [x] Saved-view validation uses the authenticated RyotQL validator and cannot select hidden tables or fields
- [x] Saved-view execution reads the intended named result and preserves rows, includes, aggregates, time series, pagination, and dynamic field kinds
- [ ] Saved-view rendering and formatting preserve text, number, boolean, date, JSON, and null behavior; the active client renderer is deferred because it does not exist yet and the legacy backup client is explicitly out of scope
- [x] Saved-view management commands retain their domain validation and side effects rather than becoming RyotQL mutations
- [x] No runtime branch, database discriminator, or adapter supports both legacy and RyotQL saved-view documents
- [x] No superseded saved-view read endpoint consumer remained in the active client, so no endpoint was removed
- [x] Management, recipe, backend, plugin, and affected end-to-end saved-view tests pass; no active client renderer exists to test
- [x] Repository checks find no persisted production recipe or consumer still constructing a legacy query document
- [x] The remaining legacy engine stays complete for any non-saved-view consumer until final deletion

## User stories addressed

- User story 15
- User story 16
- User story 17
- User story 23
- User story 28
- User story 31
- User story 45
