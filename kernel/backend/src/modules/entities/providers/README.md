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
- `DELETE /entity-providers/imports/:jobId` removes a queued row, or interrupts the workflow of a
  running one; the result then reads `cancelled`.
- The result endpoint reads `queued` from the ledger and `running`, `completed`, `failed`, or
  `cancelled` from the workflow. Queued and running results wait for a workflow notification or up
  to 20 seconds, then read the ledger and workflow again.

## Population

Provider details are fetched before database work. Population then commits the root entity, each
related-entity group, each child-entity set, and the final population timestamp in separate short
transactions. Lifecycle dispatch and Redis publication happen after those transactions commit.

### Population levels

A population payload carries a required `level`, passed to the `details` script as `level`.
A `full` run persists everything above and stamps `entity.related_populated_at` together with
`populated_at`, in the same transaction. A `base` run persists the root entity and child-entity sets
only: it ignores any returned `relatedEntityGroups` (no relationship writes, no generation claims,
no sweeps, no related-pages workflow) and stamps `populated_at` alone, so existing relationships stay
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
Refresh and other entity updates write `populated_at` as given. Child sets keep their initial
(non-refresh) semantics during an upgrade.

`EntityImportWorkflow` (and so `kernel:entity-import`) requests `base`. Entity interest requests
`base` for visible and `full` for foreground interest (see the entity-interest README). The kernel
provider-population reference and the retry route request `full`; the monitoring sweep refreshes.
Relationship lifecycle hooks of an imported entity (such as plugin monitoring association
notifications) therefore run when the entity is first opened in the foreground or refreshed by a
monitoring sweep, not at import time.
Execution IDs come from one helper: `populate-<entityId>-<level>-<generation>`, an upgrade adds
`-<populatedAtMs>-<hourBucket>`, and a retry adds `-<attempt>`.

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

### Failed populations

A population of an entity row that exists and is not yet populated records a failure when the
provider's `details` run fails deterministically:

- a script error (`script-failure` without a boundary reason), stored as `script-failure`;
- a script error carrying the `operation-rejected` boundary code, stored as `script-failure` so a
  provider that ever raises it is still recorded rather than dropped;
- invalid output (`invalid-output` without a boundary reason, or a result that fails details
  validation), stored as `invalid-output`;
- a host-call budget overrun (`script-failure` or `resource-unavailable` with boundary code
  `execution-limit`), stored as `execution-limit`. A durable run carries the boundary reason of an
  escaped failure in the failed replay envelope's `data`, so it classifies as a non-durable run does.

The record is `entity.population_failed_at` and `entity.population_failure`, a closed code set
enforced by a check constraint; messages, stacks and boundary data are never stored. One short
transaction rechecks domain write authority (lock order step 2), takes the entity's
`entity-mutation:` lock (step 6) and updates the row only while `populated_at` is null, so a newer
successful population wins. If authority no longer holds, nothing is written. After commit the
workflow publishes `population-failed`, and `populationStatus` reads `failed`. The root stamp clears
both columns.

Every other failure writes nothing and leaves the entity `pending`, with entity interest reusing the
stored failed execution ID as before: timeouts, infrastructure and database errors,
`external-uncertain`, any other `resource-unavailable` failure, any failure with another boundary
code (such as `missing-artifact-grant` or `unavailable-operation`), authority, pin and
admission failures before execution, a missing `related` script, and root, relationship or child
write failures. A failed refresh of a populated entity writes nothing, and the related-pages workflow
never records failures.

A `full` `ensure` run of an entity that already exists records a related-level failure instead when
its `details` run returns invalid output (including a result that fails details validation) or
exceeds a host-call budget (`execution-limit`). Script failures without that boundary code, such as
an upstream rate limit, never mark the related level, because any user can request an upgrade of a
shared entity. The record is `entity.related_population_failed_at` and
`entity.related_population_failure` (same closed code set and check constraint, never exposed). The
write rechecks domain write authority, takes the `entity-mutation:` lock, and updates the row only
while `populated_at` is set, `related_populated_at` is null, and the row is provider-backed. After
commit the workflow publishes `populated`, and `relatedPopulationStatus` reads `failed`. Refresh and
base runs never mark the related level, and the related stamp clears both columns.

`POST /entities/:entityId/population/retry` with `{ pluginId }` retries a failed population or a
failed related level. It
answers the same `not-found` for missing and invisible entities, then refuses
`not-provider-backed`, `plugin-mismatch` (the plugin does not own the entity's schema) and
`provider-unavailable` (the caller cannot run the entity's provider), all before any write. The
clear runs in one transaction with the caller's account write lock, account admission and the
entity-mutation lock, and one conditional update clears the population failure and, while
`related_populated_at` is null, the related failure, returning both previous failure times. Without
a cleared failure it returns `{ retried: false }`. Otherwise it requests a `full` population with the
cleared failure time in epoch milliseconds as the attempt suffix,
`populate-<entityId>-full-<generation>-<attempt>`, so the workflow runs again instead of returning
the stored failure, and returns `{ retried: true }`. Each
recorded failure allows at most one retry run, and a new failure appears only after a full provider
run, so there is no retry interval.

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

Repositories own lock sorting; provider callers submit children and deduplicated related entities in
provider order. Results, receipt batch indexes, and sibling lifecycle dispatch follow that order,
with entity dispatch before relationship dispatch. Item command and receipt identities do not depend
on sibling positions. Replayed receipts retain their recorded dispatch; newly admitted batches use
provider order. Child-related stamps stay in the child-set transaction, and nested child sets use the
same provider-order result positions as their input subtrees.

### Deadlock retry

PostgreSQL can still select a transaction as a deadlock victim when a new mutation path violates the
protocol. Population and relationship service transactions retry SQLSTATE `40P01` at most twice
after the initial attempt. The retry wraps the complete `database.transaction` effect, so rollback
finishes before a fresh transaction starts. SQL errors remain `DbError` values until retry is
complete and are converted to the durable `SandboxRunError` contract only afterward.

Do not retry individual statements and do not move sandbox, workflow, lifecycle, Redis, network, or
sleeping work into these transactions.
