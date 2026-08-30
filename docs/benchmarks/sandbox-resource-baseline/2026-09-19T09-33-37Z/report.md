# Sandbox Resource Follow-Up — 2026-09-19T09-33-37Z

Measurement report for the follow-up run described in `../follow-up-data-gathering-plan.md`. It
states evidence and records decision inputs. It does not recommend architecture.

**Read `../effect-workflow-stall.md` first.** Effect `4.0.0-rc.116` loses workflow wake-ups over
PostgreSQL, and every scenario on the import path in this run is affected. That document says which
numbers here are readable and which are not.

## What was measured

- Image `ghcr.io/ignisda/ryot@sha256:48fdd57223c44a7dd22bc2aa2f0b6c60471df2058d203ddb3392e7e5d2550a71`.
- Bun 1.4.0, Deno 2.8.1, Effect 4.0.0-rc.116, kernel 7.0.0-30-generic.
- Host: 2 vCPU, 4 000 043 008 B RAM, no swap. Ryot has no CPU or memory limit of its own.
- 51 scenario artifacts across eight phase invocations, 2026-09-19 09:56 UTC to 2026-09-20 16:16 UTC.
- Application sampling at 200 ms collected on the benchmark host; host sampling at 1 s from procfs
  and cgroup v2.

| Series      | Interval (ms) | Gate                                             |
| ----------- | ------------- | ------------------------------------------------ |
| application | 200           | p50 0–300, p95 ≤ 500, max 2000, missed ≤ 1 %     |
| host        | 1000          | p50 900–1100, p95 ≤ 1250, max 2000, missed ≤ 1 % |

Derived tables below come from `summary.json`; profile attribution comes from
`profiles/summary.json`. Both are regenerated from the artifacts by
`e2e/src/scripts/sandbox-resource-baseline/summarize-run.ts` and `profiles/analyze.ts`. This file is
written over the skeleton the summarizer emits, so re-running it discards everything below the
generated tables.

The raw profiles those summaries were built from have been deleted: 762 007 302 bytes across 76
files, verified empty at 2026-09-20T12:29:17Z and recorded in the manifest. Raw profiles can embed
provider data, so only the sanitized summaries are kept.

## What was not measured

- `soak-live-details` was not run. It submits `live-details`, which executes synchronously and
  cannot reach the stalling durable-queue path, so it would have measured YouTube Music latency
  rather than anything the decision questions ask. `soak-control` and `soak-control-extended`
  supply the non-import soak baseline.
- No payload-size matrix. The 64 KiB / 1 MiB / 3.9 MB boundaries were covered by the earlier
  targeted run recorded in `../2026-09-19T05-06-19Z/`.
- No restart-recovery scenario in this run.
- Live attempts 1 to 5 aborted and their artifacts are not in this directory. Their stall counts are
  quoted in `../effect-workflow-stall.md` and nowhere else.

## Correctness conclusions

Every scenario completed. Across all 51 artifacts:

- 2 020 requests submitted, 2 020 completed, **0 failed**, 0 aborted, 0 skipped.
- **0 OOM kills**, at the host and in the Ryot cgroup, in every scenario.
- **0 watchdog triggers** and 0 health-check failures in every scenario.
- 0 unscheduled container restarts.
- Every repetition ran at its declared worker concurrency and dispatcher setting; every artifact
  carries both an application and a host cadence record. Provenance passes.

No correctness defect was observed in the sandbox itself during this run. The one pathology is
timing: on the import path, 188 of 452 imports took longer than 600 s, and that is Effect #8312, not
Ryot. The stalled imports still completed with correct results.

## Idle baselines

Ten minutes of idle on a fresh process, five repetitions each.

| Metric (median)                | dispatchers disabled | dispatchers enabled | difference     |
| ------------------------------ | -------------------- | ------------------- | -------------- |
| Bun RSS at scenario start      | 489.5 MiB            | 627.7 MiB           | **+138.2 MiB** |
| Ryot cgroup peak               | 443.8 MiB            | 628.0 MiB           | **+184.2 MiB** |
| Bun RSS peak Δ over the window | 4.4 MiB              | 19.9 MiB            | +15.5 MiB      |
| Bun RSS post Δ over the window | −21.7 MiB            | −72.9 MiB           | —              |
| Ryot cgroup CPU over 10 min    | 37.8 s               | 40.6 s              | +2.8 s         |
| MemAvailable minimum           | 2525.6 MiB           | 2315.2 MiB          | −210.4 MiB     |
| PostgreSQL sampled peak        | 199.2 MiB            | 280.2 MiB           | +81.0 MiB      |

