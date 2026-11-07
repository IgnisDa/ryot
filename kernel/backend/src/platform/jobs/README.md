# Jobs

`JobQueue` (`queue.ts`) and `JobWorkerLive` (`worker.ts`) run background work that needs no durable
replay: each job is one row in `job`, run to completion by one handler call, and deleted when it
succeeds.

## Queueing

A kind is declared with `makeJobKind`: a name, a payload schema, and its concurrency, attempts, lease
and backoff. `JobQueue.enqueue` inserts the row through `DatabaseSession`, so it joins the caller's
transaction: the job exists exactly when the write that queued it commits. It also sends `pg_notify` on
`ryot_broadcast`, which PostgreSQL delivers at that commit.

A job may carry a key. At most one queued job exists per kind and key, so a second enqueue with the same
key returns `false` and changes nothing. A running job does not block a new queued one, because the
running one may have read its input before the change that queued the next.

## Running

Features register a handler per kind with `registerJobHandler`; the worker needs every handler layer
built before it starts. The worker listens on `ryot_broadcast` and checks, per kind, whether a job is due and
when the next one will be. It claims due jobs of each kind up to that kind's concurrency, with
`FOR UPDATE SKIP LOCKED` in priority, `run_at`, ID order, so any number of processes can share the
table. Without notifications it rechecks when the next delayed job or lease falls due, and at least once
a minute.

A claim sets the job `running`, increments `attempts` and sets `locked_until` one lease ahead; the
handler renews it every third of a lease. Every settlement is fenced on the claimed attempt, so a
process whose lease lapsed cannot settle a job another process reclaimed.

- Success deletes the row.
- Failure requeues the job after the kind's backoff, doubled per attempt and capped at one hour, until
  its last attempt fails; then the row stays `failed` with the error. The frequent cron deletes failed
  rows a week after their last attempt.
- Interruption, such as shutdown, expires the lease without counting the attempt, so the job runs
  again at once elsewhere or on the next start.
- A lapsed lease is reclaimed as a new attempt. One that lapses on the last attempt is failed.

Handlers run at least once, so they must be idempotent by their own natural keys.
