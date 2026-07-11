# Plugin System Rewrite — Overview

Status: approved for implementation. Branch: `ultra-rewrite` (all work is local; there is no
CI and `apps/app-backend` is not deployed anywhere, so there are no release, rollout, or
data-migration constraints — dev databases are wipeable and the initial drizzle migration may
be regenerated freely).

Read this completely before opening any phase file. The phase files are:

| File                                       | Scope                                                                             |
| ------------------------------------------ | --------------------------------------------------------------------------------- |
| `01-phase-1-schema-registry.md`            | Schema definitions move from DB rows to an in-memory registry                     |
| `02-phase-2-plugin-contract-and-loader.md` | Plugin manifest, ingestion, loader, hot-load; builtins become two plugin packages |
| `03-phase-3-capability-migrations.md`      | Native domain modules move into the plugins, one capability at a time             |
| `04-phase-4-hardening-and-purity.md`       | Purity enforcement, performance, limits, test-tree reorganization                 |

Phases are strictly ordered. Do not begin a phase before the previous phase's done criteria
are all met. Within Phase 3, the numbered steps are also strictly ordered.

## How to read the markers in these documents

- **[DECIDED]** — settled with the project owner. Do not relitigate; if implementation
  uncovers evidence that a DECIDED item is wrong, stop and surface it rather than silently
  deviating.
- **[RECOMMENDED]** — a default with rationale. Follow it unless you find concrete evidence
  it is wrong; if you deviate, record what you did and why by editing the relevant plan file
  (these documents are living documents during implementation).
- **[IMPLEMENTER-DECIDES]** — genuinely open; use judgment and record the choice in the plan
  file.

## The vision in one paragraph

Ryot's rewritten backend (`apps/app-backend`) becomes a domain-agnostic **kernel**: generic
entity/event/relationship storage with schema-validated `jsonb` properties, a query engine, a
durable workflow engine, a scheduler, notifications, an integrations framework, auth, uploads,
and a Deno sandbox runtime. Everything media- and fitness-specific becomes two **plugins** —
source-code bundles of declarative schema definitions plus sandboxed scripts — ingested through
one loader. The sandbox host functions are the syscall surface between kernel and plugins.
First-party plugins are "trusted" only in the sense that the owner writes them; the kernel
does not know or care, and the same loader supports runtime (hot) installation, which is how
user-authored plugins will arrive later.

## Decision record

These were settled in design discussion with the project owner. All are **[DECIDED]**.

1. **No-code custom schemas are removed.** The current ability for users to create entity
   schemas / trackers at runtime through the API is superseded by the plugin system and is
   deleted, not preserved. v1's goal is to dogfood media and fitness as plugins; user-authored
   plugins come later.
2. **Kernel purity.** Core backend code must contain no media/fitness-specific strings,
   branches, or imports. Litmus test: if the kernel has to interpret a manifest field in a way
   only one plugin uses, the design is wrong — either generalize the capability or move the
   logic into the plugin. (The frontend is exempt: first-party UI features may key off
   well-known schema slugs; the client is not the kernel.)
3. **Sandbox-only plugin runtime.** All plugin behavior executes as sandboxed Deno scripts.
   There is no native-code plugin tier. First-party plugins differ from future third-party
   ones only in _when_ they are ingested (boot vs. runtime install).
4. **Definitions in code, state in the database.** Schema definitions (entity, event,
   relationship, signal), default saved views, provider links, and automation bindings live
   in plugin source and load into an in-memory registry. User data (entities, events,
   relationships, per-user workspace/view state, integration config, workflow state) stays
   in Postgres. Every `isBuiltin` flag in the current schema is a symptom of
   conflating these two and is removed.
5. **Schemas are identified by slug, not row id.** Entity/event/relationship/signal rows
   reference their schema by slug string with no foreign key. Referential integrity for
   definitions moves to application code. (The query engine already identifies schemas by slug
   — see `libs/query-engine/src/recipes/app.ts` — so this is less disruptive than it sounds.)
6. **`AppSchema` stays the property-schema format.** Plugin schemas are declarative
   `AppSchema` literals (`@ryot/contract/schema/property-schema`), validated by the existing
   property-schema runtime (`apps/app-backend/src/lib/property-schema/`). Do not replace it
   with opaque Effect Schema validators: the query engine and the schema-driven frontend need
   introspectable property metadata.
