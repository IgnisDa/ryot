# Inline durable sandbox host calls

## Status

**Complete.** Activity-strategy host calls are now settled inside the live sandbox process, not
by suspending the workflow and replaying the script in a new process. A direct script with N
durable loop iterations went from `2N + 1` processes to one. The representative hermetic
import went from 185 processes to 110 and from 147 to 93 seconds. In the matched comparison,
every request succeeded, no replay failed, no OOM event was recorded, and no worker was left
after drain. The import-produced business rows are identical.

- Baseline: `ec957072bd`, image
  `ghcr.io/ignisda/ryot@sha256:f309335fda12bab2fd349abfa50a251a1723e54454a45bd5bab99ee66239e067`.
- Candidate: `6f9785731f`, image
  `ghcr.io/ignisda/ryot@sha256:cb63c2b83460c707d78982c77b6d02f77a2dfea0bcb3b3fdc0f2a012bba4a45a`.
  The change is in commits `2e80e6c240` and `d7b17487a1`.

## Where the amplification came from

Each `SandboxScriptWorkflow` step calls `processSandboxExecutionQueue`
(`kernel/backend/src/modules/sandbox/sandbox-script-workflow.ts:238`). That call starts one
single-use Deno process and gives it the journal recorded so far. The runner's durable host
(`runner-source.sandbox.ts`, `createDurableHost`) behaves as follows:

- It answers recorded requests from the journal.
- On the first unrecorded request, it marks the replay pending and exits.
- The workflow dispatches the requests of that batch, journals their results, and suspends on
  the queue's deferred.
- It then re-executes its body, which starts the next process from the top of the script.

A script making K sequential durable calls therefore costs `K + 1` processes. It also costs
O(K²) work in journal observations and in the replayed activity and deferred rows the Effect
engine re-reads on every workflow resumption.

### Local breakdown (identical in the baseline and the historical figures)

Counts come from `cluster_messages` and the sandbox counters. Timings are not recorded here.
Full per-workflow and per-script data is in `local-breakdown.json`.

| Operation                     | Host calls | Processes | Replay starts | Cluster message rows |
| ----------------------------- | ---------: | --------: | ------------: | -------------------: |
| Direct, 0 iterations          |          0 |         1 |             2 |                    6 |
| Direct, 1 iteration (2 calls) |          2 |         3 |             9 |                   20 |
| Direct, 5 iterations          |         10 |        11 |            77 |                  156 |
| Direct, 10 iterations         |         20 |        21 |           252 |                  506 |
| Standard import, baseline     |          — |       185 |           779 |                2,977 |
| Standard import, candidate    |          — |       110 |           359 |                2,137 |

The direct workload loop issues one `getUserPreferences` and one `setCachedValue` per iteration.
Both are activity-strategy calls.

#### The import's 185 processes

The standard import starts 56 `SandboxScriptWorkflow` runs: the details script, 55 automation
runs, and their policy hooks. Each run needs one process for work that cannot be avoided. The
remaining 129 processes are replays after a suspension.

| Script                                             | Baseline processes | Candidate processes |
| -------------------------------------------------- | -----------------: | ------------------: |
| `automation.record-media-library-membership-event` |                 84 |                  42 |
| `automation.ensure-media-library-membership`       |                 66 |                  44 |
| `automation.media-notification`                    |                 20 |                  20 |
| `book.hermetic.details`                            |                 11 |                   1 |
| `automation.media-association`                     |                  3 |                   2 |
| `automation.media-entity-updated`                  |                  1 |                   1 |

The number of workflows of every other type is unchanged in both variants:

- 55 `AutomationRunWorkflow`
- 21 `EventCreateWorkflow`
- 10 `NotificationDeliveryWorkflow`
- 10 `SandboxDurableHostServiceWorkflow`
- 1 `EntityImportWorkflow`
- 1 `ProviderEntityPopulationWorkflow`

### Which boundaries durability requires

`SANDBOX_DURABLE_HOST_DISPATCH` (`modules/sandbox/durable-host-dispatcher.ts:63`) assigns every
capability a strategy.

**Activity calls** are local host reads and writes that are settled by one activity attempt. They
are:

- `httpCall`
- `executeRyotql`
- `getCachedValue` and `setCachedValue`
- `getPluginConfig` and `getSystemConfig`
- `getEntitySchemas` and `listEventSchemas`
- `listIntegrations` and `getCurrentIntegration`
- `getUserPreferences`
- `claimPersistentValue`

Durability needs their result recorded before the script may depend on it. It does not need the
process to die. Ending the replay at these calls was incidental. Replaying the next process
reproduced the same state the live process already held. It was one process per batch, plus the
growing replay cost described above.

