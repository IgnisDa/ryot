# Entities Field Rename

**Parent Plan:** [Sandbox Driver Refactor](./README.md)

**Type:** AFK

**Status:** done

## What to build

Rename `detailsSandboxScriptId` to `sandboxScriptId` throughout the entities module — in the
Zod schemas, repository queries, and service validation — and regenerate the OpenAPI spec so
the generated client types reflect the new name.

See the **Entities module** section of the parent PRD for the full design.

## Acceptance criteria

- [x] `detailsSandboxScriptId` is renamed to `sandboxScriptId` in `createEntityBody` in
      `modules/entities/schemas.ts`.
- [x] `detailsSandboxScriptId` is renamed to `sandboxScriptId` in the entity response schema
      in `modules/entities/schemas.ts`.
- [x] `findEntityByExternalIdForUser` in the entities repository uses `sandboxScriptId` in its
      where clause and select projection.
- [x] `createEntityForUser` in the entities repository passes `sandboxScriptId` when building
      the insert payload.
- [x] The validation error in `modules/entities/service.ts` that rejects a mismatched
      `externalId` / script ID pair references `sandboxScriptId` in its message.
- [x] The OpenAPI spec is regenerated and the generated types in
      `libs/generated/src/openapi/app-backend.d.ts` show `sandboxScriptId` on the entity
      response and create-entity request body.
- [x] `bun run typecheck` and `bun test` pass in `apps/app-backend`.

## Blocked by

- [Task 02](./02-db-schema-update.md) ✓

## User stories addressed

- User story 8
- User story 9
