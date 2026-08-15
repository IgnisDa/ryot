# Entity Interest

Entity interest lets authenticated clients select the entities they display and receive population or translation completion notices without coupling reads to background work. One ticket-authenticated WebSocket carries authentication, interest commands, acknowledgements, heartbeats, and completion signals.

## Protocol

- `POST /api/entity-interest/socket-ticket` is the only entity-interest HTTP endpoint. It accepts the normal OAuth or API-key authentication middleware and returns `{ ticket, expiresAt }`.
- `GET /api/entity-interest/ws` is a raw WebSocket route. The client sends no credential in the URL and sends `{ type: "authenticate", ticket }` as its first JSON text frame.
- Tickets are opaque, single-use values generated from 32 cryptographically secure random bytes. Each ticket stores only `userId` and `preferredLanguage`; Redis stores only its SHA-256 hash for 30 seconds. Missing, expired, reused, and malformed tickets close with the generic authentication close `1008` (`Authentication failed`). A ticket-store outage closes with `1011` (`Internal error`).
- After authentication, the server creates an opaque `sessionId` and sends `ready` with `sessionId`, `maxEntityIds`, and `heartbeatIntervalMs`.

Client commands are `replace` with a complete `entityIds` snapshot, `update` with `add` and `remove` deltas, and `pong` responses. Every `replace` or `update` carries a revision. The first command is `replace` revision `1`; each later command increments the current revision by one. The server sends `applied` when Redis membership and indexes are durable for that revision, before reconciliation begins.

After `ready`, the client sends one complete `replace` snapshot. Connected updates use revisioned `update` commands. Reconnect discards the prior socket state and revision, then sends a new complete snapshot. The client keeps at most one unacknowledged command and coalesces changes while waiting for its `applied` message.

Commands deduplicate IDs. An `update` rejects an ID present in both `add` and `remove`, and empty `add` and `remove` arrays are invalid. Replacing with an empty set is valid. The client selects at most 500 IDs using the `foreground` and `visible` priorities; the server rejects any resulting membership above `MAX_INTEREST_ENTITY_IDS` without partial mutation. Priorities are client selection policy and are not sent to this WebSocket.

The server sends `entity-updated` messages with an entity ID and `populated` or `translated` reason. These are refresh hints, not authoritative entity data. A translated completion also covers a completed negative-cache translation result.

## Redis State And Lifetime

Redis owns shared membership, revision state, and delivery lookup. The keys are:

- `ryot:entity:updated`: Pub/Sub channel for `{ entityId, reason }` messages.
- `ryot:entity-interest:ticket:<sha256-ticket>`: single-use ticket value containing the user ID and preferred language.
- `ryot:entity-interest:session:<sessionId>`: session hash with `userId`, `preferredLanguage`, and `revision`.
- `ryot:entity-interest:session:<sessionId>:entities`: membership hash with `watching` or `pending:<revision>` per entity ID.
- `ryot:entity-interest:entity:<entityId>:sessions`: reverse sorted set of interested session IDs, scored by session expiry in milliseconds.
- `ryot:entity-interest:progress:<entityId>`: per-entity progression lease.

Session and membership keys have a 15-minute TTL. Renewal runs every five minutes and refreshes session metadata, membership TTLs, and reverse-index expiry scores. Every established session also has a fixed 15-minute lease, then closes with application code `4001` (`Session expired`); clients obtain a new ticket and reconnect. If renewal finds missing session metadata, the socket closes and the client reconnects. Expired reverse members are removed during lookup. Ticket keys expire after 30 seconds.

## Replacement, Updates, And Reconciliation

The atomic replace/update operation verifies that the session exists, requires the incoming revision to be the current revision plus one, deduplicates inputs, calculates the final count before mutation, and rejects over-limit commands without partial state changes. It removes dropped memberships and reverse-index entries, preserves retained membership values, adds new IDs as `pending:<incomingRevision>`, refreshes retained and added reverse-index scores, updates the revision and TTLs, and returns every current pending entity with its token.

Reconciliation runs separately from command processing in sequential chunks of `MAX_ROOT_PAGE_SIZE`. The command is acknowledged immediately after the Redis operation, so reconciliation does not block later socket work. A worker reconciles pending entity/token pairs, retries failures with exponential backoff while the session remains active, and changes a membership to `watching` only when its exact pending token still matches. Authorization-filtered memberships and reverse indexes are removed with the same exact-token check. Terminal updates perform the token-specific transition in the output writer, so remove-and-re-add races cannot let stale work emit or mark the new incarnation. A progression failure marks a still-current membership pending at the current session revision.

Population runs before translation. Localized reads remain side-effect-free; pending interest drives demand-driven population and translation workflows. Completion messages are emitted only for current memberships and use the same `entity-updated` message as Redis Pub/Sub completions. There is no separate terminal response.

Translation demand is evaluated for each exact interested entity ID. Clients that display localized child entities must include those child IDs in their interest snapshot. A socket session keeps the preferred language captured by its authentication ticket; clients reconnect after changing that preference.

## Heartbeat, Delivery, And Cleanup

Effect beta.107 does not expose generic WebSocket control-frame ping/pong support, so the protocol uses application messages. After authentication, the server sends `ping` with an unpredictable nonce every 25 seconds. The client must return the matching `pong` within 10 seconds. A heartbeat timeout closes the socket with application code `4000`.

Every backend process receives Redis completion publications, resolves interested session IDs from Redis, and sends only through locally owned session output mailboxes. This preserves multi-instance delivery without sticky routing. Pub/Sub is live and non-durable; a reconnect snapshot and reconciliation catch up from durable entity state.

On normal close, local session routing is removed first, then Redis removes reverse-index memberships and deletes session metadata and membership keys. Cleanup failures are logged after local cleanup. Process crashes rely on TTLs and reverse-index expiry pruning.

## Server Integration

The backend serves the route through the direct Effect `HttpRouter` path: the top-level server uses `HttpRouter.serve`, and the route upgrades the native `HttpServerRequest` so Bun's WebSocket implementation remains available. Normal API routing is not round-tripped through a Fetch-compatible Web handler. Better Auth remains on its existing Web handler path.
