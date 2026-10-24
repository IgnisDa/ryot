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

`inputs` is a non-empty list of same-plugin `{ eventSchemaSlug, scope }` selectors. `scope` is
`"entity"`, `"session"`, or `{ property: "fieldName" }`; property scopes require a declared scalar
entity-ID reference. A selector maps an input event to the output stream's entity. Each declaration
includes its own event schema in entity scope. Declare every event schema and reference path read,
including retained evidence and coordination records. Outputs remain restricted to the declaration's
event schema and entity. Multiple output schemas can share one processor, each with its own stream.

A selector can add one `through` mapping:

```ts
{
  eventSchemaSlug: "observation",
  scope: "session",
  through: {
    eventSchemaSlug: "dependency-evidence",
    sourceProperty: "inputEntityId",
    targetProperty: "outputEntityId",
  },
}
```

The selected entity reference matches `sourceProperty` on evidence events owned by the same user and
plugin. `targetProperty` identifies each output entity. Both properties must be distinct scalar
entity-ID references declared on the evidence schema. Nested mappings, array paths, undeclared
references, and duplicate input paths are not supported. Each evidence event represents one edge;
duplicate edges do not multiply a stream's revision increment within a write.

The mapping evidence is an implicit input. Inserting, editing, moving, or deleting it invalidates its
old and new output targets, even when no matching observation currently exists. Observation edits
invalidate every mapped target atomically, without waiting for a plugin to page through children.

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
admission and before taking any entity/session row locks. It locks direct references, selected input
references, and old/new mapping source and target references in entity-ID order using
`FOR NO KEY UPDATE`.

Then acquire any group-owned entity/session locks, call `lockEventRows` with the same complete batch,
and persist the writes. Stream locks are sorted before event-row locks. Single-row repository writers
also acquire reference locks before resolving fanout; outer multi-write owners must pre-lock the whole
batch to preserve global order. The lower-level `EventStreamRepository.lockSourceReferences(sources)`
and `lockSourceReferencesForEvents(eventIds, sources?)` expose that same reference-lock stage.

Input writers and mapping writers share source-reference locks. A mapping insertion cannot remain
invisible while a concurrent parent write resolves its fanout and commits. If the parent commits first,
the later mapping insertion itself invalidates the child. These locks precede fanout reads; acquiring
them after reading mapping rows would leave a phantom race. Publication needs the affected stream
lock and revision fence, so all old claims become stale in the same transaction as the input change.

## Atomic event groups

An anchor schema can declare a session-scoped `eventGroup`. Its scalar key properties identify one
anchor per user, exact plugin owner, and session, independently of the anchor's entity. Declared
dependent schemas belong to the same entity schema. Each dependent must match one anchor's entity
and declared properties, and each anchor must retain at least one dependent of each declared schema.

The existing source mutation paths enforce these rules in the commit transaction. They prelock the
complete old and proposed source-reference set through `EventsRepository.lockMutationReferences`,
then lock affected entity/session rows in canonical order before stream and event rows. Capture keeps
only changed source rows and their prior anchor bindings. Set-based SQL checks the final affected
sessions without loading their histories into application memory.

Retained anchor IDs keep their session and declared immutable properties. Retained dependent IDs keep
the same anchor event ID. Atomic commands can reorder anchors and dependents together; intermediate
key collisions are permitted. Standalone dependent writes remain valid when a matching anchor and its
minimum dependent count remain. Deleting a last dependent requires deleting its anchor in the same
atomic command. Entity cascades and merges finalize after the whole source change, not per event.
Violations fail as a generic `EventBadRequest` mutation conflict and roll back source writes and receipts.

Before policies run outside this transaction and do not establish cardinality or binding consistency.
Historical restore validates final consistency with SQL, without comparing or recapturing immutable
evidence from live metadata.

## Stream work and freshness

A stream is keyed by user, entity, event-schema owner, and event-schema slug. Source event writes
advance its revision and dirty the stream. `requestEventStreamWork` admits one step through the common
background-work owner. The stream-specific `event_stream_work` row retains its processor binding,
checkpoint, dirty boundary, completed revision, current job, and step; the canonical queued/running/
succeeded/failed status belongs to that job's `background_work` row. A processor step receives the
current checkpoint and returns a new checkpoint, a `done` flag, and at most 100 event updates;
the serialized checkpoint is capped at 16,384 UTF-8 bytes.

Input writes advance dependent output streams as well as the source stream. Old and new entity,
session, and declared property references participate in invalidation. A related-input change resets
the dependent checkpoint and dirty boundary; it cannot reuse an append checkpoint from another schema.

Each step validates its declared output and publishes the page together with the new checkpoint and
stream state in one transaction. Publication requires the canonical job to be running and still be the
stream's current job at the claimed source revision, and rechecks the effective declaration and current
processor binding. A changed binding is re-requested; a stale claim cannot publish. The transaction
settles the canonical job and admits the next step when `done: false`; workflow dispatch starts only
after the transaction/activity completes. Projection jobs use the stream's entity as their background
scope, so one entity's streams run one step at a time; the settled job's workflow dispatches the
continuation.

### Waiting for input repair

A projection can declare `inputRepairScriptSlug`, naming a direct script in the same plugin revision.
Ingestion validates its complete direct-script dependency closure. It permits user-work admission,
user-data event/command writes, and the required read capabilities, but not bootstrap scripts,
workflows, HTTP, signals, notifications, integrations, global writes, or escaping capabilities. The
projection processor itself remains read-only.

