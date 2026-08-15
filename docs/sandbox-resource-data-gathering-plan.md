# Sandbox Resource Data-Gathering Plan

## Purpose

Implement production-safe resource telemetry and a reproducible benchmark harness, deploy that instrumentation to the dedicated `testing` VM, and collect a baseline for the current architecture. This plan gathers evidence only. It must not change workload admission, worker concurrency, replay semantics, retry behavior, payload limits, or container limits.

The next agent should execute this plan end to end without making architecture decisions. It should stop and report if a safety gate, credential prerequisite, or CI/deployment check fails.

## Execution Credentials

The Coolify credential is deliberately not stored in this tracked file. When launching the executing agent, provide the root Coolify API token from this investigation through its secure prompt context or export it into the agent process environment as `COOLIFY_TOKEN`. The agent must stop and ask for it if `COOLIFY_TOKEN` is absent; it must not substitute a token from Git history, shell history, logs, or repository files.

Use:

- Coolify base URL: `https://admin.ryot.io/api/v1`
- Authentication header: `Authorization: Bearer $COOLIFY_TOKEN`
- SSH: `ssh root@62.238.120.82`
- GitHub authentication: the existing authenticated `gh` session; verify with `gh auth status` before committing or waiting for CI

Example read-only connectivity check:

```bash
test -n "$COOLIFY_TOKEN"
curl --fail-with-body --silent --show-error \
  --header "Authorization: Bearer $COOLIFY_TOKEN" \
  --header "Accept: application/json" \
  https://admin.ryot.io/api/v1/servers
ssh -o BatchMode=yes -o ConnectTimeout=10 root@62.238.120.82 true
gh auth status
```

Never print the token, enable shell tracing while it is in scope, place it directly in a command argument instead of the environment variable, or persist it in benchmark artifacts. Revoke it after the data-gathering task.

## Confirmed Incident Context

The original incident followed 20 rapid Add actions for YouTube Music search results. The client submitted 20 independent imports. The production host had 2 vCPUs, 3.7 GiB usable RAM, no swap, and no container resource limits.

Host evidence from the second forced reboot proved:

- Linux invoked the global OOM killer at `2026-09-13 17:02:33 UTC`.
- The OOM killer selected Ryot's `bun` process, which had about 503 MiB RSS.
- Exactly five Ryot `deno` processes were active, matching the then-fixed sandbox worker concurrency of five.
- Those Deno processes used about 903 MiB RSS in aggregate.
- Bun and Deno therefore used about 1.4 GiB RSS before PostgreSQL, Redis, Coolify, the kernel, page tables, and unrelated services.
- The first incident boot logged continuous `Under memory pressure, flushing caches` messages from `16:54:09 UTC` until the forced reboot.
- The second failure happened because `restart: unless-stopped` restored Ryot and its durable work resumed.

The queue bound was honored. The missing data is why each worker was large, why Bun reached 503 MiB, how replay and payload sizes scale, which import phases overlap outside the sandbox queue, whether memory returns to baseline, and which component caused CPU and disk amplification.

## Fixed Decisions

- Canonical self-hosted baseline: 2 vCPUs and 4 GB RAM, complete Ryot stack, no required swap.
- Instrumentation: keep low-overhead production metrics; keep detailed sampling admin-gated or benchmark-only.
- Workloads: deterministic hermetic workloads first, then a controlled live YouTube Music comparison.
- Results: preserve machine-readable JSON and a checked-in Markdown report.
- Process mode: preserve the current default, `on-demand`.
- Sandbox worker concurrency: preserve the current value, `5`.
- Use the existing PR branch and image tag: PR `#1832`, branch `ultra-rewrite`, `ghcr.io/ignisda/ryot:pr-1832`.
- Use the pre-created Coolify service; do not create another project, environment, server, or service.

## Dedicated Environment

### Host

