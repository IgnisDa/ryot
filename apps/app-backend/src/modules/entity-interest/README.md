# Entity Interest

Entity interest lets clients request population or translation for entities they currently display and receive completion notices without coupling reads to background work.

## Protocol

- `GET /api/entity-interest/stream?streamId=<uuid>` opens an authenticated SSE stream. Client creates UUID, waits for `connected`, and reuses same ID in declarations.
- `POST /api/entity-interest` accepts `{ streamId, entityIds }`. Each declaration replaces prior set and returns already-terminal entities as `{ terminal: { entityId, reason }[] }`.
- SSE sends `entity:updated` frames with `{ entityId, reason }`, where reason is `populated` or `translated`, plus `: ping` comments every five seconds.

Clients must ignore SSE comment lines, buffer early completions, and deduplicate by entity ID. Terminal entities can appear in both POST response and SSE stream. Completion reasons are refetch signals: `translated` includes negative-cache outcomes where provider returned no translation.

## Reconciliation

Interest is registered before reconciliation so a workflow completing during query cannot publish into a gap. A newer declaration can replace interest while an older reconciliation is running, so terminal results are filtered against current set before return.

Reconciliation reads visible entities through query engine in sequential chunks of 100. Declarations are truncated to 500 IDs, bounding request to five query transactions.

Rows follow strict order:

1. Unpopulated entity with provider provenance requests ensure-mode population.
2. Unpopulated user-authored entity is terminal because it cannot be populated.
3. Populated entity with pending translation and required provenance requests translation.
4. Remaining rows are terminal.

Translation must never run before population. Doing so can write all-null overlay, which is interpreted as permanent negative cache.

Reconciliation and enqueue failures are logged and treated as no terminal catch-up; declaration still succeeds. Pending state allows later declarations to retry.

## Localization Status

Localized reads overlay translation name and properties onto canonical entity; translated values win while canonical-only properties remain. Sorting and filtering use overlaid name.

`translationStatus` is `none` for canonical-language readers and unpopulated entities, `pending` when non-canonical overlay row is absent, `none` for all-null negative-cache row, and `ready` otherwise. Canonical language is read from active provider script metadata per query rather than cached at startup.

## Streams And Ownership

Stream ID belongs to user who opened it. Unknown streams and wrong-owner streams both return `NotFound` so endpoint does not reveal stream existence.

Registry state is process-local. Declaration must reach process holding SSE connection; multi-instance deployment requires sticky routing or shared registry redesign.

Registry uses one duplicated Redis subscriber connection per process because ioredis subscriber mode cannot issue ordinary commands. Malformed messages are dropped rather than terminating subscriber. Stream heartbeat is merged with push stream so disconnect tears down both.

Population and translation workflows publish only after durable state change. Query engine supplies visibility, localization, and translation status; Redis carries completion messages but does not own message vocabulary.
