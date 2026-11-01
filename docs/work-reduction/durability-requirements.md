# Durability requirements (what the product actually promises)

Derived from tests and READMEs at `080c70cc58`, not from implementation choices. Test paths are
under `e2e/src/api/`.

## Needs a durable step journal

- **Sandbox replay skips completed host calls** after a sidecar or process loss: HTTP, claims,
  event writes, child runs are not re-issued (`kernel/sandbox/sidecar-recovery.test.ts`,
  `durable-tracer.test.ts`, `youtubei-tracer.test.ts`, `kernel/automations/lifecycle-triggers.test.ts`
  "replays …"). This is the sharpest requirement; the journal itself is already a sandbox-owned
  Redis projection rebuilt from durable state.
- **Durable waits** that survive restart: provider rate-limit tickets and slot spacing
  (`global-provider-rate-limiting.test.ts`, `short-wait-replay.test.ts`), matched `Retry-After`.
- **Imports resume a multi-chunk run** after restart with pinned code/config
  (`kernel/imports/durability.test.ts`); progress is mostly per-record receipts plus run state.

## Satisfiable with a persisted row plus idempotent retry (no step journal)

- After-hook runs: already **at-least-once per numbered attempt**, committed with the source write
  and dispatched after commit; retries only for classified infrastructure failures; HTTP hooks must
  carry run-ID idempotency (`kernel/automations/retries.test.ts`, automations README). No test asserts
  exactly-once.
- Required-hook and before-policy waits: an absolute `deadline_at` per wait.
- Mutation receipts / idempotency keys, 14-day window, `SubmissionExpired`.
- Notification and reminder delivery: **at-most-once** via claim rows and `unknown` settlement;
  automatic re-drive would break `kernel/reminders/recovery.test.ts`.
- Background-work scope serialization and recovery; media history correction (checkpoints already
  live in feature tables); import cancellation; account-reset fencing (generation token + an
  interruptible owner registry).

## Incidental

- The 35 s required-hook wait appears only in a TestClock unit test.
- Multi-replica resume is documented but untested.
- No test pins Effect Cluster behavior.

## Consequence for the redesign

General-purpose durable workflows (every step journaled, bodies replayed) are needed by none of
the request paths. The real requirements are: (1) a host-call journal for sandbox executions,
(2) durable timers, (3) job rows with attempts, deadlines, and recovery, (4) receipts. A design built
from those four primitives keeps every tested guarantee.
