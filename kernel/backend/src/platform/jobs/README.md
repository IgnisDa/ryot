# Jobs

`JobQueue` (`queue.ts`) and `JobWorkerLive` (`worker.ts`) run background work that needs no durable
replay: each job is one row in `job`, run to completion by one handler call, and deleted when it
succeeds.

## Queueing

A kind is declared with `makeJobKind`: a name, a payload schema, and its concurrency, attempts,
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
`FOR UPDATE SKIP LOCKED` in priority, `run_at`, ID order. One backend owns the database; the server
acquires `DatabaseOwner` before starting workers. Without notifications the worker rechecks when
the next delayed job falls due, and at least once a minute.

A claim sets the job `running` and increments `attempts`. Every settlement checks the claimed
attempt and status. Database settlement failures retry without running the handler again.

- Success deletes the row.
- Failure requeues the job after the kind's backoff, doubled per attempt and capped at one hour, until
  its last attempt fails; then the row stays `failed` with the error. The frequent cron deletes failed
  rows a week after their last attempt.
- Graceful interruption requeues the job without counting the attempt.
- At startup, work left `running` by a crash is requeued as a new attempt, or failed if its last
  attempt was exhausted. If a newer job is queued under the same key, it supersedes the interrupted
  job. There is no lease renewal or timer-based reclamation.

Handlers run at least once, so they must be idempotent by their own natural keys.
