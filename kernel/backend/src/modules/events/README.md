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
an edit or deletion that changed after preparation fails as stale.

### Mutation lock order

`EventsRepository.lockMutationReferences({ eventIds, sources? })` is the batch pre-lock entrypoint.
`sources` contains every proposed source draft with its user, plugin, schema, entity, session, and
properties. Current rows for `eventIds` supply the old references. Call it after account/catalog
admission and before taking any entity/session row locks. It locks old and new entity, session, and
selected input references in entity-ID order using `FOR NO KEY UPDATE`.

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
An event create runs its before policies in chunks of at most 50 items, so one invocation fits the
sandbox context limit; a subject's items share a chunk. All accepted items then commit in one
transaction.
Historical restore validates final consistency with SQL, without comparing or recapturing immutable
properties from live metadata.

## Folds

`modules/derived-values` owns the fold. The script receives `{ subjectEntityId, value }`, where
`value` is what it returned last time, and reads anything else through RyotQL inside the writing
transaction. It returns:

- `value`: its own state, at most 256 KiB.
- `events`: one `{ eventId, properties }` for each subject event whose schema declares a projection.
- `relationships`: one `{ relationshipId, properties }` for each of the user's links from the subject
  whose schema declares a projection.
- `changes`: at most 500 event creates, updates and deletes in the user-command format. These
  fold-owned events skip before-policies and after-hooks.

When `changes` is not empty, the kernel applies them and runs the fold again. The second run must
return no changes, so a fold settles in at most two runs.

Every event write runs in the events transaction. The write marks the old and new subjects of each
changed event, and the transaction folds them after its work and before the event-group check. A
relationship write marks its source entity when the schema declares a projection. Outside an events
transaction, marking queues a `fold` job instead. An event create on the background lane, such as an
import, integration or async hook, also queues one `fold` job per subject, so bulk writes hold no locks
while scripts run. `requestFolds` and the owning plugin's
`requestFoldsForAllUsers` queue jobs for changes that come from outside the subject's events.
Installing a new plugin revision or restoring a backup queues one `fold-rebuild` job per user, which
refolds every subject of that plugin.

An inline fold runs in the sandbox's direct path. A script reads through a savepoint marked read-only
inside the writing transaction, so it sees that write's own changes, and the savepoint is rolled back
so the mark cannot outlive the read. Reads run at the transaction's READ COMMITTED isolation. On the
interactive lane, a run that finds no sandbox capacity retries twice before deferring. A fold that
cannot finish inline never fails the write: the write commits and a `fold` job takes over. Fold jobs
are coalesced per user and subject, run four at a time, and retry up to eight times, one second apart.
The last failed attempt marks the subject failed. Each settled job publishes the user-scoped
derived-data-updated hint (see [entity interest](../../../../client/src/modules/entity-watches/README.md)).

`derived_value` holds one row per target: the subject's own row (`kind = 'subject'`, holding `value`
and `status`) and one row per event or relationship output. Each row records its subject, plugin
revision and the subject's event-scope revision. A fold replaces only the rows whose value changed
and deletes the rest of the subject's rows.

RyotQL exposes `event.projection` and `event.projectionStatus`. A value is visible while its plugin
revision is the active one, including while a newer fold is pending. Its status is `ready` once its
subject row has folded, `pending` while a fold job is queued for the subject or the row is missing,
`failed` when the subject's last fold job failed, and `none` when the schema declares no projection.
Backups do not export derived values or a fold's state. A restored subject refolds from its restored
events with no previous value.
