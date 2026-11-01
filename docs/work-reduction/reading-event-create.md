# Code reading: one public event create

Estimates from reading code at `080c70cc58`, not measurements; the flow probes verify them.
Paths are relative to `kernel/backend/src/`.

## Engine costs under everything

- Every activity or deferred step is a persisted cluster message. Message inserts fire
  `ryot_cluster_message_fence` (`platform/db/workflow-message-fence.ts`), which takes `FOR SHARE` on the
  tree's root `workflow_execution` row. Each reply is its own transaction taking `FOR UPDATE` on that
  root (`modules/garbage-collection/workflow-storage.ts`, `workflow-repository.ts`). All completions
  in one workflow tree therefore serialize on one row.
- Workflow bodies re-execute from the top on every resume; database work outside activities repeats.
- `lockCatalog` costs about 5 + P round trips per transaction (one advisory lock statement per active
  plugin, `modules/automations/planner-resolver.ts`); its cache lives for one transaction.
- `admitAccount` (user row `FOR SHARE` plus retirement query) runs in almost every receipts call
  (`modules/mutations/receipts.ts`), about 10 times per create.

## Steps (one item, no hooks)

HTTP: `peekBatch` tx → `registerWorkflow` tx → durable start of `EventCreateWorkflow` (`discard`) →
wait on notification (500 ms fallback, 35 s cap) → `peekBatch` tx again.

`EventCreateWorkflow` body: `admitWorkflow` (second owner registration) → receipt peek → activity
`admit-event-batch` (≈12 + P statements incl. batch advisory lock and batch-decision receipt) →
activity `prepare-events-0` → child workflow `PolicyBatchWorkflow` even with zero policies (activities
`plan` with another catalog lock, and `validate-final-drafts`, which does no database work) → activity
`commit-events-0` (≈35–45 statements: replay lookups, 4× account admission, 2× catalog lock, reference
and stream locks, batch re-check, insert, scope/stream touches, change-trigger planning, receipts,
group validation) → dispatch (no-op) → activity `seal-event-batch` (≈10 statements) → activity
`record-event-operation` → run reply + Redis publish.

## Estimated totals

| Scenario | DB round trips | Workflows | Activities | Cluster rows |
| --- | --- | --- | --- | --- |
| No hooks, no projection | 150–200 | 2 | 7 | ≈18 |
| One async after-hook + one projection | 400–550 | 6 | 20–22 | 60–70, plus 2 suspend/resume body replays, 2 sandbox runs |

Four `mutation_receipt` rows (owner, batch decision, item, operation) and two `workflow_execution` rows
per no-hook create.

With an after-hook: `AutomationRunWorkflow` → `ScriptExecutionWorkflow` (owner registered 3 times
across dispatch, body, pin; sandbox through `DurableQueue` with a Redis fair queue polled every 25 ms;
each durable host call adds a deferred and a sandbox replay). With a projection: admission inside the
source transaction (binding, account lock, queued-job share lock, `background_work` insert) and
`BackgroundWorkWorkflow` (start, prepare, script child, publish ≈20 statements, finish).

## Latency sources tied to timers

- Frequent cron defaults to every 5 minutes. After-hook retries, lost first attempts (after 35 s),
  lost background dispatch, and projection rebinding wait for it.
- Cluster `entityReplyPollInterval` 200 ms and `entityMessagePollInterval` 10 s mostly matter for
  recovery; local delivery is direct.
- Sandbox fair queue polls every 25 ms.

## Wasteful-by-design candidates

1. A durable parent plus child workflow and 7 activities for a one-row insert; `PolicyBatchWorkflow`
   runs with zero policies.
2. Batch-hook bookkeeping (begin, decision receipt, 3× batch lookup `FOR UPDATE`, seal) for single
   items with no batch hooks.
3. Repeated checks: account admission ≈10×, owner registration 2–3× per workflow, input verification
   before and after, duplicate settle/release.
4. Root-row fencing serializes all completions in a tree.
5. Projection binding and job admission inside the source-write transaction; dispatch in the
   workflow body so it repeats on resume; three nested workflows around each sandbox run.
