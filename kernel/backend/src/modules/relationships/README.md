# Relationship mutations

`mutation-primitives.ts` owns request construction, policy patch acceptance, schema revalidation, locks, source persistence, change planning, and item receipts. Its preparation and persistence operations require an active transaction. Policy execution runs outside transactions.

`mutation-pipeline.ts` owns ordinary single/batch operations and global reconciliation. It opens short root transactions around planning and persistence, runs policies between them, and seals resource batches after item persistence. Each user batch or global group retains its own partial-success boundary.

`prepared-mutations.ts` returns opaque user-mutation handles for user-state operations. Preparation opens its own short transaction. Persistence joins the caller's active transaction, uses conditional source writes, and returns only item dispatch references. The multi-item owner seals the resource batch and dispatches after commit. Initial no-ops return no handle; a policy-transformed prepared update still writes even when its final properties match the source.

`planned-reconciliation.ts` joins the provider or host owner's active transaction. It rejects matching before-policies with `before-policy-requires-owner`, rather than executing them in that transaction. It seals each group and records replay-stable group results.

Entity references are locked before relationships. Relationship mutation ordering uses the repository's deterministic lock key. Catalog provenance and source checks remain inside the committing transaction. Population counts are computed before change planning; the first newly changed item is the leader. Ordinary batches include replayed item operations in their counts, while active-transaction reconciliation counts newly prepared requests. Replayed dispatch references retain their original order.
