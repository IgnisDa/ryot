# Sandbox Driver Refactor

## Problem Statement

The sandbox system forces search and details logic for each media provider to live in two
separate `sandbox_script` rows. A dedicated join table (`entity_schema_sandbox_script`) then
stitches each search+details pair to an entity schema. This creates three redundancies:

1. Every provider requires exactly two scripts and one join-table record — a rigid, bookkeeping-
   heavy contract with no flexibility.
2. The runner wraps user code as a raw function body, so there is no way for a single script to
   expose more than one callable entry point.
3. The API surface (and frontend) models this rigidity explicitly: `searchProviders` carries both
   `searchScriptId` and `detailsScriptId`, spreading script-identity knowledge across every
   layer from DB to UI.

## Solution

Introduce a named **driver** registration pattern to the sandbox runner, collapse each
provider's two scripts into one, and replace the three-column join table with a simple two-
column one.

**Runner change.** The runner injects a `driver(name, fn)` registration function alongside the
API stubs. Scripts call it to declare entry points. After the script body executes, the runner
looks up `payload.driverName` in the registry and invokes that function with the execution
context.

```javascript
// Combined provider script (single DB row)
driver("search", async function(context) {
    const response = await httpCall("POST", "https://graphql.anilist.co", { ... });
    return { items: [...], details: { totalItems, nextPage } };
});

driver("details", async function(context) {
    const response = await httpCall("POST", "https://graphql.anilist.co", { ... });
    return { name, externalId, properties };
});
```

**DB change.** Drop `entity_schema_sandbox_script`. Introduce `entity_schema_script`
with only `(entitySchemaId, sandboxScriptId)`. Rename `entity.detailsSandboxScriptId` to
`entity.sandboxScriptId` — the semantic is unchanged (provenance), only the column name
reflects that it is no longer specifically a "details" script.

**API change.** `searchProviders` on the entity-schema response becomes `providers`, each
item carrying `{ name, scriptId }` instead of `{ name, searchScriptId, detailsScriptId }`.
The caller passes `driverName` when enqueueing sandbox execution.

## User Stories

1. As a developer writing a provider script, I want to declare `driver("search", fn)` and
   `driver("details", fn)` in one file, so that I don't have to maintain two separate scripts
   that share helper functions.
2. As a developer writing a provider script, I want host functions (`httpCall`,
   `getAppConfigValue`) to be available by closure inside each driver function, so that I don't
   have to thread them through as parameters.
3. As a developer, I want the runner to throw a clear error when the requested `driverName` is
   not registered by the script, so that misconfiguration is immediately obvious.
4. As a developer seeding built-in providers, I want a single script slug per provider (e.g.
   `anilist.anime`) instead of two (e.g. `anilist.anime.search` and `anilist.anime.details`),
   so that the manifest is half the size and easier to audit.
5. As a developer reviewing the schema, I want the join table to express only
   `(entitySchemaId, sandboxScriptId)`, so that the purpose of the table is immediately
   obvious without needing to understand the search/details split.
6. As a frontend developer, I want the entity-schema API to return `providers[].scriptId`
   instead of `providers[].searchScriptId` + `providers[].detailsScriptId`, so that the
   distinction between search and details is an execution concern, not a data-model concern.
7. As a frontend developer, I want to pass `driverName: "search"` or `driverName: "details"`
   when enqueueing a sandbox job, so that the same script can serve both roles.
8. As a user adding an entity through the search modal, I want the system to work exactly as
   before — search results appear, I pick one, details are fetched, entity is created — with
   no visible change.
9. As a developer modeling entity provenance, I want `entity.sandboxScriptId` to indicate
   which provider script produced the entity, without implying it is specifically a "details"
   script.
10. As a developer writing a future provider script that also exposes a `refresh` driver, I
    want the system to support that without any schema or runner changes.

## Implementation Decisions

### Runner (`runner-source.txt`)

