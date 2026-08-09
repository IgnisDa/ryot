# Provider import admission and resource containment

## Status

**Complete.** User-requested provider imports now pass through a durable, installation-wide
admission ledger bounded by `SANDBOX_IMPORT_CONCURRENCY` (default 2), fair across users. Sandbox
and compiler workers are the kernel's preferred out-of-memory victims, and the documented
deployments give the Ryot container a 2 GB memory limit.

- Another user's single import behind a 20-import batch finished in 218–228 s instead of
  1,120–1,226 s (−81%), at a cost of 10–15% on the batch's own last completion (1,326–1,378 s
  against 1,150–1,257 s).
- With an 1,800 MiB container limit and memory exhaustion forced, the kernel killed the backend
  when workers were not preferred, and killed one sandbox worker when they were. In the second
  case the backend stayed up with no failed health checks and the other execution completed.
- The interactive sandbox lane and a lower worker CPU priority were measured and dropped.

Images, all `ghcr.io/ignisda/ryot`:

- Experiment image (every arm below): `pr-1832@sha256:efd6f21bb43fbbc2bcae93a86dda4a6d0e2099fa5e6fea93365dd9f67043579d`.
  It carried temporary `EXPERIMENT_*` switches for the admission limit (0 disables it), the lane,
  and the worker priority.
- Final image: `pr-1832@sha256:5767928fb672954dfa7ed693b855681de9fe1e712ca992edac1a0906866f10f6`,
  commit `f68208a504`. The switches are gone; admission is always on.

The raw rows, reduced to the fields below with no user, job, or external identifiers, are in
[`summary.json`](./summary.json).

## Execution path before this change

1. `POST /provider-entities/imports` resolved the provider and started the `EntityImportWorkflow`
   immediately (`WorkflowEngine.execute`, discarded). Nothing bounded how many ran.
2. Each import runs the provider's sandbox scripts through the durable `SandboxExecutionQueue`.
   A standard benchmark import is 110 sandbox executions.
3. The queue worker on each replica runs at most `SANDBOX_WORKER_CONCURRENCY` (2) Deno workers.
   That was the only bound, and it applies to executions, not imports, in arrival order.
4. Consequence: 20 imports submitted together interleave their 2,200 executions, so every one of
   them, and any import submitted afterwards by anyone, finishes near the end of the batch.
   Searches and plugin operations queue behind the same workers.
5. Nothing bounded memory. The container had no limit, and all workers and the backend shared
   the kernel's default OOM scoring, which favours the largest process: the backend.

