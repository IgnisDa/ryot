# Phase 1 — Schema definitions move to an in-memory registry

Status: complete. This file remains as the implementation record; current work resumes at Phase 4
(see `00-overview.md`).

Goal: schema **definitions** (entity, event, relationship, signal, tracker, builtin saved
views) stop living in Postgres and are served from an in-memory, slug-keyed registry fed
directly from the existing `builtins` module code. Data rows reference schemas by slug with no
FK. All machinery that existed only to store definitions in the DB is deleted.

Explicitly **not** in this phase: any plugin manifest, loader, or package restructuring
(Phase 2). Sandbox scripts and automation-rule rows continue to be DB-seeded in this phase —
only their schema _references_ change from FK ids to slugs. The five native domain modules
keep working, re-pointed at the registry.

## 1. Build the registry

New kernel service (suggested location: `apps/app-backend/src/modules/definition-registry/`,
generic end of the module gradient; **[IMPLEMENTER-DECIDES]** exact name/location).

**[IMPLEMENTER-DECIDES — resolved]** The service is named `DefinitionRegistry` and lives at the
suggested `apps/app-backend/src/modules/definition-registry/` location. Keeping the generic name and
location makes its ownership clear and avoids coupling the Phase 2 loader to the temporary builtin
source that feeds it during Phase 1.

Registry content, all keyed by slug:

- **Entity schema**: slug, name, icon, accentColor, `propertiesSchema: AppSchema`, and its
  **event schemas** (each: slug, name, `propertiesSchema`) — event schema slugs are scoped to
  their entity schema, mirroring today's `event_schema` uniqueness
  (`entitySchemaId + slug`).
