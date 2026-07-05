# Interest Module Agent Notes

## Module Purpose

This module is the backend half of **client-declared interest**: the mechanism by which a client tells the server which entities it currently cares about, and learns when the server has finished populating or translating one of them — without polling, and without any read being coupled to background work.

It exposes two ordinary authenticated HTTP endpoints on the `entity-interest` `HttpApiGroup`:

- **`GET /api/entity-interest/stream?streamId=<uuid>`** — a long-lived Server-Sent Events (SSE) stream. The client mints its own `streamId` (a UUID). The first event is `connected` (`data: { streamId }`); thereafter completions arrive as `entity:updated` events (`data: { entityId, reason }`, `reason ∈ {"populated","translated"}`). A bare `: ping` comment line is sent every 25 s so idle proxies don't drop the connection.
- **`POST /api/entity-interest`** — body `{ streamId, entityIds }`, **replace semantics** (each call supersedes the prior interest set for that stream). It returns `{ terminal: {entityId, reason}[] }`: entities already in a terminal state at reconcile time, for immediate catch-up.

The module is **glue over existing bricks**. It owns no persistence and no provider logic. It reads the declared interest set through the query engine (which supplies authz, localization, and translation status for free) and enqueues the pre-existing idempotent population/translation workflows. Completion fan-out rides one Redis channel back to the SSE streams.

This file is the authoritative record of how the module works: the mental model, the file map, and the load-bearing invariants (in particular the "why" behind each decision). Keep it in sync when the module changes.

## The End-to-End Flow

```
client                        interest module                     rest of backend
  │                                  │                                   │
  ├─ GET /entity-interest/stream ───►│ StreamRegistry.add(streamId)      │
  │◄──── event: connected ──────────┤ (SSE scope opens)                 │
  │                                  │                                   │
  ├─ POST /entity-interest {ids} ───►│ 1. setInterestIfOwner (register)  │
  │                                  │ 2. reconcile: read ids via ───────► query engine
  │                                  │    query engine (authz+status)    │   (side-effect-free)
  │                                  │ 3. enqueue work per row ──────────► EntityPopulationTrigger.request
  │                                  │                          └────────► TranslationsService.requestFill
  │◄──── { terminal:[...] } ─────────┤ 4. return already-terminal ids    │
  │                                  │                                   │
  │                                  │                          workflow completes, persists,
  │                                  │◄───── Redis entity:updated ────────┤ publishes {entityId,reason}
  │◄──── event: entity:updated ──────┤ fanOut → interested streams        │
```

1. **Open the stream.** The `stream` handler ([routes.ts](routes.ts)) resolves `CurrentUser` from the group's `AuthMiddleware`, then returns `buildInterestStreamResponse` ([stream.ts](stream.ts)). On the SSE scope's _acquire_, `StreamRegistry.add` registers the `streamId` and an `enqueue` closure; a `connected` frame is emitted. On _release_ (client disconnect), `StreamRegistry.remove` runs.
2. **Declare interest.** `InterestService.declareInterest` truncates the id set to the cap, then calls `setInterestIfOwner` **before** reconciling (see invariants), then runs `InterestReconciler.reconcile`.
3. **Reconcile** ([service.ts](service.ts)) reads the ids through the query engine in chunks, and for each row decides: enqueue population, enqueue translation, or classify as already-terminal.
4. **Return catch-up.** Terminal rows are returned inline as `{ terminal }`, filtered to the stream's _current_ interest set.
5. **Fan out completions.** When a population or translation workflow finishes, it publishes `{ entityId, reason }` to the single Redis channel. `StreamRegistry`'s duplicated subscriber decodes it and pushes an `entity:updated` frame to every local stream whose interest includes that id.

## File Map