7. **Durable workflows: replay-deterministic sandbox scripts.** The durable engine stays in
   the kernel. Plugins express multi-step durable operations as workflow scripts that
   re-execute from the top on each resume; host functions `activity()`, `sleep()`, and
   `child()` return recorded results (Temporal-style). Each execution is pinned to the exact
   compiled-module version it started with.
8. **Syscall design rules.** (a) Batch-first: every host function and script entry point
   takes arrays; per-item designs are forbidden. (b) Query pushdown: filters, sorts, and
   aggregations plugins need are expressed as query-engine documents executed by the kernel,
   never as fetch-all-then-filter loops. (c) Coarse atomic writes: multi-write invariants are
   single host calls (e.g., create entity with relationships in one call); the existing rule
   that no transaction spans a sandbox execution stays. (d) A host function must never be
   explicable only by one plugin's needs.
9. **Plugin API surface = one generic invoke endpoint.** Plugins declare named operations
   (input/output schemas) in the manifest; a single contract endpoint dispatches to them. The
   static typed contract (`libs/contract`) never grows plugin-specific endpoints. First-party
   clients import operation types directly from the plugin packages ("recipes"); third-party
   plugins later get runtime-validated dynamic invocation.
10. **File access via Deno permission grants, not IPC.** Large artifacts (import files) are
    materialized to disk by the kernel and the script's subprocess is spawned with scoped
    `--allow-read` on the input path and read-write on a per-execution quota'd scratch
    directory. CPU-bound work (zip parsing) happens inside the sandbox via approved
    dependencies, not as host functions. This extends the existing pattern
    (`--allow-net=127.0.0.1:<bridgePort>` in
    `apps/app-backend/src/lib/infrastructure/sandbox-runtime/runtime.ts`).
11. **The sandbox authoring, schema, and typed bridge APIs are Effect-only.** Effect is available
    inside the sandbox as a runtime-provided (vendored) approved dependency with a single pinned
    version matching the host — never bundled per script. Effect Schema defines sandbox manifests,
    driver input/output, host-function wire contracts, and operation input/output; the declarative
    `AppSchema` property format in Decision 6 is the explicit exception because the query engine and
    schema-driven frontend require introspectable property metadata. Script drivers return `Effect`
    values, every script-facing host function returns an `Effect` with a typed error, and backend
    host-function implementations plus typed bridge dispatch use Effect directly. There is no
    parallel Zod schema surface, raw Promise authoring API, or raw Promise host-function API.
    Promise-based platform operations such as `fetch` remain private implementation details wrapped
    at the transport boundary. Workflow scripts get a restricted SDK entry point that does not
    expose nondeterminism footguns (ambient Clock/Random).
12. **Source-canonical ingestion.** Plugins ship as source. The server compiles at ingestion
    using the existing compiler (`libs/sandbox-compiler`, `Bun.build`-based, already used at
    runtime by `apps/app-backend/src/modules/sandbox/compiler.ts`), stores content-addressed
    compiled modules, and records the source-hash → compiled-hash mapping. Compilation is part
    of _ingestion_, not loading: first-party plugins are ingested at boot from in-repo sources
    (with build-time precompilation acting purely as a cache keyed by content hash); uploaded
    plugins are ingested at install. One loader consumes one normalized form either way. Never
    compile per-execution or per-boot-without-cache: compiled bytes are identity (workflow
    pinning depends on this).
13. **Hot-load semantics.** Installing/updating a plugin atomically swaps the affected
    registry entries; a load-time schema diff enforces additive-only evolution (breaking
    changes are rejected); registry changes propagate to other instances via Redis pub/sub;
    in-flight workflow executions keep their pinned module versions across a swap.
14. **Integration provider adapters move into plugins.** Yank/sink/push adapters (Plex,
    Komga, Jellyfin, Radarr, Sonarr, etc.) and import source adapters are media-domain and move
    into the media plugin. The kernel keeps the integrations _framework_: credential storage,
    lifecycle, run tracking, auto-disable.
15. **Automations become manifest bindings.** `automation_rule` holds two distinct row
    kinds today. (a) Global builtin lifecycle bindings (`userId IS NULL`, seeded by
    `apps/app-backend/src/modules/builtins/seed.ts` from `registry.ts`) — these move to the
    plugin manifest and dispatch from the in-memory registry. (b) **Per-user notification
    subscriptions** — the `automations` contract group is a user-facing rule surface
    (`installRule`/`activateRule`/`deactivateRule`/`deleteRule`/`listRules`) backed by
    `NotificationSubscriptionsService`
    (`apps/app-backend/src/modules/automations/notification-subscriptions-service.ts`),
    which writes per-user `automation_rule` rows (signal-target subscriptions), including
    `ensureDefaultRules` called from `user-bootstrap/bootstrap.ts`. Kind (b) is per-user
    _state_ under Decision 4 and moves to a dedicated per-user subscription-state table in
    Phase 2; only then is `automation_rule` deleted. Execution bookkeeping
    (`subscription_run`) stays in the DB.
