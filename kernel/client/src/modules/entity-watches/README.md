# Entity Interest

`EntityWatchService` is synchronously constructed. `watch` returns a mutable, idempotently
disposable owner; `acquire` opens the authenticated server/user session and returns its release
function; `reconnect` affects only the matching active scope. `derivedDataUpdates` is a scope
stream that emits on each `derived-data-updated` frame and on every connection after the first,
since a reconnect may have missed frames. The authenticated layout runs it into
`mutationCompleted.hint`, so open pages refresh derived results and background-work status.

Owners can declare interest before session acquisition. Scopes compare by `apiScopeKey`. Releasing a
session clears its owners, and changing scope discards declarations for the previous scope.

## Selection

Selection admits the active client-page frame before retained frames, then deduplicates IDs, orders
them lexically within each owner group and priority, and chooses foreground before visible up to 500
IDs. Up to 50 IDs from active owners' foreground declarations are `interactive`; every other selected
ID is `background`. Retained frames contribute background priority only. Activation changes refresh
selection even when declarations do not change.

## Asking for population

Selection changes batch for 100 ms, then the client posts the IDs it has not yet asked about to
`POST /entities/populate`, at most 100 per request and one request per priority. An ID asked about
in the background is asked again when it becomes interactive. The server queues provider work only
for entities with missing or stale data or a missing translation, so an unchanged page costs nothing.
A failed request forgets its IDs so the next batch retries them. A `populated` frame, or an
`enrichment-updated` frame for an interactive ID, forgets that ID, because a finished step may leave
more work for a page that is still open. Each new connection forgets every ID.

## Transport

`GET /events` is a server-sent event stream for the signed-in user. It opens with a `connected`
event and then carries `entity-updated` frames (the entity ID and a `populated`, `translated`, or
`enrichment-updated` reason) addressed to users who asked about that entity, and
`derived-data-updated` frames, which the server spaces at least three seconds apart per stream. A
comment line every 25 seconds keeps intermediaries from closing it. Ending an impersonation session
closes its streams.

Frames reach only owners that declared the entity as foreground or visible. Stream failure
reconnects with backoff starting at one second, capped at 30 seconds, and reset on connection.
Attempt identity checks prevent closed streams from affecting replacements.

`EntityWatchTransport` owns scheduling, browser visibility and online events, and native Capacitor
resume. Hidden or offline state stops the stream; resume reconnects. Cleanup cancels pending timers,
listeners, and late native-listener registration.

The authenticated layout owns the session, not loader-created clients. A successful preference save
containing `language` reconnects it; startup does not fetch preferences.

Bridge version 1 gives each plugin document one mutable owner. Interest messages have no request IDs
or acknowledgements and do not consume one of the 64 pending requests. Common bridge teardown disposes
the owner. Transport or listener failure does not fail the iframe or other owners.
