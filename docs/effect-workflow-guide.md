# `@effect/workflow` Guide

This is a from-source guide to `@effect/workflow` and the `ClusterWorkflowEngine`/`SingleRunner`
modules of `@effect/cluster` — the durable-execution stack `apps/app-backend` runs on. It exists
because a hand-written gist that circulates for this library turned out to be confidently wrong
(wrong package name, invented modules, invented config fields), and because this package is
pre-1.0 and changes fast enough that nothing about it should be taken on memory.

**Methodology, so the claims here are checkable.** Everything is sourced from one of three places,
in order of trust:

1. The actual `@effect/workflow`/`@effect/cluster` source and test suites, cloned at the exact
   commit (`626c61b3ef0dce59ffb038590bc834d36afc5d1d`) both packages were tagged from — the same
   release that produced the versions this repo pins (`@effect/workflow@0.18.2`,
   `@effect/cluster@0.59.0`). File:line citations below refer to that checkout.
2. The `@effect/workflow`/`@effect/cluster` `CHANGELOG.md` files and their GitHub issue tracker,
   for behavior history and known gaps.
3. This codebase's own usage, read file by file.

Every code sample in this guide was compiled with `tsc --strict` against the real installed
`@effect/workflow@0.18.2` types in `apps/app-backend/node_modules` — not eyeballed, not
remembered. Where something is inference rather than a confirmed fact (mostly in the "known
upstream issues" section), it's labeled as such.

If you upgrade `@effect/workflow` or `@effect/cluster`, re-verify anything version-sensitive here
against the new source before trusting it — this package has shipped breaking changes in patch
and minor releases before (see [Known upstream issues](#known-upstream-issues-and-limitations)).

---

## The mental model: workflows replay

This is the one idea that makes everything else make sense, and it isn't spelled out anywhere in
the package's own docs — it's only inferable from reading the code.

A workflow execution is backed by a `@effect/cluster` `Entity`, one per `executionId`, with RPC
methods (`run`, `activity`, `deferred`, `resume`) that are durably persisted
(`ClusterWorkflowEngine.ts:610-665`). When a workflow **suspends** — because it's awaiting an
activity, a `DurableClock`, a `DurableDeferred`, or a child workflow that hasn't resolved yet — it
does so by having its own fiber **self-interrupt**
(`fiber.unsafeInterruptAsFork(fiber.id())`, `Workflow.ts:680-685`). The in-memory call stack for
that attempt is genuinely destroyed. There is no serialized continuation, no stack snapshot.

To **resume**, the engine re-delivers the same persisted `run` request, which re-invokes your
workflow body function **from scratch** — it calls `execute(payload, executionId)` again,
literally re-running the whole generator from the top.

This would make every resume redo all your side effects, except: every `Activity.make` call (and
`DurableClock.sleep`, `DurableDeferred.await`, `DurableQueue.process`) is itself a separate
persisted RPC request, keyed by name (`` `${name}/${attempt}` `` for activities,
`ClusterWorkflowEngine.ts:599,667`). Re-sending an already-completed persisted request just
returns the stored reply — the real effect inside `execute:` does not run again. **`Activity.make`
(and the other durable primitives) are the memoization boundary that makes replay safe.**

Anything *not* wrapped in one of those primitives — a bare DB write, `console.log`, `Date.now()`,
a random id, a network call — simply re-executes, in full, every single time the workflow resumes.
This is functionally identical to Temporal's workflow-determinism model, but nothing in this
package's README/JSDoc says so explicitly; you have to know it going in.

This single fact is the justification for essentially every rule in the rest of this guide.

---

## Defining a workflow

```ts
import { Workflow } from "@effect/workflow";
import { Effect, Schema } from "effect";

const ChargeError = Schema.Struct({ _tag: Schema.Literal("ChargeError"), reason: Schema.String });

const ProcessOrder = Workflow.make({
  name: "ProcessOrder",
  payload: { orderId: Schema.String, amount: Schema.Number },
  success: Schema.Struct({ transactionId: Schema.String }),
  error: ChargeError,
  idempotencyKey: (payload) => payload.orderId,
});
```

`Workflow.make`'s full option set (`packages/workflow/src/Workflow.ts:263-280` — this is
everything; there is no `retryPolicy`, `timeout`, or versioning field):

| Field | Required | Notes |
|---|---|---|
| `name` | yes | Identifies the workflow. Baked into the execution id hash, so two workflows can safely share an `idempotencyKey` output. |
| `payload` | yes | A `Schema.Struct.Fields` record (auto-wrapped) or a full struct schema. |
| `idempotencyKey` | **yes** | `(payload) => string`. Not optional, not a static value — a function. |
| `success` | no | Defaults to `Schema.Void`. |
| `error` | no | Defaults to `Schema.Never`. |
| `suspendedRetrySchedule` | no | See [below](#discard-and-suspendedretryschedule) — this is not an activity retry policy. |
| `annotations` | no | Defaults to `Context.empty()`. Used for `Workflow.SuspendOnFailure` / `Workflow.CaptureDefects` (see [Compensation vs. finalizers](#compensation-vs-plain-finalizers)). |

`idempotencyKey` isn't just documentation — the execution id used for durability is literally
`SHA256(`${workflow.name}-${idempotencyKey(payload)}`)`, truncated to 32 hex chars
(`Workflow.ts:281`, `internal/crypto.ts:4-15`). That's what the **high-level** `.execute()`
convenience method uses.

### Two ways to execute a workflow

This matters because this codebase uses the second form almost exclusively, and it's easy to miss
that a second form exists.

**High-level**, on the `Workflow` value itself — no way to override the execution id, it's always
`idempotencyKey(payload)`:

```ts
ProcessOrder.execute({ orderId, amount }, { discard: true }); // returns Effect<string, never, ...>
```

**Low-level**, via the `WorkflowEngine` service — you supply `executionId` explicitly, completely
independent of whatever `idempotencyKey` would have computed:

```ts
import { WorkflowEngine } from "@effect/workflow";

const engine = yield* WorkflowEngine.WorkflowEngine;
yield* engine.execute(ProcessOrder, {
  payload: { orderId, amount },
  executionId: `order-${orderId}`,
  discard: true,
});
```

Every workflow dispatch found in `apps/app-backend` uses the low-level form via
`yield* WorkflowEngine` — never `SomeWorkflow.execute(...)`. Since `idempotencyKey` is a required
field regardless of which form you use, the convention in this codebase is to give every workflow
payload its own `executionId: Schema.String` field and set `idempotencyKey: ({ executionId }) =>
executionId` — a pure passthrough. That keeps the (otherwise unused) high-level path consistent
too, but the actual dedup key on every real dispatch is whatever string the caller passed to
`engine.execute(...)`. **Practically: "is this deterministic" always reduces to "did the caller
build the `executionId` string deterministically before calling `engine.execute`."**

### `discard` and `suspendedRetrySchedule`

- `discard: true` → `.execute()`/`engine.execute()` returns the `executionId` string immediately,
  fire-and-forget, error channel is `never`.
- `discard` false/omitted → blocks until the workflow reaches a `Complete` result. Internally this
  is a poll loop: call the engine, and if the result is `Suspended`, wait
  `suspendedRetrySchedule` and call again (`WorkflowEngine.ts:392-402`). Default
  `Schedule.exponential(200, 1.5).pipe(Schedule.either(Schedule.spaced(30000)))` — **unbounded**,
  so by default this never gives up. If you override it with a bounded schedule and it exhausts,
  the call **dies** (a defect, not a typed error) — `Effect.dieMessage`, `WorkflowEngine.ts:398-399`.

So `suspendedRetrySchedule` is not "how many times will my workflow retry" — it's how patiently a
*blocking caller* polls while the workflow is suspended. Don't reach for it to configure business
retries.

---

## Defining an activity

```ts
import { Activity } from "@effect/workflow";

const charge = yield* Activity.make({
  name: "charge-payment",
  success: Schema.Struct({ transactionId: Schema.String }),
  error: ChargeError,
  execute: Effect.succeed({ transactionId: `txn-${executionId}` }),
});
```

Full option set (`Activity.ts:85-95` — again, everything; **there is no `retry` field**):

| Field | Required | Notes |
|---|---|---|
| `name` | yes | Together with the attempt number, this is the activity's persisted RPC key: `` `${name}/${attempt}` ``. Must be unique *within* a workflow body — including across loop iterations (see [Determinism](#determinism-and-child-workflows)). |
| `execute` | yes | `Effect<Success, Error, R>`. |
| `success` / `error` | no | Default `Schema.Void` / `Schema.Never`. |
| `interruptRetryPolicy` | no | Retries on **fiber interruption** specifically (a transport/infra concern), default `Schedule.exponential(100, 1.5).pipe(Schedule.union(Schedule.spaced("10 seconds")), Schedule.union(Schedule.recurs(10)), Schedule.whileInput(Cause.isInterrupted))` (`Activity.ts:128-132`). This is **not** a business-logic retry policy. |

Every `Activity.make` call found in `apps/app-backend` uses only `{ name, execute, success?,
error? }` — none set `interruptRetryPolicy`, so they all get the sensible default above for
transient interruption. None use business-logic retries either (see next).

### `Activity.retry` — a separate combinator, and it can't take a custom `Schedule`

```ts
yield* Activity.make({ name: "SendEmail", error: SendEmailError, execute: sendEmail(payload) }).pipe(
  Activity.retry({ times: 5 }),
);
```

`Activity.retry`'s options type is `Omit<Effect.Retry.Options<E>, "schedule">`
(`Activity.ts:64-75`) — the `schedule` option was deliberately removed in `0.14.0`
(`packages/workflow/CHANGELOG.md:77-86`), so only `times`/`until`/`while`-shaped options work. If
you're porting a Temporal-style exponential-backoff retry policy, you can't express it through
`Activity.retry` directly at this version.

Mechanically, `Activity.retry` provides `Activity.CurrentAttempt` (default `1`,
`Activity.ts:175-177`) and increments it each cycle — the attempt number only exists because of
this combinator, not because of `Activity.make` itself.

**No activity anywhere in `apps/app-backend` currently uses `Activity.retry`.** That's not
necessarily wrong — it may be deliberate (e.g. retrying a whole import run rather than one
activity) — but it's worth being a conscious choice rather than an oversight, since business-level
transient-failure retries don't currently exist at the activity level anywhere in this codebase.

---

## Determinism and child workflows

Because the whole workflow body replays (see [mental model](#the-mental-model-workflows-replay)),
any code path that can run more than once — a genuine workflow replay, *or* an `Activity.make`
retried after an interruption — must not depend on anything non-deterministic to name a child
workflow, or you get a new, never-deduplicated child every time it runs.

```ts
// Good: deterministic, derived from the parent's own executionId plus a stable loop index.
// Replaying this loop dispatches the *same* child every time.
yield* engine.execute(ChildWorkflow, {
  executionId: `${parentExecutionId}-item-${item.index}`,
  discard: true,
  payload: { parentExecutionId, index: item.index },
});

// Bad: a fresh id on every invocation. Every re-run — a parent replay, or this code being
// retried inside an Activity after an interruption — spawns a brand new child.
yield* engine.execute(ChildWorkflow, {
  executionId: crypto.randomUUID(),
  discard: true,
  payload: { parentExecutionId, index: item.index },
});
```

The random-id form is correct **only** for a genuinely fresh, top-level dispatch — an HTTP handler
starting a brand-new job that has no parent workflow and will never be replayed. Several places in
this codebase correctly use `generateId()` for exactly that reason (e.g.
`sandbox/service.ts`'s `SandboxExecutionService.enqueue`).
The rule only bites when the dispatching code itself can run more than once.

**The current, correctly-executed media import example** lives in the media plugin's import workflow
(`plugins/media/scripts/imports/import.sandbox.ts`):

```ts
// import.sandbox.ts: stable batch indexes key each child workflow.
yield* replay.child(`resolve-${batchIndex}`, resolution, payload);
yield* replay.child(`populate-${batchIndex}`, population, payload);
yield* replay.activity(`chunks-${batchIndex}`, chunkWriter, payload);
yield* replay.child("write-import", kernelImport, payload);
```

The import workflow owns phase orchestration, each plugin workflow body owns its durable calls, and
every key is derived from stable submitted indexes. The
[audit](#entity-import-and-media-membership) below distinguishes direct generic population from
plugin-owned relationship mutations.

---

## Durable primitives beyond `Activity`

| Primitive | Use it for | Key facts |
|---|---|---|
| `DurableClock.sleep({ name, duration, inMemoryThreshold? })` | Durable delays. | Sleeps `&le; inMemoryThreshold` (**default 60s**) run as a plain in-process `Activity.make` — they don't touch durable clock storage at all (`DurableClock.ts:91-96,108`). Tests force the durable path with `inMemoryThreshold: Duration.zero`. |
| `DurableDeferred.make(name, { success?, error? })` + `.await`/`.token`/`.succeed`/`.fail` | Human-in-the-loop / wait-for-webhook. A workflow can hand out an opaque `Token` and suspend; an external, non-workflow caller (e.g. an HTTP handler) resolves it later. | `token`/`await` need `WorkflowInstance` (called from inside the workflow); `tokenFromExecutionId`/`tokenFromPayload` work from outside; `succeed`/`fail`/`done` only need `WorkflowEngine`, so they're callable from a plain route handler. |
| `DurableQueue.make({ name, payload, idempotencyKey, success?, error? })` + `.process`/`.worker` | Fan work out to an out-of-band worker pool and suspend until it's done. | Built directly on `@effect/experimental/PersistedQueue` (`DurableQueue.ts:4`) plus a per-item `DurableDeferred`. **Calling `DurableQueue.process(...)` bare, directly in a workflow body, is the correct, intended usage** — it's a first-class durable primitive in its own right, not a bare side effect. This is the idiom used everywhere in this codebase for sandbox script dispatch (`SandboxExecutionQueue`), and it's correct every time it appears. |
| `DurableRateLimiter.rateLimit({ name, algorithm?, window, limit, key })` | Durably sleep out an imposed rate-limit delay instead of busy-waiting. | Returns an `Activity`; built on `@effect/experimental`'s `RateLimiter` + `DurableClock.sleep` internally. |
| `WorkflowProxy` / `WorkflowProxyServer` | Expose workflows as RPC or `HttpApi` endpoints automatically. | Generates three endpoints per workflow: base (blocking execute), `${name}Discard`, `${name}Resume`. |

Worked examples for `DurableClock`, `DurableDeferred`, and `DurableQueue` — all `tsc --strict`
verified against the real 0.18.2 types:

```ts
// DurableClock
const ReminderWorkflowLive = ReminderWorkflow.toLayer((payload) =>
  Effect.gen(function* () {
    yield* DurableClock.sleep({ name: "wait-a-week", duration: "7 days" });
    yield* Activity.make({ name: "send-reminder", execute: Effect.log(`reminding ${payload.userId}`) });
  }),
);

// DurableDeferred — token/webhook pattern
const ApprovalReceived = DurableDeferred.make("ApprovalReceived", {
  success: Schema.Struct({ approvedBy: Schema.String }),
});

const ApprovalWorkflowLive = ApprovalWorkflow.toLayer((_payload) =>
  Effect.gen(function* () {
    const token = yield* DurableDeferred.token(ApprovalReceived);
    yield* Effect.log(`share this token with the approver: ${token}`);
    return yield* DurableDeferred.await(ApprovalReceived);
  }),
);

// Called later from a plain HTTP handler, outside any workflow:
const resolveApproval = (token: DurableDeferred.Token, approvedBy: string) =>
  DurableDeferred.succeed(ApprovalReceived, { token, value: { approvedBy } });

// DurableQueue — this is the package's own doc-comment example (DurableQueue.ts:36-83)
const ApiQueue = DurableQueue.make({
  name: "ApiQueue",
  payload: { id: Schema.String },
  success: Schema.Void,
  error: Schema.Never,
  idempotencyKey(payload) { return payload.id; },
});

const MyWorkflowLive = MyWorkflow.toLayer(Effect.fn(function* (payload) {
  yield* DurableQueue.process(ApiQueue, { id: payload.id });
  yield* Effect.log("Workflow succeeded!");
}));

const ApiWorker = DurableQueue.worker(
  ApiQueue,
  Effect.fn(function* ({ id }) { yield* Effect.log(`Worker processing API call with id: ${id}`); }),
  { concurrency: 5 },
);
```

---

## Compensation vs. plain finalizers

This is the sharpest gotcha in the whole system, and it's easy to get backwards if you're used to
`Effect.addFinalizer`/`Effect.ensuring`/`Effect.acquireRelease` from non-workflow Effect code.

**A plain finalizer attached inside a workflow body fires on *every suspend*, not just at final
completion.** It's attached to the per-attempt scope created inside `Workflow.intoResult`'s
`Effect.scoped` (`Workflow.ts:518-532`), which closes whenever that attempt's fiber exits —
including exiting via the self-interrupt that implements suspension. A `try/finally`-shaped cleanup
written the obvious way runs once per suspension point the workflow crosses over its *entire
lifetime*, not once at the end. This is directly demonstrated by the cluster test suite's own
comments: *"normal finalizer should run even after suspension"* vs *"but not compensation"*
(`packages/cluster/test/ClusterWorkflowEngine.test.ts:46-52`).

**Only `Workflow.withCompensation` survives suspend/resume.** It attaches to a separate,
longer-lived `Workflow.scope` (added specifically in `0.15.1` to *not* close on suspension,
`packages/workflow/CHANGELOG.md:57-65`) that only closes when the workflow truly completes. Its
finalizer only registers on the wrapped effect's *success*, and — the part most likely to bite you
— **compensation does not cascade into nested activities**: *"Compensation finalizers are only
registered for top-level effects in the workflow"* (`Workflow.ts:102-108`, `170-177`). If you wrap
several activities inside a helper function and call `withCompensation` on the helper's result, you
get one compensation for the whole helper, not one per activity — structure deliberately if you
need per-step rollback.

```ts
// Compensation registers only after the 5th (successful) attempt completes; the first four
// failed attempts register nothing, matching the package's own test pattern
// (ClusterWorkflowEngine.test.ts:394-411).
yield* Activity.make({ name: "SendEmail", error: SendEmailError, execute: sendEmail(payload) }).pipe(
  EmailWorkflow.withCompensation((_value, _cause) =>
    Effect.log("compensating: permanently failed to send email"),
  ),
  Activity.retry({ times: 5 }),
);
```

`apps/app-backend` doesn't currently use `withCompensation` or bare workflow-body finalizers
anywhere (confirmed by grep across every workflow file) — a clean slate, not a live issue. Worth
knowing before the first time someone reaches for `Effect.addFinalizer` inside a workflow body
expecting Temporal-style "runs once, at the end" semantics.

---

## This repo's execution backend

`apps/app-backend/src/lib/infrastructure/workflow.ts` wires:

```ts
const WorkflowPgClientLive = Layer.unwrapEffect(
  Effect.map(AppConfig, (config) =>
    PgClient.layer({
      url: config.database.url,
      maxConnections: config.database.workflowPoolMax,
    }),
  ),
);

export const WorkflowEngineLive = ClusterWorkflowEngine.layer.pipe(
  Layer.provide(
    SingleRunner.layer({
      runnerStorage: "sql",
      shardingConfig: {
        shardLockDisableAdvisory: true,
        entityMessagePollInterval: Duration.millis(250),
      },
    }),
  ),
  Layer.provide(WorkflowPgClientLive),
);
```

`WorkflowPgClientLive` is built from `AppConfig` (the config definition is the single source of
truth for `DATABASE_WORKFLOW_POOL_MAX`), so `WorkflowEngineLive` carries an `AppConfig` requirement
satisfied by `ConfigLive` in `apps/app-backend/src/app/layers.ts`.

A few facts worth knowing about this specific setup:

- **`SingleRunner.layer` is for single-node deployments; the package author's own words**: *"an
  in-memory cluster for testing purposes"* is `TestRunner`, while *"`SingleRunner` allows you to
  run a single node cluster [for] simple deployment scenarios... Multiple nodes are not
  supported"* (`packages/cluster/CHANGELOG.md:114-126`, the `0.54.0` entry that introduced both).
  This matches Ryot's self-hosted, effectively-single-instance deployment model.
- **`runnerStorage: "memory" | "sql"` only controls `RunnerStorage`** (shard/runner bookkeeping,
  largely vestigial on one node) — **`MessageStorage` (the thing that actually matters for
  durability/replay) is hard-coded to SQL regardless** (`SingleRunner.ts:35`). There is no way to
  get a fully in-memory `SingleRunner`.
- **The dedicated Postgres pool (`DATABASE_WORKFLOW_POOL_MAX`) is a correctness requirement, not a
  performance tweak.** Ryot disables session-scoped advisory shard locks because Effect Cluster
  concurrently operates on their shared connection, which `pg` no longer supports. Effect Cluster
  still reserves one sticky connection (`SqlRunnerStorage.ts:35-67`), so usable connections =
  `DATABASE_WORKFLOW_POOL_MAX` − 1; startup validation (`validateSystemConfig`) rejects a
  workflow pool smaller than `SANDBOX_LIMITS.workerConcurrency`, since exceeding it starves the
  workflow engine.
- **`entityMessagePollInterval` defaults to 10 seconds** (`ShardingConfig.ts:153`, confirmed
  exactly) — this is why it's tuned down to 250ms here (see the next section).
- A separate, easy-to-conflate tunable, **`entityReplyPollInterval`** (default 200ms), governs how
  a *client* notices a reply arrived, as opposed to how an entity notices new work — don't reach
  for the wrong one when tuning responsiveness.

---

## Known upstream issues and limitations

These are real, current gaps in the library itself — not this codebase's mistakes. Calibrate how
much weight to give each by the evidence behind it; they are not equally solid.

### Confirmed: parent resume after the first awaited child is slow ([#6294](https://github.com/Effect-TS/effect/issues/6294))

Filed against this exact version by this team, open, unanswered. When a parent workflow awaits a
**second** (or later) child, `ClusterWorkflowEngine`'s `sendResumeParent` clears the parent's
stored reply (`sharding.reset`) but — unlike every other resume path in the engine — never calls
`sharding.pollStorage` to wake the storage-read loop immediately. The parent only resumes on the
next scheduled poll tick (10s by default). Independently re-derived and confirmed against the exact
source at this commit by both research passes behind this guide; the package's own test suite
doesn't catch it because its one "nested workflow" test only ever awaits a single child.
**Workaround already applied** in `lib/workflow.ts`: lower `entityMessagePollInterval` to 250ms so
the fallback poll fires quickly instead of eliminating the gap entirely.

### Reported, weaker evidence: `Activity.make` concurrency/nesting hazards ([#6014](https://github.com/Effect-TS/effect/issues/6014))

A community-reported (not maintainer-confirmed) issue claiming two patterns can deadlock:

1. `Effect.all({ concurrency > 1 })` wrapping multiple `Activity.make` calls, during replay.
2. Executing a child workflow from *inside* an `Activity.make`'s `execute:` body.

Treat this with real skepticism: the reporter's own controlled reproductions (8 scenarios,
including SQL-backed suspend/resume/replay under concurrency) **all passed**; it only manifested
with real HTTP I/O in an actual production process, confounded by a *separate*, acknowledged
runner-health problem (stale messages from a restarted runner). The one maintainer reply pushed
back skeptically — and that skepticism checks out: the issue's original reproduction snippet passes
an `execute` field directly into `Workflow.make(...)`'s options, which doesn't exist as a field
(`execute` only comes in via `.toLayer(execute)`).

That said, pattern 2 has a plausible mechanical explanation worth taking seriously even without
maintainer confirmation: code inside an `Activity.make` body gets a **fresh, separate
`WorkflowInstance`** from the outer workflow (`ClusterWorkflowEngine.ts:336,371`). A child workflow
executed there suspends *that inner instance*, self-interrupting the activity's own RPC-handling
fiber — and the outer `activityExecute` retry loop sees the resulting `Suspended` result and
immediately loops again with **no backoff of its own** (`ClusterWorkflowEngine.ts:465-499`). If the
nested child keeps re-suspending identically, that's a tight loop that never converges. This is
inference from reading the source, not a confirmed bug.

**Practical takeaway**: avoid both patterns defensively — put concurrent fan-out *inside* a single
Activity's `execute:` body rather than fanning out over multiple `Activity.make` calls, and always
dispatch child workflows directly from the workflow body, never from inside an Activity — but don't
describe either as a "confirmed bug" the way #6294 is. `apps/app-backend` currently has **zero
instances of either pattern**. Every child-workflow dispatch that used to run transitively from
inside an `Activity.make` body has been refactored so the dispatch now happens from a workflow body:

- The `EventCreateWorkflow` body evaluates event-create policies through
  `DurableQueue.process(SandboxExecutionQueue)` and dispatches committed lifecycle occurrences to
  automation subscriptions, all outside its write activities
  (`events/event-create-workflow-live.ts`).
- The collection-added event is dispatched from `AddEntityToCollectionWorkflow`'s body, not from an
  `Activity.make` wrapper around `addToCollection` (`collections/add-entity-to-collection-workflow-live.ts:44`).
- Integration reconciliation runs dispatch `ProcessIntegrationRunWorkflow` from
  `IntegrationReconciliationWorkflow`'s body, replacing the reconciliation activity that dispatched
  them transitively (`integrations/reconciliation-workflow.ts:37-46`).

`sandbox/workflow-boundaries.test.ts` pins these as source-text assertions (e.g. exactly one
`.execute(EventCreateWorkflow, …)` and it lives in the add-to-collection workflow body, zero
`.execute(SandboxSubmissionWorkflow, …)` in `event-creation.ts`), so a regression can't reintroduce a
transitive dispatch silently.

### No versioning primitive of any kind

An exhaustive grep for "version" across `packages/workflow/src` returns zero hits. There is no
`Workflow.patched`, no schema-version field, nothing analogous to Temporal's `GetVersion`. Deploying
a new workflow-body implementation while old executions are suspended mid-flight means the *new*
code replays against the *old* activities' persisted results, with nothing in the library to detect
or guard against the resulting non-determinism. If a workflow body's shape changes in a way that
would change which activities run or in what order, in-flight executions from before the deploy are
at risk — there's no built-in safety net, so this has to be managed operationally (e.g. draining
in-flight workflows before deploying a body change).

---

## Testing

Three genuinely different tiers exist, in increasing order of fidelity to production:

1. **`WorkflowEngine.layerMemory`** (`WorkflowEngine.ts:469-640`) — a self-contained `Map`-based
   scheduler living entirely inside the `workflow` package. No `Sharding`, no `Entity`, no
   `MessageStorage`. This is what the package's own `packages/workflow/test/WorkflowEngine.test.ts`
   uses. Good for pure workflow-logic tests; **does not exercise anything about
   `ClusterWorkflowEngine`'s replay/persisted-RPC mechanics** — it's a structurally different
   implementation of the same interface, so it can't catch engine-level issues like #6294.
2. **`TestRunner.layer` + `ClusterWorkflowEngine.layer`** — a real in-memory *cluster*, exercising
   the actual `ClusterWorkflowEngine` code path with `MessageStorage.layerMemory` +
   `RunnerStorage.layerMemory`. This is what
   `packages/cluster/test/ClusterWorkflowEngine.test.ts` uses (with a tighter
   `entityMessagePollInterval` for fast tests), and it's the most faithful in-process option
   available without a real Postgres — the right target if this codebase ever needs to test
   engine-level replay/suspend/resume behavior directly rather than mocking around it.
3. **This codebase's own harness**, `apps/app-backend/src/lib/test-utils/effect.ts`:
   `makeWorkflowEngine(overrides)` stubs every `WorkflowEngine` method to `Effect.die("unused")`
   by default; `makeWorkflowActivityEngine(instance)` additionally runs a given activity's
   `execute` directly in-process. **`execute` (real child-workflow dispatch) is never overridden by
   this helper** — it stays `Effect.die("unused")` unless a test supplies its own. Every
   workflow-body test in this codebase sidesteps this by mocking the operations/service boundary
   instead of letting real child-workflow dispatch run.
   That's a reasonable choice for unit-testing orchestration logic, but it means **the real
   `AddEntityToCollectionWorkflow → EventCreateWorkflow.execute` chain (and the other body-to-child
   dispatches) is invisible to the existing unit tests structurally, not just by oversight** — a
   dispatch-argument regression (e.g. a reintroduced non-deterministic `executionId`) needs an
   explicit assertion on the mocked call's input to catch, not just an assertion that the mock was
   called. `sandbox/workflow-boundaries.test.ts` closes part of this gap by asserting *which* file
   dispatches *which* child and how many times, but it still checks call sites by source text, not
   the `executionId` argument passed at runtime.

---

## Common misconceptions (correcting a specific bad source)

A gist that circulates for this library ([gist.github.com/dmmulroy/e04048c70b7059badcf9333426504dd0](https://gist.github.com/dmmulroy/e04048c70b7059badcf9333426504dd0))
gets enough wrong that it's worth cataloguing precisely, since disproving specific claims is more
useful than a vague "don't trust it":

| Claim | Verdict |
|---|---|
| Package is `@effect/workflows` (plural), imports `Schema` from it | **Wrong.** It's `@effect/workflow` (singular); `Schema` comes from `effect`, not this package. |
| `Workflow.make` takes an `idempotencyKey: (payload) => string` config field | Real field, but the gist also invents `suspendedRetrySchedule`-adjacent details around it that don't match — see the [field table](#defining-a-workflow) above for the actual complete list. |
| `Activity.payload(schema)` / `Activity.executionId` exist | **Fabricated** — zero hits anywhere in the source. The real accessor is `Activity.idempotencyKey(name)`, which reads the ambient `WorkflowInstance.executionId`. |
| `Activity.currentAttempt` (lowercase function) | **Wrong casing/shape** — it's `Activity.CurrentAttempt`, a `Context.Reference` class, populated by the `Activity.retry` combinator. |
| `WorkflowEngine.make({ persistence: { stateStore, historyStore }, concurrency: {...} })` | **Entirely fabricated.** No such config shape exists anywhere. Real engines are `Layer`s (`ClusterWorkflowEngine.layer`, `WorkflowEngine.layerMemory`), not objects constructed with a persistence config. |
| `WorkflowInstance` as an importable module with `.executionId`/`.workflowName`/`.currentAttempt` | **Fabricated as described** — `WorkflowInstance` is a real `Context.Tag` (`WorkflowEngine.ts:74-111`), but it's not user-facing API shaped the way the gist shows; reads like it's pattern-matched against Temporal's `workflowInfo()` rather than this library. |
| Built-in saga/compensation support | **Real**, but the gist likely omits the sharpest caveat: it explicitly does not cascade into nested activities, and behaves very differently from a plain finalizer across suspend/resume. See [Compensation vs. finalizers](#compensation-vs-plain-finalizers). |
| `Activity.onError` | Existed for exactly one patch release (`0.1.1`) and was removed the very next one (`0.1.2`), replaced by `withCompensation`. Any source describing it is describing dead API from very early in the package's life. |

---

## Lessons from public usage

Public app usage is still sparse and noisy: some repos have good patterns, some production-looking
repos have broken identity, and some merely list `@effect/workflow` in package metadata without
using it in source. Treat public examples as low-trust until the source imports, activity/workflow
definitions, and runtime engine wiring are all visible.

- `idempotencyKey` must be a pure projection of payload. Never call `Date.now()`, `new Date()`,
  `crypto.randomUUID()`, `generateId()`, or read mutable external state inside it.
- For event/cron dispatch, the workflow key should be derived from the source event id, business id,
  or scheduled tick. A fresh random id is only for a user-initiated "start a new job now" command.
- Activity boundaries are completion-memoization boundaries, not transaction boundaries. If an
  activity performs many writes or emits a stream of events, make every write idempotent or split
  the work into smaller deterministic activities.
- `WorkflowEngine.layerMemory`, ordinary `Effect.retry`, `Deferred`, `Effect.sleep`, queues,
  Durable Objects, and event logs are not proof of workflow durability. They can be valid tools, but
  they do not replace workflow replay, activity memoization, or durable completion records.
- Treat public docs in application repos (`CLAUDE.md`, generated guides, comments) as low-trust
  unless they compile against the real package. Plausible-looking guidance often lags or invents API
  that never existed.

---

## Audit: how this codebase measures up today

This section is the result of reading every file in `apps/app-backend` that references
`@effect/workflow` against the ground truth above. The codebase is in good shape, and is organized
around one principle: **one durable owner per business operation**. Each user-visible operation —
create an event, add an entity to a collection, populate a provider entity, run a plugin import, or
reconcile integrations — has a single workflow (or a single durable queue) that owns its writes and
its child dispatches, so those steps journal under one execution id regardless of which caller
triggered them. There are **no remaining instances** of a child workflow
dispatched transitively from inside an `Activity.make` body (see the [#6014
discussion](#reported-weaker-evidence-activitymake-concurrencynesting-hazards-6014) above); every
child dispatch happens from a workflow body.

### The canonical owners

The workflows and durable queues that each single-own a business operation, all following the rules
above:

- **`EventCreateWorkflow`** (`events/event-create-workflow-live.ts`) — orchestrates event creation
  from its body: a `prepare-item` activity resolves scopes and ordered policies, policies run via
  `DurableQueue.process(SandboxExecutionQueue)`, a `write-event` activity persists the row, the
  committed lifecycle occurrence dispatches matching `SubscriptionExecutionWorkflow` children,
  and media membership for referenced global entities is handled by an awaited media event policy.
- **`EntityImportWorkflow`** (`entity-import/entity-import-workflow.ts`) — owns provider population
  for direct generic `/entity-import` requests. It deliberately does not add `in-library`; manifest
  import-source workflows may separately emit generic user-relationship mutations.
- **`AddEntityToCollectionWorkflow`** (`collections/add-entity-to-collection-workflow-live.ts`) —
  owns add-to-collection: one `write-collection-membership` activity does the transactional write,
  then the body dispatches the collection-added `EventCreateWorkflow` child with the deterministic
  `collection-membership-added-<id>` execution id. HTTP `addToCollection` and media-import writing
  both route through it.
- **`ProcessImportRunWorkflow`** (`imports/import-run-workflow.ts` definition,
  `import-run-workflow-live.ts` body) — resolves the registry-owned source and awaits its plugin
  import workflow. `ProcessIntegrationRunWorkflow` similarly resolves an integration provider and
  awaits that plugin's import workflow; plugin workflows own source-specific resolution,
  population, and generic kernel-write composition.
- **Cron owners** — `PluginCronService` (`scheduler/plugin-cron.ts`) awaits either the direct script
  or durable workflow declared by each plugin manifest cron. `PluginBootService`
  (`scheduler/plugin-boot.ts`) dispatches each manifest `boot` entry once per server start and
  awaits terminal completion. The native
  `IntegrationReconciliationWorkflow` (`integrations/reconciliation-workflow.ts`) remains a fan-out
  shell whose activity prepares eligible runs and whose body dispatches one
  `ProcessIntegrationRunWorkflow` child per run id.
- **Pre-existing owners** unchanged by this structure: `ProviderEntityPopulationWorkflow`,
  `TranslateEntityWorkflow`, `NotificationDeliveryWorkflow`, `SandboxSubmissionWorkflow` +
  `SandboxExecutionQueue`, `CreateDefaultSavedViewWorkflow`, `ProcessImportRunWorkflow`,
  `ProcessIntegrationRunWorkflow`.

### Notes worth knowing

- **Deterministic-upsert as defense in depth**: the `write-event` activity in
  `event-create-workflow-live.ts:179-212` is Activity-wrapped (RPC-memoized), *and* the insert it
  performs uses a deterministic id (`` `${executionId}-event-${itemIndex}` ``) with
  `.onConflictDoNothing()` plus a read-back on conflict (`events/repository.ts:108-146`). Either
  strategy alone would keep the write idempotent under replay; the codebase uses both here. This is
  worth knowing because a deterministic-key upsert is a legitimate *alternative* to Activity-wrapping
  elsewhere, not only a belt-and-suspenders addition to it.
- **The event workflow body is a pure orchestrator**: every DB read and write in
  `runEventCreateWorkflow` happens inside an `Activity.make` (`prepare-item`, `write-event`) or a
  durable queue or awaited policy — there are no bare reads left in the body, so there is no
  replay-drift risk from unwrapped reads observing edited data across a resume.
- **`DurableQueue.process(...)` called bare in workflow bodies** — this pattern recurs across
  modules (for example, sandbox dispatch). It is **correct**, not a violation; see the
  [durable primitives table](#durable-primitives-beyond-activity) above.
- **Finalizers in workflow files**: the one workflow-body use is
  `generic-import-workflow.ts`'s `Effect.ensuring(removeChunks(...))`, which scopes harvested-chunk
  cleanup to the chunk-processing effect. Opaque handle release is workflow-owned cleanup, while
  this remains scratch cleanup rather than business compensation, so the
  [compensation-vs-finalizers](#compensation-vs-plain-finalizers) gotcha does not apply to it — a
  replay that re-enters the step re-reads chunk files it still owns. Every other
  `addFinalizer`/`ensuring`/`onExit`/`acquireRelease` use in `apps/app-backend/src` is a resource
  lifecycle outside a workflow body — connection pools, the compiler worker, interest-registry
  teardown, and the sandbox runtime's process, grant, and bridge-session teardown — so re-grep rather
  than treating any list here as a current inventory. Compensation for durable business effects still
  belongs in an activity, never a finalizer.
- **`workflow-boundaries.test.ts`** (`sandbox/workflow-boundaries.test.ts`) is a source-text
  conformance test that pins the single-owner invariants: which files may execute
  `SandboxSubmissionWorkflow` (and how many times), that workflow-owned sandbox callers use
  `SandboxExecutionQueue` directly, that the collections service no longer references
  `EventCreateWorkflow` while the add-to-collection workflow body is its one sanctioned dispatcher,
  and that import paths do not bypass their plugin workflow owners. It's a strong guard, but it
  matches call sites by source text — it checks *which module* dispatches *which* child and how
  often, not *what `executionId` argument* is passed, so an argument-correctness regression still
  needs a targeted unit test.

#### Entity import and media membership

Direct `/entity-import` dispatches `EntityImportWorkflow` as a top-level population-only job and may
use a generated execution id because no parent workflow replays that dispatch. Media membership is
not part of this generic workflow: manifest import-source workflows may emit generic relationship
mutations, while collection-triggered membership is awaited through `EventCreateWorkflow` media
policy.

---

## Checklist for reviewing new workflow code

- Every side effect inside a workflow body is either wrapped in `Activity.make`, or is one of the
  other durable primitives (`DurableClock`, `DurableDeferred`, `DurableQueue`), or is a
  deliberately-idempotent write (deterministic key + upsert) — not a bare call that would re-run
  on every replay.
- Every `Activity.make` name is unique *within* the workflow body, including across loop
  iterations — check the interpolated suffix actually varies per iteration.
- Every child-workflow / nested-workflow `executionId` is derived deterministically from the
  parent's `executionId` plus stable loop indices or stable data — never `generateId()`/
  `crypto.randomUUID()`/a timestamp, unless the dispatching code is a genuine one-shot top-level
  call that can never itself be replayed or retried.
- Every workflow `idempotencyKey` function is a pure projection of payload. It does not read the
  clock, generate ids, call services, or inspect database state.
- Every top-level event/cron dispatch derives the key from the source event, business id, or
  scheduled tick rather than from "now", unless "now" is itself the user-visible business identity
  of the job.
- No child-workflow execution (`engine.execute(...)`, or a helper that transitively calls it, like
  `EventsService.create`) happens from inside an `Activity.make`'s `execute:` body — dispatch
  children directly from the workflow body.
- No `Effect.all`/`Effect.forEach` with `concurrency > 1` wraps multiple `Activity.make` calls
  directly — put concurrent fan-out inside one Activity's `execute:` body instead.
- Any long activity that performs multiple external writes has an idempotency story inside the
  activity itself: deterministic ids, upserts, unique constraints, append dedupe keys, or a
  transaction that fully rolls back on failure/interruption.
- If you need cleanup that must survive suspension, use `Workflow.withCompensation`, not a bare
  `Effect.addFinalizer`/`Effect.ensuring` — and remember compensation doesn't cascade into nested
  activities.
- If a workflow body's activity graph is changing shape in a way that would affect in-flight
  executions, there's no built-in versioning safety net — think about drain/deploy ordering.
