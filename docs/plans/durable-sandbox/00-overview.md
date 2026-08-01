# Durable Sandbox Execution - Overview

Status: Phase 1 and Phase 2 complete. Design decisions were confirmed with the project owner
on 2026-08-05. Nothing is deployed and the project has no real users, so this is a greenfield breaking
rewrite: do not add compatibility paths for the removed standard sandbox execution model.

Read this file completely before opening a phase file. The phase files are:

| File                                          | Scope                                                       |
| --------------------------------------------- | ----------------------------------------------------------- |
| `01-phase-1-universal-workflow-runtime.md`    | Every sandbox body becomes a replayable durable workflow    |
| `02-phase-2-global-provider-rate-limiting.md` | Plugins declare provider limits; durable HTTP enforces them |

Phases are strictly ordered. Phase 2 must build on the durable HTTP boundary completed in Phase 1;
it must not introduce a second HTTP execution path.

## Markers

- **[DECIDED]** - settled with the project owner. Do not silently deviate. If implementation finds
  contradictory evidence, stop and surface it.
- **[RECOMMENDED]** - the expected implementation unless concrete code evidence requires another
  choice. Record deviations in the relevant phase file.
- **[IMPLEMENTER-DECIDES]** - deliberately deferred implementation detail. Record the selected
  choice in the relevant phase file.

## Vision

Every sandbox invocation is one durable workflow execution. Provider, automation, operation,
generic script, and named workflow remain author-facing business contracts, not execution modes.
The body is deterministic local computation that re-executes from the top. Every host call that
observes mutable state or changes state is a durable boundary whose success or typed failure is
recorded and returned during replay. Diagnostics are replay-aware but are not business journal
entries. No sandbox process remains alive while durable work waits.

After that execution model is universal, plugins may declare deployment-global rate limits for
external provider origins. A durable HTTP call atomically reserves a global slot, durably sleeps
without occupying a sandbox process, performs the network attempt, and records the response. A
rate-limited import and an interactive provider operation therefore share the same upstream quota
without either failing merely because the other consumed it.

## Decision Record

All items in this section are **[DECIDED]**.

1. **Universal workflow execution, subject to measured viability.** Every sandbox invocation
   creates a durable workflow, including bodies that complete without making a host call. There is
   no standard-script fast path in the intended end state. Before catalog migration, Phase 1 must
   compare representative current and tracer workloads against the agreed permissive performance
   guardrails. A material miss triggers owner review and optimization; do not preserve or restore a
   fast path without that evidence and an explicit decision.
2. **Roles are not execution modes.** `defineProvider`, `defineAutomation`, `defineOperation`,
   generic script definitions, and named workflow definitions retain their contract-specific input
   and output behavior while sharing one replay runtime.
3. **Transparent durable host API.** Plugin authors continue to call `host.httpCall`,
   `host.executeQueryEngine`, `host.createEvents`, and other typed host methods. They do not manually
   wrap calls in `replay.activity` or choose backend workflow primitives.
4. **Mutable observations are durable.** HTTP, queries, configuration, preferences, cache access,
   writes, and nested script execution are durable. Pure local computation replays. `log`, `span`,
   and console diagnostics remain outside the business journal.
5. **Backend ownership remains authoritative.** A durable host dispatcher calls the backend
   implementation that owns the behavior. `createEvents` continues through its owning
   `EventCreateWorkflow`; `changeUserRelationships` continues through its service. The dispatcher
   chooses child workflow versus activity without exposing that distinction to scripts.
6. **Write safety is a Phase 1 gate.** Every write host function must be proven idempotent, made
   idempotent with the sandbox workflow/call identity, or delegated deterministically to its owning
   workflow before migration is complete.
7. **External HTTP mutations are at-least-once.** Do not add generalized exactly-once machinery.
   Unmatched integration HTTP calls receive no automatic business retry, but may repeat across the
   unavoidable crash window after a remote system accepts a request and before the activity result
   is persisted. Integrations may supply remote idempotency keys when supported.
8. **Failures are durable results.** When a host operation exhausts its applicable retry behavior,
   its typed failure is recorded. Replay reproduces that failure so normal Effect error handling in
   the script can handle it without re-executing the operation.
9. **Nested scripts are child workflows.** A sandbox script invocation owns a workflow identity.
   Calls from one script to another use deterministic child workflow identities.
10. **Structured async only.** A body may not leave detached Promises, fibers, timers, callbacks, or
    host calls running after `run` returns. Approved dependencies may use Promise APIs internally
    when their top-level operation is awaited.
