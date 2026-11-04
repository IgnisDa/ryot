# Flow probes

`e2e/src/api/perf/flow-probes.test.ts` (opt-in, `RUN_FLOW_PROBES=1`) runs single flows sequentially
on the shared e2e server while nothing else runs. Before each flow it waits until the server is
back at its calibrated idle rate; after it returns it waits again ("settle"), so async follow-up
work is included. Costs are reported net of the idle background (runner heartbeat, 300-shard lock
refresh, storage polling, probe snapshots).

Columns: caller latency (what the HTTP client waits for), settle (async tail after the caller
returned, ± one 1.5 s window), statements and transactions from `pg_stat_statements` /
`pg_stat_database`, database execution time, CPU of the API process tree (backend plus sandbox
daemons; PostgreSQL CPU excluded).

## Run `probes2` (revision `71620fab90`, idle VM)

Steady-state median of repeats (first calls are up to 2× slower):

| Flow                                              |    Caller |    Settle | Statements | Transactions |   DB exec | Server CPU |
| ------------------------------------------------- | --------: | --------: | ---------: | -----------: | --------: | ---------: |
| Signup (incl. user bootstrap)                     |     1.3 s |    ≤1.6 s |        915 |      100–650 |    165 ms |      1.1 s |
| Media movie fixture (admin seed + schema reads)   |     0.6 s |     0–3 s |        265 |       80–480 |     70 ms |      0.4 s |
| Event create, media `backlog`, 1 item             |     1.2 s | 1.6–4.6 s |      2,440 |    850–1,250 |    870 ms |      1.8 s |
| Media review operation (movie fixture + 1 rating) |     4.1 s |   0–1.6 s |      6,040 |  2,100–2,550 | 3.0–3.5 s |      4.3 s |
| Workout, 1 set (create workout + set events)      | 1.8–2.0 s |     3.1 s |      1,715 |    600–1,000 |    300 ms |  1.2–1.4 s |
| Workout, 10 sets                                  |     2.0 s |     3.1 s |      2,150 |          935 |    340 ms |      1.7 s |
| Workout, 25 sets                                  |     2.2 s |       0 s |      2,850 |          620 |    380 ms |      1.7 s |

Idle background on that server: roughly 11 transactions/s and 70 ms/s of backend CPU with no
requests at all.

### Writes behind one `backlog` event create

| Table                          | Rows written |
| ------------------------------ | -----------: |
| `cluster_messages`             |          479 |
| `cluster_replies`              |          184 |
| `mutation_receipt`             |          109 |
| `workflow_execution`           |           50 |
| `sandbox_workflow_reference`   |           18 |
| `background_work`              |           14 |
| `automation_run`               |           11 |
| `relationship_projection_work` |            5 |
| `event`                        |            3 |

The media review operation doubles that (900 cluster messages, 84 workflow executions, 25
automation runs). Writing three events costs ~2,400 statements and ~1.8 s of backend CPU; the domain
rows are under 1% of the writes.

### Reading

- The code-reading estimate for a no-hook create (≈150–200 statements, 2 workflows) is the floor;
  media events trigger the plugin's lifecycle cascade (before policies `consumption` and
  `episodic-session`; required batch after hooks `ensure-media-library-membership-on-events` →
  `record-media-library-membership-event`; async `library-summary-refresh`, relationship
  projections). Each hop is its own durable chain (automation run → script workflow → sandbox →
  durable host write → new lifecycle plan), so cost multiplies per hop.
- Signup spends ~1 s of backend CPU and ~900 statements to run two one-entity bootstrap scripts.
  ×926 signups ≈ 15–17 min of backend CPU per suite run before any test logic.
- Workouts have a large fixed cost (~1,700 statements) and ~45 statements per extra set.
- PostgreSQL is not the limiting resource at this load: DB execution time is a fraction of caller
  latency. Backend CPU is roughly equal to caller latency, i.e. the backend is CPU-bound in its own
  orchestration (encoding, workflow replay, cluster storage, Effect fibers), and that is what
  saturates under 6 parallel workers on 4 vCPUs.

## Run `probes3` (revision `1067f4c906`, idle VM, `PROFILE=1`)

Costs match `probes2` within noise (signup 915 statements, ≈1.0 s server CPU; backlog create
≈2,400 statements, ≈1.6–1.7 s; review operation ≈6,000 statements, ≈4.3 s), so profiling did not
distort the run. One backlog create in three settled only after 10.8 s, when a background tail
(about 6,800 statements) fell into its window.

### Durable executions behind one flow

| Flow                         | Workflows started (by name)                                                                                                                                                 | Sandbox runs                                                                                                                                                                                                        |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Signup                       | `UserBootstrapWorkflow` 1, `ScriptExecutionWorkflow` 2, `SandboxDurableHostServiceWorkflow` 2                                                                               | 2 bootstrap scripts                                                                                                                                                                                                 |
| Media movie fixture          | `AutomationRunWorkflow` 1, `ScriptExecutionWorkflow` 1 (hook `custom-publish-year`)                                                                                         | 1                                                                                                                                                                                                                   |
| Backlog event create, 1 item | 36: `ScriptExecution` 9, `SandboxDurableHostService` 6, `AutomationRun` 6, `PolicyBatch` 4, `BackgroundWork` 3, `UserCommand` 2, `UserEntityPreparation` 2, `EventCreate` 2 | 9 scripts; hooks `reconcile-history` ×2, `library-summary-refresh` ×2, `ensure-media-library-membership-on-events`, `record-media-library-membership-event`; background `user-script` ×2, `relationship-projection` |
| Review operation             | 43, adding `review-created`, `notification`, `NotificationDeliveryWorkflow`                                                                                                 | 13                                                                                                                                                                                                                  |
| Workout (any set count)      | 12: `ScriptExecution` 4, `AutomationRun` 3, `PolicyBatch`, `BackgroundWork`, `SandboxDurableHostService`, `EventCreate`                                                     | 4; hooks `workout-set`, `workout-exercise`, `workout-records`; background `event-projection`                                                                                                                        |

### Sandbox time versus everything else

From the run's span metrics:

- 183 sandbox executions took 10.5 s in total (≈57 ms each, including in-sandbox host-call waits).
- 337 sandbox replays took 5.9 s.
- Only 103 replays completed; 234 ended `pending`, i.e. the script suspended at a durable host call
  and was later run again from the top. An automation script ran ≈3.4 times on average.

The sandbox itself is cheap; the replay protocol around it multiplies the work outside it:

- Every write host call (`createEvents`, `ensureUserEntities`, entity updates and deletes,
  relationship changes, signals, notifications, projection requests) is dispatched as its own
  durable workflow, and the script then replays (`kernel/sandbox/src/host/host-execution-policy.ts`).
- Reads without a result-size bound (`getPluginConfig`, `getEntitySchemas`, `listEventSchemas`,
  `getUserSettings`, …) also suspend.

### Backend CPU profile

Bun `--cpu-prof` of the API process over the whole run, attributed with `scripts/cpuprofile.py`
(gaps between samples capped at 3 ms because Bun samples only while the JS thread runs):

| Bucket                                                                                         | Busy CPU | Share |
| ---------------------------------------------------------------------------------------------- | -------: | ----: |
| Total busy (JS thread)                                                                         |   50.5 s |  100% |
| Self time in the `effect` package (fiber run loop, context lookups, schema, cluster, workflow) |   21.1 s |   42% |
| Native (socket writes, JSON, Map, strings)                                                     |   18.0 s |   36% |
| Kernel backend code itself (`kernel/backend/src`)                                              |    2.8 s |    6% |
| drizzle-orm + `@effect/sql-pg`                                                                 |    4.4 s |    9% |
| ioredis                                                                                        |    0.8 s |    2% |

Hot frames:

- Socket writes, one per statement or command: PostgreSQL 4.1 s, Redis 1.5 s.
- Row decoding (`PgProtocol.decodeDataRow` → `JSON.parse`): 1.2 s.
- OTLP span serialization: 0.85 s. This only applies with an OTLP endpoint; the harness sets one.
- `stableStringify`: 0.5 s.
- Effect `Context` map rebuilding: 0.6 s.

