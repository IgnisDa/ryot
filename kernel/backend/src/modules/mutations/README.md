# Mutation admission and workflow ownership

`AccountAdmission` owns account admission and `IdempotencyKeys` owns request keys. Neither
imports concrete workflows or the workflow engine.

Account admission is one `for share` read of the user row, done once per transaction. Account
retirement stamps `retiring_at` on that row under its exclusive lock and deletes the account's jobs in
the same transaction, so a waiting admission re-reads the stamp. A stamped account, or a command
from a job that no longer exists, is refused.

The workflow engine records which account an execution works for (see
[`platform/workflow`](../../platform/workflow/README.md)). `workflow-dispatch.ts` binds dispatch to it:

- `dispatchAdmittedWorkflow` takes the workflow, an account user ID (`null` for system work) and
  execution options. It derives a missing execution ID, and the engine admits the execution under that
  account in its insert. A retired account fails with `DbError`.
- `admitWorkflow` binds the running workflow body to an account when it was admitted without one; it
  costs nothing once the execution works for that account.

User retirement interrupts every active execution the engine lists for the account, including children,
which inherit their parent's account.

## Idempotency keys

Only plugin operation invokes, reminder creates and entity editor saves and deletes take an
`idempotencyKey`. Every other write is safe to retry through its natural keys. A key row stores the
request fingerprint and response, and is written in the same transaction as the write. A retry with
the same key and fingerprint returns the stored response without dispatching hooks again; a different
fingerprint is a conflict.

Keyed requests carry `submittedAt`. A submission whose `submittedAt` is more than seven days from the
server clock, in either direction, fails with `SubmissionExpired` (410); the client must retry with a
new key. A replay is therefore only possible within 14 days of the original write.

Import runs also record each committed item's result in this table, keyed by run and item identity,
so reconciliation can project committed items.

The frequent cron deletes keys created more than 14 days ago in bounded batches. Account retirement
deletes the account's keys.
