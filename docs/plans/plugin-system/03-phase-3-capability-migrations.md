# Phase 3 — Capability migrations

Goal: move the remaining native domain code into the plugins, one capability at a time. Step 0's
two prerequisites establish the authoring and observability foundations. Each capability step
(a) adds a small generic slice of kernel capability (manifest section + host functions), (b)
rewrites the domain logic as plugin scripts, (c) deletes the native module, and (d) re-points the
corresponding e2e suites with assertions preserved. Tasks are strictly ordered; a prerequisite is
done only when its explicit criteria and gates pass, and a capability step is done only when its
native code is deleted and the suite is green.

Standing rules for every host function added in this phase (Decision 8): batch-first
signatures; query pushdown via `executeQueryEngine` rather than new list-and-filter
functions; coarse atomic writes; generic naming and semantics (never explicable only by
media). Every new host function follows the existing contract pattern
(`libs/sandbox-sdk` contract + `bridge-adapter.ts` validation + `host-functions.ts`
implementation + limits entry) and gets observability: a span per host call already exists
via the bridge; add structured log/span host functions in step 0 so plugin code is debuggable.

## Step 0 — Sandbox authoring upgrades (two ordered prerequisites)

### Step 0a — Effect-native sandbox cutover

- **[DECIDED] Effect is the sole script authoring and typed host-function API.** Vendor `effect`
  (host-pinned version) as an approved sandbox dependency by extending `libs/sandbox-sdk` and the
  import map / `PackageCacheManager` in `sandbox-runtime/dependencies.ts`. It is runtime-provided
  and never bundled per script.
- Change every script-facing host function to return an `Effect` with a typed error. Change
  generic, provider, and automation driver `run` functions to return `Effect` values, and have
  the Deno runner execute them through the vendored runtime. Remove the raw Promise authoring API;
  do not retain wrappers, aliases, or a second driver contract for compatibility.
- Replace the sandbox SDK's Zod schema surface with Effect Schema for manifests, driver
  input/output, and host-function wire contracts. The compiler and runner decode these contracts
  with Effect Schema, and Zod is removed from the approved sandbox dependencies. Declarative
  `AppSchema` property metadata remains unchanged under Decision 6.
- Make backend host-function implementations, `bridge-adapter.ts` validation/dispatch, and the
  typed bridge handler Effect-native. Promise-based platform operations such as the Deno
  runner's loopback `fetch` remain private transport details and are wrapped into Effect at that
  boundary; they are not exposed in SDK or backend host-function contracts.
- Migrate every existing media-plugin, fitness-plugin, kernel source-zero script, compiler
  fixture, SDK test helper, and sandbox execution test in this cutover. The task is complete only
  when no Promise-based script driver or host-function contract remains and all existing scripts
  execute with behavior unchanged.
- Approved-dependency additions later in this phase (e.g. `fflate` in step 4) follow the same
  vendoring mechanism established here.

Rationale: cutting over before any capability migration gives every Phase 3 host function and
script one authoring model. A gradual per-capability migration would preserve two public APIs,
duplicate contracts and tests, and make their eventual removal a second cross-cutting migration.
The branch has no deployment or persisted-script compatibility constraint, so the existing
scripts can migrate atomically with the runtime.

### Step 0b — Structured sandbox observability

- Add batch-first `log`/`span` host functions (structured, threaded into the execution's OTLP
  trace and `subscription_run`-style bookkeeping) using the Effect-native contract established
  in Step 0a. Scripts writing substantial logic need better than `console.log` collection.
- Follow the existing full host-function pattern and limits: SDK contract, bridge validation,
  implementation, capability gating, bounded artifacts, and focused tests.

Step 0a and Step 0b are separate tasks and strictly ordered. Step 1 cannot begin until both are
done and the full gates pass.

## Step 1 — Crons: `media-trending` + `exercises`

Kernel capability:

- Manifest section `crons: [{ slug, schedule, driverRef, description }]` (cron expression
  format = whatever the existing scheduler module consumes; the kernel owns the tick).
- Scheduler dispatches each due cron as a sandbox execution of the referenced driver
  (fire-and-forget through the durable queue machinery consistent with
  `apps/app-backend/AGENTS.md` durable-ownership rules; idempotency stays with the script).