**Workflow calls** remain real boundaries:

- `createEvents` (event workflow)
- `emitSignal` and `ensureUserEntities` (service workflow)
- `sendNotification` (notification workflow)
- `upsertGlobalEntities`, `changeUserRelationships` and `upsertGlobalRelationships` (lifecycle
  workflow)

These start child workflows. Lifecycle children can run policy hooks that need sandbox slots
themselves. Holding a worker slot while such a child waits could deadlock the two slots, so
those calls still suspend. They account for the import's 54 remaining replay processes
(110 = 56 + 54).

## The change

The runner, the process service, and the workflow share one protocol:

- **Runner** (`runner-source.sandbox.ts:655`).
  - When a request is not yet journaled, and every unrecorded request of the current batch is an
    activity capability in the payload's `inlineDurableCapabilities`, the runner writes one
    `{"inline":{"requests":[...]}}` line. It then blocks on a synchronous stdin read
    (`readLineSync`, `:414`).
  - The blocking read freezes every script fiber. The script therefore observes the same
    journal-ordered state as it would on a replay.
  - The `pendingObserved` guard (`:706`) ensures a deferred batch is never retried by a
    concurrent fiber.
  - One streaming UTF-8 decoder (`:58`) serves both the async and the sync readers. Without it, a
    multibyte character split across reads is corrupted.
- **Process service** (`lib/infrastructure/sandbox-runtime/service.ts:226`, `:549`–`:582`).
  - It validates that the batch indices extend `journalLength` plus the entries already settled.
  - It enforces the bridge request byte limit and the cumulative journal byte limit.
  - It dispatches the batch, or replies `{"defer":true}`.
  - The execution timeout is paused while settling, and the bridge session expiry is extended by
    the same duration (`runtime.ts:601`). Settling therefore neither consumes the script's
    wall-clock timeout budget nor expires its capability session.
  - Inline settlement is not offered to grant-carrying or profiled executions.
- **Dispatcher** (`lib/infrastructure/sandbox-runtime/durable-host-dispatcher.ts:850`).
  - It settles a batch inline only when every request is an activity capability.
  - An `httpCall` must also resolve to no rate-limit policy (`:860`). Rate-limited calls keep the
    durable wait path. An unresolvable URL also defers.
  - Any dispatch failure replies with a defer, and the ordinary replay path then retries the call.
  - The batch runs with the existing `concurrentHostCalls` bound. Each call goes through the same
    `dispatchSandboxHostActivity` as the activity strategy.
- **Queue and workflow** (`modules/sandbox/durable-queues.ts:117`,
  `modules/sandbox/sandbox-script-workflow.ts:254`–`:270`, `:641`–`:650`).
  - The queue's success type `SandboxReplayResult` carries the inline entries.
  - The workflow rejects inline entries unless the replay loaded exactly the journal it holds.
  - It validates the envelope against `journal ++ inline` and enforces the step limit including
    inline entries.
  - It then journals the entries in order before handling the envelope's own pending requests.

The earlier replay-ID regex fallback and the optional queue payload fields were removed rather
than kept for compatibility.

### Why correctness is preserved

- **Recording and replay.** Every inline result is journaled by the workflow, in index order,
  before anything else happens in that step.
  - If the process, worker, or host dies mid-settlement, the queue retries the replay from the
    last journal, like any other interrupted replay.
  - An inline effect whose result was never journaled is re-dispatched. This is the same
    at-least-once contract the activity strategy already documented. Idempotent capabilities stay
    idempotent: `claimPersistentValue` and cache writes carry deterministic keys.
- **Deterministic IDs.** Request indices and execution IDs are unchanged. Each inline call
  receives the same `executionId`/`startedAt` context as the activity strategy.
- **Ordering and outputs.** A batch is exactly the set a replay would have observed before
  suspending. Results are returned in request order. Tests cover concurrent batches, typed
  failures, defers, and multibyte payloads.
- **Cancellation, timeout, and recovery.** The process keeps its existing timeout and kill paths.
  Only settlement time is excluded from the timeout. An interrupted execution leaves nothing
  journaled from the unfinished batch.
- **Capability isolation.** Inline capabilities are the principal's declared capabilities
  filtered to the activity strategy. Grant-carrying executions are excluded. Dispatch uses the
  same principal checks.
- **Bounded worker occupancy.** A process stays alive only for local activity calls, never
  across child workflows or rate-limited HTTP waits. Worker concurrency stays at 2.
- **Transactions.** No transaction is held across sandbox execution, network waits, or workflow
  suspension. Each inline call opens and commits its own work, exactly as the activity would.

Focused tests:

- `runner-integration.test.ts`: inline continuation, concurrent batches, defers, and multibyte
  results.
