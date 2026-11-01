# Mutation admission and workflow ownership

`MutationReceipts` owns persistence and account-generation admission. It does not import concrete workflows or the workflow engine.

Account admission is one `for share` read of the user row, done once per transaction. Account
retirement stamps `retiring_account_generation` on that row under its exclusive lock, so a waiting
admission re-reads the stamp; a replaced token or a stamped generation is refused.

The workflow engine records which account an execution works for (see
[`platform/workflow`](../../platform/workflow/README.md)). `workflow-dispatch.ts` binds dispatch to it:

- `dispatchAdmittedWorkflow` takes the workflow, an account generation (`null` for system work) and
  execution options. It derives a missing execution ID, and the engine admits the execution under that
  account in its insert. A retired account fails with `DbError`.
- `admitWorkflow` binds the running workflow body to an account when it was admitted without one; it
  costs nothing once the execution works for that account.

User retirement interrupts every active execution the engine lists for the account, including children,
which inherit their parent's account.

## Receipt retention

HTTP and sandbox submissions keyed by `idempotencyKey` carry `submittedAt`. A submission whose
`submittedAt` is more than seven days from the server clock, in either direction, fails with
`SubmissionExpired` (410); the client must retry with a new key. A replay of an accepted submission is
therefore only possible within 14 days of its receipt.

The frequent cron deletes receipts recorded more than 14 days ago in bounded batches. It keeps
`batch-candidate` pins, receipts of a batch that still has candidates, and receipts whose execution or
root execution belongs to a workflow tree that has not expired. Workflow trees reject expired execution
IDs, so their receipts are no longer needed after expiry.
