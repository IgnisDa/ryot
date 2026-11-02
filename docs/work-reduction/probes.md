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

| Flow | Caller | Settle | Statements | Transactions | DB exec | Server CPU |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Signup (incl. user bootstrap) | 1.3 s | ≤1.6 s | 915 | 100–650 | 165 ms | 1.1 s |
| Media movie fixture (admin seed + schema reads) | 0.6 s | 0–3 s | 265 | 80–480 | 70 ms | 0.4 s |
| Event create, media `backlog`, 1 item | 1.2 s | 1.6–4.6 s | 2,440 | 850–1,250 | 870 ms | 1.8 s |
| Media review operation (movie fixture + 1 rating) | 4.1 s | 0–1.6 s | 6,040 | 2,100–2,550 | 3.0–3.5 s | 4.3 s |
| Workout, 1 set (create workout + set events) | 1.8–2.0 s | 3.1 s | 1,715 | 600–1,000 | 300 ms | 1.2–1.4 s |
| Workout, 10 sets | 2.0 s | 3.1 s | 2,150 | 935 | 340 ms | 1.7 s |
| Workout, 25 sets | 2.2 s | 0 s | 2,850 | 620 | 380 ms | 1.7 s |

Idle background on that server: roughly 11 transactions/s and 70 ms/s of backend CPU with no
requests at all.

### Writes behind one `backlog` event create

| Table | Rows written |
| --- | ---: |
| `cluster_messages` | 479 |
| `cluster_replies` | 184 |
| `mutation_receipt` | 109 |
| `workflow_execution` | 50 |
| `sandbox_workflow_reference` | 18 |
| `background_work` | 14 |
| `automation_run` | 11 |
| `relationship_projection_work` | 5 |
| `event` | 3 |

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

| Flow | Workflows started (by name) | Sandbox runs |
| --- | --- | --- |
| Signup | `UserBootstrapWorkflow` 1, `ScriptExecutionWorkflow` 2, `SandboxDurableHostServiceWorkflow` 2 | 2 bootstrap scripts |
| Media movie fixture | `AutomationRunWorkflow` 1, `ScriptExecutionWorkflow` 1 (hook `custom-publish-year`) | 1 |
| Backlog event create, 1 item | 36: `ScriptExecution` 9, `SandboxDurableHostService` 6, `AutomationRun` 6, `PolicyBatch` 4, `BackgroundWork` 3, `UserCommand` 2, `UserEntityPreparation` 2, `EventCreate` 2 | 9 scripts; hooks `reconcile-history` ×2, `library-summary-refresh` ×2, `ensure-media-library-membership-on-events`, `record-media-library-membership-event`; background `user-script` ×2, `relationship-projection` |
| Review operation | 43, adding `review-created`, `notification`, `NotificationDeliveryWorkflow` | 13 |
| Workout (any set count) | 12: `ScriptExecution` 4, `AutomationRun` 3, `PolicyBatch`, `BackgroundWork`, `SandboxDurableHostService`, `EventCreate` | 4; hooks `workout-set`, `workout-exercise`, `workout-records`; background `event-projection` |

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

| Bucket | Busy CPU | Share |
| --- | ---: | ---: |
| Total busy (JS thread) | 50.5 s | 100% |
| Self time in the `effect` package (fiber run loop, context lookups, schema, cluster, workflow) | 21.1 s | 42% |
| Native (socket writes, JSON, Map, strings) | 18.0 s | 36% |
| Kernel backend code itself (`kernel/backend/src`) | 2.8 s | 6% |
| drizzle-orm + `@effect/sql-pg` | 4.4 s | 9% |
| ioredis | 0.8 s | 2% |

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

