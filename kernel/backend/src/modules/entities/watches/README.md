# Entity Interest

Entity interest lets authenticated clients declare which entities are visible and receive population, translation, or projection completion hints. Reads remain side-effect-free; pending interest drives background work.

## Transport

- `POST /api/entity-watches/socket-ticket` uses normal OAuth or API-key authentication and returns `{ ticket, expiresAt }` or a typed `ticket-store-unavailable` failure.
- `GET /api/entity-watches/ws` is a raw WebSocket. Credentials never appear in its URL; the first JSON text frame must be `{ type: "authenticate", ticket }`.
- A ticket is 32 random bytes encoded as an opaque value. Redis stores only its SHA-256 hash with `{ userId, preferredLanguage, accountGeneration }` and, for impersonated OAuth credentials, the auth session ID and expiry for 30 seconds. It is single-use. Population requests retain this account generation, so an old session cannot write after account reset.
- Missing, expired, reused, or malformed tickets close as `1008 Authentication failed`; ticket-store failures close as `1011 Internal error`.
- Ticket consumption and socket registration recheck active impersonation. Revoking the auth session closes its local impersonated sockets as `4001 Session expired`.

## Frames

Client frames:

| `type`         | Fields                                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `authenticate` | `ticket: string`                                                                                                           |
| `replace`      | `revision: positive integer`, `entityIds: string[]`, `foregroundIds: string[]`                                             |
| `update`       | `revision: positive integer`, `add: string[]`, `remove: string[]`, `addForeground: string[]`, `removeForeground: string[]` |
| `pong`         | `nonce: string`                                                                                                            |

Server frames:

| `type`           | Fields                                                                                        |
| ---------------- | --------------------------------------------------------------------------------------------- |
| `ready`          | `sessionId`, `maxEntityIds`, `heartbeatIntervalMs`                                            |
| `applied`        | `revision`                                                                                    |
| `rejected`       | `revision`, `code: "interest-limit-exceeded"`, `maxEntityIds`                                 |
| `entity-updated` | `entityId`, `reason`: `populated`, `translated`, `population-failed`, or `projection-updated` |
| `ping`           | `nonce`                                                                                       |

After `ready`, send a complete `replace` at revision 1. Each later `replace` or `update` increments the current revision by one. Reconnect starts a new session and revision sequence. Keep at most one command unacknowledged and coalesce later changes until `applied`.

IDs are deduplicated. `update` must change membership or priority; `add` and `remove` cannot overlap, `addForeground` and `removeForeground` cannot overlap, and neither foreground list may name a removed ID. An empty replacement is valid. The final membership may contain at most 500 IDs and at most 50 foreground IDs; an over-limit command is rejected without partial mutation (`rejected` with `interest-limit-exceeded`). A frame that itself lists more than 50 foreground IDs is malformed. `foregroundIds` must be a subset of `entityIds`, and both foreground lists of an `update` must name IDs in the resulting membership; a violation is a protocol error. Every other member has visible priority. A new member is foreground when it is in `addForeground`; an existing member keeps its priority unless a foreground list changes it.

Priority chooses the population level. Pending interest in an unpopulated entity requests a `base` population when visible and a `full` population when foreground. Foreground interest in a populated entity whose `relatedPopulationStatus` is `pending` also requests a `full` upgrade, with execution ID `populate-<entityId>-full-<generation>-<populatedAtMs>-<hourBucket>` (the hour bucket comes from the reconciliation clock), so a failed or lost upgrade is requested again at most once per hour per user. Visible interest never requests `full`. Reconciliation never withholds the terminal update for the related level: base and full populations each publish `populated`, and clients read `relatedPopulationStatus` to show related-data placeholders. A related-level failure adds no completion reason; its population publishes `populated` and the status reads `failed`.

`entity-updated` is a refresh hint, not entity data. `translated` also represents a completed negative-cache result. Localized child entities must be listed explicitly, and a language change requires reconnect because the ticket captures the preferred language.

`population-failed` is terminal: the population workflow publishes it after recording a provider failure, and reconciliation returns it for interest in a failed entity instead of requesting population again. It does not request translations or start population settling indicators. Translated still wins when completions coalesce.

`projection-updated` refreshes computed results after completion or failure. Its internal publication includes the owning user ID, so a shared source entity never sends one user's processing state to another user's session. Public frames omit that ID. Projection hints do not complete population progression or start population settling indicators; pending-result queries also refresh while processing to recover from missed hints.

## Lifetime And Delivery

| Boundary                   | Value                                                      |
| -------------------------- | ---------------------------------------------------------- |
| Ticket TTL                 | 30 seconds                                                 |
| Session and membership TTL | 15 minutes                                                 |
| Renewal interval           | 5 minutes                                                  |
| Fixed socket lease         | Up to 15 min; capped at auth-session expiry                |
| Heartbeat                  | `ping` every 25 seconds; matching `pong` within 10 seconds |
| Heartbeat failure          | `4000 Heartbeat timeout`                                   |
| Malformed protocol         | `1002 Protocol error`                                      |

Redis owns session metadata, revision, membership, reverse entity-to-session indexes, and progression leases. Every backend receives the non-durable `ryot:entity:updated` Pub/Sub stream, resolves interested sessions in Redis, and writes only to local socket mailboxes. Backends also receive auth-session invalidations and close matching local impersonated sockets; heartbeat checks recover from missed invalidations. Reconnect plus reconciliation recovers missed entity publications without sticky routing.

Normal close removes local routing before Redis membership and indexes. Process crashes rely on TTLs and reverse-index expiry pruning.

## Atomicity And Races

One Redis operation verifies session existence and next revision, computes the final size and foreground count, then updates membership, reverse indexes, revision, and TTLs atomically. Membership tokens carry priority (`f` or `v`): new IDs receive `pending:<revision>:<priority>` and reconciled IDs hold `watching:<priority>`. Retained values with an unchanged priority survive. A promotion re-marks the ID `pending:<revision>:f` so it reconciles again; a demotion of a pending ID re-marks it `pending:<revision>:v` with the new revision, and a demotion of a watching ID becomes `watching:v` without reconciling. `applied` means this state is durable, not that reconciliation has finished.

Reconciliation runs afterward in bounded sequential chunks. It authorizes each pending entity, triggers population before translation when needed, and changes or removes membership only if the exact pending token, including priority, still matches. Re-marking a watching entity pending after a progression failure keeps its priority. Output uses the same token check. This prevents stale work from emitting or marking a remove-and-re-added entity. Failures retry with exponential backoff while the session remains active; a progression failure leaves the current membership pending.

Population uses the stored entity's schema owner and data scope. Translation captures the exact provider script, plugin revision, configuration and account generation in a recorded activity. Retries retain that pin after compatible upgrades. Private translations remain user-owned; system translations retain shared global overlays. Overlay commits recheck the exact entity/provider and current account and installation authority in a short transaction. Quarantine blocks an in-flight translation from committing.
