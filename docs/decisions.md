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

## Decision 3: Real-Time Entity Population via SSE

### Context

V1's frontend used a polling loop (`useEntityUpdateMonitor` in `apps/frontend/app/lib/shared/hooks/polling.ts`) to detect when a partial entity became fully populated. When a user navigated to a media detail page whose `is_partial` flag was true, the frontend fired the same GraphQL query at a one-second interval — up to 30 times — until the backend import job completed. Because multiple hooks could be active simultaneously (entity details plus one poll per pending translation variant), a single page load could sustain ~8 requests per second. Every polling response triggered a React re-render, compounding the CPU load.

This behavior was intentional and acknowledged as a known bottleneck in V1. The rewrite is the opportunity to remove it.

In the rewrite, the same concept is modeled as `entity.populatedAt`. When `populatedAt` is null the entity is partial. The client needs to know when a background import job sets that value so it can re-fetch and display complete data.

### Decision

The rewrite will use a single persistent SSE connection, opened once when the app starts, to push entity population events from the backend to the client. The client will call `queryClient.invalidateQueries` on each incoming event and let TanStack Query determine whether a network request is actually needed.

### How It Works

**Backend**

- One authenticated SSE endpoint: `GET /api/system/stream`.
- When the media import worker sets `populatedAt` on an entity, it publishes `{ entityId }` to a Redis pub/sub channel.
- The SSE endpoint subscribes to that channel and forwards each message to the connected client as an `entity:populated` event.

**Client**

- The root layout opens one `EventSource` connection on mount and keeps it open for the lifetime of the session.
- On each `entity:populated` event: `queryClient.invalidateQueries({ queryKey: entityKeys.detail(entityId) })`.
- TanStack Query handles the rest:
  - If a component is currently mounted with that query key, it refetches immediately in the background and React re-renders on completion.
  - If the query exists in cache but no component is mounted, it is marked stale and refetched automatically on the next mount.
  - If the query has never been fetched, `invalidateQueries` is a no-op.

The client does not need to track which entity IDs it is "interested in". TanStack Query's active-subscriber model provides that filtering as a side effect of rendering.

**List queries (saved views and query engine)**

The saved-view runtime query key (`["saved-view-runtime", slug, ...]`) does not contain individual entity IDs, so targeted `invalidateQueries({ queryKey: ["entity-detail", entityId] })` calls do not reach it. Entity cards in a saved view showing stale partial properties while the user is actively browsing is a real UX gap.

On every `entity:populated` event the client will also schedule a debounced invalidation of all active saved-view-runtime queries. The debounce window (around 1.5 s) collapses a burst of population events — such as a bulk import completing many entities in quick succession — into a single list refetch. TanStack Query only fires a network request if a component with that query key is currently mounted, so the cost is zero when the user is not on a saved-view screen.

```ts
const debouncedInvalidateLists = debounce(() => {
  queryClient.invalidateQueries({
    predicate: q => q.queryKey[0] === "saved-view-runtime",
  });
}, 1500);

es.addEventListener("entity:populated", ({ data }) => {
  const { entityId } = JSON.parse(data);
  queryClient.invalidateQueries({ queryKey: ["entity-detail", entityId] });
  debouncedInvalidateLists();
});
```

**Reconnect gap**

If the SSE connection drops, events that fired during the gap are silently lost. On reconnect, the client will call `queryClient.invalidateQueries()` with no key filter to sweep all currently active queries. This ensures any entity that was populated while the client was disconnected is re-fetched when the connection is restored, without requiring server-side event replay or `Last-Event-ID` bookkeeping. The broad sweep covers both entity-detail and saved-view-runtime queries.

**Expo native**

React Native does not expose a native `EventSource`. The client will use the `react-native-sse` polyfill, which is a drop-in replacement that works across iOS, Android, and web targets.

### Why SSE over the Alternatives

| Option               | Why rejected                                                       |
| -------------------- | ------------------------------------------------------------------ |
| Polling (V1 pattern) | The problem being solved                                           |
| WebSocket            | Bidirectional protocol; overkill for a server-to-client-only feed |
| Long polling         | Holds one HTTP connection open per pending entity; complex teardown |
| Push notifications   | Requires app store provisioning; wrong granularity for UI updates  |

