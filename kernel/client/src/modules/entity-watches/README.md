# Entity Interest

`EntityWatchService` is synchronously constructed. `watch` returns a mutable, idempotently
disposable owner; `acquire` starts the authenticated server/user session and returns its release
function; `reconnect` affects only the matching active scope.

Owners can declare interest before session acquisition. Scopes compare by `apiScopeKey`. Releasing a
session clears its owners, and changing scope discards declarations for the previous scope.

## Selection

Selection admits the active client-page frame before retained frames, then deduplicates IDs, orders
them lexically within each owner group and priority, and chooses foreground before visible up to 500
IDs. The foreground subset sent with the selection comes only from active owners' foreground
declarations, sorted and capped at 50 IDs; retained frames contribute visible priority only.
Activation changes refresh selection even when declarations do not change. Additions batch for
100 ms. Removed IDs remain selected, with their previous priority, for a two-second grace period but
receive no callbacks; new demand evicts grace entries when capacity is full.

## Transport

The authenticated ticket port supplies a fresh ticket for each connection. The WebSocket URL has no
credentials or query string; its first frame authenticates with the ticket. After `ready`, the client
sends a full `replace` (with `foregroundIds`) at revision 1. Later commands also carry the complete
membership and foreground sets; the client suppresses unchanged pairs, waits for acknowledgment, and
sends only the latest pair, so at most one command is unacknowledged. Reconnect always restarts at
revision 1 with current selection.

A full frame carries up to 550 IDs: 500 members plus 50 repeated foreground IDs. With 36-byte UUIDs
and a single-digit revision its JSON payload is 21,513 bytes (21,521 bytes including the masked
client WebSocket header), below the server's 1-MiB WebSocket payload limit; each additional revision
digit adds one byte. With fast acknowledgments, sustained declaration churn can produce about ten
full snapshots per second through 100-ms batching: about 215 KB/s of JSON. Grace expiry can emit
additional snapshots, so batching is not a strict rate limit. This trades larger changed frames for a
single command model; it does not promise a measured bandwidth reduction. IDs are strings, so this
UUID budget is not a general frame-size limit.

All frames use contract decoders. Invalid frames, duplicate readiness, rejected commands, mismatched
acknowledgements, timeout, or missed heartbeat close and retry. Connection, authentication, and
readiness share a 15-second timeout. Backoff starts at one second, caps at 30 seconds, and resets on
ready. Attempt and socket identity checks prevent closed connections from affecting replacements.

`EntityWatchTransport` owns WebSocket creation, scheduling, browser visibility and online events,
and native Capacitor resume. Hidden or offline state stops transport; resume obtains a new ticket.
Cleanup cancels pending tickets, timers, listeners, handlers, and late native-listener registration.

The authenticated layout owns the session, not loader-created clients. A successful preference save
containing `language` reconnects it; startup does not fetch preferences.

Bridge version 1 gives each plugin document one mutable owner. Interest messages have no request IDs
or acknowledgements and do not consume one of the 64 pending requests. Common bridge teardown disposes
the owner. Transport or listener failure does not fail the iframe or other owners.
