# Phase 1 - Universal Replayable Sandbox Runtime

Status: planned.

Goal: every sandbox body executes as one replayable durable workflow. Every business host call is a
typed durable request; completed calls never repeat during ordinary replay, write operations are
safe at their retry boundaries, and no sandbox process remains alive across suspension. All current
scripts and E2E fixtures migrate, infrastructure-only activity wrappers are removed, and the
standard execution path is deleted before the phase is complete.

Explicitly not in this phase: provider rate-limit declarations, Redis admission state, durable
rate-limit sleeps, `Retry-After` retries, fairness, or adaptive provider headers. Durable HTTP runs
immediately in this phase. Phase 2 owns admission without changing the script API.

Read `00-overview.md` first. Every item in its decision record and cross-phase invariants applies.

## 0. Performance Baseline and Guardrail

Before changing execution semantics, add a repeatable benchmark harness and record the current
runtime on the same machine/configuration that will run the tracer comparison. Use warm backend and
sandbox pools, hermetic fixed-latency HTTP, and enough repeated batches to report stable median p50
and p95 rather than relying on one timing.

Baseline these representative paths:

1. A no-host-call automation, including an early return such as
   `auto-complete-on-full-progress` when its trigger does not apply.
2. The full branch of a small automation that performs mutable reads and one write.
3. A provider operation with one or two HTTP calls against a controlled endpoint.
4. A Youtubei operation with multiple sequential internal HTTP calls.
5. One bounded import/population chunk containing queries, provider work, and writes.
6. The existing production-size media population operational gate.

Record for each applicable workload:

- submission-to-terminal p50 and p95;
- measured Ryot orchestration time with controlled upstream delay reported separately;
- sandbox process executions, body replays, and module loads;
- workflow-engine activity/child and Redis round trips;
- records/items processed per second for import/population;
- benchmark machine/configuration, sample count, and warm-up procedure.

Run the identical harness after both tracers work but before migrating the rest of the catalog. The
initial intentionally permissive review guardrails are:

- a no-host-call path triggers review only when p95 is both greater than `2x` baseline and more than
  `250 ms` slower;
- an interactive provider path triggers review only when p95 is both greater than `3x` baseline and
  more than `1 second` slower;
- bounded import/population triggers review when throughput falls below `50%` of baseline;
- any unexplained sandbox replay or workflow/Redis round-trip growth beyond the number implied by
  sequential durable boundaries triggers review regardless of wall-clock timing.

These are review thresholds, not flaky per-test assertions. If a tracer exceeds one, stop catalog
migration, profile it, and optimize batching, unnecessary durable boundaries, projection transport,
module loading, or child-workflow chunking. Re-run the harness after each material optimization.
Only reconsider a standard-script fast path if those measures fail and the owner explicitly changes
Decision 1. The owner may accept a measured miss; record the result and rationale in this section
before proceeding.

### Current-runtime baseline (2026-08-06)

Run the warm hermetic harness with:

```bash
RUN_SANDBOX_BENCHMARKS=1 bun turbo --env-mode=loose --force --output-logs=full --filter=@ryot/tests test --only -- 'src/tests/kernel/sandbox/sandbox-runtime-benchmark.test.ts'
```

The measured host was an Apple M4 (`arm64`, 10 logical CPUs, 16 GiB RAM) on macOS 26.3.1, using
Bun 1.3.14 and Deno 2.8.1. The standard test backend and sandbox pools were warmed by three discarded
runs before 15 measured runs of each direct workload. The bounded population used one discarded run
before five measured 10-item chunks. Tests ran as one isolated Vitest file against the standard
shared-backend configuration. The controlled HTTP endpoint was loopback-only and added exactly 25 ms
per request; provider and Youtubei workloads each made two sequential requests, so orchestration
subtracts 50 ms of known upstream delay.

