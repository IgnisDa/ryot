# DB Schema Update

**Parent Plan:** [Sandbox Driver Refactor](./README.md)

**Type:** AFK

**Status:** done

## What to build

Update the Drizzle schema and relations to reflect the simplified data model: drop the
`entitySchemaSandboxScript` join table, introduce the leaner `entitySchemaScript` table, and
rename `entity.detailsSandboxScriptId` to `entity.sandboxScriptId`.

**No migration file is needed.** The database will be recreated manually once the full
implementation is complete. Update only `tables.ts` and `relations.ts`.

See the **DB schema** and **DB relations** sections of the parent PRD for the full design.

## Acceptance criteria

- [x] `entitySchemaSandboxScript` table definition is removed from `tables.ts`.
- [x] A new `entitySchemaScript` table is defined in `tables.ts` with columns `id`,
      `entitySchemaId` (FK → `entity_schema`, cascade delete), `sandboxScriptId`
      (FK → `sandbox_script`, cascade delete), `createdAt`, `updatedAt`, and a unique
      constraint on `(entitySchemaId, sandboxScriptId)`.
- [x] `entity.detailsSandboxScriptId` is renamed to `entity.sandboxScriptId` in `tables.ts`.
      FK target, nullability, and on-delete behaviour are unchanged.
- [x] The unique constraint on `entity` is updated to reference `sandboxScriptId` in place of
      `detailsSandboxScriptId`.
- [x] All references to `entitySchemaSandboxScript` and its dual relation names (`searchScript`,
      `detailsScript`) are removed from `relations.ts`.
- [x] `entitySchemaScript` has a relation to `entitySchema` (many-to-one) and a relation to
      `sandboxScript` (many-to-one) defined in `relations.ts`.
- [x] The `entity` → `sandboxScript` relation in `relations.ts` references `sandboxScriptId`.
- [x] `bun run typecheck` passes in `apps/app-backend`.

## Blocked by

None — can start immediately.

## User stories addressed

- User story 5
- User story 9
