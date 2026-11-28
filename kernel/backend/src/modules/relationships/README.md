# Relationship mutations

Every relationship write commits through [`ChangeSets`](../changes/README.md); `RelationshipsService`
holds only the preparation and persistence engine those commits use. `mutation-primitives.ts` owns
request construction, schema revalidation, locks, source persistence, and change planning. Its
preparation and persistence operations require an active transaction.

A user write has a mode: `upsert` replaces the properties, `merge` overlays the supplied properties
and preserves omitted values (arrays merge without duplicates), `update` requires the relationship to
exist (`relationship-not-found` otherwise), `ensure` writes only when the relationship is absent and
leaves an existing one, including one written since preparation, unchanged, and `delete` removes it
by its endpoints or, through `prepareUserDeleteById`, by the user's relationship ID.

A relationship schema may declare `userWritePolicy: "source-owner"`. User-scoped creates, updates,
and deletes then require the source entity to belong to the writing user; a visible global target
is allowed. Omitted policy retains annotation-style relationships from visible global sources.
The shared mutation validator enforces the restriction during preparation and commit, using the
stricter of pinned and active declarations. A prepared editor endpoint created in the same commit uses its verified
creation token until persistence can read the stored entity. Authorized global writes remain governed by
their existing plugin and execution authority; this rule neither grants global authority nor runs
a sandbox policy during provider reconciliation.

`prepared-mutations.ts` prepares each user write in its own short transaction, returning its
request, or a null request when it would write nothing (an unchanged upsert or merge, an existing
ensure, a missing delete). Policies run once per batch, not per item: the owning commit matches every
prepared request in one relationship policy batch (`matchRelationshipPolicies`, chunked by source
entity) in its prepare transaction, calls the matched policies outside it, and applies each item's
decision, by item identity, before persisting it (`acceptRelationshipPolicies`). A rejection, an
invalid transform and a policy execution failure fail the commit with `PolicyRejected`
(`policy-rejected`, `invalid-properties` or `invalid-policy-transform`, and `policy-execution-failed`). Persistence joins the caller's active transaction, uses conditional source
writes, records the import item, and returns the item result and dispatch references; a null request
rechecks that the source is unchanged and returns a no-op. The owner seals the resource batch and
dispatches after commit. A policy-transformed update still writes even when its final properties
match the source.

`planned-reconciliation.ts` reconciles a change set's global relationships in its `ChangeSets` commit transaction. Provider reconciliation is not a policy-subject request, so it plans no before-policies. It seals each group and records replay-stable group results.

Every writing transaction runs locked domain write checks, given its `WriteTransaction`, for each distinct writer, kernel-collection flag, definition owner, and scope (reading each piece of authority once per transaction), then locks entity references (`FOR KEY SHARE`, sorted ids), then relationship identities (one sorted `hashtextextended(key, 0)` advisory-lock statement over the repository's deterministic lock keys), then the schema catalog. Only then does each item validate once, against the verified pin of its write check; that result feeds the request, the policy-transform reparse, and the stable-source check. Planned reconciliation takes the catalog lock before the identity locks; both are shared with the write checks' ingestion lock. Entity and relationship reads, and source inserts, updates, and deletes are one statement per phase. A later item whose identity an earlier item of the same batch wrote fails with `concurrent-relationship-change`. Reconciliation computes population counts from its prepared requests before change planning; the first changed item is the leader. Replayed dispatch references retain their original order.

Relationship declarations with `keyed: true` use a bounded `key` unique within the user, source
entity, and qualified schema; every write of one names its key, and a key on another declaration
fails with `invalid-relationship-key`. A change set's relationship upserts and deletes carry the key,
and an upsert whose key exists with another target fails with `concurrent-relationship-change`. An
entity user-data merge moves a keyed relationship's target in place: it checks the target it read
and preserves the row ID. Other declarations use their endpoint pair as identity. Keyed
relationships are user-scoped and carry their key through change sets, imports, RyotQL, and backups.

An upsert's `expected` properties are the relationship as its writer read it: preparation fails with
`concurrent-relationship-change` unless the relationship exists and holds each of those values, and
the commit's conditional write fails the same way if it changed since preparation.

## Projections

A plugin relationship schema may declare `projection: { propertiesSchema }`. The fold of the link's
source entity writes one derived value per user-owned link to `derived_value`. Projection output never
extends or replaces relationship properties, and backups do not export it. Install validation applies
the event-schema rules: a strict, non-empty output schema of at most 20 fields, disjoint from the
relationship properties.

A write to a link of such a schema marks its source entity. RyotQL exposes `relationship.projection`
and `relationship.projectionStatus` with the same rules as events; see
[folds](../derived-values/README.md).