| Flow | Statements | Transactions | DB exec | Server CPU | Caller |
| --- | ---: | ---: | ---: | ---: | ---: |
| Signup | 920 → 568 | 256 → 227 | 161 → 135 ms | 1.00 → 0.81 s | 1.13 → 0.89 s |
| Media movie fixture | 267 → 155 | 169 → 109 | 71 → 70 ms | 0.28 → 0.25 s | 0.57 → 0.42 s |
| Event create, `backlog` | 2,434 → 1,310 | 912 → 459 | 983 → 247 ms | 1.75 → 1.27 s | 1.26 → 0.70 s |
| Review operation | 6,018 → 3,037 | 2,717 → 982 | 3.23 → 0.80 s | 4.34 → 2.92 s | 4.33 → 2.52 s |
| Workout, 1 set | 1,728 → 902 | 572 → 430 | 286 → 215 ms | 1.10 → 0.95 s | 1.59 → 1.21 s |
| Workout, 10 sets | 2,148 → 1,302 | 686 → 230 | 359 → 269 ms | 2.02 → 1.11 s | 1.94 → 1.50 s |
| Workout, 25 sets | 2,845 → 1,993 | 798 → 266 | 419 → 284 ms | 1.61 → 1.21 s | 2.25 → 1.52 s |

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

| Flow | Statements | Transactions | DB exec | Server CPU | Caller |
| --- | ---: | ---: | ---: | ---: | ---: |
| Signup | 564 → 473 | 218 → 261 | 144 → 123 ms | 0.84 → 0.77 s | 0.92 → 0.91 s |
| Event create, `backlog` | 1,307 → 1,066 | 362 → 337 | 231 → 218 ms | 1.17 → 1.14 s | 0.67 → 0.66 s |
| Review operation | 3,035 → 2,507 | 946 → 748 | 836 → 757 ms | 3.13 → 3.15 s | 2.69 → 2.54 s |
| Workout, 1 set | 900 → 764 | 332 → 203 | 190 → 188 ms | 0.91 → 0.91 s | 1.19 → 1.16 s |
| Workout, 25 sets | 1,993 → 1,760 | 365 → 363 | 312 → 335 ms | 1.51 → 1.44 s | 1.80 → 1.71 s |

- Statements fall by 12–18%, as predicted from the account-check share in `probes4`.
- CPU and caller latency do not move. Statement count is no longer what drives the server's cost.

### What one event create still does (`probes5`)

| Unit | Count |
| --- | ---: |
| Workflow executions | 18 |
| Workflow steps | 64 |
| Script executions | 5 |
| Sandbox runs (replays) | 9 |
| Deferred host requests (each ends a run) | 4 |

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

  | Area | Share |
  | --- | ---: |
  | Schema | 19% |
  | Logging | 12% |
  | Sandbox host | 11.5% |
  | Workflow engine | 10% |
  | Redis | 8.5% |
  | SQL | 8% |

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

    | Flow | Before | After |
    | --- | ---: | ---: |
    | Event create | 1.04 s | 0.83 s |
    | Review operation | 2.44 s | 1.93 s |
    | Workout, 25 sets | 1.52 s | 1.18 s |
    | Signup | 0.86 s | 0.72 s |

- **PostgreSQL socket writes took 11% of API CPU, scaling with bytes rather than statements.**
  Parsing JSON from rows took another 4.8%.

`bytes2` measures what one event create writes into the workflow tables: about 790 KB of JSON.

| Rows | Bytes |
| --- | ---: |
| `pin-sandbox-workflow-script` results (5) | 169 KB |
| `SandboxDurableHostServiceWorkflow` payloads (3) | 142 KB |
| Background work `start` results (2) | 101 KB |
| `prepare-projection` result | 67 KB |
| `ScriptExecutionWorkflow` payloads (5) | 73 KB |
| Sandbox queue results (9) | 56 KB |
| `PolicyBatchWorkflow` payloads (2) | 40 KB |
| `UserCommandWorkflow` payload | 36 KB |
| `UserEntityPreparationWorkflow` payload | 36 KB |
| `changeUserRelationships` input | 35 KB |

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

| Flow | Bytes | API CPU | DB exec | Caller |
| --- | ---: | ---: | ---: | ---: |
| Event create, `backlog` | 790 → 205 KB | 0.83 → 0.79 s | 232 → 184 ms | 0.66 → 0.60 s |
| Review operation | → 500 KB | 1.93 → 1.52 s | 790 → 615 ms | 2.40 → 2.04 s |
| Workout, 1 set | → 116 KB | 0.76 → 0.68 s | 198 → 250 ms | 1.16 → 1.14 s |
| Workout, 25 sets | → 605 KB | 1.18 → 1.06 s | 309 → 370 ms | 1.60 → 1.59 s |

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

