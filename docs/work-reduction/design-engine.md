# Design: lean PostgreSQL workflow engine (slice 2)

Replace `ClusterWorkflowEngine` (Effect Cluster with SQL message storage) with a kernel-owned
implementation of `WorkflowEngine.Encoded` (`effect/workflow/WorkflowEngine`). All workflow code
keeps using `Workflow`, `Activity` (`makeActivity`), `DurableDeferred`, `DurableClock` and
`DurableQueue` unchanged.

## What the kernel relies on today

| Feature | Use in `kernel/backend/src` (non-test) |
| --- | --- |
| `execute` | Mostly `discard: true` (75 sites); child workflows awaited inside parents |
| Activities | 131 `makeActivity` sites |
| `DurableClock` | 12 sites: retry backoff, durable sleeps, recovery waits, script `sleep` |
| `DurableDeferred` | Interrupt signal (`platform/workflow/interruption.ts`), sandbox requests, required-hook races (`DurableDeferred.raceAll`) |
| `DurableQueue` | Sandbox execution queue on the kernel's Redis fair-queue store; needs only `deferredDone` from the engine |
| `poll`, `interrupt`, `interruptUnsafe`, `resume` | 13, 8, 1, 1 sites |
| `Workflow.addFinalizer` | 7 sites |

Kernel semantics layered on Cluster storage
(`modules/garbage-collection/workflow-storage.ts`, `workflow-repository.ts`,
`platform/db/workflow-message-fence.ts`):
- **Admission.** A `run` request inserts the `workflow_execution` row, inheriting the parent's root
  from the payload's parent key.
- **Expiry fence.** Any message (activity, deferred, clock) for a tree whose root has expired dies
  with `WorkflowExecutionExpired`. A message for an execution without a row fails as unadmitted.
- **Completion.** A final `run` reply marks the row `succeeded` or `failed` with `completed_at`,
  then publishes on `WorkflowExecutionNotifications` (Redis) for external waiters.
- **GC.** `expireTrees` expires a completed tree after 24 h (168 h if any member failed) when none
  of its messages is unprocessed; `WorkflowGarbageCollector` then clears its storage.

Cluster costs that disappear:
- Per message: an insert with the fence trigger (a root `FOR SHARE`), a reply insert, a processed
  update, and a reply transaction with a root `FOR UPDATE`.
- Per process: 300-shard lock refresh, runner heartbeat, and storage polling every 10 s.

## Storage

- **`workflow_execution`** (existing) gains:
  - `payload jsonb`, the encoded payload, so a recovery can rerun the body;
  - `parent_workflow_name` and `parent_execution_id`, for parent wake-ups;
  - `result jsonb`, the encoded final `Workflow.Result`;
  - `interrupted boolean`.
  - `shard_id` goes away.
- **`workflow_step`** (new): `(workflow_name, execution_id, kind, name, attempt, exit jsonb,
  created_at)`, primary key `(workflow_name, execution_id, kind, name, attempt)`.
  - `kind` is `activity`, `deferred` or `clock`.
  - A `clock` row carries `fire_at` and has a null `exit` until it fires.
- **Dropped:** `cluster_messages`, `cluster_replies`, `cluster_locks`, `cluster_runners` and the
  `ryot_cluster_message_fence` trigger.

Every step write is one statement that also enforces the expiry fence:

```sql
insert into workflow_step (...)
select ... from workflow_execution e
join workflow_execution root on root.workflow_name = e.root_workflow_name
  and root.execution_id = e.root_execution_id
where e.workflow_name = $1 and e.execution_id = $2 and root.expired_at is null
for share of root
on conflict do nothing
returning 1
```

No row returned means expired (or unadmitted): die with `WorkflowExecutionExpired`, as today.

## Execution

The state machine is Effect's `layerMemory` engine (`WorkflowEngine.ts`, about 270 lines): per
execution a fiber, wake modes, safe and unsafe interrupts, a scope per run so replays rebuild
finalizers, and parent wake-up on child completion. Persistence is added at these points:

| Operation | Persistence |
| --- | --- |
| `execute` | Insert the execution row (`on conflict do nothing`) with root and parent. Inserting under an expired parent root dies. A completed row returns its stored result. Otherwise start the run if it isn't already running in this process. |
| run start | First run: no reads. Resume after a restart: one query loads all step exits of the execution into memory. |
| `activityExecute` | Look up the in-memory step cache. On a miss, execute, then insert the step (fenced). A crash between the activity's side effects and the insert reruns the activity, which is today's at-least-once activity semantics. |
| `deferredDone` | Insert the deferred step (fenced, idempotent on conflict), then wake the execution (in memory, or start a resume if it isn't loaded). |
| `scheduleClock` | Insert the `clock` step with `fire_at`, then arm an in-memory timer. On fire: set its `exit` and run `deferredDone`. Clocks under `inMemoryThreshold` never reach the engine, as today. |
| completion | One update: status, `completed_at`, `result`. Wake the parent, then publish the notification. |
| `interrupt` | Set `interrupted`, then wake, following `layerMemory`'s semantics. |
| `poll` | In-memory state; else the row's `result`. |

Ownership and recovery:
- Several API processes can share one database. `e2e/src/api/kernel/sandbox/global-provider-rate-limiting.test.ts`
  runs two concurrently. The restart tests (history-correction recovery, reminder recovery, import
  durability) need a new process to take over a dead one's executions.
- Each `workflow_execution` row gets `owner` (a per-process id) and `lease_until`. A process runs only
  executions it owns. It claims a new execution at insert. It renews all its leases with one heartbeat
  statement every few seconds.
- A sweep, at boot and periodically, claims active executions whose lease has expired, then resumes
  them and arms their unfired clocks. An expired lease plays the role that shard-lock expiry plays
  today.
- **Cross-process wake.** When a process writes a step or a child result for an execution it does
  not own, the same statement calls `pg_notify('ryot_workflow', <identity>)`. Each process listens on
  one dedicated connection and wakes the executions it owns. When the owner is local, the wake is
  in memory and nothing is notified. Today Cluster delivers cross-runner messages by polling storage
  every 10 s, so this is not a regression.

GC:
- `expireTrees` checks for "no unfired clock step and no active member" instead of unprocessed
  cluster messages.
- Clearing deletes the tree's `workflow_step` rows and clears `payload`/`result`.

## Expected cost per step

| | Today (Cluster) | New engine |
| --- | --- | --- |
| Activity | ≈6–8 statements over 2–3 transactions, plus a root `FOR UPDATE` | 1 insert (in the caller's connection; no extra transaction) |
| Workflow start / finish | Message, reply and fence rows, a shard lookup, polling | 1 insert / 1 update |
| Idle process | ≈11 transactions/s (shard locks, heartbeat, polling) | One lease renewal every few seconds |

## Testing

- **Unit and integration:** kernel backend tests already run workflows on `testing/effect.ts`
  engines. Add an engine conformance suite that runs the same scenarios against `layerMemory` and
  the PostgreSQL engine: activities, child workflows, deferreds, clocks, interrupts, finalizers,
  and resume after a simulated restart, i.e. a fresh engine on the same database.
- **e2e:** the recovery-oriented files are `sidecar-recovery`, `durable-tracer`, `youtubei-tracer`,
  `lifecycle-triggers` replay, import resume and `reminders/recovery`. Then the full suite, then the
  flow probes for before/after numbers.

## Risks

- **Semantic drift from the Cluster engine.** Mitigation: start from `layerMemory`'s state machine
  and run the conformance suite against both engines.
- **Kernel code that reads Cluster internals:** the payload parent key, the clock entity type and
  `workflowEntityPrefix` in `workflow-models.ts`. These are replaced; GC and its tests are
  rewritten.
- **Long activities hold no transaction.** Each step insert is a single autocommitted statement
  unless the activity runs inside its own transaction.
