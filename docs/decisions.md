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

## Decision 3: Real-Time Entity Work via SSE and a Client-Declared Interest POST

### Context

V1's frontend polled (`useEntityUpdateMonitor`) to detect when a partial entity became fully populated: up to ~8 requests/second per page load, each triggering a React re-render. That was a known bottleneck the rewrite set out to remove.

In the rewrite the same concept is `entity.populatedAt` (null ⇒ partial) plus, for localized users, a per-language translation overlay that is filled in the background. A client needs to (a) tell the backend which entities it currently cares about and (b) learn when the backend has finished populating or translating one of them.

### Decision

Two ordinary HTTP endpoints, both authenticated through the existing auth middleware (session cookie for web; bearer or api key for native) — no subprotocol token, no bespoke `Origin` or CSRF handling:

- **`GET /api/interest/stream?streamId=<uuid>`** — a Server-Sent Events (SSE) stream, declared as an ordinary `HttpApiEndpoint` on the `interest` group (`handleRaw`, returning `HttpServerResponse.stream` instead of a JSON body) — so it appears in the generated API docs (`/docs`) alongside every other route, unlike the old WebSocket gateway. The client generates a `streamId` (a UUID) and opens this as a long-lived GET. The first event is `connected`, with data `{ streamId }`. Completions arrive as `entity:updated` events with data `{ entityId, reason }`, where `reason` is `"populated"` or `"translated"`. A bare `: ping` comment line is sent every 25000ms (`HEARTBEAT_INTERVAL_MS`) so intermediary proxies do not close the idle connection.
- **`POST /api/interest`** — part of the `effect/platform` `HttpApi` contract, `AuthMiddleware`-protected. Body `{ streamId, entityIds }` (Effect `Schema`, `apps/app-backend/src/modules/interest/messages.ts`). Replace semantics: each call supersedes the interest set previously declared for that stream. Returns `{ terminal: {entityId, reason}[] }`, the entities that were already terminal at reconcile time and still present in that stream's current interest set, for immediate catch-up.

Ryot is self-hosted and, in practice, single-instance, so there is no meaningful payoff from a persistent bidirectional socket here. Ordinary request/response for declaring interest, and a one-way push for completions, is simpler and reuses the normal HTTP auth and CORS path instead of re-deriving equivalents for a WebSocket upgrade.

### How It Works

**Reconciler (unchanged glue, different caller).** The reconciler (`modules/interest/service.ts`, `InterestReconciler`) is transport-agnostic and unchanged by this migration:

1. The `POST /api/interest` handler (`modules/interest/routes.ts`, alongside the `GET /api/interest/stream` handler in the same `interest` group) updates the `StreamRegistry` interest set for that `streamId` first, so a workflow that publishes mid-reconcile still finds the stream.
2. It reads the interest set through the query engine, chunked into batches of at most `MAX_ROOT_PAGE_SIZE` ids (there is no `in` operator, so the id filter is an `or`-of-`eq`), scoped to the entity-schema slugs visible to the caller. Per-user visibility, localization, and the `translationStatus` computed field all fall out of the engine for free.
3. It enqueues the existing idempotent bricks: `populatedAt === null` ⇒ `EntityPopulationTrigger.request`; populated with `translationStatus === "pending"` ⇒ `TranslationsService.requestFill`. Idempotency is `@effect/workflow` execution-id coalescing.
4. It returns the already-terminal ids, filtered down to the ids still present in that `streamId`'s current interest set (a later POST for the same stream may have changed the set while this one awaited reconcile). The route handler returns those directly in the response body as `terminal`.

Because the terminal ids are returned synchronously in the POST response, and the same completions are also published over SSE, a client may see a given entity id arrive twice: once in the POST response, and once later as an `entity:updated` SSE event. Client-side apply of `entity:updated` must be idempotent, keyed by entity id.

**Completion fan-out (unchanged).** Each workflow still publishes one `{ entityId, reason }` message to a single Redis channel, `redisKeys.entityUpdatedChannel`. `StreamRegistry` (`modules/interest/registry.ts`, formerly `WsRegistry`) owns a duplicated ioredis subscriber on that channel and fans each message out to the local SSE streams whose declared interest includes the entity id, using the same forward-index-plus-reverse-index design as before, now keyed by `streamId` instead of by socket.