Stacks containing logger or OTLP frames account for 6.0 s (12%); the forked logging fibers' run-loop
time is not attributable by stack, so the real share is somewhat higher. Both costs are artifacts of this run's instrumentation. The harness set `OTEL_EXPORTER_OTLP_ENDPOINT`, and with an
endpoint plus a log level at or below debug the server decorates its tracer: every span end forks a
fiber that writes a "span completed" line (`platform/observability/observability.ts`). Those were
40,544 of the 40,839 server-log lines. Normal e2e runs set no endpoint, so they pay neither cost;
`vm-e2e.sh` now exports to the collector only with `OTEL=1`. Without them, about 44 s of the 50.5 s
remains.

There is no algorithmic hotspot. CPU is spread evenly across the runtime, proportional to the number
of operations (statements, fibers, spans, durable messages). Removing operations is the lever;
micro-optimizing any one function is not.

## Run `probes-eng` (revision `6692634b13`: slices 1–2, idle VM)

The same probes on the PostgreSQL workflow engine. Medians of repeats, `probes3` → `probes-eng`.
`probes3` ran with `PROFILE=1`, which matched `probes2` within noise.

| Flow                    |    Statements | Transactions |       DB exec |    Server CPU |        Caller |
| ----------------------- | ------------: | -----------: | ------------: | ------------: | ------------: |
| Signup                  |     920 → 568 |    256 → 227 |  161 → 135 ms | 1.00 → 0.81 s | 1.13 → 0.89 s |
| Media movie fixture     |     267 → 155 |    169 → 109 |    71 → 70 ms | 0.28 → 0.25 s | 0.57 → 0.42 s |
| Event create, `backlog` | 2,434 → 1,310 |    912 → 459 |  983 → 247 ms | 1.75 → 1.27 s | 1.26 → 0.70 s |
| Review operation        | 6,018 → 3,037 |  2,717 → 982 | 3.23 → 0.80 s | 4.34 → 2.92 s | 4.33 → 2.52 s |
| Workout, 1 set          |   1,728 → 902 |    572 → 430 |  286 → 215 ms | 1.10 → 0.95 s | 1.59 → 1.21 s |
| Workout, 10 sets        | 2,148 → 1,302 |    686 → 230 |  359 → 269 ms | 2.02 → 1.11 s | 1.94 → 1.50 s |
| Workout, 25 sets        | 2,845 → 1,993 |    798 → 266 |  419 → 284 ms | 1.61 → 1.21 s | 2.25 → 1.52 s |

- Statements fall by 35–50% and database time by up to 75%, which matches the Cluster share of the
  statements measured in `base1`.
- Server CPU falls by only 15–35%. The remaining cost is the cascade itself: the backlog create still
  starts the same 36 workflows and 9 sandbox scripts and writes 85 mutation receipts. Slices 3–4
  target those.
- Idle backend CPU halved, from 89 to 46 ms/s. Idle transactions are dominated by the probe's own
  snapshots.
- Writes behind one backlog create: `mutation_receipt` 85, `workflow_step` 77,
  `workflow_execution` 57, `automation_run` 15, `sandbox_workflow_reference` 14. The 663
  `cluster_*` rows are gone.

## Runs `probes4` → `probes5` (slice 3a: account admission in one statement)

`probes4` is the engine revision with per-statement capture; `probes5` adds slice 3a. Medians of
repeats, net of the idle baseline.

| Flow                    |    Statements | Transactions |      DB exec |    Server CPU |        Caller |
| ----------------------- | ------------: | -----------: | -----------: | ------------: | ------------: |
| Signup                  |     564 → 473 |    218 → 261 | 144 → 123 ms | 0.84 → 0.77 s | 0.92 → 0.91 s |
| Event create, `backlog` | 1,307 → 1,066 |    362 → 337 | 231 → 218 ms | 1.17 → 1.14 s | 0.67 → 0.66 s |
| Review operation        | 3,035 → 2,507 |    946 → 748 | 836 → 757 ms | 3.13 → 3.15 s | 2.69 → 2.54 s |
| Workout, 1 set          |     900 → 764 |    332 → 203 | 190 → 188 ms | 0.91 → 0.91 s | 1.19 → 1.16 s |
| Workout, 25 sets        | 1,993 → 1,760 |    365 → 363 | 312 → 335 ms | 1.51 → 1.44 s | 1.80 → 1.71 s |

- Statements fall by 12–18%, as predicted from the account-check share in `probes4`.
- CPU and caller latency do not move. Statement count is no longer what drives the server's cost.

### What one event create still does (`probes5`)

| Unit                                     | Count |
| ---------------------------------------- | ----: |
| Workflow executions                      |    18 |
| Workflow steps                           |    64 |
| Script executions                        |     5 |
| Sandbox runs (replays)                   |     9 |
| Deferred host requests (each ends a run) |     4 |

The 18 executions are:

- 5 `ScriptExecutionWorkflow`
- 3 `AutomationRunWorkflow`
- 3 `SandboxDurableHostServiceWorkflow`
- 2 `PolicyBatchWorkflow`
- 2 `BackgroundWorkWorkflow`
- one each of `EventCreateWorkflow`, `UserCommandWorkflow` and `UserEntityPreparationWorkflow`

The review operation runs 13 scripts in 25 sandbox runs, with 43 executions and 166 steps. It
costs about 1.4 s more API CPU than the event create, which is roughly 80 ms for every added
(1.4 executions + 1 sandbox run + 6 steps). The overhead is per operation, not per statement.

### Where the CPU goes (`prof5`, API process, 32.3 s busy)

- **Self time:** Effect runtime 38%, native 35%.
  - `writeBuffered` takes 10.6%: socket writes to PostgreSQL (1.9 s) and Redis (1.5 s).
- **Inclusive time:**

  | Area            | Share |
  | --------------- | ----: |
  | Schema          |   19% |
  | Logging         |   12% |
  | Sandbox host    | 11.5% |
  | Workflow engine |   10% |
  | Redis           |  8.5% |
  | SQL             |    8% |

- **Redis:** the fair queue polled every 25 ms and sent the full Lua script each time. Commit
  `4eef867752` sends the script hash instead and backs off when the queue is idle.
- **Script authority on every host call.** `SandboxExecutionAuthority.resolve` decodes the full
  principal twice, reloads the script pin, and compares two `stableStringify` outputs. That is
  1.25 s of the profile (0.53 s schema, 0.72 s stringify) plus one pin query per host call.
- **Boot-only costs.** Stored manifest decoding (0.49 s) and plugin archive normalization (1.7 s)
  happen only in the first 10 s, while boot synchronizes the system plugins. They are not
  per-signup costs.

## Runs `focus1`, `probes6`, `bytes2` (principal comparison and payload sizes)

`FLOW_PROBE_FOCUS=N` runs one signup, one fixture and N event creates, so a CPU profile covers only
that flow.

`focus1` profiles 30 event creates (API process, 22 s busy). Two findings:

- **Authority resolution was 9.1% of API CPU, inclusive.** It ran on every host call and
  stringified both the stored and the presented principal to compare them.
  - Commit `73ba14bcde` memoizes the decode of the presented principal and compares decoded values
    with `jsonValueEquals`. The check itself is unchanged.
  - `probes6` measures the effect on API CPU:

    | Flow             | Before |  After |
    | ---------------- | -----: | -----: |
    | Event create     | 1.04 s | 0.83 s |
    | Review operation | 2.44 s | 1.93 s |
    | Workout, 25 sets | 1.52 s | 1.18 s |
    | Signup           | 0.86 s | 0.72 s |

- **PostgreSQL socket writes took 11% of API CPU, scaling with bytes rather than statements.**
  Parsing JSON from rows took another 4.8%.

`bytes2` measures what one event create writes into the workflow tables: about 790 KB of JSON.

| Rows                                             |  Bytes |
| ------------------------------------------------ | -----: |
| `pin-sandbox-workflow-script` results (5)        | 169 KB |
| `SandboxDurableHostServiceWorkflow` payloads (3) | 142 KB |
| Background work `start` results (2)              | 101 KB |
| `prepare-projection` result                      |  67 KB |
| `ScriptExecutionWorkflow` payloads (5)           |  73 KB |
| Sandbox queue results (9)                        |  56 KB |
| `PolicyBatchWorkflow` payloads (2)               |  40 KB |
| `UserCommandWorkflow` payload                    |  36 KB |
| `UserEntityPreparationWorkflow` payload          |  36 KB |
| `changeUserRelationships` input                  |  35 KB |

