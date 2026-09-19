# E2E Load Sensitivity

Open design issues that make the E2E suite fail under concurrent load. Each entry states whether it
was measured or inferred from code. Measurements come from an 8 vCPU / 16 GB Linux host running
batches of the suite with `maxWorkers=6` against the shared backend.

## Summary

PostgreSQL is not the bottleneck: during loaded batches it showed at most one active query and no
lock waits, and individual spans stayed in the low milliseconds. Failures come from long serial
chains of fast steps, and from fixed wall-clock budgets that a slowed chain crosses. Increasing
`maxWorkers` raises per-step latency, which each mechanism below multiplies or converts into a
failure.

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

## Required-hook deadline and the frequent-cron fallback

Status: inferred from code; not observed in a loaded run.

A `required` after-hook gets `AUTOMATION_IMMEDIATE_TIMEOUT_MS` (sandbox execution timeout plus
5 seconds, 35 seconds total) inside the request. On expiry the request returns a
`required-hook-pending` warning. `AutomationReconciliation` resubmits runs that remain queued, and
it runs only from the frequent cron, whose default interval is 5 minutes
(`kernel/backend/src/modules/scheduler/cron.ts`).

If an expired run remains queued rather than continuing in its durable workflow, its effect appears
only at the next 5-minute boundary, which exceeds the 180-second test timeout. Whether the workflow
continues after the request stops waiting is unverified. A loaded full-suite run recorded no
deadline expiries.

## Sandbox queue timeout includes queue wait

Status: inferred from code; not observed in a loaded run.

`processSandboxExecutionQueue` (`kernel/backend/src/modules/sandbox/durable-queues.ts`) wraps
`DurableQueue.process` in a 1-minute timeout with two retries. `DurableQueue.process` offers the
item and awaits its deferred result, so time spent waiting behind other work in the
`SANDBOX_WORKER_CONCURRENCY` slots counts against that timeout. All E2E workers share one backend
with 5 slots, so queue wait grows with the number of concurrent files. A loaded full-suite run
recorded no queue timeouts.

## Wall-clock budgets on CPU-bound work

Status: inferred from code.

The sandbox compiler budget (`SANDBOX_LIMITS.compiler.timeoutMs`, 5 seconds) covers spawning a
fresh Bun process and loading the TypeScript compiler, not only compilation. Replay timeout
(30 seconds), bridge session expiry, and HTTP attempt timeout (8 seconds) are also wall-clock.
CPU contention stretches each of them. No compiler timeout was observed on the 8 vCPU host.

## Retained composition loads the Media client module mid-test

Status: measured; trigger unconfirmed.

`retains the document and bridge across same-composition saved views`
(`e2e/src/browser/composed-views.test.ts`) fails under load because the retained document requests
the Media plugin's lazy client artifact (`module.css` and `module.js`) around the request-count
snapshot. The iframe, its `src`, and its runtime state are retained, so the navigation itself does
not reload anything. When run alone the artifact is never requested during the test. The likely
trigger is the new user's asynchronous Media workspace bootstrap completing during the test and a
live update rendering Media content, but this is not confirmed. A fix requires either a fixture
that waits for user bootstrap or a narrower assertion.

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