- Parse `driverName` from the stdin payload alongside the existing fields.
- Before executing the script, build a `driverRegistry` object and a `driver(name, fn)`
  function that writes into it.
- Inject `driver` as the first positional name in the `sandboxMain` parameter list, ahead of
  the API stubs.
- After `await userFunction(...)` completes, look up `driverRegistry[driverName]` and call it
  with `context`. Throw if the name is absent.
- If `driverName` is absent from the payload, fall back to using the script's return value
  directly (preserves compatibility with non-driver scripts like user-authored raw scripts).

### Sandbox types and service (`lib/sandbox/`)

- Add `driverName?: string` to `SandboxEnqueueOptions`.
- The lib-level sandbox service passes `driverName` through to the Deno subprocess payload.

### Sandbox module service (`modules/sandbox/service.ts`)

- Accept and forward `driverName` from the enqueue request body.

### Sandbox enqueue route

- Add optional `driverName` field to the request body schema.

### DB schema (`tables.ts`)

- Drop `entitySchemaSandboxScript` table definition.
- Add `entitySchemaScript` table with `id`, `entitySchemaId` (FK), `sandboxScriptId` (FK),
  `createdAt`, `updatedAt`, and a unique constraint on `(entitySchemaId, sandboxScriptId)`.
- On the `entity` table, rename `detailsSandboxScriptId` to `sandboxScriptId`. The FK target
  and nullability stay the same. The unique constraint `(userId, externalId, entitySchemaId,
  sandboxScriptId)` replaces the old one that used `detailsSandboxScriptId`.

### DB relations (`relations.ts`)

- Replace all references to `entitySchemaSandboxScript` and its dual relation names
  (`searchScript`, `detailsScript`) with a single relation from `entitySchemaScript` to both
  `entitySchema` and `sandboxScript`.
- Update the `entity` → `sandboxScript` relation to reference `sandboxScriptId`.

### DB migration

No migration file will be written. The database will be recreated manually once the full
implementation is complete. Only `tables.ts` and `relations.ts` need to be updated to reflect
the new schema.

### Entity schemas module

- **Repository**: Remove the join to `entitySchemaSandboxScript`. Instead join `entitySchemaScript`
  and the linked `sandboxScript`. Build `providers: Array<{ name, scriptId }>` from this join.
  The `name` field comes from `sandboxScript.name`.
- **Schemas**: Replace `searchProviderSchema` (which had `searchScriptId` and `detailsScriptId`)
  with `providerSchema` containing only `name` and `scriptId`. Rename the array field on
  `listedEntitySchemaSchema` from `searchProviders` to `providers`.
- **Routes**: No route path changes; the response shape change propagates automatically.

### Entities module

- **Schemas**: Rename `detailsSandboxScriptId` to `sandboxScriptId` in `createEntityBody` and
  the entity response schema.
- **Repository**: Update column references in `findEntityByExternalIdForUser` and
  `createEntityForUser`.
- **Service**: Update the validation error message that references the old field name.

### Seed data

- **Manifests**: Replace the 16-entry search/details slug pairs in `entitySchemaScriptLinks`
  with 8 single-slug entries (one per provider). Script slugs drop the `.search`/`.details`
  suffix, e.g. `anilist.anime`.
- **Helpers**: Replace `linkScriptPairToEntitySchema` (which inserted into
  `entitySchemaSandboxScript`) with `linkScriptToEntitySchema` (which inserts into
  `entitySchemaScript`).
- The `sandboxScripts` manifest list shrinks from 16 entries to 8.

### Media-provider scripts

- Merge each `search.txt` + `details.txt` pair into a single `index.txt` per provider
  directory. The combined file declares both drivers using `driver("search", ...)` and
  `driver("details", ...)`. Shared helper functions (e.g. `parseJsonResponse`,
  `collectGenres`) appear once at the top of the file.
- Affected directories: `anime/anilist`, `anime/myanimelist`, `book/openlibrary`,
  `book/hardcover`, `book/google-books`, `manga/anilist`, `manga/myanimelist`,
  `manga/manga-updates`.

