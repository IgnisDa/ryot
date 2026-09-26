# E2E Load Sensitivity

Open design issues that make the E2E suite fail under concurrent load. Measurements come from an
8 vCPU / 16 GB Linux host running the suite with `maxWorkers=6` against the shared backend, and from
targeted experiments on the same host.

## Summary

PostgreSQL is not the bottleneck: during loaded batches it showed at most one active query and no
lock waits, and individual spans stayed in the low milliseconds. Failures come from two sources:
long serial chains of fast steps that no server timeout bounds, until they cross a test timeout or
Bun's idle timeout; and state shared across files (global entities, monitored entities, and the
growing user count). Increasing `maxWorkers` lengthens the chains and grows the shared state
faster.

## Reproducing

`setup.sh` provisions a fresh Ubuntu host reachable as `root@$SERVER_IP`: it installs Docker, Bun,
Deno, and Playwright's Chromium, checks out the local `ultra-rewrite` commit, and copies the local
`.env` files without their Colima socket settings. `repro.sh start <scenario>` runs one scenario
detached on the host, and `repro.sh result <scenario>` prints its summary; run one scenario at a
time. Scenarios that need probes apply `box/debug.patch` and copy the `box/debug-*.test.ts` files
into the E2E suite for the run, then remove them.

| Scenario            | Section                                                               |
| ------------------- | --------------------------------------------------------------------- |
| `serial-chains`     | Serial automation chains (alone; compare with `full`)                 |
| `workflow-timeouts` | Workflow-body timeouts                                                |
| `wall-clock`        | Wall-clock budgets                                                    |
| `composed-views`    | Shared global entities                                                |
| `idle-timeout`      | Server idle timeout (standalone `Bun.serve`)                          |
| `signup-deadlock`   | Sign-up transaction                                                   |
| `full`              | Serial chains, plugin materialization, idle timeout, media monitoring |

```bash
export SERVER_IP=203.0.113.10
docs/e2e-load-sensitivity/setup.sh
docs/e2e-load-sensitivity/repro.sh start composed-views
docs/e2e-load-sensitivity/repro.sh result composed-views
```

## Serial automation chains inside `POST /events`

Status: measured.

`runEventCreateWorkflow` (`kernel/backend/src/modules/events/event-create-workflow-live.ts`)
processes batch items one at a time. For each item it prepares, runs before-policies, writes, and
dispatches after-hooks; `required` after-hooks run inside the request
(`kernel/backend/src/modules/automations/execution.ts`, `after`). The HTTP response therefore waits
for every item's hook chain in sequence.

Evidence from one 20-item media progress request: 41 sandbox executions, 42 automation runs, and 22
nested `EventCreateWorkflow` runs, with sandbox concurrency 1 throughout and 23.8 seconds of wall
time. That is about 1.1 seconds per event on an otherwise idle backend.

Impact: `logging more than 100 anime episodes creates a completion event`
(`e2e/src/api/plugins/media/events/automations.test.ts`) took 138 seconds with one other file
running and 293 seconds of its 300-second budget with 22 files running. Other media lifecycle
suites follow the same path.

## Workflow-body timeouts do not bound waiting

Status: measured.

The required-hook deadline (`AUTOMATION_IMMEDIATE_TIMEOUT_MS`, 35 seconds, in `after` in
`kernel/backend/src/modules/automations/execution.ts`) and the sandbox queue timeout (1 minute in
`processSandboxExecutionQueue`, `kernel/backend/src/modules/sandbox/durable-queues.ts`) both wrap
waits inside workflow bodies. When a child workflow or a `DurableQueue.process` result is not ready,
the Effect workflow engine suspends the calling workflow instead of blocking it
(`WorkflowEngine.execute` and `DurableDeferred.await` call `Workflow.suspend`). The timeout fiber
ends with the suspension; on resume the body replays, computes a fresh deadline, and finds the child
already complete. Neither timeout therefore sees queue wait.

The HTTP caller of `EventCreateWorkflow` is not a workflow, so it polls a suspended execution with
the engine's default `suspendedRetrySchedule` (exponential from 200 milliseconds, capped at
30 seconds, unbounded). The request returns only after every required hook finishes, up to
30 seconds late.

With `SANDBOX_WORKER_CONCURRENCY=1`, six concurrent single-event requests whose required hook sleeps
20 seconds returned after 23, 52, 78, 108, 108, and 138 seconds, all with no warnings, and every run
succeeded on its first attempt without reconciliation. Queue wait under load therefore lengthens
requests without limit instead of producing `required-hook-pending` or a queue timeout, and the
frequent-cron fallback is not involved.

## Wall-clock budgets on CPU-bound work

Status: measured; no failures found.

The sandbox compiler budget (`SANDBOX_LIMITS.compiler.timeoutMs`, 5 seconds) is not on the E2E
path: fixtures compile plugin packages in the test process (`e2e/src/fixtures/kernel/compiled-package.ts`)
and the server ingests precompiled archives. With 0, 16, and 32 busy-loop processes on the 8 vCPU
host, `e2e/src/api/kernel/automations/lifecycle-triggers.test.ts` passed each time while its test
time grew from 45 to 60 to 83 seconds; no sandbox execution, replay, or HTTP timeout fired.