- SSH: `root@62.238.120.82`
- Coolify server name: `testing`
- Coolify server UUID: `oiineqpck49lz4orarclegvp`
- CPU: 2
- RAM: 4,000,034,816 bytes
- Swap: none
- Disk: 38 GiB ext4, initially about 7% used
- Kernel observed during planning: Linux `7.0.0-30-generic`
- Docker observed during planning: `29.8.0`
- Cgroups: v2
- Docker logging driver: `json-file`

### Coolify Resource

- Domain: `https://ur-testing.ryot.io`
- Service name: `ryot-benchmark`
- Service UUID: `a2dt5g6dbmpwqwllnzsho8jc`
- Ryot application UUID: `x95tavztbij6ktz2eblz1jlh`
- Redis database UUID: `2ahlwqbja9iadvw4ls3suvpq`
- PostgreSQL database UUID: `qqxjvomd4g3clbeura7oe9vr`
- Image currently configured: `ignisda/ryot:pr-1832`
- Current compose has no CPU or memory limits.
- Current compose has no `SERVER_OTLP_ENDPOINT`, so telemetry export is disabled.
- Current compose has no `SANDBOX_PROCESS_MODE`, so the runtime uses `on-demand`.

Use a root Coolify API token supplied at execution through a local `COOLIFY_TOKEN` environment variable. Never write a token, database password, admin access token, or complete environment response to the repository, terminal transcript, benchmark artifacts, or report.

## Non-Goals

Do not implement or test any proposed fix in this phase:

- Do not limit client import concurrency.
- Do not add an import admission queue.
- Do not change sandbox worker concurrency.
- Do not enable warm process mode.
- Do not split the sandbox into another production service.
- Do not change live-process or durable replay semantics.
- Do not change lifecycle fan-out.
- Do not change retry schedules or timeouts.
- Do not lower journals, bridge responses, HTTP responses, or heap limits.
- Do not add Ryot, PostgreSQL, or Redis cgroup limits to the canonical baseline.
- Do not add swap to the canonical VM.
- Do not optimize code based on measurements during this task.

If instrumentation exposes an unrelated correctness bug, record it in the report but do not fix it unless it prevents data collection. A prerequisite fix must be isolated, explained, and approved by the user first.

## Deliverables

Create and commit:

1. Production-safe Effect metrics exported through OTLP when `SERVER_OTLP_ENDPOINT` is configured.
2. Correlating trace attributes for sandbox replay and import phases.
3. An expanded admin-gated runtime snapshot suitable for sub-second benchmark sampling.
4. A deterministic remote benchmark driver that targets an already deployed API instead of starting the normal local E2E global setup.
5. A host sampler and result summarizer.
6. Focused tests for telemetry export, metric bookkeeping, snapshot decoding, and benchmark workload behavior.
7. `docs/benchmarks/sandbox-resource-baseline/<run-id>/manifest.json`.
8. `docs/benchmarks/sandbox-resource-baseline/<run-id>/summary.json`.
9. One JSON file per completed scenario under `docs/benchmarks/sandbox-resource-baseline/<run-id>/scenarios/`.
10. `docs/benchmarks/sandbox-resource-baseline/<run-id>/report.md`.

Raw secrets, authorization headers, complete SQL text, full provider responses, user identifiers, external entity identifiers, and unbounded logs must not enter artifacts.

## Phase 1: Production Metrics

### OTLP metrics exporter

Update `kernel/backend/src/lib/infrastructure/observability.ts`:

- Import `OtlpMetrics` from `effect/unstable/observability`.
- When `SERVER_OTLP_ENDPOINT` is configured, export metrics to `<base>/v1/metrics` with the same validated headers and resource used by traces.
- Keep traces at `<base>/v1/traces`.
- Use cumulative temporality.
- Use the Effect default 10-second metric export interval. Do not add a production configuration option only for this investigation.
- Keep telemetry disabled when the endpoint is absent.
- Reuse `service.name=ryot-backend` and `deployment.environment`.
- Merge logging, tracing, and metrics without creating two independent HTTP/serialization dependency graphs where a shared layer is sufficient.

