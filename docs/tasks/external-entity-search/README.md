# External Entity Search

## Problem Statement

Users who want to track books, anime, manga, or other media must manually type all metadata
(title, page count, genres, cover image, etc.) when creating an entity. There is no way to
discover entities from external data sources (Open Library, Google Books, AniList, and so on)
inside Ryot. This makes onboarding new entities slow and error-prone.

## Solution

Extend the backend to support searching external sources and importing entity data from them.
Each entity schema declares a list of search providers — pairs of sandbox scripts that know
how to query an external API and fetch structured details for a single result. The frontend
uses these providers to let users search, preview, and add entities in one cohesive flow.

The backend changes are purely additive:

1. **Generic script-by-ID enqueueing** — the existing `POST /sandbox/enqueue` endpoint gains a
   second variant that accepts a stored script ID instead of raw code. Any stored script
   (built-in or user-owned) can be executed by referencing its ID. This makes the endpoint
   the single generic mechanism for running any sandbox script from the frontend.

2. **Search providers on entity schemas** — the `GET /entity-schemas` list response is
   extended to include the set of search providers available for each schema. A provider
   carries the script IDs the frontend needs to enqueue search and details jobs, plus a
   human-readable name.

3. **Provenance fields on entity creation** — `POST /entities` gains optional `externalId`
   and `detailsSandboxScriptId` fields. When both are supplied the endpoint behaves as an
   idempotent upsert: if an entity with the same `(userId, externalId, entitySchemaId,
   detailsSandboxScriptId)` already exists, it is returned as-is rather than creating a
   duplicate.

The full search-to-import flow then works as follows without any additional endpoints:

```
GET  /entity-schemas           → schema list with searchProviders (name, searchScriptId, detailsScriptId)
POST /sandbox/enqueue          → { kind: "script", scriptId: searchScriptId, context: { query, page, pageSize } } → { jobId }
GET  /sandbox/result/:jobId    → poll until completed; value = { items, details: { totalItems, nextPage } }
POST /sandbox/enqueue          → { kind: "script", scriptId: detailsScriptId, context: { identifier } } → { jobId }
GET  /sandbox/result/:jobId    → poll until completed; value = { name, externalId, properties, ... }
POST /entities                 → create with externalId + detailsSandboxScriptId (idempotent)
```

## User Stories

1. As a user, I want to search for a book by title from the Books entity list page, so that I
   can find and add it to my library without manually typing all metadata.
2. As a user, I want to choose which external data source to search from (e.g. Open Library vs
   Google Books), so that I can pick the provider with the best data for what I am looking for.
3. As a user, I want to see a paginated list of search results with titles, cover images, and
   publication years, so that I can identify the correct result quickly.
4. As a user, I want to click a search result and have the entity creation form pre-filled with
   the data fetched from the external source, so that I only have to confirm rather than type.
5. As a user, I want to edit any pre-filled field before confirming, so that I can correct
   inaccuracies in the imported data.
6. As a user, I want adding a book I have already added before to be a no-op, so that I do not
   end up with duplicate entries if I accidentally search and import the same title twice.
7. As a user, I want the same search experience to work for anime, manga, and any other entity
   schema that has search providers configured, so that I do not need different workflows per
   media type.
8. As a user, I want my custom entity schemas (not just built-in ones) to be able to have
   search providers if I write the scripts myself, so that I can extend the search experience
   to trackers I create.
9. As a backend developer, I want to enqueue any stored sandbox script by its ID via
   `POST /sandbox/enqueue`, so that I can reuse the same enqueue-and-poll mechanism for any
   script-driven feature without adding new endpoints.
10. As a backend developer, I want the script-by-ID variant of the enqueue endpoint to enforce
    access control (`isBuiltin || ownedByUser`), so that users cannot run scripts they do not
    own.
11. As a backend developer, I want the resolved script code to be stored in the BullMQ job
    payload alongside the originating `scriptId`, so that the worker is self-contained and
    `scriptId` is available for debugging and audit.
12. As a backend developer, I want the same standard set of host function descriptors
    (httpCall, getAppConfigValue, getUserConfigValue, getEntitySchemas) to be injected for
    script-by-ID jobs, so that scripts can call external APIs and read configuration without
    any extra wiring.
