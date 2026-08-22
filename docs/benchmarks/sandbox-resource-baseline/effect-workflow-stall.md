# Effect Workflow Stall And The Sandbox Resource Benchmarks

**Status:** open. Upstream issue
[Effect-TS/effect#8312](https://github.com/Effect-TS/effect/issues/8312), standalone reproduction at
[IgnisDa/effect-workflow-stall-repro](https://github.com/IgnisDa/effect-workflow-stall-repro).

Read this before drawing decisions from live import throughput or latency in run
`2026-09-19T09-33-37Z`, or in any run on Effect `4.0.0-rc.116`.

## What happens

On `4.0.0-rc.116` with `ClusterWorkflowEngine` over PostgreSQL, a workflow that suspends on a
durable queue can be resumed while the storage poll loop is mid-iteration. The poll claims the reset
`run` message and sets `last_read`, then skips it because the in-memory processed-request set is only
cleared once per poll iteration. The message is not re-selected until its `last_read` is ten minutes
old, a threshold hard-coded in `SqlMessageStorage`.

A stalled import still completes, about 600 s late. A normal live import takes about 165 s, so a
stalled one ends at roughly 765 s. SQLite never reproduces it, because its queries cannot interleave.

## Observed rates

An import counts as stalled when its latency exceeds 600 s. Each scenario submits 20 imports.

| Evidence                                | Imports | Stalled |
| --------------------------------------- | ------- | ------- |
| Hermetic matrix, c1/c2/c3/c5 × 5 rounds | 400     | 0       |
| Live c1, live attempts 4 and 5          | 60      | 0       |
| Live c2, live attempts 4 and 5          | 60      | 1       |
| Live c3, live attempts 4 and 5          | 60      | 3       |
| Live c5, live attempts 4 and 5          | 40      | 10      |
| Standalone reproduction, one run        | 300     | 12      |

Live figures cover attempt 4 (aborted after 7 units) and the first 4 units of attempt 5. The live
stall rate rises with worker concurrency, so the stall penalizes exactly the concurrency values the
decisions compare.

## How to read the affected data

- `requests.throughputPerMinute` divides completed imports by the load window. One stall stretches
  the window to about 765 s, so a single stalled import dominates the figure. Do not compare raw
  live throughput across concurrency values.
- Compare live concurrency values by non-stalled per-import latency and by the per-scenario stall
  count instead, and label any throughput that excludes stalled imports as such.
- During a stall the stalled workflow does no work, so it adds idle time to the load window.
  Window-averaged CPU and pressure figures are diluted by it; sampled peaks are not.
- The hermetic matrix recorded no stalls, so its throughput and latency are not affected by this
  issue.

Decision questions 1, 2, 3 and 9 in `follow-up-data-gathering-plan.md` depend on throughput. Answer
them from hermetic evidence and non-stalled live evidence until the rerun below replaces the live
figures.

## Open follow-up

When Effect publishes a release that fixes #8312:

1. Bump `effect` and the matching `@effect/*` packages from `4.0.0-rc.116` in every workspace that
   pins them. No Ryot code works around the stall, so nothing else needs to change.
2. Deploy to the benchmark service and pass sampling preflight.
3. Rerun the Phase 12 live concurrency matrix, plus any other scenario from run
   `2026-09-19T09-33-37Z` whose artifact contains an import over 600 s, into a new run directory.
4. Close this file when the rerun records no import over 600 s. Record the new run id and replace the
   live throughput inputs used for the decisions.
