# Provider entities

## Import admission

`POST /provider-entities/imports` does not start a workflow. It writes a `queued` row to
`provider_import_admission`, and a dispatch loop on every replica promotes rows to `running` while
fewer than `SANDBOX_IMPORT_CONCURRENCY` run across the installation. The next row goes to the user
with the fewest running imports, oldest request first, so a large batch never starves another
user's request. Only API submissions are admitted. Imports that sandbox scripts or bulk import jobs start are
awaited by work that is already running, so they bypass the ledger; waiting for a slot there could
deadlock once every slot holds a parent.

- A repeated request for a queued or running import returns the existing job. Once it finishes,
  the row is gone and the same request starts a new job.
- Each user may hold 50 queued or running imports. Further requests get a `429`
  `import-backlog-full` with `retryAfterSeconds`; nothing is queued in memory.
- Admission runs in one short transaction under an installation-wide advisory lock. The workflow
  starts after it commits, and no transaction spans a workflow, sandbox, or network wait.
- Each loop pass settles rows whose workflow has finished, restarts `running` rows whose workflow
  never started (a restart between admission and start), and admits into free slots. Every step is
  idempotent, so replicas and restarts need no coordination.
- `DELETE /provider-entities/imports/:jobId` removes a queued row, or interrupts the workflow of a
  running one; the result then reads `cancelled`.
- The result endpoint reads `queued` from the ledger and `running`, `completed`, `failed`, or
  `cancelled` from the workflow.

## Population

Provider details are fetched before database work. Population then commits the root entity, each
related-entity group, each child-entity set, and the final population timestamp in separate short
transactions. Lifecycle dispatch and Redis publication happen after those transactions commit.

### Mutation lock order

Concurrent populations can contain the same related entities and relationships. Every population
transaction must acquire locks in this order before it mutates rows:

1. Provider entity identities, sorted by scope, user, entity schema, provider, and external ID.
2. Relationship identities, sorted by scope, user, relationship schema provenance, source entity,
   and target entity.
3. Entity rows followed by relationship rows in the same identity order.

The repositories implement the first two steps with transaction-scoped PostgreSQL advisory locks.
The lock keys use JSON arrays so field boundaries are unambiguous. Callers acquire all known locks
before the first write; they must not lock one entity and then discover another mutation target.

The locks are granular. Unrelated entity graphs continue concurrently, while transactions touching
the same provider entity or relationship serialize their conflicting mutations.

### Deadlock retry

PostgreSQL can still select a transaction as a deadlock victim when a new mutation path violates the
protocol. Population and relationship service transactions retry SQLSTATE `40P01` at most twice
after the initial attempt. The retry wraps the complete `database.transaction` effect, so rollback
finishes before a fresh transaction starts. SQL errors remain `DbError` values until retry is
complete and are converted to the durable `SandboxRunError` contract only afterward.

Do not retry individual statements and do not move sandbox, workflow, lifecycle, Redis, network, or
sleeping work into these transactions.
