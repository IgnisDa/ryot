# Plugin System — Phase 3: Capability Migrations

This PRD is a thin framing layer. **The authoritative technical spec is the two plan
files**, which this document references rather than restates:

- `docs/plans/plugin-system/00-overview.md` — the vision, the 20-item decision record, the
  verified current-state map, the target architecture, and the cross-phase invariants that
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

**Overall Progress:** 0 of 9 tasks completed

**Current Task:** [Task 01](./01-effect-native-sandbox-cutover.md) (todo)

### Task List

| #   | Task                                                                                                        | Type | Status |
| --- | ----------------------------------------------------------------------------------------------------------- | ---- | ------ |
| 01  | [Step 0a — Effect-Native Sandbox Cutover](./01-effect-native-sandbox-cutover.md)                           | AFK  | todo   |
| 02  | [Step 0b — Structured Sandbox Observability](./02-structured-sandbox-observability.md)                     | AFK  | todo   |
| 03  | [Step 1 — Crons: media-trending + exercises](./03-crons-trending-exercises.md)                              | AFK  | todo   |
| 04  | [Step 2 — Operations/invoke: metadata-lookup + episode-resolver](./04-operations-invoke-lookup-resolver.md) | AFK  | todo   |
| 05  | [Step 3a — Durable Workflow Spike](./05-durable-workflow-spike.md)                                          | HITL | todo   |
| 06  | [Step 3b — Durable Workflows: media import population/resolution](./06-durable-workflows-media-import.md)   | AFK  | todo   |
| 07  | [Step 4 — Integration + Import-Source Adapters + FS Grants](./07-integration-import-adapters.md)            | AFK  | todo   |
| 08  | [Step 5 — media-monitoring + Remaining Media Logic + Phase Gate](./08-media-monitoring-and-phase-gate.md)   | AFK  | todo   |
| 09  | [Codebase Cleanup](./09-codebase-cleanup.md)                                                                | AFK  | todo   |

Steps are strictly ordered (`00-overview.md` phase ordering; plan intro): each task starts only
after the previous task's done criteria and gates pass (one capability in flight at a time,
cross-phase invariant 4). Tasks 01 and 02 are ordered Step 0 prerequisites. Task 05 (the
mandatory spike, HITL) gates task 06: its
recorded findings and owner sign-off must land before the real workflow machinery is built.

## Problem Statement

After Phase 2, the plugin format, ingestion pipeline, and hot-capable loader exist, and
everything that was **already declarative or sandboxed** (schemas, providers, automations,
bindings, saved views) ships as the `plugins/media` and `plugins/fitness` packages. But the
actual domain _logic_ still lives in the kernel: five native modules (`media-trending`,
`media-monitoring`, `episode-resolver`, `metadata-lookup`, `exercises`) plus the media import
population/resolution workflows and the integration sink/yank + import-source adapters are
still TypeScript inside `apps/app-backend/src/modules/`, reading from the registry. Until this
code moves into the plugins, the kernel-purity goal (Decision 2 — no media/fitness strings,
branches, or imports) is unmet, "first-party plugin" is only half true (definitions ship as a
plugin but behavior does not), and the syscall surface between kernel and plugins is unproven
against real workloads.

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

The steps, in order: **Step 0a** atomically cuts scripts, drivers, backend host implementations,
and typed bridge dispatch over to an Effect-only API with no raw Promise compatibility surface.
**Step 0b** independently adds structured, batch-first `log`/`span` host functions. **Step 1**
adds the `crons` manifest section and global-write host functions, moving `media-trending` and
`exercises` to cron-driven scripts. **Step 2** adds the `operations` manifest section and the single generic
`plugins.invoke` contract endpoint, moving `metadata-lookup` and `episode-resolver` to plugin
operations and migrating the browser extension to invoke. **Step 3** — gated behind a
**mandatory throwaway spike** — builds the replay-deterministic durable-workflow primitives
(`activity`/`sleep`/`child`, version pinning, determinism guard rails, per-driver-kind limits)
and moves the media import population/resolution workflows into the media plugin. **Step 4**
adds integration-provider registration and deny-by-default filesystem permission grants (with
`fflate` as an approved dep), moving the yank/sink/push and import-source adapters into the
plugin while the kernel keeps the integrations and imports _frameworks_. **Step 5** is
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
automation / cron / operation / workflow / adapter drivers), **scheduler** (kernel component
firing cron ticks), **durable engine** (kernel component running workflow shells), **API
client** (`app-client`), **browser extension** (`apps/browser-extension`, the sole external
metadata-lookup consumer), **admin/end user** (invokes operations, configures integrations),
and **implementing agent**.

