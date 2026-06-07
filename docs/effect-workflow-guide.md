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
`sandbox/service.ts`'s `SandboxApiService.enqueue`, `exercises/preload.ts`'s per-boot preload run).
The rule only bites when the dispatching code itself can run more than once.

**The actual, correctly-executed example of this pattern in this codebase** lives in
`apps/app-backend/src/modules/imports/media/workflow-population.ts:79-87` and
`workflow-resolution.ts:89-96`, both implementing the `MediaImportWorkflowOperations` interface
(`workflow-types.ts:27-47`):

```ts
// workflow-resolution.ts:89-96
const result = yield* operations
	.resolveExternalId({
		value: ref.identifierValue,
		userId: input.payload.userId,
		identifierType: ref.identifierType,
		scriptId: candidate.sandboxScriptId,
		executionId: `${input.executionId}-resolve-${i}-${candidateIndex}`,
	})
	.pipe(Effect.either);
```

Parent `executionId` plus two stable loop indices — exactly the shape to copy.
`apps/app-backend/AGENTS.md:71` references this pattern by function name
(`resolveExternalId`/`importEntity`) without naming a file; if it's ever amended to point somewhere
concrete, it should point here — `library-membership/service.ts` has an unrelated, same-named
`importEntity` that is a legitimate top-level dispatch (see the [audit](#library-membership) below),
not an example of parent-derived keying.

### Where this actually goes wrong today

See [the central audit finding](#the-central-finding-a-real-non-deterministic-child-dispatch)
below — a concrete, currently-live instance of the "bad" pattern above.

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

`apps/app-backend/src/lib/workflow.ts` wires:

```ts
export const WorkflowEngineLive = ClusterWorkflowEngine.layer.pipe(
	Layer.provide(
		SingleRunner.layer({
			runnerStorage: "sql",
			shardingConfig: { entityMessagePollInterval: Duration.millis(250) },
		}),
	),
	Layer.provide(WorkflowPgClientLive),
);
```

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
  performance tweak.** Shard locking uses genuine session-scoped Postgres advisory locks held on
  one reserved, sticky connection (`SqlRunnerStorage.ts:35-67`). A connection-rotating proxy
  (transaction-mode PgBouncer, some serverless Postgres proxies) silently breaks shard ownership —
  stated as an explicit breaking-change caveat in the cluster CHANGELOG at `0.51.0`.
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
describe either as a "confirmed bug" the way #6294 is. `apps/app-backend` currently has zero
instances of pattern 1 and one instance of pattern 2 that doesn't need this issue to be justified as
a problem — see the audit below.

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
3. **This codebase's own harness**, `apps/app-backend/src/lib/test-support/effect.ts`:
   `makeWorkflowEngine(overrides)` stubs every `WorkflowEngine` method to `Effect.die("unused")`
   by default; `makeWorkflowActivityEngine(instance)` additionally runs a given activity's
   `execute` directly in-process. **`execute` (real child-workflow dispatch) is never overridden by
   this helper** — it stays `Effect.die("unused")` unless a test supplies its own. Every
   workflow-body test in this codebase sidesteps this by mocking `EventsService`/
   `CollectionsService` at the service boundary instead of letting real child-workflow dispatch run.
   That's a reasonable choice for unit-testing orchestration logic, but it means **the real
   `queueCollectionEvent → EventCreateWorkflow.execute` chain — and the bug below — is invisible to
   the existing test suite structurally, not just by oversight.**

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

## External GitHub usage audit

This pass searched live public GitHub usage, not just upstream source. Four read-only subagents
cloned fresh copies of candidate repos under temporary directories and audited actual source usage
for `@effect/workflow`, `effect/unstable/workflow`, `Workflow.make`, `Activity.make`,
`WorkflowEngine`, `ClusterWorkflowEngine`, `SingleRunner`, `DurableClock`, `DurableDeferred`, and
`DurableQueue`. GitHub code search was intermittently rate-limited and returned transient 5xx
responses, so treat this as a strong sample rather than an exhaustive census.

The main conclusion is uncomfortable but useful: public app usage is still sparse, young, and noisy.
There are good patterns to copy, but there are also multiple production-looking repos with
non-deterministic `idempotencyKey` or `executionId` construction. Do not cite a repo as a "known good"
example just because it depends on `@effect/workflow`.

Some high-quality examples import `effect/unstable/workflow` instead of `@effect/workflow`. Those
are still useful because they exercise the same unstable workflow API family, but this guide labels
them as adjacent examples rather than direct package consumers.

### High-signal usage worth learning from

| Repo | What looks good | Caveat |
|---|---|---|
| [`CapSoftware/Cap`](https://github.com/CapSoftware/Cap/tree/08839cf520f5d4b54f056ed26b339abe308622e6) | A small, direct package example: `Loom.ImportVideo` keys execution by stable payload fields (`userId`, Loom org/video id, attempt) ([workflow](https://github.com/CapSoftware/Cap/blob/08839cf520f5d4b54f056ed26b339abe308622e6/packages/web-domain/src/Loom.ts#L45-L67)), and wraps URL validation, DB record creation, and S3 download/upload in activities ([handler](https://github.com/CapSoftware/Cap/blob/08839cf520f5d4b54f056ed26b339abe308622e6/packages/web-backend/src/Loom/ImportVideo.ts#L17-L167)). | The S3 upload is still one streaming activity, so retry safety depends on deterministic object keys/overwrite semantics. Good simple identity example; not a complete template for large partial writes. |
| [`baptisteArno/typebot.io`](https://github.com/baptisteArno/typebot.io/tree/ef1b4c67c520ff00018db709620dc101f717e9ac) | Adjacent `effect/unstable/workflow` example with pure payload keys for export/user workflows ([export key](https://github.com/baptisteArno/typebot.io/blob/ef1b4c67c520ff00018db709620dc101f717e9ac/packages/results/src/workflows/exportResultsWorkflow.ts#L87), [user key](https://github.com/baptisteArno/typebot.io/blob/ef1b4c67c520ff00018db709620dc101f717e9ac/packages/user/src/workflows/startUserOnboardingWorkflow.ts#L21)), real `DurableClock.sleep` ([sleep](https://github.com/baptisteArno/typebot.io/blob/ef1b4c67c520ff00018db709620dc101f717e9ac/packages/user/src/workflows/startUserOnboardingWorkflow.ts#L40)), `Activity.retry` ([retry](https://github.com/baptisteArno/typebot.io/blob/ef1b4c67c520ff00018db709620dc101f717e9ac/packages/results/src/workflows/exportResultsWorkflow.ts#L154), [retry](https://github.com/baptisteArno/typebot.io/blob/ef1b4c67c520ff00018db709620dc101f717e9ac/packages/results/src/workflows/exportResultsWorkflow.ts#L233)), and child workflow dispatch from workflow code ([dispatch](https://github.com/baptisteArno/typebot.io/blob/ef1b4c67c520ff00018db709620dc101f717e9ac/packages/results/src/workflows/exportResultsWorkflow.ts#L269)). | Email sends are activity-wrapped but do not appear to pass provider idempotency keys, and `SendExportToEmailWorkflow` keys by export id rather than recipient email ([key](https://github.com/baptisteArno/typebot.io/blob/ef1b4c67c520ff00018db709620dc101f717e9ac/packages/results/src/workflows/exportResultsWorkflow.ts#L251-L312)). |
| [`PREreview/prereview.org`](https://github.com/PREreview/prereview.org/tree/0e3c1454499afca3795aee445b812ef812421785) | Real app workflows use pure payload ids for author invite, dataset review, and review request executions ([author](https://github.com/PREreview/prereview.org/blob/0e3c1454499afca3795aee445b812ef812421785/src/AuthorInvites/Workflows/index.ts#L15), [dataset](https://github.com/PREreview/prereview.org/blob/0e3c1454499afca3795aee445b812ef812421785/src/DatasetReviews/Workflows/index.ts#L17), [request](https://github.com/PREreview/prereview.org/blob/0e3c1454499afca3795aee445b812ef812421785/src/ReviewRequests/Workflows/index.ts#L18)), and review-request flows show `DurableClock.sleep` plus `Activity.retry` in ordinary domain code ([sleep/retry](https://github.com/PREreview/prereview.org/blob/0e3c1454499afca3795aee445b812ef812421785/src/ReviewRequests/Workflows/index.ts#L65-L119)). | Not a clean side-effect-idempotency model: Zenodo/Slack/email/COAR activities can perform an external action before recording the local marker, and one COAR notify path generates a fresh UUID inside the activity ([COAR](https://github.com/PREreview/prereview.org/blob/0e3c1454499afca3795aee445b812ef812421785/src/PreprintReviews/Workflows/NotifyPreprintServer.ts#L51)). |
| [`gurdasnijor/firegrid`](https://github.com/gurdasnijor/firegrid/tree/eda2d76661730372b815524bd17b3854a9b19130) | Advanced example with mostly domain-derived keys for runtime/session/permission/tool workflows ([scheduled prompt](https://github.com/gurdasnijor/firegrid/blob/eda2d76661730372b815524bd17b3854a9b19130/packages/runtime/src/unified/subscribers/scheduled-webhook-peer.ts#L43-L48), [tool dispatch](https://github.com/gurdasnijor/firegrid/blob/eda2d76661730372b815524bd17b3854a9b19130/packages/runtime/src/unified/subscribers/permission-and-tool.ts#L213-L218)) and a custom engine that persists final results, activities, `DurableDeferred`, and `DurableClock` state ([engine](https://github.com/gurdasnijor/firegrid/blob/eda2d76661730372b815524bd17b3854a9b19130/packages/runtime/src/engine/internal/engine-runtime.ts#L327-L568)). | Do not copy it as a beginner template: it has a clock-derived fallback key when a public prompt caller omits an idempotency key ([fallback](https://github.com/gurdasnijor/firegrid/blob/eda2d76661730372b815524bd17b3854a9b19130/packages/runtime/src/unified/channel-bindings.ts#L116-L128)) and custom engine complexity. |

### Bad or risky patterns found in the wild

| Pattern | Examples | Why it matters |
|---|---|---|
| `idempotencyKey` reads the clock instead of projecting from payload | `HazelChat/hazel`'s `CleanupUploadsWorkflow` uses `new Date()` inside `idempotencyKey` ([source](https://github.com/HazelChat/hazel/blob/f033d6058021f0cac6a4e461c902122eab32ed91/packages/domain/src/cluster/workflows/cleanup-uploads-workflow.ts#L15)); `FaithBase-AI/openfaith` has clock-based keys across most workflow definitions, including `createOrgWorkflow` ([source](https://github.com/FaithBase-AI/openfaith/blob/ee1e1a7634caa01d246af56033fd841aa1b9cda9/backend/workers/workflows/createOrgWorkflow.ts#L26)); `fahad-islam/lawfirm-data-pipeline` uses `new Date().toISOString()` in two workflow keys ([sync](https://github.com/fahad-islam/lawfirm-data-pipeline/blob/0d1d8aca5adca88098bf339df7c326d2b26d4b18/src/workflows/syncCrmPlaceDetail/workflow.ts#L15), [scraper](https://github.com/fahad-islam/lawfirm-data-pipeline/blob/0d1d8aca5adca88098bf339df7c326d2b26d4b18/src/workflows/placeWebsiteScraper/workflow.ts#L19)). | The high-level `.execute()` path hashes `workflow.name` plus `idempotencyKey(payload)`. If the key function is non-deterministic, retrying the same logical request does not coalesce. |
| Event or extension dispatch manufactures identity from clock/random | `kiritocode1/chronos` builds `executionId` with `Date.now()` at dispatch time ([dispatch](https://github.com/kiritocode1/chronos/blob/97dde0281c2ae742098e3d83b032b6f40019c1c0/src/workflows/dispatch.ts#L18-L46)); `Eventiva/Eventiva` creates missing message ids from `Date.now()` and `Math.random()` before `workflow.execute` ([pubsub](https://github.com/Eventiva/Eventiva/blob/527412e77694fa5438f22e55617d2607b6388c7f/packages/core/src/extensions/extension-hook-pubsub.ts#L82-L125), [execute](https://github.com/Eventiva/Eventiva/blob/527412e77694fa5438f22e55617d2607b6388c7f/packages/core/src/extensions/extension-hooks.ts#L114-L116)). | This is fine only for a truly fresh one-shot job. It is wrong for cron/event-source dispatch where the same source event or schedule tick might be retried; derive from the source event id or scheduled tick instead. |
| Bare side effects in workflow bodies | `chronos` runs bash/webhook work in activities, then performs notification inserts directly after them ([notifications](https://github.com/kiritocode1/chronos/blob/97dde0281c2ae742098e3d83b032b6f40019c1c0/src/notifications/repo.ts#L48)); `Eventiva` runs hook publishes and arbitrary extension effects directly in the workflow body ([source](https://github.com/Eventiva/Eventiva/blob/527412e77694fa5438f22e55617d2607b6388c7f/packages/core/src/extensions/extension-hooks.ts#L95-L109)). | On workflow replay, those writes/effects can run again. Wrap them in an activity or make them deterministic-upsert/idempotent writes. |
| A single long activity performs many externally-visible writes | `simple-rag` emits streaming LLM chunks from one activity and appends events with fresh random ids ([activity](https://github.com/arm-learning/simple-rag/blob/44c3ce5a6ba1ca09036d435af0f5dd701379229d/apps/cluster-runner/src/workflows/generate-message.ts#L291-L337), [append](https://github.com/arm-learning/simple-rag/blob/44c3ce5a6ba1ca09036d435af0f5dd701379229d/apps/cluster-runner/src/append-event.ts#L34-L56)); `pawelblaszczyk5/bella` has a long streaming message activity whose dedupe depends on hidden streamed-part handling ([source](https://github.com/pawelblaszczyk5/bella/blob/1852798602b84f1187f6c07f8e3b1e230a7c4483/apps/cluster-runner/src/generate-message.ts#L40-L54)); `lawfirm-data-pipeline` loops through scraped results and creates DB rows inside one retried activity ([source](https://github.com/fahad-islam/lawfirm-data-pipeline/blob/0d1d8aca5adca88098bf339df7c326d2b26d4b18/src/workflows/placesLocator/activities/extractGooglePlaces.ts#L292-L358)). | `Activity.make` memoizes only after the activity completes. If the fiber/process is interrupted after the 50th write but before completion is recorded, the activity body can run again from the start. Long activities that partially commit need their own idempotency strategy. |
| Using `WorkflowEngine.layerMemory` in real runtime wiring | `0rdep/opencode-atlassian` has substantial workflow code but wires the app runtime to `WorkflowEngine.layerMemory` ([workflow](https://github.com/0rdep/opencode-atlassian/blob/0e2d62741688487d68269fa6f5824feb462ba921/src/workflows/TaskWorkflow.ts#L159-L181), [runtime](https://github.com/0rdep/opencode-atlassian/blob/0e2d62741688487d68269fa6f5824feb462ba921/src/index.ts#L47-L54)). | Memory engines are fine for tests and demos. They are not durable across process restarts, so citing them as production durability examples is misleading. |
| Using `@effect/workflow` names for a custom non-durable bridge | `smithersai/smithers` constructs `DurableDeferred` values, but its bridge await/resolve functions ignore the deferred argument and store completions in an in-memory `Map` ([bridge](https://github.com/smithersai/smithers/blob/af9415908c7a4de368f9367dfbe7efe8737fe9b8/packages/engine/src/effect/durable-deferred-bridge.js#L114-L178)). | That may be a deliberate local adapter, but it is not an example of using `DurableDeferred.await` / `succeed` / `done` correctly. Do not cite it as a durable-deferred pattern. |
| Hallucinated or stale API names spreading into docs/comments | `arm-learning/simple-rag` has commented-out `Activity.executionIdWithAttempt` ([source](https://github.com/arm-learning/simple-rag/blob/44c3ce5a6ba1ca09036d435af0f5dd701379229d/apps/cluster-runner/src/email-verification-live.ts#L16-L23)); `openfaith` docs show stale-looking `Activity.execute` / `handler` shapes ([docs](https://github.com/FaithBase-AI/openfaith/blob/ee1e1a7634caa01d246af56033fd841aa1b9cda9/docs/syncEngine/07-durable-workflows-in-practice.md#L51)). | These symbols/shapes do not match the package version this guide targets. Treat repo-local AI/docs files as low trust unless they compile. |

### Other cloned repos and classifications

| Repo | Commit audited | Classification |
|---|---|---|
| [`HazelChat/hazel`](https://github.com/HazelChat/hazel/tree/f033d6058021f0cac6a4e461c902122eab32ed91) | `f033d6058021f0cac6a4e461c902122eab32ed91` | Mixed/risky adjacent example. It has several good payload-derived keys, but also a `new Date()` workflow key, clock-bucketed RSS cron identity, and RSS posting that records dedupe after message inserts. |
| [`arm-learning/simple-rag`](https://github.com/arm-learning/simple-rag/tree/44c3ce5a6ba1ca09036d435af0f5dd701379229d) | `44c3ce5a6ba1ca09036d435af0f5dd701379229d` | Risky/negative overall despite pure workflow keys: random event ids and streaming event appends inside one activity make retries duplication-prone. Its document embedding path has useful deterministic ids and `onConflictDoNothing`, but the repo is not a clean positive example. |
| [`pawelblaszczyk5/bella`](https://github.com/pawelblaszczyk5/bella/tree/1852798602b84f1187f6c07f8e3b1e230a7c4483) | `1852798602b84f1187f6c07f8e3b1e230a7c4483` | Mixed. `GenerateMessage` keys by conversation plus assistant message id; `IngestKnowledge` keys by `payload.time.epochMillis`, which may be a schedule tick or may be "now" because the caller is not visible. |
| [`Eventiva/Eventiva`](https://github.com/Eventiva/Eventiva/tree/527412e77694fa5438f22e55617d2607b6388c7f) | `527412e77694fa5438f22e55617d2607b6388c7f` | Negative. Missing message ids collapse to `extensionId-phase` or are generated from `Date.now()`/`Math.random()`, and hook effects run bare in workflow bodies. |
| [`smithersai/smithers`](https://github.com/smithersai/smithers/tree/af9415908c7a4de368f9367dfbe7efe8737fe9b8) | `af9415908c7a4de368f9367dfbe7efe8737fe9b8` | Mixed. Good deterministic bridge/activity key construction and real `SingleRunner`/child-workflow plumbing, but its `DurableDeferred` bridge is in-memory and some CLI run ids use `Date.now()`. |
| [`bsamiee/Parametric_Portal`](https://github.com/bsamiee/Parametric_Portal/tree/59f34e325cef50c5b758ce6f41cedb52173d587b) | `59f34e325cef50c5b758ce6f41cedb52173d587b` | Promising positive from spot audit: real clustered workflow usage with activities, retry, and compensation. Needs a deeper side-effect-idempotency pass before being promoted to a primary example. |
| [`imkesin/one-kilo`](https://github.com/imkesin/one-kilo/tree/e27c038f20da2c8fadc0ef4f8b5d3e42d1a606d9) | `e27c038f20da2c8fadc0ef4f8b5d3e42d1a606d9` | Promising positive/mixed from spot audit: production-shaped clustered workflow; `WorkflowEngine.layerMemory` appears limited to a test HTTP layer. |
| [`creatifcoding/gbg`](https://github.com/creatifcoding/gbg/tree/b6fc855cb533125f88747d7f4ecb28c985258710) | `b6fc855cb533125f88747d7f4ecb28c985258710` | Promising advanced example for `DurableDeferred` and `DurableClock` in a real alarm lifecycle. Windows checkout had an invalid-path caveat, so the audit used cloned Git objects. |
| [`abdul-hamid-achik/blankcode`](https://github.com/abdul-hamid-achik/blankcode/tree/1065e8a961f3ba35159a226b82d3c0cc2a9c9424) | `1065e8a961f3ba35159a226b82d3c0cc2a9c9424` | Mixed: SQL-backed `SingleRunner` plus a real submission workflow, but one workflow is currently a stub. |
| [`nickcomua/4chat`](https://github.com/nickcomua/4chat/tree/2812b9f478cf6f9d586d907b8cc6f44091e13894) | `2812b9f478cf6f9d586d907b8cc6f44091e13894` | Mixed/risky: real clustered SQL setup, but on very old `@effect/workflow` `^0.2.2`; `DurableClock`/`DurableDeferred` imports were unused. |
| [`Mufraggi/cine_app`](https://github.com/Mufraggi/cine_app/tree/6ea7db843988a4533c0590dee2247be03dcd42de) | `6ea7db843988a4533c0590dee2247be03dcd42de` | Mixed/demo: cluster-backed workflow fan-out, but package manifests use `"latest"`, so examples are not reproducible. |

Explicit repro/playground/article repos are lower-trust for guidance: `bismuth1991/effect-workflow-repro`,
`pawelblaszczyk5/effect-workflow-cluster-playground`, `Mufraggi/etl-effect-cluster-article`, and
example/test-only usages such as [`semyenov/n2`](https://github.com/semyenov/n2/tree/6995f3d5df3faead2dc20946a4fbb9cb26bf08ca).
Package-only hits, planned wrappers, docs-only corpora, and vendored upstream copies were excluded
from correctness conclusions. Examples: `graffle-js/graffle` was package-only; `fourcolors/luna`
had internal/planned wrapper types but no live package import; `mpsuesser/pi-effect-harness` was a
docs/skill corpus; partial clone attempts for `livestorejs/livestore` and `ComposioHQ/composio`
timed out before a usable `HEAD`.

### What the external audit changes in this guide

- `idempotencyKey` must be a pure projection of payload. Never call `Date.now()`, `new Date()`,
  `crypto.randomUUID()`, `generateId()`, or read mutable external state inside it.
- For event/cron dispatch, the workflow key should be derived from the source event id, business id,
  or scheduled tick. A fresh random id is only for a user-initiated "start a new job now" command.
- Activity boundaries are completion-memoization boundaries, not transaction boundaries. If an
  activity performs many writes or emits a stream of events, make every write idempotent or split
  the work into smaller deterministic activities.
- Treat public docs in application repos (`CLAUDE.md`, generated guides, comments) as low-trust
  unless they compile against the real package. Several live repos contain plausible-sounding but
  wrong guidance.

---

## Audit: how this codebase measures up today

This section is the result of reading every file in `apps/app-backend` that references
`@effect/workflow` against the ground truth above. Most of the codebase is in good shape — the
sandbox, entity-translation, and entity-schemas/saved-views modules in particular are clean,
consistent reference examples. This section focuses on what isn't.

### The central finding: a real non-deterministic child dispatch

**`apps/app-backend/src/modules/collections/service.ts`'s `queueCollectionEvent`**
(`collections/service.ts:95-115`) calls `EventsService.create(...)` with **no `executionId`
field set at all**:

```ts
// events/workflows.ts:27-41 (for reference — this is what receives the omitted field)
const withExecutionId = (input: EventCreateWorkflowInput) => ({
	...input,
	executionId: input.executionId ?? generateId(),
});

export const enqueueEventCreate = (input: EventCreateWorkflowInput) =>
	EventCreateWorkflow.execute(withExecutionId(input), { discard: true });
```

`EventCreateWorkflowInput.executionId` is optional; omitting it falls back to a random
`generateId()`. That's entirely correct for a fresh top-level call (e.g. a plain `POST /events`)
— but `queueCollectionEvent` is reached from
**`apps/app-backend/src/modules/imports/media/workflow-writing.ts:192-201`**, where
`CollectionsService.addToCollection` runs **inside an `Activity.make(...)`** during an
already-running parent workflow (the media-import write phase, and — via shared code — the
integrations pipeline too):

```ts
// workflow-writing.ts:192-201
Activity.make({
	success: EnsureLibraryMembershipOutcome,
	name: `add-collection-membership-${i}-${membershipIndex}`,
	execute: collections.addToCollection(user, { entityId, collectionId: collectionId.right, properties: {} }).pipe(...),
})
```

This fires only when the collection has an "add" trigger event schema configured and the
membership was newly inserted — so it's data-dependent, not universal — but when it fires, it's a
concrete, solid instance of the pattern this guide warns against, and it doesn't need the
contested #6014 issue to justify it: **`Activity.make` retries on interruption by default**
(the `interruptRetryPolicy` default in the [field table](#defining-an-activity) above). Any
interrupted retry of this Activity re-runs its whole `execute` body, calling
`queueCollectionEvent` again — generating a *new* random `executionId` and dispatching *another*
child `EventCreateWorkflow` each time, while any previously-dispatched (now orphaned) child may
still be in flight or may have already completed. That's a duplicate-side-effect risk from a
solidly-confirmed mechanism, independent of whether the more exotic nested-suspend theory in
#6014 is real.

This is invisible to the existing test suite for the structural reason described in
[Testing](#testing) above: `CollectionsService`/`EventsService` are mocked at the boundary in
every workflow-body test, so the real dispatch chain never runs during tests.

**For contrast**, three other call sites use the same `EventsService.create` primitive
differently:

| Call site | Activity-wrapped? | Deterministic id? |
|---|---|---|
| `imports/media/workflow-writing.ts:339-354` (event-progress writes) | No — direct in workflow body | Yes — `` `${input.executionId}-event-${i}-${eventIndex}` `` |
| `imports/workout/processor.ts:161-167`, via `workout/workflow.ts:86-99` | **Yes** | Yes — `` `${payload.runId}-workout-${index}` `` |
| `collections/service.ts:102-114` (`queueCollectionEvent`, above) | **Yes** | **No** — field omitted entirely |
| `events/event-creation.ts` (`RunSandboxWorkflow` dispatch, from inside `EventCreateWorkflow`'s own body) | No — direct in body | Yes |

The first and last rows are the correct shape per this guide. The workout case is "half right" —
deterministic id, but still Activity-nested, which per the (weaker-evidence) #6014 theory could
still be worth moving outside the Activity defensively even though its id is fine. The
`queueCollectionEvent` case is the one that's wrong on a solidly-confirmed basis and worth fixing:
either give `queueCollectionEvent` a deterministic `executionId` derived from the collection
membership write it's part of, or move the event-creation call out of the wrapping Activity (or
both).

### Other findings

- **Bare-but-idempotent write**: `events/event-creation.ts:320-332` inserts a new event row
  directly in `EventCreateWorkflow`'s body (not Activity-wrapped) — but the insert uses a
  deterministic id (`` `${executionId}-event-${itemIndex}` ``) with `.onConflictDoNothing()` plus
  a read-back on conflict (`events/repository.ts:108-146`). That's a legitimate *alternative* to
  Activity-wrapping — deterministic-upsert instead of RPC-memoization — but it's easy to mistake
  for a violation of the "wrap bare side effects" rule at a glance. Worth knowing this codebase
  uses both strategies, deliberately, in different places.
- **Bare reads**: a handful of DB reads inside `EventCreateWorkflow`'s body
  (`event-creation.ts:92-95,255-260`) are unwrapped. Not a duplicate-write risk, but a
  replay-drift risk — a resumed workflow could observe different data (e.g. edited trigger
  config) than the original attempt saw. Low severity, worth knowing about.
- **`DurableQueue.process(...)` called bare in workflow bodies** — this pattern recurs in nearly
  every module (sandbox script dispatch, mainly). It is **correct**, not a violation; see the
  [durable primitives table](#durable-primitives-beyond-activity) above.
- **No bare finalizers**: grepped every workflow-adjacent file in the codebase for
  `addFinalizer`/`Effect.ensuring`/`Effect.onExit`/`Effect.acquireRelease` — zero hits. The
  [compensation-vs-finalizers](#compensation-vs-plain-finalizers) gotcha isn't currently live
  anywhere here.
- **Testing gaps**: `entity-translation`'s workflow has no dedicated test file;
  `library-membership`'s `LibraryEntityImportWorkflow` body has no `workflows.test.ts` (only
  exercised indirectly via `entity-import/workflows.test.ts`); `SavedViewsService
  .createDefaultForSchema` (the `DefaultSavedViewQueue` worker's handler) has no test coverage.
  None of these are wrong code, just untested code.
- **`workflow-boundaries.test.ts`** (`sandbox/workflow-boundaries.test.ts`) is a source-text
  conformance test — it asserts which files are allowed to import `WorkflowEngine` or call
  `RunSandboxWorkflow`/`EventsRepository` directly, enforcing real architectural boundaries. It's
  a good pattern, but it checks *which module* is imported, not *what arguments* are passed — it
  structurally cannot catch the `queueCollectionEvent` finding above, since that's an
  argument-correctness issue, not a boundary violation.

#### Library-membership

`library-membership/service.ts`'s `importEntity` (line 33) is a **top-level, HTTP-route-triggered**
dispatch — one user click, one job, correctly using `generateId()` since there's no parent workflow
and no loop. It shares a name with, but is functionally unrelated to, the
`imports/media`-`workflow-population.ts`/`workflow-resolution.ts` pattern referenced in
[Determinism](#determinism-and-child-workflows) above. Both are correct for what they each actually
do; they just aren't the same pattern despite the shared name.

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