| Workload                                                        | Submission-to-terminal p50 / p95 | Ryot orchestration p50 / p95 | Sandbox execution p50 / p95 | Executions / body replays / module loads | Workflow / Redis observation                           |                           Throughput |
| --------------------------------------------------------------- | -------------------------------: | ---------------------------: | --------------------------: | ---------------------------------------: | ------------------------------------------------------ | -----------------------------------: |
| No-host automation early return                                 |                     221 / 266 ms |                 221 / 266 ms |                   8 / 11 ms |                                1 / 1 / 1 | 0 journal projections; high-water 0                    |                                  n/a |
| Full automation, one mutable read and one cache write           |                     229 / 251 ms |                 229 / 251 ms |                  17 / 21 ms |                                1 / 1 / 1 | 0 journal projections; high-water 0                    |                                  n/a |
| Provider, two controlled HTTP calls                             |                     222 / 274 ms |                 172 / 224 ms |                  75 / 99 ms |                                1 / 1 / 1 | 0 journal projections; high-water 0                    |                                  n/a |
| Youtubei, local session plus two internal controlled HTTP calls |                     234 / 430 ms |                 184 / 380 ms |                105 / 115 ms |                                1 / 1 / 1 | 0 journal projections; high-water 0                    |                                  n/a |
| Bounded 10-item media population chunk                          |                 6,563 / 6,855 ms |             6,563 / 6,855 ms |         n/a (21 executions) |                             21 / 21 / 21 | 1 projection key; maximum activity/child high-water 10 | 1.524 items/s p50; 1.580 items/s p95 |

The direct role workloads use the current standard body, so their business host calls create no
sandbox workflow journal entries. The current test-support surface exposes sandbox process totals,
Redis projection-key count, and maximum journal high-water, but not exact workflow-engine transport
or Redis command round trips. Exact transport counts are therefore recorded as unavailable rather
than adding production instrumentation during this evidence-only task. The available counters are
sufficient to compare process/replay/module-load growth and journal boundary growth after the
tracers; any changed transport shape must explain its implied round trips explicitly.

The production-size media population operational gate was not run for this baseline. The owner
waived it for Task 01 on 2026-08-06 because that existing test is known to time out for a separate
issue and no production behavior changed in this task. The runnable 10-item population benchmark
above covers query, provider, write, workflow, Redis, database, and sandbox paths without inheriting
that unrelated timeout. This waiver does not claim a production-size throughput result and does not
remove the final Phase 1 operational gate.

### Synthetic tracer comparison (2026-08-06)

Task 02 reran the same warm hermetic harness after adding the universal durable synthetic tracer. The
controlled endpoint still added two sequential 25-ms delays. Three warm-ups preceded 15 measured
runs on the same Apple M4, 16-GiB host and Bun 1.3.14 configuration used for the baseline.

| Workload                            | Submission-to-terminal p50 / p95 | Ryot orchestration p50 / p95 | Sandbox execution p50 / p95 | Executions / body replays / module loads | Workflow / Redis observation        |
| ----------------------------------- | -------------------------------: | ---------------------------: | --------------------------: | ---------------------------------------: | ----------------------------------- |
| Standard controlled HTTP provider   |                     253 / 471 ms |                 203 / 421 ms |                103 / 154 ms |                                1 / 1 / 1 | 0 projections; high-water 0         |
| Durable controlled HTTP provider    |                   858 / 1,352 ms |               808 / 1,302 ms |                         n/a |                                3 / 3 / 3 | 1 projection key; high-water 2      |

The durable p95 was `2.87x` and `881 ms` above its same-run standard comparator. The interactive
provider guardrail requires both greater than `3x` and more than `1 second`, so it did not trigger.
The three executions are the expected initial replay, replay after the first durable HTTP boundary,
and terminal replay after the second boundary. Catalog migration remains blocked until the Youtubei
tracer in Task 03 passes its replay and benchmark gates.

## 1. Establish the Two Tracers

Build the runtime against two deliberately small reference paths before migrating the catalog.

### Synthetic host-call tracer

Install a test plugin through the real plugin ingestion path whose body exercises, in deterministic
order and in a parallel batch where appropriate:

- configuration or preference read;
- `executeQueryEngine` mutable read;
- one idempotent service-backed write;
- one owning-workflow-backed write such as `createEvents`;
- immediate durable `httpCall` against a controlled endpoint;
- typed host failure caught in plugin code;
- immutable artifact read and durable chunk/artifact output;
- nested sandbox child workflow;
- diagnostics before and after suspension.

The tracer must be interruptible before dispatch, during durable execution, after side-effect
completion but before result observation, and before the next replay. Tests prove that completed
operations are not repeated and business writes are not duplicated.

### Youtubei tracer

Use the real `@ryot/sandbox-sdk/youtubei` export and the current plugin-owned injected fetch adapter
in `plugins/media/scripts/providers/youtube-music-shared.ts` as the starting point. As part of the
tracer, move that adapter behind the approved SDK export so its privileged Promise interop is owned
and audited by the SDK rather than exposed as ordinary plugin authoring code. Prove:

- deterministic time and seeded randomness recreate identical local session/request state;
- the client is reconstructed on every replay rather than serialized;
- an internal Promise-based fetch becomes a durable HTTP request;
- a caught temporary pending signal cannot turn the replay into a false success/failure;
- multiple sequential internal requests resume from recorded responses;
- a forced backend/sandbox interruption resumes successfully;
- dependency-local caches cannot affect request identity across replays.
- the SDK-owned adapter may internally use `Effect.runPromise`, while the replay-safe Effect surface
  exported to ordinary scripts does not expose runtime execution.

Do not migrate the rest of the catalog until both tracers establish stable patterns.
Do not migrate it until the tracer benchmark also passes the review above or has an explicit
recorded owner waiver.

## 2. Separate Contract Role from Execution

This section describes the Phase 1 target contract, not an instruction to break the catalog before
it migrates. Land the universal role/runtime shape additively for the tracers, migrate each catalog
slice, and remove that slice's activity/dispatch compatibility in the same task. Delete the final
temporary activity definitions and selectors only after no production or E2E source references
them. Temporary compatibility is internal to Phase 1 and is not a supported end state.

### SDK definitions

- Preserve role-specific definitions for providers, automations, operations, generic scripts, and
  named workflows.
- Make their `run` bodies use one workflow-capable host surface and one role-neutral execution
  metadata shape including persisted `startedAt`.
- Replace the current workflow-only host shape that exposes only `durableCalls` to authored code.
- Retire the activity definition kind as its catalog slices migrate. Convert reusable independently
  durable units to named child workflows; inline infrastructure-only wrappers.
- Keep named workflow input/output schemas and references for import, cron, and child composition.
- Keep one direct default entrypoint per compiled module and execution by exact script ID.

### Manifest contract

- Retire `activity` script declarations and activity-only reference validation after their final
  consumers migrate.
- Retire dispatch selectors such as cron `lot: "script" | "workflow"` after both branches start the
  same universal runtime.
- Let named workflows declare capabilities and call durable host methods directly.
- Retain provider association, provider operation, authority requirements, required config keys,
  and role-specific input/output validation.
- Update all plugin manifest reference checks atomically with the SDK shape.

### Replay-safe Effect API

Provide one deterministic authoring surface broad enough for existing script composition:

- deterministic constructors/combinators such as `succeed`, `fail`, `gen`, `map`, `flatMap`, `all`,
  `catch`, and schema operations;
- structured, awaited Promise interop required by approved adapters;
- no ambient Clock/Random, Effect sleep, detached fork, run-fork/runtime escape hatch, or
  unstructured background work.

**[IMPLEMENTER-DECIDES]** the exact exported operator list after mechanically inventorying current
plugin usage. The compiler and SDK type tests must prove excluded APIs stay unavailable.

## 3. Generalize the Durable Request Protocol

Replace the workflow-specific explicit `activity`/`sleep`/`child` authoring protocol with a typed
runtime protocol capable of representing every business host contract and nested workflow call.

Required semantics:

1. The runner obtains the recorded durable result projection at replay start.
2. Each host invocation receives a deterministic index in invocation order and includes its typed
   capability plus validated arguments.
3. If a recorded entry exists, validate capability and argument hash, then reproduce its success or
   typed failure without contacting the backend implementation.
4. If no entry exists, collect the request and mark the replay pending.
5. Once any unrecorded request is observed, the final runner result is pending even if script or
   dependency code catches the temporary failure.
6. Calls launched as one deterministic parallel batch may be collected together and return values
   in source order. Calls causally dependent on an unresolved request must not be recorded from a
   fallback path after that request becomes pending.
7. A body returning with unstructured in-flight host calls or async work fails with a bounded,
   actionable execution error.
8. Replay validates missing, reordered, changed, or truncated calls as nondeterminism.

Use schemas derived from existing sandbox host contracts. Do not introduce handwritten mirrors of
host argument/result types.

### Pending and Promise interop

The runner owns pending state, not only the outer Effect failure channel. This is required for
Youtubei and any approved Promise dependency that catches or transforms an internal fetch failure.
Pending transport errors are control flow and must never be exposed as durable host failures.

### Journal storage

- Workflow-engine persistence remains authoritative.
- Redis stores a bounded, reconstructible replay projection with request identity/hash and encoded
  success/failure values.
