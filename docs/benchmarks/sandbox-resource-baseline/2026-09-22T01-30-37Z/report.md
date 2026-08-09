# Sandbox Resource Rerun For Effect #8312 — 2026-09-22T01-30-37Z

This run exists to answer one question: does Effect `4.0.0-rc.117` fix
[Effect-TS/effect#8312](https://github.com/Effect-TS/effect/issues/8312), the `ClusterWorkflowEngine`
defect that lost workflow wake-ups over PostgreSQL and destroyed the import-path data in run
`2026-09-19T09-33-37Z`?

**It does.** The rerun then re-measures the two scenarios the stall had made unreadable.

Deployed image `sha256:95291ed9b3b4e9b1b7168da845e80f6f510d9a0849699d87d38da4a534ce884e`, Bun 1.4.0,
Deno 2.8.1, `processMode: on-demand`, scheduler dispatchers disabled, profiling enabled. Host is the
same 2 vCPU / 3 814 MiB VM as the previous run.

## What was measured

| Scenario | Submission | Repetitions | Requests | Status |
| --- | --- | --: | --: | --- |
| `soak-hermetic-import` | `import` | 1 | 120 | Truncated at 6 of 10 waves |
| Phase 12 live matrix, c1/c2/c3/c5 × 3 rounds | `live-import` | 12 | 252 | Complete, driver exited 0 |

Both scenarios reach the workflow-suspension path that #8312 breaks. The hermetic soak isolates the
defect from network variance; the live matrix reproduces the conditions the concurrency decisions
were taken under.

## What was not measured

- Waves 7 to 10 of the soak. Wave 7 exceeded the request timeout and ended the scenario. Every figure
  below is computed over the six complete waves and is labelled as such.
- Any scenario from the previous run other than these two. The previous run's idle baselines,
  hermetic matrix, variance references and profile attribution were never affected by #8312 and were
  not repeated.
- Lock-ordering behaviour under the deadlock fix described below. That fix is not in the deployed
  image, by design: changing the binary mid-run would have invalidated the comparison.

## The verdict on #8312

### The stall is gone

The criterion is **backend dead time**: contiguous spans in which the backend runs no execution
while a wave is still in flight. That is the direct signature of a lost wake-up. It is measured from
each scenario artifact's own `series.application`, using `activeExecutions` and
`executingImportBodies`, scored over the full wave window `submittedAtMs..terminalAtMs`. That window
already excludes the inter-wave checkpoint idle, so no truncation is needed. Both runs are scored by
the same script from committed artifacts; per-wave figures for both are in `soak-dead-time.json`.

A second discriminator turns out to be at least as sharp: the **spread of request terminal times**
within a wave. All 20 imports are submitted within 0.1 s, so if they all do comparable work they
should finish close together. A lost wake-up delays some of them by about 600 s and pulls that
spread wide open.

| | `rc.116`, 10 waves | `rc.117`, 6 waves |
| --- | --- | --- |
| Busy % | 53.09–73.26 | 91.17–99.52 |
| Total idle per wave | 299.0–741.6 s | 8.0–17.0 s, except wave 4 at 155.0 s |
| Longest contiguous idle | 124.0–424.0 s | 2.0–3.0 s, except wave 4 at 141.0 s |
| Request terminal spread | 513.5–1 022.9 s | 19.7–26.7 s, except wave 4 at 1.9 s |

The `rc.116` pattern is unambiguous and it is present in **every one of its ten waves**: the backend
sits idle for a quarter to a half of each wave, and the wave's imports dribble in over eight to
seventeen minutes. Under `rc.117` that pattern is absent. Five of six waves are busy 98.9 percent or
better, never idle for more than 3 s at a stretch, and complete their twenty imports inside a 27 s
window.

The live matrix agrees independently: across 252 requests, **no request exceeded 600 000 ms**, and
the longest load window of any repetition is 466.5 s.

Sampler cadence is part of the evidence rather than decoration, because a sampler outage produces one
large inter-sample delta that is indistinguishable from real dead time. Median cadence is 1.000 s in
both runs and the largest single gap in the `rc.117` series is 1.599 s, so no gap capable of hiding
or faking a stall exists.

### The one gap that does not fit, in wave 4

Wave 4 of the `rc.117` soak is the exception and is reported rather than smoothed over. The backend
went fully idle at t+1 615 s — zero active executions, zero executing import bodies, one worker
process alive — and stayed idle for **141 s**. Then all twenty requests reported terminal within
1.9 s of each other, at t+1 757.6 s.

What can be said about it:

- It is **not** the #8312 signature. A lost wake-up costs about 600 s, the hard-coded `last_read`
  threshold in `SqlMessageStorage`. 141 s does not correspond to that threshold or a multiple of it.
- It does not look like twenty independent stalls. Every request released simultaneously, which
  points at one shared blocked step rather than per-workflow wake-up loss. The 1.9 s terminal spread
  is the *tightest* of any wave, where a stall widens the spread.
- It is confined to the wave tail, after all sandbox execution work was finished.
- Its cause is **not established**. This run has no instrumentation that distinguishes a delayed
  completion inside the backend from a delayed observation in the harness poll loop.

An earlier revision of this report scored dead time only up to the sample where a wave reached its
execution ceiling, on the reasoning that the post-wave checkpoint tail would otherwise be counted as
idleness. That truncation was both unnecessary and harmful: the checkpoint tail lies outside the
wave window already, and truncating hid this 141 s gap entirely, reporting wave 4 as 99.19 percent
busy with a 2.2 s longest idle. The figures above use the full window. Treat "measure over the whole
window and check the request terminal spread as well" as the method; the earlier one under-reports.

### Why the headline number is not a speed-up

The soak's waves took 1 537 to 1 758 s. Under `rc.116` they took about the same. The stall was
removed and the wall clock did not improve, because the time that used to be spent suspended is now
spent working at a lower rate.

Read the two rates carefully, because they are not measured the same way. The `rc.116` figure of
4.32 executions per second is a **busy-time** rate: it divides a wave's executions by the fraction of
the wave the backend was actually running. The `rc.117` wall-clock rate is 2.21 to 2.45 executions
per second, and because `rc.117` is busy 98.9 percent of the time or better in five of six waves
its busy-time rate is effectively the same 2.2 to 2.5. So the comparable pair is 4.32 against
roughly 2.3: **per unit of working time, `rc.117`
is about half as fast as `rc.116` on this workload.** The stall fix and the throughput regression
happen to cancel in wall clock.

This is a genuine finding and it is the reason the soak truncated: wave 7 crossed the 30-minute
request timeout. It is recorded as an open defect rather than explained, because this run does not
isolate its cause.

## Bun retention on the import path

This is the measurement #8312 destroyed in the previous run, and the reason the soak was rerun first.
The previous run's own text says the import soak "cannot be read as a retention measurement at all"
because its RSS growth accrued while nearly every import was suspended rather than working. With the
stall gone and the backend busy 98.9 percent of each wave or better, wave 4 aside, the number now
means something.

Settled post-wave RSS, taken at the 15-minute checkpoint after each wave drains:

| Wave | Bun RSS MiB | cgroup MiB |
| --: | --: | --: |
| 1 | 652 | 953 |
| 2 | 700 | 1 185 |
| 3 | 743 | 1 244 |
| 4 | 788 | 1 196 |
| 5 | 803 | 1 106 |
| 6 | 845 | 1 020 |

Fresh idle was 462 MiB, final recovery 889 MiB, and 896 MiB after a forced GC.

Two things follow. First, RSS climbs monotonically across all six waves, +193 MiB over 120 imports,
about 32 MiB per wave of 20. Second, cgroup memory peaks at wave 3 and then **falls** while Bun RSS
keeps rising, so the growth is inside the Bun process rather than container-wide.

Set against the plan's ceiling of 100 MiB per 1 000 operations, 120 imports retaining 193 MiB is far
over budget — but the unit matters. The previous run established that `soak-control-extended` retains
35.5 MiB per 1 000 **direct executions**, under the ceiling. An import is not one operation: the six
complete waves ran 22 200 sandbox executions for their 120 imports, 185 per import, which reproduces
the previous run's fan-out figure exactly. Per execution, 193 MiB over 22 200 executions is 8.7 MiB
per 1 000 — well under the ceiling, and four times *lower* than the direct-execution figure rather
than in conflict with it. Run totals including the truncated wave 7 were 25 900 executions, 25 900
process spawns, 109 093 replay starts and 96 MB of journal.

The honest statement is therefore: **the import path retains about 1.6 MiB per import, and that is
explained by import fan-out rather than by an import-specific leak.** Six waves is a short series and
the slope has not flattened the way `soak-control-extended` flattened over ten, so this resolves the
previous run's "true retention of the import path" item to a first measurement, not to a settled
ceiling. Waves 7 to 10 would have tested whether it flattens; they did not run.

## Live YouTube Music concurrency matrix

Twelve repetitions, `c1/c2/c3/c5` over three rounds in a Williams counterbalanced order, 20 imports
plus one warm-up probe each.

| Artifact | c | Round | Order | Window s | Throughput /min | Failed | Stalled |
| --- | --: | --: | --: | --: | --: | --: | --: |
| `live-c1.1.json` | 1 | 1 | 1 | 400.8 | 3.144 | 0 | 0 |
| `live-c1.2.json` | 1 | 2 | 3 | 466.5 | 2.701 | 0 | 0 |
| `live-c1.3.json` | 1 | 3 | 4 | 455.8 | 2.764 | 0 | 0 |
| `live-c2.1.json` | 2 | 1 | 2 | 297.1 | 4.038 | 1 | 0 |
| `live-c2.2.json` | 2 | 2 | 1 | 364.9 | 3.453 | 0 | 0 |
| `live-c2.3.json` | 2 | 3 | 3 | 348.5 | 3.616 | 0 | 0 |
| `live-c3.1.json` | 3 | 1 | 4 | 308.1 | 4.090 | 0 | 0 |
| `live-c3.2.json` | 3 | 2 | 2 | 334.1 | 3.771 | 0 | 0 |
| `live-c3.3.json` | 3 | 3 | 1 | 333.1 | 3.603 | 1 | 0 |
| `live-c5.1.json` | 5 | 1 | 3 | 306.2 | 4.115 | 0 | 0 |
| `live-c5.2.json` | 5 | 2 | 4 | 338.2 | 3.548 | 1 | 0 |
| `live-c5.3.json` | 5 | 3 | 2 | 339.6 | 3.710 | 0 | 0 |

**252 requests, 3 failed, 0 over 600 000 ms.**

Medians with full observed range in parentheses:

| c | Throughput /min | Peak cgroup MiB | Deno aggregate peak MiB | Peak Bun RSS MiB | Health p95 ms | Health max ms | Health failures | Host major faults |
| --: | --- | --- | --- | --- | --- | --- | --: | --- |
| 1 | 2.764 (2.701–3.144) | 996 (981–1 006) | 424 (424–427) | 716 (700–745) | 69 (64–74) | 279 (232–289) | 0 | 26 (23–27) |
| 2 | 3.616 (3.453–4.038) | 1 350 (1 252–1 430) | 809 (794–816) | 772 (739–798) | 397 (373–458) | 2 787 (1 592–2 897) | 0 | 17 (14–28) |
| 3 | 3.771 (3.603–4.090) | 1 654 (1 595–1 791) | 1 178 (1 132–1 178) | 771 (752–844) | 850 (795–930) | 5 000 (4 379–5 001) | 3 | 13 (8–26) |
| 5 | 3.710 (3.548–4.115) | 2 117 (1 986–2 168) | 1 872 (1 650–1 917) | 800 (793–827) | 1 620 (1 333–1 898) | 5 001 (4 351–5 001) | 3 | 339 (157–1 150) |

### Host pressure and headroom

From `summary.json`, per-scenario medians across the three repetitions:

| c | Ryot CPU s | CPU PSI some avg10 max | Memory PSI full avg10 max | MemAvailable min MiB | Host major faults | Disk sectors read |
| --: | --: | --: | --: | --: | --: | --: |
| 1 | 657.3 | 69.6 | 0.00 | 1 796.7 | 26 | 4 048 |
| 2 | 595.2 | 84.7 | 0.00 | 1 444.2 | 17 | 2 144 |
| 3 | 591.8 | 93.6 | 0.00 | 1 161.1 | 13 | 1 440 |
| 5 | 604.4 | 98.8 | 0.18 | **688.4** | 339 | **52 176** |

CPU pressure is already at 69.6 with a single worker and saturates at 98.8 by `c5`, so the machine is
CPU-bound at every setting and the extra workers are queueing rather than adding capacity. That is
the mechanism behind the throughput plateau.

`c5` is the only setting that registers memory pressure at all, and it is the only one that leaves
under 700 MiB of host headroom. Its disk reads are 12 to 36 times every other setting, which is the
same event as its major-fault count: the host is faulting pages back in. Ryot CPU seconds are flat
at 592–657 across all four settings, confirming that the extra concurrency buys no additional work.

Scaling ratios against `c1`, also from `summary.json`:

| Metric | c1→c2 | c1→c3 | c1→c5 |
| --- | --: | --: | --: |
| `health.latencyMs.p95` | 5.78× | 12.39× | 23.61× |
| `peakDelta.denoAggregateRssBytes` | 1.91× | 2.78× | 4.42× |
| `ryot.cgroupScenarioPeakBytes` | 1.35× | 1.69× | 2.12× |
| `requests.throughputPerMinute` | 1.31× | 1.36× | 1.34× |

Throughput gains stop at 1.31× while health latency costs grow to 23.61×. Deno aggregate memory
tracks worker count almost exactly.

### How much of this is real

A round effect is present and it is larger than most of the differences being compared. Excluding
`c1`, mean throughput was 4.081/min in round 1, 3.591 in round 2 and 3.643 in round 3 — round 1 is
about 12 percent faster than the later two. The gap between `c2` and `c5` medians is 2.6 percent.
**Throughput differences among c2, c3 and c5 are therefore not resolvable by this run**, and reading
them as an ordering would be reading noise. Only two throughput claims survive: `c1` is slower than
everything else, and throughput stops improving at `c2`.

Three metrics do separate cleanly, with non-overlapping ranges at every concurrency level, so they
are not vulnerable to the round effect:

- **Peak cgroup memory**, 996 → 1 350 → 1 654 → 2 117 MiB, close to linear in worker count.
- **Deno aggregate worker RSS**, 424 → 809 → 1 178 → 1 872 MiB, about 400 MiB per worker. Per-worker
  peak RSS stays flat at 400 to 431 MiB regardless of concurrency, confirming the previous run's
  finding that worker size is independent of concurrency.
- **Health-probe latency**, p95 69 → 397 → 850 → 1 620 ms.

### Responsiveness fails before throughput improves

At `c3` and `c5` the health probe reaches its 5 000 ms cap and **fails outright**, three times at each
setting across three repetitions. At `c1` and `c2` it never fails. At `c5` host major page faults rise
to 157–1 150 against 8–28 everywhere else, which is the host reclaiming under pressure; `c5` peaks at
2 117 MiB of a 3 814 MiB box.

This resolves an item the previous run left open. That run measured a live health p95 of 543 ms at
`c3` and listed it under Unresolved as possibly "an artefact of the 1.73 % sampling gap in that
group". Three clean repetitions now put `c3` at 795–930 ms with two health failures, worse than the
original figure. It is reproducible and it is not a sampling artefact.

`maxExecutingBodies` is 19–20 at every concurrency level including `c1`, confirming that worker
concurrency bounds sandbox executions and not import bodies.

## The three failed imports

Three of 252 requests failed, one each in `live-c2.1`, `live-c5.2` and `live-c3.3`, all with
`failureStage: "population"`, all terminating in 196–279 s rather than hanging. They are unrelated to
#8312 and are fully root-caused; see defect 5 in `defects.md`.

In short: a PostgreSQL deadlock on `select pg_advisory_xact_lock(...)` inside the `media-suggestion`
related-entity sync. The transaction was already wrapped in `retryOnDeadlock`, but the retry could
never fire, because Drizzle reports query failures as `cause: Cause.fail(error)` and
`unwrapDatabaseFailure` had no `Cause` branch — so every `DbError` raised from a Drizzle query lost
its SQLSTATE and the `40P01` predicate never matched. Fixed in `75970d6472`, with regression tests
that fail without the fix. The fix is deliberately **not** in the image this run measured.

## Decision inputs

These update, and mostly confirm, the numbered inputs in `../2026-09-19T09-33-37Z/report.md`.

1. **Is worker concurrency 2 correct for 2 vCPU / 4 GB?** Confirmed, and now on stall-free data. `c1`
   costs 24 percent throughput against `c2` (2.764 vs 3.616/min). Going past `c2` buys nothing this
   run can resolve and costs roughly 300 MiB of cgroup footprint and 370 MiB of Deno worker memory
   per added worker, plus a doubling of health p95 per step. CPU pressure is already 69.6 at `c1` and
   84.7 at `c2`, so the box is CPU-bound before the memory limit binds. `c2` remains the right
   default.
2. **Does c3 justify its cost?** No, and the case against it is stronger than before. Its throughput
   advantage over `c2`, 4.3 percent, is a quarter of the round effect and therefore not measurable
   here. It costs +304 MiB peak cgroup, +369 MiB Deno aggregate, health p95 397 → 850 ms, and it
   produces health-probe failures where `c2` produces none.
3. **Does c5 reduce throughput or responsiveness?** Throughput: no measurable change from `c2`.
   Responsiveness: yes, severely. Health p95 1 620 ms — 23.6× `c1` — health max at the 5 000 ms cap,
   three probe failures, host major faults up by one to two orders of magnitude, disk reads up 12 to
   36×, and the only non-zero memory pressure in the run. It peaks at 2 117 MiB on a 3 814 MiB host
   and leaves 688 MiB of headroom, against 1 444 MiB at `c2`. The previous run's figure of 2.15 GiB
   at `live-c5` is reproduced exactly. This is the setting at which the host starts reclaiming.
7. **If RSS grows, what is it?** The import-path half of this question now has a first answer; see
   the retention section. 1.6 MiB per import, 8.7 MiB per 1 000 sandbox executions, below the
   direct-execution figure rather than an import-specific leak.
9. **Is full-import admission still needed after concurrency 2?** Confirmed and strengthened.
   `maxExecutingBodies` reaches 19–20 at every concurrency including `c1`, so import bodies are
   unbounded by the worker setting. `c1` alone peaks at 996 MiB of cgroup footprint. The overlap this
   question asks about is real; this run still does not measure an admission limit.

Inputs 4, 5, 6, 8 and 10 are unchanged: nothing in this run bears on them.

## Hypotheses

**Supported.**

- Effect `4.0.0-rc.117` fixes #8312. The `rc.116` pattern — a quarter to a half of every wave idle,
  imports dribbling in over 513–1 023 s — is absent from all six hermetic waves and from all twelve
  live repetitions. Zero requests over 600 s across 252 live requests. The wave 4 gap is 141 s, does
  not match the ~600 s `last_read` threshold, and released all twenty requests simultaneously.
- Live health degradation at `c3` is reproducible and is not a sampling artefact. Three repetitions,
  795–930 ms p95, with probe failures.
- Worker memory scales linearly with concurrency at roughly 400 MiB per live worker, and per-worker
  size is independent of concurrency. Reproduced from the previous run on new data.
- Import bodies are not bounded by worker concurrency.

**Rejected.**

- That `latencyMs > 600000` is a valid stall test for the hermetic soak. The threshold was
  calibrated on a live import costing about 165 s, so roughly 765 s meant a stall. A hermetic wave's
  *normal* per-import latency is 1 520–1 760 s, because 20 imports genuinely share two vCPUs for the
  whole wave, so all 120 trip the threshold while the backend is busy 91–99.5 percent of the time.
  The rule stays valid for the live matrix, where normal latency is 196–466 s and a 600 s stall would
  stand out — as it did under `rc.116`, where stalled imports recorded about 775 s against a 177 s
  median. A threshold has to sit above the workload's own cost, and for the soak this one does not.
- That fixing #8312 would restore import throughput. Wall-clock wave duration is unchanged; the
  recovered idle time is consumed by the throughput regression.

**Unresolved.**

- The 141 s idle gap in the tail of soak wave 4, during which all twenty requests were held and then
  released together. Not the #8312 signature by magnitude or shape, cause not established, and not
  distinguishable with this run's instrumentation from a delay in the harness poll loop.
- The cause of the throughput regression against `rc.116`, roughly 2× per unit of working time. This
  run establishes it and does not explain it.
- Whether import-path RSS retention flattens the way direct-execution retention does. Six waves is
  too short a series; waves 7 to 10 would have answered it.
- Whether the deadlock in defect 5 still occurs once the retry actually works. Lock ordering is
  unchanged and `retryOnDeadlock` allows only two retries, so three attempts may not survive 20-way
  concurrency. Not measured here, because the fix is not in the measured image.
