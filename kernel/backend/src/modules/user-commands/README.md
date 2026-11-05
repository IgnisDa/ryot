# User commands

A user command commits one user-owned entity create or update, its declared relationships, and its
event creates, updates, and deletes as one database transaction. Event-backed completion records use
the same boundary. Lifecycle planning and the command replay receipt commit with those writes;
after-hook dispatch starts after commit. A validation, policy, stale-baseline, or persistence failure
does not leave partial entity, relationship, or event source writes.

## Preparation and commit

`UserCommands.commit` prepares the entity and relationships, prepares event items in pages, and runs
event policies, all before the commit transaction, so no database transaction is held over sandbox
execution. Durable callers run the whole command inside one activity. The commit rechecks references
and schema fingerprints, persists the entity, relationships, and event changes, and records the result
and dispatch plan atomically.

The commit holds its entity reference locks until it ends, so commands that write events under the
same entity serialize on its row. It does only the work its changes need: an unchanged entity update
still rechecks the stored entity, but plans no entity lifecycle batch, and a command without
relationships plans no relationship batch. The commit changes no plugin, installation, or account
rows, so it runs each locked domain write check once per writer, owner, and scope
(`reuseLockedWriteChecks`); the check's shared locks keep its result valid until commit.

Asset uploads and storage are separate from the command transaction. A command may refer to managed
assets; the write boundary validates and locks those references while committing metadata.

Every command item derives its receipt identity as `<command itemIdentity>:<item itemIdentity>`.
Event creates and changes carry a required `itemIdentity`; the entity and each relationship may
carry one and otherwise use `entity` and `relationship:<index>`.

Event policy items retain their unique `itemIdentity` through preparation and policy results. Event
preparation is chunked at 50 items, while accepted changes are committed together with the rest of
the command. The result pairs each written event ID with its item identity and returns the root entity
ID. Repeated event identities or duplicate existing event IDs are rejected.

Declared event-group constraints are captured once for the complete prepared command and checked only
after all event pages commit within its transaction. The generic import owner uses this same command,
setting item identities to its operation IDs; it does not create a parallel event writer.

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

Event creates can name an `orderAfter` anchor and suffix. The anchor must be an existing event in
the same user's plugin scope, sharing an entity or session with the output. Preparation captures its
revision and commit rechecks it under an event lock. An update can replace the anchor or set it to
null to return to the record's own creation order. Logical ordering does not rewrite audit timestamps.

## Standalone event creation

`EventsService.create` is intentionally different: it prepares items independently, commits the
accepted ones in one transaction, and returns per-item written, skipped, or failed outcomes. A policy
rejection or commit conflict commits none of them. It is not the atomic
entity-plus-relationships-plus-events command described above.
