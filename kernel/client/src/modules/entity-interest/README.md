# Entity Interest

`EntityInterestService` is synchronously constructed. `watch` returns a mutable, idempotently
disposable owner; `acquire` starts the authenticated server/user session and returns its release
function; `reconnect` affects only the matching active scope.

Owners can declare interest before session acquisition. Scopes compare by `apiScopeKey`. Releasing a
session clears its owners, and changing scope discards declarations for the previous scope.

## Selection

Selection deduplicates IDs, orders them lexically within priority, and chooses foreground before
visible up to 500 IDs. Additions batch for 100 ms. Removed IDs remain selected for a two-second grace
period but receive no callbacks; new demand evicts grace entries when capacity is full.

## Transport

The authenticated ticket port supplies a fresh ticket for each connection. The WebSocket URL has no
credentials or query string; its first frame authenticates with the ticket. After `ready`, the client
sends a full `replace` at revision 1, then sends diffs with at most one unacknowledged command.
Reconnect always restarts at revision 1 with current selection.

All frames use contract decoders. Invalid frames, duplicate readiness, rejected commands, mismatched
acknowledgements, timeout, or missed heartbeat close and retry. Connection, authentication, and
readiness share a 15-second timeout. Backoff starts at one second, caps at 30 seconds, and resets on
ready. Attempt and socket identity checks prevent closed connections from affecting replacements.

`EntityInterestTransport` owns WebSocket creation, scheduling, browser visibility and online events,
and native Capacitor resume. Hidden or offline state stops transport; resume obtains a new ticket.
Cleanup cancels pending tickets, timers, listeners, handlers, and late native-listener registration.

The authenticated layout owns the session, not loader-created clients. A successful preference save
containing `language` reconnects it; startup does not fetch preferences.

Bridge version 1 gives each plugin document one mutable owner. Interest messages have no request IDs
or acknowledgements and do not consume one of the 64 pending requests. Common bridge teardown disposes
the owner. Transport or listener failure does not fail the iframe or other owners.