Most of it is copies of the script principal, about 33 KB for a media script:

- `compiledHashes`, about 20 KB: slug and hash of all 214 scripts in the revision.
- `schemaScope`, about 9 KB: 24 entity, 110 event, 51 relationship and 15 signal schemas.

Both are fixed by the plugin revision, yet every pin result, payload and lifecycle command carries
them. Every host call also rebuilds `compiledHashes` in SQL with `jsonb_object_agg` to detect
garbage-collected scripts.

## Run `probes7` (slim principals, commit `1760dc4d7a`)

Pins carry a digest of the revision's script hashes. The schema scope and the sandbox authority are
read by revision ID. Medians, `probes6` → `probes7`; bytes are the JSON written to workflow
payloads and step results per flow.

| Flow                    |        Bytes |       API CPU |      DB exec |        Caller |
| ----------------------- | -----------: | ------------: | -----------: | ------------: |
| Event create, `backlog` | 790 → 205 KB | 0.83 → 0.79 s | 232 → 184 ms | 0.66 → 0.60 s |
| Review operation        |     → 500 KB | 1.93 → 1.52 s | 790 → 615 ms | 2.40 → 2.04 s |
| Workout, 1 set          |     → 116 KB | 0.76 → 0.68 s | 198 → 250 ms | 1.16 → 1.14 s |
| Workout, 25 sets        |     → 605 KB | 1.18 → 1.06 s | 309 → 370 ms | 1.60 → 1.59 s |

`probes6` recorded no byte counts. The event-create figure before the change comes from `bytes2`,
which ran on the revision before this one.

What still writes the most:

- **Sandbox queue results, about 6 KB per run:** logs, value, timing and inline journal entries.
  An event create has 9 runs (54 KB) and a review 25 (131 KB).
- **The event drafts of a workout, persisted about five times.** A 25-set workout stores the same
  ~75 KB draft list in four steps (`prepare-events`, `validate-final-drafts` and two `apply` steps)
  and in the `PolicyBatchWorkflow` payload.
- **Pins and host-service payloads, 4–8 KB each.** Most of what remains is the config schema and
  script metadata.

## Runs `probes8`, `probes9` (inline writes and per-batch schemas, `912380c69b`)

Two runs of the same revision, against `probes7`. Server CPU, transactions and statements are net
of the calibrated idle rate; `probes7 → probes8 / probes9`, medians.

| Flow                    | Sandbox runs |        Net server CPU |         Statements |              Bytes |                Caller |
| ----------------------- | -----------: | --------------------: | -----------------: | -----------------: | --------------------: |
| Signup                  |        4 → 2 |    736 → 622 / 629 ms |    473 → 453 / 457 |         19 → 16 KB |    905 → 682 / 691 ms |
| Event create, `backlog` |        9 → 6 |   1072 → 805 / 783 ms | 1061 → 1046 / 1051 |       209 → 193 KB |    599 → 528 / 527 ms |
| Review operation        |      25 → 19 | 2395 → 2257 / 2013 ms | 2505 → 2435 / 2437 | 512 → 561 / 520 KB | 2044 → 2027 / 1971 ms |
| Workout, 1 set          |        5 → 4 |    778 → 740 / 772 ms |    763 → 750 / 754 |       119 → 105 KB | 1140 → 1066 / 1214 ms |
| Workout, 10 sets        |        5 → 4 |   893 → 1071 / 993 ms | 1128 → 1121 / 1119 |       305 → 192 KB | 1368 → 1388 / 1568 ms |
| Workout, 25 sets        |        5 → 4 | 1197 → 1378 / 1188 ms | 1760 → 1760 / 1757 |       619 → 341 KB | 1588 → 1879 / 1707 ms |

- **Inline writes** remove a third of the replays where no nested sandbox run is involved. Event create
  keeps 6 of its 9 runs because its `createEvents` starts policy runs, which defer the write (step 3
  of `design-run-once.md`).
- **One schema copy per batch** halves a workout's bytes: the 25-set workout's policy batch payload
  drops from 75 KB to under 20 KB, and `prepare-events`, the `apply` steps and
  `validate-final-drafts` shrink alike.
- **Workouts** run one replay fewer but show no CPU change beyond noise. Each workout size ran once
  per run, and the 10-set flow's +100–180 ms sits within the spread between the two runs.
- **Settle times** take the values 0.13 s, 1.7 s or 3.3 s in every run. They measure the settle
  window, not the flow, so the raw `ms` figures cannot be compared.
- **Background work:** two of the three review samples in `probes8` ran an extra relationship
  projection and an extra user script. The faster write path changes when coalescing requests
  arrive, so a request can now land after the first run has started.

## Runs `probes2` → `probes9` → `probes10` (baseline, slice 3 end, `fa8aaf6900`)

Medians of repeats on the idle VM. `probes9` is `912380c69b`; `probes10` adds settled-replay reuse,
the leaner user command commit, and single-step history-correction phase changes.

| Flow                    | Caller               | Statements            | Server CPU           |
| ----------------------- | -------------------- | --------------------- | -------------------- |
| Signup                  | 1.32 → 0.69 → 0.71 s | 917 → 463 → 453       | 1.32 → 0.78 → 0.71 s |
| Media movie fixture     | 0.63 → 0.50 → 0.50 s | 265 → 159 → 160       | 0.71 → 0.40 → 0.43 s |
| Event create, `backlog` | 1.21 → 0.53 → 0.56 s | 2,442 → 1,057 → 991   | 2.23 → 0.86 → 1.10 s |
| Review operation        | 4.12 → 1.97 → 1.98 s | 6,042 → 2,441 → 2,361 | 4.73 → 2.20 → 2.25 s |
| Workout, 1 set          | 1.91 → 1.21 → 1.17 s | 1,719 → 758 → 754     | 1.69 → 0.90 → 0.87 s |
| Workout, 10 sets        | 2.03 → 1.57 → 1.46 s | 2,157 → 1,127 → 1,126 | 2.12 → 1.17 → 1.25 s |
| Workout, 25 sets        | 2.24 → 1.71 → 1.76 s | 2,851 → 1,765 → 1,754 | 1.94 → 1.37 → 1.33 s |

- Against the baseline, callers wait 21–54% less, with 38–61% fewer statements and 31–52% less
  server CPU.
- `probes9` → `probes10` is flat within noise. The later changes cut work that only repeats under
  load (workflow re-activations, commits queued behind one entity lock, correction steps), which
  these single-flow probes do not exercise. Settle times vary by the ±1.5 s sampling window.

## Run `probes11` (the write path without hooks, `54c2464f36`)

Adds `event-create-no-hooks` and `event-create-no-hooks-50`, which write `measurement-reading` events:
no hook matches them and they have no projection. The checkout carried the owner's uncommitted
`recovery` test and smoke edits, which do not touch these flows. Medians; API CPU has 10 ms ticks and
single samples ranged 70–160 ms, so compare magnitudes.

| Flow                | Caller | Statements | Transactions | DB exec | API CPU | Workflows | Steps | Scripts |
| ------------------- | -----: | ---------: | -----------: | ------: | ------: | --------: | ----: | ------: |
| Event, no hooks     | 179 ms |        148 |           62 |   51 ms |  130 ms |         2 |     7 |       0 |
| 50 events, no hooks | 673 ms |      1,475 |           66 |  197 ms |  480 ms |         2 |     7 |       0 |
| Event, `backlog`    | 610 ms |      1,006 |          311 |  183 ms |  740 ms |      22.8 |  75.4 |     5.8 |
| Signup              | 704 ms |        452 |          176 |  120 ms |  610 ms |         5 |     9 |       2 |

- **The hook cascade is about 82% of the API CPU of a backlog create**, 85% of its statements and 70%
  of its caller latency.
- **The floor is still high:** 148 statements and 13 `mutation_receipt` writes for one row.
- **The batch path is per-item:** about 27 statements, 7 ms of CPU and 10 ms of latency per extra
  event, with one `event`, `event_scope`, stream update and stream lookup statement each.
- Settle figures are omitted; as in `probes8` they measure the settle window.

## `full11` statements by layer

