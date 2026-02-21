# Plugin System Rewrite — Overview

Status: in progress. Phases 1 and 2, Phase 3 steps 0-4, and the Step 5 migration and purity
triage are complete. Resume with Task 11's operational and deferred gate closure; do not repeat
the Step 5 implementation. The opt-in operational gate timed out at two concurrent 1,001-item
imports, and the owner-skipped Task 10 imports e2e failure also remains open.
Neither Task 11 nor the Phase 3 gate is complete.
Branch: `ultra-rewrite` (all work is local; there is no
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

The sandbox single-entrypoint rewrite in `../sandbox-single-entrypoint.md` is complete and is the
runtime baseline for all remaining work. Any older text in this plan set that refers to driver
maps, runtime entrypoint selectors, or script-backed provider identity is superseded by that
baseline and should be corrected rather than implemented.

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
   compiled-module version it started with. A host call cannot _suspend_ an execution — the
   pending case ends the replay and the kernel shell performs the work — and the journal is
   read through host calls rather than shipped in the script's context; the spike findings in
   `03-phase-3-capability-migrations.md` §3 own that mechanism.
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
    `apps/app-backend/src/lib/infrastructure/sandbox-runtime/runtime.ts`). The scratch directory
    is also the **return path for output too large for `execution.resultBytes`**: the script
    writes chunk files and returns a small manifest, and the kernel harvests those files at
    execution end before cleaning up. The reader is always the kernel, never a second sandbox
    execution, so the grant stays per-execution. The quota is 5 MiB, enforced after the execution
    because Deno offers no preventive filesystem quota.
11. **The sandbox authoring, schema, and typed bridge APIs are Effect-only.** Effect is available
    inside the sandbox as a runtime-provided (vendored) approved dependency with a single pinned
    version matching the host — never bundled per script. Effect Schema defines sandbox manifests,
    script input/output, host-function wire contracts, and operation input/output; the declarative
    `AppSchema` property format in Decision 6 is the explicit exception because the query engine and
    schema-driven frontend require introspectable property metadata. Script entrypoints return `Effect`
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
    Komga, Jellyfin, Radarr, Sonarr, etc.) and import source adapters move into the plugin that
    owns their domain: the sixteen media sources into `plugins/media`, and the three fitness
    sources (`hevy`, `strong-app`, `open-scale`) into `plugins/fitness`. Both integration
    providers and import sources are declared in manifest sections
    (`integrationProviders`, `importSources`) and served generically from the registry, so the
    kernel's media-vs-non-media import branch collapses into one registry-driven dispatch path.
    The kernel keeps the integrations _framework_ (credential storage, lifecycle, run tracking,
    auto-disable, webhook endpoint) and the imports _framework_ (run rows, failure rows, artifact
    materialization and cleanup, source listing, workflow dispatch, and **all entity/event/
    relationship writes**). Plugins parse and orchestrate; they never write import results to the
    database. Phase 3 step 4 owns this migration in full — see
    `03-phase-3-capability-migrations.md` §4.
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
    Execution machinery and per-executing-user cache isolation survive. The later
    single-entrypoint rewrite replaces `entity.sandboxScriptId` provenance with logical
    `entity.providerId` — only the user-facing authoring surface and per-user script
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
21. **Logical providers and executable scripts are separate identities.** A provider is a stable,
    plugin-owned catalog identity persisted in `sandbox_provider`; each search, details, resolve,
    or translate operation maps to its own direct script. Provider-backed entities store
    `providerId`, schema bindings target `providerSlug`, and provider identity survives script
    recompilation and plugin reingestion.
22. **Every sandbox module has one direct entrypoint.** Scripts declare `input`, `output`, and
    `run`; the backend resolves the exact script before enqueueing it. Runtime and durable payloads
    carry `scriptId` and never an operation selector. Manifest capability sections reference
    `scriptSlug`, while standard providers map operations under `providers[].operations`.
23. **Execution authority is trusted backend state.** Sandbox executions carry a strict `user`,
    `system`, or `subscription` authority. Public operation invocation supports `user` and
    `integration` authentication only; the proposed `admin` operation mode was deliberately
    removed. Scheduler boot/cron paths create system authority, subscriptions create subscription
    authority, and public callers cannot select either.
24. **Cache identity follows logical ownership.** Provider-associated scripts share a
    provider-scoped cache partition; standalone scripts use their script ID. Both remain isolated
    by executing user where applicable. Scripts never choose their own cache namespace.