- Rebuild the projection from workflow activity/child results after Redis loss or TTL expiry.
- Preserve deterministic order and integrity checks across batches.
- Preserve the existing one-MiB HTTP request-body and ten-MiB HTTP response-body limits.
- Permit at most 100 MiB of cumulative encoded durable journal state per sandbox workflow.
- Keep terminal script output capped at 4 MiB, independently from its durable journal.
- Account for JSON/wire envelope overhead so a valid ten-MiB HTTP body can cross its transport
  boundary without contradicting the response limit.
- Fail deterministically before materializing or transferring state beyond the cumulative limit.
- Do not transparently change `httpCall` to return an artifact handle. Explicit artifacts and child
  workflows remain the author-visible escape hatch for intentionally larger data.

The 100-MiB ceiling is an initial operational bound and may be tuned later without changing the
sandbox host API. The implementation must avoid unbounded intermediate copies while constructing the
runner/Redis projection; raising the cap does not waive the existing Deno heap and worker-concurrency
budgets.

## 4. Build the Durable Host Dispatcher

Create one backend-owned mapping from each business host capability to its durable execution
primitive. The mapping is not script-authored metadata.

Each capability is classified as:

- **activity-backed read/write** - call the existing owning service in a workflow activity;
- **owning child workflow** - dispatch the existing feature workflow directly from the sandbox
  workflow body with a deterministic child ID;
- **nested sandbox child workflow** - resolve the active target once, pin its exact script, and start
  `SandboxScriptWorkflow` as a deterministic child;
- **durable artifact operation** - materialize immutable output and return opaque handles;
- **diagnostic** - emit replay-tagged logs/spans outside the business journal.

Do not wrap a service that starts a workflow inside an activity. In particular, `createEvents` must
compose `EventCreateWorkflow` from workflow code, while `changeUserRelationships` may call its
idempotent service from an activity.

### Write-host audit

Audit every write capability, including at minimum:

- cache writes and persistent claims;
- entity and relationship writes;
- event creation;
- signal emission;
- notification dispatch;
- integration-affecting operations;
- artifact creation.

For each, record the owning service/workflow and prove one of:

1. repeating the exact input is idempotent;
2. the implementation accepts a deterministic sandbox invocation key and deduplicates;
3. an owning child workflow uses a deterministic execution ID;
4. the operation is explicitly documented as at-least-once external delivery.

No write capability migrates without focused crash-window tests.

### Durable HTTP in Phase 1

- Extract/reuse the current validated HTTP implementation behind the durable dispatcher.
- An HTTP request executes immediately as an activity once observed.
- Preserve method/URL/header/body validation, secure TLS default, request/response byte limits, and
  per-network-attempt timeout.
- Preserve private/local integration destinations and `allowInsecureConnections` behavior.
- Record success or structured HTTP failure, including response headers needed by Phase 2.
- Do not add automatic business retries for unmatched external mutations.

## 5. Deterministic Runtime and Approved Dependencies

Apply workflow determinism to every role-specific definition and its complete reachable import
graph.

### Authored code

- Reject `Date()`, zero-argument `new Date()`, `Date.now()`, Temporal current-time APIs,
  `performance.now()`, ambient randomness, dynamic code generation, workers, and detached timers.
- Add `startedAt` to trusted execution metadata and migrate legitimate current-time usage to
  explicit parsing of that value.
- Keep exact source pinning and source-mapped diagnostics.
- Validate structured async behavior at compile time where possible and at runtime where static
  proof is impossible.

### Approved dependency runtime

- Install deterministic `Date.now()`/date construction based on persisted execution time for
  approved dependency internals.
- Install replay-stable seeded randomness derived from trusted workflow identity and reset the
  sequence before every replay.
- Add deterministic crypto randomness only when an audited approved dependency concretely needs it.
- Keep these shims inaccessible as an approved ambient authoring API; compiler diagnostics still
  reject direct plugin usage.
- Audit every `@ryot/sandbox-sdk` approved dependency for hidden I/O, import-time side effects,
  mutable process-global cache, clocks, randomness, workers, and dynamic loading. Record Youtubei as
  the one known I/O-bearing dependency and add regression tests for the others' local-only contract.
- Move the generic Youtubei fetch-to-`host.httpCall` adapter out of the media plugin and into the
  approved `@ryot/sandbox-sdk/youtubei` surface. Keep `Effect.runPromise` and pending-control-flow
  handling private to that SDK adapter; plugin source should consume the supported adapter rather
  than rebuilding privileged Promise transport.