A keyword classification of `pg_stat_statements` for the shared database: 3,333,599 calls, 1,042 s.
It is approximate. Views mentioning plugin tables count as catalog, so RyotQL reads are undercounted,
and the catalog time includes 199 s of `lockSourceReferences` statements, mostly lock waits.

| Layer                                      |   Calls | Share | DB time |
| ------------------------------------------ | ------: | ----: | ------: |
| Authority, catalog, definitions            | 912,364 | 27.4% |   690 s |
| Foreign-key trigger checks (no round trip) | 750,618 | 22.5% |    16 s |
| Workflow engine                            | 470,261 | 14.1% |   105 s |
| Advisory locks                             | 261,172 |  7.8% |    26 s |
| Account admission                          | 240,106 |  7.2% |    14 s |
| Mutation receipts                          | 205,222 |  6.2% |    37 s |
| Background and automation bookkeeping      | 187,334 |  5.6% |    25 s |
| Domain writes                              |  17,034 |  0.5% |     5 s |

Rows written in that database include 3,702 events, 3,815 entities and 1,449 relationships, against
67,235 mutation receipts and 59,638 child workflow starts.

CPU over the same run, from per-process deltas in `ps.log` (top 15 processes per sample, so 7,012 s of
about 11,100 s busy): API servers 44%, sandbox daemons 17%, vitest workers 15%, PostgreSQL 13%,
docker-proxy 4%. `vmstat`: 65% user, 22% system, 12.5% idle, 8.2 runnable, 32 k context switches/s.

## Runs `full12`, `full13` (whole suite with and without the cascade, `76a8cff917`)

`full12` is the baseline. `full13` is a throwaway patch on the same revision: the media hooks
`ensure-media-library-membership` (both), `record-media-library-membership-event`,
`library-summary-refresh` and `reconcile-history` and the fitness library membership hook are removed,
and the test timeout drops from 180 s to 60 s so tests waiting on those hooks fail sooner. Bootstrap
scripts stay. The patch was never committed.

| Measure                     |                  `full12` |                 `full13` |            Change |
| --------------------------- | ------------------------: | -----------------------: | ----------------: |
| Wall time                   |                   2,983 s |                  3,019 s |   none, see below |
| Passed / failed / skipped   |               944 / 7 / 8 |            833 / 118 / 8 | 111 newly failing |
| Summed test time            |                  10,790 s |                 11,036 s |                   |
| Machine CPU, `vmstat`       | about 10,500 s (88% busy) | about 8,300 s (68% busy) |              -21% |
| Statements, shared database |                 2,840,409 |                1,469,294 |              -48% |
| Database execution time     |                     895 s |                    402 s |              -55% |
| API server CPU, sampled     |                   2,981 s |                  2,158 s |              -28% |
| PostgreSQL CPU, sampled     |                   2,031 s |                    912 s |              -55% |
| Sandbox daemon CPU, sampled |                   1,096 s |                    300 s |              -73% |
| vitest CPU, sampled         |                     995 s |                  1,005 s |              none |
| Workflow executions         |                    43,012 |                   21,292 |              -50% |
| Automation runs             |                     4,701 |                    1,997 |              -58% |

Sampled CPU takes each process's last `ps` sample (top 15 per sample), so it covers 7,714 s and 5,113 s
of the machine totals. Execution and run counts come from a snapshot taken once a minute, so they can
miss the last minute.

**Wall time is not a result.** 87 tests wait out the 60 s timeout and 16 browser tests wait out 30 s, so
idle waiting replaces the removed work. Of the 111 new failures, 17 took 60 s or more in `full12` and
may be failing on the timeout rather than the missing hooks.

- **Tests passing in both runs:** 833 tests, 6,644 s to 4,905 s, or -26%. Part of that is lower load.
- **Files with no new failure:** 183 files, 5,342 s to 4,227 s, or -21%.

Projecting a suite where those effects cost nothing, at the observed 3.62 tests running in parallel:

- 38 min: every test that did not time out gets 26% faster and the 5 baseline timeouts stay.
- 26 min: the 111 tests take the mean of 5.9 s seen in `full13` and the 5 baseline timeouts pass.

### Server handler time by route

From `Sent HTTP response` lines of all servers, summing handler durations, which overlap across
workers. Long-lived `/entity-watches/ws` sockets are excluded.

| Category                          | `full12` requests |    `full12` |    `full13` |
| --------------------------------- | ----------------: | ----------: | ----------: |
| Writes and plugin operations      |             4,049 |     2,052 s |       618 s |
| RyotQL and other reads            |            32,083 |       902 s |       562 s |
| Plugin install and package change |               672 |       699 s |       608 s |
| Test-support seeding              |             2,474 |       638 s |       397 s |
| Auth                              |            13,357 |       462 s |       358 s |
| Static assets and page bundles    |            19,604 |        67 s |        49 s |
| **Total**                         |            72,239 | **4,820 s** | **2,592 s** |

| Route                                          | `full12` mean | `full13` mean |
| ---------------------------------------------- | ------------: | ------------: |
| `POST /events`                                 |      2,378 ms |        658 ms |
| `POST /entities`                               |        370 ms |         80 ms |
| `POST /relationships`                          |        834 ms |         61 ms |
| `POST /collections/memberships`                |      1,097 ms |        247 ms |
| `workout-editor-save`                          |      1,464 ms |        992 ms |
| `media-activity-log`                           |      4,160 ms |      1,147 ms |
| `POST /plugins`                                |      1,254 ms |      1,126 ms |
| `PUT /test-support/system-plugins/:id/package` |      3,674 ms |      3,036 ms |
| `POST /auth/sign-up*`                          |        152 ms |        130 ms |
| `POST /auth/sign-in*`                          |        130 ms |        107 ms |

- **Handlers explain 45% of baseline test time** (4,820 s of 10,790 s). The other 55% is outside
  handlers and unmeasured: client work, `pollUntil` waits at 500 ms, explicit sleeps, browser waits, and
  scheduling delay on a busy machine.
- **Reads are 19% of handler time**, about 28 ms per request under load. They are not the main cost.
- **Plugin installs are as costly as reads and barely depend on the cascade.** Removing the hooks
  moved them from 699 s to 608 s, on 672 requests.
- These means are under suite load, so they run higher than the unloaded flow probes.

### Baseline failures

Five of the seven `full12` failures also failed in `full11`, all at the 180 s timeout: four in
`history-correction-liveness` and one in `analytics-recipes`. The other two passed in `full11`
(`306769dee3`) and fail with identical assertions in `full12`, in `full13`, and in `recheck12`, a
two-file rerun on the idle VM. Both look like stale expectations after feature commits that arrived
with the rebase onto `main`, not effects of this work. Neither test has been changed or rerun against
an updated expectation.

- `fitness-exercise`, menu actions: expected 4 menu items, got 5. `d2769ea0d4` moved reminders into the
  overflow menu.
- `activity-log`, next-up and seasons: expected seasons `[0, 1, 2]`, got `[1]`. `7767dcc8e7` made the
  context select one seed season and page the rest.

## Run `local1` (workout saves through the real operation, laptop)

The VM is gone, so this ran on the owner's Mac, on one idle server. Compare these rows with each other,
not with VM figures. The run needed two temporary patches, not committed: `pg_stat_statements` in the
test PostgreSQL (`vm-e2e.sh` line 17, plus `create extension`), and a probe that tolerates a missing
`/proc`, so there is no CPU column.

The `workout-*-sets` flows seed through `createEntity` and `events.create`, which the client does not
use for saving, so earlier workout rows in this file do not describe a real save. These flows call
`workout-editor-save`, which commits with `commitUserChanges`. Medians of 3:

| Flow                   | Events |   Caller | Statements | Transactions | DB exec | Workflows |
| ---------------------- | -----: | -------: | ---------: | -----------: | ------: | --------: |
| 1 exercise, 5 sets     |      7 |   591 ms |      1,291 |          422 |  143 ms |        22 |
| 5 exercises, 25 sets   |     31 |   925 ms |      2,538 |          481 |  183 ms |        30 |
| 10 exercises, 150 sets |    161 | 3,125 ms |      9,601 |        1,166 |  467 ms |        59 |

- **The 150-set save:** 13 script executions, 16 host-call workflows, 11 automation runs, 10 relationship
  preparations and 4 policy batches.
