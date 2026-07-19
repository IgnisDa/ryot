# Plugin System — Phase 3: Capability Migrations

This PRD is a thin framing layer. **The authoritative technical spec is the two plan
files**, which this document references rather than restates:

- `docs/plans/plugin-system/00-overview.md` — the vision, the decision record, the current
  implementation baseline, the target architecture, and the cross-phase invariants that
  bind every phase.
- `docs/plans/plugin-system/03-phase-3-capability-migrations.md` — the complete Phase 3
  spec: the standing host-function rules, and the strictly-ordered steps 0–5 (Effect-native
  sandbox cutover and structured observability; crons; operations/invoke; durable workflows
  with a mandatory spike; integration + import-source adapters with filesystem grants; and
  `media-monitoring` plus
  the remaining media logic), followed by the phase gate.

Read both in full before starting any task. Phase 3 must not begin until Phase 2's done
criteria are all met (`00-overview.md` phase ordering; Phase 2's PRD marks all eight of its
tasks done). Within Phase 3 the numbered steps are **strictly ordered** — the two Step 0
prerequisites must meet their explicit done criteria, and each capability step is done only when
its native code is deleted and the re-pointed e2e suite is green (`00-overview.md` phase ordering;
plan intro; cross-phase invariant 4). Where this framing and the plans appear to
conflict, **the plan files win** — including where they name specific file paths, tables, and
modules (the write-a-prd "no file paths / no restating decisions" conventions are deliberately
overridden here because the design phase is already complete and the plans are the source of
truth). Markers in the plans carry force: `[DECIDED]` items are settled and must not be
relitigated; `[RECOMMENDED]` items are defaults you follow unless you find concrete evidence
they are wrong (record deviations in the plan file); `[IMPLEMENTER-DECIDES]` items are open,
and you record the choice you make in the plan file.

## Tasks

**Overall Progress:** 12 of 12 tasks completed

**Current Task:** none (phase complete)

### Task List

| #   | Task                                                                                                            | Type | Status |
| --- | --------------------------------------------------------------------------------------------------------------- | ---- | ------ |
| 01  | [Step 0a — Effect-Native Sandbox Cutover](./01-effect-native-sandbox-cutover.md)                                | AFK  | done   |
| 02  | [Step 0b — Structured Sandbox Observability](./02-structured-sandbox-observability.md)                          | AFK  | done   |
| 03  | [Step 1 — Crons & Boot: media-trending + exercises](./03-crons-trending-exercises.md)                           | AFK  | done   |
| 04  | [Step 2 — Operations/invoke: metadata-lookup + episode-resolver](./04-operations-invoke-lookup-resolver.md)     | AFK  | done   |
| 05  | [Step 3a — Durable Workflow Spike](./05-durable-workflow-spike.md)                                              | HITL | done   |
| 06  | [Step 3b — Durable Workflows: media import population/resolution](./06-durable-workflows-media-import.md)       | AFK  | done   |
| 07  | [Step 4a — Kernel Capability: Manifest Sections, FS Grants, Deps](./07-integration-import-kernel-capability.md) | AFK  | done   |
| 08  | [Step 4b — Integration Adapters: Sinks + Yanks into media](./08-integration-adapters-media.md)                  | AFK  | done   |
| 09  | [Step 4c — Import Framework Collapse + Fitness Import Sources](./09-import-framework-fitness-sources.md)        | AFK  | done   |
| 10  | [Step 4d — Media Import Sources into media](./10-media-import-sources.md)                                       | AFK  | done   |
| 11  | [Step 5 — media-monitoring + Remaining Media Logic + Phase Gate](./11-media-monitoring-and-phase-gate.md)       | AFK  | done   |
| 12  | [Codebase Cleanup](./12-codebase-cleanup.md)                                                                    | AFK  | done   |

Steps are strictly ordered (`00-overview.md` phase ordering; plan intro): each task starts only
after the previous task's done criteria and gates pass (one capability in flight at a time,
cross-phase invariant 4). Tasks 01 and 02 are ordered Step 0 prerequisites. Task 05 (the
mandatory spike, HITL) gates task 06: its
recorded findings and owner sign-off must land before the real workflow machinery is built.

Plan Step 4 is large enough that it spans **four gated tasks (07–10)** rather than one. Their order
is fixed: kernel capability first with no consumers, then integration adapters, then the import
framework collapse plus the three fitness sources, then the sixteen media sources. Fitness precedes
media deliberately — three simple CSV adapters prove the generic import dispatch path before the
large migration lands on it. Every design question in Step 4 was settled with the owner on
2026-07-27 and is recorded in plan §4; nothing there is open.

