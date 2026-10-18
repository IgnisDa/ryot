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
projection steps in their owning transaction, dispatches after commit, and recovers admitted work.
`LifecyclePlanner` persists source-write planning, immutable triggers, recipients, and pinned runs in
the caller's transaction. It executes neither sandbox code nor workflows; execution starts after
commit. Provider population composes the import workflow, and external event creation runs
before-stage policies before committing pinned after hooks.

Activities and workflows use `makeActivity` and `implementWorkflow` from
`src/platform/workflow/scope.ts`. `LifecycleExecution.after` and `executePolicy` fail inside activity
bodies. Public and service-owned event creates await `EventCreateWorkflow`; callers selecting
`discard: true` poll its result.

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

`global-setup.ts` provisions one PostgreSQL and one Redis for the run, reusing `TEST_DATABASE_URL`
and `TEST_REDIS_URL` when supplied. Vitest provides the URLs as `databaseUrl` and `redisUrl`.
Suites read them through `testDatabaseUrl` and `testRedisUrl`; database suites isolate schemas or
databases and Redis suites namespace keys. Missing URLs never cause silent skips.

Use `assertExitFails` from `@ryot-app/testing/effect-assertions` for typed failures: structural
`Exit.fail` equality omits error messages. Admin-only e2e operations are described in
[`modules/test-support/README.md`](src/modules/test-support/README.md).
