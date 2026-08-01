# Entity Interest

The client owns one entity-interest coordinator per authenticated server and user. It uses one SSE connection for visible consumers and turns completion frames into consumer-owned refetch work.

## Coordinator

Consumers register an owner string, an entity-ID set, and an update callback. The coordinator keeps the union of all owner sets for the server declaration and an entity-to-owner index for routing. Removing an owner removes only its IDs and callback. Incoming frames are delivered only to owners indexed for that entity; the coordinator is not a cache.

The declared union is capped at the shared 500-ID limit. Declarations are single-flight, replace the server set, and coalesce changes made while a request is in flight. Disconnects and stream replacement abort stale work. Failed declarations retry with exponential delays from one second up to 30 seconds. A fresh connection redeclares the current union for catch-up.

## SSE And Batching

`EntityInterestProvider` creates a UUID, opens SSE, waits for the matching `connected` frame, and then enables declarations. The parser handles chunked SSE data and ignores comment frames. Stream failure clears the connection and retries it; terminal POST frames and SSE frames use the same owner routing path.

`useEntityUpdates` uses a single-flight batcher with a 250 ms window and a maximum of 25 entities. It keeps the latest frame per entity, starts a full batch as soon as the limit is reached, and keeps later updates pending while one batch is in flight. A failed batch is reported once and is not retried by the batcher. Disposal aborts the active request and clears pending work.

Consumers can block the batcher while their data is not safe to hydrate. Updates accumulate without starting timers or requests and flush when unblocked. The callback is a refetch hint, not authoritative entity data.

## Consumer Hydration

Each consumer chooses its own query and local state. A frame must not trigger broad query invalidation or a global entity cache update. Hydration should request the smallest useful projection for the affected IDs, then update the consumer-owned state. Structural changes that can alter membership, sorting, or pagination should use the consumer's normal structural refresh instead of assuming that a targeted patch is enough.

## Saved Views

Saved views register the IDs in their loaded pages under an owner scoped by server, user, and view. They block interest updates during the initial or load-more query and during manual structural refreshes.

When unblocked, a batch is filtered to loaded IDs and uses the saved view's query document with an ID predicate to hydrate those rows. The result patches the view's local normalized runtime. A structural refresh is scheduled when updates may affect membership or ordering, with the existing dirty-state timeout as a fallback. No global invalidation or shared entity cache is used.

## Future Consumers

- Detail: discovery registers the ID found by the detail query; hydration reruns the detail projection for that ID and updates the local screen state.
- Recommendations: discovery registers IDs in the visible recommendation result; hydration reruns the recommendation projection for affected IDs, or the bounded result when ranking or filters may change.

In both cases, discovery identifies interest and hydration is a consumer-owned query. The coordinator only joins, routes, and batches update signals.
