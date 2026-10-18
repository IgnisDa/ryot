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

## Projections

A plugin relationship schema may declare `projection: { scriptSlug, propertiesSchema }`. Its
processor writes derived values for user-owned links of that schema to `relationship_projection`,
one note per relationship. Projection output never extends or replaces relationship properties, and
backups do not export it. Install validation applies the event-projection rules: a strict, non-empty
output schema of at most 20 fields disjoint from the relationship properties, and a same-plugin
script limited to read-only capabilities without workflow dependencies.

`relationship_projection_work` holds one row per user and relationship schema: processor binding,
plugin pin, account token, step, and current job. Each note keeps `revision` and
`projectedRevision`. A request upserts notes for the named source entities and advances their
revision; the processor result is visible only while both are equal.

`requestRelationshipProjections` marks the execution user's links. The owning plugin may call
`requestRelationshipProjectionsForAllUsers`, which repeats the request for every user holding a
link from the named sources. Both accept at most 100 source entity IDs and admit work through the
common background-work owner with the `relationship-projection` purpose and the read-only
`projection` subject. The work row is the background scope, so a user's schema runs one step at a
time.

A step claims at most 100 dirty notes with their revisions and passes their relationship and
endpoint IDs to the processor, which must return exactly one update per claimed relationship.
Publication requires the canonical job to be running and still current, rechecks the declaration and
processor binding, and writes only notes whose revision still matches the claim. It releases the
work, settles the job, and admits the next step while dirty notes remain, all in one transaction.
A changed binding is rebound instead: every note of the work advances its revision and the step is
re-admitted. After publication the service emits a `projection-updated` hint for each changed source
entity; a failed step emits hints for its claimed sources.

RyotQL exposes `relationship.projection` only when the note is current and the work's plugin
revision and configuration pin match an active plugin with a ready installation.
`projectionStatus` is ready, pending, failed (the current job failed), or none when the schema
declares no projection. Reconciliation on the frequent cron finds user schemas whose links lack
notes or whose binding is stale, fills missing notes, rebinds, and requests work; this covers
imports, backup restore, and plugin upgrades. Deleting a relationship, user, or plugin cascades to
its notes and work.
