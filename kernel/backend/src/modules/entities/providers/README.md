# Provider entities

## Operation bindings

Generated provider scripts supply each `providerSlug`/`providerOperation` tuple. Ingestion persists
these in `definition_provider_operation` for the exact revision. Provider declarations contain only
descriptive metadata. Active dispatch selects the active revision's tuple; admitted population and
resolve work select the retained principal's revision and owner. Neither path falls back to another
revision or another provider when an operation is absent.

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
- An optional `entryEventSchemaSlug` must name an event schema of the provider's root entity schema,
  otherwise the request fails with `invalid-import-input`. It travels in the workflow payload, so a
  repeated request joins the existing job with that job's entry event.
- `DELETE /entity-providers/imports/:jobId` removes a queued row, or interrupts the workflow of a
  running one; the result then reads `cancelled`.
- The result endpoint reads `queued` from the ledger and `running`, `completed`, `failed`, or
  `cancelled` from the workflow. Queued and running results wait for a workflow notification or up
  to 20 seconds, then read the ledger and workflow again.

## Population

Provider details are fetched and validated before database work. Population writes are provider data,
not mutation requests: they plan no before-policies, so the provider's `details` script shapes them.
Population commits the root entity,
then its child-entity sets, then the base population timestamp in separate short transactions. It
publishes `populated` before starting related work. Lifecycle dispatch and live-update broadcasts happen
after the corresponding transactions commit.

### Population levels

A population payload carries a required `level`, passed to the `details` script as `level`.
A `full` run awaits all related groups, pages, and required sweeps before stamping
`entity.related_populated_at` in a final transaction. A `base` run persists the root entity and child-entity sets
only: it ignores any returned `relatedEntityGroups` (no relationship writes, no generation claims,
no sweeps, no related pages) and stamps `populated_at` alone, so existing relationships stay
untouched. Providers should skip related fetches at `base`; a provider that ignores `level` stays
valid. Child entities have no related level: every child-set write stamps `related_populated_at`
with the child's `populated_at` when it is still null.

`ensure` at `base` runs only while `populated_at` is null; `ensure` at `full` also runs while
`related_populated_at` is null, upgrading a base-populated entity. `refresh` always requests `full`.
An `ensure` run preserves an existing root `populated_at` during both the initial upsert and final
stamp. Persistence selects the stored non-null timestamp first in SQL (`coalesce`), even when an
overlapping base run stamped the entity after this run read it. The final stamp fills an unset base
timestamp and stamps the related level with the current command's timestamp. Mutation comparison
uses the preserved base timestamp, so a timestamp-only ensure does not emit an entity change.
Refresh preserves the base timestamp during its initial upsert and writes its new base timestamp
after its child sets succeed. Child sets keep their initial
(non-refresh) semantics during an upgrade.

`EntityImportWorkflow` (and so `kernel:entity-import`) requests `base`. After population and the
`provider-entity-import` completion hooks, an import with an entry event creates that event for the
importing user in the `entry-event` activity, keyed by a child item identity of the import command so
replays create it once. A failed or refused event fails the import at the `entry-event` stage; the
imported entity stays. `POST /entities/populate` requests `base` for background and `full` for
interactive entities (see the [entity interest README](../../../../../client/src/modules/entity-watches/README.md)). The kernel
provider-population reference and explicit enrichment commands request `full`; the monitoring sweep refreshes.
Relationship lifecycle hooks of an imported entity (such as plugin monitoring association
notifications) therefore run when the entity is first opened in the foreground or refreshed by a
monitoring sweep, not at import time.
Populate and explicit request IDs come from `entityPopulationExecutionId`, which hashes the
target, requesting account, level and submission identity into a bounded handle, so a repeated ask
joins the queued request instead of starting another. All callers share population admission; see
[entity enrichment](../enrichment/README.md). Automatic attempt IDs are described below.

### Paged related groups

Every related-entity group and related-page result declares `coverage`: `complete`, `more` with a
continuation, or `source-limited` with a reason. A group whose coverage is `more` is written in pages. The
first page is written after the base stamp like any other group; every written relationship is stamped
in `relationship.sync_generation` with the entity's current generation, the population execution ID
held in `entity.related_population_generation`. The population job pages each group itself under
the same plugin pin and user scope. Base imports do not start related work and return at the base
boundary. Every group shares the entity's generation, so a newer population supersedes older
paged work for the whole entity.

The job runs the provider's `related` script once per page, each in its own sandbox execution,
and writes each page in one transaction:

