# Saved-View Migration

**Parent Plan:** [RyotQL](./README.md)

**Status:** todo

## What to build

Migrate saved views as one bounded vertical slice. Change all built-in and user-created saved-view producers, validation, persistence typing, cloning, updating, retrieval, execution, rendering, and tests from legacy query documents to expanded RyotQL documents. Do not add dual-format records, document-shape detection, recipe-name persistence, or user-data compatibility behavior.

Saved views persist the expanded named-query document returned by recipes. Management commands remain explicit domain endpoints. Routine saved-view reads and execution use RyotQL where appropriate, and superseded read endpoints may be removed once no caller remains. Dynamic renderers continue receiving `{ kind, value }` fields and must handle named query results explicitly.

## Acceptance criteria

- [ ] Saved-view contract and persistence types accept expanded RyotQL documents and no longer accept legacy query documents
- [ ] All built-in saved-view definitions and create/update/clone inputs produce RyotQL documents directly
- [ ] Saved-view validation uses the authenticated RyotQL validator and cannot select hidden tables or fields
- [ ] Saved-view execution reads the intended named result and preserves rows, includes, aggregates, time series, pagination, and dynamic field kinds
- [ ] Saved-view rendering and formatting preserve text, number, boolean, date, JSON, and null behavior
- [ ] Saved-view management commands retain their domain validation and side effects rather than becoming RyotQL mutations
- [ ] No runtime branch, database discriminator, or adapter supports both legacy and RyotQL saved-view documents
- [ ] Superseded saved-view read endpoint consumers and contract operations are removed only after repository-wide reference checks
- [ ] Management, rendering, recipe, backend, client, plugin, and end-to-end saved-view tests pass
- [ ] Repository checks find no persisted production recipe or consumer still constructing a legacy query document
- [ ] The remaining legacy engine stays complete for any non-saved-view consumer until final deletion

## User stories addressed

- User story 15
- User story 16
- User story 17
- User story 23
- User story 28
- User story 31
- User story 45