- `durable-queues.test.ts`: capability selection.
- `sandbox-script-workflow.test.ts`: continuation validation and ordered journaling.

The focused end-to-end files also pass:

- `async-flow`, `cache`, `durable-tracer`, `global-provider-rate-limiting`, `sandbox`
- `provider-entities/search-import`
- `automations/lifecycle-triggers`

## Matched comparison

### Setup

- Single 2 vCPU host (amd64).
- Coolify project `ryot-benchmark`, redeployed per variant with a fresh database.
- Bun 1.4.0, Deno 2.8.1, worker concurrency 2, on-demand workers, info logging, scheduler
  dispatchers disabled, `NODE_ENV=production`.
- The in-container probe (`e2e/src/scripts/sandbox-amplification/remote-probe.mjs`) calls the
  local API.
- The host wrapper (`run-variant.sh`) adds PostgreSQL cgroup CPU and `xact_commit` counters
  around each scenario.
- Each repetition waits for a drained runtime: idle, with no new spawn for 3 s. Detached
  automation work is therefore included.

The scenario list was:

1. Warm-up: `direct:0` and one import, excluded from the results.
2. Five repetitions each of `direct:0/1/5/10`.
3. Three standard imports.
4. Two batches of five concurrent imports.

`summarize.mjs` produced `comparison.json` from `raw/`.

### Results

Medians are per logical operation. A batch is five imports.

| Scenario  | Variant   | Processes | Replay starts | Latency (ms) | Ryot CPU-s | Bun CPU-s | PostgreSQL CPU-s | PostgreSQL commits | Observed journal bytes |
| --------- | --------- | --------: | ------------: | -----------: | ---------: | --------: | ---------------: | -----------------: | ---------------------: |
| direct:0  | baseline  |         1 |             2 |          716 |       0.99 |      0.55 |             0.22 |                 52 |                      2 |
| direct:0  | candidate |         1 |             2 |          688 |       0.94 |      0.52 |             0.23 |                 69 |                      2 |
| direct:1  | baseline  |         3 |             9 |        1,863 |       2.09 |      0.86 |             0.37 |                130 |                    836 |
| direct:1  | candidate |         1 |             2 |          695 |       0.92 |      0.53 |             0.19 |                 59 |                    422 |
| direct:5  | baseline  |        11 |            77 |        6,398 |       6.70 |      2.14 |             0.95 |                594 |                 46,162 |
| direct:5  | candidate |         1 |             2 |          695 |       1.01 |      0.58 |             0.21 |                 59 |                  2,106 |
| direct:10 | baseline  |        21 |           252 |       12,812 |      13.31 |      4.67 |             1.93 |              1,535 |                323,817 |
| direct:10 | candidate |         1 |             2 |          834 |       1.07 |      0.62 |             0.22 |                 65 |                  4,221 |
| import    | baseline  |       185 |           779 |      147,215 |     143.33 |     48.73 |            31.86 |             11,465 |                678,338 |
| import    | candidate |       110 |           359 |       92,796 |      90.81 |     36.45 |            23.30 |              8,850 |                487,778 |
| batch:5   | baseline  |       925 |         3,898 |      360,242 |     556.31 |    146.29 |           105.49 |             56,504 |              3,397,595 |
| batch:5   | candidate |     550.5 |       1,800.5 |      245,142 |     371.35 |    116.11 |            86.24 |             43,312 |              2,468,902 |

For the direct scripts, the actual host calls are `2N` for N iterations: 0, 2, 10 and 20. The
candidate's `durableRequests` counter matches exactly (0/2/10/20). In the baseline the same
counter reads 0/5/65/230, because it counts the requests observed across every replay.

For one import, the candidate:

- removes 75 of 185 processes (41%), 420 of 779 replay starts (54%), and 37% of Ryot CPU-seconds;
- cuts latency by 37%;
- cuts PostgreSQL CPU by 27% and commits by 23%.

For the five-import batch, it:

- removes 41% of processes and 54% of replay starts;
- cuts Ryot CPU-seconds by 33% and latency by 32%;
- cuts PostgreSQL CPU by 18% and commits by 23%.

### Memory

| Scenario  | Worker peak RSS (MiB), baseline → candidate | Deno peak RSS (MiB) | Bun peak RSS (MiB) | Cgroup peak (MiB) |
| --------- | ------------------------------------------- | ------------------- | ------------------ | ----------------- |
| direct:10 | 123.8 → 125.4                               | 120.3 → 118.1       | 871.7 → 852.8      | 983.9 → 1,060.4   |
| import    | 130.3 → 130.9                               | 233.6 → 227.7       | 968.3 → 950.9      | 1,147.2 → 1,248.9 |
| batch:5   | 130.8 → 131.2                               | 254.0 → 254.0       | 1,060.6 → 1,071.5  | 1,293.8 → 1,399.2 |