- A page upserts only its own entries and deletes nothing. Authoritative groups replace the
  properties of existing relationships; additive groups keep them. A relationship that is otherwise
  unchanged only has its stamp written, directly, with no lifecycle request or change evidence.
- The page index is part of the item and batch identity, so a retried attempt derives the same
  entity IDs. The sweep has its own identity.
- Every page write and the sweep lock the entity row and return an explicit superseded outcome unless
  the stored generation is still their own. A newer population therefore supersedes an older one
  without interleaved writes.
- After a page declares complete coverage, an authoritative group is swept: relationships whose stamp
  differs from the generation are deleted through the normal planned-reconciliation delete path
  (triggers, change evidence). Additive groups are never swept.
- A source-limited page fails with its reason before that page is written. A failed page, repeated
  continuation, or reaching the 200-page limit fails that group and skips its sweep. A
  superseded run also skips its sweep and cannot complete the related level. The job collects
  every group's outcome, so one failed group does not prevent successful sibling groups from
  finishing. Enqueue and page failures are not swallowed.
- Each committed related page and sweep publishes `enrichment-updated`, including partial results
  from a population that later fails. The final related stamp checks the generation again under the
  entity row lock before it publishes the related-level update.

A `details` result that declares more coverage for a provider with no `related` script fails the
population before anything is written.

### Requests and attempts

`EnrichmentRequests` records each population request with the payload every attempt uses, and one
`entity-population` job runs it, eight at a time per process. Each attempt gets its own sandbox
execution and mutation causation identity, `<requestId>-attempt-<number>`. The request is attached
to its root entity as soon as the root upsert commits, including when later stages fail.

The job records `running`, `retrying`, `succeeded`, or `failed` on the request. Only infrastructure
and timeout failures without a sandbox boundary code retry, at most three total attempts, five and
then ten seconds apart. Boundary-code failures, invalid output, unknown script failures, resource
limits, and external-uncertain outcomes do not retry. A successful population that asked for a
translation queues it.

Failures belong to request history, not entity columns. A related-stage failure leaves the committed
base timestamp and successful related pages intact, but does not stamp the related level complete.
The next attempt starts again from provider details under its own execution identity.

### Mutation lock order

Concurrent populations can contain the same related entities and relationships. Every entity
commit transaction, batch or single writer (`persistSave`), acquires locks in this order before it
mutates rows:

1. The schema catalog lock.
2. Domain write authority checks with `lock=true`, once per distinct writer, kernel-collection
   flag, definition owner, and scope.
3. Provider entity identities, sorted by scope, user, entity schema, provider, and external ID
   (`hashtextextended(key, 0)`).
4. User ensure scopes or global provenance scopes (`hashtext(key)`).
5. `entity-mutation:` keys of the known entity ids (`hashtextextended(key, 0)`).
6. Entity rows `FOR UPDATE`, ordered by id.

Population transactions then lock relationship identities, sorted by scope, user, relationship
schema provenance, source entity, and target entity, in one statement of the same shape, and
mutate entity rows before relationship rows.

Steps 3 to 5 are transaction-scoped PostgreSQL advisory locks. Each step is one statement: keys are
deduplicated, sorted in TypeScript by UTF-16 code unit, and locked through
`unnest(...) with ordinality ... order by ordinality`. The lock keys use JSON arrays so field
boundaries are unambiguous. Callers acquire all known locks before the first write; they must not
lock one entity and then discover another mutation target.

The locks are granular. Unrelated entity graphs continue concurrently, while transactions touching
the same provider entity or relationship serialize their conflicting mutations.

Repositories own lock sorting; provider callers submit children and deduplicated related entities in
provider order. Results and sibling lifecycle dispatch follow that order, with entity dispatch before
relationship dispatch. Item command identities do not depend on sibling positions. Child-related stamps stay in the child-set transaction, and nested child sets use the
same provider-order result positions as their input subtrees.

### Deadlock retry

PostgreSQL can still select a transaction as a deadlock victim when a new mutation path violates the
protocol. Population and relationship service transactions retry SQLSTATE `40P01` at most twice
after the initial attempt. The retry wraps the complete `database.transaction` effect, so rollback
finishes before a fresh transaction starts. SQL errors remain `DbError` values until retry is
complete and are converted to the durable `SandboxRunError` contract only afterward.

Do not retry individual statements and do not move sandbox, workflow, lifecycle, network, or
sleeping work into these transactions.