- **Table writes per save, for 161 events:** about 340 `mutation_receipt`, 321 `event_scope`, about 170
  `event_stream_work`, 162 `event_stream`, and about 310 `event_projection`. Table counters flush late:
  the 930 projection writes all appear in the third run, so that figure is a third of the total.
- **About 57 statements per extra set.** The source commit is already one transaction, and no membership
  hook fires here, so the cost is the kernel's per-item work and records, which moves 3 and 4 address.

## Run `legacy1` (home page on a real library, laptop)

`tmp/file.sql` restored and migrated into disposable Postgres, Redis and S3 on the owner's Mac (Docker
limited to 2 GB and 2 CPUs), then queried through the API as that user with the recipes the home page
uses. One user with 28,619 library members: 27,334 music, 671 movies, 300 books, 109 audiobooks, 86
games, 73 shows; 179,979 events; 411 MB. PostgreSQL 18 with default settings, including `jit=on`.

| Home page, 11 queries at once            | `jit=on` | `jit=off` |
| ---------------------------------------- | -------: | --------: |
| Quiet                                    |    3.3 s |    0.65 s |
| Background load (4 busy loops on 2 CPUs) |    6.3 s |    1.35 s |

- **The two flat rails set the page time.** `flatByLifecycleStateRecipe` takes about 3 s, with
  2,384 ms execution with JIT and about 215 ms without. Without JIT the other queries take under 700 ms.
- **The rail reads stored summaries, but scales with the library.** It visits all 28,619 memberships and
  checks each one's note, work, plugin and installation rows: 465,941 buffer hits to return 2 rows.

Computing library summaries live, using the projection's own recipe:

| Input            |   Time |
| ---------------- | -----: |
| 20 shows         |  87 ms |
| All 73 shows     | 145 ms |
| 20 movies        |  19 ms |
| 100 movies       |  27 ms |
| 100 music titles |  14 ms |

So live state is cheap for one page or one subject. Filtering or sorting needs every row: at these rates
about 4 s or more for this library, by extrapolation, because the recipe rejects 1,000 IDs.

Crash, with memory limits set on the PostgreSQL container and background load:

| Limit  | `jit=on`                                                        | `jit=off`                           |
| ------ | --------------------------------------------------------------- | ----------------------------------- |
| 1 GB   | Survived, peak about 650 MB                                     | Survived                            |
| 400 MB | Backends and checkpointer OOM-killed, recovery, requests failed | Backend OOM-killed, requests failed |

The crash reproduces as memory exhaustion, and JIT is not its proven cause. Peak use on this library is
high enough that a busy 2 GB Docker VM could plausibly reach it. The API ran outside Docker, and queries
ran individually rather than in the page's combined sections.

The first run also got `discovery-resume-tests-ch`, another project's ClickHouse container on the same
Docker VM, OOM-killed: the limit on this PostgreSQL container did not protect the rest of the VM. That run's
13 s first page load is discarded because of that memory pressure.

## Run `full15` (clean baseline with a test timer)

Whole suite on the VM, one run, 51 min: 945 passed, 6 failed, 8 skipped. Every file recorded HTTP time and
sleep time, with overlapping spans merged. Test time adds up across workers: 11,043 s in 3,067 s of wall
clock.

| Share of test time                               |     |
| ------------------------------------------------ | --: |
| In an HTTP call                                  | 42% |
| Sleeping between polls                           | 41% |
| Both combined, without double counting           | 79% |
| Neither (browser work, test code, process start) | 21% |

- **Sleeps:** mostly fixed polling delays: 6,015 of 200 ms, 4,994 of 500 ms, 907 of 100 ms, 629 of 1 s and
  182 of 5 s. This is the time tests spend waiting for background work to settle. How much disappears depends
  on how much of that work moves into the write's transaction, which this run cannot say.
- **Slowest routes, by total time:** `POST /api/events` (348 calls, 887 s), `POST /api/ryotql/execute` (16,906
  calls, 774 s), `POST /api/test-support/entities/global` (1,212 calls, 456 s), `POST /api/plugins` (292 calls,
  360 s), `media-activity-log` (59 calls, 270 s).
- **Failures:** the 4 `history-correction-liveness` tests, which also failed in `full12`, plus
  `collection-detail` (30 s wait for a list item) and `entity-reminders` (`Malformed value` filling a
  `datetime-local` input). The last two were not investigated.

An earlier attempt, `full14`, is discarded: two copies of the suite ran at once into one results folder.

## Run `legacy2` (JIT on and off on a larger library, laptop)

`tmp/file2.sql` restored and migrated into disposable containers: 299 users, 230 of them disabled; 736,147
entities, 1,154,796 events, 3.8 GB; migration 457 s. Reads ran through the API as the enabled user with the
largest library: 14,708 titles, of which 10,098 are movies and 4,610 are shows, plus 65,107 events. Fitness
reads ran as the enabled user with the most workouts (113). PostgreSQL 18 limited to 1 GB, on a 2 GB, 2 CPU
Docker VM with nothing else busy.

195 reads ran one at a time, 3 times with `jit=on` and 3 times with `jit=off`, in the order off, on, on, off,
off, on. A read that hit the 30 s limit was not repeated in that mode. 187 of them finished at least once each
way. Medians, in ms:

| Read                                 |                 `jit=on` |               `jit=off` |
| ------------------------------------ | -----------------------: | ----------------------: |
| Backlog rail, shows                  |                   18,561 |                   3,281 |
| Backlog rail, other media            |                    3,257 |                     183 |
| Continue rail, other media           |                    3,606 |                     196 |
| All Shows, sorted by name            |                    5,529 |                     463 |
| All Shows, sorted by provider rating |                    6,131 |                     333 |
| All People, sorted by rating         |                    1,383 |                      76 |
| Analytics summary, all time          |                      998 |                     457 |
| Analytics trend, all time            |                      509 |                      98 |
| Fitness rank by targets              |                      165 |                     148 |
| Upcoming                             | 27,879 (1 of 2 finished) |                  26,748 |
| Show episode calendar                |                   25,396 |                  26,698 |
| All Shows, default and 6 other sorts |  Fails at the 30 s limit | Fails at the 30 s limit |

- **Regressions:** no read was clearly slower with JIT off. Where `jit=off` looks slower, either the read did
  not use JIT or the ranges overlap. The largest is the show episode calendar, at 15–27 s either way.
- **Most reads never reach JIT:** many ran with no JIT at all and differ only by noise. Background work is
  in the same counters, so "fired" counts are not exact per read. It also means something in the background
  repeatedly spends about 2 s in JIT, which was not traced.
- **Run-to-run variation:** `upcoming` took 5 s with JIT off in an earlier run and 20–28 s in this one, and the
  show calendar took 3.8 s against 15–27 s. Neither change is explained by JIT; `legacy3` points at background
  queries running alongside.
- **All Shows:** `timesCompleted`, `lastCompletedAt` and `userRating` are computed per row from events
  (`librarySummary`), so those sorts read every show's events. `legacy3` explains the rest.

The whole home page, 11 queries at once, 3 times each way, from PostgreSQL's own logs:

|                      | `jit=on`              | `jit=off`                                 |
| -------------------- | --------------------- | ----------------------------------------- |
| Backend OOM-killed   | 3 of 3 page loads     | 0 of 3                                    |
| Time                 | Failed, up to 180 s   | 30 s                                      |
| Rails failing        | 3–5 of 11             | `upcoming`, 2 of 3 loads                  |
| Slowest other rails  | Failed or timed out   | Continue shows 7–9 s, backlog shows 4–6 s |
| Peak memory, sampled | 1,024 MiB (the limit) | About 900 MiB                             |

- **One read alone:** the continue rail for shows also got a backend OOM-killed once with `jit=on`, with no
  other test query running. It was not run again in that mode, because the harness skipped reads after a long
  failure, so the table has no `jit=on` median for it. With JIT off it took 4.5–5.2 s.
- **Not covered:** writes, imports, projections and other background SQL, and the crash at a lower limit with
  this library. `legacy1` still shows a 400 MB limit crashes with JIT on or off.
