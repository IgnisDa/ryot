# Test-Support Endpoints

## Problem Statement

The e2e suite (`tests/`) bypasses the backend's HTTP API and talks directly to Postgres (via `getPgClient()` from `tests/src/setup.ts`) in ~25 remaining call sites. These fall into two buckets:

1. **Writes the API cannot express**: promoting sandbox scripts to builtins, tampering with script source/metadata, creating global (`user_id` null) entities/relationships, seeding entity translations, setting `entity.populated_at`, linking auth accounts to existing users, creating event schema triggers, and cleanup deletes for all of the above.
2. **Reads of state the API does not expose**: stored compiled script representations, global relationship edge properties, translation rows, builtin structural schema ids.

Direct SQL in tests is brittle (schema drift breaks tests silently), duplicates backend invariants in raw SQL, and bypasses the validated write paths the codebase requires ("every table has exactly one owning repository", property-schema validation on writes).

A first batch of hacks was already migrated to existing endpoints with zero backend work (query-engine reads, `entities.get`, `godMode.listUsers`, real upload flow). This PRD covers the remainder, which require new backend functionality.

## Solution

Add a new admin-gated HTTP group, **`testSupport`**, to the contract and backend, containing ~15 endpoints that expose exactly the operations the e2e suite needs. Then migrate every remaining direct-SQL fixture/test call site to them.

Key properties (all decided with the maintainer):

- The endpoints are **always registered, in production too** — gated solely by the existing `AdminMiddleware` (the `Admin-Access-Token` header checked against `SERVER_ADMIN_ACCESS_TOKEN`). There is **no enablement flag**. The admin token has no default value, so deployments that never set it have all admin routes unreachable (the middleware rejects empty tokens).
- The new backend module **composes existing services**; it never writes another module's tables directly. New capabilities are added by **editing/extending the owning module's existing service and repository methods** — no parallel services, no parallel repositories, no duplicate write paths. New methods are added only where no existing path exists.
- Endpoint names mirror plausible future product endpoints (`getSandboxScript`, `createEventSchemaTrigger`, …) so that if the product later adds real CRUD, migrating tests off test-support is mechanical.

Two SQL call sites remain as raw SQL **by decision** (white-box assertions over internals no endpoint should expose): the `cluster_messages`/`cluster_replies` workflow polling in `tests/src/tests/media-monitoring/media-monitoring.test.ts`, and the post-deletion tracker check in `tests/src/tests/god-mode/delete-user.test.ts`. Two more remain as agreed borderline keeps: `queryUserEntityStateCounts` (`tests/src/fixtures/user-state.ts`) and `countMediaMonitoringRelationships` (`tests/src/fixtures/media-monitoring.ts`).

## User Stories