16. **The e2e suite (`tests/`) is the behavioral spec.** Suites migrate in lockstep with each
    capability: plumbing changes, assertions preserved. "Suite green" is the per-phase and
    per-step done criterion. No big-bang test rewrite.
17. **Consumers.** `apps/app-client` uses none of the removed surfaces (verified: zero
    references to the `entitySchemas`/`trackers`/`eventSchemas`/`relationshipSchemas` contract
    groups or to `entitySchemaId`/`trackerId`). `apps/app-client-backup` is slated for removal
    — ignore it entirely. The browser extension depends on metadata-lookup endpoints and
    migrates together with Phase 3 step 2. `apps/backend` and `apps/frontend` are the legacy
    system — not touched by this plan.
18. **Slug namespacing** [RECOMMENDED]: builtin plugin slugs stay bare (`movie`, `workout`,
    `progress`) exactly as today, minimizing churn in query recipes, fixtures, and the
    frontend. The loader rejects slug collisions at ingestion. The `/` character is forbidden
    in slugs now and reserved as a namespace separator, so future third-party namespacing
    (`acme/movie`) is purely additive.
19. **There is no per-user standalone sandbox-script feature.** All extension — first-party
    and user-authored alike — arrives as plugins. The codebase still carries the old
    mechanism, a strictly weaker duplicate of plugins (an individual user authors a single
    script through the `sandbox` contract group, compiled server-side, stored in
    `sandbox_script` with their `userId`, usable as a private provider) — Phase 2 §8 deletes
    it. Accepted trade-off: on a multi-user instance, a non-admin user cannot self-serve a
    private provider; that capability returns with the user-authored-plugins milestone.
    Execution machinery, per-executing-user cache isolation, and `entity.sandboxScriptId`
    provenance all survive — only the user-facing authoring surface and per-user script
    ownership go. Persisted scripts are owned either by an installed plugin (`pluginSlug` set)
    or by kernel definition source zero (`pluginSlug` null); the latter is restricted to
    content-addressed, kernel-generic scripts and is not a synthetic plugin.
20. **There is no tracker concept — a plugin _is_ the user-facing workspace.** Plugin
    `metadata` carries the display fields (name, icon, accent color, description); per-user
    workspace state (visibility, sort order, config) keys on the plugin slug; saved views
    group by plugin slug (nullable — ungrouped views exist). One plugin = one workspace: a
    domain wanting two workspaces ships as two plugins. The codebase still carries a tracker
    layer (registry tracker definitions fed from `builtins/trackers.ts`, `tracker_state`,
    `savedView.trackerSlug`, a `trackers` contract surface, and a manifest `trackers` section
    in `libs/plugin-kit`) — Phase 2 §9 deletes it.

## Current-state map (verified facts, with pointers)

The implementing agent should trust these as of plan-writing time but re-verify anything that
looks stale.

### Storage (`apps/app-backend/src/lib/infrastructure/db/schema/tables/`)

- `core.ts` — `tracker` (per-user, `isBuiltin`, builtins materialized per user),
  `entity_schema` (global builtin + user rows, `propertiesSchema` jsonb `AppSchema`),
  `tracker_entity_schema` (join), `sandbox_script` (`source` + `compiledCode` +
  `compiledFormat` + `metadata`, builtin + user rows), `entity_schema_sandbox_script` (join).
- `entities.ts` — `entity` (generic: `properties` jsonb, `entitySchemaId` FK,
  `sandboxScriptId` provenance FK, `externalId`, global-vs-user uniqueness indexes),
  `relationship_schema` (source/target entity-schema FKs), `relationship`.
- `events.ts` — `event_schema` (per-entity-schema: `entitySchemaId` FK + `slug` unique within
  it), `event` (`eventSchemaId` FK, `entityId`, `sessionEntityId`, `occurredAt`).