The sandbox process must be cleanly terminated or reset after each replay so dependency and
global state cannot leak into another workflow execution.

## 6. Make Filesystem State Replay-Safe

### Input artifacts

- Materialize immutable, content-addressed input artifacts before sandbox workflow execution.
- Pin them for the workflow lifetime and grant read-only access to each replay.
- Preserve named-artifact access and existing path containment checks.
- Release inputs only after terminal completion/cancellation cleanup.

### Output chunks

- Replace direct replay-unsafe `writeScratchChunks` behavior with a durable operation.
- Perform each exact chunk materialization once at its durable boundary.
- Return opaque handles, never host file paths, to script and child-workflow results.
- Make handles resolvable for the complete active workflow lifetime; fixed TTL is leak cleanup only.
- Enforce entry, depth, and byte quotas before publishing handles.
- Ensure cancellation/failure cleanup cannot remove files still referenced by an active child.

Migrate import workflows and E2E harvest fixtures with this change. Do not retain a second direct
scratch-write model for supposedly simple scripts.

## 7. Unify Backend Execution Entry Points

- Route enqueue, plugin operations, provider operations, scheduler boot/cron, automations,
  integrations, imports, and internal sandbox composition through `SandboxScriptWorkflow`.
- Preserve existing async operation/job result contracts.
- Remove `SandboxSubmissionWorkflow` and whole-script durable-queue retry behavior that only exists
  for the standard execution path.
- Collapse `enqueue`, `executeWorkflow`, and plugin-workflow service branches into the smallest
  coherent universal service surface.
- Use one workflow resource profile. The local replay timeout bounds CPU/buggy code only; durable
  waiting does not consume it.
- Preserve execution authority, provider/script cache partitioning, capability checks, result
  polling, observability, and content-addressed module acquisition.
- Preserve root pinning and live-on-first-observation nested script resolution. Do not add whole
  plugin snapshot pinning.
- Propagate cancellation to pending child workflows and prevent not-yet-started host operations.
  Already-running network attempts may complete and have their result discarded.

## 8. Migrate the Plugin Catalog

Migrate by behavior group after both tracers pass:

1. Named workflows and their current activity wrappers.
2. Import parsers, chunk writers, and resolution/population workflows.
3. Provider operations, starting with Youtube Music and one representative multi-call provider.
4. Automations and write-heavy lifecycle scripts.
5. Integration yank/sink/push scripts and external mutation documentation.
6. Generic operations, cron, boot, preload, and kernel source-zero scripts.
7. Remaining media and fitness provider families in bounded package-local batches.

For each group:

- preserve role input/output and business assertions;
- narrow capabilities/config keys rather than copying obsolete wrapper metadata;
- inline wrappers whose only purpose was to let a workflow call a host capability;
- use named child workflows only for genuine independent durability, fan-out, reuse, or payload
  boundaries;
- remove dead activity source, manifest entries, references, tests, and terminology in the same
  migration slice;
- keep package checks and focused tests green before starting the next group.

## 9. Tests and E2E

### SDK/compiler/runtime tests

Add focused coverage for:

- role-specific definitions all compiling to the universal execution shape;
- the replay-safe Effect export and rejected nondeterministic/unstructured APIs;
- success and typed-failure replay;
- missing/reordered/changed call nondeterminism;
- deterministic sequential and parallel request collection;
- caught pending signals;
- detached async rejection;
- deterministic approved-dependency time/randomness;
- Youtubei multi-request replay and forced restart;
- dispatcher classification and the complete write-host safety audit;
- artifact pinning, durable chunk handles, cancellation, and cleanup;
- Redis projection reconstruction;
- cumulative journal and output limits;
- secrets absent from diagnostics.

### `tests/` E2E

Treat `tests/` as a first-class implementation surface. Follow `tests/AGENTS.md` and
`tests/README.md`: generic runtime behavior belongs under `src/tests/kernel/`, plugin behavior under
the corresponding plugin tree, providers remain hermetic except the existing live smoke gate, and
async jobs use `assertCompleted`/`requireCompletedSandboxValue`.

At minimum inspect and update:

- `tests/src/fixtures/sandbox.ts`;
- `tests/src/fixtures/sandbox-source.ts`;
- `tests/src/fixtures/test-plugin.ts`;
- `tests/src/fixtures/sandbox-provider.ts`;
- `tests/src/fixtures/imports.ts`;
- `tests/src/tests/kernel/sandbox/`;
- `tests/src/tests/kernel/plugins/`;
- `tests/src/tests/kernel/imports/`;
- `tests/src/tests/kernel/entity-import/`;
- `tests/src/tests/kernel/entity-schemas/search-import.test.ts`;
- media and fitness import suites;
- media automation/lifecycle suites;
- the media population operational gate.

