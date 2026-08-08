# Rewrite Decisions

This document records design decisions made during the V2 rewrite where V1 behavior should not be carried forward wholesale. Each entry captures context, the chosen approach, and the reasoning so the rationale stays discoverable as the codebase grows.

---

## Decision 1: Media Lifecycle State

### Context

Ryot V1 defined these default collections in `crates/models/common/src/lib.rs`:

- `Watchlist`
- `In Progress`
- `Completed`
- `Monitoring`
- `Owned`
- `Reminders`
- `Custom`

In V1, these were all modeled as collections, but they did not all mean the same thing.

- Some represented lifecycle state.
- Some represented durable user intent or subscriptions.
- Some represented provenance or system categorization.
- Some carried extra structured data.

The rewrite should separate those concerns instead of preserving the V1 shape.

### Decision

We will not port V1 default media collections directly into the rewrite.

Instead, each V1 concept will be re-modeled according to what it actually represents in the rewrite architecture:

- lifecycle and consumption history become events or event-derived state
- durable user buckets remain collections or relationships
- provenance becomes explicit metadata on entities
- scheduled reminders become dedicated persistent state, not generic collections

This follows the rewrite principles in `docs/soul.md`:

- events record something that happened to an entity
- collections are unrestricted buckets of entities
- tracker overviews should be driven by real lifecycle data rather than special-case list membership

### Classification

#### Event or event-derived state

These V1 collections were really lifecycle state and should not remain collection memberships.

**Watchlist**

- Rewrite meaning: backlog or intent to consume later
- Rewrite model: built-in media lifecycle event and derived current state
- Why: V1 already auto-removed items from Watchlist when consumption started, which means it behaved like lifecycle state rather than a user-curated bucket

**In Progress**

- Rewrite meaning: currently consuming
- Rewrite model: derived state from lifecycle events such as start, progress, complete, drop, and hold
- Why: V1 auto-managed this collection from seen state updates, so it was functioning as materialized tracker state

**Completed**

- Rewrite meaning: finished consuming
- Rewrite model: completion event and derived current state
- Why: V1 auto-managed this collection and even moved users back out of it when a show was not actually finished, which makes it a lifecycle outcome rather than a durable bucket

For shows and podcasts, the derived state uses one chronological aggregate history rather than independent historical flags. Parent completion is an authoritative consumption-cycle boundary, while later regular-episode activity starts a new cycle. This keeps imported backdated events in the correct interval, prevents completion from leaking across rewatches, and preserves append-only history without mutable lifecycle rows. Full episode coverage is `caught_up`; `complete` requires an explicit parent event or terminal production status.

#### Persistent state, not pure lifecycle events

These V1 collections represent ongoing user intent or inventory state and should stay as persistent state in the rewrite.

**Monitoring**

- Rewrite meaning: user wants update notifications for this entity
- Rewrite model: persistent relationship or other durable subscription state
- Why: background jobs need to query the current set of monitored entities directly; past monitoring events are not enough to answer that question

**Owned**

- Rewrite meaning: the user owns this item
- Rewrite model: persistent ownership state, optionally with supporting events such as acquisition
- Why: ownership is inventory state, not just historical activity; V1 also attached structured metadata like `Owned on`

**Reminders**

- Rewrite meaning: there is an active reminder associated with this entity
- Rewrite model: dedicated persistent reminder state, optionally with reminder-created and reminder-fired events
- Why: pending reminders must remain queryable until they fire, and V1 stored required reminder payload alongside the membership

#### Neither collection nor event

**Custom**

- Rewrite meaning: this item originated from manual user creation
- Rewrite model: provenance on the entity itself
- Why: this is not lifecycle and not a useful bucket; it is origin metadata

### Mapping Table

| V1 concept  | Rewrite model                       | Notes                                             |
| ----------- | ----------------------------------- | ------------------------------------------------- |
| Watchlist   | event-derived state                 | backlog intent before active consumption          |
| In Progress | event-derived state                 | current lifecycle state                           |
| Completed   | event-derived state                 | completion lifecycle state                        |
| Monitoring  | persistent relationship/state       | active subscription for metadata updates          |
| Owned       | persistent relationship/state       | inventory state with optional extra metadata      |
| Reminders   | dedicated persistent reminder state | active scheduled reminder, not generic membership |
| Custom      | entity provenance                   | manual creation origin                            |

