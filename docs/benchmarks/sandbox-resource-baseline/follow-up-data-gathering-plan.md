# Sandbox Resource Follow-Up Data-Gathering Plan

## Purpose

Repair the benchmark methodology defects found in the first sandbox resource baseline, then collect
decision-grade data for:

1. Sandbox worker concurrency `1`, `2`, `3`, and `5`.
2. YouTube Music search and details memory and CPU behavior.
3. Bun memory retention under repeated hermetic and live workloads.

This plan gathers evidence only. It must not redesign durable replay, add full-import admission,
optimize YouTube Music, split the sandbox into another production service, or add production
container limits. Those decisions come after this run.

The executor should complete the plan end to end. It must stop and report when a safety gate,
credential prerequisite, image-provenance check, or sampling-integrity check fails. It must not
silently weaken a gate to finish the run.

## Established State

The first baseline and its follow-ups established:

- The incident host reached global OOM with five Deno workers active.
- Live YouTube Music workers were much larger than hermetic workers.
- Durable host calls amplified process spawns and workflow replay work.
- Effect issue 8238 caused completed durable deferred results to lose their workflow wake-up.
- Effect `4.0.0-rc.116` resolved that wake-up race in the exercised path. Five executions at each of
  64 KiB, 1 MiB, and 3,900,000 result bytes completed successfully.
- Concurrent population of overlapping provider graphs caused PostgreSQL deadlocks.
- Canonical advisory-lock ordering, sorted writes, and bounded complete-transaction `40P01` retry
  resolved the hermetic overlap gate. Three 5-import and three 20-import runs completed all 75
  imports without a deadlock.
- `SANDBOX_WORKER_CONCURRENCY` is configurable and defaults to `2`.

Do not remove or bypass these fixes during the follow-up.

## Execution Credentials

Credentials must be supplied through the executor environment. They must not be read from Git
history, shell history, previous transcripts, benchmark artifacts, or repository files.

Required environment variables:

- `SERVER_IP`: SSH address of the dedicated benchmark VM.
- `COOLIFY_TOKEN`: root Coolify API token.
- `BENCHMARK_API_URL`: `https://ur-testing.ryot.io`.
- `BENCHMARK_FRONTEND_URL`: `https://ur-testing.ryot.io`.
- `BENCHMARK_ADMIN_ACCESS_TOKEN`: benchmark-only Ryot admin access token.

Use the existing authenticated `gh` session for GitHub operations.

Preflight:

```bash
test -n "$SERVER_IP"
test -n "$COOLIFY_TOKEN"
test "$BENCHMARK_API_URL" = "https://ur-testing.ryot.io"
test "$BENCHMARK_FRONTEND_URL" = "https://ur-testing.ryot.io"
test -n "$BENCHMARK_ADMIN_ACCESS_TOKEN"
ssh -o BatchMode=yes -o ConnectTimeout=10 "root@$SERVER_IP" true
curl --fail-with-body --silent --show-error \
  --header "Authorization: Bearer $COOLIFY_TOKEN" \
  --header "Accept: application/json" \
  https://admin.ryot.io/api/v1/servers >/dev/null
gh auth status
```

Never print credentials, enable shell tracing while credentials are in scope, place secrets directly
in command arguments when an environment variable can be used, or preserve complete environment
responses. Revoke temporary credentials after the run.

## Dedicated Environment

Use only the existing dedicated benchmark environment:

- SSH: `root@$SERVER_IP`; do not hardcode the address in scripts or artifacts.
- Coolify API: `https://admin.ryot.io/api/v1`.
- Coolify server name: `testing`.
- Coolify server UUID: `oiineqpck49lz4orarclegvp`.
- Public domain: `https://ur-testing.ryot.io`.
- Service name: `ryot-benchmark`.
- Service UUID: `a2dt5g6dbmpwqwllnzsho8jc`.
- Ryot application UUID: `x95tavztbij6ktz2eblz1jlh`.
- Redis database UUID: `2ahlwqbja9iadvw4ls3suvpq`.
- PostgreSQL database UUID: `qqxjvomd4g3clbeura7oe9vr`.

Before every mutation, retrieve the resource by UUID and confirm its name, server UUID, domain,
container set, and database attachments. Stop if any identity differs. Do not create another Coolify
project, environment, server, service, or database. Never operate on `ryot-ultra-rewrite` or another
Coolify resource.

## Fixed Decisions

