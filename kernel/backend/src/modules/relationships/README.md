# Relationship mutations

`mutation-primitives.ts` owns request construction, policy patch acceptance, schema revalidation, locks, source persistence, change planning, and item receipts. Its preparation and persistence operations require an active transaction. Policy execution runs outside transactions.

`mutation-pipeline.ts` owns ordinary single/batch operations and global reconciliation. It opens short root transactions around planning and persistence, runs policies between them, and seals resource batches after item persistence. Each user batch or global group retains its own partial-success boundary.

Single commits return the actual item result. Batch and reconciliation commits compute one summary from persisted item outcomes, store it in their aggregate receipt, and return it. Aggregate replay returns that stored summary and dispatch directly; it does not reconstruct item outcomes.

User relationship batch creates require `propertiesMode`: `merge` overlays supplied properties and preserves omitted values, while `replace` uses only the supplied properties. Single creates and generic imports keep their existing upsert semantics.

A relationship schema may declare `userWritePolicy: "source-owner"`. User-scoped creates, updates,
and deletes then require the source entity to belong to the writing user; a visible global target
is allowed. Omitted policy retains annotation-style relationships from visible global sources.
The shared mutation validator enforces the restriction during preparation and commit, using the
stricter of pinned and active declarations. A prepared editor endpoint created in the same commit uses its verified
creation token until persistence can read the stored entity. Authorized global writes remain governed by
their existing plugin and execution authority; this rule neither grants global authority nor runs
a sandbox policy during provider reconciliation.

`prepared-mutations.ts` returns opaque user-mutation handles for entity-user-data operations. Preparation opens its own short transaction. Persistence joins the caller's active transaction, uses conditional source writes, and returns only item dispatch references. The multi-item owner seals the resource batch and dispatches after commit. Initial no-ops return no handle; a policy-transformed prepared update still writes even when its final properties match the source.

`planned-reconciliation.ts` joins the provider or host owner's active transaction. Provider reconciliation is not a policy-subject request, so it plans no before-policies. It seals each group and records replay-stable group results.

Every writing transaction runs domain write checks with `lock=true` once per distinct writer, kernel-collection flag, definition owner, and scope, then locks entity references (`FOR KEY SHARE`, sorted ids), then relationship identities (one sorted `hashtextextended(key, 0)` advisory-lock statement over the repository's deterministic lock keys), then the schema catalog. Only then does each item validate once, against the verified pin of its write check; that result feeds the request, the policy-transform reparse, and the stable-source check. Planned reconciliation takes the catalog lock before the identity locks; both are shared with the write checks' ingestion lock. Entity and relationship reads, receipt lookups and inserts, and source inserts, updates, and deletes are one statement per phase. A later item whose identity an earlier item of the same batch wrote fails with `concurrent-relationship-change`. Population counts are computed before change planning; the first newly changed item is the leader. Ordinary batches include replayed item operations in their counts, while active-transaction reconciliation counts newly prepared requests. Replayed dispatch references retain their original order.
