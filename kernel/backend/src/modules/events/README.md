# Events and projections

## Source facts and derived values

`event` rows are the authoritative history: their properties, entity and session references, schema,
and timestamps describe recorded facts. A declared processor writes derived values to
`event_projection`, keyed by event ID and linked to its stream. Projection output does not replace or
extend source-event properties.

An event-schema projection declaration names a processor script, its inputs, and an output property schema. The
schema must be strict, non-empty, contain at most 20 fields, and have no field names in common with
the source event schema. The processor must be a script owned by that plugin; validation limits it to
read-only host capabilities and disallows workflow dependencies.

A declaration's own event schema is always an input in entity scope. `inputs` optionally lists
additional same-plugin `{ eventSchemaSlug, scope }` selectors. `scope` is `"entity"` or
`{ property: "fieldName" }`; a property scope requires a declared scalar entity-ID reference. A
selector maps an input event to the output stream's entity. Declare every event schema and reference
path the processor reads; duplicate input paths are rejected. Outputs remain restricted to the
declaration's event schema and entity. Multiple output schemas can share one processor, each with its
own stream.

The processor runs with the user-scoped `projection` subject and that account generation. This
subject has read-only authority. The `event_projection` RyotQL table is also a read-only subject,
visible through its parent event's ownership.

## Event IDs and ordering

A created event's ID is `event_<position>_<hash>`. The hash is derived from the command's execution ID
and item identity, so replays reproduce the same ID. `position` is the item's zero-padded base-36
index within its command, width 4, counted across workflow chunks. Backup restore keeps the IDs it is
given.

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
Violations fail as a generic `EventBadRequest` mutation conflict and roll back source writes and receipts.

Before policies run outside this transaction and do not establish cardinality or binding consistency.
Historical restore validates final consistency with SQL, without comparing or recapturing immutable
properties from live metadata.

## Stream work and freshness

A stream is keyed by user, entity, event-schema owner, and event-schema slug. Source event writes
advance its revision and dirty the stream. The `event_stream_work` row retains the stream's
processor binding, checkpoint, dirty boundary, completed revision, and the job that last claimed it;
it also copies the stream's user, owner, and slug so dirty streams of one schema come from a partial
index. A stream is dirty while `completed_revision` is null or `dirty_from` is set.

Processing is batched per user and event schema. One `event-projection` job, with the schema slug as
its background scope, serves every dirty stream of that user and schema, so at most one job per
user and schema runs. Admission share-locks and returns the scope's queued job when one exists;
otherwise it admits a new job only when a claimable stream is bound to the current processor
binding. Only concurrent admissions that both find no queued job can queue a second one, which
then claims what remains. A queued job reads whatever is dirty when it starts.

The job's persisted preparation activity claims up to 100 dirty streams bound to the job's binding,
keyset by stream ID, stamps them with the job, and records each claimed revision, entity, and output
schema in the job. The processor receives `{ eventSchemaSlug, streams: [{ entityId, checkpoint,
dirtyFrom }] }` and returns `{ streams: [{ entityId, done, checkpoint, updates }] }` covering every
claimed stream exactly once. Updates are limited to 1,000 per batch and each serialized checkpoint
to 16,384 UTF-8 bytes; each update must target an event of its own stream and match that stream's
declared output schema.

Publication is one transaction per batch. It rechecks the account, the declaration, and the current
processor binding once. A changed binding publishes nothing; reconciliation rebinds the streams.
Otherwise each stream publishes only while it is still claimed by the running job at its claimed
revision; a stream changed meanwhile is skipped and stays dirty. Published streams store their
checkpoint and either their completed revision or, for `done: false`, stay dirty for the next job.
The transaction then admits the next job when claimable streams remain and settles the current one;
workflow dispatch follows the activity, and the settled job's scope handoff starts the next job.

A source write, entity invalidation, or rebinding clears the stream's claim, so stale results cannot
publish. A failed batch leaves its streams claimed by the failed job; such a stream is claimed again
alone, and a stream whose single-stream claim failed stays failed until a source write or a
`requestEventStreamWork` call clears it. One bad stream therefore cannot hold back the rest of its
batch.

Input writes advance dependent output streams as well as the source stream. Old and new entity and
declared property references participate in invalidation. A related-input change resets
the dependent checkpoint and dirty boundary; it cannot reuse an append checkpoint from another schema.

Processors compute from their current declared inputs and never wait for them. A write to any
declared input re-dirties the target stream, so outputs converge when an asynchronous source owner
later writes the events a processor reads.

RyotQL exposes `event.projection` only for completed work whose claimed revision matches the stream,
whose plugin revision and configuration pin are current, and whose plugin and installation are
active and ready. This hides values made stale by source changes or binding changes. `projectionStatus`
is pending, ready, failed, or none when the event schema has no projection.

The same freshness gate protects `event_projection.properties`, which is nullable while stale. It
also checks the account generation and that the event still belongs to the projection's stream;
finishing an old stream cannot expose values for an event moved to a new entity. The gate joins
only the streams of the events being read, through the stream key index, and compares the stored
`config_revision_id` column generated from the binding pin.

Publishing changes only projection rows and stream-work state. It does not write source-event
properties, source revisions or timestamps, or lifecycle events. Backup restore seeds streams from
restored events; declaration-driven reconciliation binds them and admits their jobs. See
[background work](../background-work/README.md) for common admission, dispatch, and recovery
ownership.

Reconciliation is index-driven so an idle tick reads no streams. `event_stream_binding` holds, per
user and declaration, a `revision` that every stream creation increments in the creating
transaction, plus the account generation, plugin revision, configuration revision, and
`bound_revision` last reconciled. Only declarations whose record is missing, whose revision moved, or
whose binding differs are selected, in keyset pages. For each, set-based statements insert or rebind
the work rows of all its streams in pages of 1,000, resetting rebound streams; the binding is then
recorded only if the revision still equals the value it read, so a stream created meanwhile leaves
the declaration stale for the next tick. A declaration whose processor binding is unavailable stays
unrecorded and is retried without blocking later declarations. Reconciliation then walks the
distinct user and schema keys of the dirty-stream index and admits a job for each key without a
queued or running job. Rebinding a declaration scans that declaration's streams once per change.

Restore passes session and property references into stream seeding and takes reference locks before
inserting historical events. A stream row exists for every user, entity, and event schema with
events; a stream without its own events has no outputs. Plugin upgrades that add or change a
declaration are handled by binding reconciliation over existing stream rows. Invalidation updates
all affected revisions atomically, and dependency resolution joins selected inputs as sets.

Background-work settlement publishes the user-scoped derived-data-updated hint (see [entity
interest](../entities/watches/README.md)). The hint carries no projection data; readers refresh from
RyotQL.