- Canonical host profile: 2 vCPU, 4 GB RAM, no required swap.
- Sandbox process mode: `on-demand`.
- Concurrency candidates: `1`, `2`, `3`, and `5`.
- Current product default: `2`.
- Primary workloads: deterministic hermetic workloads followed by controlled live YouTube Music.
- Bun retention: separate hermetic and YouTube Music soaks.
- Profiling: temporary CPU and heap profiles for hermetic and live workloads.
- Live profiles are sensitive, stay off-repository, use restrictive permissions, and are deleted
  after sanitized analysis is written.
- Scheduler dispatchers stay disabled during workload comparisons. Run separate fresh-process idle
  observations with dispatchers disabled and enabled.
- Production behavior remains unchanged except for measurement instrumentation and benchmark-only
  admin-gated controls.
- Preserve machine-readable scenario artifacts and a checked-in evidence-based report.

## Non-Goals

Do not implement or evaluate these changes in this phase:

- Durable replay redesign or live continuation.
- Full-import admission or client-side import throttling.
- YouTube Music response or SDK optimization.
- A separate production sandbox worker service.
- Production cgroup, CPU, memory, PID, or storage limits.
- Warm sandbox mode.
- Different retry schedules, workflow timeouts, payload limits, or heap limits.
- Swap as a product requirement.

If a correctness defect prevents a scenario from completing, record it and stop the affected group.
Do not hide it with a benchmark-only behavior change.

## Deliverables

Create and commit:

1. Corrected benchmark sampling and summarization.
2. Replay-safe import workload measurements.
3. Correct host and container sampling at a verified cadence.
4. Benchmark-only CPU and heap profiling support.
5. Focused tests for every new parser, aggregator, cadence rule, and profile sanitizer.
6. A new run under:

```text
docs/benchmarks/sandbox-resource-baseline/<UTC-run-id>/
  manifest.json
  summary.json
  report.md
  defects.md
  profiles/
    summary.json
  scenarios/
    <scenario>.<repetition>.json
```

Do not commit raw CPU profiles, heap snapshots, provider responses, credentials, authorization
headers, SQL text, user identifiers, external entity identifiers, or unbounded logs.

## Phase 1: Repair Application Sampling

### Fixed-rate scheduling

The existing sampler performs a request and then sleeps for the configured interval. Its actual
period is therefore request duration plus the interval. Replace this with deadline-based scheduling:

1. Record a monotonic next deadline.
2. Start the next sample at that deadline.
3. Never overlap snapshot requests.
4. If a request overruns a deadline, record a missed slot and advance to the next future deadline.
5. Record request duration, scheduled timestamp, actual timestamp, and missed-slot count.

The sample series must expose observed cadence statistics rather than only the requested interval:

- p50, p95, and maximum start-to-start interval.
- p50, p95, and maximum request duration.
- Missed slots.
- Longest gap.

The canonical target remains 200 ms. Preflight passes only when:

- p50 interval is at most 300 ms.
- p95 interval is at most 500 ms.
- Maximum interval is at most 2 seconds outside a deliberate container restart.
- No more than 1% of scheduled slots are missed.

If the admin snapshot cannot satisfy these gates, optimize only the diagnostic snapshot path or move
sampling into an equivalent benchmark-only local collector. Do not reduce sampled fields or relax
the gate without recording and obtaining approval.

### Peak interpretation

Every report must distinguish:

- Sampled peak: maximum observed instantaneous value.
- Kernel/cgroup peak: cumulative peak reported by the cgroup.
- Per-process lifetime maximum when available.

Short-lived workers that begin and end between samples must be counted from process lifecycle
counters, but their RSS peak must be reported as unobserved rather than zero.

## Phase 2: Repair Host And Container Sampling

The existing host sampler invokes `docker stats --no-stream` serially for each container, producing
8-9 second intervals. Replace that path.

At sampler startup and after any container restart:

1. Resolve exact container IDs for Ryot, PostgreSQL, Redis, and the OTLP collector.
2. Resolve each container's cgroup v2 path.
3. Reject ambiguous substring matches.
4. Record container ID, image digest, start time, restart count, OOM state, and cgroup path.

At each one-second sample, read directly from procfs and cgroup v2:

- Host `/proc/meminfo`.
- Host `/proc/pressure/{cpu,memory,io}`.
- Host `/proc/vmstat`.
- Block-device `/sys/block/<device>/stat`.
- Per-container `memory.current`, `memory.events`, `memory.stat`, `cpu.stat`, `io.stat`, and
  `pids.current`.