Enabling the scheduler dispatchers costs **138 MiB of Bun RSS and 184 MiB of cgroup footprint at
idle**, before any work is submitted, plus 81 MiB in PostgreSQL. On a 4 GB host that is about 4.8 %
of RAM held for an idle scheduler. CPU cost at idle is negligible: 2.8 s over ten minutes, 0.5 % of
one core.

Both settings shed memory over the idle window rather than accumulating it (−21.7 and −72.9 MiB),
so neither leaks while idle.

## Hermetic concurrency matrix

Twenty `direct` sandbox executions per repetition, each with five 25 ms durable host calls, five
repetitions per concurrency in a counterbalanced Williams order. These do not touch the import path,
so they are unaffected by #8312.

| Scenario    | Throughput/min | Latency p50 | Execution p50 | Load window | Deno aggregate peak | Cgroup peak |
| ----------- | -------------- | ----------- | ------------- | ----------- | ------------------- | ----------- |
| hermetic-c1 | 16.9           | 67.7 s      | 3.3 s         | 70.9 s      | 124.1 MiB           | 581.6 MiB   |
| hermetic-c2 | 28.5           | 39.9 s      | 3.7 s         | 42.0 s      | 237.9 MiB           | 692.2 MiB   |
| hermetic-c3 | 32.3           | 35.2 s      | 4.8 s         | 37.1 s      | 350.4 MiB           | 750.6 MiB   |
| hermetic-c5 | 32.4           | 36.0 s      | 7.5 s         | 37.1 s      | 557.0 MiB           | 878.3 MiB   |

| Scenario    | Ryot CPU | CPU PSI some avg10 max | Health p95 | Major faults | Sectors read | MemAvailable min |
| ----------- | -------- | ---------------------- | ---------- | ------------ | ------------ | ---------------- |
| hermetic-c1 | 83.6 s   | 21.3                   | 12 ms      | 3            | 328          | 2270.1 MiB       |
| hermetic-c2 | 80.0 s   | 40.4                   | 18 ms      | 2            | 256          | 2166.8 MiB       |
| hermetic-c3 | 78.7 s   | 63.6                   | 20 ms      | 1            | 128          | 2112.1 MiB       |
| hermetic-c5 | 81.5 s   | 85.9                   | 92 ms      | 242          | 10 392       | 2016.9 MiB       |

**Throughput saturates at concurrency 3.** c1 → c2 buys 1.69×, c2 → c3 buys a further 1.13×, and
c3 → c5 buys nothing measurable (32.3 → 32.4/min, within run-to-run noise; the load window is
identical at 37.1 s). Total CPU consumed is flat at 79–84 s regardless of concurrency, which is what
a CPU-bound workload on two cores looks like: the work does not get cheaper, it only gets queued
differently.

**The cost of the extra workers is per-execution latency and memory.** Execution p50 rises 3.3 →
3.7 → 4.8 → 7.5 s, so an individual execution at c5 takes 2.3× as long as at c1 for zero aggregate
gain. Deno aggregate RSS scales almost exactly linearly with concurrency at roughly 112 MiB per
worker (124 / 238 / 350 / 557 MiB), and each worker's lifetime peak is 124–129 MiB with a median of
116 MiB, so worker size is independent of concurrency.

**c5 is where the host starts paying.** Major faults jump from 1–3 to 242 and disk sectors read from
128–328 to 10 392, CPU pressure reaches 85.9, and health p95 degrades 4.6× from 20 ms to 92 ms. The
c5 column is the first place in this matrix where the API's own responsiveness is visibly affected.

Replay and spawn work is identical across the matrix: 220 executions, 220 process spawns, 1 540
replays started, 20 replays completed and 925 140 journal bytes per repetition of 20 requests. Eleven
sandbox processes and 77 replay starts per submitted request.

