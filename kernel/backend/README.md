# Kernel Backend

The backend kernel implements domain-independent services. Plugins supply domain schemas, source
normalization, provider scripts, and lifecycle behavior; `apps/server` assembles the runtime.

## Persistence And Transactions

Routes decode requests and call services. Services own access control, business rules, and transaction
boundaries; repositories own row normalization and persistence through their captured
`DatabaseSession`. Its `session.run` selects the active executor and maps native database failures.
Shared writes join the caller's transaction without passing raw executors between services. Owners
that require a top-level transaction reject an already active one.

Runtime writes from imports, jobs, sandbox callbacks, bootstrap, and HTTP use the same owning
services. Historical backup restore instead uses the
[backup-owned persistence path](src/modules/backups/README.md). Schema-backed entity,
event, and relationship properties are validated before persistence. Account preferences use the
canonical user-row schema and atomic validated patches; Better Auth sessions neither own nor expose
those preferences.

Persisted `definition_*` tables and their global/user views define precedence and effectiveness.
`DefinitionRepository` is the common reader; event and relationship readers add ownership-scoped
projections. Definitions contain stable plugin identity and local slugs, not user/domain records.
Signal definitions select formatters while kernel formatters remain kernel-owned. Revision rows are
immutable, enforced by a startup-installed database trigger.

## Durable Execution

Feature Layers compose dependencies; boot composes features. Upward effects use generic durable
queue hooks or transaction-scoped ports rather than reverse module dependencies. The common
[background-work owner](src/modules/background-work/README.md) admits pinned user scripts and event
projection batches in their owning transaction, dispatches after commit, and recovers admitted work.
`LifecyclePlanner` persists source-write planning, immutable triggers, recipients, and pinned runs in
the caller's transaction. It executes neither sandbox code nor workflows; execution starts after
commit. Provider population composes the import workflow, and external event creation runs
before-stage policies before committing pinned after hooks.

Background work that needs no replay is a row in the [job queue](src/platform/jobs/README.md),
queued in the transaction that causes it. The frequent cron is one such job and queues its own next
occurrence.

Activities and workflows use `makeActivity` and `implementWorkflow` from
`src/platform/workflow/scope.ts` and run on the kernel's
[PostgreSQL workflow engine](src/platform/workflow/README.md). Event creates run synchronously
through `EventsService.create`; durable callers run them inside an activity, where `LifecycleExecution`
runs policies and hooks as request work rather than journaling them.

Detailed behavior belongs to [automations](src/modules/automations/README.md),
[mutation admission](src/modules/mutations/README.md), [events and projections](src/modules/events/README.md),
[background work](src/modules/background-work/README.md),
[user commands](src/modules/user-commands/README.md), [imports](src/modules/imports/README.md),
[script execution](src/modules/scripts/README.md), and [sandbox isolation](../sandbox/README.md).

## Storage And Transport

Assets split upload intents in `modules/assets/uploads/`, permanent storage and managed records in
`modules/assets/storage/`, and file delivery in `modules/assets/routes.ts`. Temporary storage is
ephemeral local working space. Permanent uploads prefer fully configured S3 and otherwise use
persistent local storage. A completed permanent upload intent replays its result only for the
upload URL window.

Clients never delete managed assets. The frequent cron rechecks each asset's references 24 hours
after registration and every 24 hours after that, so in-flight work and open editors keep their
uploads. A check locks the row, so a concurrent writer either commits its reference first or sees the
retirement and is rejected. Unreferenced assets are retired, their object is deleted, and only then is
the row removed; a failed deletion is retried on the next run.

Unused provider entities are collected by the [graph retention](src/modules/entities/README.md#graph-retention)
rules. Mutation receipts and settled background work expire as described in
[mutation admission](src/modules/mutations/README.md#receipt-retention) and
[background work](src/modules/background-work/README.md).

Redis infrastructure owns backend keys, channels, codecs, and parsing; the sandbox owns its
`ryot:sandbox:*` recovery and quarantine keys. See the [entity-watch protocol](src/modules/entities/watches/README.md)
and [authentication/proxy rules](src/modules/accounts/auth/README.md) for those boundaries.

## Tests

`test.ts` provisions one PostgreSQL and one Redis for the run, reusing `TEST_DATABASE_URL`
and `TEST_REDIS_URL` when supplied. It runs four workers unless `--parallel=N` says otherwise.

PostgreSQL connections are bounded by construction. The launcher migrates one template database and
sizes a started container's `max_connections` from the worker count; a supplied server must already
have that capacity or the run fails before any test starts. Each test file connects as its own role,
created on first use from `#testing/database`, whose `CONNECTION LIMIT` is the per-file budget, so an
over-budget file fails with an error naming its role instead of starving other workers. The role owns
an empty file database (`testDatabaseUrl`, `databaseLayer`) and clones migrated databases from the
template (`isolatedDatabaseLayer`). Test pools release idle connections after one second. A worker
drops its previous file's role when it starts the next one, and the launcher drops everything left at
the end of the run. Unnamed `layer(...)((test) => ...)` blocks are all built before a suite's first
test and kept until it ends; give repeated per-test harnesses a name so each one owns its lifetime.

Database suites isolate schemas or databases and Redis suites namespace keys. Missing setup never
causes silent skips.

Use `assertExitFails` from `@ryot-app/testing/effect-assertions` for typed failures: structural
`Exit.fail` equality omits error messages. Admin-only e2e operations are described in
[`modules/test-support/README.md`](src/modules/test-support/README.md).