Do not invoke one blocking Docker statistics command per container in the sampling loop. Docker may
be queried outside the loop for metadata.

Preflight passes only when a ten-minute sample has:

- p50 interval from 0.9 to 1.1 seconds.
- p95 interval at most 1.25 seconds.
- Maximum interval at most 2 seconds.
- No undecodable samples.
- No unresolved target container.

### Per-scenario peaks

Before every scenario, attempt to reset the Ryot cgroup's `memory.peak` by writing `0` when supported
by the host kernel. Verify the reset. If reset is unsupported:

- Use sampled `memory.current` maximum as the per-scenario cgroup peak.
- Preserve lifetime `memory.peak` separately.
- Never label lifetime `memory.peak` as a scenario peak.

Capture container metadata and kernel warnings immediately before and after every scenario. Retain a
bounded, sanitized journal window in the scenario artifact.

## Phase 3: Repair Summarization And Provenance

### Repetition aggregation

Replace last-repetition selection with explicit aggregation.

For each scenario report:

- Repetition count.
- Completed, failed, aborted, and skipped counts.
- Median, p95, minimum, and maximum for peaks, deltas, latency, CPU, recovery, and replay work.
- Every individual repetition result in machine-readable form.

Scaling ratios must compare scenario-level medians. Do not include aborted or skipped repetitions in
resource ratios. If fewer than the required repetitions complete, mark the ratio unavailable.

Add tests proving that changing repetition order does not change scenario aggregates.

### Baseline-normalized memory

For every repetition record:

- Pre-scenario Bun RSS, heap used, external memory, and cgroup memory.
- Scenario peak.
- Peak minus pre-scenario value.
- Post-recovery value.
- Post-recovery minus pre-scenario value.

Use deltas for comparisons between scenarios. Keep absolute values to identify process aging.

### Provenance

The summarizer must reject:

- Mixed run IDs unless an explicit composite-run manifest lists every constituent run.
- Artifacts built from different image digests.
- Different runtime versions in one comparison group.
- Different concurrency settings from the scenario declaration.
- Missing required health records.

The manifest must cover the complete run, not only the last driver invocation. Record every driver
invocation and merge interval explicitly.

## Phase 4: Make Import Measurements Replay-Safe

Process-local counters mutated inside replayable workflow bodies cannot represent logical imports or
phase duration reliably. Replace or redefine them before phase-overlap analysis.

### Required semantics

Measure these distinct concepts:

- Submitted imports: accepted public API requests.
- Logical pending imports: admitted jobs without a terminal durable result.
- Executing import bodies: workflow bodies currently consuming process time.
- Population phase intervals.
- Provider-import automation phase intervals.
- Terminal outcomes.

Logical state must come from durable workflow state or benchmark-owned submitted/terminal records,
not an increment/decrement pair that re-executes during replay.

Process execution metrics may remain process-local, but their names and documentation must say
`execution` or `attempt`, not `import`, when re-entry can increment them more than once.

For phase overlap, preserve bounded trace records keyed by hashed execution identity in temporary raw
artifacts. The committed artifact must contain only aggregated phase intervals and overlap counts.

Add a restart-focused test proving:

- Logical submitted and terminal counts remain stable across replay.
- No active gauge grows on workflow re-entry.
- Phase aggregation does not double-count replayed segments.

## Phase 5: Repair Safety Gates

The watchdog must resolve exact benchmark containers and the actual Coolify compose project. It must
not use a `name=ryot` substring.

Before load testing, perform a harmless watchdog drill against a disposable sentinel process or a
dry-run action. Verify the exact stop target without stopping the benchmark stack. Record the drill.

During the run, stop only the benchmark Ryot application container when any condition remains true
for five consecutive seconds:

- `MemAvailable < 384 MiB`.
- Memory PSI `full avg10 > 10`.
- Host or Ryot cgroup OOM-kill counter increases.
- Ryot cgroup `memory.current > 2.5 GiB`.
- SSH is available but the health endpoint fails continuously for 30 seconds.

Do not stop PostgreSQL or Redis. Preserving them is necessary to observe durable recovery.

Stop the current scenario group after any watchdog trigger. Do not continue to a higher concurrency.

## Phase 6: Temporary Profiling Support