## Live YouTube Music concurrency matrix

One live search then twenty live imports per repetition, three repetitions per concurrency. **These
are on the import path.** Throughput and load windows are distorted by #8312 and must not be compared
across concurrency values. Stalls counted as latency > 600 s.

| Scenario | Imports | Stalled | Non-stalled p50 | Max     | Load window | Deno aggregate peak | Cgroup peak |
| -------- | ------- | ------- | --------------- | ------- | ----------- | ------------------- | ----------- |
| live-c1  | 63      | 0       | 214.3 s         | 219.4 s | 216.5 s     | 430.4 MiB           | 1034.0 MiB  |
| live-c2  | 63      | 3       | 177.1 s         | 775.6 s | 772.2 s     | 807.4 MiB           | 1351.7 MiB  |
| live-c3  | 63      | 1       | 176.5 s         | 776.6 s | 180.3 s     | 1183.4 MiB          | 1644.2 MiB  |
| live-c5  | 63      | 13      | 170.0 s         | 775.5 s | 775.4 s     | 1828.7 MiB          | 2146.1 MiB  |

| Scenario | Ryot CPU | CPU PSI some avg10 max | Health p95 | Major faults | Sectors read | MemAvailable min |
| -------- | -------- | ---------------------- | ---------- | ------------ | ------------ | ---------------- |
| live-c1  | 317.0 s  | 62.2                   | 33 ms      | 4            | 608          | 1764.6 MiB       |
| live-c2  | 364.2 s  | 85.7                   | 61 ms      | 19           | 2 864        | 1454.4 MiB       |
| live-c3  | 326.8 s  | 93.7                   | 543 ms     | 13           | 1 784        | 1242.3 MiB       |
| live-c5  | 368.9 s  | 98.5                   | 197 ms     | 334          | 70 464       | 784.3 MiB        |

All twenty imports of a repetition are in flight together (`imports.maxExecutingBodies` 19–20), so
they finish together and per-minute throughput is an artefact of the window rather than a rate. The
readable comparison is **non-stalled per-import latency**, which improves from 214.3 s at c1 to
177.1 s at c2 and then flattens (176.5 s at c3, 170.0 s at c5).

That shape is explained by fan-out, not by parallel imports: one live import expands into about 16
sandbox executions (343 executions for 21 requests at c2), and worker concurrency parallelises those
executions _inside_ each import. Going from one worker to two removes about 37 s of serialised
sandbox time per import; a third and fifth worker remove almost nothing, because what remains is the
YouTube Music network leg.

**Memory is the binding constraint here, not CPU.** Deno aggregate RSS reaches 1.83 GiB at c5 and the
Ryot cgroup peaks at 2.15 GiB, leaving 784 MiB of host MemAvailable — about twice the 384 MiB
watchdog floor. CPU pressure is already at 62 with a single worker, so the live workload saturates
two cores before concurrency is raised at all. c5 also produces 334 major faults and 70 464 sectors
read, an order of magnitude above every other scenario in the run: the host is reclaiming.

Health p95 of 543 ms at live-c3 is the worst API responsiveness recorded in the run. It is not
monotonic in concurrency (c5 measured 197 ms), and live-c3's application sampler missed 1.73 % of
slots, so treat this figure as evidence that live load can degrade the API by an order of magnitude
rather than as a per-concurrency value.

## Live variance references

Thirty sequential unprofiled executions on a long-lived process, worker concurrency 1.

| Scenario             | n   | Mean     | SD     | CoV       | Min      | Max      |
| -------------------- | --- | -------- | ------ | --------- | -------- | -------- |
| ytm-search-variance  | 30  | 6 819 ms | 84 ms  | **1.2 %** | 6 742 ms | 7 139 ms |
| ytm-details-variance | 30  | 8 665 ms | 652 ms | **7.5 %** | 7 971 ms | 9 720 ms |

YouTube Music itself is stable over the measurement period. Provider variance is 1–8 % and cannot
account for any difference larger than that in the live matrix. Both scenarios reached a 432 MiB
worker peak with a 1 vCPU worker, matching the live matrix.

## Profile attribution

