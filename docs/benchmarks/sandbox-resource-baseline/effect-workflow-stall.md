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

An import counts as stalled when its latency exceeds 600 s.

Only scenarios whose `submission` is `import` or `live-import` reach the stalling path, because only
those suspend a workflow on a durable queue. The `direct`, `live-details` and `live-search`
submissions execute a sandbox script synchronously and cannot stall this way, so they are not
evidence either for or against the defect. Scenario submissions are declared in
`e2e/src/scripts/sandbox-resource-baseline/scenarios.ts`.

| Evidence                         | Submission   | Imports | Stalled |
| -------------------------------- | ------------ | ------- | ------- |
| Live c1, live attempts 4 and 5   | live-import  | 60      | 0       |
| Live c2, live attempts 4 and 5   | live-import  | 60      | 1       |
| Live c3, live attempts 4 and 5   | live-import  | 60      | 3       |
| Live c5, live attempts 4 and 5   | live-import  | 40      | 10      |
| Standalone reproduction, one run | n/a          | 300     | 12      |

Live figures cover attempt 4 (aborted after 7 units) and the first 4 units of attempt 5. The live
stall rate rises with worker concurrency, so the stall penalizes exactly the concurrency values the
decisions compare.

An earlier revision of this table credited the hermetic matrix with 400 stall-free imports. That was
wrong: the hermetic matrix submits `direct` executions, not imports, so it never exercised the
stalling path. The row has been removed rather than corrected, because it never carried evidence.

## How to read the affected data

- `requests.throughputPerMinute` divides completed imports by the load window. One stall stretches
  the window to about 765 s, so a single stalled import dominates the figure. Do not compare raw
  live throughput across concurrency values.
- Compare live concurrency values by non-stalled per-import latency and by the per-scenario stall
  count instead, and label any throughput that excludes stalled imports as such.
- During a stall the stalled workflow does no work, so it adds idle time to the load window.
  Window-averaged CPU and pressure figures are diluted by it; sampled peaks are not.
- The hermetic matrix, the variance scenarios and `soak-live-details` submit sandbox executions
  rather than imports, so their throughput and latency cannot be affected by this issue.
- `soak-hermetic-import` does submit imports, so it is exposed. Its imports carry no network leg and
  complete in about 13 s, which makes a stall there a fiftyfold outlier rather than the fivefold one
  seen live.

## Detecting a stall while a run is in flight

A stall is a slow success, so nothing in the harness fails on one: the watchdog only reads memory and
health, the consecutive-poll-failure cap counts failed polls, and a 765 s stall sits well under the
30-minute request timeout. Scenario artifacts record per-request latency, but a soak writes its
artifact only on completion, so an aborted soak loses its stall evidence with everything else.

To measure stalls during a run, read the admin endpoint
`GET /api/test-support/provider-imports/phase-segments?afterSequence=<n>` and merge each
`provider-import-automation` segment group per `executionId`: the logical duration runs from the
first attempt's start to the end of the first attempt whose outcome is `success` or `failure`.
Intermediate attempts are recorded as `interrupted` and must not be treated as terminal, or every
import measures as a fraction of a second. The endpoint is process-local, so its sequence resets
whenever the container is recreated, and it returns a bounded page; walk it with `afterSequence`
instead of assuming one call sees the whole run.

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