Extend `e2e/src/api/kernel/system/observability.test.ts`:

- Wait for both `/v1/traces` and `/v1/metrics` requests.
- Assert that headers and resource attributes match on both signals.
- Assert representative sandbox metrics by name and type.
- Do not assert Effect serialization internals beyond the fields Ryot owns.

### Metric ownership

Add a small infrastructure-owned metrics module next to the sandbox runtime. Keep metric declarations and updates together; do not create a general metrics abstraction.

Use these metric names and bounded attributes:

| Metric                                  | Type      | Unit          | Attributes                  |
| --------------------------------------- | --------- | ------------- | --------------------------- |
| `ryot.sandbox.executions`               | counter   | `{execution}` | `outcome`, `kind`           |
| `ryot.sandbox.active_executions`        | gauge     | `{execution}` | none                        |
| `ryot.sandbox.processes.spawned`        | counter   | `{process}`   | `dedicated`                 |
| `ryot.sandbox.processes.completed`      | counter   | `{process}`   | `outcome`                   |
| `ryot.sandbox.worker_rss`               | gauge     | `By`          | none; aggregate all workers |
| `ryot.backend.rss`                      | gauge     | `By`          | none                        |
| `ryot.backend.heap_used`                | gauge     | `By`          | none                        |
| `ryot.backend.external_memory`          | gauge     | `By`          | none                        |
| `ryot.sandbox.execution_duration`       | histogram | `ms`          | `outcome`, `kind`           |
| `ryot.sandbox.runner_response_size`     | histogram | `By`          | `outcome`, `kind`           |
| `ryot.sandbox.workflow_replays`         | counter   | `{replay}`    | `outcome`, `kind`           |
| `ryot.sandbox.workflow_replay_duration` | histogram | `ms`          | `outcome`, `kind`           |
| `ryot.sandbox.workflow_journal_size`    | histogram | `By`          | `kind`                      |
| `ryot.sandbox.workflow_journal_entries` | histogram | `{entry}`     | `kind`                      |
| `ryot.sandbox.host_calls`               | counter   | `{call}`      | `function`, `outcome`       |
| `ryot.provider_import.phase_duration`   | histogram | `ms`          | `phase`, `outcome`          |
| `ryot.provider_import.active`           | gauge     | `{import}`    | none                        |
| `ryot.provider_import.completed`        | counter   | `{import}`    | `outcome`, `failure_stage`  |

Allowed values must be finite code-owned enums. In particular:

- Do not use execution ID, user ID, plugin ID, installation ID, provider ID, script ID, external ID, URL, error message, or PID as metric attributes.
- `kind` is the finite sandbox manifest kind.
- `function` is restricted to the finite registered host-function names.
- `phase` is restricted to `population`, `provider-import-automation`, and useful code-owned population subphases if those subphases are instrumented.
- IDs and provider/script slugs may remain trace attributes for correlation.

Update metrics at existing ownership points rather than wrapping unrelated callers:

- Process lifecycle and aggregate RSS: `kernel/backend/src/lib/infrastructure/sandbox-runtime/runtime.ts`.
- Sandbox execution duration, response bytes, and outcome: `kernel/backend/src/lib/infrastructure/sandbox-runtime/service.ts`.
- Replay count, replay duration, journal entries, and journal bytes: `kernel/backend/src/modules/sandbox/sandbox-script-workflow.ts`.
- Host-call count and outcome: bridge/durable host dispatcher ownership points.
- Import active/completed and phase duration: `kernel/backend/src/modules/provider-entities/entity-import-workflow.ts` and the population workflow boundaries.

Use a scoped one-second sampler for process gauges. The sampler must terminate with its owning layer. Metric export stays at 10 seconds; the benchmark endpoint provides higher-resolution observations.

## Phase 2: Admin-Gated Detailed Snapshot

Extend the existing `sampleSandboxRuntime` test-support operation rather than adding a public endpoint. Update its schema, backend implementation, and fixture together:

- `packages/contract/src/modules/test-support/schemas.ts`
- `packages/contract/src/modules/test-support/contract.ts` only if the operation shape requires it
- `kernel/backend/src/modules/test-support/operational-gate-service.ts`
- `kernel/backend/src/modules/test-support/routes.ts` only if the handler changes
- `e2e/src/fixtures/kernel/operational-gate.ts`

The snapshot must contain:

- Timestamp in epoch milliseconds.
- Bun: RSS, heap total, heap used, external memory, array buffers, user CPU microseconds, system CPU microseconds.
- Deno aggregate: process count, RSS, user CPU ticks, system CPU ticks.
- Per Deno worker: PID, RSS, user CPU ticks, system CPU ticks, start-time ticks. PID is allowed on this admin-gated diagnostic surface, not as an OTLP metric attribute.
- Lifecycle counters: total spawned, total completed, active process count, total sandbox executions, active executions, maximum active executions.
- Replay counters: total replays started/completed/failed and total journal bytes observed. Use monotonic process-lifetime counters so scenario results can calculate deltas without reset races.
- Linux cgroup v2 data when available: `memory.current`, `memory.peak`, parsed `memory.max`, `memory.events` (`low`, `high`, `max`, `oom`, `oom_kill`), `pids.current`, and `cpu.stat` usage/user/system microseconds.
- Return explicit `null` for unsupported process/cgroup fields instead of silently returning zero.

Read `/proc/<pid>/stat`, `/proc/<pid>/status`, and `/sys/fs/cgroup` defensively. A worker may exit between listing and reading; omit that worker rather than failing the sample. Keep macOS/test fallback behavior.

Add unit tests for parsers using fixed strings. Do not mock modules or `/proc`; expose pure parsers and test those directly.

## Phase 3: Deterministic Benchmark Driver

The existing `e2e/src/api/kernel/sandbox/sandbox-runtime-benchmark.test.ts` is an opt-in local benchmark, but its direct on-demand sample reads runtime state after the worker has exited. Its `workerRssBytes` therefore misses the peak that caused the incident.

Keep that test useful for local regression checks, but extract duplicated workload source/building logic into a focused benchmark support module. Add a standalone remote driver under `e2e/src/scripts/sandbox-resource-baseline/` that:

- Does not invoke `e2e/global-setup.ts`.
- Requires `BENCHMARK_API_URL`, `BENCHMARK_FRONTEND_URL`, and `BENCHMARK_ADMIN_ACCESS_TOKEN`.
- Refuses to run unless the target hostname is `ur-testing.ryot.io`, unless an explicit local-development override is set.
- Creates fresh benchmark users and a uniquely named private benchmark plugin through existing typed test-support/admin APIs.
- Cleans up its plugin and users when possible, but preserves failed execution IDs in the result.
- Polls `sampleSandboxRuntime` every 200 ms from before workload submission until five minutes after completion or until recovery criteria are met.
- Records workload results and diagnostics as structured data, not console prose.
- Uses `Schema` to decode its configuration and result artifacts.
- Writes atomically to a caller-provided output directory.

### Hermetic scripts

Provide deterministic scripts whose context controls:

- Number of durable host calls: `0`, `1`, `5`, or `10`.
- Returned payload size: `1 KiB`, `1 MiB`, or `4 MiB` within current limits.
- Related entity count: `0`, `10`, or `100`.
- Suggestion relationship count: `0`, `10`, or `100`.
- Per-call delay: `0`, `25`, or `250` ms.
- Terminal outcome: success, typed failure, or timeout fixture.

Use existing deterministic host functions such as preferences/cache operations for replay tests. Do not depend on an external network service for the primary hermetic matrix. Ensure generated payloads are deterministic and do not use compression-friendly all-zero strings when measuring serialization memory.

For full-import scenarios, invoke the same provider import HTTP API used by the provider-add UI. Do not benchmark only the lower-level sandbox enqueue endpoint.