Four profiled scenarios, 21 profile entries, from V8 CPU profiles, heap snapshots and per-phase
smaps checkpoints. **Absolute memory in this section is inflated by profiling** — the profiled
hermetic worker peaks at 233 MiB against 128 MiB unprofiled — so read the shape and the shares, not
the levels.

### Where CPU goes

Active (non-idle) CPU share by category, aggregated over all attempts:

| Category                           | ytm-search | ytm-details | ytm-details-five | hermetic-noop |
| ---------------------------------- | ---------- | ----------- | ---------------- | ------------- |
| garbage collector                  | 31.3 %     | 34.9 %      | 30.1 %           | 25.5 %        |
| `youtubei.js` (runner-bundled)     | 30.6 %     | 29.6 %      | 23.5 %           | —             |
| `meriyah` (runner-bundled)         | 22.2 %     | 21.8 %      | 17.8 %           | —             |
| `(program)`                        | 5.9 %      | 5.0 %       | 15.8 %           | 41.9 %        |
| `youtubei-17.2.0` (runtime module) | 1.7 %      | 1.5 %       | 3.3 %            | —             |
| effect (runner + runtime)          | 3.3 %      | 2.8 %       | 4.6 %            | 22.3 %        |

The top self-frames are `walkAst`, `enter`, `findDependencies` and `analyzeAst` under
`JsAnalyzer.create`, all inside `youtubei.js`, with `finishNode` inside `meriyah` behind them.
`meriyah` is a JavaScript parser and is a declared dependency of `youtubei.js@17.2.0`.

So for every YouTube Music workload, **about half of active CPU is spent parsing and walking
JavaScript inside the provider library, and another third is the garbage collection that work
generates**. Executing the plugin's own logic and the runtime provider module together account for
under 5 %. This is consistent with `youtubei.js` analysing YouTube's player script, but this run did
not instrument the library, so the purpose of that parsing is an inference, not a measurement.

### Where memory goes

Per-phase smaps for one YTM details attempt, against the hermetic control:

| Checkpoint             | RSS           | private anon  | file-backed | heap used     |
| ---------------------- | ------------- | ------------- | ----------- | ------------- |
| runner-ready           | 120.6 MiB     | 69.5 MiB      | 51.6 MiB    | 28.6 MiB      |
| module-imported        | 256.0 MiB     | 194.5 MiB     | 60.2 MiB    | 45.1 MiB      |
| journal-loaded         | 312.9 MiB     | 251.7 MiB     | 60.2 MiB    | 55.4 MiB      |
| host-call-settled      | 316.0 MiB     | 252.0 MiB     | 62.8 MiB    | 54.7 MiB      |
| **dependency-settled** | **534.2 MiB** | **470.0 MiB** | 63.1 MiB    | **220.3 MiB** |
| host-call-settled      | 534.0 MiB     | 469.8 MiB     | 63.1 MiB    | 49.3 MiB      |
| response-encoded       | 534.2 MiB     | 469.9 MiB     | 63.1 MiB    | 54.0 MiB      |

| Checkpoint       | hermetic-noop RSS | private anon | heap used |
| ---------------- | ----------------- | ------------ | --------- |
| runner-ready     | 134.6 MiB         | 86.2 MiB     | 29.1 MiB  |
| module-imported  | 226.0 MiB         | 175.3 MiB    | 28.5 MiB  |
| response-encoded | 233.0 MiB         | 178.9 MiB    | 28.8 MiB  |

**Answer to "which phase makes a YTM worker large": `dependency-settled`, the phase labelled
`provider-client-created`.** It is the single largest RSS delta (+228.9 MiB) and the single largest
heap delta (+173.7 MiB) of the whole execution. The worker is 316 MiB before it and 534 MiB after it,
and it never shrinks again.

**Answer to "what kind of memory": private anonymous memory held as V8 heap reservation.** At
`dependency-settled` the live heap spikes to 220 MiB and then falls back to 49 MiB at the very next
checkpoint — the objects are transient garbage — but private anonymous RSS stays at 470 MiB for the
rest of the execution. File-backed memory is flat at 60–63 MiB throughout and is therefore not the
cause; external memory peaks at 12.8 MiB during journal load and is negligible; response data never
appears as a step.

