# Workflow engine

`PostgresWorkflowEngine` (`engine.ts`) implements Effect's `WorkflowEngine` on two tables owned by
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