11. **Replay-safe Effect surface.** Ordinary scripts receive deterministic Effect composition and
    controlled Promise interop, not clocks, random services, detached forks, runtime execution, or
    unstructured concurrency. Approved SDK adapters may use narrower internal interop that is not
    exported as a general authoring API.
12. **Deterministic call identity.** The SDK/runtime derives durable identity from stable call order
    and capability, and validates replay with argument hashes. Authors do not name every host call.
    Concurrent batches preserve deterministic result ordering.
13. **Caught pending work still suspends.** Once the runner observes an unrecorded durable call, the
    replay result is pending even if plugin or dependency code catches the temporary pending signal.
14. **Workflow time.** Execution metadata contains a persisted `startedAt`. Authored workflow code
    continues to reject ambient `Date()`, zero-argument `new Date()`, `Date.now()`, and randomness.
    Approved dependencies receive deterministic time and seeded randomness reset for every replay.
15. **Approved dependency contract.** Dependencies exported by `@ryot/sandbox-sdk` must be replay
    safe. External I/O must use injected durable host adapters, and mutable caches that affect
    request construction must be replay-local or intentionally host-backed.
16. **Youtubei is mandatory compatibility coverage.** The Youtube Music client is reconstructed on
    every replay. Its injected fetch reaches durable `httpCall`; deterministic globals recreate
    stable session data; in-memory client state is never serialized. A forced-restart Youtubei test
    is a Phase 1 gate.
17. **Immutable artifacts may be direct inputs.** Content-addressed input artifacts may be read
    directly when pinned for the complete workflow lifetime. They do not need to be copied into the
    JSON journal.
18. **Filesystem writes are durable.** Scratch/chunk creation becomes a durable operation returning
    opaque workflow-scoped handles. Replays receive recorded handles rather than rewriting files.
19. **Correctness state outlives suspension.** Pinned inputs, output artifacts, and handles required
    for replay remain valid until terminal workflow completion. TTLs may clean leaks after
    completion but cannot determine whether an active workflow resumes successfully.
20. **Bounded inline state without an HTTP API split.** `httpCall` continues returning its existing
    inline `{ body, status, headers }` result with a 10-MiB response-body limit. One workflow may
    retain at most 100 MiB of encoded durable journal state, while its terminal script output remains
    capped at 4 MiB. Crossing either limit fails deterministically; the runtime does not
    transparently replace an HTTP body with an artifact handle. Plugins use explicit artifacts or
    child-workflow chunking when they intentionally need larger data. These initial limits may be
    tuned later without changing the host API.
21. **Workflow storage is authoritative.** The workflow engine's PostgreSQL persistence owns durable
    completion. Redis is a reconstructible projection/coordination layer, not the sole copy of
    workflow progress.
22. **Sensitive workflow state uses trusted infrastructure.** PostgreSQL and Redis may contain
    credentials in durable requests/results. Phase 1 does not add application-level encryption or
    secret-reference machinery. Secrets must never enter logs, spans, diagnostics, or public
    results, and Redis projections remain temporary.
23. **Authority is frozen.** The trusted execution authority and identity are fixed when the
    workflow starts. Backend services continue validating referenced users, integrations, and
    resources when called; replay does not refresh a mutable permission snapshot.
24. **Private destinations remain available.** Trusted installed integration scripts may call local
    Plex, Jellyfin, Sonarr, Radarr, and other private destinations. Provider policies classify
    globally limited origins; unmatched trusted destinations remain allowed.
25. **Replay diagnostics are explicit.** Logs and spans are tagged with workflow identity and replay
    step. Repeated diagnostics are acceptable and are not deduplicated into business state.
26. **Live-on-first-observation plugin resolution remains.** The root script is pinned before replay.
    Each nested script target resolves from the active plugin version when first observed and is
    then durably pinned for that call. A long workflow may therefore use different plugin versions
    at different first-observation points. Do not add whole-plugin snapshot pinning.
27. **The current activity script kind is removed.** Existing activity scripts are inlined where
    their boundary was infrastructure-only or become named child workflows when reuse, independent
    durability, fan-out, or payload ownership requires it.
28. **Named workflows remain.** `defineWorkflow` remains the plugin contract for workflows invoked
    by imports, crons, or other workflows. Named workflows may call durable host functions directly.