### Product Implications

**Media overview**

The rewrite media overview should treat these as lifecycle surfaces, not collection surfaces.

- `Up Next` should come from backlog state
- `Continue` should come from in-progress state
- `Rate These` should come from completed-without-review state
- `Activity` should come from media lifecycle events

**Collections**

User collections remain real collections.

- They are for unrestricted grouping and curation.
- They should not be overloaded to carry built-in media lifecycle semantics.
- A user may still create a custom collection that feels like a watchlist, but the built-in tracker overview should not depend on that.

**Migration from V1**

When importing V1 data:

- `Watchlist`, `In Progress`, and `Completed` memberships should map into rewrite lifecycle state
- `Monitoring`, `Owned`, and `Reminders` should map into durable state models
- `Custom` should map into provenance metadata where possible

### Backend Direction

The rewrite backend should introduce built-in media lifecycle semantics instead of reserved default collections.

- Define built-in media lifecycle events.
- Derive current media state from those events.
- Keep separate persistent models for monitoring, ownership, and reminders.
- Avoid hardcoding undeletable default collections as a substitute for lifecycle state.

### Summary

- Do not recreate V1 default media collections as rewrite collections.
- Treat `Watchlist`, `In Progress`, and `Completed` as lifecycle concepts.
- Treat `Monitoring`, `Owned`, and `Reminders` as durable state.
- Treat `Custom` as provenance, not membership.
- Keep user collections available for unrestricted curation, separate from built-in media lifecycle behavior.

---

## Decision 2: Person and Company as Separate Entity Schemas

### Context

V1 stored both individual people and companies (studios, publishers, developers) in a single `person` table. The only mechanism distinguishing them was a `PersonSourceSpecifics` JSON blob containing per-provider boolean flags: `is_tmdb_company`, `is_tvdb_company`, `is_anilist_studio`, `is_giant_bomb_company`, `is_hardcover_publisher`.

This caused several concrete problems:

- Person-specific fields (`birth_date`, `death_date`, `gender`, `place`) were always present on company rows but meaningless there, producing structural noise and nullable columns with no semantic content.
- Company-specific concepts (founding year, headquarters, parent company) had no representation at all.
- The frontend people search page had to render conditional "Is this a company?" checkboxes per provider, a direct symptom of the type ambiguity.
- Detail-fetcher scripts for external APIs had to branch on the `source_specifics` flags to decide which API endpoint to call, mixing two concerns in one script.

### Decision

The rewrite will define `person` and `company` as two separate built-in entity schemas owned by the Media tracker.

This is a direct application of V2's foundational principle: entity schemas define the shape of a type of thing. Person and company are different shapes. The entity schema is the type discriminator — no runtime flags are needed.

### Schema Properties

**`person`:** `birth_date`, `death_date`, `gender`, `birth_place`, `website`, `description`, `alternate_names`, `assets`

**`company`:** `founded_year`, `headquarters`, `website`, `description`, `alternate_names`, `assets`

Both schemas are reference entities within the Media tracker. Neither is primarily tracked through events — they exist to be related to media entities via the `relationship` table.

### Relationship Modeling

Relationships between media entities and people/companies are expressed through the `relationship` table using `relType`. Examples:

- `person` → movie: `acted_in` (with `character` in properties), `directed`, `composed`
- `company` → movie: `produced_by`, `distributed_by`
- `person` → book: `authored`, `narrated`
- `company` → book: `published_by`
- `person` → game: `designed`, `voiced`
- `company` → game: `developed_by`, `published_by`

The curated media detail page renders these as separate sections ("Cast & Crew" from person relationships, "Studios & Publishers" from company relationships), which is a UX improvement over V1's single mixed list.

### External API Alignment

Every major external data provider already draws this distinction at the API level:

| Provider   | Person endpoint      | Company endpoint    |
| ---------- | -------------------- | ------------------- |
| TMDB       | `/search/person`     | `/search/company`   |
| TVDB       | `/people` API        | `/companies` API    |
| IGDB       | `involved_companies` | `companies`         |
| Giant Bomb | `/person`            | `/company`          |
| Hardcover  | author endpoints     | publisher endpoints |

Separate schemas means detail-fetcher sandbox scripts map 1:1 to their target schema with no internal branching.

### Why Not a Single Schema

A single `person` schema with an `is_organization` boolean property was considered and rejected because:

- It perpetuates the V1 pattern of overloading one type to represent two. V2 was designed so the schema is the discriminator, not a property value.
- It produces a schema whose property set is the union of both types, with each instance populating only half of it.
- It conflates the query builder's filter options — saved views would surface `birth_date` filters for entities that are companies and vice versa.
- External search UX would still need source-specific branching to know which API to call.

### Tracker Ownership

Both schemas belong to the built-in Media tracker. `docs/soul.md` lists the Media tracker as owning "movie, show, book, podcast, video game, person, and group schemas." `company` joins that list as a second reference-entity schema alongside `person`.

### Summary

- Model `person` and `company` as two distinct built-in entity schemas in the Media tracker.
- Do not carry forward V1's `PersonSourceSpecifics` flag pattern.
- Use `relType` on the `relationship` table to express all person-to-media and company-to-media associations.
- Detail-fetcher scripts target one schema each and call the appropriate provider API without branching.
- The curated media detail page renders person and company relationships as separate labeled sections.

---

## Decision 3: Real-Time Entity Work via a Ticket-Authenticated WebSocket

### Context

V1's frontend polled (`useEntityUpdateMonitor`) to detect when a partial entity became fully populated: up to ~8 requests/second per page load, each triggering a React re-render. That was a known bottleneck the rewrite set out to remove.

In the rewrite the same concept is `entity.populatedAt` (null ⇒ partial) plus, for localized users, a per-language translation overlay that is filled in the background. A client needs to (a) tell the backend which entities it currently cares about and (b) learn when the backend has finished populating or translating one of them.

### Decision

The only entity-interest HTTP endpoint is **`POST /api/entity-interest/socket-ticket`**. It is protected by the existing `AuthMiddleware` and returns `{ ticket, expiresAt }`. The backend generates 32 cryptographically secure random bytes, encodes them as unpadded base64url, stores only the SHA-256 hash in Redis, and expires the single-use ticket after 30 seconds. The ticket contains the user ID and preferred language in Redis, but never appears in the WebSocket URL, logs, close reasons, or entity-interest keys.

The WebSocket route is **`GET /api/entity-interest/ws`**. The client opens it without credentials in the URL and sends `{ type: "authenticate", ticket }` as its first JSON text frame. The backend atomically consumes the ticket, creates an opaque `sessionId`, and sends `ready` with the session ID, the 500-ID limit, and the heartbeat interval. Missing, expired, reused, and malformed tickets have the same policy failure and close behavior.

The socket carries all protocol traffic. Client messages are `authenticate`, revisioned `replace` snapshots, revisioned `update` commands with `add` and `remove`, and `pong` heartbeat responses. Server messages are `ready`, `applied`, `entity-updated`, `ping`, and `rejected`. The first interest command is `replace` revision 1. Every later command advances the revision by one; `applied` means Redis membership and reverse indexes are durable, not that population or translation has finished. After reconnecting, the client sends a new complete snapshot before incremental changes. The server rejects over-limit results atomically and sends completion signals only for current memberships.

Redis session state uses `ryot:entity-interest:session:<sessionId>`, `ryot:entity-interest:session:<sessionId>:entities`, `ryot:entity-interest:entity:<entityId>:sessions`, and `ryot:entity-interest:progress:<entityId>`. Session metadata stores the user ID, preferred language, and revision. Membership values are `watching` or `pending:<revision>`, so stale reconciliation cannot win a remove-and-re-add race.

The raw route is mounted through the direct Effect `HttpRouter` server path. `HttpRouter.serve` and native `HttpServerRequest.upgrade` preserve Bun's WebSocket upgrade implementation. Normal API routes are not converted through `HttpRouter.toWebHandler` or another Fetch round trip; Better Auth remains the exception on its existing Web handler path.