The same shape appears at worker concurrency 5 (`profile-ytm-details-five` reaches 521.7 MiB with an
identical phase progression), so the cost is per worker and does not amortise.

This is corroborated by the unprofiled matrix: the live worker **lifetime peak** is 432 MiB while the
live worker **median** is 127 MiB — the same as a hermetic worker. Only the workers that run the
provider-client phase become large.

## Bun retention

Applying `retention.ts::retentionClassification` to the three soaks, with the manifest's tolerances
(10 % post-GC growth ratio, 100 MiB per 1 000 operations slope ceiling):

| Input                             | soak-control             | soak-control-extended    | soak-hermetic-import  |
| --------------------------------- | ------------------------ | ------------------------ | --------------------- |
| operations                        | 100 direct executions    | 1 000 direct executions  | 200 imports           |
| wall clock                        | 2 h 44 m                 | 3 h 14 m                 | 6 h 39 m              |
| fresh idle RSS                    | 449.9 MiB                | 468.7 MiB                | 445.3 MiB             |
| final recovery RSS                | 485.2 MiB                | 517.6 MiB                | 927.5 MiB             |
| post-GC RSS                       | 491.0 MiB                | 521.9 MiB                | 927.1 MiB             |
| post-GC RSS growth                | **+9.1 %**               | **+11.3 %**              | **+108.2 %**          |
| post-GC heap-used growth          | **−4.4 %**               | **−3.7 %**               | **+10.3 %**           |
| post-GC external growth           | −6.5 %                   | −1.3 %                   | +19.8 %               |
| JSC object count, fresh → post-GC | 1 011 575 → 982 406      | 1 075 196 → 988 803      | 1 074 991 → 1 072 018 |
| fitted RSS slope                  | 27.8 MiB / 100 ops       | 3.9 MiB / 100 ops        | 198.1 MiB / 100 ops   |
| projected per 1 000 ops           | 278 MiB                  | **38.5 MiB**             | 1 981 MiB             |
| **classification**                | **allocator-high-water** | **allocator-high-water** | **heap-retention**    |

`soak-control-extended` is the measurement that settles this section. The other two are kept because
one is the ten-times-smaller sample the extrapolation came from and the other is the stall evidence.

### soak-control is the smaller sample

Ten waves of ten sequential direct executions, each wave followed by 1/5/15-minute recovery
checkpoints, 2 h 44 m end to end. Wave load was 11–19 s throughout, request latency p50 1.8 s with
nothing above 2.1 s, and no wave failed.

RSS at the 15-minute checkpoint: 462.5, 472.5, 472.3, 477.2, 477.0, 478.1, 482.3, 479.8, 485.2,
484.4 MiB. After the run, a forced GC left RSS **unchanged within 6 MiB** while live heap fell 4.4 %
and the JSC object count fell by 29 169. **Nothing is retained on the heap.** What grows is the
allocator's high-water mark.

The caveat recorded here before `soak-control-extended` ran: the fitted slope of 27.8 MiB per 100
operations projects 278 MiB per 1 000 operations, above the plan's 100 MiB ceiling. That projection
is now known to be wrong by a factor of 7.2, for the reason given below — it extrapolates a
first-wave cost that does not recur.

### soak-control-extended answers the slope question

> The complete artifact for this scenario was destroyed after the run by an operator error, and the
> scenario is being re-run. See defect 25. Every figure below comes from the surviving metrics and
> request records, but `summary.json` cannot be regenerated from the committed artifacts until the
> re-run lands.

Ten waves of one hundred sequential direct executions, 1 000 operations, 0 failed, 3 h 14 m. Same
submission path, same workload shape, same 1/5/15-minute recovery checkpoints. Wave load windows were
129–165 s with no drift, request latency p50 1.82 s and max 2.81 s, and every wave drained in under
190 ms.

RSS at the 15-minute checkpoint: 491.2, 501.1, 505.8, 508.2, 522.0, 511.2, 518.7, 519.5, 516.5,
516.4 MiB. **The series is not monotonic.** After the first wave it oscillates around a level near
515 MiB, with per-wave increments of +9.8, +4.7, +2.4, +13.9, −10.8, +7.4, +0.8, −3.0 and −0.1 MiB
— three sign changes, spanning 24.7 MiB from −10.8 to +13.9. That spread is larger than the
15.3 MiB of total drift across waves 2–10, so single-wave noise dominates the trend being fitted.
Retention at 1 000 operations is +47.7 MiB above fresh idle at the last checkpoint, +53.2 MiB after a
forced GC.