29. **Migration preserves behavior, not file count.** Phase 1 may delete or combine wrappers made
    unnecessary by the universal runtime. It need not convert every current file one-for-one.
30. **Manifest dispatch is unified.** Fields such as cron `lot: "script" | "workflow"` that exist
    only to select an execution path are removed. Feature contracts may still require a named
    workflow target where composition semantics require one.
31. **No compatibility end state.** A tracer lands first, but Phase 1 is incomplete until every
    sandbox entry point uses the workflow runtime and the standard execution path is deleted.
32. **Phase 1 HTTP executes immediately.** Durable `httpCall` has no admission wait in Phase 1. This
    proves replay and establishes the sole seam Phase 2 will wrap.
33. **Global provider limits.** Rate limits are shared by all users, workflows, scripts, and backend
    instances in one deployment.
34. **Origin-based declarations.** Plugins declare a global policy key, normalized origins, request
    count, and interval. Every HTTP URL is matched against the active policy registry; unmatched
    origins remain unrestricted.
35. **Conflicts fail installation.** Identical declarations may coexist. Different declarations for
    the same key or origin are rejected rather than merged or selected by installation order.
36. **Simple distributed scheduler.** Phase 2 uses an evenly spaced global leaky-bucket/GCRA policy
    without configurable bursts. Redis atomically owns reservation state.
37. **Reservations are conservative.** A cancelled workflow does not reclaim an already reserved
    slot. Losing one slot is safer than distributed reclamation races.
38. **429 waits durably.** A valid 429 retries the same durable HTTP call without a fixed attempt
    count, using `Retry-After` when present and the declared interval otherwise. Cancellation is the
    escape hatch. Other HTTP errors become normal durable failures.
39. **No adaptive provider headers in Phase 2.** Admission uses static declarations plus generic
    `Retry-After`; provider-specific remaining/reset headers are out of scope.
40. **Policies are live.** Policy install/update affects new reservations immediately, including
    calls in already-running workflows. Rate policy protects upstream operations and is not pinned
    as script behavior.
41. **Limiter fails closed.** If Redis coordination is unavailable, provider calls durably wait and
    retry rather than bypassing the limit.
42. **No fairness classes in this plan.** Do not add tenant priorities, reserved interactive shares,
    or weighted scheduling. The global admission order may make operations slower but must prevent
    quota failures.
43. **E2E is part of implementation.** `tests/` migrates in lockstep. Each phase's completion gate
    includes focused E2E coverage and the standard suite according to `tests/README.md`; tests are
    not deferred to a later phase.
44. **Performance evidence is a phase gate.** Benchmarks use hermetic dependencies and warm backend
    processes to separate Ryot orchestration overhead from upstream latency. Results are recorded
    before the rewrite, after the tracers, and after catalog migration. Guardrails are intentionally
    permissive and may be waived by the owner with the measured result and rationale recorded in the
    phase plan; an unexplained regression cannot be ignored merely because functional tests pass.

## Current Baseline

- Every provider, automation, operation, generic script, and named workflow executes through
  `SandboxScriptWorkflow` with one universal 30-second local replay profile.
- Mutable host calls are typed durable requests. Workflow persistence is authoritative, while Redis
  holds reconstructible replay projection and Phase 2 admission coordination state.
- Sandbox Deno processes can reach only the loopback bridge. Sandbox-originated external HTTP is
  centralized in durable `httpCall`; backend-owned notification delivery remains outside this plan's
  limiter.
- Root scripts are content-hash pinned, nested targets resolve live on first observation, and no
  sandbox process or bridge session remains alive across durable work or sleep.
- Authored code is guarded against ambient nondeterminism. Approved dependencies receive replay-stable
  time/randomness, including the SDK-owned Youtubei transport through durable `httpCall`.
- Immutable input artifacts and generated workflow-scoped handles remain retained for the active
  workflow lifetime rather than relying on a fixed TTL for correctness.
- Phase 2 wraps the sole durable HTTP path with authoritative PostgreSQL origin classification and
  Redis global admission. Unmatched calls retain one-attempt behavior; generic automatic recovery is
  limited to policy-matched HTTP `429`.

## Target Data Flow

```text
async business API / scheduler / parent workflow
  -> resolve role-specific sandbox script
  -> SandboxScriptWorkflow(executionId, pinned script, authority, input)
  -> run fresh sandbox replay
       -> deterministic local computation
       -> host business call records typed durable request
       -> replay returns pending and sandbox exits
  -> backend durable dispatcher
       -> Activity, owning child workflow, durable artifact operation, or durable HTTP
       -> authoritative result persisted by workflow engine
       -> Redis replay projection refreshed
  -> replay sandbox body from the top
       -> recorded host results returned without repeating completed work
  -> terminal role-specific output persisted and exposed through existing async result flow
```