- **Corrections to the harness:** its own `crashed` flag read `pg_postmaster_start_time`, which does not change
  on this kind of restart, so kills are taken from PostgreSQL's log. An earlier attempt in this run lost its
  login session after about 13 minutes, so only the last attempt's numbers are used.

## Run `legacy3` (query plans for the slow reads)

The same data and user as `legacy2`. The SQL was captured from PostgreSQL's log with JIT off, then run with
`EXPLAIN (ANALYZE, BUFFERS)` with the server stopped and no time limit. Instrumentation and cache state inflate
the times, and identical buffer counts took 37–143 s, so the loop counts are the reliable part.

| Read                                 | Rows returned |   Time | Buffers |     Episode visits |
| ------------------------------------ | ------------: | -----: | ------: | -----------------: |
| All Shows, default                   |            21 |  113 s |  37.8 M |            607,521 |
| All Shows, sorted by date added      |            21 |  143 s |  37.7 M |            607,521 |
| All Shows, sorted by times completed |            21 | 37.5 s |  37.7 M |            607,521 |
| All Shows, sorted by name            |            21 | 0.47 s |  0.18 M |              2,708 |
| Continue rail, shows                 |            21 |  3.4 s |   7.2 M |                    |
| Continue rail, other media           |             1 | 0.19 s |  0.42 M |                    |
| Upcoming                             |             4 |  4.5 s |   3.6 M | 644,137 dates cast |
| Show episode calendar                |            32 |  4.1 s |   2.4 M |            441,130 |

- **All Shows computes display fields before it pages.** The per-show aggregates run for all 9,208 shows in the
  catalog, about 66 episodes each. Only then does a semi-join keep the user's 4,610, and a top-N sort keep 21. The
  name sort selects the same fields and computes them for the page, which is why it is about 300 times cheaper.
- **Flat rails pay per membership.** The continue rail for other media does 29,460 projection and 29,460 installation
  lookups, plus two user lookups for each of 14,708 memberships, to return 1 row.
- **Upcoming and the calendar read the whole episode catalog,** casting a date out of JSON for each row, because no
  index starts from the date.
- **Background load matters.** The captured API run took 25.6 s for `upcoming` while about 70 scans of an airing
  schedule ran alongside it, against 4.5 s here. The show calendar took 4.5 s with 16 statements alongside it. The
  query looks like a signal schedule, but its source and frequency were not traced.
- **Memory settings:** PostgreSQL ran with defaults, `shared_buffers=128MB` and `work_mem=4MB`.

## Runs `a2`–`a6` (library check after steps 1 and 2, laptop)

`tmp/file2.sql` at a 1 GB Postgres limit, with the user holding 14,708 titles. `a2` and `a3` shared the CPU with
another project's test; `a4`–`a6` had the machine to themselves. Times in ms, median of 3 rounds.

**The date a check runs on matters.** The dump's last event is 2026-07-15, and the catalog lists 38 show episodes
for November 2026 against about 2,700 for October 2025. `a4` ran on today's date, so its week held 10 episodes and
its `upcoming` and calendar figures flatter the code. `library-check.sh` now takes `LIBRARY_CHECK_TODAY`, which `a5`
and `a6` use. SQL `current_date` still reads the real clock, so stored-state rules see today.

| Read                 | `p0` unchanged, JIT off, contended | `a3` steps 1, 2 and index, contended | `a4` sparse week |        `a5` dump date |        `a6` busy week |
| -------------------- | ---------------------------------: | -----------------------------------: | ---------------: | --------------------: | --------------------: |
| `upcoming`           |                      fails at 30 s |                               21,281 |            4,487 |     **fails at 30 s** |     **fails at 30 s** |
| Show calendar        |                      fails at 30 s |                                7,567 |            3,169 |                 3,295 |                 3,262 |
| `continue-show`      |                             19,058 |                                3,431 |            1,230 |                 1,063 |                 1,005 |
| All Shows, default   |                      fails at 30 s |                                2,330 |              819 |                   791 |                   780 |
| All Movies, default  |                              2,467 |                                2,321 |              452 |                   417 |                   396 |
| `backlog-show`       |                              5,443 |                                1,110 |              220 |                   222 |                   212 |
| `continue-flat`      |                                228 |                                  183 |              136 |                   135 |                   138 |
| Reads that failed    |          20, across both JIT modes |                                    2 |                0 |                     1 |                     1 |
| Whole page           |          killed 3 of 3 with JIT on |                              27–31 s |        4.6–4.8 s | fails at 30 s, 3 of 3 | fails at 30 s, 3 of 3 |
| Backends killed      |                 3 of 3 with JIT on |                                    0 |                0 |                     0 |                     0 |
| Peak Postgres memory |                                    |                              984 MiB |          746 MiB |               870 MiB |               826 MiB |

- Every saved-view sort is under 1 s on all three dates, including `timesCompleted`, `lastCompletedAt` and
  `userRating`, which are still computed from events. Storing them is no longer needed for the read targets.
- The composite relationship index took `backlog-show` from 6.7 s to 0.31 s and the All Shows page selection from
  4.66 s to 0.52 s when replayed alone.
- `upcoming` is the only read failing, and it alone fails the page. With it gone, the slowest read in a page is
  `continue-show` at 1.5–2.0 s.

### Prototype: an indexed date on the real SQL

An expression index on `(entity_schema_slug, publish date)`, with the captured SQL rewritten to read it. A stored
column would be read the same way. Removed from the database afterwards.

| Read and window                               |  Today's code |                                       Index | Index, date-first join order |
| --------------------------------------------- | ------------: | ------------------------------------------: | ---------------------------: |
| `upcoming`, 10 episodes in the catalog's week |         4,291 |                                          45 |                              |
| `upcoming`, dump date                         | fails at 30 s |                                       3,097 |                              |
| `upcoming`, busy week                         |  over 120,000 | over 120,000 and 208,621, on two busy weeks |                              |
| Show calendar, sparse month                   |         3,273 |                                         2.5 |                              |
| Show calendar, dump month                     |         3,295 |                                           8 |                            6 |
| Show calendar, busy month                     |         3,360 |                                       3,500 |                          120 |

- **`upcoming` in a busy week:** the page is chosen in 0.5 s. The 208 s is one display field, the per-title `total`:
  the hoisted date window is rescanned for each relationship row, 51,481 times over about 700 rows, and the episode
  state check runs on each of those 36 M rows. So an index alone does not fix it, and hoisting makes it worse.
- **Show calendar in a busy month:** Postgres estimates 54 library titles for the 14,708 real ones, so it starts
  from the library and visits 441,130 episodes even with the index. Forcing the written order, date first, gives 120 ms.

### `streaming-memory.test.ts`

The kernel suite on the VM (`kernel2`) passed 3,019 of 3,020. The failure was this backup test, at 558,608,384 bytes
against a 536,870,912 limit. It does not reach the changed RyotQL code, and the index is in Postgres, not the
measured process. Alone on the VM, alternating: code from before the changes failed 3 of 12, current code 4 of 12,
with readings on both sides of the limit up to about 590 MB. It is flaky at this limit on both, so it is not caused
by these changes.

## Runs `a7`–`a9` (library check with indexed dates, laptop)

Uncontended, same dump and 1 GB limit. `a7` uses the dump's date, `a8` a busy week and `a9` today. Times in ms,
median of 3 rounds; a whole-page load runs its reads at once, so a read takes longer there.

| Read                      | Target | Before, `a5` / `a6` | `a7` dump date | `a8` busy week |  `a9` today |
| ------------------------- | -----: | ------------------: | -------------: | -------------: | ----------: |
| `upcoming`                |    500 |       fails at 30 s |            100 |            189 |          75 |
| Show calendar             |    500 |       3,295 / 3,262 |             30 |            178 |          22 |
| Releases calendar         |    500 |           172 / 196 |            314 |            343 |         355 |
| `continue-show`           |  1,000 |       1,063 / 1,005 |            188 |          1,077 |       1,180 |
| All Shows, default        |  1,000 |           791 / 780 |            268 |            827 |         866 |
| `continue-flat`           |    100 |           135 / 138 |            198 |            139 |         144 |
| Reads that failed, of 192 |      0 |               1 / 1 |              0 |              0 |           0 |
| Whole page                |  2,000 |       fails at 30 s |        731–833 |    1,435–1,707 | 1,440–1,972 |
| Backends killed           |      0 |               0 / 0 |              0 |              0 |           0 |
| Peak Postgres memory      |        |       870 / 826 MiB |        816 MiB |        824 MiB |     877 MiB |