**The fitted slope is 38.5 MiB per 1 000 operations, under the plan's 100 MiB ceiling.** The slope
test that `soak-control` could not pass, passes here.

The two scenarios together separate growth that tracks operations from growth that tracks wall clock,
which is what this scenario was built to do:

|                              | soak-control | soak-control-extended | ratio     |
| ---------------------------- | ------------ | --------------------- | --------- |
| operations                   | 100          | 1 000                 | 10×       |
| wall clock                   | 2 h 44 m     | 3 h 14 m              | 1.18×     |
| post-GC RSS above fresh idle | +41.1 MiB    | +53.2 MiB             | **1.29×** |

Ten times the operations produced 1.29 times the retention. Scaling `soak-control`'s +41.1 MiB by
wall clock alone predicts +48.6 MiB; the observed figure is +53.2 MiB. Scaling it by operations
predicts +411 MiB. **Retention tracks elapsed time and a one-time warm-up, not operation count.**

The classification is unchanged from `soak-control` and now rests on ten times the sample:
allocator-high-water. Post-GC RSS is 11.3 % above fresh idle while live heap is 3.7 % _below_ it,
external memory is 1.3 % below it, and a forced GC freed 86 393 JSC objects. A forced GC _raised_
RSS by 4.3 MiB, as it did in `soak-control`. Nothing is retained on the heap.

Two figures qualify this. Post-GC RSS growth of 11.3 % still crosses the 10 % tolerance, which is why
the classification is `allocator-high-water` rather than `no-material-retention` — it is marginal,
and a tolerance of 12 % would have flipped it. And the **cgroup** slope is 106.8 MiB per 1 000
operations, just above the same ceiling the RSS slope passes; cgroup memory includes page cache,
which grows with the run's own sample and journal writes, so it is not the process's retention. The
RSS slope is the one the ceiling was written for.

### soak-hermetic-import cannot be read as retention

Ten waves of twenty standard provider imports, 200 imports, 0 failed, 6 h 39 m. It stalled 171 of 200
imports above 600 s, median 755.8 s, max 1 581.9 s, minimum 526 s against an expected ~13 s. Its
wave load windows were 1 119–1 582 s.

RSS at the 15-minute checkpoint: 638.5, 685.2, 718.5, 758.1, 783.1, 816.0, 842.5, 873.3, 904.5,
929.9 MiB — a monotonic climb of about 32 MiB per wave, ending 108 % above fresh idle, and a forced
GC recovered nothing. Heap-used growth of 10.3 % crosses the tolerance, which classifies it as
heap-retention.

**Do not quote that as Ryot's retention figure.** The memory accumulated while nearly every import
was suspended on a durable queue rather than working, so the population being measured is "state held
by a stalled workflow", not "state held after work completes". The scenario must be rerun once #8312
is fixed. It is recorded here as stall evidence and as the largest clean sample of the upstream
defect.

PostgreSQL is worth noting alongside it: its sampled peak reached 924.0 MiB during this soak, against
256.9 MiB during `soak-control` and 199–280 MiB at idle.

## Replay and process-spawn work

| Scenario                      | Requests | Executions | Processes | Replays started | Replays completed | Journal bytes |
| ----------------------------- | -------- | ---------- | --------- | --------------- | ----------------- | ------------- |
| hermetic-c2 (direct)          | 20       | 220        | 220       | 1 540           | 20                | 925 140       |
| live-c2 (live-import)         | 21       | 343        | 343       | 1 399           | 103               | 338 856 630   |
| soak-control (direct)         | 100      | 100        | 100       | 200             | 100               | 200           |
| soak-hermetic-import (import) | 200      | 37 000     | 37 000    | 155 313         | 11 200            | 136 384 175   |

`processesSpawned` equals `executions` in every scenario: **every sandbox execution is a fresh Deno
process**, with no reuse anywhere in the run.

