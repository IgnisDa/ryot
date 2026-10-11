# Provider entities

## Import admission

`POST /entity-providers/imports` does not start a workflow. It writes a `queued` row to
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
- `DELETE /entity-providers/imports/:jobId` removes a queued row, or interrupts the workflow of a
  running one; the result then reads `cancelled`.
- The result endpoint reads `queued` from the ledger and `running`, `completed`, `failed`, or
  `cancelled` from the workflow. Queued and running results wait for a workflow notification or up
  to 20 seconds, then read the ledger and workflow again.

## Population

Provider details are fetched before database work. Population then commits the root entity, each
related-entity group, each child-entity set, and the final population timestamp in separate short
transactions. Lifecycle dispatch and Redis publication happen after those transactions commit.

### Paged related groups

A related-entity group whose `details` result carries a `continuation` is written in pages. The
first page is written in the root population like any other group; the group's current generation
(the population execution ID) is claimed first in `relationship_sync_generation`, and every written
relationship is stamped with it in `relationship.sync_generation`. Once the root is stamped and
"populated" is published, `ProviderRelatedPagesWorkflow` (execution ID
`related-<entityId>-<groupIndex>-<generation>`) is started without being awaited, under the same
plugin pin and user scope. Import and refresh callers return when the root population finishes.

The workflow runs the provider's `related` script once per page, each in its own sandbox execution,
and writes each page in one transaction:

- A page upserts only its own entries and deletes nothing. Authoritative groups replace the
  properties of existing relationships; additive groups keep them. A relationship that is otherwise
  unchanged only has its stamp written, directly, with no lifecycle request or change evidence.
- The page index is part of the item, batch and activity identity, so replay after a crash reuses
  committed receipts. The sweep has its own identity.
- Every page write and the sweep take a transaction advisory lock on the group key and stop, with a
  log entry, unless the stored generation is still their own. A newer population of the same group
  therefore supersedes an older one without interleaved writes.
- After the last page, an authoritative group is swept: relationships of the group whose stamp
  differs from the generation are deleted through the normal planned-reconciliation delete path
  (triggers, policies, receipts, change evidence). Additive groups are never swept.
- A failed page, a superseded run, or reaching the 200-page limit skips the sweep and logs; the
  workflow still succeeds, and the next population restarts the group from the `details` result.
  "Populated" is published again when the workflow finishes.

A `details` result that returns a continuation for a provider with no `related` script fails the
population before anything is written.

### Mutation lock order

Concurrent populations can contain the same related entities and relationships. Every entity
commit transaction, batch or single writer (`persistSave`), acquires locks in this order before it
mutates rows:

1. The schema catalog lock.
2. Domain write authority checks with `lock=true`, once per distinct writer, kernel-collection
   flag, definition owner, and scope.
3. Mutation receipt locks, `hashtext('mutation-receipt:' || id)`.
4. Provider entity identities, sorted by scope, user, entity schema, provider, and external ID
   (`hashtextextended(key, 0)`).
5. User ensure scopes or global provenance scopes (`hashtext(key)`).
6. `entity-mutation:` keys of the known entity ids (`hashtextextended(key, 0)`).
7. Entity rows `FOR UPDATE`, ordered by id.

Population transactions then lock relationship identities, sorted by scope, user, relationship
schema provenance, source entity, and target entity, in one statement of the same shape, and
mutate entity rows before relationship rows.

Steps 3 to 6 are transaction-scoped PostgreSQL advisory locks. Each step is one statement: keys are
deduplicated, sorted in TypeScript by UTF-16 code unit, and locked through
`unnest(...) with ordinality ... order by ordinality`. The lock keys use JSON arrays so field
boundaries are unambiguous. Callers acquire all known locks before the first write; they must not
lock one entity and then discover another mutation target.

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