- **[contract.ts](../../../../../libs/contract/src/modules/entity-interest/contract.ts)** — the `entity-interest` `HttpApiGroup` (auth middleware; stream GET `text/event-stream`; declareInterest POST with `NotFound` 404 / `RateLimited` 429; group `Unauthorized` 401), registered into the single `AppContract` so both endpoints appear in `/docs`.
- **[messages.ts](../../../../../libs/contract/src/modules/entity-interest/messages.ts)** — all wire schemas: `EntityUpdatedReason` (the completion-reason vocabulary), the Redis pub/sub payload codec, the SSE/terminal frame shapes, the POST body/response, and `MAX_INTEREST_ENTITY_IDS = 500`.
- **[registry.ts](registry.ts)** — `StreamRegistry`: the per-process `streamId → { userId, enqueue, interest }` map, the `byEntity` reverse index for fan-out, and the single duplicated Redis subscriber (a scoped `Effect.Service`, torn down via finalizer).
- **[stream.ts](stream.ts)** — the SSE transport: a push stream whose acquire/release drive `registry.add`/`registry.remove`, merged with the heartbeat stream.
- **[service.ts](service.ts)** — `InterestService` owns capped interest registration and register-before-reconcile orchestration; `InterestReconciler` owns the chunked query-engine read plus `handleRow`'s enqueue-or-terminal state machine.
- **[routes.ts](routes.ts)** — the two thin handlers delegate stream transport and declaration orchestration to their owning services.
- **[stream.test.ts](stream.test.ts)** — SSE lifecycle unit test (add + `connected` on subscribe, remove on interrupt) with a stand-in registry, no Redis.

## Wire Protocol (Client Contract)

The reference client is `tests/src/fixtures/interest-sse.ts`. A conforming client must:

- **Generate its own `streamId`** (UUID) and pass the same value to both the stream GET and every interest POST.
- **Parse SSE by `\n\n`-delimited blocks**, and **ignore any line starting with `:`** — that is how the `: ping` heartbeat (every `HEARTBEAT_INTERVAL_MS = 25_000`) is discarded. Read `event:` and `data:` lines.
- **Treat `connected` as readiness.** Don't POST interest until `connected` arrives (the stream isn't registered until its scope acquires).
- **Dedupe `entity:updated` by `entityId`, idempotently.** A terminal entity is delivered **twice by design**: once inline in the POST `terminal` array, and possibly again later as an SSE frame. Applying an update must be safe to repeat.
- **Buffer completions.** A completion can arrive _before_ the caller starts awaiting a specific id (the workflow may finish during the POST round-trip), so check already-received frames before waiting.
- **Interpret `reason` as a refetch nudge, not a claim of content.** `"populated"` = "the populated state now exists, refetch." `"translated"` = "the translation step _settled_, refetch" — this **includes the negative-cache case** where no translation exists and status becomes `"none"`. Never assume a `"translated"` frame means a translation is present.

## Invariants & Rationale

These are the load-bearing "why"s. Changing the code without preserving them silently breaks the feature.

### Register interest _before_ reconciling

`InterestService.declareInterest` calls `setInterest` before `reconciler.reconcile`. A background workflow can complete and publish to Redis _during_ the reconcile read; if the stream's interest weren't already in `StreamRegistry`, `fanOut` would find no matching stream and the completion would be lost for that client.

### Populate-before-translate

[service.ts](service.ts) `handleRow` is a strict ordered state machine:

- `populatedAt === null` → **only** ever consider population. If the entity has provider provenance (`externalId` and `sandboxScriptId` both non-null) → `EntityPopulationTrigger.request`, return non-terminal. If it has none (a user-authored entity) → it can never be populated, so it is already terminal (`reason: "populated"`).
- Only once populated does it look at `translationStatus`; `"pending"` (with a user language + provenance) → `TranslationsService.requestFill`.

Translation must **never** be enqueued for an unpopulated entity: a fill on an unpopulated row writes an all-null overlay row that is read back as the negative-cache status `"none"`, permanently mislabeling the entity.

### Replace semantics + terminal gating

Each POST **supersedes** the prior interest set for that stream (`setInterestIfOwner` diffs against the previous set and updates `byEntity` for only the real changes). Because a _newer_ POST can drop ids while an _earlier_ reconcile is still awaiting, `InterestService.declareInterest` filters the returned `terminal` list through `registry.hasInterest(streamId, id)` at return time — so it never surfaces results the stream no longer cares about.