- `automations.ts` — `signal_schema`, `signal`, `signal_recipient`, `automation_rule` (FKs to
  all four schema tables + `sandbox_script`; kind policy/subscription; operation
  create/update/delete/signal; exactly-one-target check), `subscription_run` (bookkeeping; no
  schema FKs; `ruleId` on-delete set-null).
- `views.ts` — `saved_view` (per-user, `isBuiltin`, `trackerId` FK, `queryDocument` jsonb —
  already slug-based), plus `imports.ts`, `auth.ts`, `notifications.ts`, `translations.ts`
  (not directly affected by Phase 1 except where noted in the phase file).
- There are **no media- or fitness-specific tables**. One drizzle migration exists
  (`src/drizzle/0000_*.sql`) and may be regenerated.

### Definitions today (`apps/app-backend/src/modules/builtins/`)

- `entity-schemas.ts` (~30 entity schemas incl. media types, `exercise`, `workout`,
  `measurement`, each with nested lifecycle event schemas), `media-property-schemas.ts`,
  `fitness-property-schemas.ts`, `relationship-schemas.ts`, `signal-schemas.ts`,
  `collection-entity-schema.ts`, `saved-views.ts`, `media-schema-slugs.ts`.
- `registry.ts` — hand-written binding lists: builtin sandbox scripts, schema↔script links,
  entity/relationship/event automation rule links. This file is the ad hoc prototype of the
  plugin manifest.
- `seed.ts` — `SeedService`, runs after migrations (`app/layers.ts`), upserts everything
  above into the DB (`ON CONFLICT DO UPDATE`, `isBuiltin=true`).
- `sandbox-scripts/{providers,automations,script-helpers}/` — ~52 provider scripts + 11
  automation scripts as single-file `.sandbox.ts` modules, compiled at build time into
  `generated-sandbox/registry`.
- Media lifecycle semantics (state derivation, auto-complete, integration progress policy)
  are documented in `apps/app-backend/src/modules/builtins/AGENTS.md` — these semantics are
  **preserved behavior**, pinned by the e2e suite.

### Sandbox runtime (`apps/app-backend/src/lib/infrastructure/sandbox-runtime/`)

- Single-use Deno subprocesses from a pre-warmed pool (`ProcessPool`, `runtime.ts`); flags:
  `--deny-run/env/ffi/write`, `--allow-read=<runner>,<runtime-dir>`,
  `--allow-net=127.0.0.1:<bridgePort>`, `--no-npm --no-remote --cached-only`, import map for
  approved deps.
- Host calls are **loopback HTTP**, not stdio: each call is an independent `fetch` POST to
  `/rpc/<executionId>/<fnName>` (`runner-source.sandbox.ts`), served by a per-process Bun
  HTTP server (`BridgeService`) with per-request Effect execution and no per-execution lock.
  **Concurrent host calls already work**; budgets are enforced on both sides and are
  concurrency-safe. Scripts import their compiled module via `data:` URL.
- 16 host functions today (`bridge-adapter.ts`): `httpCall`, `getCachedValue`,
  `setCachedValue`, `claimCachedValue`, `getAppConfigValue`, `getUserPreferences`,
  `getEntity`, `getEntitySchema`, `getIntegration`, `listEventSchemas`, `listEvents`,
  `listIntegrations`, `createEvents`, `executeQueryEngine`, `emitSignal`, `sendNotification`.
- Compiler: `libs/sandbox-compiler` (Bun.build bundling in `compiler-bundle.ts`, TS
  diagnostics, worker protocol); already invoked at runtime for user scripts via
  `apps/app-backend/src/modules/sandbox/compiler.ts`. SDK: `libs/sandbox-sdk` (Effect and Effect
  Schema plus approved runtime dependencies cheerio, and youtubei; provider/automation
  contracts).

### Native domain modules (the code that must end up inside plugins)

`media-trending`, `media-monitoring`, `episode-resolver`, `metadata-lookup`, `exercises`
(under `apps/app-backend/src/modules/`), plus the media import population/resolution
workflows (`imports/media/*`) and the integration sink/yank adapters
(`integrations/sinks/*` and import source adapters). Known dependency-gradient violations to
be dissolved: `entity-schemas/service.ts` imports `TrackersRepository`/`TrackersService`;
`auth/service.ts` imports `TrackersService` (bootstrap provisioning).

### Contract (`libs/contract/src/modules/`)