Profiling must be benchmark-only and admin-gated. It must not alter normal production executions when
disabled.

### Deno profiles

Support selecting one execution by a benchmark-generated opaque correlation token. For that execution
only, collect:

- CPU profile covering process startup, module import, script execution, host calls, and response
  serialization.
- Heap snapshots or allocation profiles at these checkpoints when the runtime supports them:
  - Runner ready.
  - Module imported.
  - Provider client created.
  - Provider response received.
  - Provider result built.
  - Runner response encoded.
- `/proc/<pid>/smaps_rollup` at the same checkpoints.
- `Deno.memoryUsage()` at the same checkpoints.

If Deno's supported profiling interface cannot capture a checkpoint safely, use Linux `perf` for CPU
and retain memory usage plus `smaps_rollup`; record the missing heap profile explicitly. Do not add a
production dependency only for profiling.

### Bun profiles

For the retention soak, capture:

- CPU profile for one representative hermetic wave and one live wave.
- Heap snapshots at fresh idle, after selected waves, after recovery, and after benchmark-only forced
  garbage collection.
- `process.memoryUsage()`, cgroup memory, `/proc/<pid>/smaps_rollup`, and active workflow counts at
  each checkpoint.

Any forced garbage collection operation must be available only through the existing admin-gated test
support surface and only when an explicit benchmark profiling configuration is enabled.

### Profile handling

- Create a mode-`0700` temporary profile directory outside the repository.
- Give each raw file mode `0600`.
- Never print profile contents.
- Analyze profiles locally into bounded summaries: top CPU stacks, retained-size categories,
  allocation categories, and checkpoint deltas.
- Inspect summaries for secrets and identifiers before committing them.
- Delete raw live profiles after the sanitized summaries are complete.
- Record deletion success in the run manifest.

## Phase 7: Focused Validation Before Deployment

Run formatting, package checks, and focused tests according to package ownership. At minimum cover:

- Fixed-rate scheduler behavior, including overruns and missed slots.
- Repetition aggregation and order independence.
- Aborted and skipped scenario exclusion.
- Run provenance rejection.
- Host sampler parsing and exact cgroup resolution.
- Replay-safe import accounting across simulated re-entry and restart.
- Profile sanitizer and deletion workflow.
- Existing sandbox runtime and observability tests.
- Existing large-result and population-overlap operational gates.

The executor must inspect status and diff before committing. Do not stage unrelated changes.

## Phase 8: Commit, CI, Image Verification, And Deployment

Keep instrumentation and harness changes in one normal commit labelled `[resource-data-gathering]`.
Create the repository's required `Run CI` trigger commit separately if the workflow still requires it.
Push normally and wait for the exact workflow associated with that commit.

Before deployment, verify on `root@$SERVER_IP`:

- Pulled image architecture is `linux/amd64`.
- Image digest changed to the intended build.
- Provenance matches the PR workflow and head commit, accounting for GitHub pull-request merge SHA
  labels.
- Bun, Deno, and Effect versions match the manifest.
- The image exposes the corrected diagnostic fields only through the admin gate.

Use the existing Coolify benchmark service. Preserve its current secrets and export a redacted
configuration hash before mutation.

Preserve the benchmark OTLP collector at the version already selected by the first plan:
`otel/opentelemetry-collector-contrib:0.136.0`, with a 128 MiB memory limit. Record its resources
separately, exclude them from Ryot component totals, and retain them in host totals.

Canonical deployment settings:

```text
SANDBOX_PROCESS_MODE=on-demand
SANDBOX_WORKER_CONCURRENCY=<scenario value>
SCHEDULER_DISABLE_DISPATCHERS=true
SERVER_LOG_LEVEL=info
SERVER_OTLP_ENDPOINT=<benchmark collector>
```

Do not add production resource limits or swap for this run. The watchdog is the safety boundary.

## Phase 9: Sampling Preflight

Before any canonical scenario:

1. Start the application and wait for health.
2. Run application sampling for ten minutes.
3. Run host sampling for the same ten minutes.
4. Verify cadence gates.
5. Verify exact container IDs and cgroup paths.
6. Verify OTLP traces, metrics, and logs arrive without rotation loss.
7. Verify watchdog dry-run targeting.
8. Verify profile capture and deletion with one hermetic no-op execution.

Stop if any preflight gate fails.

## Phase 10: Fresh-Process Idle Baselines

