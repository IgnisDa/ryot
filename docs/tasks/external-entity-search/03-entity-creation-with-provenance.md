# Entity Creation with Provenance

**Parent Plan:** [External Entity Search](./README.md)

**Type:** AFK

**Status:** done

## What to build

Extend `POST /entities` to accept optional `externalId` and `detailsSandboxScriptId` fields.
When both are present, the service checks for an existing entity matching
`(userId, externalId, entitySchemaId, detailsSandboxScriptId)` before inserting. If one is
found it is returned immediately with a `200` — no duplicate is created. If not found, the
entity is created with the provenance fields populated.

Supplying only one of the two fields (without the other) must be rejected as a validation
error.

See the **Entity creation — idempotent upsert** decision in the parent PRD for the full
duplicate-check logic, the repository contract, and the dependency injection pattern for
tests.

## Acceptance criteria

- [x] `POST /entities` with `externalId` + `detailsSandboxScriptId` creates the entity with
      both provenance fields persisted.
- [x] A second `POST /entities` call with the same `externalId`, `detailsSandboxScriptId`,
      and `entitySchemaId` for the same user returns the existing entity (`200`) without
      inserting a new row.
- [x] Providing only `externalId` (without `detailsSandboxScriptId`) returns a `400`
      validation error, and vice-versa.
- [x] Omitting both fields preserves the existing behaviour (entity created without
      provenance).
- [x] `EntityServiceDeps` includes a `findEntityByExternalIdForUser` slot so the upsert
      logic is fully unit-testable without a live database.
- [x] Unit tests cover: upsert returns existing entity, upsert creates new entity, partial
      provenance fields rejected, no provenance fields unchanged behaviour.
- [x] `bun run typecheck` and `bun test` pass in `apps/app-backend`.

## Blocked by

None — can start immediately.

## User stories addressed

- User story 6 — adding an already-imported entity is a no-op (idempotent)
- User story 15 — `POST /entities` accepts `externalId` and `detailsSandboxScriptId`
- User story 16 — idempotent upsert on duplicate external entity
- User story 17 — upsert uses the existing unique constraint
- User story 18 — service remains unit-testable after idempotent upsert logic is added