### OpenAPI spec

- After all backend changes, regenerate the spec with
  `bun run --filter=@ryot/generated app-backend-openapi` (dev server must be running).
- The generated TypeScript types in `libs/generated/src/openapi/app-backend.d.ts` will
  reflect the new field names automatically.

### Frontend (`apps/app-frontend`)

- **`use-search.ts`**: Replace `provider.searchScriptId` with `provider.scriptId` and pass
  `driverName: "search"` in the enqueue call. Replace `provider.detailsScriptId` with
  `provider.scriptId` and pass `driverName: "details"`. Replace `detailsSandboxScriptId`
  with `sandboxScriptId` in the entity creation payload.
- **`model.ts`** (entities): Rename `detailsSandboxScriptId` → `sandboxScriptId`.
- **Test fixtures**: Update `entity-schemas.ts` (`searchProviders: []` → `providers: []`) and
  `entities.ts` (`detailsSandboxScriptId` → `sandboxScriptId`).
- No UI or visual changes; provider selection and search/details flow remain identical.

## Testing Decisions

A good test verifies observable behavior at a module boundary, not internal field names or
wiring details. Tests should cover what happens when inputs are valid, when they are invalid,
and when dependencies return errors.

### Modules to test

- **`runner-source.txt`** (Deno script): The runner is tested via integration — spin up the
  Deno process, feed a crafted payload over stdin, assert stdout. Existing patterns in
  `lib/sandbox/service.test.ts` (if present) or the queue worker tests serve as prior art.
- **`lib/sandbox/service.ts`**: Unit-test that `driverName` is forwarded correctly in the
  payload sent to the subprocess. Mock the Deno spawn.
- **Entity schemas repository**: Test that the new `providers` array is built correctly from
  the joined data. Existing repository test patterns in `modules/entity-schemas/` are prior art.
- **Entities service**: Test the validation path that rejects `externalId` without
  `sandboxScriptId` and vice versa. Existing service tests are prior art.
- **Seed helpers**: Test `linkScriptToEntitySchema` inserts the correct row and that
  duplicate inserts are idempotent.

## Out of Scope

- Adding new driver names beyond `search` and `details` to existing provider scripts.
- A UI for users to inspect which provider script is attached to an entity schema.
- Any refresh/sync functionality that would re-invoke a provider's `details` driver on an
  already-created entity.
- User-authored scripts with multiple drivers (the system supports it; no UI is built for it).
- Removing or changing the `sandbox_script` table itself.

## Further Notes

- The `driver()` registration function is injected as the first name in the `sandboxMain`
  parameter list. Scripts that do not call `driver()` at all and instead use raw `return`
  statements will continue to work when `driverName` is omitted from the payload. This is
  intentional — user-authored sandbox scripts (not provider scripts) are not required to
  adopt the driver pattern.
- The `name` field on each provider continues to come from `sandboxScript.name`, so renaming
  a built-in script in the seed data will flow through to the UI automatically.
- Because the unique constraint on `entity` still includes `sandboxScriptId`, two different
  provider scripts pointing to the same external ID will still produce separate entity rows.
  The deduplication semantic is preserved.

---

## Tasks

**Overall Progress:** 4 of 5 tasks completed

**Current Task:** [Task 05](./05-frontend-updates.md) (todo)

### Task List

| # | Task | Type | Status | Blocked By |
|---|------|------|--------|------------|
| 01 | [Runner Driver Registration](./01-runner-driver-registration.md) | AFK | done | None |
| 02 | [DB Schema Update](./02-db-schema-update.md) | AFK | done | None |
| 03 | [Entity Schemas Providers and Seed](./03-entity-schemas-providers-and-seed.md) | AFK | done | Task 02 |
| 04 | [Entities Field Rename](./04-entities-field-rename.md) | AFK | done | Task 02 |
| 05 | [Frontend Updates](./05-frontend-updates.md) | AFK | todo | Tasks 03, 04 |
