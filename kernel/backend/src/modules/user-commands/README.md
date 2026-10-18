# User commands

A user command commits one user-owned entity create or update, its declared relationships, and its
event creates, updates, and deletes as one database transaction. Event-backed completion records use
the same boundary. Lifecycle planning and the command replay receipt commit with those writes;
after-hook dispatch starts after commit. A validation, policy, stale-baseline, or persistence failure
does not leave partial entity, relationship, or event source writes.

## Preparation and commit

Entity and relationship preparation runs in durable workflows before commit. Event items are prepared
and policies are evaluated in durable workflow steps before the commit activity. Preparation carries
validated, serialized inputs into the final transaction; it does not hold a database transaction over
workflow or sandbox execution. The commit rechecks references and schema fingerprints, persists the
entity, relationships, and event changes, and records the result and dispatch plan atomically.

Asset uploads and storage are separate from the command transaction. A command may refer to managed
assets; the write boundary validates and locks those references while committing metadata.

Event policy items retain their unique `itemIdentity` through preparation and policy results. Event
preparation is chunked at 50 items, while accepted changes are committed together with the rest of
the command. The result pairs each written event ID with its item identity and returns the root entity
ID. Repeated event identities or duplicate existing event IDs are rejected.

## Replay and optimistic baselines

Plugin callers can pass `idempotencyKey` to `operations.invoke`. Keep the same key and exact immutable
input when retrying. The operation receipt pins and replays the original execution result; reusing a
key with different input conflicts. Bridge `requestId` values correlate individual transport attempts
and are not write identities.

Entity updates carry an expected name, properties, and `updatedAt`. Event updates and deletes may
carry expected entity/session references, occurrence time, present property values, and absent
property names. Commands can also declare the expected set of session event IDs. These baselines
detect stale writes; a changed baseline fails the atomic command rather than merging silently.

Optional event `baselines` protect read-dependent commands. Each names a visible entity owned by
the command's plugin and the revision of that user's plugin event scope. Each insert, edit, deletion,
or reference move advances the scope revision for both entity and session references. The commit
locks entity references before comparing the revision; writers take compatible reference locks,
including standalone deletions. Readers obtain the revision from RyotQL's `eventScope` table, using
zero for a scope with no row. The baseline size is independent of history length.
Commands can guard source and evidence scopes together; unchanged root entities are not rewritten.

`dataBaseline` optionally compares global and owned plugin data revisions from RyotQL's
`dataRevision` table. Entity and relationship statements advance affected old/new ownership scopes
through transaction-time triggers; cascades and rollback follow the source transaction. Commit locks
entity references before locking and comparing requested counters. This guards multi-page evidence
capture without embedding every entity or relationship revision in the command.

Event creates can name an `orderAfter` anchor and suffix. The anchor must be an existing event in
the same user's plugin scope, sharing an entity or session with the output. Preparation captures its
revision and commit rechecks it under an event lock. An update can replace the anchor or set it to
null to return to the record's own creation order. Logical ordering does not rewrite audit timestamps.

## Standalone event creation

The external event-create workflow is intentionally different: it prepares and evaluates items
independently, commits accepted records in chunks of up to 50, and returns per-item written, skipped,
or failed outcomes. Earlier accepted chunks remain committed when a later item fails. It is not the
atomic entity-plus-relationships-plus-events command described above.