Sandbox-started and bulk-job imports go through the same workflow but are awaited by work that
already holds a worker; they are deliberately outside admission (see the
[module README](../../../../kernel/backend/src/modules/provider-entities/README.md#import-admission)).

## Setup

- Host: the dedicated benchmark VM, 2 vCPU / 4 GB, with PostgreSQL and Redis on the same host.
  `SANDBOX_WORKER_CONCURRENCY=2`, dispatchers disabled.
- Every arm starts from a recreated database, flushed Redis, and fresh users and plugins.
- Probes run inside the application container against `127.0.0.1`, so latency excludes the
  public route. Health is probed every second, search every 10 s.
- Workloads:
  - **single**: 1 standard import (2 repetitions).
  - **mixed**: 20 standard imports from one user; 30 s later, 1 import from another user.
  - **slow**: 1 slow import, then 5 fast imports 2 s later, all from one user.
- Arms ran on 2026-09-24 between 09:57 and 19:11 IST; `-r2` is a second run of the same arm.

| Arm          | Admission limit | Interactive lane | Low worker priority |
| ------------ | --------------- | ---------------- | ------------------- |
| base         | off             | no               | no                  |
| a1 / a2 / a4 | 1 / 2 / 4       | no               | no                  |
| lane         | off             | yes              | no                  |
| prio         | off             | no               | yes                 |

## Results

### Many imports and another user's import (mixed)

Two runs per arm. "Other user" is the latency of the other user's single import from its submit.

| Arm  | Other user (s) | Batch first (s) | Batch last (s) | Health p95 / max (ms) | Search p95 (s) | PostgreSQL CPU (s) |
| ---- | -------------- | --------------- | -------------- | --------------------- | -------------- | ------------------ |
| base | 1,120 / 1,226  | 1,129 / 1,239   | 1,150 / 1,257  | 145–167 / 1,812–2,255 | 16.6 / 29.2    | 481 / 519          |
| a1   | 2,088 / 2,210  | 102 / 107       | 2,119 / 2,241  | 34–41 / 512–566       | 3.8 / 4.2      | 731 / 769          |
| a2   | 218 / 228      | 126 / 128       | 1,326 / 1,378  | 71–77 / 1,226–1,304   | 10.2 / 7.5     | 567 / 600          |
| a4   | 422 / 435      | 227 / 236       | 1,240 / 1,281  | 118–150 / 977–1,235   | 16.5 / 15.3    | 534 / 553          |
| lane | 1,190 / 1,259  | 1,201 / 1,269   | 1,220 / 1,289  | 174–186 / 2,854–3,431 | 3.9 / 4.5      | 504 / 528          |
| prio | 1,180 / 1,258  | 1,199 / 1,276   | 1,211 / 1,289  | 60–67 / 1,220–3,928   | 23.4 / 36.1    | 484 / 519          |

- Without admission every import, including the other user's, finishes within the last 30 s.
- a2 gives the other user roughly one import's duration plus one queue turn.
- a1 on this image starved the other user: when a slot freed, the ledger's fairness key counted
  the finishing import as no longer running, so the batch's user tied the other user and won on
  age. Fixed in the final image by counting imports settled in the same pass (see below).
- a4 halves the other user's benefit and loses most of the search improvement.
- Admission costs PostgreSQL CPU: +16–18% at a2 from the dispatch loop and ledger polling.
- The lane helped search but not the other user; worker priority improved health p95 but made
  search worse.

### Slow import alongside fast imports (slow)

| Arm  | Slow import (s) | Last fast import (s) | Peak container memory (MiB) |
| ---- | --------------- | -------------------- | --------------------------- |
| base | 50 / 49         | 278 / 334            | 1,489 / 1,964               |
| a1   | 46 / 36         | 546 / 562            | 1,296 / 1,334               |
| a2   | 36 / 36         | 343 / 353            | 1,407 / 1,415               |
| a4   | 44 / 42         | 323 / 329            | 1,353 / 1,419               |

With admission the slow import finishes sooner and the fast ones later: a2 holds one of its two
slots for the slow import instead of spreading all six across both workers. That is the accepted
cost of bounding a single user.

### Single import, memory, CPU, duplicates

- single: 98–112 s in every arm and repetition, 110 sandbox executions, peak container memory
  938–1,030 MiB, Ryot CPU 89–104 s. Admission adds no measurable latency to an idle system.
- Peak container memory stayed at or below 1,489 MiB in every run except one base slow run
  (1,964 MiB).
- No run had a failed import, failed replay, or OOM event. Sandbox executions per completed
  import match across arms (single 110, slow 94–95, mixed 113–121 including searches), so no
  import ran twice.

## Lifecycle validation (a2, experiment image)

| Check       | Expectation                                                              | Result                                                    |
| ----------- | ------------------------------------------------------------------------ | --------------------------------------------------------- |
| duplicate   | 6 concurrent requests for one import return one job                      | 1 job, completed                                          |
| cancel      | Cancel a queued and a running import out of 3                            | both `cancelled`; the third completed                     |
| backlog     | The 51st queued import is refused; another user is unaffected            | 50 accepted, 51st `429 import-backlog-full`, retry 30 s; neighbour and a later import completed |
| worker-kill | Kill every Deno worker mid-import                                        | 2 killed; both imports completed; next import completed   |
| restart     | Restart the container with 2 running and 4 queued imports                | all 6 completed; a repeat request then got a new job      |

Nested work under a full limit is covered by design: only API submissions are admitted, so an
import started by running sandbox work never waits for a slot.

## Out-of-memory victim

The container got an 1,800 MiB limit with no swap. Two executions of a script that touches
750 MiB of array buffers (outside the V8 heap limit) ran together for 8 s.

| Workers preferred as victims | Killed                     | Backend restarted | Health failures | Executions               |
| ---------------------------- | -------------------------- | ----------------- | --------------- | ------------------------ |
| no                           | the backend (Bun, PID 1)   | yes               | —               | lost with the container  |
| yes (`oom_score_adj` 1000)   | one sandbox worker         | no                | 0 of 12         | 1 completed, 1 failed    |

The first attempt, holding 400 MiB for 30 s, never reached the limit: the 30 s sandbox execution
timeout ended the executions first. The failed execution is not retried; its import fails and the
user may retry it.

## Decision

- `SANDBOX_IMPORT_CONCURRENCY=2`, equal to the worker concurrency on the reference host, with
  fairness by fewest running imports per user and a 50-import per-user backlog.
- Workers always get `oom_score_adj` 1000 on Linux; the server warns at boot when its cgroup has
  no memory limit and logs each worker that exits before responding.
- Documented deployments: compose `mem_limit`/`memswap_limit` 2g; Helm requests 500m CPU / 1Gi,
  limit 2Gi memory, no CPU limit; Fly `shared` 2 vCPU / 2 GB. 2 GB covers every measured peak
  (1,964 MiB worst) and leaves 2 GB for PostgreSQL, Redis, the OS, and page cache.
- Dropped: the interactive lane, worker CPU priority, and CPU limits.

## Final image validation

Pending.
