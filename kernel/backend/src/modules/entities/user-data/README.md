# Entity user data

`EntityUserDataService` owns clear and same-schema merge for the caller's events and relationships.
HTTP commands and sandbox host capabilities use this owner. They never delete entities or modify
another user's data. Schema owners may deny either operation and declare merge identity properties.
Plugin callers require pinned ownership of both schemas; a global source is allowed because only the
caller's state moves.

## Scope declarations

An entity schema's `userState` policy can declare:

- `relationships`: the authored relationship references that represent user state. Other links,
  including custom metadata structure, remain unchanged. An omitted list selects all user links.
- `children`: owned outgoing relationship paths, target schemas, and exact child identity properties.
  `matchName` additionally requires equal trimmed, case-insensitive names.
- `evidence`: events stored on another declared entity schema, selected by a declared entity-reference
  property. `resetOnMerge` deletes transient evidence on both sides rather than transferring it.

Scope reads include current children and historical children retained by session references or typed
evidence. Merge requires a unique current destination for every child with user state or retained
evidence; unused source inventory needs no match. Missing or ambiguous identities reject before any
source mutation. Typed embedded entity references are rewritten from property-schema metadata;
ordinary text, event IDs, occurrence dates, ordering and retained evidence are preserved.

## Commit and replay

Policies prepare event and relationship changes before the transaction. The commit locks the affected
entity references in canonical order, rereads the full selected scope and root merge identities, and
rejects drift. Existing per-record guards reject concurrent edits. All source changes, lifecycle
planning and the command receipt commit together. Hook dispatch starts after commit.

Merge retains explicit events without heuristic deduplication. Relationships combine by identity;
destination properties win collisions and source-only properties transfer. No-op shared relationships
remain intact. Clear deletes selected state, including evidence stored away from the subject.

HTTP requests require an immutable `idempotencyKey` and `submittedAt`. Sandbox writes retain the
operation submission identity. A completed replay returns the recorded result rather than repeating
the mutation, even if new data has since arrived. Reusing the identity for different inputs conflicts.
There is no persistent exclusion or integration suppression: already-running and future integrations
remain ordinary writers. Both public commands are protected for demo credentials.