## Shared global entities leak into a fresh user's saved view

Status: measured and reproduced.

`retains the document and bridge across same-composition saved views`
(`e2e/src/browser/composed-views.test.ts`) asserts that no client asset is requested after its
snapshot. Its saved views list `book` entities (`rowsDataSources` in
`e2e/src/fixtures/kernel/saved-views.ts`), and global books created by other files through
`/api/test-support/entities/global` are visible to the fresh user. When a book row renders, the
document lazily loads the owning Media plugin's client artifact (`module.css` and `module.js`).
The load follows the saved view's `entityBrowser` query. Run alone, that query returns before the
test takes its snapshot, so the load lands inside the snapshot and the test passes. Under load the
query returns later, and the load lands after the snapshot.

Run alone with one seeded global book, a 1 second delay on the `entityBrowser` query, and a
1.5 second pause before the assertions, the test fails with the same two Media requests as the
loaded run. Without the seeded book it passes and never requests the Media artifact. A fix requires
either isolating the test from global entities or narrowing the assertion.

## System plugin changes materialize every user in the request

Status: measured.

`MaterializingPluginCatalogInvalidatorLive.all` (`kernel/backend/src/modules/plugins/layer.ts`)
re-materializes client page compositions for every bootstrapped user, one user at a time, and
`PluginIngestionService` awaits it inside the ingesting request. E2E creates fresh users throughout
the run, so each later system plugin install is slower than the last. In one full run,
`ingestSystemPluginUnlocked` took 0.17 seconds at the start and 100.8 seconds 20 minutes later,
with 560 bootstrapped users (about 180 milliseconds per user). Suites that install a system plugin
in a setup hook, such as `e2e/src/api/plugins/media/crons/media-trending-cron.test.ts`, then
exceed the 180-second hook timeout. The same cost applies to any deployment with many users.

## Requests beyond the server idle timeout are cut off after commit

Status: measured.

`kernel/backend/src/boot/server.ts` configures Bun with `idleTimeout: 60`. Bun 1.4.2 applies it to
pending requests that carry no body, such as `GET` and `DELETE`: a standalone `Bun.serve` with
`idleTimeout: 8` closed bodiless requests after 8 seconds with "The socket connection was closed
unexpectedly", while a `POST` with a JSON body completed after 20 seconds. The handler fiber is
interrupted wherever it is. Both plugin uninstall endpoints are `DELETE`. Late-run system plugin
uninstalls committed, then spent 57.8 to 59.5 seconds in the per-user materialization above; the
connection closed, the server logged status 499, and the interruption landed inside
`publishAfterCatalogMaterialization`
(`kernel/backend/src/modules/plugins/catalog-materialization.ts`). The remaining users were not
re-materialized and the catalog invalidation was not published.

On the client the request failed, so the fixture never marked the plugin inactive and its scope
finalizer uninstalled it again, receiving `PluginNotFoundError`. This produced the failures in
`e2e/src/api/kernel/plugins/integration-ownership.test.ts` and
`e2e/src/api/kernel/integrations/plugin-provider-redaction.test.ts`, and matches the
`PluginNotFoundError` failures in `imports.test.ts` and `integrations.test.ts` from other runs. Any
post-commit work that runs inside a request fiber is exposed to the same interruption.

## Sign-up holds a transaction while its hooks take more connections

Status: measured.

Better Auth runs email sign-up (user, account, and session creation) in one transaction. The
`session.create.before` and `user.create.after` database hooks
(`kernel/backend/src/modules/auth/service.ts`) run Effect programs against the root runtime, so the
session gate and user bootstrap acquire other pool connections while the sign-up transaction holds
its own, and they run outside that transaction. With `DATABASE_POOL_MAX=4` and 16 concurrent
sign-ups, every usable connection was held by a sign-up transaction `idle in transaction` after
inserting its `account` row. No sign-up completed; the 16 request spans ended after 240 seconds and
the transactions were still open after five minutes. With
the default pool of 100 the E2E suite does not reach this, but any burst of concurrent sign-ups
larger than the pool deadlocks.

## Global media-monitoring sweep grows across the run

Status: measured.

Media-monitoring suites (`e2e/src/api/plugins/media/media-monitoring/`) trigger the Media plugin's
single system `media-monitoring` cron through `/test-support/cron/plugin` and wait for their own
entity to refresh (`triggerCronAndWaitForEntity` in
`e2e/src/fixtures/plugins/media/media-monitoring.ts`, up to 3 attempts 5 seconds apart). Each sweep
refreshes every monitored entity in the shared database, including those left by earlier files, so
its cost grows with the run rather than with the calling test. In one full run the trigger took
1.6 seconds at the start and 25.9 seconds 24 minutes later; later media-monitoring tests then
reached the 180-second timeout. Fixing this requires scoping the test trigger or isolating the
monitored data.