### Continuous sampling

For every scenario, preserve:

- All 200 ms application snapshots.
- Workload start, admission, terminal, and recovery timestamps.
- Execution IDs and trace IDs in the temporary raw run only; hash or remove them from committed artifacts.
- Request count, success/failure count, latency, and failure stage.
- Counter deltas calculated from pre/post snapshots.
- Peak and p50/p95 application RSS and Deno aggregate RSS.
- Peak worker count and per-worker peak RSS.
- Bun heap and external-memory peaks.
- Cgroup memory current/peak and event deltas.
- CPU use deltas.
- Time to return within 10% of pre-scenario Bun RSS, reported as `null` if it does not recover within five minutes.

## Phase 4: Host Sampler And Safety Watchdog

Add a small POSIX-compatible host sampler under `e2e/src/scripts/sandbox-resource-baseline/`. It runs over SSH on the dedicated VM and records one JSON sample per second.

Capture:

- `/proc/meminfo`: `MemTotal`, `MemAvailable`, `Cached`, `SReclaimable`, `Dirty`, `Writeback`.
- `/proc/pressure/{cpu,memory,io}` complete `some` and `full` lines.
- `/proc/vmstat`: `pgfault`, `pgmajfault`, `pgscan_*`, `pgsteal_*`, `oom_kill`.
- `/sys/block/sda/stat` counters.
- Docker streaming stats for Ryot, PostgreSQL, Redis, and the telemetry capture container: CPU, memory, memory percentage, block input/output, PIDs.
- Container IDs, names, image digests, start times, restart counts, OOM status, and cgroup paths before and after each scenario.
- Kernel journal warnings/OOM records for the scenario window.

Do not install a monitoring suite on the VM. Use existing procfs, cgroup v2, Docker, and journal data so the measurement tool has a small and known footprint.

Before load testing, install a host-side watchdog owned by the benchmark session. It must stop only the `ryot-benchmark` compose project if any condition remains true for five consecutive seconds:

- `MemAvailable < 384 MiB`.
- Memory PSI `full avg10 > 10`.
- Kernel `oom_kill` counter increases.
- SSH remains available but the Ryot cgroup exceeds 2.5 GiB current memory.

The watchdog is a safety mechanism, not a product resource limit. Record every trigger as a failed scenario and do not continue to a higher load. Remove the watchdog when the benchmark session ends.

## Phase 5: Artifact Schema And Summarizer

Use this directory layout:

```text
docs/benchmarks/sandbox-resource-baseline/<UTC-run-id>/
  manifest.json
  summary.json
  report.md
  scenarios/
    00-idle.json
    01-direct-no-host.json
    ...
```

`manifest.json` must include:

- Run ID and UTC timestamps.
- Git implementation commit and CI-trigger commit.
- PR number and branch.
- Docker tag, pulled digest, image architecture, and OCI revision label.
- Bun and Deno versions from the deployed container.
- Host CPU count/model, exact RAM bytes, swap bytes, kernel, Docker version, filesystem, disk size, and cgroup version.
- Redacted compose SHA-256 and the values of non-secret resource-relevant settings.
- Sample intervals and scenario configuration.
- Whether OTLP, host sampler, and watchdog were healthy for the complete run.

Each scenario JSON must include:

- Configuration and repetition number.
- Outcome and stop reason.
- Summary statistics.
- Application sample series.
- Host/container sample series.
- Sanitized trace-derived replay and phase summary.
- Recovery observations.

`summary.json` must compare scenarios without interpreting fixes. Include deltas and scaling ratios for concurrency, replay count, payload size, and full-import fan-out.

`report.md` must state:

- What was measured and what was not.
- Reproduction fidelity and known differences from the incident host.
- Idle baseline.
- Per-worker and aggregate memory.
- Bun memory growth and recovery.
- Replay scaling.
- CPU, major-fault, page-reclaim, and disk-read scaling.
- Full-import phase overlap.
- Live YouTube Music comparison.
- Any OOM/watchdog events.
- Evidence-backed conclusions only.
- Which architectural hypotheses are supported, rejected, or still unresolved.