| Flow | Sandbox runs | Net server CPU | Statements | Bytes | Caller |
| --- | ---: | ---: | ---: | ---: | ---: |
| Signup | 4 → 2 | 736 → 622 / 629 ms | 473 → 453 / 457 | 19 → 16 KB | 905 → 682 / 691 ms |
| Event create, `backlog` | 9 → 6 | 1072 → 805 / 783 ms | 1061 → 1046 / 1051 | 209 → 193 KB | 599 → 528 / 527 ms |
| Review operation | 25 → 19 | 2395 → 2257 / 2013 ms | 2505 → 2435 / 2437 | 512 → 561 / 520 KB | 2044 → 2027 / 1971 ms |
| Workout, 1 set | 5 → 4 | 778 → 740 / 772 ms | 763 → 750 / 754 | 119 → 105 KB | 1140 → 1066 / 1214 ms |
| Workout, 10 sets | 5 → 4 | 893 → 1071 / 993 ms | 1128 → 1121 / 1119 | 305 → 192 KB | 1368 → 1388 / 1568 ms |
| Workout, 25 sets | 5 → 4 | 1197 → 1378 / 1188 ms | 1760 → 1760 / 1757 | 619 → 341 KB | 1588 → 1879 / 1707 ms |

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

| Flow | Caller | Statements | Server CPU |
| --- | --- | --- | --- |
| Signup | 1.32 → 0.69 → 0.71 s | 917 → 463 → 453 | 1.32 → 0.78 → 0.71 s |
| Media movie fixture | 0.63 → 0.50 → 0.50 s | 265 → 159 → 160 | 0.71 → 0.40 → 0.43 s |
| Event create, `backlog` | 1.21 → 0.53 → 0.56 s | 2,442 → 1,057 → 991 | 2.23 → 0.86 → 1.10 s |
| Review operation | 4.12 → 1.97 → 1.98 s | 6,042 → 2,441 → 2,361 | 4.73 → 2.20 → 2.25 s |
| Workout, 1 set | 1.91 → 1.21 → 1.17 s | 1,719 → 758 → 754 | 1.69 → 0.90 → 0.87 s |
| Workout, 10 sets | 2.03 → 1.57 → 1.46 s | 2,157 → 1,127 → 1,126 | 2.12 → 1.17 → 1.25 s |
| Workout, 25 sets | 2.24 → 1.71 → 1.76 s | 2,851 → 1,765 → 1,754 | 1.94 → 1.37 → 1.33 s |

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

| Flow | Caller | Statements | Transactions | DB exec | API CPU | Workflows | Steps | Scripts |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Event, no hooks | 179 ms | 148 | 62 | 51 ms | 130 ms | 2 | 7 | 0 |
| 50 events, no hooks | 673 ms | 1,475 | 66 | 197 ms | 480 ms | 2 | 7 | 0 |
| Event, `backlog` | 610 ms | 1,006 | 311 | 183 ms | 740 ms | 22.8 | 75.4 | 5.8 |
| Signup | 704 ms | 452 | 176 | 120 ms | 610 ms | 5 | 9 | 2 |

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

| Layer | Calls | Share | DB time |
| --- | ---: | ---: | ---: |
| Authority, catalog, definitions | 912,364 | 27.4% | 690 s |
| Foreign-key trigger checks (no round trip) | 750,618 | 22.5% | 16 s |
| Workflow engine | 470,261 | 14.1% | 105 s |
| Advisory locks | 261,172 | 7.8% | 26 s |
| Account admission | 240,106 | 7.2% | 14 s |
| Mutation receipts | 205,222 | 6.2% | 37 s |
| Background and automation bookkeeping | 187,334 | 5.6% | 25 s |
| Domain writes | 17,034 | 0.5% | 5 s |

Rows written in that database include 3,702 events, 3,815 entities and 1,449 relationships, against
67,235 mutation receipts and 59,638 child workflow starts.

CPU over the same run, from per-process deltas in `ps.log` (top 15 processes per sample, so 7,012 s of
about 11,100 s busy): API servers 44%, sandbox daemons 17%, vitest workers 15%, PostgreSQL 13%,
docker-proxy 4%. `vmstat`: 65% user, 22% system, 12.5% idle, 8.2 runnable, 32 k context switches/s.