Before admitting the first processor step, the kernel admits one ordinary background user-script
root with `EventStreamInputRepairInput`: `{ entityId, requestKey }`. The request key is stable for the
account generation, exact installation and revision/configuration binding, entity, repair script, and
repair epoch. Streams using that repair binding share this root. New ordinary schemas join the
current epoch and reuse its succeeded root; ordinary source writes do not advance the epoch.

The repair script must perform its initial reset/correction step before returning `null`. Returning
`null` means that invocation succeeded, not that all repair descendants or projections are ready. It
may admit existing user-work descendants for later pages. Its trusted user subject carries
`afterHooks: "skip"`, inherited by durable descendants: before policies, validation, receipts, source
revision changes, and projection admission still run, but item and batch after hooks do not.

`event_stream.repair_epoch` and `event_stream_work.input_repair_job_id` retain this runtime admission
state; neither is archived. Restore fences streams with its deterministic run identity inside the
atomic data transaction, including reused bootstrap entities. A previous succeeded root therefore
cannot admit projection work for restored history, even when retained readiness values happen to
equal the destination's initial source revision. Failed or unavailable repair stays pending.

Root success releases projection admission in keyset pages of at most 100. Claims commit before
workflow dispatch. Startup and post-restore workflow bodies drain discovery, admission, and common
background recovery, so crashes before dispatch or between root success and release do not wait for
the frequent cron. The referenced root remains protected from background-work pruning.

The first durable admission of each shared root also advances the account-wide relationship input
fence in the same transaction. Reusing the root across streams does not advance it again. Event-owned
`projection-readiness.ts` supplies one declaration-driven required-target relation for discovery and
relationship readiness. It includes retained input and mapping-only targets even before their streams
exist; a missing/unbound stream cannot count as complete. Readiness requires exact current account,
installation, processor and repair pins/epoch, successful roots, completed current stream revisions,
and no active trusted silent user-script roots or descendants. It takes no stream locks.

A processor that depends on asynchronous source repair must verify retained readiness evidence before
returning `done: true`. Read that evidence and its current source-scope revision in one RyotQL
document. A completed marker alone is insufficient: the marker must cover the current source revision.
Declare the source inputs, repair evidence, and readiness marker as inputs. The plugin owns the
meaning of readiness; the stream revision fences the complete declared input set.

When evidence is missing, unfinished, or belongs to an older source revision, return exactly:

```ts
{ done: false, waitingForInputs: true, checkpoint: null, updates: [] }
```

This settles the current background job without admitting a continuation. The stream keeps that job
as its current job and has no completed revision, so readers continue to see `pending`. This parked
state survives restart and does not poll or consume worker steps. A declared input write clears the
current job and resets the checkpoint. Source-change lifecycle planning admits a fresh step in the same
transaction, even when no automation hook matches, and retains its job ID in the mutation receipt.
The existing after-commit owner dispatches that job; reconciliation recovers missed dispatches. Binding
changes also restart the stream. If an input changes between the processor's read and the waiting
commit, the revision fence rejects the old result and arranges fresh work, preventing a lost wakeup.
Failed or absent repair remains pending until its owner supplies valid input; it is never ready zero.

Waiting is for a verified input condition, not an incomplete page scan or a transient read failure.
Continue a bounded scan with ordinary `done: false` and its checkpoint. Let a failed read fail the
step so the existing retry path can run it again. A processor must finish locating its readiness
evidence before it parks; a truncated page does not prove that evidence is missing.

RyotQL exposes `event.projection` only for completed work whose claimed revision matches the stream,
whose plugin revision and configuration pin are current, and whose plugin and installation are
active and ready. This hides values made stale by source changes or binding changes. `projectionStatus`
is pending, ready, failed, or none when the event schema has no projection.

The same freshness gate protects `event_projection.properties`, which is nullable while stale. It
also checks the account generation and that the event still belongs to the projection's stream;
finishing an old stream cannot expose values for an event moved to a new entity. Current binding
checks are evaluated once per query for the reader's stream set rather than decoding the binding pin
for each source event.

Publishing changes only projection rows and stream-work state. It does not write source-event
properties, source revisions or timestamps, or lifecycle events. Backup restore seeds streams from
restored events; declaration-driven reconciliation finds streams with missing or stale processor
bindings and requests work for the current declaration. See [background work](../background-work/README.md)
for common admission, dispatch, and recovery ownership.

Restore passes session and property references into stream seeding and takes reference locks before
inserting historical events. Reconciliation also discovers missing target streams from current
declarations and retained inputs in batches of 100. Mapping evidence alone can seed a target stream;
an output event need not exist yet. Discovery inserts missing stream identities without advancing
existing revisions, then ordinary binding reconciliation admits the current processor. Invalidation
updates all affected revisions atomically; the 100-update processor page bound does not truncate
dependency fanout. Reconciliation binds and admits existing streams before discovery and between
discovery pages. Dependency resolution joins selected inputs and mapping edges as sets; mapping
evidence also supplies its own target without requiring an observation.

Admission locks the account before stream state, matching account reset. Dirty-stream admission
failures are isolated per stream and move that candidate to the end of the bounded selection, so an
unavailable processor cannot block healthy streams.

After completed processing or a failure, the service emits a user-scoped `projection-updated` entity
hint. The hint carries no projection data. Readers refresh from RyotQL and can poll while
`projectionStatus` is pending.
