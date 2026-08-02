# Sandbox Resource Benchmark

Tooling for the sandbox resource runs under `docs/benchmarks/sandbox-resource-baseline/`. It targets
one dedicated benchmark deployment and never runs as part of the normal E2E suite.

## Layout

- `run.ts` is the driver. One invocation runs one phase and appends itself to the run manifest.
- `scenarios.ts` declares every scenario and the counterbalanced order of the concurrency matrices.
- `scenario-runner.ts` prepares a fresh process, submits a wave, and captures one repetition.
- `soak-run.ts` keeps one Bun process alive across waves and records retention checkpoints.
- `profile-run.ts` arms one profiled execution, then copies its raw profiles off the host.
- `statistics.ts`, `aggregate.ts`, `phases.ts`, `retention.ts` derive metrics; `provenance.ts` rejects
  artifacts that cannot be compared; `report.ts` renders the tables.
- `host/` is a self-contained tool compiled for the benchmark VM (`host/build.ts`). It samples the
  host and containers, collects application snapshots, and runs the safety watchdog.
- `profiles/` turns raw CPU profiles, heap snapshots and checkpoints into bounded, sanitized
  summaries and deletes the raw files.

## Sampling

Both samplers use the deadline-based scheduler in `cadence.ts`: a sample starts at its slot, samples
never overlap, and an overrun records missed slots instead of drifting. Application snapshots are
collected **on the benchmark host**, because the public route costs more than the 200 ms interval in
network latency; the admin token lives in a mode-0600 file on that host for the run only.

Per-scenario cgroup peaks need a descriptor that performed the `memory.peak` reset, so the host
sampler holds that descriptor and the driver triggers a reset with `SIGUSR1` before each scenario.
An unverified reset reports `null` rather than a lifetime peak dressed up as a scenario peak.

## Running

Environment: `SERVER_IP`, `BENCHMARK_API_URL`, `BENCHMARK_FRONTEND_URL`,
`BENCHMARK_ADMIN_ACCESS_TOKEN`, `BENCHMARK_RUN_ID`, `BENCHMARK_OUTPUT_DIR`, `BENCHMARK_RAW_DIR`
(outside the repository), and optionally `BENCHMARK_IMAGE_DIGEST`.

```bash
bun run src/scripts/sandbox-resource-baseline/run.ts init
bun run src/scripts/sandbox-resource-baseline/run.ts setup
bun run src/scripts/sandbox-resource-baseline/run.ts preflight
bun run src/scripts/sandbox-resource-baseline/run.ts hermetic
bun run src/scripts/sandbox-resource-baseline/run.ts soak soak-control
bun run src/scripts/sandbox-resource-baseline/summarize-run.ts <output-directory>
```

`setup` creates the benchmark user and workload plugin; capture the fixture database template from
that state before the matrices so every repetition starts from equivalent data.

`variance` runs both unprofiled YouTube Music scenarios. Pass `ytm-search-variance` or
`ytm-details-variance` to run only one. Direct details executions resolve the shipped script after
each database restore, because changing the installed plugin archive can replace its script ID.

## Safety

The watchdog stops only the resolved Ryot container, by full container ID, and never PostgreSQL or
Redis. Each repetition records watchdog triggers and cgroup OOM counters; a trigger marks the
repetition `aborted` and the series stops rather than advancing to a higher concurrency.

## Request timing

Every request records end-to-end `latencyMs` plus a queue/execution split:

- `queueWaitMs`: submit to first work start (first Deno worker spawn for direct executions,
  first import phase start for `import`/`live-import`).
- `executionMs`: summed work time (worker lifetimes for direct executions; replay-merged logical
  phase durations for imports, so a replayed attempt never double-counts time).
- `attempts`: recorded tries behind the request (worker attempts for direct; phase attempts
  including replays and interrupts for imports — the two are not comparable).

`queueWaitMs + executionMs` stays within `latencyMs`; the remainder is inter-phase gaps plus
terminal-poll granularity. A request whose key has no timing record (unparseable job id, lost
phase segments after a backend restart) keeps nulls rather than a fabricated zero.

## Truncated runs

A wave or request timeout, or a wave that fails over half its requests, ends the measurement
early without failing the driver: the artifact records `outcome: "truncated"` (or `"failed"`
when its requests failed) with a machine-readable `stopReason` (`wave-request-timeout`,
`wave-failures`, `request-timeout`). Soak artifacts also carry `soak.expectedWaves` (designed),
`soak.waves` (completed), and `soak.truncatedAtWave`. The summarizer excludes truncated
repetitions from resource comparisons, and provenance rejects a `completed` artifact that
carries fewer waves than designed, or a `truncated` artifact without a `stopReason`.