### Step 0 — sandbox authoring upgrades

1. As a sandbox script author, I want `effect` vendored as a host-pinned approved sandbox
   dependency (single version matching the host, never bundled per script), so that scripts
   carrying substantial logic can use Effect the same way the host does (Decision 11; plan §0).
2. As a sandbox script author, I want every host function and driver to use typed `Effect`
   values exclusively and every sandbox manifest, driver, host wire contract, and operation
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

5. As the owner, I want a `crons` manifest section (`{ slug, schedule, driverRef,
description }`) whose schedule format is whatever the existing scheduler consumes, so that a
   plugin declares periodic work without the kernel knowing what the work is (plan §1).
6. As the scheduler, I want each due cron dispatched as a sandbox execution of its referenced
   driver, fire-and-forget through the durable queue machinery per the `apps/app-backend`
   durable-ownership rules with idempotency owned by the script, so that the kernel owns the
   tick and the plugin owns the behavior (plan §1).
7. As a sandbox script, I want batch, coarse-atomic global-write host functions
   `upsertGlobalEntities(items[])` and `upsertGlobalRelationships(items[])` with
   preserve-existing semantics matching today's trending refresh writes, so that a cron driver
   can write global trending data (shapes `[IMPLEMENTER-DECIDES]`, semantics fixed; plan §1;
   Decision 8).
8. As the kernel, I want those global-write functions capability-gated in the driver manifest,
   so that a future untrusted provider script cannot write global data by default (plan §1).
9. As the owner, I want `media-trending` (poll providers → write trending globals + refresh
   workflow + infrequent task) and `exercises` (free-exercise-db preload) rewritten as
   cron-driven plugin scripts and the native modules deleted (with any contract surface),
   so that both capabilities run entirely inside their plugins (Decision 14; plan §1).
10. As the implementing agent, I want the trending _read_ path to stay query-engine-based
    (moving any residual native read code to a saved view / recipe, or deferring to step 2's
    operations), so that migrating the write path does not strand a native read path (plan §1).

### Step 2 — operations (invoke): `metadata-lookup` + `episode-resolver`

11. As the owner, I want an `operations` manifest section (`{ slug, driverRef, inputSchema,
    outputSchema, auth }`, `auth` = authenticated-user vs admin, schemas in the SDK's Effect
    Schema contract style), so that a plugin declares named callable operations (plan §2).
12. As an API client, I want a single generic `plugins.invoke(pluginSlug, operationSlug,
payload)` contract endpoint that validates against the declared schemas, dispatches to the
    driver, and returns the result — batch-first payloads — so that the static typed contract
    never grows plugin-specific endpoints (Decision 9; plan §2).
13. As a first-party client, I want the plugin package to export its operation input/output
    types and a small typed `invoke` wrapper in `libs/plugin-kit` ("recipes"), so that
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
18. As the owner, I want a `workflows` manifest section (`{ slug, driverRef }`), so that a
    plugin declares durable workflows the kernel's existing Effect workflow engine runs as a
    workflow shell (plan §3; Decision 7).