- New host functions (shapes **[IMPLEMENTER-DECIDES]**, semantics fixed):
  - `upsertGlobalEntities(items[])` — batch, coarse-atomic per item (entity + provenance),
    preserve-existing semantics matching today's trending refresh writes.
  - `upsertGlobalRelationships(items[])` — same for relationship edges.
  - Both are global-scope (no user) and must be capability-gated in the driver manifest so a
    future untrusted provider script cannot write global data by default.

**Implementation choice (2026-07-24, owner-approved):** `upsertGlobalEntities(items)` accepts
`{ entitySchemaSlug, externalId, name, properties, populatedAt }` items, injects provenance from
the executing script, preserves an existing global entity, and returns aligned upsert results
(refined by the amendment below). `upsertGlobalRelationships(items)` accepts atomic
reconciliation groups shaped as `{ relationshipSchemaSlug, selector, relationships[] }`; each
group validates and upserts its listed edges and deletes absent global edges matching the generic
selector in one transaction, returning mutation counts. Treating a relationship item as a set
rather than a single edge preserves the native trending refresh's stale-edge deletion without a
media-specific syscall or a separate list-and-filter host function.

**Implementation choice amendment (2026-07-24, owner-approved):**
`upsertGlobalEntities(items, options?)` additionally accepts a generic
`{ maximumTotal?: number }` bound. When supplied, the kernel counts existing global entities for
each affected `(entitySchemaSlug, executing-script provenance)` scope and atomically skips absent
items after that scope reaches the maximum; aligned results are discriminated as upserted
`{ status: "upserted", entityId, wasInserted }` or `{ status: "skipped" }`. This preserves the
exercise preload cap when an upstream catalog reorder leaves previously imported entities outside
the current prefix, without adding a list/count syscall or moving persistence knowledge into the
plugin.

**Implementation choice amendment (2026-07-26, owner-approved):** exercise preload is
one-time catalog seeding, not periodic refresh work, and the `crons` scheduler only fires on
its wall-clock schedule — a server that restarts before the next tick (or a fresh install)
never seeds any exercises, regressing the native preloader's per-boot behavior. A sibling
manifest section `boot: [{ slug, driverRef, description }]` (no `schedule`) declares scripts
the kernel dispatches exactly once per server start, non-blocking (forked so server readiness
is never gated on it), immediately after plugin ingestion; dispatch is skipped when
`scheduler.disableDispatchers` is set, matching the other schedulers. Boot scripts expose a
dedicated `boot` driver (the same one-section-one-driver convention as `cron`/`operation`),
and the `upsertGlobalEntities`/`upsertGlobalRelationships` system-execution gate widens from
`driverName: "cron"` to `driverName: "cron" | "boot"` (still `userId: null`, no
`subscriptionRun`) so boot scripts can use the same global writes. The fitness
`preload-exercises` entry moves from `crons` to `boot`; `media-trending` stays a `crons` entry
because it is genuinely periodic. Boot dispatch uses a per-boot execution id, so the already
idempotent preload script (preserve-existing upserts + `maximumTotal`) absorbs re-runs exactly
as it did as a cron.

Migrate: `modules/media-trending` (poll providers → write trending global entities +
refresh workflow + infrequent task) becomes a cron-driven plugin script, and
`modules/exercises` (free-exercise-db preload) becomes a boot-driven plugin script. The
trending _read_ path (whatever serves trending to clients) should already be
query-engine-based; if any native read code remains, it moves to a saved view / recipe or
waits for step 2's operations.

Delete: `modules/media-trending`, `modules/exercises` (and their contract surface if any —
check `libs/contract`). E2e: `tests/src/tests/exercises/` re-pointed to rely on boot dispatch
(no manual trigger needed) + trending coverage re-pointed (cron trigger fixture already
exists: `triggerInfrequentCron`).

Done: both modules deleted; exercises + trending e2e green; `crons` and `boot` manifest
sections documented in `libs/plugin-kit`.

## Step 2 — Operations (invoke): `metadata-lookup` + `episode-resolver`

Kernel capability:

- Manifest section `operations: [{ slug, driverRef, inputSchema, outputSchema, auth }]`
  (`auth`: authenticated-user vs admin; schemas use the SDK's Effect Schema contract style).
- One new contract endpoint: `plugins.invoke(pluginSlug, operationSlug, payload)` —
  validates against the declared schemas, dispatches to the driver, returns the result.
  Batch-first: an operation's payload is naturally a batch (e.g., resolve N episode refs in
  one call).