13. As a backend developer, I want `GET /entity-schemas` to always include `searchProviders`
    in every response, so that the frontend has all the information it needs in a single
    request without opting in.
14. As a backend developer, I want `searchProviders` to be an empty array (not omitted) for
    schemas with no linked scripts, so that frontend code never has to guard for undefined.
15. As a backend developer, I want `POST /entities` to accept optional `externalId` and
    `detailsSandboxScriptId`, so that entities created from external sources carry their
    provenance in the database.
16. As a backend developer, I want entity creation with `externalId` + `detailsSandboxScriptId`
    to be an idempotent upsert (return the existing entity on duplicate), so that the client
    can safely retry or re-confirm without worrying about double-inserts.
17. As a backend developer, I want the duplicate check for external entities to use the
    existing unique constraint `(userId, externalId, entitySchemaId, detailsSandboxScriptId)`,
    so that the upsert logic is consistent with the database-level guarantee.
18. As a backend developer, I want the entity service's `createEntity` to remain fully unit-
    testable with injected dependencies after the idempotent upsert logic is added, so that
    the new behaviour is covered without a live database.
19. As a script author, I want search scripts to receive `{ query, page, pageSize }` as
    context and return `{ items: [{ title, identifier, publishYear, image }], details: {
    totalItems, nextPage } }`, so that there is a stable contract between the scripts and the
    frontend.
20. As a script author, I want details scripts to receive `{ identifier }` as context and
    return `{ name, externalId, properties: { ..., assets: { remoteImages: [...] } } }`, so
    that the frontend knows exactly where to find the cover image and entity fields.

## Implementation Decisions

### Sandbox enqueue — discriminated union body

`POST /sandbox/enqueue` accepts a discriminated union on `kind`:

- `{ kind: "code", code: string, context?: Record<string, unknown> }` — existing behaviour,
  unchanged.
- `{ kind: "script", scriptId: string, context?: Record<string, unknown> }` — new variant.
  The backend looks up the `sandboxScript` row by `scriptId`, validates that
  `script.isBuiltin === true || script.userId === user.id` (404 otherwise), and enqueues the
  job with the resolved `code`. Both `scriptId` and `code` are stored in the job payload.

### scriptId in job data

`sandboxRunJobData` gains an optional `scriptId` field. It is populated only for
script-by-ID jobs. The worker does not use it for execution; it is stored for observability.

### Standard apiFunctionDescriptors for script-by-ID jobs

Script-by-ID jobs inject the same four descriptors that the existing code-based enqueue
already injects: `httpCall`, `getAppConfigValue`, `getUserConfigValue`, `getEntitySchemas`
(the last one with `{ userId }` as context). This is assembled in the route handler using
the existing `createApiFunctionDescriptors(userId)` helper.

### searchProviders on entity schemas

`listedEntitySchemaSchema` gains:

```
searchProviders: Array<{
  name: string            // taken from the search sandboxScript's name field
  searchScriptId: string
  detailsScriptId: string
}>
```

The `listEntitySchemasForUser` repository function is extended to left-join
`entitySchemaSandboxScript` and both referenced `sandboxScript` rows, and aggregate
the results per schema. Schemas with no linked scripts get an empty array.

The `name` of a search provider is the `name` column of the **search** script (e.g.
"OpenLibrary Book Search"). The details script name is not surfaced — only its ID.

### Entity creation — idempotent upsert

`createEntityBody` gains two optional fields:

- `externalId: string` — the identifier assigned by the external source.
- `detailsSandboxScriptId: string` — the ID of the details script used to import the entity.

Both must be present together; supplying only one is a validation error. When both are
present the service calls a new repository function `findEntityByExternalIdForUser` before
inserting. If a matching entity exists it is returned immediately with a `200`. Otherwise
the entity is inserted with `externalId` and `detailsSandboxScriptId` populated.

`createEntityForUser` in the repository is extended to accept the two optional provenance
fields and write them to the `entity` table.

### No new entity-schema-scoped search/details endpoints