The per-request fan-out differs by an order of magnitude between submission kinds:

- a `direct` execution with no host calls is 1 process (`soak-control`);
- a `direct` execution with five durable host calls is 11 processes and 77 replay starts;
- a live import is about 16 processes and 67 replay starts;
- a standard hermetic import with ten related entities and ten suggestions is **185 processes and
  777 replay starts**.

Replays per execution stay in a narrow 4–7 band across all four, so replay work tracks executions
rather than stalls; the soak's absolute numbers come from its fan-out workload. **The cost driver is
the number of executions a single import expands into.** 200 imports produced 37 000 process spawns.

Journal volume separates hermetic from live sharply: 46 KB per hermetic matrix request against
16.1 MB per live matrix request, a 350× difference that follows the size of the provider
responses being journalled.

## Evidence affected by sampling gaps or provider variability

- **Application sampler missed slots** exceed the 1 % gate in two scenario groups: live-c3 at 1.73 %
  (177 of 10 205) and live-c5 at 3.20 % (507 of 15 832). live-c2 reached 0.60 %,
  `soak-hermetic-import` 0.37 %, hermetic-c5 0.32 %; every other group is below 0.1 %. Sampled peaks
  and the health p95 for live-c3 and live-c5 are therefore **lower bounds**, and the gaps fall
  exactly where contention is highest. Window-averaged figures for those two are the least reliable
  numbers in this report.
- **Host sampling missed zero slots in every scenario**, so cgroup peaks, PSI, faults and disk deltas
  are sound throughout.
- **Profiled memory is inflated.** A profiled hermetic worker peaks at 233 MiB against 128 MiB
  unprofiled. The profile section's phase shape is evidence; its absolute levels are not.
- **CPU profiling a concurrent wave costs about 1.9 GB of host memory** — enough to drop MemAvailable
  under the watchdog floor and have the container stopped mid-scenario. Only sequential waves are
  profiled after commit `a19d6c58a5`, which is why `soak-hermetic-import` carries no wave-2 CPU
  profile.
- **Provider variability is small**: 1.2 % CoV for search and 7.5 % for details over 30 sequential
  executions. It cannot explain differences larger than that.
- **Two harness revisions.** Scenarios before and after the profiles phase ran on different harness
  commits; see `manifest.json` deviations.
- **Throughput on the import path is not evidence.** See `../effect-workflow-stall.md`.

## Decision inputs

Recorded as measurements. The architecture decisions belong to a separate review.

1. **Is worker concurrency 2 correct for 2 vCPU / 4 GB?** Hermetic throughput at c2 is 28.5/min,
   88 % of the c3 maximum, for 237.9 MiB of Deno RSS and CPU pressure 40.4, with health p95 at 18 ms.
   For live imports, c2 is the whole of the available gain: non-stalled per-import latency falls
   214.3 → 177.1 s from c1 to c2 and then stops improving. Nothing in this run shows c2 to be the
   wrong default; the cost of moving off it is documented in 2 and 3.
2. **Does c3 justify its cost?** c3 buys +13 % hermetic throughput over c2 (28.5 → 32.3/min) and
   nothing measurable on live latency (177.1 → 176.5 s). It costs +112 MiB Deno RSS hermetic,
   +376 MiB live, CPU pressure 40 → 64, and it recorded the run's worst health p95 at 543 ms.
3. **Does c5 reduce throughput or responsiveness?** It does not reduce hermetic throughput (32.4 vs
   32.3/min) but it buys nothing while adding 207 MiB of Deno RSS hermetic and 645 MiB live, raising
   CPU pressure to 86–99, raising hermetic major faults from 1 to 242 and live from 13 to 334, and
   degrading hermetic health p95 from 20 ms to 92 ms. Per-execution latency more than doubles,
   3.3 → 7.5 s. At live-c5 the Ryot cgroup peaks at 2.15 GiB with 784 MiB of host memory left.
4. **Which YTM phase makes its worker large?** `dependency-settled` / `provider-client-created`:
   +228.9 MiB RSS and +173.7 MiB heap in one step, 316 → 534 MiB, never released.
