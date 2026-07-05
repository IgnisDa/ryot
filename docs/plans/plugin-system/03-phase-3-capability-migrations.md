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

Migrate: `modules/media-trending` (poll providers → write trending global entities +
refresh workflow + infrequent task) and `modules/exercises` (free-exercise-db preload)
become cron-driven plugin scripts. The trending _read_ path (whatever serves trending to
clients) should already be query-engine-based; if any native read code remains, it moves to
a saved view / recipe or waits for step 2's operations.

Delete: `modules/media-trending`, `modules/exercises` (and their contract surface if any —
check `libs/contract`). E2e: `tests/src/tests/exercises/` + trending coverage re-pointed
(cron trigger fixtures already exist: `triggerInfrequentCron`).

Done: both modules deleted; exercises + trending e2e green; cron manifest section documented
in `libs/plugin-kit`.

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