### How It Works

**Reconciler.** The reconciler (`modules/entity-interest/reconciler.ts`, `InterestReconciler`) is transport-agnostic:

1. The interest service atomically applies a revisioned replace or update to Redis membership first, so a workflow that publishes mid-reconcile still finds the session. New and previously failed IDs are `pending:<revision>`; unchanged reconciled IDs remain `watching`.
2. It reads only pending IDs through RyotQL, chunked into batches of at most `MAX_ROOT_PAGE_SIZE` ids and scoped to the entity-schema slugs visible to the caller. Per-user visibility, localization, and `translationStatus` come from the same focused read path.
3. It enqueues the existing idempotent bricks: `populatedAt === null` ⇒ `EntityPopulationTrigger.request`; populated with `translationStatus === "pending"` ⇒ `TranslationsService.requestFill`. Idempotency is `@effect/workflow` execution-id coalescing.
4. Each successful chunk becomes `watching` only when its exact pending token is still current. A stale token stops later chunks and cannot mark a removed and re-added membership.

**Completion fan-out.** Each workflow publishes one `{ entityId, reason }` message to `redisKeys.entityUpdatedChannel`. Every backend process subscribes. `EntityInterestStore` reads matching session IDs from Redis, and `LocalInterestSessions` enqueues updates only for sessions held by that process. Ownership and membership are never process-local.

**Heartbeat.** Effect beta.107 does not expose generic WebSocket control-frame ping/pong support. The server sends an unpredictable application `ping` nonce every 25 seconds and requires the matching `pong` within 10 seconds. A heartbeat timeout closes the socket with application code `4000`.

**Multi-instance routing.** Redis owns session metadata, forward membership hashes, and reverse entity-to-session sorted sets. Each backend process sends updates only through its locally owned session output mailbox, so sticky routing is not required. Session TTLs and reverse-index expiry scores clean up crashed processes.

**Populate-before-translate (unchanged).** Translation is only ever enqueued for a populated entity. Enqueuing a fill on an unpopulated entity would write an all-null overlay row that permanently mislabels the status as `none` — see `modules/entity-translation/overlay-merge.ts` (and `overlay-merge.test.ts`) for the negative-cache and no-permanent-`pending` semantics.

### Why the Earlier POST/SSE Design Was Replaced

The earlier design used a full-set POST for client-to-server interest and a separate one-way completion channel. That split required repeated full replacements when detail pages, partial recommendations, or pagination added IDs in waves, and it had separate catch-up and live-delivery paths. The ticket-authenticated WebSocket provides one authenticated session for revisioned deltas, acknowledgements, application heartbeats, reconnect snapshots, and completion signals. It also avoids placing a long-lived credential in a WebSocket URL and preserves native Bun upgrades through the direct Effect router.

### Summary

- `POST /api/entity-interest/socket-ticket` creates a single-use, 30-second ticket; `GET /api/entity-interest/ws` authenticates with that ticket as the first application frame.
- One socket carries revisioned `replace` snapshots, incremental `update` commands, `applied` acknowledgements, `entity-updated` completion signals, and application heartbeat messages.
- Redis stores session metadata, revisioned membership, `pending:<revision>` tokens, reverse indexes, and progression leases; reconnect snapshots catch up from durable state.
- Direct Effect `HttpRouter.serve` preserves native Bun WebSocket upgrades, and Redis Pub/Sub delivers only to locally owned sessions without sticky routing.
- Reads remain side-effect-free while current interest drives demand-driven population and translation.

---

## Decision 4: Side-Effect-Free Reads and the `translationStatus` Field

### Context

In V1 the frontend dispatched population jobs, coupling data-fetching to job mechanics and driving the polling loop. The rewrite's equivalent state is `entity.populatedAt === null` plus a per-language translation overlay. The question is who triggers population/translation and when.

### Decision

`GET /entities/{entityId}` and `POST /ryotql/execute` are **purely read-only**. Neither enqueues anything. All demand-driven population and translation is triggered by client interest commands on the authenticated WebSocket session (Decision 3).