5. **What kind of memory is it?** Private anonymous V8 heap reservation left behind by a transient
   220 MiB heap spike that GC immediately reclaims logically but not physically. Not live heap, not
   mapped files (flat at 63 MiB), not external buffers (≤ 12.8 MiB), not response data.
6. **Does Bun retain after drain?** Not on the heap, and the slope is under the ceiling.
   `soak-control-extended` runs 1 000 direct executions and ends 11.3 % above fresh idle in RSS with
   live heap 3.7 % _below_ it and 86 393 fewer JSC objects after a forced GC: allocator-high-water,
   at a fitted **38.5 MiB per 1 000 operations against the plan's 100 MiB ceiling**. The per-wave
   series oscillates ±10 MiB around a flat level rather than climbing. `soak-control`'s 278 MiB
   projection was an artefact of extrapolating 100 operations whose growth was dominated by
   non-recurring first-wave cost.
7. **If RSS grows, what is it?** Allocator reservation, per 6, and it is driven by elapsed time and
   one-time warm-up rather than by operation count: ten times the operations over 1.18 times the wall
   clock produced 1.29 times the retention, against 10× if it tracked operations. The import soak's
   heap-retention classification is invalid as a Ryot measurement because it accrued under stall.
8. **How much replay and spawn work remains?** Every execution is a fresh process. A standard import
   expands into about 185 processes and 777 replay starts; a live import into about 16 and 67. 200
   imports cost 37 000 process spawns and 136 MB of journal. A live matrix request journals
   16.1 MB.
9. **Is full-import admission still needed after concurrency 2?** All twenty imports of a live
   repetition execute concurrently (`maxExecutingBodies` 19–20) regardless of worker concurrency,
   because worker concurrency bounds sandbox executions and not import bodies. Live-c1 already runs
   CPU pressure at 62 with a single worker and 1.03 GiB of cgroup footprint. The non-sandbox overlap
   this question asks about is therefore real and is not bounded by the worker setting. This run does
   not measure an admission limit, so it supplies the pressure inputs and not the answer.
10. **Is replay redesign the next highest-impact resource change?** The inputs are in 8: process
    spawn count scales with per-import fan-out and reaches 185 per import, and journal volume reaches
    16.1 MB per live import. Against that, CPU attribution says half of live active CPU is inside the
    provider library rather than in replay machinery. Both are measured; the ranking is a decision.

## Hypotheses

**Supported.**

- Sandbox throughput on two cores saturates at three workers; beyond that, cost is paid in
  per-execution latency, memory and reclaim, not in throughput.
- Deno worker memory scales linearly with worker concurrency at roughly 112 MiB per hermetic worker,
  and worker size is independent of concurrency.
- A YouTube Music worker is large because of one phase, and that memory is allocator reservation
  from transient parse garbage rather than retained live data.
- Ryot does not retain heap across drained executions. Confirmed at 1 000 operations by
  `soak-control-extended`, with a fitted RSS slope of 38.5 MiB per 1 000 operations under the plan's
  100 MiB ceiling.
- RSS growth after drain tracks elapsed time and one-time warm-up, not operation count.
- Scheduler dispatchers cost meaningful idle memory (138–184 MiB) and negligible idle CPU.

**Rejected.**

- That the hermetic matrix contributed stall-free import evidence. It submits `direct` executions and
  never reaches the import path; an earlier revision of `../effect-workflow-stall.md` wrongly counted
  400 of them.
- That phase segments can measure a stall. They record only active execution, so the suspension is
  invisible to them; the method reported ~12 s per import and zero stalls while 171 of 200 imports
  were taking 526–1 582 s.
- That the 41-minute wave cadence of the import soak was healthy. It was the stall.
- That `soak-control`'s 278 MiB per 1 000 operations indicated a slow leak. Measuring the thousand
  directly gives 38.5 MiB; the projection extrapolated a first-wave cost that does not recur.

**Unresolved.**

- The true retention of the import path, which needs a rerun after #8312 is fixed.
- Why `youtubei.js` parses and walks JavaScript on every execution, and whether that work is
  cacheable across executions. This run measured the cost, not the cause.
- Whether the live health p95 of 543 ms at c3 is reproducible or an artefact of the 1.73 % sampling
  gap in that group.