- **Relationship schema**: slug, name, `propertiesSchema`, sourceEntitySchemaSlug,
  targetEntitySchemaSlug (nullable, mirroring today's nullable FKs).
- **Signal schema**: slug, name, catalogState, `propertiesSchema`, audiencePolicy.
- **Tracker definition**: slug, name, icon, accentColor, description, ordered entity-schema
  slugs (replaces `tracker` + `tracker_entity_schema` builtin rows).
- **Builtin saved views**: slug, name, icon, accentColor, sortOrder, trackerSlug,
  queryDocument, displayConfiguration (replaces per-user materialized `isBuiltin` rows).

Feed it from the existing definition sources in `modules/builtins/` (`entity-schemas.ts`,
`relationship-schemas.ts`, `signal-schemas.ts`, `collection-entity-schema.ts`,
`saved-views.ts`, plus tracker definitions extracted from wherever `user-bootstrap` currently
gets them). Do **not** reshape those files beyond what the registry needs — they get
restructured into plugin packages in Phase 2.

Implementation notes:

- Registry lookups are synchronous reads from an immutable snapshot behind a single volatile
  reference (Phase 2 swaps this snapshot atomically; build it that way now).
- Validation helpers colocated with the registry: `validateEntityProperties(slug, props)`
  etc., delegating to the existing property-schema runtime
  (`src/lib/property-schema/property-schema-runtime.ts`).
- Loading fails fast at startup on duplicate slugs, `/` in slugs, dangling
  tracker→schema / view→tracker / relationship→entity-schema references.

## 2. Storage changes (regenerate the initial migration)

Drop tables: `entity_schema`, `event_schema`, `relationship_schema`, `signal_schema`,
`tracker_entity_schema`.

Column conversions (FK id → slug text, keep equivalent indexes):

| Table                          | Today                       | After                                                                                                      |
| ------------------------------ | --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `entity`                       | `entitySchemaId` FK         | `entitySchemaSlug` text NOT NULL                                                                           |
| `event`                        | `eventSchemaId` FK          | `eventSchemaSlug` text NOT NULL (local slug, e.g. `progress`)                                              |
| `relationship`                 | `relationshipSchemaId` FK   | `relationshipSchemaSlug` text NOT NULL                                                                     |
| `signal`                       | `signalSchemaId` FK         | `signalSchemaSlug` text NOT NULL                                                                           |
| `automation_rule`              | four schema FKs             | four `…Slug` text columns (table itself dies in Phase 2; keep the exactly-one-target and operation checks) |
| `entity_schema_sandbox_script` | `entitySchemaId` FK         | `entitySchemaSlug` text (table dies in Phase 2)                                                            |
| `saved_view`                   | `trackerId` FK, `isBuiltin` | `trackerSlug` text nullable; drop `isBuiltin` (see §4)                                                     |
| `tracker`                      | full definition per user    | replaced — see §4                                                                                          |

**[RECOMMENDED]** `event` keeps only the local event slug: the owning entity schema is
reachable through `entityId → entity.entitySchemaSlug`, and today's hot index
`(userId, entityId, eventSchemaId)` becomes `(userId, entityId, eventSchemaSlug)`. If the
query engine's SQL pushdown for "events of schema X across entities" turns out to need it,
denormalize an `entitySchemaSlug` column onto `event` — decide from the actual query plans,
and record the outcome here.

**[RECOMMENDED — followed]** `event` stores only `eventSchemaSlug`. Query execution already
joins events to their owning entity for entity-schema filtering, so `entity.entitySchemaSlug`
provides the required pushdown without denormalizing a second schema slug onto each event.

Uniqueness semantics to preserve exactly (they encode product behavior):

- `entity` global-vs-user uniqueness triplets (`entities.ts` indexes, including the
  NULLS-NOT-DISTINCT workaround pair) — swap `entitySchemaId` for `entitySchemaSlug`.
- `event_schema`'s per-entity-schema slug uniqueness moves into registry load validation.

Since nothing is deployed: update the drizzle schema files and **regenerate**
`src/drizzle/0000_*.sql` + `meta/` snapshot rather than authoring ALTERs. Dev databases are
recreated.

## 3. Convert every consumer

Find them mechanically: grep app-backend `src/` for `entitySchema`, `eventSchema`,
`relationshipSchema`, `signalSchema`, `trackerEntitySchema` table imports and for the
`…SchemaId` column names. Known consumers (verify, list is close to exhaustive):

- **Write paths** (`entities`, `events`, `relationships`, `signals` in `automations`):
  validate properties via registry instead of joining schema tables; store slugs.
- **Query engine** (`modules/query-engine`): resolves schema slugs → today's row ids
  somewhere near the storage layer; now slugs are stored directly, so resolution disappears.
  Preserve read semantics (`modules/query-engine/README.md` is the spec; the 21-file e2e
  suite pins it).
- **Sandbox host functions** (`sandbox-runtime/host-functions.ts`,
  `bridge-adapter.ts` implementations): `getEntitySchema` and `listEventSchemas` re-read from
  the registry. Keep the sandbox-facing response shapes identical if possible (provider
  scripts consume them); if a shape must change, update `libs/sandbox-sdk` contracts and the
  builtin scripts in the same commit.
- **`entity-schemas`, `event-schemas`, `relationship-schemas`, `trackers` modules**: CRUD
  services/routes deleted (see §5). Anything generic they own that survives (e.g. the tracker
  restriction logic in `entity-schemas/service.ts` — dies with user schemas) is deleted with
  them. This dissolves the known gradient violations (`entity-schemas/service.ts` and
  `auth/service.ts` importing Trackers services).
- **`user-bootstrap`**: stops materializing builtin trackers and saved views per user
  entirely; per-user rows are created lazily only as _state overrides_ (§4). Note:
  `ensureDefaultRules` (per-user notification subscriptions,
  `automations/notification-subscriptions-service.ts`) is **not** removed — it remains a
  per-user bootstrap step in this phase (its storage moves in Phase 2 §5; here only its
  schema FK references become slugs).
- **`legacy-bootstrap`**: exempt from write-path rules but not from storage reality — convert
  its schema-table reads/writes to registry lookups + slug columns. This is the adoption path
  from the legacy deployed system. Generated-SQL regression coverage prevents references to
  dropped definition tables; full behavior remains dump-restore validation because the normal
  e2e harness provisions a fresh V2 database.
- **`builtins/seed.ts`**: schema/tracker/saved-view seeding deleted; script seeding and
  automation-rule seeding remain (slug-keyed) until Phase 2.
- **Relations** (`tables/relations.ts`): rewrite for removed tables/FKs.

## 4. Trackers and saved views: definition vs. per-user state

Tracker **definitions** come from the registry. What remains per-user is state:

**[RECOMMENDED]** replace `tracker` with a thin `tracker_state` table:
`(userId, trackerSlug, isDisabled, sortOrder, config jsonb, timestamps)`, unique on
`(userId, trackerSlug)`, rows created lazily on first deviation from defaults. Read model =
registry definitions overlaid with state rows. The `trackers` contract group shrinks to
list (merged view) + update-state endpoints; create/delete/definition-editing endpoints are
removed.

Builtin saved views: served from the registry, merged at read time with the user's own
`saved_view` rows; per-user disable/sort of a builtin view goes in a small
`saved_view_state` table (same lazy-row pattern) **[RECOMMENDED]**; user-created views keep
the `saved_view` table (now with `trackerSlug`). `saved-views` module's read path does the
merge; its default-view workflow (`entity-schemas/default-saved-view-workflow*.ts`) dies with
user-created schemas.

## 5. Contract deletions (`libs/contract`)

- Delete groups: `entity-schemas`, `event-schemas`, `relationship-schemas` (user CRUD — all
  of it, since user-created schemas are removed).
- Shrink `trackers` to the state surface described in §4.
- Add one small read-only group **[RECOMMENDED]** (e.g. `definitions`): list entity schemas
  (with event schemas), relationship schemas, trackers — the client will need this for
  schema-driven UI even though `app-client` doesn't call the old groups today. Response
  shapes: reuse the existing schema DTOs minus ids/isBuiltin, keyed by slug.
- `test-support`: `getBuiltinEntitySchema` and anything else returning schema row ids either
  switches to slugs or is deleted where the need disappears.
- Sweep `@ryot/contract` types for `entitySchemaId` etc. in DTOs (entities/events/
  relationships responses expose schema references — make them slugs).

`app-client` compiles unaffected (verified zero usage); still run its check as part of the
phase gate.

## 6. E2e suite migration

- Delete: the former tracker CRUD suites (5 files), user-created-schema tests in
  `tests/src/tests/kernel/entity-schemas/`, `tests/src/tests/kernel/event-schemas/`, and
  `tests/src/tests/kernel/relationships/` (keep provider search/import tests in
  `tests/src/tests/kernel/entity-schemas/` — they test surviving behavior; move or
  rename the file if its name becomes misleading).
- Re-plumb (assertions preserved): the 15 files using `getBuiltinEntitySchemaId`/
  `linkToEntitySchemaId` fixtures switch to slugs; `fixtures/entity-schemas.ts`,
  `fixtures/trackers.ts` rewritten or folded; `seed-script.ts` only if it touches removed
  surfaces (the tests `AGENTS.md` says don't refactor it otherwise).
- `tests/AGENTS.md` updated where conventions changed.

**[IMPLEMENTER-DECIDES — resolved]** The existing e2e behavioral coverage creates temporary
entity, event, relationship, and tracker definitions, including throughout the query-engine
suite whose assertions must remain unchanged. Phase 1 therefore exposes an admin-gated
`testSupport` operation that adds test-authored definitions to the in-memory registry snapshot.
The seam does not persist definitions, compile source, load manifests, publish invalidations, or
exist on a user-facing contract group. This preserves the behavioral specification without
restoring no-code custom schemas or pulling the Phase 2 plugin loader forward.
Because the e2e suite shares one backend and this temporary registry seam, test files remain
explicitly sequential (`fileParallelism: false`); test definitions use collision-free slugs and
may accumulate for the duration of one run without replacing builtin definitions.

The three assertions that specifically required user-owned schema definitions were updated with
owner approval: code-owned definitions are globally visible, while entity and relationship rows
remain user-scoped. Cross-user queries therefore return empty results rather than a missing-schema
error, and callers may use an installed relationship definition with their own visible entities.

## Done criteria

Completion note (2026-07-26): the registry and slug-backed storage cutover are complete. The later
Phase 2 cleanup also removed the temporary tracker and automation-rule exceptions described below.

1. Grep proof: no app-backend source references the dropped tables or `…SchemaId` columns
   (except drizzle history if any is deliberately kept).
2. All three checks pass: backend `check` + unit tests, e2e suite (minus deleted files),
   `app-client` check.
3. Registry startup validation fails fast on a deliberately broken definition (unit test).
4. Behavior spot-checks stay green in e2e: media lifecycle (progress → auto-complete),
   provider search/import, query-engine suite untouched and green. Legacy-bootstrap generated-SQL
   regression coverage is green, and both documented legacy dumps pass manual restore/migration
   validation before release.
5. No `isBuiltin` column remains on any _surviving_ table except `sandbox_script` and
   `automation_rule` (both die in Phase 2; `signal_schema`'s flag disappears with its table
   in this phase).
