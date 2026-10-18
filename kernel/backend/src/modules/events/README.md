# Events and projections

## Source facts and derived values

`event` rows are the authoritative history: their properties, entity and session references, schema,
and timestamps describe recorded facts. A declared processor writes derived values to
`event_projection`, keyed by event ID and linked to its stream. Projection output does not replace or
extend source-event properties.

An event-schema projection declaration names a processor script and an output property schema. The
schema must be strict, non-empty, contain at most 20 fields, and have no field names in common with
the source event schema. The processor must be a script owned by that plugin; validation limits it to
read-only host capabilities and disallows workflow dependencies.

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

## Stream work and freshness

A stream is keyed by user, entity, event-schema owner, and event-schema slug. Source event writes
advance its revision and dirty the stream. `requestEventStreamWork` admits one step through the common
background-work owner. The stream-specific `event_stream_work` row retains its processor binding,
checkpoint, dirty boundary, completed revision, current job, and step; the canonical queued/running/
succeeded/failed status belongs to that job's `background_work` row. A processor step receives the
current checkpoint and returns a new checkpoint, a `done` flag, and at most 100 event updates;
serialized checkpoint length is capped at 16,384.

Each step validates its declared output and publishes the page together with the new checkpoint and
stream state in one transaction. Publication requires the canonical job to be running and still be the
stream's current job at the claimed source revision, and rechecks the effective declaration and current
processor binding. A changed binding is re-requested; a stale claim cannot publish. The transaction
settles the canonical job and admits the next step when `done: false`; workflow dispatch starts only
after the transaction/activity completes. Projection jobs use the stream's entity as their background
scope, so one entity's streams run one step at a time; the settled job's workflow dispatches the
continuation.

RyotQL exposes `event.projection` only for completed work whose claimed revision matches the stream,
whose plugin revision and configuration pin are current, and whose plugin and installation are
active and ready. This hides values made stale by source changes or binding changes. `projectionStatus`
is pending, ready, failed, or none when the event schema has no projection.

Publishing changes only projection rows and stream-work state. It does not write source-event
properties, source revisions or timestamps, or lifecycle events. Backup restore seeds streams from
restored events; declaration-driven reconciliation finds streams with missing or stale processor
bindings and requests work for the current declaration. See [background work](../background-work/README.md)
for common admission, dispatch, and recovery ownership.

Admission locks the account before stream state, matching account reset. Dirty-stream admission
failures are isolated per stream and move that candidate to the end of the bounded selection, so an
unavailable processor cannot block healthy streams.

After completed processing or a failure, the service emits a user-scoped `projection-updated` entity
hint. The hint carries no projection data. Readers refresh from RyotQL and can poll while
`projectionStatus` is pending.