1. As a maintainer of the e2e suite, I want every test-database interaction to go through typed HTTP endpoints, so that schema changes surface as contract/type errors instead of silently-rotting raw SQL.
2. As a maintainer, I want fixture helpers like `seedBuiltinProviderScript` and `cleanupBuiltinProviderScript` to call endpoints, so provider-driven tests contain no SQL at all.
3. As a maintainer, I want to promote an API-compiled sandbox script to a global builtin via an endpoint, so tests can mint providers without `UPDATE sandbox_script SET user_id = null`.
4. As a maintainer, I want to patch a script's stored source/metadata without recompilation, so fault-injection tests (tampered manifest, desynced source) stay possible without SQL.
5. As a maintainer, I want one endpoint call to delete a sandbox script and everything it produced (entities, relationships, schema links), so test teardown is a single idempotent call that can never mask a test failure.
6. As a maintainer, I want to create global (`user_id` null) entities and relationships through the validated write path, so show→season→episode trees and query-engine fixtures need no `INSERT` statements.
7. As a maintainer, I want to read global relationship edges (including self-edges) with their properties, so trending and search-import assertions stop selecting from `relationship` directly.
8. As a maintainer, I want to upsert and list entity translation rows, so translation/negative-cache scenarios are seedable without SQL.
9. As a maintainer, I want to set `entity.populated_at` (or clear it) through an endpoint, so staleness/ordering scenarios need no `UPDATE entity`.
10. As a maintainer, I want to link an arbitrary auth account (e.g. a synthetic OIDC account) to an existing user, so mixed-auth recovery/reset scenarios need no `INSERT INTO "account"`.
11. As a maintainer, I want to create event schema triggers through an endpoint, so before_create/after_create trigger tests need no `INSERT INTO event_schema_trigger`.
12. As a maintainer, I want to look up builtin structural entity schemas (`show-season`, `show-episode`, `podcast-episode`, `movie-group`) by slug, since the tracker-scoped list API cannot see them.
13. As a maintainer, I want the new backend code to live in the owning modules (extended, not duplicated), so table ownership and write-path validation stay intact.
14. As the operator of a Ryot deployment, I want these endpoints unreachable without the admin token, so the forgery surface is protected by the same credential that already guards `deleteUser`.
15. As a maintainer, I want `tests/AGENTS.md` to document the endpoint-based seeding patterns, so future tests stop re-introducing raw SQL.

## Implementation Decisions

### New contract group: `testSupport`

Location: `libs/contract/src/modules/test-support/contract.ts` (plus `schemas.ts` if it grows), registered in `libs/contract/src/contract.ts` via `.add(TestSupportGroup)`. Follows the `godMode` precedent: group-level `.addError(Unauthorized, { status: 401 })` and `.middleware(AdminMiddleware)` applied **at group level** (same mechanism `AuthMiddleware` is applied at group level in `RelationshipsGroup`). `AdminMiddleware` is defined in `libs/contract/src/auth-middleware.ts`; its live implementation (`AdminMiddlewareLive`) is already provided in the server layer.

All paths are prefixed `/test-support/`. All endpoints are **always registered** — no config flag. Date fields on the wire are ISO 8601 strings; branded ids use the existing brands (`SandboxScriptId`, `EntityId`, `EntitySchemaId`, `RelationshipSchemaId`, `UserId`) from `@ryot/contract/schema/brands`.

### Endpoint inventory

Schemas named `TestSupport*` below are new and live in the test-support contract module. Reused schemas: `SandboxScriptMetadata` (from the sandbox contract module), `ListedEntity` (entities module), `RelationshipScope` (relationships module), plus the shared errors (`NotFound`, `BadRequest`, `Unauthorized`, `InternalError`).

1. **`getSandboxScript`** — `GET /test-support/sandbox-scripts/:scriptId`
   Success: `TestSupportStoredSandboxScript` = `{ id, slug, name, source, metadata: SandboxScriptMetadata, compiledCode: string, compiledFormat: number }` (verbatim `sandbox_script` columns). 404 when missing.

2. **`listSandboxScripts`** — `GET /test-support/sandbox-scripts?userId=…`
   urlParams: `{ userId?: string }`. With `userId`: that user's scripts. Omitted: global (`user_id` null) scripts. Success: array of `TestSupportStoredSandboxScript`. (Used to assert "no script with source X exists" after a failed compile — filter test-side.)

3. **`patchSandboxScript`** — `PATCH /test-support/sandbox-scripts/:scriptId`
   Payload: `{ source?, metadata?, compiledCode?, compiledFormat?, slug?, name? }` (all optional; `compiledFormat` number). Success: updated `TestSupportStoredSandboxScript`. **Never recompiles** — desync between `source` and `compiledCode` is the intended fault injection. 404 when missing.

4. **`promoteSandboxScript`** — `POST /test-support/sandbox-scripts/:scriptId/promote`
   No payload. Sets `is_builtin = true`, `user_id = null`. Success: updated `TestSupportStoredSandboxScript`. 404 when missing.

