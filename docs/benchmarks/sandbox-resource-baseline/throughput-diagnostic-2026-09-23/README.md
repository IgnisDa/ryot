# Narrow throughput diagnosis — 2026-09-23

## Result

**Defect 6 remains open. The controlled probes did not reproduce a twofold Effect-version
regression.** They identify where a small unit spends time, but do not establish why the earlier
soak became slower.

- Repeated Deno startup and loading are the largest measured cost. In the remote eight-host-call
  probe, nine worker lifetimes account for **4.93 s of 6.60 s**.
- Durable handoff/resume intervals account for another **1.29 s**, about **162 ms per host call**.
- PostgreSQL and Bun's workflow/SQL client work are material. Redis command execution and Bun JSON
  serialization are not the dominant costs in this small-payload probe.
- Instrumentation has a measurable cost. Profiled timing is unsuitable as the throughput baseline.
- Same-host tests of the **actual runtime files from both historical images** give runner readiness
  medians of **317 ms on rc.116 and 351 ms on rc.117**, not a twofold increase. An Effect-only rebuild
  gives **328 ms and 331 ms**.

No durable execution, queue, persistence, worker-pool, or application instrumentation settings were
changed. No soak or import matrix was rerun.

Source: [open defect 6](../2026-09-22T01-30-37Z/defects.md#6-import-throughput-regressed-about-2-against-rc116).
Numeric remote evidence is in [evidence.json](./evidence.json). Times below use milliseconds unless
stated otherwise. CPU time and inclusive spans overlap elapsed intervals; do not add them to wall time.

## Conditions and scope

The disposable local clone was `/tmp/ryot-throughput-diagnostic`, based on `f70160f336`.
It used Bun 1.4.0, Deno 2.8.1, macOS arm64, fresh PostgreSQL 18/Redis/object-storage containers,
on-demand workers, info logging, and disabled scheduler dispatchers. The normal E2E pool settings
were retained, with one submitted request at a time. All active Effect packages and the generated
Deno payload were switched together for the rc.116 comparison; other application code stayed fixed.

Remote access used **`SERVER_IP` and `COOLIFY_TOKEN` from the environment**. Read-only Coolify
inspection confirmed service `ryot-benchmark`, UUID `a2dt5g6dbmpwqwllnzsho8jc`.
The workload probe used the already-running fix image
`sha256:3df726ccc208b3ae18bb68cd0fa1fd063d91e158e0d703a9dd1ef7c3844d1605`:

- Linux x86_64, two vCPUs, Bun 1.4.0, Deno 2.8.1, on-demand mode, **worker concurrency 1**.
- OTLP export and the retained host/application samplers remained enabled; logging was `info`.
- Existing benchmark script and its owning benchmark user; requests ran inside the application
  container against localhost, so SSH/public-route latency was outside request timing.
- Remote workload windows: **2026-09-22 18:35:43–18:49:16 UTC**. The directory date is local date.

Each host-call pair runs `getUserPreferences` and `setCachedValue`. Cases were no calls, one pair,
four pairs, and a 1 MiB result without host calls. Seed 42, no synthetic sleep, no related entities
or suggestions; case order reversed on alternate rounds. The normal runs completed all 12 requests
each. The separate Bun profile, Deno profiles, and storage probe completed another nine requests.

This isolates an execution unit. It does **not** reproduce the soak's concurrency 2, twenty overlapping
imports, five host-call pairs, repeated 25 ms sleeps, relationship fan-out, or growing persisted state.
The remote deployment was not exclusively reserved. A probe that found it busy exited before enqueue;
existing work and samplers were not stopped. Local run variation was also substantial.

## 1. Deno startup and module loading

`deno-probe.mjs` launches a fresh process per sample with the production launcher restrictions and
256 MiB V8 limit. It measures parent spawn-to-first-stdout readiness, not time until clean exit.
The entry module imports either nothing, the shipped Effect bundle, or the shipped runner. The runner
has an open stdin and receives no job. This excludes SQL, Redis, queueing, bridge requests, and plugin
execution. Dynamic-import time is measured inside Deno; it is only part of readiness time.

Versions and target order alternate within each round. There are 15 retained samples per cell after
one warm-up round. Cache directories are writable by the application user.

| Files tested                        | Target        | rc.116 ready p50 | rc.117 ready p50 |
| ----------------------------------- | ------------- | ---------------: | ---------------: |
| Extracted from original images      | Bare process  |             77.4 |             74.6 |
| Extracted from original images      | Effect bundle |            317.9 |            323.7 |
| Extracted from original images      | Full runner   |            316.6 |            351.5 |
| Current source, Effect-only rebuild | Bare process  |             79.6 |             72.1 |
| Current source, Effect-only rebuild | Effect bundle |            330.6 |            330.6 |
| Current source, Effect-only rebuild | Full runner   |            327.7 |            331.5 |

Original images were retained on the host. Their generated payloads and runners were extracted from
`dist/main.js.map` in short-lived, network-disabled containers. Image digests and payload hashes are
retained in `evidence.json`. This avoids substituting today's rebuilt payload for the historical one.
The Effect bundle grew from 5,621,095 to 5,657,728 bytes, about 0.65%.

**Interpretation:** there is a substantial repeated loading cost beyond bare process startup. There
is no twofold readiness difference in either controlled comparison. The 11% historical-runner median
difference is a diagnostic observation, not a statistically established version effect or an
explanation of the soak's twofold busy-time-rate difference.

The profiled eight-call run has nine attempts. Mean checkpoint intervals per attempt were:

| Interval                                             | Profiled mean |
| ---------------------------------------------------- | ------------: |
| Worker recorded as spawned → runner-ready checkpoint |         550.7 |
| Runner-ready → module-imported checkpoint            |         153.7 |
| Module-imported → journal-loaded checkpoint          |          40.4 |
| Journal-loaded → result-built checkpoint             |          17.7 |
| Result-built → response-encoded checkpoint           |          10.4 |
| Response-encoded → worker release                    |          41.8 |

These intervals include checkpoint bridge traffic, host sampling/file writes, and profile flushing.
They locate work; they are not clean estimates of unprofiled phases. Much V8 sampled time was idle,
so worker lifetime must not be called Deno CPU time.

## 2. Queue handoff and workflow resume

Unprofiled remote means, three samples per case, with result polling every 200 ms:

| Workload               | Workers | Elapsed | Worker lifetimes | Between workers | Before first worker | After last worker | Bun CPU |
| ---------------------- | ------: | ------: | ---------------: | --------------: | ------------------: | ----------------: | ------: |
| No-op                  |       1 |   929.7 |            536.3 |               0 |               103.3 |             290.0 |   299.4 |
| Two host calls         |       3 | 2,256.3 |          1,515.3 |           288.0 |                89.0 |             364.0 |   591.0 |
| Eight host calls       |       9 | 6,597.3 |          4,926.7 |         1,294.7 |                90.0 |             286.0 | 1,795.4 |
| 1 MiB result, no calls |       1 | 1,361.0 |            821.0 |               0 |                84.0 |             456.0 |   358.3 |

The four elapsed components sum to request latency for each retained row. Between-worker time includes
host-call dispatch, durable activity/persistence work, queue handoff, and workflow resume. It is **not
pure queue wait**. First-worker time also includes submission/pinning; terminal time includes result
persistence and poll quantization.

One eight-call trace window contained nine worker spans and ten workflow `.run` bodies. Worker spans
sum to 5.03 s in that 6.414 s request. Replayed activity spans recur, so summing nested workflow/activity
spans would double-count. The trace supports repeated durable resumption, not one unexplained long
stall. This probe cannot distinguish queue dwell from resume processing more finely without new
boundary timestamps.

## 3. SQL and Redis

The same 6.414 s trace window had 30 exported application `sql.execute` spans: 74.7 ms inclusive total,
7.67 ms maximum. **This excludes unexported Effect Cluster persistence SQL** and must not be presented
as total SQL cost. The Bun profile independently puts PostgreSQL socket writes among the largest leaves.

Local `pg_stat_statements`, enabled only in disposable diagnostic PostgreSQL, measured these means:

| Workload, rc.117 first unprofiled run | SQL calls | PostgreSQL statement execution | Redis command-time sum |
| ------------------------------------- | --------: | -----------------------------: | ---------------------: |
| No-op                                 |      75.8 |                            7.6 |                    2.2 |
| Two host calls                        |     188.2 |                           19.1 |                    5.8 |
| Eight host calls                      |     639.8 |                           64.4 |                   24.1 |
| 1 MiB result                          |      91.4 |                          142.1 |                    3.6 |

SQL totals include cluster traffic, background polling, and result polls, excluding the stats query
itself. They measure server statement execution, not connection waits or network/client overhead.
Redis command statistics can include nested Lua commands; their sum is not exclusive CPU time.

A separate remote eight-call request took 6.713 s. Container counters bracketed a wider 11.641 s
window because SSH/Docker sampling was outside the request:

| Container                                  | CPU during bracket | CPU during separate 9.621 s idle bracket |
| ------------------------------------------ | -----------------: | ---------------------------------------: |
| Ryot, including Deno and diagnostic client |            8,009.7 |                                  1,687.3 |
| PostgreSQL                                 |              804.0 |                                     91.7 |
| Redis                                      |              212.1 |                                    214.0 |
| OTLP collector                             |              112.2 |                                     69.6 |

Redis reported 338 `EVALSHA` calls / 31.014 ms and 54 `EVAL` calls / 8.283 ms in the work bracket.
The service was not reset. These include background queue polling and are not per-request-exclusive.
PostgreSQL work is material; Redis server execution is not the dominant delay in this probe.

## 4. Bun CPU and serialization

The separate Bun profile contains 2,049 stack samples. Leading identifiable stacks include:

- PostgreSQL socket writes: 310 samples (15.1%).
- `heapStats` inside the profiling checkpoint: 180 (8.8%), **profiler bookkeeping**.
- OTLP trace `JSON.stringify`: 35 (1.7%).
- Redis socket writes: 18 (0.9%).

Effect context creation, HTTP/RPC dispatch, and other framework work also appear. These are sampled
stack shares, not an exhaustive partition of process CPU or request elapsed time.

At 200 ms polling, the 1 MiB case adds about 59 ms Bun CPU and 285 ms worker lifetime over the no-op
mean. Its Deno profile shows 227 ms sampled garbage collection and 32 ms in `jsonClone`. Result
generation, validation, cloning, encoding, and durable JSON persistence all contribute; this is not
a pure JSON serialization microbenchmark. The original soak used a 1 KiB payload, so the 1 MiB
result does not explain its regression.

## 5. Instrumentation overhead

For eight host calls on the remote host:

| Capture                           | Samples | Mean elapsed | Mean worker lifetimes | Mean Bun CPU |
| --------------------------------- | ------: | -----------: | --------------------: | -----------: |
| Unprofiled, 20 ms result polls    |       3 |        6,628 |                 4,995 |        2,404 |
| Unprofiled, 200 ms result polls   |       3 |        6,597 |                 4,927 |        1,795 |
| Bun CPU profile, 20 ms polls      |       1 |        7,077 |                 5,444 |        2,611 |
| Deno CPU/checkpoints, 20 ms polls |       1 |        8,928 |                 7,332 |        3,734 |

Reducing result polling cut observed Bun CPU by about 25% without a material elapsed-time change.
These sequential small samples are not a randomized overhead estimate. The 20 ms trace window had
232 result polls consuming 942 ms of inclusive result-service spans, plus 38 runtime-metrics calls
with 332 ms inclusive duration. These overlap other work.

The Deno profiling sample was about 35% slower than the unprofiled 20 ms-poll mean. Its additional
checkpoint traffic and clean-exit flushing make those samples unsuitable as throughput controls.
The local Deno profiling attempt also exposed a response/clean-exit race: one request failed with
`Sandbox process exited with code 0 before returning a response`. That failed attempt was excluded;
it was not treated as slow successful work. All remote profiled requests completed.

Local OTLP-on/off probes were also run. The eight-call p50 was 4,549 ms with OTLP against 3,836 and
4,321 ms in the two rc.117 off runs. Host drift was too large to assign that difference entirely to
exporting. Existing remote samplers and OTLP were left running, so their independent remote overhead
is still unmeasured. The original rc.117 artifact additionally sets `profileWaveTwo: true`; the
rc.116 artifact does not. That difference cannot explain all six rc.117 waves on its own.

## Effect-only backend control and historical cross-check

Local end-to-end p50s, five samples per cell, same code and fresh services; run order rc.117 A,
rc.116 A, rc.116 B, then rc.117 B, with a separate OTLP run before the last control:

| Effect / run | No-op | Two calls | Eight calls | 1 MiB |
| ------------ | ----: | --------: | ----------: | ----: |
| rc.117 A     |   448 |     1,231 |       3,836 |   759 |
| rc.116 A     |   479 |     1,244 |       3,824 |   778 |
| rc.116 B     |   495 |     1,346 |       3,643 |   731 |
| rc.117 B     |   515 |     1,406 |       4,321 |   829 |

The rc.116 A eight-call range was 3,561–6,564 ms; rc.117 A was 3,578–3,894 ms. These variations
prevent a small-difference claim, but the twofold slowdown is not consistently reproduced by changing
Effect alone. This is a low-contention macOS control, not a matched Linux import comparison.

The retained soak counters provide another useful cross-check. Dividing whole-scenario CPU counters
by **recorded worker executions**, rather than successful imports, gives:

| Counter, ms per recorded execution         | rc.116 run | rc.117 run | Ratio |
| ------------------------------------------ | ---------: | ---------: | ----: |
| Bun CPU                                    |      135.9 |      227.8 | 1.68× |
| Ryot cgroup CPU minus Bun CPU, mostly Deno |      249.6 |      468.1 | 1.88× |
| PostgreSQL CPU                             |       74.9 |      136.7 | 1.82× |
| Redis CPU                                  |        6.7 |        9.0 | 1.35× |

Denominators are 37,000 and 25,900, respectively. The latter includes work from the truncated seventh
wave despite only six waves being retained as completed. Whole-scenario counters include idle and
recovery windows, and the cgroup-minus-Bun value is a proxy, not isolated Deno CPU. These ratios do not
prove a common hardware cause. They show that the historical change extends beyond Deno loading or
Effect's Bun workflow code alone; host conditions, workload/persistence amplification, and collection
overhead remain relevant.

## What remains to establish the cause

The expensive repeated work is identified; the **historical increase** is not causally attributed.
Do not close defect 6 or change durable execution semantics based on these results.

The next useful experiment is one reserved, same-host **full-path** pair using the original image
digests and equivalent isolated fixture state: a few single-script requests with the soak's five
pairs, 25 ms delay, and 1 KiB payload, then one small fixed-concurrency batch if the serial pair agrees.
Hold polling, OTLP, samplers, cache ownership/warmth, and background load constant. Record per-attempt
enqueue, dequeue, deferred completion, and next-resume boundaries in memory, flushing once after the
request. Capture SQL statement counts/server time and service CPU deltas in the same windows.
That separates host-wide CPU-cost changes from persistence/resume amplification without another soak.

## Reproduction tools and verification

- [workload-probe.mjs](./workload-probe.mjs): tested remote workload, profile, and timing decomposition.
  Run inside the existing application container with an installed benchmark script ID and its owning
  user ID from benchmark setup state. The admin token is read from the container environment.
- [extract-image-runtime.mjs](./extract-image-runtime.mjs): extract shipped generated files from an
  image's source map into a mounted `/output` directory. It does not start the server.
- [deno-probe.mjs](./deno-probe.mjs): interleave the two extracted runtime directories on the same host.
  Default directories are `/home/ryot/tmp/deno-v116` and `deno-v117`; `DIAGNOSTIC_DENO_ROOT` changes the
  prefix. `DIAGNOSTIC_RESULT` selects the JSON result path.

Example workload invocation after copying the probe into the container:

```sh
ssh "root@$SERVER_IP" "docker exec -e DIAGNOSTIC_POLL_MS=200 $CONTAINER \
  bun /home/ryot/tmp/workload-probe.mjs $SCRIPT_ID $USER_ID throughput-check normal"
```

Modes are `normal` (12 requests), `single` (one eight-call request), `cpu` (four requests with Bun
sampling), and `deno` (four requests with per-attempt Deno profiles). Results go to `/tmp/<label>.json`
inside the container. Use a fresh label. Profile modes add overhead; compare against normal mode.

For image extraction, run `bun /probe.mjs` with `--entrypoint bun --network none`, mounting the
extractor read-only at `/probe.mjs` and a separate output directory at `/output`. Copy each resulting
directory to its probe location. Ensure its cache directory is writable by UID 1001, the measured
container user, before running the Deno probe. Keep readiness and exit duration separate.

An initial `deno eval` comparison used root-owned copied directories and could not retain a writable
cache. It measured much longer whole-process durations and was discarded. The retained comparisons
use `deno run`, first-stdout readiness, writable caches, and a discarded warm-up round.

Verification: all retained remote workload requests completed; both retained Deno comparisons ran
all 96 process launches; `node --check` and `oxfmt --check` passed for the three retained scripts.
The evidence rows were checked for exact elapsed-component sums. Diagnostic profiles were reduced
to the bounded summaries above; no raw CPU profile, heap snapshot, credential, or provider response
is committed. The existing deployment, database, Redis, and samplers were left running.
The raw diagnostic CPU profiles and the copied remote probe/runtime-cache files were removed after
summarization. Numeric timing JSON remains outside the repository; the bounded evidence is retained here.