## Current implementation baseline

These facts were re-verified after the single-entrypoint rewrite. Re-verify details before editing
the named surfaces, but do not restore the superseded architecture.

### Storage (`apps/app-backend/src/lib/infrastructure/db/schema/tables/`)

- `core.ts` — `plugin`, per-user `plugin_state`, stable logical `sandbox_provider`, and
  content-addressed `sandbox_script`. Provider-associated scripts reference `providerId`; there is
  no per-user script ownership.
- `entities.ts` — generic entities store schema slugs and nullable provider provenance. Provider
  entities deduplicate by `(userId, externalId, entitySchemaSlug, providerId)`; relationships store
  relationship-schema slugs.
- `events.ts` and `automations.ts` — events and signals store schema slugs. Manifest bindings live
  in the definition registry; per-user notification state lives in
  `notification_subscription_state`, and `subscription_run` retains durable attribution.
- `views.ts` — user views group by nullable `pluginSlug`; `saved_view_state` stores per-user
  overrides for code-defined views.
- There are **no media- or fitness-specific tables**. One drizzle migration exists
  (`src/drizzle/0000_*.sql`) and may be regenerated.

### Definitions and scripts

- `plugins/media` and `plugins/fitness` own domain definitions, logical provider declarations,
  direct scripts, bindings, crons, boot entries, and operations. Kernel source zero owns only
  generic definitions and its notification formatter.
- The definition registry loads immutable slug-keyed snapshots from normalized plugin manifests.
  Schema-provider links target logical providers, while automation bindings target scripts.
- The production catalog contains 142 direct scripts: 136 media, 5 fitness, and 1 kernel. Every
  compiled module exposes one executable definition.

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
- The backend selects host functions from trusted execution authority and script metadata. System
  authority is created only by trusted scheduler paths and can emit signals; notification sending
  remains subscription-only. Standard provider scripts do not receive global-write capabilities.
- Provider-associated scripts share provider-scoped caches. Standalone scripts use script-scoped
  caches. The backend derives this namespace from persisted identity.
- The compiler validates one direct definition per module and rejects obsolete multi-entrypoint
  authoring. Execution payloads contain no runtime entrypoint selector.

### Native domain modules (the code that must end up inside plugins)

The Phase 3 domain migrations are complete. Native `media-monitoring` and its contract are deleted;
operations, workflows, and crons are plugin-owned, and no media- or fitness-specific module remains
outside the documented `modules/legacy-bootstrap` V1-adoption quarantine. The comprehensive kernel
purity grep and triage are recorded in `03-phase-3-capability-migrations.md`; Phase 3 remains open for
the operational gate and the owner-skipped Task 10 imports e2e follow-up, not Step 5 implementation.

### Contract (`libs/contract/src/modules/`)

Schema CRUD, tracker, metadata-lookup, media-monitoring, and public sandbox-script groups are gone.
Generic `definitions` and `plugins` groups expose the code-owned registry and plugin install/invoke
surfaces.

### E2e suite (`tests/`)

The suite uses one shared backend per run and Effect-native fixtures. Hermetic provider coverage
installs real test plugins with stable logical providers and separate operation scripts. The Step 5
media-monitoring suites pass unchanged (4 files, 13 tests), and the system-query suite passes 9 tests
covering 11 cases; combined, they pass 5 files and 22 tests. The full e2e gate is not green: the owner
skipped Task 10's imports failure, and the opt-in operational test remains a blocker. Conventions
live in `tests/AGENTS.md`.

## Target architecture (end state)

```txt
libs/plugin-kit            manifest types, definePlugin builder, shared plugin authoring API
libs/sandbox-sdk           script-facing SDK (+ Effect vendored, workflow entry point)
libs/sandbox-compiler      bundling (extended for multi-file plugin packages)
plugins/media              source bundle: manifest + schemas + scripts (providers, automations,
                           workflows, crons, operations, integration providers, import sources)
plugins/fitness            source bundle: manifest + schemas + scripts (exercise provider,
                           preload boot script, workout automation, import sources)
apps/app-backend           the kernel:
  definition registry      in-memory, slug-keyed; sources: kernel-owned definitions + loaded
                           plugins; atomic snapshot swap; Redis invalidation
  plugin ingestion/loader  validate → compile → content-address → persist → load
  sandbox runtime          direct script execution + authority gates; workflow primitives, and
                           deny-by-default per-execution filesystem grants (step 4)
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
