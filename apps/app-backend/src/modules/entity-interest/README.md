# Entity Interest

Entity interest lets authenticated clients declare the entities they display and receive population or translation completion notices without coupling reads to background work.

## Protocol

- `GET /api/entity-interest/stream?streamId=<uuid>` opens an authenticated SSE stream. The client creates a UUID, waits for `connected`, and reuses that ID in declarations.
- `POST /api/entity-interest` accepts `{ streamId, entityIds }`. Each declaration replaces the previous set and returns already-terminal entities as `{ terminal: { entityId, reason }[] }`.
- SSE sends `entity:updated` frames with `{ entityId, reason }`, where `reason` is `populated` or `translated`, and sends `: ping` comments every five seconds.

Unknown streams and wrong-owner streams both return `NotFound`. Clients wait for `connected`, ignore comments, and deduplicate by entity ID. A terminal entity can appear in both the POST response and SSE. Reasons are refetch signals; `translated` also covers a completed negative-cache translation result.

## Redis State And Lifetime

Redis owns shared membership and delivery lookup. The keys are:

- `ryot:entity:updated`: Pub/Sub channel for `{ entityId, reason }` messages.
- `ryot:entity-interest:stream:<streamId>`: stream hash with `userId`, `preferredLanguage` (empty string for null), and `generation`.
- `ryot:entity-interest:stream:<streamId>:entities`: membership hash with `pending` or `watching` per entity ID.
- `ryot:entity-interest:entity:<entityId>:streams`: reverse sorted set of interested stream IDs, scored by expiry time in milliseconds.
- `ryot:entity-interest:progress:<entityId>`: 30-second progression lease.

The stream and membership keys have a 15-minute TTL. Opening, replacing, and renewing refresh them; renewal runs every five minutes and refreshes reverse-index expiry scores. If renewal finds missing stream metadata, the SSE connection ends with `NotFound` so the client reconnects. Expired reverse members are removed during lookup. A declaration is truncated to the first 500 input IDs and then deduplicated; it is not rejected for exceeding the limit.

## Replacement And Reconciliation

Interest is registered before reconciliation. The replacement script removes old memberships, preserves `watching` state for retained IDs, marks new IDs as `pending`, updates the preferred language, refreshes TTLs, and increments `generation`. It returns every currently pending ID.

Reconciliation runs only for returned pending IDs, through visible RyotQL rows in sequential chunks of 100. After each chunk, `pending` rows become `watching` only if the generation is still current. A stale reconciliation cannot mark or return terminal updates, stops the remaining chunks immediately, and terminal results are also checked against current membership. At most five RyotQL query transactions are used for one 500-ID declaration. A pending enqueue or reconciliation failure leaves the ID pending for a later declaration.

Rows progress in this order:

1. An unpopulated entity with provider and external-ID provenance enqueues ensure-mode population.
2. An unpopulated entity without that provenance is terminal with `populated`.
3. A populated entity with pending translation enqueues a fill when the user has a non-null language and the required provenance.
4. All other rows are terminal: `ready` is `translated`; other terminal statuses are `populated`.

Translation never runs before population. An early translation can write an all-null overlay, which is the permanent negative-cache representation.

## Localization And Progression

Localized RyotQL reads overlay translation name and properties onto the canonical entity. Translated values win, canonical-only properties remain, and sorting and filtering use the overlaid name.

`translationStatus` is `none` for a null-language query, missing provider or canonical language, canonical-language readers, and unpopulated entities. It is `pending` when a non-canonical overlay is absent, `none` for an all-null negative-cache row, and `ready` otherwise. Canonical language comes from provider metadata in the query, not startup state.

After a `populated` message, one process at a time holds the per-entity progression lease. It reads active stream metadata, removes null languages, deduplicates languages, resolves the current provider canonical language, and enqueues fills only for distinct non-canonical languages. A contended lease is tried again after 29 seconds. Progression dispatch is retried up to three times. A final failure marks the entity pending for each captured stream that is still interested, then logs the failure so a later declaration retries progression.

Population and translation enqueue calls use deterministic workflow IDs (`populate-<entityId>` and `translate-<entityId>-<language>`) with discard mode, so duplicate requests coalesce. Enqueue failures are logged and propagated; because reconciliation has not marked the ID as `watching`, a later declaration can retry. Population completion publication retries every 30 seconds. Publishers emit only after the durable state change.

## Delivery, Reconnect, And Cleanup

Each process keeps only a map of `streamId` to an SSE enqueue callback. It does not keep membership or ownership state locally. Every process has a duplicated Redis subscriber connection because an ioredis subscriber connection cannot issue ordinary commands. Each subscriber receives the shared channel message, reads interested stream IDs from Redis, and invokes the callback local to that process. This gives multi-instance delivery without process-affine routing.

Pub/Sub is live, not durable: malformed messages are dropped, subscriber reconnects re-subscribe, and missed messages are not replayed. A client reconnect creates a new stream and redeclares its current union; registration and reconciliation catch up from durable entity state.

On normal stream close, local callback state is removed first, then Redis removes reverse-index memberships and deletes stream metadata and membership keys. Close failures are logged after local cleanup. After a process crash, local callbacks disappear with the process; Redis TTLs and expiry scores remove the orphaned state, and later reverse-index lookups prune stale members. Heartbeats are merged with the SSE push stream so disconnect runs the same cleanup.