**Auth.** Both endpoints sit behind the `interest` group's `AuthMiddleware`, which resolves the caller through `AuthService.currentUser` — the same resolution path (session cookie, bearer token, or api key) used by every other HTTP route, and declared once at the group level rather than checked by hand in each handler. `GET /api/interest/stream` returns 401 if auth fails and 400 if the `streamId` query param is missing (an ordinary `HttpApi` decode failure, mapped to `BadRequest` the same way as every other endpoint's param/payload errors). There is no separate `Origin` allowlist, and no subprotocol-token-to-`Cookie` translation: `GET /api/interest/stream` and `POST /api/interest` are ordinary authenticated HTTP requests, handled the same way as any other route in this backend.

**Stream ownership.** `POST /api/interest` requires the authenticated caller to own the given `streamId`, meaning the caller must be the same user whose `GET /api/interest/stream` request registered that `streamId` in `StreamRegistry`. An unknown `streamId`, or one registered to a different user, is rejected with 404 — the two cases are intentionally indistinguishable, to avoid leaking which `streamId`s exist — so one user cannot declare interest against a stream opened by someone else.

**Single-instance assumption.** Interest state lives in-process, in `StreamRegistry`, keyed by `streamId`. A `POST /api/interest` for a given `streamId` must land on the same process that is holding the matching SSE connection; there is no Redis-backed sharing of interest state across processes. This matches the self-hosted, effectively-single-instance deployment model this backend targets today. A future multi-instance deployment would need either sticky routing (so a `streamId` always reaches the process holding its SSE connection) or a shared interest store; neither is built here.

**Populate-before-translate (unchanged).** Translation is only ever enqueued for a populated entity. Enqueuing a fill on an unpopulated entity would write an all-null overlay row that permanently mislabels the status as `none` — see `docs/tasks/media-translations/README.md` for the negative-cache and no-permanent-`pending` semantics.

### Why SSE and a POST, Not a WebSocket

The reconciler is demand-driven: it needs the client to declare interest, which requires a client-to-server channel. A WebSocket satisfied that with one connection carrying both directions, but a plain POST is just as good a client-to-server channel, and SSE is just as good a server-to-client one — and, unlike a WebSocket upgrade, both are ordinary HTTP requests that reuse the same auth middleware and CORS handling as every other route in this backend, and can be declared as ordinary `HttpApiEndpoint`s on the same contract (so they show up in `/docs`) instead of a bespoke route bypassing it. The WebSocket design paid for a bespoke `Origin` allowlist for browser CSRF and a subprotocol-token-to-forged-`Cookie` translation for native clients; neither buys anything the ordinary HTTP auth path did not already provide, and the self-hosted, single-instance deployment model this backend targets gets no benefit from a persistent bidirectional socket over two ordinary endpoints.

### Summary

- `GET /api/interest/stream?streamId=<uuid>` is an SSE stream: a `connected` event first, then `entity:updated` completions, with a periodic heartbeat comment.
- `POST /api/interest` (`{ streamId, entityIds }`) replaces the stream's interest set, reconciles it through the unchanged `InterestReconciler`, and returns already-terminal entities as `{ terminal }` for immediate catch-up; the client must dedupe `entity:updated` by entity id since the same completion can also arrive over SSE.
- Completions still fan out through one Redis channel plus a per-process duplicated-connection subscriber (`StreamRegistry`, formerly `WsRegistry`), now keyed by `streamId` instead of by socket.
- Auth is the backend's normal session-cookie, bearer, or api-key resolution; there is no bespoke Origin/CSRF handling or subprotocol token.
- Interest state is in-process and single-instance: a `POST /api/interest` for a `streamId` must reach the process holding the SSE connection for that `streamId`.

---

## Decision 4: Side-Effect-Free Reads and the `translationStatus` Field

### Context

In V1 the frontend dispatched population jobs, coupling data-fetching to job mechanics and driving the polling loop. The rewrite's equivalent state is `entity.populatedAt === null` plus a per-language translation overlay. The question is who triggers population/translation and when.

### Decision

`GET /entities/{entityId}` and `POST /query-engine/execute` are **purely read-only**. Neither enqueues anything. All demand-driven population and translation is triggered by client-declared interest via the SSE stream and interest POST (Decision 3).

`getById` still returns a localized entity and its localization state, but sources both from the read path itself rather than side effects:

- **Localized `name`/`properties`** come from the query engine's entity source, which overlays the `(entity_id, language)` translation row for a non-canonical viewer (byte-identical to the bare table for canonical/no-language viewers).
- **`translationStatus`** is a new opt-in query-engine computed field, exposed via a `systemComputed` `FieldSelector` variant valid on the **root entity source only**. It returns `"pending" | "ready" | "none"` and is computed entirely in SQL via its own correlated read of `entity_translation` (the localized source coalesces that row away, so it cannot be derived from the merged columns). For a canonical reader (null session language) it constant-folds to `to_jsonb('none'::text)` with no join, keeping canonical SQL byte-identical to a query that never referenced translations. `getById` requests this field; `EntityDetail.translationStatus` stays required.

The `translationStatus` truth table (row absent ⇒ `pending`; row present with null name and empty properties ⇒ `none` negative cache; otherwise `ready`) mirrors `docs/tasks/media-translations/README.md`, and its canonical language is read from a `ProviderConfig` map (`sandbox_script.metadata.providerInformation.canonicalLanguage`). The query engine is built as a runtime dependency before the migrate/seed chain runs, so this map cannot be read at boot; it is loaded lazily on first use (always post-seed) and the success is memoized — safe because the builtin values are immutable once seeded.

### Why Read-Only Reads

Triggering work from reads makes a GET non-idempotent, couples the read contract to queue mechanics, and forces every list/detail surface to understand background jobs. Client-declared interest is a cleaner separation: reads report state, and a separate explicit signal drives work — the client names exactly the entities it cares about.

### Idempotency

Population and translation are `@effect/workflow` workflows keyed by a deterministic execution id (`populate-${entityId}`, `translate-${entityId}-${language}`) with `discard: true`, so concurrent or repeated interest declarations coalesce onto a single in-flight run.

### Summary

- Reads (`getById`, query-engine `execute`) are side-effect-free; the client never sees or drives job dispatch.
- `translationStatus` is an opt-in `systemComputed` query-engine field, root-entity-source only, computed in SQL and no-op for canonical readers.
- `getById` localizes via the entity source overlay and reports status via the field; `EntityDetail.translationStatus` remains required.
- Idempotency is `@effect/workflow` execution-id coalescing (`populate-${id}`, `translate-${id}-${lang}`).

---

## Decision 5: `consumedOn` and Trigger Property Inheritance

### Context

V1 stored a `providers_consumed_on: Vec<String>` field on the `seen` table, recording which importers, live integrations, or streaming platforms were associated with a given seen record. The array accumulated entries over time because V1 used a single mutable `seen` row per `(user, metadata)` pair.

### Decision

**`consumedOn: string` (optional)** is added as a property to the `progress`, `complete`, `dropped`, and `on_hold` event schemas. It is not present on `backlog` or `review`, which do not represent consumption acts. Each event carries its own single optional source string. The aggregate view across an entity's history is derivable via `SELECT DISTINCT consumed_on FROM event WHERE entity_id = ?` and does not need to be stored separately.

When a trigger creates a new event from a triggering event — as the auto-complete trigger does when it creates a `complete` event from a 100% `progress` event — the trigger framework is responsible for forwarding relevant properties. This propagation is declared in data, not code.

The `event_schema_trigger` table carries a `metadata` column (`jsonb NOT NULL`, no default — same semantics as `sandbox_script.metadata`) with schema:

```ts
eventSchemaTriggerMetadataSchema = z.object({
    inheritedProperties: z.array(z.string()).optional(),
});
```

When `processEventSchemaTriggers` builds the sandbox job context, it reads `trigger.metadata.inheritedProperties`, extracts those keys from the triggering event's `properties`, and injects them as `trigger.inheritedProperties`. The trigger script spreads `trigger.inheritedProperties` into the properties of the event it creates without referencing any property name directly.

The builtin auto-complete trigger's seed record carries `metadata: { inheritedProperties: ["consumedOn"] }`. Adding a new property to propagate in the future requires only updating that metadata record — no script change.

### Summary

- `consumedOn: string` (optional) is a property on `progress`, `complete`, `dropped`, and `on_hold` events.
- Each event carries its own source; the aggregate is a query over event history.
- `event_schema_trigger.metadata.inheritedProperties` declares which properties the trigger framework copies from the triggering event into the sandbox job context.
- Trigger scripts are property-name agnostic; propagation behavior lives in the DB.
