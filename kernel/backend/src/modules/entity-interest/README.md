# Entity Interest

Entity interest lets authenticated clients declare which entities are visible and receive population or translation completion hints. Reads remain side-effect-free; pending interest drives background work.

## Transport

- `POST /api/entity-interest/socket-ticket` uses normal OAuth or API-key authentication and returns `{ ticket, expiresAt }` or a typed `ticket-store-unavailable` failure.
- `GET /api/entity-interest/ws` is a raw WebSocket. Credentials never appear in its URL; the first JSON text frame must be `{ type: "authenticate", ticket }`.
- A ticket is 32 random bytes encoded as an opaque value. Redis stores only its SHA-256 hash with `{ userId, preferredLanguage }` for 30 seconds. It is single-use.
- Missing, expired, reused, or malformed tickets close as `1008 Authentication failed`; ticket-store failures close as `1011 Internal error`.

## Frames

Client frames:

| `type`         | Fields                                                            |
| -------------- | ----------------------------------------------------------------- |
| `authenticate` | `ticket: string`                                                  |
| `replace`      | `revision: positive integer`, `entityIds: string[]`               |
| `update`       | `revision: positive integer`, `add: string[]`, `remove: string[]` |
| `pong`         | `nonce: string`                                                   |

Server frames:

| `type`           | Fields                                                        |
| ---------------- | ------------------------------------------------------------- | ------------- |
| `ready`          | `sessionId`, `maxEntityIds`, `heartbeatIntervalMs`            |
| `applied`        | `revision`                                                    |
| `rejected`       | `revision`, `code: "interest-limit-exceeded"`, `maxEntityIds` |
| `entity-updated` | `entityId`, `reason: "populated"                              | "translated"` |
| `ping`           | `nonce`                                                       |

After `ready`, send a complete `replace` at revision 1. Each later `replace` or `update` increments the current revision by one. Reconnect starts a new session and revision sequence. Keep at most one command unacknowledged and coalesce later changes until `applied`.

IDs are deduplicated. `update` must be non-empty and its `add` and `remove` sets cannot overlap. An empty replacement is valid. The final membership may contain at most 500 IDs; an over-limit command is rejected without partial mutation. Client-only `foreground` and `visible` priorities decide which IDs enter that set and are not sent on the wire.

`entity-updated` is a refresh hint, not entity data. `translated` also represents a completed negative-cache result. Localized child entities must be listed explicitly, and a language change requires reconnect because the ticket captures the preferred language.

## Lifetime And Delivery

| Boundary                   | Value                                                      |
| -------------------------- | ---------------------------------------------------------- |
| Ticket TTL                 | 30 seconds                                                 |
| Session and membership TTL | 15 minutes                                                 |
| Renewal interval           | 5 minutes                                                  |
| Fixed socket lease         | 15 minutes, then `4001 Session expired`                    |
| Heartbeat                  | `ping` every 25 seconds; matching `pong` within 10 seconds |
| Heartbeat failure          | `4000 Heartbeat timeout`                                   |
| Malformed protocol         | `1002 Protocol error`                                      |

Redis owns session metadata, revision, membership, reverse entity-to-session indexes, and progression leases. Every backend receives the non-durable `ryot:entity:updated` Pub/Sub stream, resolves interested sessions in Redis, and writes only to local socket mailboxes. Reconnect plus reconciliation recovers missed publications without sticky routing.

Normal close removes local routing before Redis membership and indexes. Process crashes rely on TTLs and reverse-index expiry pruning.

## Atomicity And Races

One Redis operation verifies session existence and next revision, computes the final size, then updates membership, reverse indexes, revision, and TTLs atomically. New IDs receive `pending:<revision>`; retained values survive. `applied` means this state is durable, not that reconciliation has finished.

Reconciliation runs afterward in bounded sequential chunks. It authorizes each pending entity, triggers population before translation when needed, and changes or removes membership only if the exact pending token still matches. Output uses the same token check. This prevents stale work from emitting or marking a remove-and-re-added entity. Failures retry with exponential backoff while the session remains active; a progression failure leaves the current membership pending.