Groups: automations, collections, entities, entity-import, entity-interest, entity-schemas,
event-schemas, events, god-mode, imports, integrations, library-membership, media-monitoring,
metadata-lookup, notifications, query-engine, relationship-schemas, relationships, sandbox,
saved-views, system, test-support, trackers, uploads, user-preferences, user-state.

### E2e suite (`tests/`)

77 test files across ~29 suites; one shared backend per run (`global-setup.ts`), files run
sequentially; Effect-native fixtures. Key coupling points: 15 files use schema-id fixtures
(`getBuiltinEntitySchemaId`, `linkToEntitySchemaId`, `promoteSandboxScript`); 11 files call
`entitySchemas.`/`trackers.` contract groups; the 21-file `query-engine` suite is already
slug-based. The hermetic provider fixture (`fixtures/sandbox-provider.ts`:
`seedBuiltinProviderScript` compiles a fake provider through the API then god-modes it via
`testSupport.promoteSandboxScript`) is an ad hoc plugin installer and is replaced by the real
loader in Phase 2. Conventions live in `tests/AGENTS.md`.

## Target architecture (end state)

```txt
libs/plugin-kit            manifest types, definePlugin builder, shared plugin authoring API
libs/sandbox-sdk           script-facing SDK (+ Effect vendored, workflow entry point)
libs/sandbox-compiler      bundling (extended for multi-file plugin packages)
plugins/media              source bundle: manifest + schemas + scripts (providers, automations,
                           workflows, crons, operations, integration adapters)
plugins/fitness            source bundle: manifest + schemas + scripts (exercise provider,
                           preload boot driver, workout automation)
apps/app-backend           the kernel:
  definition registry      in-memory, slug-keyed; sources: kernel-owned definitions + loaded
                           plugins; atomic snapshot swap; Redis invalidation
  plugin ingestion/loader  validate → compile → content-address → persist → load
  sandbox runtime          unchanged core + workflow primitives + fs grants + invoke dispatch
  durable engine           kernel-owned; sandbox workflow scripts as bodies
  generic modules only     entities, events, relationships, collections, query-engine,
                           notifications, integrations framework, imports framework, auth,
                           uploads, user-state, entity-interest, entity-translation, scheduler
```

Kernel-owned definitions: a small set of generic definitions the kernel itself contributes
through the same registry mechanism (e.g., the `collection` entity schema, generic signal
schemas like `integration.disabled`, and that signal's notification formatter). The
kernel is "definition source zero," not a plugin — its definitions need no sandbox scripts
unless generic (the `integration.disabled` notification formatter stays a sandbox script,
kernel-owned). Notification formatting for plugin-owned signals lives in the plugin that owns
the signal.

## Cross-phase invariants

1. **The branch stays shippable.** After every phase (and every Phase 3 step):
   `bun turbo --filter=@ryot/app-backend check` passes, `cd apps/app-backend && bun run test`
   passes, `cd tests && bun run test` passes (minus suites explicitly deleted with their
   surface).
2. **Assertions are preserved.** When migrating an e2e suite, change plumbing (fixtures,
   endpoints, ids→slugs) but keep what is asserted. A behavioral change requires explicit
   owner sign-off, not a quiet test edit.
3. **Syscalls are pulled, not pushed.** No host function, manifest field, or kernel
   capability is built before the Phase 3 step that consumes it.
4. **One capability in flight at a time.** Finish (native module deleted, suite green) before
   starting the next.
5. **YAGNI.** No plugin-dependency resolution, no plugin marketplace/signing, no public
   install endpoint, no speculative manifest fields. All are explicit non-goals for this plan.
6. **Existing module conventions hold** (`apps/app-backend/AGENTS.md`): Effect service
   classes, thin routes, repository-owned writes, durable ownership rules, no transaction
   across sandbox execution, contract lives in `libs/contract`.
7. **Documentation follows the code.** Each phase updates the affected `AGENTS.md`/
   `AGENTS.md`/`README.md` files (single-owner rule: facts move, they don't duplicate).

## Sequencing rationale (why this order)

Phase 1 first because it is the most invasive storage/contract change and every module built
meanwhile on the schema tables raises its cost; it is deliberately decoupled from the plugin
format (registry fed directly from `builtins` code) so it has exactly one moving part. Phase 2
gives migrated code a home before any migration starts. Phase 3 orders migrations so each
forces a small reusable syscall slice: crons → invoke → workflows → fs grants → composition.
The workflow engine (step 3) is the highest-uncertainty item and gets a mandatory spike.
Phase 4 hardens what exists; nothing in it blocks correctness earlier.