Collect five repetitions for each condition. Restart only Ryot before each repetition; keep
PostgreSQL and Redis running. Reset benchmark database state to the same fixture before each pair.

1. Dispatchers disabled, worker concurrency 2, idle for ten minutes.
2. Dispatchers enabled, worker concurrency 2, idle for ten minutes.

Record fresh-start and ten-minute values for Bun RSS, heap, external memory, cgroup memory, CPU,
database connections, Redis memory, and host availability.

The disabled baseline is used for workload comparisons. The enabled baseline quantifies background
product overhead omitted by the first run.

## Phase 11: Sandbox Concurrency Matrix

Run worker concurrency `1`, `2`, `3`, and `5`.

Run five rounds. Every round contains one repetition at each concurrency value. Use and record a
deterministic counterbalanced order so process age, cache warmth, host drift, and a fixed ascending
order do not favor one setting.

For every repetition:

1. Update only `SANDBOX_WORKER_CONCURRENCY`.
2. Restart only Ryot.
3. Verify the effective configuration through a non-secret diagnostic.
4. Wait for the fresh-process idle baseline.
5. Restore equivalent database state.
6. Run one hermetic workload.
7. Allow all workers to drain and capture recovery.

Hermetic workload:

- Submit twenty direct executions.
- Five durable host calls per execution.
- 25 ms per host call.
- 1 KiB final result.
- Deterministic, incompressible fixture data.

Collect:

- Throughput and request p50/p95/max latency.
- API health latency during load.
- Queue wait and execution duration.
- Active worker count and per-worker RSS.
- Aggregate Deno and Bun memory deltas.
- CPU time and CPU PSI.
- Spawn, replay, journal-byte, and host-call counts.
- Major faults, reclaim, and disk reads.
- PostgreSQL pool waits and active connections.
- Time to worker drain and memory recovery.

Do not reuse a process from one canonical concurrency repetition in another. Long-lived process
aging is measured only in the retention soaks.

## Phase 12: Live YouTube Music Concurrency Matrix

Use the same provider, query, and page size as the incident:

```text
provider: music.youtube-music
query: furious
pageSize: 20
```

For worker concurrency `1`, `2`, `3`, and `5`:

- Start from a fresh Ryot process and equivalent empty benchmark database.
- Search once and submit all twenty returned imports without client throttling.
- Run three counterbalanced rounds when provider behavior remains stable, with one fresh-process
  repetition for each concurrency value in every round.
- Stop the live group on provider throttling, authentication drift, schema drift, watchdog action,
  or repeated upstream failure.

Record the same measurements as the hermetic matrix, plus:

- Completed and failed imports by stage.
- Deadlock retries and terminal `40P01` failures.
- Related entity and relationship counts.
- Provider response encoded bytes.
- Per-script search and details worker peaks.
- Provider-client creation and response-processing checkpoint memory.

The run must distinguish search from details. Search must not be merged into the first import's
resource interval.

Do not treat lower deadlock frequency at lower concurrency as proof that the lock-order fix is
unnecessary. Require zero terminal deadlock failures at every tested value.

## Phase 13: YouTube Music Profile Runs

Run profiles separately from canonical measurement repetitions so profiling overhead does not alter
the baseline.

### Search profile

- Fresh Ryot process.
- Worker concurrency 1.
- Query `furious`, page size 20.
- Capture one Deno CPU profile, checkpoint memory series, heap data, and `smaps_rollup`.
- Repeat unprofiled 30 times to establish normal variance without importing results.

### Details profile

- Select one stable result from the search page.
- Execute the exact details script path used by provider import.
- Worker concurrency 1.
- Capture one Deno CPU profile, checkpoint memory series, heap data, and `smaps_rollup`.
- Repeat unprofiled 30 times using equivalent fresh executions.

### Five-worker live profile

- Start five distinct details executions together.
- Profile one selected worker; sample all five externally.
- Record whether memory is private anonymous, shared/file-backed, mapped runtime code, or response
  data.

The profile report must identify measured retention by phase. It must not recommend a provider code
change unless the profile identifies a dominant allocation or CPU stack.

## Phase 14: Bun Retention Soaks

Retention soaks intentionally keep one Bun process alive. Do not restart Ryot between waves.

For every soak, record fresh-process idle for ten minutes first. After every wave, wait until all
workers drain and sample recovery at 1, 5, and 15 minutes.

### Control soak

- 100 sequential direct no-host-call executions.
- Ten waves of ten executions.
- Small fixed result.

