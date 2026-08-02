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

| Evidence                          | Submission  | Imports | Stalled | Median  | Max      |
| --------------------------------- | ----------- | ------- | ------- | ------- | -------- |
| Live c1, attempt 6                | live-import | 63      | 0       | 214.3 s | 219.4 s  |
| Live c2, attempt 6                | live-import | 63      | 3       | 177.1 s | 775.6 s  |
| Live c3, attempt 6                | live-import | 63      | 1       | 176.5 s | 776.6 s  |
| Live c5, attempt 6                | live-import | 63      | 13      | 172.8 s | 775.5 s  |
| `soak-hermetic-import`, attempt 6 | import      | 200     | 171     | 755.8 s | 1581.9 s |
| Standalone reproduction, one run  | n/a         | 300     | 12      | n/a     | n/a      |

Attempt 6 is the first complete run, so its live figures replace the partial ones from attempts 4 and
5, which pointed the same way. The live stall rate rises with worker concurrency, so the stall
penalizes exactly the concurrency values the decisions compare.

`soak-hermetic-import` stalled 171 of 200 imports, 85.5 percent, and its fastest import still took
526 s against an expected 13 s. Not one import ran clean. This is the strongest evidence in the run:
it carries no network leg, so it isolates the defect from live provider variance, and at 200 imports
it is the largest single sample.

The hermetic rate is four to eighty times the live rates, and the difference tracks how long the
workflow body runs. A live import does about 165 s of network work; a hermetic one does about 13 s.
The shorter the body, the more often a resume lands inside a poll iteration, which is where the
wakeup is lost. Read the hermetic rate as what the defect does to short workflows rather than as a
correction to the live rates.

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
- The hermetic matrix, the variance scenarios and `soak-control` submit sandbox executions rather
  than imports, so their throughput and latency cannot be affected by this issue. They are the clean
  baselines: `soak-control` ran 100 executions at a 1.8 s median with nothing above 2.1 s.
- `soak-hermetic-import` is affected so heavily that it cannot be read as a retention or throughput
  measurement at all. Its waves spent about 26 minutes of load on 20 imports that should take about
  13 s each, and its RSS growth of 467 MB at fresh idle to 973 MB at final recovery accumulated while
  nearly every import was suspended rather than working. Treat that scenario as stall evidence only,
  and rerun it for retention once #8312 is fixed.

## Detecting a stall while a run is in flight

A stall is a slow success, so nothing in the harness fails on one: the watchdog only reads memory and
health, the consecutive-poll-failure cap counts failed polls, and a 765 s stall sits well under the
30-minute request timeout. Scenario artifacts record per-request latency, but a soak writes its
artifact only on completion, so an aborted soak loses its stall evidence with everything else.

An earlier revision of this section told you to measure stalls from
`GET /api/test-support/provider-imports/phase-segments`, merging each `provider-import-automation`
group per `executionId` from the first attempt's start to the first terminal attempt. **That method
does not work and must not be used.** Phase segments record only the active execution of a phase. The
suspension on the durable queue, which is the entire defect, falls outside every recorded segment, so
the merged duration is roughly the same whether or not the import stalled. During
`soak-hermetic-import` it reported about 12 s per import and zero stalls for seven hours while the
run was stalling 171 imports of 200 at 526 to 1582 s. One execution makes the failure plain:

```
exec DGbLpThVlNRs  attempts 2  first -> last span 12.3 s  [(interrupted, 0.4 s), (success, 0.0 s)]
  matching request record: latencyMs = 698337
```

Measure a stall from wall-clock request latency instead. After a run, read `requests[].latencyMs` in
the scenario artifact and count values above 600 s. While a run is in flight, compare each wave's
load window against what its workload should cost: a `soak-hermetic-import` wave submits 20 imports
worth about 13 s each and took about 26 minutes, a ratio visible from the first wave. A load window
one to two orders of magnitude longer than the work it contains is the signal, and it needs no
endpoint.

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