Do not recommend or implement architecture in the baseline report. A later task should use the report to choose changes.

## Phase 6: Focused Validation Before Commit

Run formatting/checks according to package ownership, then focused tests. At minimum:

```bash
bun turbo --filter=@ryot-app/kernel-backend check
bun turbo --filter=@ryot-app/contract check
bun turbo --filter=@ryot-app/e2e check
bun turbo --filter=@ryot-app/kernel-backend test
bun turbo --filter=@ryot-app/e2e test --only -- 'src/api/kernel/system/observability.test.ts'
RUN_SANDBOX_BENCHMARKS=1 bun turbo --env-mode=loose --force --output-logs=full --filter=@ryot-app/e2e test --only -- 'src/api/kernel/sandbox/sandbox-runtime-benchmark.test.ts'
```

The local sandbox benchmark is a validation run, not the canonical 4 GB baseline. Do not add its measurements to the canonical report.

Before committing, inspect `git status`, `git diff`, and `git log --oneline -10`. Do not modify or stage unrelated user changes.

## Phase 7: Commit, Trigger CI, And Verify Image

The repository was on `ultra-rewrite`, tracking `origin/ultra-rewrite`, and was five commits ahead during planning. PR `#1832` was open and draft. Preserve all existing commits and changes.

Create one normal commit containing only instrumentation, benchmark tooling, tests, and documentation. Use a detailed message consistent with repository history, for example:

```text
feat(observability): measure sandbox resource behavior

Export bounded-cardinality sandbox and import metrics, expose detailed
admin-gated runtime samples, and add deterministic resource baseline tooling
for the canonical 2-vCPU/4-GB self-hosted profile.
```

Then create the explicitly requested empty CI-trigger commit:

```bash
git commit --allow-empty -m "ci: Run CI for sandbox resource baseline image"
```

The exact substring `Run CI` is required. `.github/workflows/main.yml:48-59` reads the PR head commit message and skips builds without it.

Push the branch normally; never force-push:

```bash
git push origin ultra-rewrite
```

Record the empty commit SHA as `CI_SHA`. Verify that the PR head matches it. Wait for the `Main` workflow associated with `CI_SHA`, rather than sleeping blindly:

```bash
gh run list --workflow Main --branch ultra-rewrite --commit "$CI_SHA"
gh run watch <run-id> --exit-status
```

The workflow builds both `linux/amd64` and `linux/arm64` and publishes the PR tag. Allow at least 15 minutes; continue waiting while the matching `build-docker` job is legitimately running, up to 45 minutes. Stop on cancellation or failure and report the failing job.

On the testing VM, pull and verify before deployment:

```bash
docker pull ghcr.io/ignisda/ryot:pr-1832
docker image inspect ghcr.io/ignisda/ryot:pr-1832
```

Verify all of the following programmatically:

- The image is `linux/amd64` on the testing VM.
- OCI label `org.opencontainers.image.revision` equals `CI_SHA`.
- The pulled digest differs from the pre-build digest unless no prior image existed.
- The image contains the expected Bun and Deno executables.

Do not deploy if the revision label does not equal `CI_SHA`.

## Phase 8: Configure And Deploy `ryot-benchmark`

Use the existing Coolify service `a2dt5g6dbmpwqwllnzsho8jc`. Do not create another resource.

Before changing it:

- Export its current compose and non-secret metadata to a temporary encrypted or permission-restricted location outside the repository.
- Record only the redacted compose hash in the benchmark manifest.
- Verify its three containers are the dedicated benchmark Ryot, Redis, and PostgreSQL services.
- Verify no production data or unrelated resources are attached.

Modify the benchmark service as needed to:

- Keep `ghcr.io/ignisda/ryot:pr-1832` as the Ryot image.
- Set `FRONTEND_URL=https://ur-testing.ryot.io`.
- Use fresh benchmark-only database and admin secrets.
- Set `SERVER_OTLP_ENDPOINT` to the benchmark OTLP capture receiver.
- Keep `SERVER_LOG_LEVEL=info` for every canonical scenario so debug span-completion logging does not distort CPU and disk measurements. A short preflight may use `debug` to verify correlation, but restore `info` and restart Ryot before idle stabilization and data collection.
- Keep `SANDBOX_PROCESS_MODE=on-demand` explicitly.
- Keep scheduler dispatchers disabled during hermetic measurements with `SCHEDULER_DISABLE_DISPATCHERS=true`; record this difference. Run a separate idle observation with dispatchers enabled if scheduler overhead is needed.
- Preserve worker concurrency and every production limit unchanged.
- Preserve no-swap and no-limit canonical behavior.

Add a pinned, temporary OTLP capture sidecar to this benchmark compose. Use `otel/opentelemetry-collector-contrib:0.136.0` with OTLP/HTTP enabled and file exporters for traces and metrics. Give the collector its own 128 MiB container memory limit so telemetry cannot cause a host-wide failure. Store output in a benchmark-only mounted directory or named volume. Record the collector's memory separately and exclude it from Ryot component totals, while retaining it in host totals.

Force Coolify to pull/redeploy the service after image verification. Poll deployment status and `https://ur-testing.ryot.io/api/system/health`; do not infer success from a queued deployment response. After health succeeds:

- Verify the running container image digest and OCI revision label again.
- Verify `/v1/traces` and `/v1/metrics` are reaching the capture receiver.
- Verify the admin-gated sample endpoint returns cgroup and process fields.
- Verify `SERVER_LOG_LEVEL=info` after any debug preflight.
- Capture a fresh pre-workload manifest.

## Phase 9: Canonical Workload Matrix

Run scenarios in this exact order. Do not parallelize scenarios. Stabilize until Bun RSS changes by less than 5% over two minutes before each scenario, with a maximum wait of ten minutes.

Run five repetitions for hermetic scenarios unless a safety gate stops the run. Use unique users, plugin slugs, and external IDs.

### Group A: baseline and direct sandbox isolation

1. Idle for 10 minutes after startup.
2. One direct sandbox execution with no host calls and 1 KiB output.
3. One direct execution with 1 durable host call.
4. One direct execution with 5 durable host calls.
5. One direct execution with 10 durable host calls.
6. One direct execution with 1 MiB output.
7. One direct execution with 4 MiB output.

This group isolates process startup, replay, and serialization scaling.

### Group B: sandbox concurrency

1. Submit 1 identical execution.
2. Submit 2 identical executions concurrently.
3. Submit 5 identical executions concurrently.
4. Submit 20 identical executions concurrently, allowing the existing five-worker queue to schedule them.

Use the five-host-call, 1 KiB-output workload. This group answers whether aggregate RSS scales with active workers and whether queued workflows materially increase Bun memory.

### Group C: complete provider imports

Invoke the public provider import path with deterministic details:

1. One import with no related entities.
2. One import with 10 related entities and 10 suggestions.
3. One import with 100 related entities and 100 suggestions.
4. Submit 2 standard imports concurrently.
5. Submit 5 standard imports concurrently.
6. Submit 20 standard imports concurrently.

The standard import uses 10 related entities, 10 suggestions, five durable host calls, 25 ms host-call delay, and a small final payload. Capture population, lifecycle-dispatch, and provider-import-automation phase overlap.

### Group D: controlled failures

1. Five concurrent typed provider failures.
2. Five concurrent sandbox timeouts.
3. Twenty submitted typed failures.

Do not run twenty timeout cases. Record retry count, process spawn count, replay count, time to terminal status, and memory recovery.

### Group E: restart recovery

Run only if Groups A-D complete without a watchdog trigger and peak `MemAvailable` remains above 768 MiB.

