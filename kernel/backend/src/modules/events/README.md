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

The processor runs with the user-scoped `event-projection` subject and that account generation. This
subject has read-only authority. The `event_projection` RyotQL table is also a read-only subject,
visible through its parent event's ownership.

## Stream work and freshness

A stream is keyed by user, entity, event-schema owner, and event-schema slug. Source event writes
advance its revision and queue or dirty the stream. Work retains its processor pin, checkpoint,
claimed source revision, and status. A processor step receives the current checkpoint and returns a
new checkpoint, a `done` flag, and at most 100 event updates; serialized checkpoint length is capped
at 16,384.

Each step validates its declared output and publishes the page together with the new checkpoint and
work state in one transaction. The commit requires the same running claim and source revision, and
rechecks the effective declaration and current processor binding. A changed binding is re-requested;
a stale claim cannot publish. `done: false` queues the next step.

RyotQL exposes `event.projection` only for completed work whose claimed revision matches the stream,
whose plugin revision and configuration pin are current, and whose plugin and installation are
active and ready. This hides values made stale by source changes or binding changes. `projectionStatus`
is pending, ready, failed, or none when the event schema has no projection.

Publishing changes only projection rows and stream-work state. It does not write source-event
properties, source revisions or timestamps, or lifecycle events. Backup restore seeds streams from
restored events; declaration-driven reconciliation finds streams with missing or stale processor
bindings and requests work for the current declaration.

After completed processing or a failure, the service emits a user-scoped `projection-updated` entity
hint. The hint carries no projection data. Readers refresh from RyotQL and can poll while
`projectionStatus` is pending.
