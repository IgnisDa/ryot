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
