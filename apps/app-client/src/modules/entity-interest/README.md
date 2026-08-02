# Entity Interest

The client owns one entity-interest coordinator per authenticated server and user. It uses one SSE connection for visible consumers and turns completion frames into consumer-owned refetch work.

## Coordinator

Consumers register an owner string, an entity-ID set, and an update callback. The coordinator keeps the union of all owner sets for the server declaration and an entity-to-owner index for routing. Removing an owner removes only its IDs and callback. Incoming frames are delivered only to owners indexed for that entity; the coordinator is not a cache.

The declared union is capped at the shared 500-ID limit. Declarations are single-flight, replace the server set, and coalesce changes made while a request is in flight. Disconnects and stream replacement abort stale work. Failed declarations retry with exponential delays from one second up to 30 seconds. A fresh connection redeclares the current union for catch-up.

## SSE And Batching

`EntityInterestProvider` creates a UUID, opens SSE, waits for the matching `connected` frame, and then enables declarations. The parser handles chunked SSE data and ignores comment frames. Stream failure clears the connection and retries it; terminal POST frames and SSE frames use the same owner routing path.

`useEntityUpdates` uses a single-flight batcher with a 250 ms window and a maximum of 25 entities. It keeps the latest frame per entity, starts a full batch as soon as the limit is reached, and keeps later updates pending while one batch is in flight. A failed batch is reported once and is not retried by the batcher. Disposal aborts the active request and clears pending work.

Consumers can block the batcher while their data is not ready for update processing. Updates accumulate without starting timers or requests and flush when unblocked. The callback is an update signal, not authoritative entity data.

## Saved Views

Saved views register the IDs in their loaded pages under an owner scoped by server, user, and view. They block interest updates during the initial or load-more query and during manual structural refreshes.

Each batched entity update triggers one structural refetch of the currently loaded page range. Updates that arrive while the refetch is in flight coalesce into one trailing structural refetch. A background refetch failure retains the displayed data and retries the background refetch after 30 seconds. No global invalidation or shared entity cache is used.