After Phase 2, durable HTTP adds:

```text
durable HTTP request
  -> match live origin policy
  -> atomically reserve global Redis slot
  -> DurableClock.sleep when scheduled in the future
  -> perform bounded HTTP activity
  -> on 429: advance blocked time, sleep, retry same durable call
  -> persist success or final typed failure
```

## Storage Ownership

| Data                                                            | Owner                               |
| --------------------------------------------------------------- | ----------------------------------- |
| Business entities, events, relationships, integrations, imports | Existing PostgreSQL repositories    |
| Workflow execution, child/activity completion, terminal result  | Workflow engine PostgreSQL storage  |
| Reconstructible sandbox replay projection                       | Redis with bounded TTL              |
| Durable provider policies and canonical declaration hashes      | PostgreSQL plugin manifests         |
| Global provider admission schedule / blocked-until state        | Redis                               |
| Uploaded and immutable input artifacts                          | Existing file storage               |
| Durable generated chunks and opaque handles                     | Workflow-lifetime artifact storage  |
| Process-local active plugin declarations                        | Existing plugin registry snapshot   |
| Script content/version pin and workflow references              | Existing sandbox/plugin persistence |

## Cross-Phase Invariants

1. No transaction spans sandbox execution, network I/O, durable sleep, or child fan-out.
2. Every durable write has one backend owner and is idempotent at its retry boundary.
3. Sandbox scripts never choose authority, cache namespace, provider identity, rate-limit identity,
   or workflow execution identity.
4. Every script remains one direct compiled entrypoint selected by exact script ID before execution.
5. The runtime validates capability and authority from trusted persisted metadata on every actual
   host operation; recorded results replay without repeating the operation.
6. No sandbox process or bridge session is retained during durable waits.
7. Inline workflow data stays within the decided 10-MiB per-HTTP-response, 100-MiB cumulative
   journal, and 4-MiB terminal-output bounds; larger intentional data uses child workflows and
   artifacts.
8. Existing business assertions are preserved when E2E plumbing migrates. Behavioral changes need
   owner approval rather than quiet assertion changes.
9. Each task remains reviewable and leaves relevant checks/tests passing. Temporary internal
   compatibility may exist between tasks but is deleted before its phase gate.
10. Documentation describes only the final universal runtime after Phase 1. Historical execution
    branches are removed rather than documented as alternatives.
11. Implementation uses existing Effect workflows, durable queues, durable clocks, and services; do
    not introduce another workflow/job/rate-limit framework.
12. Byte limits follow Decision 20. Performance-sensitive changes record warm, hermetic p50/p95,
    replay counts, workflow/Redis round trips, and import throughput against the Phase 1 baseline.

## Verification Baseline

Use Turbo for monorepo checks and run package tests from their package directories. At minimum:

```bash
bun turbo --filter=@ryot/sandbox-sdk check
bun turbo --filter=@ryot/sandbox-compiler check
bun turbo --filter=@ryot/plugin-kit check
bun turbo --filter=@ryot/media-plugin check
bun turbo --filter=@ryot/fitness-plugin check
bun turbo --filter=@ryot/app-backend check
bun turbo --filter=@ryot/tests check
```

Backend and package tests:

```bash
bun turbo --filter=@ryot/app-backend test
bun turbo --filter=@ryot/sandbox-sdk test
bun turbo --filter=@ryot/sandbox-compiler test
bun turbo --filter=@ryot/plugin-kit test
bun turbo --filter=@ryot/media-plugin test
bun turbo --filter=@ryot/fitness-plugin test
```

E2E follows `tests/README.md`: run affected files individually during tasks and run the standard
suite at each phase gate. The opt-in operational and live-provider suites remain separate gates and
are run only when the relevant phase explicitly requires them.

## Sequencing Rationale

Rate limiting cannot safely suspend the current direct bridge call: waiting holds a sandbox process
and still loses progress on timeout or restart. Phase 1 first makes the HTTP request itself durable
and removes the dual execution model. Phase 2 then becomes a focused scheduling policy around that
one durable operation. Implementing admission first would create temporary whole-script retries or
bridge sleeps that Phase 1 would immediately delete.