- First-party client typing ("recipes"): plugin package exports its operation input/output
  types; clients import them and call `invoke` through a small typed wrapper in
  `libs/plugin-kit` **[RECOMMENDED]**.

Migrate:

- `modules/metadata-lookup` → media plugin operations. The **browser extension**
  (`apps/browser-extension`) migrates in the same step to the invoke endpoint — it is the
  only external consumer (verified; `app-client` has no metadata-lookup usage).
- `modules/episode-resolver` → media plugin. Note its consumers are mostly _internal_
  (import/integration flows). Until those flows themselves migrate (steps 3–4), the interim
  wiring is: kernel code that still needs episode resolution calls the plugin operation
  through the same dispatch path the invoke endpoint uses (an internal `invokeOperation`
  service function — same code path, no HTTP). This is temporary scaffolding that
  disappears as steps 3–4 move the callers into the plugin, where they can import the
  resolver logic directly as shared package code.

Delete: both modules + the `metadata-lookup` contract group (`media-monitoring`'s group
survives until step 5). E2e: metadata-lookup/browser-extension integration tests re-pointed
to invoke.

Done: modules deleted; invoke endpoint covered by kernel tests (schema validation, auth,
unknown operation) + migrated suites green; extension works against invoke.

**Implementation choices (2026-07-25, owner-approved):**

1. **Operation `auth` gains a third `integration` mode (alongside `user` and `admin`).** The
   plan text above named only "authenticated-user vs admin", but the browser extension — the sole
   external `metadata-lookup` consumer, which task 04 requires migrating onto `plugins.invoke` — is
   **public, holds no user session, and runs its lookup as the integration's owning user** (the
   native `MetadataLookupService.lookup` loads the integration via `getByIdAnyUser` and searches as
   `integration.userId` so the owner's NSFW preference applies). A two-value enum cannot express
   this, so `auth` is `"user" | "admin" | "integration"`. For an `integration` operation,
   `plugins.invoke` carries an integration id; the **kernel integrations framework** (which stays in
   the kernel under Decision 14, so this is generic, not media-specific) resolves it to the owning
   user, verifies the integration is enabled, and dispatches the operation with that user's context
   and **no session required**. The integration id remains the credential exactly as today, so
   behavior (including owner-scoped preferences) is preserved. The generic invoke endpoint has no
   group middleware; the handler reads the operation's declared `auth` from the registry and
   enforces it conditionally (resolving `CurrentUser` from request headers itself for `user`,
   the admin token for `admin`, and the integration for `integration`), keeping the single generic
   endpoint intact (Decision 9). `metadata-lookup` = `integration`; `resolve-episodes` = `user`.
2. **Operation input/output Effect Schemas live on the driver, not serialized into the manifest
   entry.** The manifest section is `operations: [{ slug, driverRef, auth, description }]`. Effect
   Schemas cannot round-trip through `PluginManifest`'s own `Schema.decodeUnknown` (manifests are
   plain data), and providers/crons already carry their `input`/`output` schemas on the driver in
   the `.sandbox.ts` module. `plugins.invoke` validates against the declared schemas the same way
   every driver already does: the sandbox runner decodes the payload against `driver.input` and the
   result against `driver.output`. This realizes the plan's "validates against the declared
   input/output schemas" within the existing architecture rather than duplicating schema data.

   **Operation scripts use a dedicated `operation` sandbox-script kind** (owner-approved
   2026-07-25). `libs/plugin-kit`'s `PluginScript` union deliberately rejects the generic
   `kind: "script"` catch-all (pinned by `manifest.test.ts`), so rather than open it, a first-class
   `kind: "operation"` is added across `@ryot/sandbox-sdk` (manifest-schema union + a
   `defineOperation` authoring helper wrapping the generic `defineDriver` machinery — the SDK and
   compiler already dispatch drivers generically by name), the compiler (recognize the helper and
   map `definitionKind: "operation"`), and `PluginScript`. Operation scripts expose a single driver
   under the conventional driver name `"operation"`; the kernel dispatches with
   `driverName: "operation"` (mirroring how crons dispatch `driverName: "cron"`), and manifest
   validation asserts each `operations[].driverRef` references an `operation`-kind script exposing
   that driver. Keeping the generic catch-all closed and giving each capability its own typed kind
   is the pattern step 3's `workflow` kind will follow. Operations reuse only existing host
   capabilities (metadata-lookup: `httpCall`/`getAppConfigValue`/`getUserPreferences`/`getIntegration`
   composed with the in-repo TMDB provider search drivers; resolve-episodes: `executeQueryEngine`),
   so no new host functions or capability scopes are added this step.
