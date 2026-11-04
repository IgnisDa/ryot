# Design: commands are one transaction (step 8)

Status: move 1 built (`probesB4`); move 2 built in step 9; move 5 built for event persistence (`probesB10`); moves 3 and 4 proposed. Step 8 of [`order-of-work.md`](order-of-work.md); the direction is in
[`redesign.md`](redesign.md#proposed-moves-in-order).

## What a no-hook event does today

`probesB3`, one event whose schema matches no hook: 136 statements, 28 transactions, 2 workflows. The event row
itself is 4 of them. Grouped by what they serve (the 122 statements of the probe's top list):

| Group | Statements | Source |
| --- | ---: | --- |
| Locks and authority | 61 | Account, plugin and installation checks per transaction, advisory locks, and foreign-key checks for workflow and receipt rows |
| Workflow engine | 25 | `EventCreateWorkflow` and `PolicyBatchWorkflow`: executions, steps, runner leases |
| Definitions | 18 | Event and entity schema reads, repeated per transaction |
| Receipts | 10 | Operation, batch and item receipts, plus batch evidence written and then deleted |
| Event and entity rows | 4 | The write itself |

`EventCreateWorkflow` runs five transactions for it: admit the batch, prepare, plan policies inside a child
`PolicyBatchWorkflow`, commit, seal the batch, record the operation receipt. Each one re-reads the account and
catalog. With no policy matching, nothing in it needs durable replay: every step is a database transaction.

## Moves, in order

Each lands on its own with flow probes.

1. **Direct small creates.** When a create fits one chunk, the request path prepares, plans policies, and, if none
   match, persists, seals the batch and records the receipt in one transaction, then dispatches after commit. A
   create that matches a policy, or is larger than one chunk, keeps the workflow until move 2. The receipt
   identity is unchanged, so a retried command replays its result either way.
2. **Direct policy calls (moved to step 9).** A policy runs as `AutomationRunWorkflow` around a
   `ScriptExecutionWorkflow`, with its durable queue, workflow references and replay journal; calling the sandbox
   directly needs the non-durable executor that step 9 builds, so it lands there. The original proposal: Policies are read-only and patch the draft before commit, so they need a sandbox call
   but no durability. The request calls the sandbox directly, outside the transaction, with the same deadline,
   then commits. This removes `PolicyBatchWorkflow`, the run workflow per policy and the journal, and lets every
   create below the operation threshold take move 1's path.
3. **One receipt per command.** The operation, batch and item receipts become one row holding the result and the
   dispatch, with item outcomes inside it. Batch evidence is kept in memory within the transaction instead of
   written and deleted.
4. **Revisions cached in process.** Plugin revisions, scripts and definitions are immutable by ID, so they are
   cached by revision ID; a transaction checks one guard (account generation and the installation's active
   revision) instead of re-reading authority and the catalog. This also takes the projection input read added in
   step 7 off the per-event path.
5. **Set-based batches.** Prepare, persist and stream admission take the chunk as sets instead of per item: 50
   no-hook events are 1,561 statements today, about 31 per item.
   Built for event persistence: a chunk's creates insert, read back and lock assets in one statement each, and
   `LifecyclePlanner.planChanges` plans the chunk's changes with one stream admission, one projection-input pass
   per plugin and one membership read per user. 50 no-hook events fell to 488 statements. Updates and deletes keep
   their per-row stale checks; relationship and entity commands still plan per item.

Entity and relationship writes go through `UserCommandWorkflow` and follow the same moves after events, since
they share `PolicyBatchWorkflow` and the receipts.

## What stays

- The 35 s pollable operation for oversized creates, as a job.
- After hooks and background work are still dispatched after commit; runs and jobs are persisted queued in the
  source transaction, so a crash after commit leaves them for reconciliation, as today.
- The durable engine for imports, provider fetches, external deliveries and durable sleeps.

## Check

About 25 statements and under 30 ms of database time for a no-hook event, and a 150-set workout save far below
today's 9,917 statements (`probesB3`). The e2e files for events, policies, receipts and operations pass.

## Risks

- **Retries.** A workflow retried an interrupted command from its journal. A direct command either commits with
  its receipt or rolls back, and the client's retry replays the receipt; the API already returns the operation
  identity it needs.
- **Long transactions.** Move 1 holds one transaction for the whole create, where today it is split in five.
  Bounded by the chunk size, and policies stay outside it.
- **Tests that assert workflow names or step counts** for creates will need rewriting.
