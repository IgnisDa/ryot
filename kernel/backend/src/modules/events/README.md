# Events and folds

## Source facts and derived values

`event` rows are the authoritative history: their properties, entity and session references, schema,
and timestamps describe recorded facts. A fold writes derived values to `derived_value`. They do not
replace or extend source-event properties.

An event schema declares `projection: { propertiesSchema }` to receive a derived value per event. The
schema must be strict, non-empty, contain at most 20 fields, and have no field names in common with
the source event schema.

An entity schema declares `fold: { scriptSlug, eventSchemaSlugs }`, and its entities are the fold's
subjects. An event of a listed slug, owned by the same plugin, belongs to its session entity when the
session's schema folds that slug, and otherwise to its own entity. The script must be owned by that
plugin; validation limits it to read-only host capabilities and disallows workflow dependencies.

## Event IDs and ordering

A created event's ID is `event_<position>_<hash>`. The hash is derived from the command's execution ID
and item identity, so replays reproduce the same ID. `position` is the item's zero-padded base-36
index within its command, width 4. Backup restore keeps the IDs it is given.

Within one command, ascending `(occurredAt, createdAt, id)` equals submission order and descending
order is its exact reverse; ties on `occurredAt` and `createdAt` are broken by `position`. Separate
commands, including the chunked calls a plugin makes for one logical batch, carry no shared position.
Their order relies on `createdAt` being set per insert from the server clock, so a later call never
sorts before an earlier one.

Derived records can retain an authorized source-order anchor through event mutation commands.
RyotQL exposes `orderCreatedAt` and `orderKey` as the effective creation-order pair: an explicit event
uses its own creation time and ID; an anchored event follows its captured source order with the
declared suffix. Consumers that need logical history order sort by `(occurredAt, orderCreatedAt,
orderKey)`. Physical identity and audit timestamps remain separate. Backups preserve the effective
order even when restore remaps physical event IDs.

`event_scope` tracks a revision per user, plugin owner, and entity-or-session reference. Source writes
advance old and new scopes, including deletions and reference moves. Read-dependent user commands
can use that scalar revision as their atomic baseline instead of carrying every source event ID.

Snapshot reads do not lock event rows. Preparation can therefore read history while a commit holds
entity locks. Persistence locks entity references before event rows and rechecks captured revisions;
an edit or deletion that changed after preparation fails as stale. HTTP event updates and deletes
commit one event change through `ChangeSets.commit`, which retries a stale one whose field
`expected` still holds (see [change sets](../changes/README.md)).

### Mutation lock order

`EventsRepository.lockMutationReferences({ eventIds, sources? })` is the batch pre-lock entrypoint.
`sources` contains every proposed source draft with its user, plugin, schema, entity, session, and
properties. Current rows for `eventIds` and the events that reference them supply the old references,
so a deletion holds its referrers' entity rows before the deferred clear updates them. Call it after
account/catalog admission and before taking any entity/session row locks. It locks old and new entity,
session, and selected input references in entity-ID order using `FOR NO KEY UPDATE`.

Then acquire any group-owned entity/session locks, call `lockEventRows` with the same complete batch,
and persist the writes. Stream locks are sorted before event-row locks. Single-row repository writers
also acquire reference locks before resolving fanout; outer multi-write owners must pre-lock the whole
batch to preserve global order. The lower-level `EventStreamRepository.lockSourceReferences(sources)`
and `lockSourceReferencesForEvents(eventIds, sources?)` expose that same reference-lock stage.

Reference locks precede fanout reads, so concurrent writes reaching the same output stream serialize
before resolving their targets. Publication needs the affected stream lock and revision fence, so all
old claims become stale in the same transaction as the input change.

## Atomic event groups

An anchor schema can declare a session-scoped `eventGroup`. Its scalar key properties identify one
anchor per user, exact plugin owner, and session, independently of the anchor's entity. Declared
dependent schemas belong to the same entity schema. Each dependent must match one anchor's entity
and declared properties, and each anchor must retain at least one dependent of each declared schema.

Event writes run inside the events-owned transaction (`EventsService.transaction` or
`EventMutations.transaction`), which validates every touched group once as its last statement and
fails with the typed error. Persisting a source mutation captures its user, entity, session, and
prior anchor bindings into that transaction's collector; persisting outside it fails. Multi-write
owners call `captureEventGroups`/`captureGroups` first for the whole batch, which prelocks the old and
proposed source references through `EventsRepository.lockMutationReferences` and the affected
entity/session rows in canonical order before stream and event rows. Later persists of already
captured items skip capture. Capture keeps only changed source rows and their first-seen anchor
bindings. Set-based SQL checks the final affected sessions without loading their histories into
application memory.

Retained anchor IDs keep their session and declared immutable properties. Retained dependent IDs keep
the same anchor event ID. Atomic commands can reorder anchors and dependents together; intermediate
key collisions are permitted. Standalone dependent writes remain valid when a matching anchor and at
least one dependent of each declared schema remain. Deleting a last dependent requires deleting its anchor in the same
atomic command. Entity cascades and merges finalize after the whole source change, not per event.
Violations fail as a generic `EventBadRequest` mutation conflict and roll back source writes.

Before policies run outside this transaction and do not establish cardinality or binding consistency.
A change set runs its event policies in chunks of at most 50 items, so one invocation fits the sandbox
context limit; a subject's items share a chunk. All accepted items then commit in one transaction
(see [change sets](../changes/README.md)).
Historical restore validates final consistency with SQL, without comparing or recapturing immutable
properties from live metadata.

## Event references

An event schema can declare top-level string properties with `reference: { kind: "event-id" }`.
Definition validation rejects them elsewhere: nested, in entity, relationship or signal schemas, marked
`required` or `immutable`, required by a rule, or used as an event-group key, match or immutable
property. Every event reference is therefore optional.

Creates and updates require each referenced event to exist, belong to the same user and differ from
the referrer. The write takes `FOR KEY SHARE` on the targets and fails as an `invalid-properties`
`EventBadRequest`. `EventsRepository` keeps the reverse index in `event_reference`, one row per
referrer and property, rewritten with each create and update; deleting a referrer cascades its rows.
An update rechecks only references that differ from the referrer's index rows. A reference whose
target this transaction already deleted is neither checked nor indexed; the pending clear removes it.

Deleting a referenced event locks its referrers' entity rows with its own before the event row, and
removes its index rows after the event row, so a concurrent referrer that locked the target is seen
once it commits. The events transaction collects the released referrers
and, after its work and after each applied fold change, removes those properties from referrers that
still hold them: their revision advances, their scopes are touched and their subjects refold before
the transaction settles. The clear runs no policies or hooks. This covers direct and batch deletes,
events a fold deletes, entity cascades and user-data clears; a referrer deleted in the same
transaction is simply gone. A delete outside an events transaction clears immediately. Merges move
events by ID, so references to moved events stay valid; references to the transient evidence a merge
resets are cleared.

Restore resolves each reference through the archive's staged event mappings, drops a reference
whose event is not in the archive, and writes index rows with each restored event batch. The index has
no foreign key on the referenced event, so archive order does not matter.

## Folds

`modules/derived-values` runs folds; see its [README](../derived-values/README.md).
