# Workflow engine

`PostgresWorkflowEngine` (`engine.ts`) implements Effect's `WorkflowEngine` on tables owned by
`WorkflowEngineStore` (`engine-store.ts`). Workflow code uses `Workflow`, `Activity`,
`DurableDeferred`, `DurableClock` and `DurableQueue` unchanged. Every workflow is registered through
`implementWorkflow`, which attaches the JSON codecs the engine persists payloads and results with.

## Storage

- `workflow_execution`: one row per execution, with its encoded payload, final result, root and
  parent, status, suspension, and owning process.
- `workflow_step`: one row per completed activity attempt, deferred completion, or armed durable
  clock. The first write of a key wins.
- `workflow_runner`: one heartbeat row per engine process.

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

## Ownership

Each process owns the executions it starts and renews one lease for all of them. A sweep claims
active executions without an owner or whose owner's lease lapsed and resumes them, except runs that
suspended after a failure, which wait for an explicit resume. A step written for an execution
another live process owns calls `pg_notify` on `ryot_workflow` in the same statement; each process
listens on one connection and wakes the executions it owns. Completion publishes on
`WorkflowExecutionNotifications` for waiters outside the engine.

## Accounts

An execution may work for one account generation, stored on its row (`account.ts`). A caller names it
by providing `WorkflowAdmissionAccount` around `execute`; otherwise a child inherits its parent's.
Admission checks the generation in its insert statement: the user row must hold that token and not be
stamped as retiring for it, read `FOR SHARE` so a concurrent retirement is seen. A fenced admission dies
with `WorkflowAccountRejected`, since Effect's `execute` has no admission error. `WorkflowAccounts`
binds a running execution admitted without an account to one, and lists an account's active
executions so retirement can interrupt them.

## Fair queue

`fairQueueStoreLayer` (`fair-queue-store.ts`) backs `DurableQueue` with Redis. Each process caps its
claims at a total, of which a share may be background. Interactive work is claimed first, but waiting
background work with none running takes the next claim after four interactive ones. Within a lane, claims rotate across tenants, then
across plugins within a tenant. Each item carries an urgency, and a flow yields `awaited` items
before `continuation` items, and both before `fresh` ones, FIFO within each. For sandbox runs,
`awaited` is a policy or required hook that a write waits on under a deadline, and `continuation` is a
replay or a recovery attempt.
