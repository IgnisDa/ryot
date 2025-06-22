# Worker: Global Media Import and HTTP Guard

**Parent Plan:** [Global Media Entities & User Library](./README.md)

**Type:** AFK

**Status:** todo

## Backwards compatibility

Backwards compatibility with existing user-scoped media entity rows is not required. Do not add migration code or dual-path fallbacks for old rows.

## What to build

Change the media import job to create globally-shared entities instead of user-scoped copies, and close the HTTP back-door that previously allowed user-scoped creation of builtin-schema entities.

**Worker change (`media/worker.ts`)** — Replace the `createEntity({ userId, ... })` call in `processMediaImportJob` with the global path already used for persons:
1. Call `createGlobalEntity` to upsert the media entity with `userId = null`.
2. Call `updateGlobalEntityById` to set full properties and image (mirroring `processPersonPopulateJob`).
3. Call `getUserLibraryEntityId` from Task 02 to retrieve the importing user's library entity id. Throw if it does not exist.
4. Call `upsertInLibraryRelationship` from Task 02 to write the `in_library` row.

After this change `processMediaImportJob` follows the same pattern as `processPersonStubs` + `processPersonPopulateJob` — it uses repository functions directly and does not go through the entity service.

**HTTP guard (`entities/service.ts`)** — The `createEntity` service currently blocks builtin schemas only when `externalId` is absent. Tighten the guard: if `scope.isBuiltin`, always return the `customEntitySchemaError` validation result, regardless of whether provenance fields are present. Builtin entities are exclusively created by the worker.

**Breaking e2e test** — The existing test "creates entity for a built-in schema when provenance fields are provided" in `tests/src/tests/entities.test.ts` must be updated: it now expects a `400` response with `"Built-in entity schemas do not support manual entity creation"` instead of a `200`.

**Unit tests** — Update `entities/service.test.ts`: the test "allows creation for a built-in schema when provenance fields are provided" becomes a rejection test.

## Acceptance criteria

- [ ] Two users importing the same title (same `externalId` + `sandboxScriptId` + `entitySchemaId`) produce exactly one `entity` row with `userId = null`.
- [ ] After import, a `relationship` row exists with `relType = 'in_library'`, `userId = importingUserId`, `sourceEntityId = globalEntityId`, `targetEntityId = userLibraryEntityId`.
- [ ] Re-importing the same title by the same user does not create a second `in_library` row.
- [ ] `POST /entities` with a builtin schema and valid provenance fields returns `400` with `"Built-in entity schemas do not support manual entity creation"`.
- [ ] Person stubs created during media import (`processPersonStubs`) continue to work correctly — persons remain global, relationships remain global (`userId = null`).
- [ ] The updated e2e test in `tests/src/tests/entities.test.ts` asserts the new `400` rejection behavior.
- [ ] `bun run typecheck`, `bun run test`, and `bun run lint` pass in both `apps/app-backend` and `tests`.

## Blocked by

- [Task 02](./02-in-library-repository-primitives.md)

## User stories addressed

- User story 1 (same entity row for same title across users)
- User story 9 (re-import is a no-op)
- User story 12 (person/cast data globally shared)
