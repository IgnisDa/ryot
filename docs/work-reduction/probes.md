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