- `upcoming` reads up to 100 episodes per source and counts `total` with a grouped aggregate, which stays exact for
  up to 1,000 titles. During a page load it takes 401–726 ms.
- **Unexplained:** `continue-show` and All Shows are about 5 times faster soon after `ANALYZE` (`a7`, and also an
  earlier run in the same order) than a few minutes later. The cause is not traced; a plan change is likely.
- `continue-show` slightly misses its 1 s target in two of three runs, and flat rails miss 100 ms. Both are unchanged
  by this work, and step 4 is the candidate for the flat rails.
- The backfill for the 664,155 dated rows ran inside plugin activation. The whole migration took 94 s, every dated
  row was filled, and no value disagreed with its property.

## Run `full17` (whole suite after Phase A)

Whole suite on the VM at `2fa7957766` with step 5, one run, 51 min: 938 passed, 13 failed, 9 skipped. Phase A was
not expected to shorten it, and it did not.

- **Caused by this work:** 1, `wildcards.test.ts`, which lists entity fields and now gains `occursAt`.
- **Known:** the 4 `history-correction-liveness` tests, which wait for step 10.
- **The other 8:** rerun on the 8 files, 3 times (`tri17-*`), and then alternated with code from before Phase A
  (`84502d32c0`) 3 times each (`ab17-*`):

| Test                                                |   `full17` | Current, 6 runs | Before Phase A, 3 runs |
| --------------------------------------------------- | ---------: | --------------: | ---------------------: |
| `saved-view-sorting`, lifecycle activity order      |     failed |               0 |                      0 |
| `analytics-recipes`, rankings beyond 100 entities   |  timed out |               0 |                      0 |
| `fitness-workout-editor`, competing historical edit |     failed |               2 |                      2 |
| `entity-reminders`                                  |     failed |               2 |                      1 |
| `fitness-workout-interactions`                      |     failed |               1 |                      0 |
| `god-mode-impersonation`                            | failed (2) |               1 |                      0 |
| `media-custom-entity`                               |     failed |               0 |                      0 |

The first two fail only beside the whole suite. The workout editor test fails on the old code as often as on the
new: a 30 s wait for the details dialog, with the test taking 40–49 s against 19–22 s when it passes. The
rest are single failures of browser waits spread across both versions, so they are treated as load.

The non-e2e tests (`bun turbo --filter='!@ryot-app/e2e' test`, `u17*`) needed `--concurrency=1` and the swap file:
without them `tsgolint` was killed for memory while linting the kernel backend. One run stalled for 10 minutes with
two files open that then passed alone 3 of 3 times in 3 s each. The last run passed every task except the known
backup memory test, at 537,583,616 bytes against its 536,870,912 limit: 3,023 of 3,024 kernel tests.

## Runs `probesB0` and `probesB1` (Phase B baseline, then bootstrap entities)

Flow probes on the VM. `probesB0` is `dc3b525d1d`, after Phase A; `probesB1` is `3e2d6b4f73`, with bootstrap
entities declared. Medians, net of idle background.

| Flow                         |   Caller | Statements | Transactions |  DB exec |  API CPU | Workflows | Scripts |
| ---------------------------- | -------: | ---------: | -----------: | -------: | -------: | --------: | ------: |
| Signup, `probesB0`           |   705 ms |        457 |          214 |   119 ms |   672 ms |         5 |       2 |
| Signup, `probesB1`           |   495 ms |        268 |           93 |    31 ms |   356 ms |         1 |       0 |
| Event, `backlog`             |   644 ms |      1,008 |          423 |   212 ms | 1,034 ms |        19 |       5 |
| Event, no hooks              |   199 ms |        148 |           82 |    64 ms |   112 ms |         2 |       0 |
| 50 events, no hooks          |   754 ms |      1,472 |           52 |   198 ms |   535 ms |         2 |       0 |
| Review operation             | 2,151 ms |      2,349 |          776 |   604 ms | 2,242 ms |        47 |      13 |
| Workout, 1 set               | 1,238 ms |        754 |          206 |   271 ms |   856 ms |        11 |       4 |
| Workout editor save, 10 × 15 | 5,500 ms |      9,599 |        1,074 | 1,323 ms | 4,783 ms |        58 |      13 |

Rows other than signup are `probesB0`; they are unchanged in `probesB1` within noise. Signup is the cost nearly
every e2e test pays at least once, so the 316 ms of API CPU saved per signup applies across the suite.

### Non-e2e test stalls

These were not stalls. Under Turbo, `bun --bun run vitest` writes to a pipe and holds the output until it exits, so
the watchdog in `vm-unit.sh` saw no output while the kernel tests were still running, and killed any run whose
kernel task outlasted its idle limit. A snapshot at one such kill showed live migrations and test-database drops,
no blocked queries, and Vitest workers seconds old; 1,846 lines arrived at the kill. Neither
`--log-order=stream` nor a pseudo-terminal for Turbo changed this. `vm-unit.sh` now applies the watchdog only to
file runs, where Vitest writes directly, and Turbo runs have only the wall cap.

## Run `probesB2` (membership rules)

Flow probes on the VM with membership rules declared. Medians, net of idle background, against `probesB0`. Hook runs
and script executions count the rows created by the flow.

| Flow                         |   Caller | Statements | Transactions | DB exec | Workflows | Hook runs | Scripts |
| ---------------------------- | -------: | ---------: | -----------: | ------: | --------: | --------: | ------: |
| Event, `backlog`, `probesB0` |   644 ms |      1,008 |          423 |  212 ms |        19 |         3 |       5 |
| Event, `backlog`, `probesB2` |   423 ms |        772 |          221 |  141 ms |        16 |         2 |       4 |
| Review operation, `probesB0` | 2,151 ms |      2,349 |          776 |  604 ms |        47 |         9 |      13 |
| Review operation, `probesB2` | 1,337 ms |      1,312 |          433 |  397 ms |        27 |         5 |       8 |

The `backlog` event no longer runs either membership hook or the nested event workflow the second one started; the
summary refresh and history reconciliation remain, for parts 3 and 4. Signup, no-hook events, reads and workouts are
unchanged within noise: a workout save creates no exercises, so the fitness rule does not apply to it.

## Run `probesB3` (projection inputs)

Flow probes on the VM with relationship projection inputs declared. Medians, net of idle background.

| Flow                | Run        |   Caller | Statements | Transactions | DB exec | Workflows | Hook runs | Scripts |
| ------------------- | ---------- | -------: | ---------: | -----------: | ------: | --------: | --------: | ------: |
| Event, `backlog`    | `probesB0` |   644 ms |      1,008 |          423 |  212 ms |        19 |         3 |       5 |
|                     | `probesB2` |   423 ms |        772 |          221 |  141 ms |        16 |         2 |       4 |
|                     | `probesB3` |   451 ms |        662 |          159 |  125 ms |        13 |         1 |       3 |
| Review operation    | `probesB0` | 2,151 ms |      2,349 |          776 |  604 ms |        47 |         9 |      13 |
|                     | `probesB2` | 1,337 ms |      1,312 |          433 |  397 ms |        27 |         5 |       8 |
|                     | `probesB3` | 1,279 ms |      1,224 |          332 |  365 ms |        24 |         4 |       7 |
| 50 events, no hooks | `probesB2` |   689 ms |      1,515 |           16 |  146 ms |         2 |         0 |       0 |
|                     | `probesB3` |   738 ms |      1,561 |           56 |  169 ms |         2 |         0 |       0 |

The `backlog` event's remaining hook is `media.reconcile-history`, which step 10 replaces. Each plugin event now
reads its plugin's projection input declarations, about one statement per event in the 50-event batch; step 8's
in-process revision cache is where that read goes. Caller times moved within noise.

## Run `full18` (whole suite after step 7)

Whole suite on the VM at `134f5cc25f`, one run, 45 min against `full17`'s 51: 944 passed, 7 failed, 9 skipped.

- **Caused by this work:** 1, `media-reviews`, rating-only review. It failed 3 of 3 reruns (`tri18-*`): the
  membership rule wrote `add-to-media-library` only for memberships the kernel derived, while the removed hook
  wrote it for every new `in-media-library` relationship, including the test's direct create. Fixed: any new
  relationship of a rule's schema from a member records the event.