This measures runtime and workflow bookkeeping without provider population.

### Hermetic import soak

- Ten waves of twenty full provider imports.
- Standard fixture: five durable calls, ten related entities, ten suggestions, small result.
- Use unique deterministic identities while keeping graph shape constant.
- Do not reset the database or restart Bun between waves.

### Live YouTube Music details soak

- Ten waves of twenty direct details-script executions.
- Use the same twenty search results in a recorded rotating order.
- This exercises live provider parsing and sandbox workflow behavior without the populated-entity
  fast path suppressing later details calls.
- Stop on provider throttling or schema drift.

### Optional live full-import confirmation

Run only if a method is available to provide equivalent unpopulated identities without changing
production semantics. Do not reset PostgreSQL between waves because that invalidates the Bun-aging
measurement.

### Retention checkpoints

Capture Bun heap and memory summaries:

- Fresh idle.
- After wave 1.
- After wave 5.
- After wave 10.
- After the 15-minute final recovery.
- Immediately after benchmark-only forced garbage collection.

Calculate:

- RSS, heap-used, heap-total, external, array-buffer, and cgroup-memory slopes per 100 operations.
- Post-recovery delta from fresh idle.
- Post-GC delta from fresh idle.
- Active workflow/entity/cache counts.
- Retained-size growth by heap category.
- Native/file-backed growth from `smaps_rollup`.

Classify the result:

- Heap retention: heap remains above baseline and profiles identify retained owners.
- Native/external retention: heap recovers but external or anonymous RSS grows.
- Allocator high-water behavior: heap and live allocations recover but RSS remains reserved.
- Durable-state growth: memory follows active or retained workflow state.
- No material retention: post-recovery values remain within the declared tolerance.

Declare the tolerance before the run. Recommended starting threshold: post-GC RSS or heap growth
greater than 10% of fresh idle, or a positive slope that projects above 100 MiB per 1,000 equivalent
operations, is material and requires attribution.

## Phase 15: Result Artifacts

Each scenario artifact must include:

- Scenario configuration and effective worker concurrency.
- Fresh-process or long-lived-process classification.
- Repetition and run identity.
- Application and host cadence health.
- Pre, peak, post-recovery, and delta memory values.
- Per-worker lifecycle and observed/missing RSS peaks.
- CPU, pressure, faults, reclaim, and disk deltas.
- Queue, spawn, replay, journal, and host-call deltas.
- Request outcomes and phase summaries.
- Container metadata and bounded journal warnings.
- Watchdog and OOM evidence.
- Profile summary references when applicable.

The final report must separate:

- Correctness conclusions.
- Resource conclusions.
- Profiling attribution.
- Bun retention classification.
- Evidence affected by missing samples or provider variability.
- Supported, rejected, and unresolved hypotheses.

Do not recommend architecture in the measurement report. Record decision inputs such as the best
throughput/headroom point, but make architecture decisions in a separate follow-up review.

## Phase 16: Decision Outputs

The completed data must be sufficient to answer:

1. Is worker concurrency 2 the correct default for the 2-vCPU/4-GB profile?
2. Does concurrency 3 improve throughput enough to justify its memory and CPU cost?
3. Does concurrency 5 reduce throughput or API responsiveness through CPU contention?
4. Which YTM phase accounts for its worker being much larger than a hermetic worker?
5. Is YTM memory primarily V8 heap, native/external memory, mapped files, or response data?
6. Does Bun retain memory after workers and workflows drain?
7. If Bun RSS grows, is the growth live heap, native memory, allocator reservation, or durable state?
8. How much replay and process-spawn work remains after the correctness and concurrency changes?
9. Is full-import admission still needed after concurrency 2, based on measured non-sandbox phase
   overlap and API/database pressure?
10. Is replay redesign the next highest-impact resource change?

## Phase 17: Teardown

After artifacts are complete:

1. Stop benchmark load generation.
2. Restore the benchmark service's pre-run non-secret configuration.
3. Remove temporary profiler flags and admin-gated profiling enablement.
4. Delete raw live and hermetic profile files outside the repository after sanitized summaries are
   verified.
5. Remove temporary host sampler and watchdog files.
6. Verify no benchmark process remains.
7. Revoke temporary Coolify and benchmark credentials.
8. Record teardown and raw-profile deletion status in the manifest.

Do not stop or modify unrelated Coolify resources.