3. **`episode-resolver` becomes a single batch-first `resolve-episodes` operation.** Input is
   `{ refs: [...] }` where each ref is discriminated `show` (showEntityId, seasonNumber,
   episodeNumber) or `podcast` (podcastEntityId, episodeNumber); output is aligned
   `{ entityId | null }[]` (unique-match-wins, matching the native ambiguity rule). It is
   implemented with `executeQueryEngine` (multi-hop relationship traversal `show→season→episode`
   via `EntitySource.via` plus JSONB property equality on `seasonNumber`/`episodeNumber`, run as the
   caller's user), keeping provider-catalog/resolution knowledge in sandbox scripts per
   `apps/app-backend/AGENTS.md`. The interim internal callers (import writing/event-target
   workflows) reach it through the temporary `invokeOperation` service path with single-element
   `refs` arrays until steps 3–4 move those callers into the plugin. `auth: "user"`.
4. **First-party recipe typing = a generic typed invoker in `libs/plugin-kit` plus
   plugin-exported operation types.** `plugins/media` exports its operation input/output types
   (derived from the driver schemas); `libs/plugin-kit` exports a small generic typed `invoke`
   wrapper over the `plugins.invoke` contract call. The browser extension imports the media
   operation type and the plugin-kit invoker, so no plugin-specific contract endpoint is added
   (Decision 9).
5. **The title parse/match helpers are transitionally duplicated into the media plugin; step 4
   deletes the kernel copy.** `lib/shared/title-parsing.ts` and `lib/shared/title-matching.ts`
   (`extractMetadataLookupBaseTitle`, `extractMetadataLookupSeasonEpisode`,
   `chooseBestMetadataLookupTitleMatch`) had two kernel consumers: the deleted
   `modules/metadata-lookup`, and the **Netflix import source adapter**
   (`modules/imports/sources/netflix/{adapter,processor}.ts`), which is media-specific and moves
   into the plugin in step 4. The kernel must not import plugin code (Decision 2) and sandbox
   scripts cannot import kernel code, so the logic is copied into `plugins/media/shared/` for the
   metadata-lookup operation while the kernel copy stays **solely** for the Netflix adapter.
   **Step 4 action:** when the Netflix adapter moves into the plugin, delete
   `apps/app-backend/src/lib/shared/title-parsing.ts`, `title-matching.ts`, and their tests, and
   point the migrated adapter at the plugin-side copy — leaving one owner. This is the only
   duplication step 2 introduces; task 09's cleanup pass must not "resolve" it earlier by making
   the kernel depend on the plugin.

## Step 3 — Durable workflows: media import population/resolution **(spike first)**

**Mandatory spike before committing to the design**: a throwaway replay-deterministic script
driven by a prototype `activity()` host function, exercised through suspend/resume and
process-restart. Budget it small; its purpose is to surface serialization, timeout, and
replay-ordering issues before the real machinery is built. Record findings in this file.

Kernel capability:

- Manifest section `workflows: [{ slug, driverRef }]`.
- Workflow scripts are replay-deterministic: the kernel's durable engine (existing Effect
  workflow machinery) runs a _workflow shell_ whose body repeatedly executes the script;
  the script calls host primitives:
  - `activity(name, input)` — first call runs the payload as a normal sandbox execution of a
    referenced activity driver (or inline driver of the same script) and journals the
    result; replays return the journaled result without re-execution.
  - `sleep(name, duration)` — durable timer via the engine.
  - `child(name, workflowRef, input)` — composes another manifest workflow with a
    **deterministic execution id** derived from parent id + name (this preserves the
    existing hard rule in `apps/app-backend/AGENTS.md` §Queues about deterministic child
    ids).
  - The journal is keyed by call sequence + name; a replay that diverges (different call
    order) fails the execution with a structured nondeterminism error.
- Version pinning: an execution records the script row's `contentHash` at start; every
  replay loads exactly that module (Phase 2's immutable-per-hash script rows make this a
  lookup). A hot swap never changes a running execution's code.
- Determinism guard rails: workflow drivers use a restricted SDK entry point (no
  `httpCall`, no cache, no ambient time/random — activities do the IO); enforce by
  capability scoping in the manifest kind, mirroring how automation vs provider host scopes
  already differ (`bridge-adapter.ts` contract scopes).