### Duplicate delivery is intentional

Already-terminal entities have no future completion event to wait for, so they are returned inline (`terminal`) to avoid the client hanging forever. But the same ids may also arrive over SSE. Hence the "dedupe by entityId" client contract above.

### The interest-set cap (500) and chunk size (100)

`reconcile` runs `⌈N/100⌉` **sequential** query-engine transactions per POST, each holding a DB connection (there is no `in` operator, so the id filter is an `or`-of-`eq`, and each document's page limit ≤ `MAX_ROOT_PAGE_SIZE = 100`). An unbounded set — even a legitimate huge saved view — would turn one POST into a slow, connection-hogging request. `InterestService.setInterest` **truncates to `MAX_INTEREST_ENTITY_IDS = 500` and logs a warning** rather than rejecting, so an oversized-but-legit view still gets _partial_ real-time updates. (Cap + chunk together bound one POST to ≤ 5 sequential reconcile transactions.)

### Reconcile failure never fails the POST

A failing `reconcile` is caught, logged as a warning, and treated as an empty `terminal` list. The POST still succeeds and the SSE stream keeps working; catch-up just yields nothing that call. Enqueue failures inside the triggers are likewise swallowed to warnings — a lost enqueue self-heals because the row stays `pending`/unpopulated and the next reconcile retries.

### Stream ownership and the existence oracle

`POST /api/entity-interest` requires the caller to own the `streamId` (same user who opened it). `setInterestIfOwner` returns `notFound("Unknown stream")` for **both** an unknown `streamId` and a wrong-owner one — the two cases are **intentionally indistinguishable**, to avoid leaking which `streamId`s exist. This is why `declareInterest` declares `NotFound` 404.

### `Effect.suspend` in `setInterestIfOwner`

The map mutations (updating `interest` and `byEntity`) are wrapped in `Effect.suspend` so they run when the effect is _yielded_, not during effect _construction_. Do not unwrap this — building the effect must stay side-effect-free.

### One duplicated Redis subscriber per process

`StreamRegistry` calls `redis.client.duplicate()` for its subscriber ([registry.ts](registry.ts)): ioredis puts a connection into subscribe mode (blocking normal commands), so a dedicated connection is required while the shared `RedisService.client` stays free for `publish`/`get`/`set`. The subscriber re-subscribes on `ready` — redundant with ioredis's auto-restore on reconnect, but idempotent and a cheap guard against any gap. `fanOut` **silently drops** frames that fail to decode (`Either.isLeft`) so one malformed publish can't kill the subscriber. Being a scoped singleton, the extra connection is created once at startup and `quit()`'d once via the finalizer.

### Heartbeat as a separate merged stream

The `: ping` heartbeat is its own `Stream.fromSchedule(...)` merged with the push stream, rather than a side-effecting `setInterval`. `Stream.merge` tears both branches down together on client disconnect, so the heartbeat stops for free — no interval to leak.

### Single-instance assumption

Interest state lives **in-process** in `StreamRegistry`, keyed by `streamId`; there is no Redis-backed sharing of interest state across processes. A `POST /api/entity-interest` for a `streamId` **must** land on the process holding that stream's SSE connection. This matches the self-hosted, effectively-single-instance deployment target. Multi-instance would need sticky routing (a `streamId` always reaches its SSE process) or a shared interest store — neither is built.

## Cross-Module Dependencies

The module deliberately reuses existing infrastructure rather than reimplementing it.

- **Query engine** (`#modules/query-engine`) — `reconcile` reads via `QueryEngineService.execute`, which gives three things for free:
  - **Authz.** `loadVisibleEntitySchemaSlugs(user.id)` returns exactly the slugs the caller can see; passing only those as the source `schemas` means the engine can only ever return authorized rows. There is no separate authz check in the reconciler.
  - **Localization.** The entity source overlays the `(entity_id, language)` translation row on the canonical entity: the overlay `name` and overlaid property values win, canonical-only properties survive the `properties || et.properties` merge, and sorting/filtering on `name` key off the localized value — so a canonical name is no longer matchable once a localized overlay exists. Overlays are shared: once one viewer's declared interest fills an overlay, other non-canonical viewers read it directly without declaring interest.
  - **`translationStatus`.** An opt-in `systemComputed` field valid on the **root entity source only**, computed entirely in SQL. Because the localized source coalesces the overlay row _away_, status can't be derived from the merged columns — it needs its own correlated read of `entity_translation`. For a canonical/null-language reader it constant-folds to `'none'` with no join. Truth table: not-populated ⇒ `none`; overlay row absent ⇒ `pending`; row present but null-name + empty-properties ⇒ `none` (negative cache); else ⇒ `ready`. Canonical language comes from a correlated subquery on `sandbox_script.metadata.providerInformation.canonicalLanguage`, read live per query — scripts are seeded and created after boot, so no snapshot/cache of the map can be trusted.
- **Population producer** (`#modules/entities` `EntityPopulationTrigger` → `#modules/entity-import`) — `request({ entityId, externalId, userId, entitySchemaSlug, sandboxScriptId })` enqueues `ProviderEntityPopulationWorkflow` (`mode: "ensure"`) with `executionId = populate-${entityId}`, `discard: true`. Idempotency is `@effect/workflow` execution-id coalescing, so blind per-row calls collapse to one in-flight run. On completion, the `publish-primary-entity` activity publishes `entity:updated` with `reason: "populated"` **after** `populatedAt` is durably written ([entity-import/provider-entity-population-workflow.ts](../entity-import/provider-entity-population-workflow.ts)).
- **Translation producer** (`#modules/entity-translation` `TranslationsService.requestFill`) — enqueues `TranslateEntityWorkflow` with `executionId = translate-${entityId}-${language}`, `discard: true`. On success it upserts the overlay (all-null row when the provider has no translation — a negative cache that is never refetched) and publishes `entity:updated` with `reason: "translated"`. On transient sandbox failure it writes **no** row (status stays `pending`, so the next reconcile retries).
- **Redis** (`#lib/infrastructure/redis`) — owns only the transport: `redisKeys.entityUpdatedChannel = "ryot:entity:updated"` and the generic `RedisService` (pub/sub, get/set). The message vocabulary itself — `EntityUpdatedReason`, `EntityUpdatedMessage`, `encodeEntityUpdatedMessage` (producer side) and `decodeEntityUpdatedMessage` (the **synchronous, `Either`-returning** decoder shaped for the raw ioredis callback, which is not an Effect context) — is owned by this module's [messages.ts](../../../../../libs/contract/src/modules/entity-interest/messages.ts), since it is client-contract-facing, not backend-infra. The `reason` rides _in the payload_ because only the publisher knows whether it populated or translated; the registry is generic fan-out.
- **Wiring** (`app/layers.ts`, `app/server.ts`, `libs/contract/src/contract.ts`) — `InterestGroup` is `.add()`ed to the single `AppContract`; `InterestRoutesLive` is provided into the API layer; `StreamRegistry.Default` and `InterestReconciler.Default` provide `InterestService.Default` in `ServicesLive`. `AuthMiddlewareLive` is provided once at the API level and covers both endpoints. The SSE endpoint being a real contract endpoint (via `handleRaw`) is why it appears in `/docs` and gets group-level 401 handling — unlike the pre-migration raw route.

## Conventions

- Keep `routes.ts` thin. Interest registration and declaration orchestration live in `InterestService`, row reconciliation lives in `InterestReconciler`, and transport lives in `stream.ts`/`registry.ts`.
- Wire schemas and the `reason` vocabulary both stay in `messages.ts`. Don't redefine either inline.
- When the protocol or behavior changes, update this file, the reference client `tests/src/fixtures/interest-sse.ts`, and the e2e tests (`tests/src/tests/entity-interest/authz.test.ts`, `tests/src/tests/entity-interest/population-dispatch.test.ts`, `tests/src/tests/query-engine/translation-status.test.ts`).
- Any new completion `reason` must be added to `EntityUpdatedReason` in `messages.ts` and threaded through `handleRow`'s terminal mapping and both publisher workflows.