19. As a workflow script, I want replay-deterministic host primitives — `activity(name,
input)` (runs once, journals the result, replays return the journal), `sleep(name,
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
22. As the kernel, I want workflow drivers restricted to a determinism-safe SDK entry point (no
    `httpCall`, no cache, no ambient time/random — activities do the IO), enforced by
    capability scoping on the manifest kind mirroring how automation vs provider host scopes
    already differ, so that workflow bodies cannot introduce nondeterminism footguns (Decision
    11; plan §3).
23. As the kernel, I want workflow/activity driver kinds to get their own kernel-owned limit
    profile (a batch activity legitimately makes more host calls than a provider search), so
    that per-driver-kind budgets fit the workload (plan §3).
24. As the owner, I want `imports/media/population-workflow.ts` and `resolution-workflow.ts`
    (plus the media-specific parts of the population trigger and `entity-import`) rewritten as
    media-plugin workflows + activities and the media-specific workflow definitions deleted,
    while the kernel `imports` framework and `entity-import`'s generic surface stay, so that
    import orchestration runs as a plugin workflow (Decision 14; plan §3).
25. As the owner, I want the documented keying/idempotency semantics preserved (ensure-mode,
    preserve-existing upserts) and `EventCreateWorkflow` kept as a kernel-owned workflow —
    callable as an activity host op or composed via `child` (`[IMPLEMENTER-DECIDES]`) — so that
    single durable ownership stays intact (plan §3).

### Step 4 — integration + import-source adapters

26. As the owner, I want the integration-registration manifest section extended so a plugin
    declares integration _providers_ (`{ slug, lot: yank|sink|push, driverRef, settingsSchema
}`), with the kernel integrations framework (credential storage, enable/disable,
    auto-disable, run bookkeeping) serving them generically and listing available providers
    from the registry, so that provider registration is declarative (Decision 14; plan §4).
27. As the kernel, I want deny-by-default filesystem permission grants: I materialize an
    uploaded/fetched artifact to a path and spawn the execution with `--allow-read` on it plus
    a quota'd, kernel-cleaned per-execution scratch dir with `--allow-write`, with grants
    declared per driver kind in the manifest (`capabilities: ["artifact-read", "scratch"]`), so
    that large artifacts flow via Deno permission grants rather than IPC (Decision 10; plan §4).
28. As the implementing agent, I want grant-carrying executions to run on a dedicated
    (non-pooled) process since pooled processes are pre-warmed before the execution is known,
    measuring before optimizing, so that per-execution grants are honored without prematurely
    reworking the pool (`[RECOMMENDED]`; plan §4).
29. As a sandbox script author, I want `fflate` added as an approved sandbox dependency, so that
    zip parsing (CPU-bound work) happens inside the sandbox rather than as a host function
    (Decision 10; plan §4).
30. As the owner, I want the sink normalization + yank connectors + import-source adapters moved
    into media-plugin scripts (bounded network via `httpCall` with integration credentials
    through the existing `getIntegration`, with credential exposure audited to stay scoped to
    the integration being executed) and the native provider-specific code deleted from
    `modules/integrations` and `modules/imports`, leaving the frameworks, so that the kernel
    integrations/imports modules contain zero provider-specific code (Decision 14; plan §4).
31. As the kernel, I want `createProgressResult` semantics preserved (`occurredAt` always set),
    so that the progress-policy automation keeps working (plan §4).
32. As the owner, I want push targets (radarr/sonarr/jellyfin) — already sandbox trigger
    scripts whose binding declarations moved in Phase 2 — to need no further migration here, so
    that step 4 does not redo Phase 2 work (plan §4).

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
    pattern (`libs/sandbox-sdk` contract + `bridge-adapter.ts` validation +
    `host-functions.ts` implementation + limits entry) and carry a span, so that new syscalls
    are consistent with the existing 16 and observable (plan standing rules).
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
  never explicable by one plugin, the existing contract pattern (`libs/sandbox-sdk` +
  `bridge-adapter.ts` + `host-functions.ts` + limits), and per-call observability: Decision 8
  and plan "Standing rules".
- **Step 0a — Effect-native sandbox cutover** — vendoring `effect` host-pinned via
  `sandbox-runtime/dependencies.ts` and the import map; converting every sandbox manifest, driver,
  and host wire contract from Zod to Effect Schema; converting every script-facing host function,
  driver, backend implementation, and typed bridge dispatch path to Effect; removing Zod and the
  raw Promise authoring API from the sandbox surface; migrating all existing scripts and fixtures;
  and retaining Promise only inside private platform transport adapters: Decision 11 and plan
  Step 0a.
- **Step 0b — structured sandbox observability** — batch-first `log`/`span` Effect host
  functions, OTLP trace integration, execution bookkeeping, capability gating, and limits:
  plan Step 0b.
- **Step 1 — crons** — the `crons` manifest section, scheduler dispatch through the durable
  queue machinery, the `upsertGlobalEntities` / `upsertGlobalRelationships` host functions
  (shapes `[IMPLEMENTER-DECIDES]`, semantics fixed, capability-gated), the trending-read-path
  note, and the migrate/delete/e2e lists (`triggerInfrequentCron` fixture exists): plan §1.
- **Step 2 — operations (invoke)** — the `operations` manifest section, the single generic
  `plugins.invoke` endpoint (validation, auth, dispatch, batch-first), the `[RECOMMENDED]`
  first-party recipe typing in `libs/plugin-kit`, the browser-extension migration, the internal
  `invokeOperation` scaffolding for `episode-resolver`, and the contract-group deletion:
  Decision 9 and plan §2.
- **Step 3 — durable workflows** — the **mandatory spike** protocol and findings-recording, the
  `workflows` manifest section, the `activity`/`sleep`/`child` primitives with deterministic
  child ids, journal keying + structured nondeterminism error, `contentHash` version pinning
  across hot swaps, the restricted determinism-safe SDK entry point enforced by capability
  scoping, the per-driver-kind limit profile, the population/resolution migration, and the
  `EventCreateWorkflow` `[IMPLEMENTER-DECIDES]` (activity host op vs `child`): Decisions 7 and
  11, `apps/app-backend/AGENTS.md` §Queues, and plan §3.
- **Step 4 — integration + import-source adapters** — the integration-provider manifest
  registration, the deny-by-default filesystem grants (`artifact-read` / `scratch`) implemented
  next to `runtime.ts`'s flag assembly, the dedicated-process `[RECOMMENDED]` for grant-carrying
  executions, `fflate` as an approved dep, the credential-scope audit, the `createProgressResult`
  preservation, and the migrate/delete lists leaving the frameworks: Decisions 10 and 14 and
  plan §4.
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

- **What a good test is here:** the e2e suite (`tests/`) is the behavioral spec (Decision 16),
  and this phase migrates it in lockstep with each capability — plumbing changes (native
  modules become plugin scripts, contract endpoints become `invoke`, ids/fixtures shift), but
  **what is asserted stays the same**. A behavioral change requires explicit owner sign-off,
  not a quiet test edit (cross-phase invariant 2). Test app-owned behavior and branching, not
  library behavior, per `AGENTS.md`.
- **Suites re-pointed per step (assertions preserved):** step 1 re-points
  `tests/src/tests/exercises/` and the trending coverage (the `triggerInfrequentCron` fixture
  already exists); step 2 re-points the metadata-lookup / browser-extension integration tests
  to `invoke`; step 3 re-points the `entity-import` / `imports` suites; step 4 re-points the
  `integrations/` and `imports/` suites; step 5 re-points the four `media-monitoring/` suites
  (association detectors and cron-refresh coverage) — these are the acceptance test that the
  syscall surface is sufficient, since they exercise nearly every capability at once (plan
  §1–§5).
- **Step 0 cutover coverage:** type-level tests reject Promise-returning host functions and
  drivers; runtime tests execute every existing media, fitness, and kernel source-zero script
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
- **Prior art:** the existing 16 host functions and the `bridge-adapter.ts` contract-scope
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
  limits/quota hardening beyond the per-driver-kind profile step 3 needs, plugin GC, and the
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
- **The general YAGNI non-goals of the whole plan:** no plugin-dependency resolution, no plugin
  marketplace/signing, no public (non-admin) install endpoint, no speculative manifest fields
  (cross-phase invariant 5).
- `apps/app-client-backup` (slated for removal — ignore entirely) and the legacy
  `apps/backend`/`apps/frontend` system (untouched by this plan; Decision 17).

## Further Notes

- **No deployment constraints.** All work is local on the `ultra-rewrite` branch; there is no
  CI, `apps/app-backend` is not deployed, dev databases are wipeable, and the single initial
  drizzle migration may be regenerated freely — so any storage change a step needs is done by
  regenerating the migration, not by authoring ALTERs (`00-overview.md` status line).
- **The plans are living documents during implementation.** Record `[RECOMMENDED]` deviations
  and `[IMPLEMENTER-DECIDES]` choices (the global-write host-function shapes, the recipe typing
  wrapper, the `EventCreateWorkflow` composition mechanism, the dedicated-process decision for
  grants) — and the **step-3 spike findings** — by editing the relevant plan file, not this PRD.
- **Strict ordering is load-bearing.** Step 0a, Step 0b, and Steps 1–5 run in order and one
  capability is in flight at a time; step 3's mandatory spike gates step 3's real implementation
  (`00-overview.md` phase ordering; cross-phase invariant 4; plan §3).
- **Pattern discovery before writing.** Per `AGENTS.md`, launch an `explore` subagent to find
  existing patterns to replicate — the existing host-function contract/validation/implementation
  triplet, the sandbox-runtime host-call bridge and flag assembly in `runtime.ts`, the existing
  Effect durable workflow machinery, the scheduler module, the `getIntegration` credential path,
  and the Phase 2 loader/fixture — before writing new code; `explore` is for discovery only.
- **Task 09 is the mandatory final cleanup task** (following the `codebase-cleanup` skill): a
  final pass over the touched files and directly affected modules to remove dead, duplicated, or
  leftover code, notably residue of the five deleted native domain modules, the temporary step-2
  `invokeOperation` scaffolding, or Promise-based sandbox compatibility aliases.