- Limits: workflow/activity driver kinds get their own budget profile (a batch activity
  legitimately makes more host calls than a provider search) — add per-driver-kind limit
  selection now, kernel-owned ceilings.

Migrate: `imports/media/population-workflow.ts` and `resolution-workflow.ts` (and the
population trigger path in `entities/population-trigger.ts` + `entity-import` where
media-specific) become media-plugin workflows + activities. The kernel `imports` framework
(run tracking, file handling) and `entity-import`'s generic surface stay. Preserve the
documented keying/idempotency semantics (ensure-mode, preserve-existing upserts, `EventCreateWorkflow` composition
— which remains a kernel-owned workflow callable as an activity host op or composed via
`child` against kernel workflows **[IMPLEMENTER-DECIDES]** which, keeping single durable
ownership intact).

Delete: the media-specific workflow definitions from `imports/`. E2e:
`entity-import`/`imports` suites re-pointed; add kernel tests for replay determinism
(induced suspend/replay, nondeterminism detection, pinning across a hot swap — the latter is
one of the most important tests in the repo).

Done: media import population/resolution run as plugin workflows end-to-end; import e2e
suites green; spike findings recorded.

## Step 4 — Integration adapters: yank/sink/push + import source adapters

Kernel capability:

- Manifest section extends integration registration: a plugin declares integration
  _providers_ `{ slug, lot (yank|sink|push), driverRef, settingsSchema }`; the kernel
  integrations framework (credential storage, enable/disable, auto-disable, run bookkeeping
  — tables in `imports.ts`) serves them generically and lists available providers from the
  registry.
- Filesystem grants (Decision 10): kernel materializes an uploaded/fetched artifact to a
  path, spawns the execution with `--allow-read` on it plus a per-execution scratch dir
  (quota'd, kernel-cleaned) with `--allow-write`; grants are declared per driver kind in the
  manifest (`capabilities: ["artifact-read", "scratch"]`) and are deny-by-default.
  Implementation lives next to the existing flag assembly in `runtime.ts`
  (`makeSpawnDenoProcess`). Note: pooled pre-warmed processes are spawned _before_ the
  execution is known, so per-execution grants require spawning a dedicated (non-pooled)
  process for grant-carrying executions **[RECOMMENDED]** — measure before optimizing.
- Approved deps: add `fflate` (zip) to the sandbox SDK.
- Push targets (radarr/sonarr/jellyfin) are already sandbox trigger scripts — they only need
  their binding declarations, already moved in Phase 2.

Migrate: `integrations/sinks/*` normalization + yank connectors + import source adapters
into media-plugin scripts (bounded network via `httpCall` with integration credentials —
`getIntegration` exists; audit that credential exposure to scripts stays scoped to the
integration being executed). Preserve `createProgressResult` semantics (`sinks/shared.ts`)
— the progress-policy automation depends on `occurredAt` always being set.

Delete: native sink/yank adapter code from `modules/integrations` and media import source
adapters from `modules/imports`, leaving the frameworks. E2e: `integrations/` + `imports/`
suites re-pointed.

Done: kernel `integrations`/`imports` modules contain zero provider-specific code; suites
green.

## Step 5 — `media-monitoring` + remaining media logic

By now this is composition: monitoring sweeps = cron + `executeQueryEngine` pushdown +
signals; refresh flows compose the step-3 workflows; notification fan-out uses existing
signal/subscription machinery. The `media-monitoring` contract group's user-facing surface
(status/enable/disable) becomes plugin operations (step 2 capability).

Migrate & delete: `modules/media-monitoring`, any leftover media references in `signals`,
`events`, `entity-interest` (interest/translation machinery itself is kernel — only
media-specific branches, if any, move). E2e: the `media-monitoring/` suites (4 files,
including association detectors and cron-refresh coverage) re-pointed — these are the
acceptance test that the syscall surface is sufficient, since they exercise nearly every
capability at once.

Done: **no module under `apps/app-backend/src/modules/` is media- or fitness-specific**;
full e2e suite green; the media-monitoring suites pass with assertions unchanged.

## Phase gate

All step gates plus: grep the kernel for media/fitness vocabulary (informal preview of
Phase 4's enforced check) and triage every hit — each is either deleted, generalized, or
explicitly justified in this file.