5. **`deleteSandboxScript`** — `DELETE /test-support/sandbox-scripts/:scriptId`
   Success: `{ id }`. Cascade, in order: (a) relationships whose source or target entity has this `sandbox_script_id`; (b) entities with this `sandbox_script_id`; (c) `entity_schema_sandbox_script` rows for this script; (d) the script row. **Idempotent**: deleting a missing script still succeeds, so `afterAll` cleanups never mask test failures.

6. **`linkSandboxScriptToEntitySchema`** — `PUT /test-support/entity-schemas/:entitySchemaId/sandbox-scripts/:scriptId`
   Success: `{ id }` (the link row id). Idempotent insert (unique `(entitySchemaId, sandboxScriptId)` — conflict = no-op). No `unlink` endpoint: link cleanup flows through `deleteSandboxScript`'s cascade.

7. **`createGlobalEntity`** — `POST /test-support/entities/global`
   Payload: `{ name, entitySchemaId, properties, externalId?, sandboxScriptId?, populatedAt?: string | null }`. Success: `ListedEntity` (201). Implemented via the existing `EntitiesService.create` with `scope: "global"`; when `populatedAt` is provided, the test-support service then calls the existing `EntitiesService.update` with unchanged fields and the new `populatedAt`.

8. **`deleteGlobalEntities`** — `POST /test-support/entities/global/delete`
   Payload: `{ ids: EntityId[] }` (minItems 1). Success: `{ deleted: number }`. Idempotent. Deletes entity rows by id regardless of `user_id`; matches current SQL semantics (plain `delete from entity where id = any(...)` — no relationship cascade).