`getById` still returns a localized entity and its localization state, but sources both from the read path itself rather than side effects:

- **Localized `name`/`properties`** come from RyotQL's entity resolver, which overlays the `(entity_id, language)` translation row for a non-canonical viewer (byte-identical to the bare table for canonical/no-language viewers).
- **`translationStatus`** is a normal RyotQL entity field. It returns `"pending" | "ready" | "none"` and is computed entirely in SQL via its own correlated read of `entity_translation` (the localized source coalesces that row away, so it cannot be derived from the merged columns). For a canonical reader (null session language) it constant-folds to `to_jsonb('none'::text)` with no join, keeping canonical SQL byte-identical to a query that never referenced translations. `getById` requests this field; `EntityDetail.translationStatus` stays required.

The `translationStatus` truth table (row absent ⇒ `pending`; row present with null name and empty properties ⇒ `none` negative cache; otherwise `ready`) mirrors `modules/entity-translation/overlay-merge.ts`, and its canonical language is read from a `ProviderConfig` map (`sandbox_script.metadata.providerInformation.canonicalLanguage`). RyotQL is built as a runtime dependency before the migrate/seed chain runs, so this map cannot be read at boot; it is loaded lazily on first use (always post-seed) and the success is memoized — safe because the builtin values are immutable once seeded.

### Why Read-Only Reads

Triggering work from reads makes a GET non-idempotent, couples the read contract to queue mechanics, and forces every list/detail surface to understand background jobs. Client-declared interest is a cleaner separation: reads report state, and a separate explicit signal drives work — the client names exactly the entities it cares about.

### Idempotency

Population and translation are `@effect/workflow` workflows keyed by a deterministic execution id (`populate-${entityId}`, `translate-${entityId}-${language}`) with `discard: true`, so concurrent or repeated interest commands coalesce onto a single in-flight run.

### Summary

- Reads (`getById`, RyotQL `execute`) are side-effect-free; the client never sees or drives job dispatch.
- `translationStatus` is a RyotQL entity field computed in SQL and no-op for canonical readers.
- `getById` localizes via the entity source overlay and reports status via the field; `EntityDetail.translationStatus` remains required.
- Idempotency is `@effect/workflow` execution-id coalescing (`populate-${id}`, `translate-${id}-${lang}`).

---

## Decision 5: `consumedOn` and Automation Rule Property Inheritance

### Context

V1 stored a `providers_consumed_on: Vec<String>` field on the `seen` table, recording which importers, live integrations, or streaming platforms were associated with a given seen record. The array accumulated entries over time because V1 used a single mutable `seen` row per `(user, metadata)` pair.

### Decision

**`consumedOn: string` (optional)** is added as a property to the `progress`, `complete`, `dropped`, and `on_hold` event schemas. It is not present on `backlog` or `review`, which do not represent consumption acts. Each event carries its own single optional source string. The aggregate view across an entity's history is derivable via `SELECT DISTINCT consumed_on FROM event WHERE entity_id = ?` and does not need to be stored separately.

When a subscription creates a new event from its source event — as auto-complete does when it creates a `complete` event from a 100% `progress` event — its manifest binding declares which relevant properties to forward.

The auto-complete manifest binding carries server-owned metadata:

```ts
autoCompleteBindingMetadataSchema = z.object({
    inheritedProperties: z.array(z.string()).optional(),
});
```

The subscription execution workflow passes this value as `automation.ruleMetadata`. The auto-complete script copies the declared keys from the stored event snapshot into the completion event it creates.

The built-in auto-complete binding carries `metadata: { inheritedProperties: ["consumedOn"] }`. Adding a new property to propagate in the future requires only updating that binding.

### Summary

- `consumedOn: string` (optional) is a property on `progress`, `complete`, `dropped`, and `on_hold` events.
- Each event carries its own source; the aggregate is a query over event history.
- Manifest binding `metadata.inheritedProperties` declares which source-event properties the subscription copies.
- The automation script interprets server-owned binding metadata; propagation behavior remains data-driven.
