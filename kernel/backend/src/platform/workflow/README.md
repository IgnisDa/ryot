# Workflow engine

`PostgresWorkflowEngine` (`engine.ts`) implements Effect's `WorkflowEngine` on tables owned by
`WorkflowEngineStore` (`engine-store.ts`). Workflow code uses `Workflow`, `Activity`,
`DurableDeferred` and `DurableClock` unchanged. Every workflow is registered through
`implementWorkflow`, which attaches the JSON codecs the engine persists payloads and results with.

## Storage

- `workflow_execution`: one row per execution, with its encoded payload, final result, root and
  parent, status, and suspension.
- `workflow_step`: one row per completed activity attempt, deferred completion, or armed durable
  clock. The first write of a key wins.

Encoded values are stored as `json`, which keeps their text: replays compare some results byte for
byte, and `jsonb` would reorder object keys.

Store statements run on their own pooled connections, never inside a caller's transaction. Every
step write and every child admission locks the tree's root row `FOR KEY SHARE`, which the root's own
status updates do not wait on, and writes nothing once the root has expired; tree expiry takes the
root `FOR UPDATE`.

## Execution

The in-memory state machine follows Effect's `layerMemory` engine. Each run gets a fresh scope, so
replays rebuild finalizers and compensations. A run reads persisted steps only when an execution is
loaded by a process that did not start it. A run that completes one of its own deferreds without
awaiting it is not woken; it reads the result from its cache if it awaits it later.

Long executions run each chunk of work under `inWorkflowStepScope`, then call `forgetWorkflowSteps` once
something durable lets a replay skip that chunk. The chunk's activities leave storage and memory, so
loading the execution stays bounded by the current chunk. Scopes stop at workflow boundaries.

## Ownership

One backend process owns the database, enforced before migrations or workers start by
`DatabaseOwner`. Each workflow registration recovers its active executions in pages. Runs suspended
after a failure wait for an explicit resume; waiting runs restore their durable clocks and deferreds.
Wakes reach the in-memory activation directly. Completion publishes on
`WorkflowExecutionNotifications` for waiters outside the engine. There are no process leases,
heartbeats, or cross-process workflow wake-ups.

## Accounts

An execution may work for one account, stored on its row (`account.ts`). A caller names it
by providing `WorkflowAdmissionAccount` around `execute`; otherwise a child inherits its parent's.
Admission checks the account in its insert statement: the user row must exist and not be stamped as
retiring, read `FOR SHARE` so a concurrent retirement is seen. A fenced admission dies
with `WorkflowAccountRejected`, since Effect's `execute` has no admission error. `WorkflowAccounts`
binds a running execution admitted without an account to one, and lists an account's active
executions so retirement can interrupt them.
