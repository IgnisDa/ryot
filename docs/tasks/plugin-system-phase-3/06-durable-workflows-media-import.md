# Step 3b — Durable Workflows: media import population/resolution

**Parent Plan:** [Plugin System — Phase 3: Capability Migrations](./README.md)

**Type:** AFK

**Status:** done

## What to build

Before starting, read `docs/plans/plugin-system/00-overview.md` in full and then
`docs/plans/plugin-system/03-phase-3-capability-migrations.md` in full. Do not begin until the
Step 3a spike (task 05) is done and its findings/design are signed off. This slice builds the
real durable-workflow machinery per plan §3 (as adjusted by the recorded spike findings) and
migrates the media import workflows.

Kernel capability (lands before consumers):

- Add the `workflows: [{ slug, scriptSlug }]` manifest section. The kernel's existing Effect
  durable engine runs a _workflow shell_ whose body repeatedly executes the script (replay from
  the top on each resume).
- Replay-deterministic host primitives: `activity(name, scriptRef, input)` (first call runs the
  referenced direct activity script as a normal sandbox execution and journals the result; replays
  return the journal without re-execution), `sleep(name, duration)` (durable timer), and
  `child(name, workflowRef, input)` (composes another manifest workflow with a **deterministic
  execution id** derived from parent id + name — preserving the `apps/app-backend/AGENTS.md`
  §Queues deterministic-child-id rule). The journal is keyed by call sequence + name; a
  divergent replay fails with a structured nondeterminism error.
- Version pinning: an execution records the script row's `contentHash` at start and every replay
  loads exactly that module (a lookup given Phase 2's immutable-per-hash rows); a hot swap never
  changes a running execution's code (Decisions 7, 13).
- Determinism guard rails: workflow scripts use a restricted SDK entry point (no `httpCall`, no
  cache, no ambient time/random — activities do the IO), enforced by capability scoping on the
  manifest kind, mirroring the existing automation-vs-provider host-scope split in
  `bridge-adapter.ts`.
- Limits: add a per-script-kind budget profile so workflow/activity kinds get kernel-owned
  ceilings distinct from provider kinds.

Migration: rewrite `imports/media/population-workflow.ts` and `resolution-workflow.ts` (plus the
media-specific parts of `entities/population-trigger.ts` and `entity-import`) as media-plugin
workflows + activities; the kernel `imports` framework (run tracking, file handling) and
`entity-import`'s generic surface stay. Preserve the documented keying/idempotency semantics
(ensure-mode, preserve-existing upserts), logical provider provenance, and provider-scoped cache
identity. Resolve every provider operation to an exact script before execution; workflow and
activity payloads must not carry runtime operation selectors. Keep `EventCreateWorkflow` a kernel-owned workflow,
callable as an activity host op or composed via `child` (`[IMPLEMENTER-DECIDES]` — record the
choice), keeping single durable ownership intact. Delete the media-specific workflow definitions
from `imports/`.

See the parent PRD "Step 3 — durable workflows" user stories and the Implementation Decisions
"Step 3" pointer for the full spec.

Suggested sequence

1. Kernel slice first, with the bulk journal read from day one. The workflows manifest section, the workflow script kind, the journal host function. Do not build the per-entry read and optimize later — the spike already measured per-entry as inadequate (~5 ms per entry, ~1 s of overhead at 200 steps). Build the shape the plan records.
2. Pinning, the resolveSandboxExecutionPayload mode change, and the kernel-side capability gate. All three are small, all three are load-bearing, and the capability gate is a genuine hole today (a capability outside the two known sets is granted to any script that declares it). Cheap now, annoying later.
3. child early, not last. It's the only primitive neither spike exercised, and it's on the critical path because EventCreateWorkflow composition depends on it — that's step 3 of the import example. If child has a surprise in it, you want to know in week one.
4. The determinism tests as the kernel slice lands. Induced replay, nondeterminism detection, and pinning across a hot swap — the plan calls the last one "one of the most important tests in the repo". The stashed spike has all three working; stash@{0} is worth reading as a reference (not building on).
5. Load-test at realistic scale before deleting the native modules. This is the sequencing point that matters most. Task 06's done criterion is "native code deleted + suite green," so deletion is the point of no return. Run a 200+ step import and ~10 concurrent imports while the old path still exists. If the quadratic bookkeeping re-reads bite, you want the fallback intact.
6. Then migrate population/resolution and delete.

## Acceptance criteria

Derived from the plan §3 done criteria and cross-phase invariants:

- [x] `workflows` manifest section exists; `activity`/`sleep`/`child` primitives work with
      deterministic child ids, journal-by-sequence+name, and a structured nondeterminism error
      on divergent replay
- [x] An execution pins its script `contentHash` at start and every replay loads exactly that
      module; a hot swap does not change a running execution's code
- [x] Workflow scripts run on the restricted determinism-safe SDK entry point enforced by
      capability scoping; workflow/activity kinds have their own kernel-owned limit profile
- [x] Media import population/resolution run as plugin workflows end-to-end; the media-specific
      workflow definitions are deleted while the kernel `imports`/`entity-import` frameworks stay;
      keying/idempotency semantics, logical provider provenance, and provider-scoped caches are
      preserved; execution payloads contain exact script IDs and no operation selector
- [x] Kernel tests cover replay determinism: induced suspend/replay, nondeterminism detection,
      and **module pinning across a hot swap** (the plan calls this one of the most important
      tests in the repo); import e2e suites re-pointed with assertions preserved
- [x] The branch stays shippable: backend `check` + unit tests, the full e2e suite, and the
      `app-client` check all pass (cross-phase invariant 1)

## User stories addressed

- User story 18
- User story 19
- User story 20
- User story 21
- User story 22
- User story 23
- User story 24
- User story 25
- User story 37
- User story 38
- User story 39