The frontend calls `POST /sandbox/enqueue` directly with the `scriptId` it received from
`searchProviders`. No `POST /entity-schemas/:id/search` or `/details` endpoints are added.
Schema-linkage validation (is this script actually linked to this schema?) is not enforced
server-side; access control (is this script accessible to this user?) is enforced on the
enqueue endpoint.

### No post-processing of details results

The details script's raw `value` is returned as-is by `GET /sandbox/result/:jobId`. The
frontend extracts `properties.assets.remoteImages[0]` for the cover image suggestion. The
`existingEntityId` check is replaced by the idempotent upsert on `POST /entities`.

### No new DB migrations

`entity.externalId` and `entity.detailsSandboxScriptId` already exist in the schema. The
unique constraint `(userId, externalId, entitySchemaId, detailsSandboxScriptId)` already
exists. No migration is needed.

## Testing Decisions

A good test exercises **observable behaviour through a public interface**, not internal
implementation details. Tests should use injected mock dependencies (matching the existing
`EntityServiceDeps` pattern) for unit tests, and avoid live DB or network calls.

### Modules with tests

**Sandbox enqueue — script-by-ID access control logic**

Test the pure function (or helper) that determines whether a user may run a given script:

- Built-in script (`isBuiltin: true`, `userId: null`) → allowed for any user.
- User-owned script (`userId === user.id`) → allowed.
- Script owned by another user (`userId !== user.id`, `isBuiltin: false`) → not allowed.
- Script not found → not allowed.

Prior art: `function-registry.test.ts` — small, pure, no DB.

**Entity service — idempotent upsert**

Extend the existing `createEntity` test suite in `service.test.ts`:

- When `externalId` and `detailsSandboxScriptId` are provided and a matching entity exists,
  `createEntity` returns the existing entity without calling `createEntityForUser`.
- When both are provided and no matching entity exists, `createEntity` calls
  `createEntityForUser` with the provenance fields populated.
- When only one of `externalId` / `detailsSandboxScriptId` is provided (without the other),
  `createEntity` returns a validation error.
- When neither is provided, existing behaviour is unchanged.

Prior art: the existing `createEntity` tests use `createEntityDeps` with partial overrides.
A `findEntityByExternalIdForUser` dependency slot will be added to `EntityServiceDeps`.

### Modules without dedicated tests

- `listEntitySchemasForUser` repository extension — the join/aggregation is SQL-level logic
  that would need a live DB. Covered by manual verification and future E2E tests.
- `POST /sandbox/enqueue` route handler for `kind: "script"` — the DB lookup in the route
  is thin glue; the access-control logic is extracted and unit-tested separately.

## Out of Scope

- Frontend implementation: Search tab UI, results list, details preview, form pre-fill.
- New TMDB and IGDB sandbox scripts.
- Script authoring or management UI (create, edit, delete sandbox scripts).
- Paginated search results caching.
- Rate limiting on sandbox enqueue.
- Surfacing `existingEntityId` in the details result (replaced by idempotent upsert).
- Entity-schema-scoped validation of whether a scriptId is linked to a schema.

## Further Notes

The search script output contract (`{ items, details }`) and the details script output
contract (`{ name, externalId, properties }`) are defined by convention in the script
source files. These contracts are not validated server-side; the frontend owns parsing and
displaying the raw `value`. Future work could introduce server-side schema validation of
script output for specific registered script types.

The `sandboxScript.name` field is used as the provider display name. Script authors should
give search scripts descriptive names (e.g. "OpenLibrary Book Search") because this string
appears directly in the provider selector UI.

---

## Tasks

**Overall Progress:** 2 of 3 tasks completed

**Current Task:** [Task 03](./03-entity-creation-with-provenance.md) (todo)

### Task List

| # | Task | Type | Status | Blocked By |
|---|------|------|--------|------------|
| 01 | [Sandbox Enqueue by Script ID](./01-sandbox-enqueue-by-script-id.md) | AFK | done | None |
| 02 | [Search Providers on Entity Schemas](./02-search-providers-on-entity-schemas.md) | AFK | done | None |
| 03 | [Entity Creation with Provenance](./03-entity-creation-with-provenance.md) | AFK | todo | None |