- **Known:** the 4 `history-correction-liveness` tests (step 10) and the workout editor's competing historical
  edit, which also fails on the code from before Phase A.
- **Load:** `client-plugin`'s interstitial passed 3 of 3 reruns.

## Run `probesB4` (direct small HTTP creates)

Flow probes on the VM with step 8's first move: an HTTP create of up to 50 events that matches no policy runs in one
transaction without a workflow. Medians against `probesB3`.

| Flow                | Run        | Caller | Statements | DB exec | API CPU | Workflows |
| ------------------- | ---------- | -----: | ---------: | ------: | ------: | --------: |
| Event, no hooks     | `probesB3` | 184 ms |        137 |   36 ms |  150 ms |         2 |
|                     | `probesB4` | 121 ms |         95 |   18 ms |  100 ms |         0 |
| 50 events, no hooks | `probesB3` | 738 ms |      1,561 |  169 ms |  570 ms |         2 |
|                     | `probesB4` | 649 ms |      1,614 |  127 ms |  510 ms |         0 |
| Event, `backlog`    | `probesB3` | 451 ms |        662 |  125 ms |  590 ms |        13 |
|                     | `probesB4` | 385 ms |        582 |  108 ms |  500 ms |        11 |

The 50-event batch keeps its per-item cost, about 32 statements an item, which move 5 targets. Workouts and the
review operation create events through sandbox operations, not this path, and are unchanged within noise.

## Run `probesB6` (direct policies for HTTP event creates)

Flow probes on the VM with step 9's first move. The probes gained `event-create-complete`, a `complete` event, which
Media's consumption policy matches. `probesB5` ran before the routes received the direct-policy events service and
is discarded. Medians against `probesB4`; the `complete` row's first line is a focused run before the wiring fix, when
every such create still took `EventCreateWorkflow`.

| Flow                         | Run        |   Caller | Statements |  DB exec |  API CPU | Workflows |
| ---------------------------- | ---------- | -------: | ---------: | -------: | -------: | --------: |
| Event, `complete`            | before     | 1,109 ms |      1,375 |        — |        — |        26 |
|                              | `probesB6` |   790 ms |      1,178 |   255 ms |   860 ms |        21 |
| Workout, one set             | `probesB4` | 1,289 ms |        815 |   259 ms |   785 ms |        11 |
|                              | `probesB6` |   988 ms |        598 |   218 ms |   610 ms |         5 |
| Review operation             | `probesB4` | 1,226 ms |      1,223 |   320 ms |   950 ms |        24 |
|                              | `probesB6` | 1,276 ms |      1,224 |   362 ms | 1,030 ms |        24 |
| Workout editor save, 10 × 15 | `probesB4` | 5,914 ms |      9,920 | 1,467 ms | 4,000 ms |        59 |
|                              | `probesB6` | 5,874 ms |      9,937 | 1,380 ms | 3,960 ms |        59 |

The `complete` create no longer starts `EventCreateWorkflow` and runs its policy without a run or script workflow;
the policy and run workflows left in that flow come from the consumption hook's own writes. Reviews and the
workout editor save write through scripts, which keep the workflow path until move 2.

The first runs with the path active failed 1 to 3 of 77 tests under load and hung one: the inline host defers a
batch when its lane cannot reserve it, and the direct run reported that as a failure, after which the fallback
found the policy failed or still claimed. Deferred runs now release their claim and hand the policy to the
workflow; the 13 policy e2e files then passed 3 runs of 3.

## Run `probesB8` (direct policies for every caller)

Flow probes on the VM with step 9's first move widened from HTTP event creates to every policy, including those
script writes start. `probesB7` ran while migrations and the runtime shared one memoized lifecycle instance whose
direct attempts were never available, and is discarded. Medians against `probesB6`.

| Flow                         | Run        |   Caller | Statements |  DB exec |  API CPU | Workflows | Automation runs | Script executions |
| ---------------------------- | ---------- | -------: | ---------: | -------: | -------: | --------: | --------------: | ----------------: |
| Workout editor save, 10 × 15 | `probesB6` | 5,874 ms |      9,937 | 1,380 ms | 3,960 ms |        59 |              11 |                13 |
|                              | `probesB8` | 5,211 ms |      9,642 | 1,411 ms | 3,540 ms |        51 |               7 |                 9 |
| Review operation             | `probesB6` | 1,276 ms |      1,224 |   362 ms | 1,030 ms |        24 |               4 |                 7 |
|                              | `probesB8` | 1,133 ms |      1,185 |   371 ms |   870 ms |        22 |               3 |                 6 |
| Event, `complete`            | `probesB6` |   790 ms |      1,178 |   255 ms |   860 ms |        21 |               2 |                 8 |
|                              | `probesB8` |   749 ms |      1,174 |   264 ms |   880 ms |        21 |               2 |                 8 |

The workout save's four policies now run without a run or script workflow; its 7 remaining runs are after hooks.

## Run `probesB10` (set-based event persistence)

Flow probes on the VM with event persistence set-based within a chunk: one insert, snapshot read and asset lock
for the chunk's creates, and one planning pass for its changes. Medians against `probesB8`.

| Flow                         | Run         |   Caller | Statements |  DB exec |  API CPU | Workflows |
| ---------------------------- | ----------- | -------: | ---------: | -------: | -------: | --------: |
| 50 events, no hooks          | `probesB8`  |   743 ms |      1,616 |   201 ms |   450 ms |         0 |
|                              | `probesB10` |   194 ms |        488 |    61 ms |   170 ms |         0 |
| Workout editor save, 10 × 15 | `probesB8`  | 5,211 ms |      9,642 | 1,411 ms | 3,540 ms |        51 |
|                              | `probesB10` | 2,899 ms |      4,354 |   811 ms | 2,620 ms |        51 |
| Event, `complete`            | `probesB8`  |   749 ms |      1,174 |   264 ms |   880 ms |        21 |
|                              | `probesB10` |   731 ms |      1,149 |   242 ms |   840 ms |        21 |

One `workout-1-set` run overlapped the frequent cron and an integration sync (894 statements); the other measured
571, against about 600 before. Single-event flows are unchanged.

## Run `full19` (whole suite after step 8's set-based batches and direct policies)

Whole suite on the VM at `815599d624`, one run, 43 min against `full18`'s 45: 945 passed, 6 failed, 9 skipped.

- **History correction (step 10):** the 4 `history-correction-liveness` tests and `analytics-recipes`' rankings
  beyond 100 entities, all at the 180 s timeout. The rankings test waits for history correction after 101
  `complete` events, so it fails for the same reason as the liveness tests.
- **`fitness-workout-editor`**, starting workouts from the list while guarding another draft: the workout details
  dialog did not appear within 30 s.

## Run `probesH1` (history correction fan-out)

A new probe, `media-progress-fanout-20`, completes 20 movies with one 20-event `progressPercent: 100` create, the
shape of the 60-subject liveness test. It returned in 2.5 s and settled 24 s later: 37,320 statements, 20.7 s of API
CPU and 39.4 s of machine CPU, about 1,870 statements and 1.2 s per movie.

| Per 20 movies                                                                      | Count |
| ---------------------------------------------------------------------------------- | ----: |
| Correction jobs (`user-script`)                                                    |    20 |
| `UserCommandWorkflow`, each with an entity preparation and a `PolicyBatchWorkflow` |    80 |
| Host-call workflows                                                                |   100 |
| Script executions                                                                  |    81 |
| After-hook runs (`reconcile-history`, `consumption`, `jellyfin-push`)              |    62 |

A movie's correction commits four times, one user command per step: the restart step commits only its
checkpoint, the progress phase creates the completion occurrence, the next step writes the `complete` output keyed
by that occurrence's ID, and a last step prunes, clears and commits the finished checkpoint.

The liveness file alone (`liv20`) passed in 331 s, the 60-subject test in 99 s. Its busiest statement was the
entity reference lock, 50 s of 135 s of statement time over 6,254 calls, at 8 ms each against 0.6 ms for the
unlocked fan-out read: correction commits still queue on the user's library row, for roughly 45 s of the run.