Required new E2E behavior:

- install a role-specific test plugin and prove every invocation is a durable workflow;
- interrupt between durable read/query/write calls and complete without duplicate work;
- prove owning-workflow and service-backed writes both replay correctly;
- prove caught pending work suspends rather than returning a false result;
- prove deterministic parallel calls and child workflows;
- prove immutable artifact and durable chunk-handle survival across suspension/restart;
- prove plugin reingestion keeps root/observed-step pin semantics;
- prove simple no-host-call automation behavior remains unchanged;
- prove legacy manifest execution distinctions and activity fixtures no longer exist.

Keep latency assertions out of ordinary E2E files. The dedicated benchmark harness owns timing;
E2E continues to prove behavior and recovery without becoming machine-speed-sensitive.

Youtubei's deterministic dependency behavior may be proven in focused backend integration tests
when a hermetic E2E would require real YouTube. If the existing opt-in live-provider smoke is
updated, keep it opt-in and do not make live network availability a standard gate.

Run each affected standard E2E file individually for final acceptance, then run the discovered
standard suite. Run the media population operational gate explicitly because it exercises
production-size workflow, Redis, sandbox, database, and artifact paths. Live provider smoke remains
excluded unless explicitly requested.

## 10. Deletion and Documentation

- Delete the standard sandbox limit profile and workflow-vs-standard profile selection.
- Delete direct business host execution from live replay sessions.
- Delete `SandboxSubmissionWorkflow`, obsolete durable queue wrappers/retries, and duplicate service
  entry points.
- Delete workflow-only `durableCalls` authoring APIs superseded by transparent host replay.
- Delete the activity definition kind, references, compiler branches, manifest validation, and
  migrated wrappers.
- Delete cron/script dispatch selectors and other manifest execution-mode distinctions.
- Delete direct scratch output and fixed-TTL correctness dependencies.
- Remove stale tests rather than keeping compatibility assertions.
- Update `apps/app-backend/src/lib/infrastructure/sandbox-runtime/README.md`, backend and package
  guidance, plugin documentation, and E2E conventions to describe only the universal runtime.
- Run the `codebase-cleanup` skill over changed code and directly affected modules before the final
  phase gate.

## Done Criteria

1. Every persisted plugin and kernel sandbox definition executes through `SandboxScriptWorkflow`.
2. Every business host capability is durable and has recorded success/failure replay behavior.
3. Every write host capability passes the documented idempotency/ownership audit and crash tests.
4. HTTP is a durable immediate activity; no sandbox process remains alive between observation and
   completion.
5. The synthetic and Youtubei tracers pass forced-interruption tests.
6. Approved dependencies and all authored role definitions pass universal determinism checks.
7. Input artifacts and output handles survive suspension for the active workflow lifetime.
8. `activity` kind, standard execution profile, `SandboxSubmissionWorkflow`, and execution-mode
   manifest selectors are absent from source and tests.
9. Existing business behavior assertions remain green after fixture migration.
10. Focused backend/package tests, affected E2E files, the standard E2E suite, and the media
    population operational gate pass according to their documented commands.
11. The final migrated catalog is measured with the Phase 0 harness. Results stay within the
    permissive review guardrails or an owner-approved waiver and rationale are recorded in this
    plan; the production-size operational import has no unexplained throughput collapse.
12. Documentation describes one sandbox execution model.
13. Workspace status contains only intended source/documentation changes and no generated artifacts.

## Stop Conditions

Stop and ask the owner if implementation discovers:

- a host write that cannot be made retry-safe and is not an accepted external at-least-once effect;
- a required dependency whose hidden state cannot be recreated deterministically;
- a script that requires detached work or mutable process state to preserve business behavior;
- a result that cannot fit bounded replay state and cannot use artifacts/child chunking;
- an owning backend service that starts durable work but cannot be composed from workflow code;
- a public contract that actually depends on synchronous sandbox completion;
- input artifacts that cannot remain immutable/pinned through suspension;
- a need to preserve the old execution model or persisted legacy jobs;
- a tracer or final-catalog workload exceeds the performance guardrails without an accepted
  explanation and owner waiver;
- any architectural choice contradicting `00-overview.md`.