1. Submit 20 standard imports.
2. Wait until five Deno workers are active and the remaining imports are pending.
3. Restart only the Ryot application container through Coolify; do not reboot the VM and do not restart PostgreSQL or Redis.
4. Confirm durable work resumes.
5. Observe until terminal completion or a safety stop.

This reproduces the second-boot amplification while preserving the database and Redis state.

## Phase 10: Live YouTube Music Comparison

Run only after all hermetic artifacts have been copied off the VM and Groups A-D pass their safety gates.

- Use the shipped media plugin and YouTube Music provider.
- Search for `furious` with `pageSize=20`, matching the incident.
- Preserve the returned response count and sanitized size, but do not commit titles, external IDs, URLs, or provider response bodies.
- Start from a fresh benchmark database so prior global population does not turn imports into cache hits.
- Run one import and wait for full completion.
- If `MemAvailable` remains above 1 GiB and no sustained PSI/watchdog condition occurs, reset to another fresh database and run five concurrent imports.
- If the five-import run remains above the same safety threshold, reset again and reproduce 20 rapid imports once.
- Do not repeat the 20-item live run.
- Record upstream status classes, response sizes, host-call count, replay count, retry count, phase duration, and failure stage. Do not record authorization headers or bodies.

Resetting for live scenarios must recreate only the disposable `ryot-benchmark` PostgreSQL/Redis data. Never operate on `ryot-ultra-rewrite` or another Coolify resource.

## Phase 11: Recovery And Teardown

After every scenario:

- Continue sampling for at least five minutes.
- Record whether Bun RSS returns within 10% of its pre-scenario value.
- Record whether all Deno workers exit in on-demand mode.
- Record PostgreSQL/Redis memory recovery.
- Copy scenario output and telemetry off the VM before proceeding.

At the end:

- Stop the workload driver and host watchdog.
- Flush and copy OTLP output.
- Copy Docker logs and relevant journal windows.
- Sanitize artifacts locally and validate their schemas.
- Leave `ryot-benchmark` stopped unless the user explicitly asks to keep it running.
- Do not delete the Coolify resource.
- Remove temporary host scripts and uncommitted raw files containing IDs or secrets.
- Revoke or rotate benchmark-only secrets if they were exposed outside Coolify.

## Stop Conditions

Stop the current scenario immediately and do not advance load if:

- The watchdog triggers.
- The kernel OOM counter increases.
- SSH or Coolify loses host reachability.
- The API remains unhealthy for more than 30 seconds outside the restart scenario.
- PostgreSQL reports corruption, recovery failure, or repeated I/O errors.
- OTLP capture or either sampler has a gap longer than five seconds during the active workload.
- A scenario produces unbounded artifact growth.
- Live YouTube Music returns throttling or provider drift that makes comparisons invalid.

Preserve partial artifacts with `outcome: "aborted"` and a machine-readable stop reason.

## Completion Criteria

This data-gathering task is complete only when:

- Production-safe metrics and their focused tests are committed.
- The remote benchmark and host sampler can reproduce deterministic scenarios.
- CI built `ghcr.io/ignisda/ryot:pr-1832` from the recorded `Run CI` commit.
- The exact image revision was deployed to `ryot-benchmark`.
- At least idle, direct 0/1/5/10 replay, concurrency 1/2/5, and complete-import 1/2/5 hermetic scenarios produced valid artifacts.
- Higher-risk 20-item, failure, restart, and live scenarios either completed or have explicit safety-stop evidence.
- JSON artifacts pass schema validation and contain no secrets or high-cardinality raw identifiers.
- The report distinguishes measured facts from unresolved hypotheses.
- No architectural behavior change was included.

The final response to the user should provide the implementation commit, CI-trigger commit, workflow URL, image digest, Coolify deployment UUID, artifact directory, completed/aborted scenario list, and the shortest factual summary of the baseline. It must not propose fixes unless the user asks for the subsequent architecture decision task.