SSE is unidirectional, HTTP/1.1 compatible, has built-in auto-reconnect, and Hono supports it natively via `streamSSE`. Redis is already in the stack via BullMQ, so no new infrastructure is required.

### Summary

- Replace all entity-population polling with a single persistent SSE connection per client session.
- Backend: media worker publishes to Redis on job completion; SSE endpoint forwards to all connected clients.
- Client: targeted `invalidateQueries` on every `entity:populated` event, plus a debounced broad invalidation of saved-view-runtime queries; broad sweep on reconnect.
- No per-entity subscription tracking on the client; TanStack Query's active-subscriber model handles filtering automatically.

---

## Decision 4: Population Job Dispatch Owned by the Backend

### Context

In V1, the frontend was responsible for dispatching the job that populated a partial entity. When the frontend detected `is_partial = true` on a metadata, person, or group record, it explicitly called the `DeployUpdateMediaEntityJob` GraphQL mutation. Without that call, the backend had no signal about which entities the user actually wanted populated, and would otherwise have to blindly populate everything — including entities no user ever views.

This responsibility sitting in the frontend was a design flaw: it coupled data-fetching logic to job dispatch, it required the client to understand backend job mechanics, and it was the direct cause of the polling loop described in Decision 3.

In the rewrite, the equivalent state is `entity.populatedAt === null`. The question is who triggers the population job and when.

### Decision

Population jobs will be triggered by the backend at every point where entities are surfaced to the user, with no involvement from the client. The client dispatches nothing.

The two surfaces that expose entities to the user are:

- `GET /entities/{entityId}` — the entity detail endpoint
- `POST /query-engine/execute` — every saved view and list query

Both will call a shared `maybeEnqueuePopulation` helper for each partial entity in their response before returning. The client simply fetches data and reacts to the SSE `entity:populated` event when it arrives.

### Why Both Surfaces

Triggering only on `GET /entities/{entityId}` (the detail endpoint) is insufficient. A user may browse a saved view without ever navigating into an individual entity. Since the saved view is a first-class browsing surface, entities visible in a list are already a signal of user interest. Restricting population to explicit detail-page visits would leave list entries showing stale partial data indefinitely.

Triggering on `POST /query-engine/execute` ensures that anything the user can currently see on screen — whether in a detail view or a list — gets a population job.

### Idempotency

BullMQ supports deterministic job IDs. The helper uses `jobId: "populate-{entityId}"` on every `queue.add` call. If a job with that ID is already waiting or active, the call is a no-op. After the job completes it is removed from the queue, but by then `populatedAt` is set so the helper skips re-enqueuing on the next request. The result is exactly one active job per partial entity at any time, regardless of how many concurrent requests surface it.

```ts
function maybeEnqueuePopulation(entityId: string, populatedAt: Date | null) {
  if (populatedAt === null) {
    mediaQueue.add("media-import", { entityId }, { jobId: `populate-${entityId}` });
  }
}
```

### What the Client Does

Nothing related to job dispatch. The client fetches entity data, renders what is available, and waits for an `entity:populated` SSE event to arrive. On that event it invalidates the relevant query keys as described in Decision 3. The client has no awareness of jobs, queues, or population state beyond reading `populatedAt` to decide whether to show a partial/loading UI.

### Why Not Eager Population on Entity Creation

Enqueuing a population job the moment a partial entity is written to the database was considered and rejected. The query engine can surface many entities during search and indexing operations that the user may never view. Eagerly populating all of them would perform unnecessary external API calls and consume worker capacity for data nobody asked for. Demand-driven triggering at the point of surfacing ensures work is proportional to actual user interest.

### Summary

- The client never dispatches population jobs. That responsibility moves entirely to the backend.
- Both `GET /entities/{entityId}` and `POST /query-engine/execute` call `maybeEnqueuePopulation` for each partial entity in their response.
- BullMQ deterministic job IDs guarantee at most one active job per entity.
- The client reacts to the SSE `entity:populated` event and invalidates cache; it does not poll or track job state.
