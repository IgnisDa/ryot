# Entity user data

`EntityUserDataService` plans clear and same-schema merge of the caller's events and relationships
for `ChangeSets` (`entities.clears` and `merges`). The HTTP routes commit one as a kernel writer with
no schema restriction and map event conflicts to `state-conflict`, an event policy's rejection to
`policy-rejected` with its reason, a policy's failure to `policy-execution-failed`, and a policy that
could not run (`isTransientPolicyFailure`) to `EntityUserDataUnavailable` (503). They never delete entities or
modify another user's data. Schema owners may deny either operation and declare merge identity properties.
Plugin callers require pinned ownership of both schemas; a global source is allowed because only the
caller's state moves.

## Scope declarations

An entity schema's `userState` policy can declare:

- `relationships`: the authored relationship references that represent user state. Other links,
  including custom metadata structure, remain unchanged. An omitted list selects all user links.
- `children`: owned outgoing relationship paths, target schemas, and exact child identity properties.
  `matchName` additionally requires equal trimmed, case-insensitive names.
- `evidence`: events stored on another declared entity schema, selected by a declared entity-reference
  property. `transient` evidence is deleted on both sides rather than transferred, and backups omit it so it is
  rebuilt after restore.

Scope reads include current children and historical children retained by session references or typed
evidence. Merge requires a unique current destination for every child with user state or retained
evidence; unused source inventory needs no match. Missing or ambiguous identities reject before any
source mutation. Typed embedded entity references are rewritten from property-schema metadata;
ordinary text, event IDs, occurrence dates, ordering and retained evidence are preserved.

## Commit and replay

Preparation reads the selected scope and plans its changes: the relationship changes join the change
set's relationship policy batch, and the event changes (clear deletes; merge resets and reference
moves, marked `kernelCollection`) join the change set's events; both run their policies once per
batch. In the commit transaction, after
event group capture, the plan locks the affected entity references in canonical order, rereads the
full selected scope and root merge identities, and rejects drift before any write. Existing
per-record guards reject concurrent edits. All source changes and lifecycle planning commit together
with the rest of the change set. Hook dispatch starts after commit.

Merge retains explicit events without heuristic deduplication. Relationships combine by identity;
destination properties win collisions and source-only properties transfer. No-op shared relationships
remain intact. Clear deletes selected state, including evidence stored away from the subject.
A relationship the same change set writes (by its identity, the key for a keyed declaration) is left
to that write: the clear or merge neither selects, rechecks, deletes nor moves it, so each
relationship is written once.

Requests carry no idempotency key. A second clear finds nothing to delete, and a second merge finds
the source already merged and reports success.
There is no persistent exclusion or integration suppression: already-running and future integrations
remain ordinary writers. Both public commands are protected for demo credentials.