## Problem Statement

Phases 1 and 2, Phase 3 Steps 0-4, and the Step 5 migration and comprehensive purity triage are
complete. Native `media-monitoring` and its contract are deleted; operations, workflows, and crons
are plugin-owned. Phase 4's later, broader audit found cross-cutting media library policy outside
the named Phase 3 modules; the Phase 4 plan owns that residue and supersedes this PRD's original
purity conclusion. Task 12's cleanup pass is complete, executed under an explicit owner waiver of
its Task 11 prerequisite.

Task 11 and the full Phase 3 gate are complete. The Task 10 imports and integration failures are
repaired, and the standard full e2e suite passes all 79 files and 501 tests. The opt-in operational
gate also passes at its unchanged two-concurrent-1,001-item workload: all eight workflows completed
in 361,548 ms with no pool waits, advisory-lock waits, deadlocks, or Redis projection errors.

The full rationale, and why this phase comes third, is in
`docs/plans/plugin-system/00-overview.md` (see "Sequencing rationale": Phase 3 "orders
migrations so each forces a small reusable syscall slice: crons → invoke → workflows → fs
grants → composition"; the workflow engine is "the highest-uncertainty item and gets a
mandatory spike") and Decisions 7, 8, 9, 10, 11, and 14 of its decision record.

## Solution

Move the remaining native domain code into the plugins **one capability at a time**, in the
fixed order of plan steps 0–5. Each step is a vertical slice: (a) add a small _generic_ slice
of kernel capability (a manifest section plus the host functions that section needs), (b)
rewrite the domain logic as plugin scripts against that capability, (c) delete the native
module, and (d) re-point the corresponding e2e suites with assertions preserved. Syscalls are
**pulled, not pushed** (cross-phase invariant 3): no host function, manifest field, or kernel
capability is built before the step that consumes it, and every host function added obeys the
standing rules — batch-first signatures, query pushdown via `executeQueryEngine` rather than
new list-and-filter functions, coarse atomic writes, and generic naming that is never
explicable by only one plugin (Decision 8; plan standing rules).

The steps, in order: **Step 0a** atomically cuts scripts, backend host implementations,
and typed bridge dispatch over to an Effect-only API with no raw Promise compatibility surface.
**Step 0b** independently adds structured, batch-first `log`/`span` host functions. **Step 1**
adds the `crons` and `boot` manifest sections and global-write host functions, moving
`media-trending` to a cron-driven script and `exercises` to a boot-driven script (one-time
catalog seeding runs once per server start, not on a periodic schedule). **Step 2** adds the `operations` manifest section and the single generic
`plugins.invoke` contract endpoint, moving `metadata-lookup` and `episode-resolver` to plugin
operations and migrating the browser extension to invoke. **Step 3** — gated behind a
**mandatory throwaway spike** — builds the replay-deterministic durable-workflow primitives
(`activity`/`sleep`/`child`, version pinning, determinism guard rails, per-script-kind limits)
and moves the media import population/resolution workflows into the media plugin. **Step 4**
(tasks 07–10) adds the `integrationProviders` and `importSources` manifest sections,
deny-by-default filesystem permission grants, and three approved deps (`fflate`, `papaparse`,
`fast-xml-parser`); it moves every integration adapter and all nineteen import sources into the
plugin that owns their domain — sixteen media sources into `plugins/media`, three fitness sources
into `plugins/fitness` — collapsing the kernel's media-vs-non-media import branch into one
registry-driven dispatch path while the kernel keeps the integrations and imports _frameworks_ and
retains ownership of every entity/event/relationship write. **Step 5** is
composition: `media-monitoring` and any remaining media logic become cron +
`executeQueryEngine` pushdown + signals + step-3 workflows + step-2 operations, ending with
**no module under `apps/app-backend/src/modules/` being media- or fitness-specific**.

The complete solution — the exact manifest sections, host-function shapes and semantics, the
spike protocol, the determinism/pinning/limits design, the filesystem-grant mechanics, the
per-step migrate/delete/e2e lists, and the per-step done criteria — is specified in
`docs/plans/plugin-system/03-phase-3-capability-migrations.md`. Do not re-derive it.

## User Stories

Actors: **owner** (authors the first-party plugin scripts and the media/fitness logic being
migrated), **kernel** (the domain-agnostic backend exposing the syscall surface), **plugin
package** (`plugins/media` / `plugins/fitness`), **sandbox script author** (writes provider /
automation / cron / operation / workflow / adapter scripts), **scheduler** (kernel component
firing cron ticks), **durable engine** (kernel component running workflow shells), **API
client** (`app-client`), **browser extension** (`apps/browser-extension`, the sole external
metadata-lookup consumer), **admin/end user** (invokes operations, configures integrations),
and **implementing agent**.

### Step 0 — sandbox authoring upgrades

1. As a sandbox script author, I want `effect` vendored as a host-pinned approved sandbox
   dependency (single version matching the host, never bundled per script), so that scripts
   carrying substantial logic can use Effect the same way the host does (Decision 11; plan §0).
2. As a sandbox script author, I want every host function and script entrypoint to use typed
   `Effect` values exclusively and every sandbox manifest, script, host wire contract, and operation
   contract to use Effect Schema, with backend implementations and typed bridge dispatch using
   the same model and Promise confined to private platform transport adapters, so that Phase 3
   has one authoring, schema, and syscall contract rather than parallel APIs (Decision 11; plan
   Step 0a).
3. As a sandbox script author, I want `log` and `span` host functions that thread structured
   output into the execution's OTLP trace and bookkeeping, so that plugin code is debuggable
   with better than `console.log` collection (plan §0; standing-rules observability).
4. As the kernel, I want later approved-dependency additions (e.g. `fflate` in step 4) to flow
   through the same vendoring mechanism as `effect`, so that the dependency surface stays
   controlled (plan §0).

### Step 1 — crons: `media-trending` + `exercises`

5. As the owner, I want a `crons` manifest section (`{ slug, schedule, scriptSlug,
description }`) whose schedule format is whatever the existing scheduler consumes, so that a
   plugin declares periodic work without the kernel knowing what the work is (plan §1).
6. As the scheduler, I want each due cron dispatched as a sandbox execution of its referenced
   script and awaited to a terminal workflow result, with idempotency owned by the script, so that
   the kernel owns the tick and the plugin owns the behavior (plan §1).
7. As a sandbox script, I want batch, coarse-atomic global-write host functions
   `upsertGlobalEntities(items[])` and `upsertGlobalRelationships(items[])` with
   preserve-existing semantics matching today's trending refresh writes, so that a cron script
   can write global trending data (shapes `[IMPLEMENTER-DECIDES]`, semantics fixed; plan §1;
   Decision 8).
8. As the kernel, I want those global-write functions selected only for trusted system execution
   of generic scripts, so that standard provider scripts cannot write global data (plan §1).
9. As the owner, I want `media-trending` (poll providers → write trending globals + refresh
   workflow + infrequent task) rewritten as a cron-driven plugin script and `exercises`
   (free-exercise-db preload) rewritten as a boot-driven plugin script (one-time catalog seeding
   dispatched once per server start rather than on a periodic schedule), with the native modules
   deleted (with any contract surface), so that both capabilities run entirely inside their
   plugins (Decision 14; plan §1).
10. As the implementing agent, I want the trending _read_ path to stay query-engine-based
    (moving any residual native read code to a saved view / recipe, or deferring to step 2's
    operations), so that migrating the write path does not strand a native read path (plan §1).

### Step 2 — operations (invoke): `metadata-lookup` + `episode-resolver`

11. As the owner, I want an `operations` manifest section
    (`{ slug, scriptSlug, auth, description }`, `auth` = `"user" | "integration"`) with
    input/output Effect Schemas on the direct operation definition, so that a plugin declares
    named callable operations without adding an admin invocation mode (plan §2).
12. As an API client, I want a single generic `plugins.invoke(pluginSlug, operationSlug,
payload)` contract endpoint that validates against the declared schemas, dispatches to the
    direct script, and returns the result — batch-first payloads — so that the static typed contract
    never grows plugin-specific endpoints (Decision 9; plan §2).
13. As a first-party client, I want the plugin package to export its operation input/output
    types and a small typed `invoke` wrapper in `packages/plugin-kit` ("recipes"), so that
    first-party clients call operations with full typing (`[RECOMMENDED]`; Decision 9; plan §2).
14. As the owner, I want `metadata-lookup` rewritten as media-plugin operations and the browser
    extension migrated in the same step to the invoke endpoint (it is the sole external
    consumer; `app-client` has none), so that the only external metadata-lookup client moves
    with the capability (plan §2).
15. As the kernel, I want `episode-resolver` moved to the media plugin, with kernel code that
    still needs episode resolution calling the operation through an internal `invokeOperation`
    service function (same dispatch path, no HTTP) as temporary scaffolding that disappears as
    steps 3–4 move the callers into the plugin, so that internal consumers keep working during
    the transition (plan §2).
16. As the owner, I want both modules and the `metadata-lookup` contract group deleted
    (`media-monitoring`'s group survives until step 5), so that no native lookup/resolver code
    remains (plan §2).

### Step 3 — durable workflows: media import population/resolution (spike first)

17. As the implementing agent, I want to run a **mandatory throwaway spike** first — a
    replay-deterministic script driven by a prototype `activity()`, exercised through
    suspend/resume and process-restart, budgeted small — and record its findings in the plan
    file, so that serialization/timeout/replay-ordering issues surface before the real
    machinery is built (plan §3; overview sequencing rationale).
18. As the owner, I want a `workflows` manifest section (`{ slug, scriptSlug }`), so that a
    plugin declares durable workflows the kernel's existing Effect workflow engine runs as a
    workflow shell (plan §3; Decision 7).
19. As a workflow script, I want replay-deterministic host primitives — `activity(name,
scriptRef, input)` (runs a referenced direct script once, journals the result, and returns the
    journal on replay), `sleep(name,
duration)` (durable timer), and `child(name, workflowRef, input)` (composes another
    manifest workflow with a deterministic execution id derived from parent id + name) — so
    that multi-step durable operations re-execute from the top on each resume (Decision 7;
    plan §3; the deterministic child-id rule preserves `apps/app-backend/AGENTS.md` §Queues).
20. As the durable engine, I want the journal keyed by call sequence + name and a replay that
    diverges to fail with a structured nondeterminism error, so that nondeterminism is detected
    rather than silently corrupting state (plan §3).
21. As an in-flight execution, I want my script's `contentHash` recorded at start and every
    replay to load exactly that module (a lookup, given Phase 2's immutable-per-hash rows), so
    that a hot swap never changes the code a running durable execution is replaying (Decision
    7, 13; plan §3).
22. As the kernel, I want workflow scripts restricted to a determinism-safe SDK entry point (no
    `httpCall`, no cache, no ambient time/random — activities do the IO), enforced by
    capability scoping on the manifest kind mirroring how automation vs provider host scopes
    already differ, so that workflow bodies cannot introduce nondeterminism footguns (Decision
    11; plan §3).
23. As the kernel, I want workflow/activity script kinds to get their own kernel-owned limit
    profile (a batch activity legitimately makes more host calls than a provider search), so
    that per-script-kind budgets fit the workload (plan §3).
24. As the owner, I want `imports/media/population-workflow.ts` and `resolution-workflow.ts`
    (plus the media-specific parts of the population trigger and `entity-import`) rewritten as
    media-plugin workflows + activities and the media-specific workflow definitions deleted,
    while the kernel `imports` framework and `entity-import`'s generic surface stay, so that
    import orchestration runs as a plugin workflow (Decision 14; plan §3).
25. As the owner, I want the documented keying/idempotency semantics preserved (ensure-mode,
    preserve-existing upserts) and `EventCreateWorkflow` kept as a kernel-owned workflow —
    callable as an activity host op or composed via `child` (`[IMPLEMENTER-DECIDES]`) — so that
    single durable ownership stays intact (plan §3).

### Step 4 — integration adapters, import sources, and filesystem grants

26. As the owner, I want a **lot-discriminated** `integrationProviders` manifest section — `yank`
    and `sink` entries carry `scriptSlug`, `push` entries do not, because push targets are already
    automation scripts dispatched through `bindings.eventAutomations` — with the kernel integrations
    framework (credential storage, enable/disable, auto-disable, webhook endpoint, run bookkeeping)
    serving them generically and listing available providers from the registry, so that provider
    registration is declarative without an optional field that is meaningless for a third of its
    values (Decision 14; plan §4).
27. As the kernel, I want deny-by-default filesystem permission grants: I materialize an
    uploaded/fetched artifact to a path and spawn the execution with `--allow-read` on it plus
    a quota'd, kernel-cleaned per-execution scratch dir with `--allow-write`, with grants
    declared per script kind in the manifest (`capabilities: ["artifact-read", "scratch"]`), so
    that large artifacts flow via Deno permission grants rather than IPC (Decision 10; plan §4).
28. As the implementing agent, I want grant-carrying executions to run on a dedicated
    (non-pooled) process since pooled processes are pre-warmed before the execution is known,
    measuring before optimizing, so that per-execution grants are honored without prematurely
    reworking the pool (`[RECOMMENDED]`; plan §4).
29. As a sandbox script author, I want `fflate`, `papaparse`, and `fast-xml-parser` added as
    approved sandbox dependencies, so that zip, CSV, and XML parsing (CPU-bound work) happens
    inside the sandbox rather than as host functions, with CSV parity to the parser the kernel uses
    today (Decision 10; plan §4).
30. As the owner, I want the sink normalization + yank connectors + import-source adapters moved
    into the plugin that owns their domain (bounded network via `httpCall` with integration
     credentials through a `getCurrentIntegration` scoped to the executing integration) and the native
    provider-specific code deleted from `modules/integrations` and `modules/imports`, leaving the
    frameworks, so that the kernel integrations/imports modules contain zero provider-specific code
    (Decision 14; plan §4).
31. As the kernel, I want `createProgressResult` semantics preserved (`occurredAt` always set),
    so that the progress-policy automation keeps working (plan §4).
32. As the owner, I want push targets (radarr/sonarr/jellyfin) — already sandbox trigger
    scripts whose binding declarations moved in Phase 2 — to need no further migration here, so
    that step 4 does not redo Phase 2 work (plan §4).
33. As the owner, I want `settingsSchema` expressed as a declarative `AppSchema` validated by the
    existing property-schema runtime, and a `secret?: true` flag on `AppPropertyBase` that makes
    the client render a password input and makes the kernel **redact marked fields when an
    integration is read**, so that the hardcoded provider-specifics union leaves the kernel and
    stored credentials stop being returned in plaintext (an owner-signed-off behavioral change;
    Decision 6; plan §4).
34. As the owner, I want an `importSources` manifest section and the kernel's media-versus-non-media
    import branch collapsed into **one** registry-driven dispatch path (resolve the run's source
    slug to its owning plugin's workflow), so that the kernel stops knowing which sources are media
    (Decision 2; plan §4).
35. As a sandbox adapter script, I want to return output too large for `execution.resultBytes` by
     writing chunk files into my granted scratch directory and returning a small manifest, with the
     **kernel** harvesting those files at execution end into run-scoped storage and opaque handles
     before cleanup, so
    that full-size imports cross the boundary without raising `resultBytes` and re-introducing the
    context-pressure failure mode the step-3 spike hit (Decision 10; plan §4).
36. As the kernel, I want to keep ownership of every entity, event, and relationship write — plugins
    parse and orchestrate, they never write import results — so that the four proposed run-scoped
    syscalls (`putRunBlobs`, `getRunBlobs`, `recordImportFailures`, `reportImportProgress`) are
    **not built** and the kernel still owns counters and failure rows (Decision 8; plan §4).
37. As the owner, I want `ImportMediaEvent.episodeLocator` replaced by an already-resolved optional
    `subjectEntityId`, with the plugin workflow resolving subjects between population and writing
    via its own `resolve-episodes` operation, so that the kernel writing path collapses to
    `subjectEntityId ?? group.entityId` and `event-target-workflow.ts` — which imports
    `@ryot/plugin-media` and branches on season/episode numbers — is deleted with no kernel
    replacement (Decision 2; plan §4).

### Step 5 — `media-monitoring` + remaining media logic

33. As the owner, I want `media-monitoring` rewritten as composition — cron +
    `executeQueryEngine` pushdown + signals for sweeps, step-3 workflows for refresh flows, and
    existing signal/subscription machinery for notification fan-out — so that no new kernel
    capability is needed to migrate it (plan §5).
34. As an admin/end user, I want the `media-monitoring` contract group's user-facing surface
    (status/enable/disable) reimplemented as plugin operations (step 2's capability), so that
    its user-facing behavior is preserved without a kernel-owned media endpoint (plan §5).
35. As the owner, I want `modules/media-monitoring` and any leftover media references in
    `signals`, `events`, and `entity-interest` migrated and deleted (the interest/translation
    machinery itself stays kernel; only media-specific branches move), so that the kernel is
    free of the last media logic (plan §5).
36. As the owner, I want the phase to end with **no module under `apps/app-backend/src/modules/`
    being media- or fitness-specific**, so that the kernel-purity goal is materially reached
    (Decision 2; plan §5 done criterion).

### Cross-cutting

37. As the implementing agent, I want every new host function to follow the existing contract
    pattern (`packages/sandbox-sdk` contract + `bridge-adapter.ts` validation +
    `host-functions.ts` implementation + limits entry) and carry a span, so that new syscalls
    are consistent with the existing syscall surface and observable (plan standing rules).
38. As the owner, I want the branch to stay shippable after **every step** — backend `check`
    and unit tests, the full e2e suite (minus suites deleted with their surface), and the
    `app-client` check all green — so that each capability lands on a working base
    (cross-phase invariant 1; plan intro).
39. As the owner, I want only one capability in flight at a time (native module deleted + suite
    green before the next step starts), so that the migration never leaves two half-migrated
    capabilities interacting (cross-phase invariant 4; plan intro).
40. As the owner, I want the phase to end with the kernel grepped for media/fitness vocabulary
    (an informal preview of Phase 4's enforced check) and every hit triaged — deleted,
    generalized, or explicitly justified in the plan file — so that the phase gate proves the
    syscall surface was sufficient (plan phase gate).
41. As a maintainer, I want each touched `AGENTS.md`/`README.md` updated where conventions
    changed (media lifecycle semantics documented in `builtins/AGENTS.md` move with the code
    into the media plugin), so that documentation follows the code (cross-phase invariant 7).

## Implementation Decisions

Every technical decision for this phase is already made and written down. Rather than restate
them (and risk drift), this PRD points to the exact sections that own them:

- **Standing host-function rules** — batch-first signatures, query pushdown via
  `executeQueryEngine` (no new list-and-filter functions), coarse atomic writes, generic naming
  never explicable by one plugin, the existing contract pattern (`packages/sandbox-sdk` +
  `bridge-adapter.ts` + `host-functions.ts` + limits), and per-call observability: Decision 8
  and plan "Standing rules".
- **Step 0a — Effect-native sandbox cutover** — vendoring `effect` host-pinned via
  `sandbox-runtime/dependencies.ts` and the import map; converting every sandbox manifest, script,
  and host wire contract from Zod to Effect Schema; converting every script-facing host function,
  entrypoint, backend implementation, and typed bridge dispatch path to Effect; removing Zod and the
  raw Promise authoring API from the sandbox surface; migrating all existing scripts and fixtures;
  and retaining Promise only inside private platform transport adapters: Decision 11 and plan
  Step 0a.
- **Step 0b — structured sandbox observability** — batch-first `log`/`span` Effect host
  functions, OTLP trace integration, execution bookkeeping, capability gating, and limits:
  plan Step 0b.
- **Step 1 — crons & boot** — the `crons` manifest section and the sibling `boot` manifest
  section (one-time-per-server-start dispatch, non-blocking, skipped when background jobs are
  disabled), scheduler/dispatcher execution through the durable queue machinery, the
  `upsertGlobalEntities` / `upsertGlobalRelationships` host functions (shapes
  `[IMPLEMENTER-DECIDES]`, semantics fixed, gated to system `cron`/`boot` executions), the
  trending-read-path note, and the migrate/delete/e2e lists (`triggerPluginCron` fixture
  exists for trending; exercises rely on boot dispatch): plan §1 and its 2026-07-26 amendment.
- **Step 2 — operations (invoke)** — the `operations` manifest section, the single generic
  `plugins.invoke` endpoint (validation, auth, dispatch, batch-first), the `[RECOMMENDED]`
  first-party recipe typing in `packages/plugin-kit`, the browser-extension migration, the internal
  `invokeOperation` scaffolding for `episode-resolver`, and the contract-group deletion:
  Decision 9 and plan §2.
- **Step 3 — durable workflows** — the **mandatory spike** protocol and findings-recording, the
  `workflows` manifest section, the `activity`/`sleep`/`child` primitives with deterministic
  child ids, journal keying + structured nondeterminism error, `contentHash` version pinning
  across hot swaps, the restricted determinism-safe SDK entry point enforced by capability
  scoping, the per-script-kind limit profile, the population/resolution migration, and the
  `EventCreateWorkflow` `[IMPLEMENTER-DECIDES]` (activity host op vs `child`): Decisions 7 and
  11, `apps/app-backend/AGENTS.md` §Queues, and plan §3.
- **Step 4 — integration adapters, import sources, and filesystem grants** — the lot-discriminated
  `integrationProviders` and the `importSources` manifest sections, `settingsSchema` as declarative
  `AppSchema` with `secret?: true` and redaction on read, the single registry-driven import dispatch
  path, the deny-by-default filesystem grants (`artifact-read` / `scratch`) implemented next to
  `runtime.ts`'s flag assembly with the dedicated-process `[RECOMMENDED]` and the 5 MiB
  post-execution quota, the scratch-dir chunk-harvest transport, the four **withdrawn** host
  functions, the three approved deps, the credential scoping, the `createProgressResult`
  preservation, the `episodeLocator` → `subjectEntityId` change, and the per-plugin migrate/delete
  lists leaving the frameworks: Decisions 10 and 14 and plan §4. Every question in that section is
  settled (owner, 2026-07-27); nothing is left to decide.
- **Step 5 — `media-monitoring` + remaining media logic** — the composition approach (cron +
  pushdown + signals + step-3 workflows), the user-facing surface becoming step-2 operations,
  the leftover-reference cleanup in `signals`/`events`/`entity-interest`, and the
  no-media/fitness-module done criterion: Decision 14 and plan §5.
- **Phase gate** — all step gates plus the kernel media/fitness-vocabulary grep with every hit
  triaged (deleted, generalized, or justified in the plan file): plan "Phase gate".
- **Cross-cutting rules** — kernel purity (Decision 2), sandbox-only runtime with boot-vs-install
  as the only first/third-party difference (Decision 3), file access via Deno permission grants
  not IPC (Decision 10), Effect-only sandbox authoring and typed bridge APIs (Decision 11),
  source-canonical content-addressed ingestion and workflow pinning (Decision 12), hot-load
  semantics (Decision 13), integration adapters into plugins with the framework kept in kernel (Decision 14), and
  the module conventions in `apps/app-backend/AGENTS.md` (Effect services, thin routes,
  repository-owned writes, no transaction across a sandbox execution): overview decision record
  and cross-phase invariants.

Follow the plan markers when a section leaves room: `[DECIDED]` is fixed, `[RECOMMENDED]` is
the default (deviate only with concrete evidence, and record it in the plan), and
`[IMPLEMENTER-DECIDES]` is yours to settle and record. If implementation uncovers evidence that
a `[DECIDED]` item is wrong, **stop and surface it** rather than silently deviating.

## Testing Decisions

- **Current verification:** the system-query suite passes 1 file and 9 tests covering 11 cases; the
  media-monitoring suites pass 4 files and 13 tests; combined they pass 5 files and 22 tests. Backend
  unit tests pass 131 files and 931 tests, media-plugin tests pass 92 files and 351 tests, and the
  backend, app-client, and media-plugin checks pass with zero warnings. The standard e2e suite passes
  all 79 files and 501 tests, and the opt-in two-concurrent-1,001-item operational gate passes at its
  unchanged workload and 15-minute budget.
- **What a good test is here:** the e2e suite (`tests/`) is the behavioral spec (Decision 16),
  and this phase migrates it in lockstep with each capability — plumbing changes (native
  modules become plugin scripts, contract endpoints become `invoke`, ids/fixtures shift), but
  **what is asserted stays the same**. A behavioral change requires explicit owner sign-off,
  not a quiet test edit (cross-phase invariant 2). Test app-owned behavior and branching, not
  library behavior, per `AGENTS.md`.
- **Suites re-pointed per step (assertions preserved):** step 1 re-points
  `tests/src/tests/plugins/fitness/exercises.test.ts` (seeded through boot dispatch at backend startup, no manual
  trigger) and the trending coverage (the `triggerPluginCron` fixture already exists); step
  2 re-points the metadata-lookup / browser-extension integration tests
  to `invoke`; step 3 re-points `tests/src/tests/kernel/entity-import/entity-import.test.ts` and
  `tests/src/tests/kernel/imports/imports.test.ts`; step 4 splits integration coverage between
  `tests/src/tests/kernel/integrations/integrations.test.ts` and
  `tests/src/tests/plugins/media/integrations/integrations.test.ts`, moves OpenScale and Hevy to
  `tests/src/tests/plugins/fitness/imports/imports.test.ts`, and moves Watcharr to
  `tests/src/tests/plugins/media/imports/imports.test.ts` — and moves the far larger body of per-adapter unit tests out of
  `apps/app-backend` into the plugin packages, assertions intact; step 5 re-points the four
  `media-monitoring/` suites
  (association detectors and cron-refresh coverage) — these are the acceptance test that the
  syscall surface is sufficient, since they exercise nearly every capability at once (plan
  §1–§5).
- **Step 0 cutover coverage:** type-level tests reject Promise-returning host functions and
  entrypoints; runtime tests execute every existing media, fitness, and kernel source-zero script
  through the Effect-native runner; dependency tests prove Effect is import-map-resolved and not
  bundled per script; observability tests cover bridge validation, OTLP emission, bookkeeping,
  capability gating, and limits.
- **New kernel tests this phase owns:** the `plugins.invoke` endpoint (schema validation, auth,
  unknown operation) at step 2 (plan §2 done); and the **replay-determinism tests** at step 3 —
  induced suspend/replay, nondeterminism detection, and **module pinning across a hot swap**,
  the last of which the plan calls "one of the most important tests in the repo" (plan §3).
- **The step-3 spike is a prerequisite, not a shipped test:** it is a throwaway used to surface
  serialization/timeout/replay-ordering risk before the real machinery is built; its findings
  are recorded in the plan file (plan §3).
- **Behavior that must stay green:** the media lifecycle and integration progress-policy
  automations (preserve `createProgressResult` / `occurredAt` semantics — plan §4), the
  keying/idempotency semantics of the migrated import workflows (ensure-mode, preserve-existing
  upserts — plan §3), and the full e2e suite at the phase end with the `media-monitoring` suites
  passing with assertions unchanged (plan §5 done).
- **Prior art:** the existing host functions and the `bridge-adapter.ts` contract-scope
  split (automation vs provider) are the pattern for the new host functions and the workflow
  determinism scoping; the `installTestPlugin` fixture and real loader from Phase 2 are how
  every migrated capability is exercised through a real plugin; conventions live in
  `tests/AGENTS.md` (update it where conventions change). Run e2e and backend tests from their
  own app directories per `AGENTS.md`.
- **The gate** (cross-phase invariant 1), enforced after **every step**:
  `bun turbo --filter=@ryot/app-backend check` plus backend unit tests
  (`cd apps/app-backend && bun run test`), the full e2e suite (`cd tests && bun run test`,
  minus suites deleted with their surface), and the `app-client` check all pass.

## Out of Scope

- **Everything Phase 4 hardens:** purity _enforcement_ (this phase reaches purity and does an
  informal grep at the gate, but the automated check is Phase 4), performance work, sandbox
  limits/quota hardening beyond the per-script-kind profile step 3 needs, plugin GC, and the
  test-tree reorganization (`00-overview.md` phase table; plan phase gate calls the grep an
  "informal preview of Phase 4's enforced check").
- **New capabilities beyond what a step consumes** (cross-phase invariant 3 — syscalls are
  pulled, not pushed): no host function, manifest field, or kernel capability is built ahead of
  the step that needs it; no speculative manifest sections.
- **Re-doing Phase 2 work:** the plugin format, ingestion pipeline, loader, hot-load, package
  restructuring, the admin `plugins` install surface, and the push-target binding declarations
  already exist and are not rebuilt here (`00-overview.md` phase table; plan §4 note on push
  targets).
- **The frontend `app-client`'s own features:** the client is exempt from kernel purity and may
  key off well-known schema slugs (Decision 2); this phase only touches it (and the browser
  extension) where a consumed endpoint moves to `invoke` (plan §2).
- **The YAGNI non-goals through Phase 4:** no plugin-dependency resolution, marketplace/signing,
  user-level installation, or speculative Phase 5 manifest fields (cross-phase invariant 5).
- `apps/app-client-backup` (retained as a reference; deletion explicitly deferred) and the legacy
  `apps/backend`/`apps/frontend` system (untouched by this plan; Decision 17).

## Further Notes

- **No deployment constraints.** All work is local on the `ultra-rewrite` branch; there is no
  CI, `apps/app-backend` is not deployed, dev databases are wipeable, and the single initial
  drizzle migration may be regenerated freely — so any storage change a step needs is done by
  regenerating the migration, not by authoring ALTERs (`00-overview.md` status line).
- **The plans are living documents during implementation.** Record `[RECOMMENDED]` deviations and
  `[IMPLEMENTER-DECIDES]` choices by editing the relevant plan file, not this PRD. Steps 0–4 have no
  open markers left: the global-write host-function shapes, the recipe typing wrapper, the
  `EventCreateWorkflow` composition mechanism, the step-3 spike findings, and every Step 4 question
  (manifest section shapes, `secret` and redaction, grants and quota, the chunk-harvest transport,
  the withdrawn syscalls, `subjectEntityId`, and the plugin split) are all recorded as settled in
  `03-phase-3-capability-migrations.md`.
- **Strict ordering is load-bearing.** Step 0a, Step 0b, and Steps 1–5 run in order and one
  capability is in flight at a time; step 3's mandatory spike gated step 3's real implementation,
  and Step 4's own four tasks (07–10) are internally ordered with gates between them
  (`00-overview.md` phase ordering; cross-phase invariant 4; plan §3, §4).
- **Pattern discovery before writing.** Per `AGENTS.md`, launch an `explore` subagent to find
  existing patterns to replicate — the existing host-function contract/validation/implementation
  triplet, the sandbox-runtime host-call bridge and flag assembly in `runtime.ts`, the existing
   Effect durable workflow machinery, the scheduler module, the `getCurrentIntegration` credential path,
  and the Phase 2 loader/fixture — before writing new code; `explore` is for discovery only.
- **Task 12 is the mandatory final cleanup task** (following the `codebase-cleanup` skill): a
  final pass over the touched files and directly affected modules to remove dead, duplicated, or
  leftover code, notably residue of the five deleted native domain modules, the deleted adapters and
  import orchestration split, the temporary step-2 `invokeOperation` scaffolding, or Promise-based
  sandbox compatibility aliases.