9. **`upsertGlobalRelationship`** — `PUT /test-support/relationships/global`
   Payload: `{ sourceEntityId, targetEntityId, relationshipSchemaId, properties? }`. Success: `RelationshipScope`. Implemented via the existing `RelationshipsService.create` with `scope: "global"` (the repository's `RelationshipIdentityInput` already has a `{ scope: "global" }` variant). Properties are validated against the relationship schema's property schema when provided; omitted properties follow current insert semantics (the tree-seeding edges carry none).

10. **`listGlobalRelationships`** — `POST /test-support/relationships/global/list`
    Payload mirrors the existing `GlobalRelationshipListInput` in the relationships repository: `{ relationshipSchemaId } & ({ type: "self" } | { type: "anchored", direction: "incoming" | "outgoing", anchorEntityId })`. Success: array of `{ id, createdAt, properties, sourceEntityId, targetEntityId, relationshipSchemaId }`. Backed by the **existing** `RelationshipsRepository.listGlobalRelationships`; covers both the ranked-self-edge trending assertion (`type: "self"`) and the schema-slug edge lookup (`type: "anchored"`, filter the other endpoint test-side).

11. **`getBuiltinEntitySchema`** — `GET /test-support/entity-schemas/builtin/:slug`
    Success: `{ id, slug, name }`. Looks up `entity_schema` where `slug = :slug AND user_id IS NULL AND is_builtin = true`. 404 when missing.

12. **`setEntityPopulatedAt`** — `POST /test-support/entities/:entityId/populated-at`
    Payload: `{ populatedAt: string | null }` (null clears). Success: `ListedEntity`. Test-support service loads the entity (any scope — see repository note below) and calls the **existing** `EntitiesService.update` with unchanged `name`/`properties`/`entitySchemaId` and the new `populatedAt`.

13. **`upsertEntityTranslation`** — `PUT /test-support/entity-translations`
    Payload: `{ entityId, language, name: string | null, properties: Record<string, unknown> | null }`. Success: 200 `{ entityId, language }`. Server sets `populated_at = now()` (matches the current seed SQL). Null `name`/`properties` models a negative-cache row.

14. **`listEntityTranslations`** — `GET /test-support/entity-translations/:entityId`
    Success: array of `{ language, name, properties, populatedAt }`. Covers both the row-read and the count assertions (count derived test-side).

15. **`linkAuthAccount`** — `POST /test-support/auth-accounts`
    Payload: `{ userId, accountId, providerId }`. Success (201): `{ id }`. Calls the existing auth-service `linkAuthAccount({ id, userId, accountId, providerId })` (already used by `GodModeService`); the id is generated server-side.

16. **`createEventSchemaTrigger`** — `POST /test-support/event-schema-triggers`
    Payload: `{ eventSchemaId, sandboxScriptId, name, phase: "before_create" | "after_create", position: number, userId? }`. Success (201): `{ id }`. Server defaults: `is_active = true`, `is_builtin = false`, `metadata = {}`. No delete/list endpoints (no test needs them).

### Backend module placement and ownership

New module `apps/app-backend/src/modules/test-support/` containing:

- `routes.ts` — `HttpApiBuilder.group(AppContract, "testSupport", …)`, thin handlers calling `TestSupportService` (pattern: `god-mode/routes.ts`). Provided in `src/app/server.ts` next to `GodModeRoutesLive`.
- `service.ts` — `TestSupportService`, an Effect service that **composes** the owning services below. Its only non-trivial logic is the `deleteSandboxScript` cascade ordering. Wired in `src/app/layers.ts` like `GodModeService`.
- A short `AGENTS.md` stating the module's purpose (admin-gated endpoints whose only consumer is the e2e suite) and the rule that it composes owning services and never writes tables directly.

Changes in owning modules (**edit/extend existing methods; no parallel implementations**):

- **sandbox** (`SandboxApiService` / `SandboxRepository`, existing methods: `createScript`, `findScriptBySlugForUser`, `getScriptForUser`): add any-scope repository methods used by the endpoints — get-by-id, list (user or global), patch-fields (no recompile), promote (`isBuiltin = true, userId = null`), delete-row. The patch method's doc comment must state that it intentionally desyncs `source` from `compiledCode` for fault injection.
- **entity-schemas** (`EntitySchemasService` / repository): add link-script (`entity_schema_sandbox_script` insert, conflict-no-op), delete-links-by-script (for the cascade), and get-builtin-schema-by-slug (`user_id null, is_builtin true`). This module owns the link table's read model (`providers[].scriptId` is resolved from it).
- **entities** (`EntitiesService` / `EntitiesRepository`): `create` with `scope: "global"` and `update` (accepts `populatedAt: Date | null`) already exist — reuse them. Add: an any-scope find-by-id (existing finders are user-visibility-scoped) and delete-by-ids.
- **relationships** (`RelationshipsService` / `RelationshipsRepository`): `create` already supports `scope: "global"`; `listGlobalRelationships` already exists in the repository — expose it through the service. Add delete-relationships-touching-entities-of-script (for the cascade).
- **entity-translation** (`TranslationsService` / `TranslationsRepository`, existing: `create`/`update`/`findOverlay`): add service-level `upsert` **composing** `findOverlay` + `createOverlay`/`updateOverlay` (do not change the existing methods' semantics), and a repository `listByEntity`.
- **auth** (`AuthService`): `linkAuthAccount` already exists — call it, zero new code.
- **events** (`EventsService` / repository): add `createTrigger` (repository insert into `event_schema_trigger`; this module already owns all reads of that table).

### Test-suite migration mapping

Fixtures keep their exported names/signatures where practical so call sites stay put; only their bodies change from SQL to endpoint calls. Admin endpoints are called with header `{ "Admin-Access-Token": "test-admin-token" }` (the token provisioning already injects as `SERVER_ADMIN_ACCESS_TOKEN`). Add one shared export for this header in `tests/src/fixtures/` (it is currently duplicated across god-mode test files) and reuse it everywhere.

- `tests/src/fixtures/sandbox.ts` — `createAndPromoteSandboxScript`: read → `getSandboxScript`; promote → `promoteSandboxScript`; failure cleanup → `deleteSandboxScript`. `replaceSandboxScriptCompiledRepresentation`: read temp → `getSandboxScript`; copy → `patchSandboxScript`; delete temp → `deleteSandboxScript`.
- `tests/src/fixtures/sandbox-provider.ts` — link insert → `linkSandboxScriptToEntitySchema`; all of `cleanupBuiltinProviderScript` → single `deleteSandboxScript` call (cascade).
- `tests/src/tests/sandbox/async-flow.test.ts` — stored-representation read → `getSandboxScript`; source tamper → `patchSandboxScript`; "no row after failed compile" → `listSandboxScripts` + test-side filter.
- `tests/src/tests/sandbox/enqueue.test.ts` — metadata tamper → `patchSandboxScript`.
- `tests/src/tests/god-mode/cron-trending.test.ts` — link insert → `linkSandboxScriptToEntitySchema`; cleanup → `deleteSandboxScript`; ranked self-edge read → `listGlobalRelationships` with `type: "self"`.
- `tests/src/fixtures/media.ts` — `seedMediaEntity` (global case) and the tree entities in `seedGlobalShowEpisodeTree` → `createGlobalEntity` (with `populatedAt` for the tree); tree edges → `upsertGlobalRelationship`; `deleteGlobalEntityByProvenance` → resolve id via the existing query-engine fixture, then `deleteGlobalEntities`; `getRelationshipBySchemaSlug` → `listGlobalRelationships` with `type: "anchored"`.
- `tests/src/fixtures/query-engine.ts` — `insertGlobalRelationship` → `upsertGlobalRelationship`.
- `tests/src/fixtures/translations.ts` — `markEntityPopulated` → `setEntityPopulatedAt`; `seedEntityTranslation` → `upsertEntityTranslation`; `getEntityTranslationRow`/`countEntityTranslations` → `listEntityTranslations`.
- `tests/src/fixtures/entity-schemas.ts` — `getBuiltinEntitySchemaId` → `getBuiltinEntitySchema`.
- `tests/src/tests/media-monitoring/media-monitoring.test.ts` — `update entity set populated_at` → `setEntityPopulatedAt`; entity cleanup → `deleteGlobalEntities`. (The `cluster_messages`/`cluster_replies` polls stay SQL — see Solution.)
- `tests/src/tests/query-engine/system-fields.test.ts` — `setEntityPopulatedAt` helper → endpoint.
- `tests/src/tests/auth/god-mode-recovery.test.ts` and `god-mode-reset-user.test.ts` — `INSERT INTO "account"` → `linkAuthAccount` with a synthetic `accountId` (e.g. `oidc-sub-<timestamp>`) and `providerId: "oidc"`.
- `tests/src/tests/events/triggers-before-create.test.ts` — `INSERT INTO event_schema_trigger` → `createEventSchemaTrigger`.
- `tests/src/tests/entity-translation/*` and any other consumers of the above fixtures migrate transitively.

Explicitly **not** migrated (stays SQL, documented in `tests/src/AGENTS.md` as intentional white-box assertions): `cluster_messages`/`cluster_replies` polling, `delete-user.test.ts` tracker check, `queryUserEntityStateCounts`, `countMediaMonitoringRelationships`. Do not touch `tests/src/seed-script.ts`.

### Slices (implementation order)

Each slice is independently shippable: contract endpoints + owning-module changes + routes + fixture migration + docs, verified by `cd apps/app-backend && bun run test`, `bun turbo --filter=@ryot/app-backend check`, and `cd tests && bun test` for the affected suites.

1. **Sandbox cluster** (endpoints 1–6): biggest hack count (~15 sites). Includes the shared admin-header export.
2. **Global rows** (endpoints 7–11): entities, relationships, builtin schema lookup.
3. **Translations + populated_at** (endpoints 12–14).
4. **Auth account linking** (endpoint 15).
5. **Event schema triggers** (endpoint 16).
6. **Final cleanup pass** over every file touched, following the `codebase-cleanup` skill: remove dead fixture code, drop `getPgClient` imports that became unused, and re-check the four intentionally-kept SQL sites are documented in `tests/src/AGENTS.md`.

### Documentation updates (part of each slice)

- `tests/src/AGENTS.md`: rewrite the "Seeding Global Rows Directly" and provider-seeding sections to describe the test-support endpoints; document the four remaining raw-SQL assertions as intentional.
- `apps/app-backend/src/modules/test-support/AGENTS.md`: new, as described above.

## Testing Decisions

- **What makes a good test here**: assert external behavior (HTTP responses, cascaded state via subsequent endpoint calls), not internals. Idempotency (`deleteSandboxScript` on a missing script, double-`linkSandboxScriptToEntitySchema`) and cascade completeness (script-produced entities/relationships gone) are the behaviors worth pinning.
- **Backend unit tests** (`cd apps/app-backend && bun run test`; prior art: `entities/service.test.ts`, `god-mode/service.test.ts`, `relationships` has service-level tests): cover the new/extended owning-service methods — sandbox patch/promote/delete-row, translation `upsert` (create-vs-update branches), populated-at compose path, `createTrigger` defaults, link conflict-no-op — plus `TestSupportService` cascade ordering/idempotency. Test utilities live in `apps/app-backend/src/lib/test-utils/` (renamed from `test-support` to free the name).
- **e2e**: the migrated fixtures/tests themselves are the acceptance criteria — each slice ends with the affected e2e suites passing and `getPgClient` gone from the migrated files (except the four documented keepers).
- No new e2e suites are written for test-support; its behavior is proven by the migrated consumers.

## Out of Scope

- Building real user-facing product CRUD for sandbox scripts or event schema triggers (the test-support endpoints are named so a future product surface can replace them mechanically).
- An `unlinkSandboxScriptFromEntitySchema` endpoint, trigger delete/list endpoints, or a standalone global-relationship delete endpoint (no current consumer; YAGNI).
- Migrating the four intentional raw-SQL keeps (see Solution).
- `tests/src/seed-script.ts` (explicitly excluded by repo convention).
- Workflow-engine introspection endpoints (`cluster_messages` stays internal).
- Any enablement flag or production gating beyond `AdminMiddleware` (decided against).
- Frontend/website/browser-extension changes: none (the contract addition is type-only for other consumers).

## Further Notes

- `RelationshipsRepository.listGlobalRelationships` and the `{ scope: "global" }` variant of `RelationshipIdentityInput` already exist — slice 2 is mostly service exposure, not new persistence logic.
- `EntitiesService.create` already implements `scope: "global"` semantics; the HTTP entities route hardcodes `"user"` but that route is untouched.
- The compiled-representation copy flow (`replaceSandboxScriptCompiledRepresentation`) becomes three endpoint calls (get temp → patch target → delete temp); the orchestration stays fixture-side.
- After all slices land, `tests/src/setup.ts`'s `getPgClient` remains only for the four documented keepers.

---

## Tasks

**Overall Progress:** 0 of 6 tasks completed

**Current Task:** None

### Task List

This PRD is implemented directly in the six slices listed under "Slices (implementation order)" above (the `prd-to-issues` skill is intentionally not used). Mark progress here as slices land.

- [ ] Slice 1 — Sandbox cluster (endpoints 1–6 + shared admin-header export + fixture migrations)
- [ ] Slice 2 — Global rows (endpoints 7–11 + fixture migrations)
- [ ] Slice 3 — Translations + populated_at (endpoints 12–14 + fixture migrations)
- [ ] Slice 4 — Auth account linking (endpoint 15 + test migrations)
- [ ] Slice 5 — Event schema triggers (endpoint 16 + test migration)
- [ ] Slice 6 — Final cleanup pass per `codebase-cleanup` skill + docs sync