Per-worker peak RSS is unchanged, within 2 MiB. A live process holds its heap while it waits
for local settlement. That heap was already allocated in the baseline, which rebuilt it in every
replay process.

The container cgroup peak is about 100 MiB higher in the candidate, including for `direct:0`,
whose code path is unchanged. Bun and Deno RSS peaks are flat. The difference therefore comes
from non-RSS cgroup memory, probably page cache from the freshly created database volume and
image layers. The change does not cause it. This setup does not isolate container memory.

### Correctness and cleanup

- **Failures.** 0 failed requests, 0 failed replays, 0 OOM events, and 0 workers left, in
  both variants.
- **Automation runs.**
  - Baseline: 771 runs, all succeeded, none retried.
  - Candidate: 770 runs, all succeeded, none retried.
  - The extra baseline run comes from the cache-hit import described in the limitations. It
    added one automation run and no entities.
- **Import-produced rows (identical).**
  - 14 fresh imports × 21 entities: 14 populated books, 140 related books and 140 persons.
  - 294 events and 574 relationships.
- **Entity totals.** 302 in the baseline and 296 in the candidate.
  - The six extra baseline entities are probably library entities (two per user) of three users
    created by setup attempts that failed after user creation. The candidate setup ran once.
  - The baseline database was recreated before this could be checked. Treat this explanation as
    probable, not verified.

### Counter semantics

- **Processes** is the delta of `totalSpawned` Deno processes.
- **Replay starts** counts body-loop iterations of sandbox workflows, including iterations re-run
  when a workflow resumes. It is not the number of processes.
- **Observed journal bytes** sums the journal bytes each replay observed. It is cumulative
  observation volume. It is neither the resident journal size nor storage traffic.
- **Ryot CPU-s** is the delta of the application container's cgroup `usage_usec`, minus the
  probe's own CPU.
- **Deno CPU** is roughly Ryot CPU minus Bun CPU.
- **PostgreSQL CPU and commits** are measured once per scenario invocation, then divided by its
  repetitions. Commits include background activity.

## Remaining costs

- **Child-workflow boundaries.** The workflow-strategy calls (`createEvents`,
  `changeUserRelationships`, `sendNotification`, `emitSignal`, and the other lifecycle upserts)
  still end a replay. They cause 54 of the import's 110 processes. Most of the remaining
  replay starts come from them and from the Effect engine re-running workflow bodies on
  resumption.
- **Replay after suspension is still O(K²)** in the number of workflow-strategy boundaries of
  one script. The heaviest remaining scripts:
  - `record-media-library-membership-event`: 42 processes for 21 runs, two each.
  - `ensure-media-library-membership`: 44 processes for 22 runs.
- **Rate-limited HTTP calls** still take the durable wait path. The hermetic workload has none.
  Provider imports against real rate-limited providers keep their suspension per limited call.

### Is further redesign warranted?

Not as a continuation of this change. The last incidental boundaries are gone. What remains
suspends for real reasons:

- a child workflow that can need the same sandbox slots;
- a rate-limit wait that must not hold a worker.

Removing those would mean either:

- keeping processes alive across child workflows, with slot accounting that prevents
  self-deadlock; or
- changing the scripts to batch their workflow calls, for example one `createEvents` per
  automation.

The second is a plugin-level optimization with smaller risk, and is the better next step if the
remaining import cost matters.

## Limitations

- **Single host, small repetitions.** One 2 vCPU host, with five direct repetitions, three
  imports and two batches per variant. The process, replay and row counts are deterministic.
  Timing and CPU medians carry run-to-run noise, visible in `raw/`.
- **Cache-hit import.**
  - In the baseline, the warm-up import and the first measured import shared a nonce. That
    measured repetition was a cache hit: 3 processes, 3.7 s.
  - It is excluded (`import#0`, together with its PostgreSQL counters). One extra fresh import
    was run afterwards with a per-invocation nonce, so the baseline import is also n = 3.
  - The candidate used the fixed probe throughout.
- **Image pull overlap.** A background image pull overlapped baseline batch repetition 0. Its CPU
  (560 vs 553 s in repetition 1) shows no material effect, so both repetitions are kept.
- **Probe placement.** The probe runs inside the application container. Its CPU is subtracted,
  but it shares the cgroup memory accounting and scheduling.
- **Observability.**
  - No memory watchdog or profiler was active, and traces were not collected.
  - Resetting the stack with `docker compose down -v` also removed the collector's
    `otel-output` volume.
- **Local breakdown platform.** The local breakdown ran on macOS arm64, and only its counts are
  used.
