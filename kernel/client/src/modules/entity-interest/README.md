# Entity Interest

`EntityInterestService` is an Effect service with synchronously constructed state and direct operations:

- `watch(scope, { foreground, visible }, onUpdate)` returns `{ update(interest), dispose() }`.
- `acquire(scope)` starts the authenticated layout session and returns its idempotent release function.
- `reconnect(scope)` reconnects only the active matching server/user scope.

Owners can declare interest before the layout effect starts. Scope matching uses `apiScopeKey`, not
object identity. Releasing a session clears its owners and makes their old handles inert. A new scope
also discards declarations for other scopes. Runtime disposal releases the active session.

## Selection And Protocol

Selection deduplicates IDs, sorts within each priority, and selects foreground before visible, up to
500 IDs. Additions batch for 100 ms. Removed IDs remain selected for two seconds, but receive no
callbacks after their owner drops them. New demand evicts grace entries when the selection is full.

The ticket port runs through `AuthenticatedApi`. The WebSocket URL comes from `serverApiUrl` and has
no credentials or query string. Its first frame is `authenticate` with a fresh ticket. After `ready`,
the first command is `replace` revision 1, even for an empty selection. Later commands are diffs,
with at most one unacknowledged command. Reconnect always gets another ticket and replays selection
from revision 1; server fixed-lease expiry uses the same reconnect path.

All server frames pass the contract decoder. Invalid frames, duplicate readiness, rejected commands,
and mismatched acknowledgements close and retry. Ticket/open/readiness has a 15-second timeout.
Application `ping` gets the matching `pong`; missed heartbeats also reconnect. Backoff starts at one
second and caps at 30 seconds. Ready resets backoff. Socket callbacks check both attempt and socket
identity, so a closed connection cannot deliver updates or affect its replacement.

## Lifecycle And Adapters

`EntityInterestTransport` owns WebSocket construction, scheduling, browser visibility and online
listeners, and native Capacitor resume. Hidden/offline state stops transport; resuming gets a fresh
ticket. Cleanup cancels tickets, timers, socket handlers, browser listeners, and native listeners,
including native listener registration that resolves after release.

The direct adapter attaches watches through the kernel runtime's narrow `runSync` capability.
The authenticated layout owns socket lifetime, not the loader-created client. Preferences saves
reconnect only after a successful update containing the language field; startup never reads settings.

Bridge version 1 accepts `entity-interest` declarations and sends matching `entity-updated` frames.
Each plugin document has one mutable owner and no request IDs or acknowledgements for interest.
Interest is separate from the 64 pending requests. Common bridge finish disposes the owner. Transport
failure never fails the iframe or UI, and listener exceptions cannot stop other owners' delivery.

Tests inject an API layer, a plain recording socket factory, a deterministic scheduler, and lifecycle
signals. `KernelApiTestLayer` supplies a harmless service for unrelated authenticated route tests.
