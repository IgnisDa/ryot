# Integrations

## Problem Statement

Ryot V1 supported a rich integrations system that let users connect Ryot to external services in three directions: pulling progress data in on a schedule (Yank), receiving webhook payloads from external services (Sink), and pushing data out to external services when Ryot events occur (Push). V2 has no equivalent system. Users who migrate from V1 lose all their integration configurations and recurring sync behavior, and V2 cannot receive live progress updates from Plex, Jellyfin, Kodi, Emby, Audiobookshelf, Komga, or push to Radarr, Sonarr, and Jellyfin.

## Solution

Add a first-class integrations module to V2 that supports all three integration lots. Yank integrations run on a configurable schedule as recurring BullMQ jobs and feed data through the existing imports pipeline. Sink integrations expose webhook endpoints and feed parsed payloads through the same pipeline. Push integrations are implemented as DB-backed builtin sandbox trigger scripts on the event system, keeping all push behavior in the script layer rather than app code. A new before-trigger phase is introduced to the event system for generic DB-backed event write policies, initially used for integration-specific progress deduplication and min/max progress normalization. Existing V1 integrations are migrated via the legacy bootstrap module.

## User Stories

1. As a user, I want to create an Audiobookshelf integration so that my in-progress audiobooks and books are automatically synced to Ryot every few minutes.
2. As a user, I want to create a Komga integration so that my comic and manga reading progress is automatically synced to Ryot on a schedule.
3. As a user, I want to create a PlexYank integration so that items from my Plex libraries are automatically recorded as owned in Ryot.
4. As a user, I want to create a YoutubeMusic integration so that songs I listen to on YouTube Music are recorded as progress events in Ryot.
5. As a user, I want to create a Kodi integration and receive a webhook URL so that Kodi can push playback progress to Ryot in real time.
6. As a user, I want to create an Emby integration and receive a webhook URL so that Emby can push playback progress to Ryot in real time.
7. As a user, I want to create a PlexSink integration and receive a webhook URL so that Plex webhooks can push playback progress to Ryot.
8. As a user, I want to filter PlexSink webhooks by Plex username so that only my own playback is recorded.
9. As a user, I want to create a JellyfinSink integration and receive a webhook URL so that Jellyfin webhooks can push playback progress to Ryot.
10. As a user, I want to select TMDB or TVDB as the metadata provider for my JellyfinSink integration so that media is matched correctly.
11. As a user, I want to create a RyotBrowserExtension integration and receive a webhook URL so that the Ryot browser extension can report what I am watching.
12. As a user, I want to configure disabled sites for the browser extension integration so that it ignores certain streaming platforms.
13. As a user, I want to create a Radarr integration with a sync collection so that movies added to that collection are automatically sent to Radarr for download.
14. As a user, I want to create a Sonarr integration with a sync collection so that shows added to that collection are automatically sent to Sonarr for download.
15. As a user, I want to create a JellyfinPush integration so that media I complete in Ryot is automatically marked as played in Jellyfin.
16. As a user, I want to create a GenericJson integration and migrate my V1 config so that I can use it once V2 implements runtime support.
17. As a user, I want to see a webhook URL for my Sink integrations so that I know where to point external services.
18. As a user, I want the webhook URL in both short form (`/_i/:id`) and full form (`/api/webhooks/integrations/:id`) so that external services can use the shorter URL for compatibility.
19. As a user, I want to name my integrations so that I can distinguish between multiple integrations of the same provider.
20. As a user, I want to pause an integration without deleting it so that I can temporarily stop syncing.
21. As a user, I want to delete an integration so that its run history is also removed.
22. As a user, I want to set a minimum progress threshold so that trivial accidental plays below that percentage are not recorded.
23. As a user, I want to set a maximum progress threshold so that progress above that value is automatically treated as a completion.
24. As a user, I want the integration to be automatically disabled after 5 consecutive failed runs when I have opted into that behavior.
25. As a user, I want to see the run history for each integration separately from my manual imports list.
26. As a user, I want manual import runs to remain separate from integration-triggered runs in the main imports list.
27. As a user, I want to view a specific integration run directly by ID even though it is not shown in the main imports list.
28. As a user, I want my integration run failures to include stage information so that I know whether the failure was during source fetch, entity resolution, or event creation.
29. As a user, I want items that are explicitly skipped by integration policy (duplicate progress, below minimum threshold) to not appear as failures in my run history.
30. As a user, I want to enable owned item syncing for Audiobookshelf, Komga, and PlexYank so that items in my external libraries are marked as owned in Ryot.
31. As a user, I want owned items to be tracked on my library entities as ownership state rather than as a separate collection.
32. As a user, I want ownership to accumulate from multiple integrations so that if I own a book in both Audiobookshelf and Komga, both sources are recorded.
33. As a user, I want progress updates from integrations to be deduplicated so that the same progress at the same percentage does not create repeated events.
34. As a user, I want completion events to be deduplicated within a configurable time window so that finishing the same item twice in quick succession from integration polling does not create duplicate completions.
35. As a user, I want to disable all integrations at once via a user preference without having to disable each one individually.
36. As a user, I want the integrations preference to disable both scheduling and webhook acceptance.
37. As a user, I want to configure how often Yank integrations poll using the `SCHEDULER_FREQUENT_CRON_JOBS_SCHEDULE` env var with English cron phrases.
38. As a user migrating from V1, I want my existing integration configurations preserved with the same IDs so that my webhook URLs remain valid.
39. As a user migrating from V1, I want my V1 Owned collection memberships to be carried over as ownership state on my library entities.
40. As a user migrating from V1, I want my V1 Owned collection to also be migrated as a normal user collection.
41. As a user migrating from V1, I want my V1 GenericJson integration to be migrated with its config so that I can enable it when V2 implements runtime support.
42. As an operator, I want to configure `SERVER_PROGRESS_UPDATE_THRESHOLD` to control how long after a completion event subsequent duplicate completions from integrations are suppressed.
43. As an operator, I want to configure `SCHEDULER_FREQUENT_CRON_JOBS_SCHEDULE` and `SCHEDULER_INFREQUENT_CRON_JOBS_SCHEDULE` using the same English cron phrase syntax as V1.
44. As an operator, I want scheduled Yank jobs to be reconciled at startup so that new or changed schedule configurations take effect without manual intervention.
45. As a developer, I want push integration behavior to live entirely in sandbox scripts so that no integration-specific logic leaks into app modules.
46. As a developer, I want before-trigger evaluation to happen before event property validation so that integration normalization scripts can skip or replace invalid-but-normalizable values.
47. As a developer, I want before-trigger skip results to not create import run failures so that intentional deduplication is not counted as an error.
48. As a developer, I want the event write context (origin, integrationId, importRunId) to be available in before-trigger sandbox scripts so that the integration progress policy script can apply rules selectively.

## Implementation Decisions

### Overview of New and Modified Modules

- **New:** `src/modules/integrations/` — the integrations module containing CRUD, scheduling, webhook handling, and provider adapters.
- **Modified:** `src/modules/events/` — add before-trigger phase, position ordering, EventWriteContext threading, skip results in best-effort creation.
- **Modified:** `src/modules/collections/` — emit `add-entity-to-collection` and `remove-entity-from-collection` events after membership writes.
- **Modified:** `src/modules/entities/` — add ownership property merging to `in-library` relationship helper.
- **Modified:** `src/modules/builtins/` — seed new event schemas, new builtin event schema trigger links, new relationship schema properties for `in-library`, update user preferences schema.
- **Modified:** `src/modules/imports/` — thread EventWriteContext through the media pipeline write phase; accept optional integrationId.
- **Modified:** `src/modules/legacy-bootstrap/` — rename/drop the V1 `integration` table, add integration migration, add V1 Owned-collection ownership migration, update user preference migration.
- **Modified:** `src/lib/sandbox/` — add `claimCachedValue` host function; add before-trigger driver validation; add sandbox script files for push and progress-policy triggers.
- **Modified:** `src/lib/config/` — add scheduler and threshold config fields.
- **Modified:** `src/lib/db/schema/` — integration table, import_run integrationId, event_schema_trigger phase and position, in-library schema properties.
- **Modified:** `src/app/runtime.ts` — add integration scheduler reconciliation to startup sequence.

---

### Database Schema Changes

#### New `integration` table

Columns:

- `id` — text, primary key, app-backend standard ID generator
- `userId` — text, not null, FK to user, cascade delete/update
- `lot` — text, not null — `"yank"`, `"sink"`, or `"push"`
- `provider` — text, not null — snake_case provider ID (see provider list below)
- `name` — text, nullable
- `isDisabled` — boolean, not null, default `false`
- `providerSpecifics` — jsonb, not null — discriminated union keyed on `kind` matching `provider`
- `minimumProgress` — decimal, not null, default `2`
- `maximumProgress` — decimal, not null, default `95`
- `syncOwnership` — boolean, not null, default `false`
- `extraSettings` — jsonb, not null — `{ disableOnContinuousErrors: boolean }`
- `lastFinishedAt` — timestamp with tz, nullable — updated only on successful run completion
- `createdAt` — timestamp with tz, default now
- `updatedAt` — timestamp with tz, on update

Indexes:

- `(userId, createdAt desc)`
- `(userId, provider)`
- `(lot, isDisabled)`
- `(provider, isDisabled)`

#### `import_run` table changes

- Add `integrationId` — text, nullable, FK to `integration(id)` with `ON DELETE CASCADE`
- Add index `(integrationId, createdAt desc)`

#### `event_schema_trigger` table changes

- Add `phase` — text, not null, default `"after_create"` — values: `"before_create"` or `"after_create"`
- Add `position` — integer, not null, default `1000` — lower runs first within phase

All existing rows receive `phase = "after_create"`, `position = 1000`.

#### `in-library` relationship schema property changes

Widen the builtin `in-library` relationship `propertiesSchema` to include:

```
owned?: boolean
ownershipSources?: string[]
ownershipSyncedAt?: datetime
```

All fields optional. Existing rows with empty properties remain valid.

#### `import_run_failure` failure stage changes

Add new stage value: `"event_before_trigger"` to the `ImportRunFailureStage` enum.

---

### Config / Env Vars

Add to `systemConfigDef`:

- `scheduler` group:
  - `frequentCronJobsSchedule` — env key `SCHEDULER_FREQUENT_CRON_JOBS_SCHEDULE`, default `"every 5 minutes"`, English cron phrase parsed by `english-to-cron` npm package
  - `infrequentCronJobsSchedule` — env key `SCHEDULER_INFREQUENT_CRON_JOBS_SCHEDULE`, default `"every midnight"`, parsed same way (ported for config parity; not actively used by integrations)
  - `progressUpdateThresholdHours` — env key `SERVER_PROGRESS_UPDATE_THRESHOLD`, default `"2"`, integer hours

Expose all three in config docs.

---

### Provider List

Snake_case IDs stored in DB. V1 PascalCase enum values map via `rename_all = "snake_case"` so migration copies directly.

Yank: `audiobookshelf`, `komga`, `plex_yank`, `youtube_music`
Sink: `kodi`, `emby`, `plex_sink`, `jellyfin_sink`, `ryot_browser_extension`, `generic_json`
Push: `radarr`, `sonarr`, `jellyfin_push`

---

### Provider Specifics — Discriminated Union

Each provider has a `providerSpecifics` object with a `kind` discriminant matching the provider ID. All schemas are strict (no unknown keys). Field names are camelCase.

```
audiobookshelf: { kind, baseUrl, token }
komga:          { kind, baseUrl, apiKey }
plex_yank:      { kind, baseUrl, token }
youtube_music:  { kind, timezone, authCookie }

kodi:                         { kind }
emby:                         { kind }
plex_sink:                    { kind, username? }
jellyfin_sink:                { kind, username?, metadataProvider? }
generic_json:                 { kind }
ryot_browser_extension:       { kind, disabledSites? }

radarr:       { kind, baseUrl, apiKey, profileId, rootFolderPath, tagIds?, syncCollectionIds }
sonarr:       { kind, baseUrl, apiKey, profileId, rootFolderPath, tagIds?, syncCollectionIds }
jellyfin_push: { kind, baseUrl, username, password? }
```

Note: Sonarr `tagIds` is a single optional integer (preserving V1 shape). Radarr `tagIds` is an optional integer array.

API validates that `integration.provider === integration.providerSpecifics.kind`.

PATCH requests preserve existing secret fields when omitted. After merge, the final providerSpecifics must pass the strict provider schema.

---

### Integrations Module API

Routes:

```
GET    /api/integrations
POST   /api/integrations
GET    /api/integrations/:id
PATCH  /api/integrations/:id
DELETE /api/integrations/:id
GET    /api/integrations/:id/runs
POST   /api/webhooks/integrations/:id
POST   /_i/:id
```

`GET /api/integrations` and `GET /api/integrations/:id` return full provider specifics including secrets, scoped to the authenticated user.

`GET /api/integrations?provider=radarr&isDisabled=false` supports optional provider and isDisabled filter query params, primarily for use by sandbox push scripts.

`GET /api/integrations/:id/runs` returns integration-owned import_run records ordered by createdAt desc.

`GET /imports` continues to filter `integrationId IS NULL` by default. `GET /imports/:id` allows fetching an integration-owned run if the user owns it.

`GET /api/integrations` response includes `webhookUrl` for Sink providers:

```
{FRONTEND_URL}/_i/{integrationId}
```

`POST /api/webhooks/integrations/:id` and `POST /_i/:id` behave identically:

- Invalid/nonexistent integration ID: `404`
- Existing but disabled integration: create `import_run`, mark failed, add `source_fetch` failure, return `202` with `{ data: { runId } }`
- Valid enabled integration: create `import_run`, enqueue job, return `202` with `{ data: { runId } }`

Both routes accept only POST. Raw request body and content-type header are passed to provider sink parsers. The `/_i/:id` route lives at root level, not under `/api`.

---

### Validation Defaults and Rules

On create:

- `minimumProgress = 2`
- `maximumProgress = 95`
- `isDisabled = false`
- `syncOwnership = false`
- `extraSettings.disableOnContinuousErrors = false`
- Validate `0 <= minimumProgress <= 100`
- Validate `0 <= maximumProgress <= 100`
- Validate `minimumProgress <= maximumProgress`

---

### Yank Integrations — Scheduling

BullMQ repeat jobs, one per enabled Yank integration, with job ID `yank-{integrationId}`.

At startup, after workers are initialized and before `dispatchBuiltinEntityPreloadJobs`, the scheduler reconciles repeat jobs:

- For each enabled Yank integration: ensure a repeat job exists with the current cron schedule.
- For each existing repeat job whose integration is deleted, disabled, or whose schedule has changed: remove it.
- When a Yank integration is created or re-enabled via API: add repeat job.
- When a Yank integration is disabled via API: remove repeat job.
- When a Yank integration is deleted: remove repeat job (import_run cascade handles history).

The English cron phrase from `SCHEDULER_FREQUENT_CRON_JOBS_SCHEDULE` is converted to a cron expression using the `english-to-cron` npm package before passing to BullMQ repeat options.

Yank jobs do not run immediately on create; they wait for the next scheduled tick.

Yank job data: `{ runId, userId, integrationId }`. Worker loads integration config from DB at execution time; credentials are never stored in job data.

Yank jobs use the existing `import` queue, not a new queue.

---

### Yank Integrations — Execution Flow

1. Worker reads job data, loads integration from DB.
2. Check `user.preferences.disableIntegrations` — if true, no-op without creating/updating run.
3. Create `import_run` with `integrationId`, `source = provider`, `inputSummary = { integrationId, provider, lot, name? }`.
4. Set `import_run.status = "running"`.
5. Call provider-specific Yank adapter: returns `MediaImportAdapterResult { failures, entityGroups }`.
6. If `syncOwnership = true`: also call provider's owned-items fetch and merge ownership into adapter result.
7. Pass `entityGroups` through existing imports media pipeline (resolve → populate → write) with `EventWriteContext { origin: "integration", integrationId, importRunId }`.
8. On completion: update `import_run.status`, counters, finishedAt. Set `integration.lastFinishedAt` only on success.
9. Auto-disable check: query last 5 import_run rows for this integrationId; if all failed and `extraSettings.disableOnContinuousErrors = true`, set `integration.isDisabled = true` and remove repeat job.

Yank jobs support resumability through the existing imports pipeline phase-based job data state.

---

### Yank Provider Adapters

Each adapter lives in `src/modules/integrations/providers/yank/`. Adapters share low-level HTTP helpers with existing import sources where practical.

- **Audiobookshelf**: fetch in-progress items from `/api/me/items-in-progress`; fetch individual progress from `/api/me/progress/:id`; resolve by ASIN (audiobook.audible), iTunes ID (podcast), or ISBN (book). Set `consumedOn = "audiobookshelf"`. Owned items sync: list libraries and items; identify by ASIN/iTunes/ISBN.
- **Komga**: fetch reading progress; resolve by Anilist, Hardcover, Openlibrary, MAL, MangaUpdates, or Google Books IDs using V2 entity resolution sandbox scripts. Set `consumedOn = "komga"`. Owned items sync: list all books.
- **PlexYank**: sync owned items from Plex libraries only (no progress). Set `consumedOn = "plex_yank"`. Owned items sync: list libraries and items; resolve by TMDB/IMDB IDs.
- **YoutubeMusic**: fetch songs listened today. Two-phase cache: first sighting emits `progressPercent = 35`; subsequent sighting same day emits `progressPercent = 100`. Cache key uses `userId + integrationId + songIdentifier + localDateInTimezone` stored via app Redis with daily TTL. Set `consumedOn = "youtube_music"`.

---

### Sink Integrations — Execution Flow

1. Webhook request arrives at `POST /_i/:id` or `POST /api/webhooks/integrations/:id`.
2. Look up integration by ID.
3. If not found: return 404.
4. If disabled: create `import_run`, mark failed with `source_fetch = "Integration is disabled"`, return `202 { data: { runId } }`.
5. Check `user.preferences.disableIntegrations` — if true: create `import_run`, mark failed with `source_fetch = "Integrations are disabled for this user"`, return `202 { data: { runId } }`.
6. Create `import_run`, enqueue integration sink job on import queue, return `202 { data: { runId } }`.

Sink job execution:

1. Parse raw body + content-type using provider sink parser.
2. Sink parser returns `MediaImportAdapterResult { failures, entityGroups }`.
3. Feed through imports media pipeline with `EventWriteContext { origin: "integration", integrationId, importRunId }`.
4. Update `import_run`, update `integration.lastFinishedAt` on success, auto-disable check.

---

### Sink Provider Parsers

Each parser lives in `src/modules/integrations/providers/sink/`. Parsers receive raw body text and content-type. They output `MediaImportAdapterResult`.

- **Kodi**: deserialize JSON as `{ identifier, lot, progress, show_season_number?, show_episode_number? }`. Emit resolved ref with TMDB script. `consumedOn = "kodi"`.
- **Emby**: parse PascalCase JSON payload. Read `Item`, `Series`, and `PlaybackInfo` blocks; extract TMDB ID from `ProviderIds.Tmdb` or equivalent `Provider_tmdb` fields; calculate progress from tick ratio. `consumedOn = "emby"`.
- **PlexSink**: parse multipart form-data with JSON body from the `payload` field. Extract TMDB ID from GUIDs. Filter by `providerSpecifics.username` if set. Accept Plex `media.*` webhook events and calculate progress from `viewOffset / duration` (falling back to `100` for scrobbles with no offset). `consumedOn = "plex_sink"`.
- **JellyfinSink**: parse PascalCase JSON. Filter by `providerSpecifics.username` using `User.Name` (and accept `NotificationUsername` when present). Use `providerSpecifics.metadataProvider` (tmdb or tvdb, default tmdb) to select entity source. Calculate progress from `Session.PlayState.PositionTicks / Item.RunTimeTicks`. `consumedOn = "jellyfin_sink"`.
- **RyotBrowserExtension**: parse JSON payload from the V1 nested `{ url, data: { ... } }` shape while also accepting the simplified direct shape. Clean URL to derive provider name. Check disabled sites list. `consumedOn` = derived provider name.
- **GenericJson**: create `import_run`, mark failed with `stage = "source_fetch"`, message = "Generic JSON integration is not implemented in V2 yet". Do not update `lastFinishedAt`.

All sink parsers emit resolved refs where a native provider ID is available (TMDB ID → use `buildMovieOrShowImportRef` shared helper). For unknowns emit unresolved refs.

---

### Push Integrations — Event Trigger System

Push behavior lives entirely in builtin sandbox trigger scripts. No push-specific code in app modules.

Three new builtin after-create trigger scripts:

**`trigger.radarr-push`** — attached to builtin `add-entity-to-collection` event schema on the collection entity schema, `position = 1000`:

- If `trigger.properties.entitySchemaSlug !== "movie"` → no-op.
- Fetch active Radarr integrations via `appApiCall("GET", "/api/integrations?provider=radarr&isDisabled=false")`.
- For each integration: check if `trigger.entityId` (collectionId) is in `providerSpecifics.syncCollectionIds`. If not, skip.
- Fetch movie entity, extract externalId from `movie.tmdb` script. If entity is not from `movie.tmdb` → no-op.
- Call Radarr API via `httpCall`.

**`trigger.sonarr-push`** — attached to builtin `add-entity-to-collection` event schema on collection entity schema, `position = 1000`:

- Same pattern but `entitySchemaSlug === "show"`, requires `show.tvdb` entity. No-op if entity is from other provider.

**`trigger.jellyfin-push`** — attached to builtin `complete` event schemas for all media entity schemas, `position = 1000`:

- If `trigger.entitySchemaSlug` is not `movie` or `show` → no-op.
- Fetch active JellyfinPush integrations via `appApiCall("GET", "/api/integrations?provider=jellyfin_push&isDisabled=false")`.
- Fetch entity. Search Jellyfin by title/TMDB ID. Mark item as played via `httpCall`.
- If item not found in Jellyfin → no-op.

All push scripts check `user.preferences.disableIntegrations` via `getUserPreferences` and no-op if disabled.

No `import_run` records are created for push executions. Failures are visible only in sandbox job logs.

---

### Before-Trigger System

#### Schema Changes

`event_schema_trigger` gains `phase` and `position` columns. Existing rows get `phase = "after_create"`, `position = 1000`.

#### Event Service Flow

New flow for `createEvent`:

```
1. Resolve entity + event schema (as today).
2. Ensure entity in library if needed.
3. Run before_create triggers in ascending position order.
   - Each trigger receives raw (unvalidated) event input + EventWriteContext in sandbox context.
   - Trigger returns allow | skip(reason) | replace(body).
   - If replace: merge replacement properties/occurredAt/sessionEntityId.
   - If any trigger returns skip: stop, return skip result to caller (no event created, no after triggers).
   - If a before trigger job fails/times out: fail closed — event creation fails.
4. Validate final (possibly replaced) event properties against event schema.
5. Insert event.
6. Run after_create triggers asynchronously (existing behavior).
```

Before triggers run synchronously via BullMQ: enqueue, wait for job completion. Job wait uses the existing sandbox job timeout (no new config needed).

The sandbox runner validates the trigger driver return value against a typed schema based on `phase`. Before-trigger driver return schema:

```ts
{ action: "allow" }
{ action: "skip", reason: string }
{ action: "replace", body: { properties?, occurredAt?, sessionEntityId? } }
```

Replace cannot change `entityId` or `eventSchemaId`.

#### EventWriteContext

A new internal context type threaded through event creation:

```ts
{
  origin: "api" | "import" | "integration" | "sandbox",
  integrationId?: string,
  importRunId?: string
}
```

`origin` is not user-spoofable from public API (always set server-side). The context is available in the before-trigger sandbox context as `trigger.origin`, `trigger.integrationId`, `trigger.importRunId`.

#### Before-Trigger Skip Results

`createEventsBestEffortWithTriggers` returns:

```ts
{
  count: number,
  createdEvents: CreatedEventData[],
  failures: CreateEventsBestEffortFailure[],
  skipped: { itemIndex, reason, eventSchemaSlug, entityId }[]
}
```

Skipped items count as processed but not imported or failed in import_run counters.

Before-trigger failures (script error, timeout, invalid return) result in `import_run_failure` with `stage = "event_before_trigger"`.

After triggers do not run for skipped events.

---

### Integration Progress Policy — Before Trigger

One builtin before-create trigger script: `trigger.integration-progress-policy`, attached to all builtin `progress` event schemas, `position = 100`.

Script logic (executed before property validation; receives raw input):

1. If `trigger.origin !== "integration"` → `allow` immediately (normal validation handles invalid user input).
2. Parse `progressPercent` defensively (may be string, missing, etc.). If unparseable → `skip`.
3. Fetch integration record via `appApiCall("GET", "/api/integrations/:integrationId")`. Get `minimumProgress` and `maximumProgress`.
4. If `progressPercent < minimumProgress` → `skip(reason: "below_minimum_progress")`.
5. If `progressPercent > maximumProgress` → `replace(properties: { ...existing, progressPercent: 100 })`.
6. Build deduplication fingerprint from: `entityId + eventSchemaSlug + consumedOn + known subitem keys (showSeason, showEpisode, animeEpisode, mangaVolume, mangaChapter, podcastEpisode)`.
7. Fetch recent progress events via `appApiCall("GET", "/events?entityId=...&eventSchemaSlug=progress")`. Filter in script by fingerprint identity keys.
8. If latest matching event has same `progressPercent` as current → `skip(reason: "duplicate_progress")`.
9. If `progressPercent >= 100`:
   - Use `claimCachedValue(fingerprint, true, progressUpdateThresholdSeconds)` as race guard.
   - If not claimed: check recent events for matching `progressPercent = 100` within threshold using `appApiCall` results.
   - If recent matching completion exists → `skip(reason: "completed_recently")`.
10. Otherwise → `allow` (possibly with replaced progressPercent from step 5).

Read `SERVER_PROGRESS_UPDATE_THRESHOLD` via `getAppConfigValue` using the config path index.

---

### `claimCachedValue` Sandbox Host Function

New host function in `src/lib/sandbox/host-functions/`:

```ts
claimCachedValue(key: string, value: JsonValue, ttlSeconds: number)
```

Returns:

```ts
{ success: true, data: { claimed: true } }
{ success: true, data: { claimed: false, value: JsonValue | null } }
{ success: false, error: string }
```

Implementation: Redis `SET key serializedValue NX EX ttlSeconds`. Redis key is still script-scoped: `sandbox:cache:{scriptId}:{key}`. If NX fails, reads and returns existing value. Available to all sandbox scripts, not before-trigger specific.

---

### Collection Events

Two new builtin event schemas on the `collection` entity schema:

- `add-entity-to-collection` — properties: `{ entityId: string, entitySchemaSlug: string, relationshipId: string, relationshipProperties?: object }`
- `remove-entity-from-collection` — properties: same shape

Both are added to the builtins seeding.

The `addToCollection` service:

1. Checks whether membership relationship was newly inserted (not updated via upsert).
2. If newly inserted: within a DB transaction, emit `add-entity-to-collection` event on the collection entity via `createEventBySchemaSlugWithTriggers` from the events module.
3. `event.entityId = collectionId`, properties include added entity ID, added entity schema slug, relationship ID, relationship properties.

The `removeFromCollection` service:

1. Deletes membership.
2. If a row was actually deleted: emit `remove-entity-from-collection` event on the collection entity.

Collection event emission and the relationship write happen in the same DB transaction. If event creation fails, the transaction rolls back.

The events module exposes a new public service function `createEventBySchemaSlugWithTriggers` that resolves event schema by slug for a given entity, validates properties, creates the event, and dispatches triggers.

`add-entity-to-collection` events trigger Radarr and Sonarr push scripts (after_create, position 1000). `remove-entity-from-collection` triggers no scripts in this PRD but the event schema exists.

---

### Ownership via In-Library Relationship

The `in-library` builtin relationship schema is widened to include optional `owned`, `ownershipSources`, and `ownershipSyncedAt` properties.

The `entities` module gains a new helper: `writeOwnershipToLibrary(userId, entityId, provider, syncedAt)` which:

1. Ensures the entity is in the user's library (`ensureEntityInLibrary`).
2. Reads current `in-library` relationship properties.
3. Merges: sets `owned = true`, appends provider to `ownershipSources` if not already present (deduped), sets `ownershipSyncedAt = now`.
4. Writes updated properties back to the relationship row.

Integration `syncOwnership = true` triggers this helper for each owned item returned by the Yank adapter's owned-items fetch.

Ownership sync is additive only: removing an item from an external library does not remove the `owned` flag.

---

### User Preference — `disableIntegrations`

The `userPreferencesSchema` gains a new optional boolean field `disableIntegrations`, default `false`.

Behavior when true:

- Yank scheduled jobs: no-op without creating import_run.
- Sink webhook calls: create `import_run`, mark failed with `source_fetch = "Integrations are disabled for this user"`, return `202` with runId.
- Push trigger scripts: check preference via `getUserPreferences`, no-op if disabled.

---

### Startup Sequence Change

After `initializeWorkers()` and before `dispatchBuiltinEntityPreloadJobs()`, add `reconcileIntegrationScheduler()`:

- Loads all enabled Yank integrations from DB.
- Converts `SCHEDULER_FREQUENT_CRON_JOBS_SCHEDULE` to cron expression via `english-to-cron`.
- Removes stale repeat jobs (integrations that are deleted, disabled, or have different schedule).
- Adds missing repeat jobs for enabled Yank integrations.

---

### Legacy Bootstrap — Integration Migration

Add `integration-mapping.ts` and wire it in `migrate-data.ts` after collection/entity migrations. Because the V2 schema reuses the `integration` table name and the Drizzle `CREATE TABLE integration` has no `IF NOT EXISTS`, the V1 `integration` table is first renamed to `old_integration` in `rename-tables.ts` (its `integration_pkey` constraint too, to avoid an index-name collision) before Drizzle runs, and dropped at the end in `drop-tables.ts`.

SQL `DO` block behavior:

- Verify `old_integration` table exists (raise if missing).
- For each row in the `old_integration` table:
  - Map `lot` and `provider` directly (already snake_case in V1 DB).
  - Transform `provider_specifics` from flat V1 JSONB to discriminated union JSONB:
    - Rename fields to camelCase.
    - Add `kind = provider`.
    - Fail fast if required fields are missing for that provider.
  - Map `sync_to_owned_collection → syncOwnership`.
  - Map `extra_settings.disable_on_continuous_errors → extraSettings.disableOnContinuousErrors`.
  - Coalesce nulls to V2 defaults: `minimumProgress COALESCE(old, 2)`, `maximumProgress COALESCE(old, 95)`, `isDisabled COALESCE(old, false)`, `syncOwnership COALESCE(old, false)`.
  - GenericJson specifics: `{ kind: "generic_json" }`.
  - Insert with `ON CONFLICT (id) DO NOTHING` (restart-safe).
  - Preserve V1 IDs exactly (critical for webhook URL continuity).

---

### Legacy Bootstrap — V1 Owned Collection Migration

Add logic in collection migration to handle V1 Owned collection specially:

- Identify V1 Owned collections by exact name match `name = 'Owned'`, per user.
- Migrate the collection entity row as normal (V2 collection entity exists).
- Migrate `member-of` relationships as normal.
- Additionally: for each entity in the V1 Owned collection, upsert `in-library` relationship properties to set `owned = true`, `ownershipSources = ["legacy"]`.

---

### Legacy Bootstrap — User Preference Migration

Add `disableIntegrations` field to `user-auth-mapping.ts` preference migration:

```sql
'disableIntegrations', COALESCE((legacy_users.preferences -> 'general' ->> 'disable_integrations')::boolean, false)
```

---

### `import_run.source` Enum Extension

Extend `importRunSource` enum to include all integration provider IDs as valid source values:
`plex_yank`, `plex_sink`, `komga`, `audiobookshelf`, `youtube_music`, `kodi`, `emby`, `jellyfin_sink`, `generic_json`, `ryot_browser_extension`, `radarr`, `sonarr`, `jellyfin_push`.

For integration-triggered runs, `source = integration.provider`. `integrationId` FK distinguishes integration runs from manual import runs.

---

### Import Run Filtering

- `listImportRunsByUser` default: `WHERE integrationId IS NULL`.
- `listIntegrationRuns(integrationId)`: `WHERE integrationId = ?`.
- `getImportRunById(id, userId)`: no filter on integrationId; user ownership check via userId only.

---

### Builtin Trigger Positions and Slugs

| Script slug                              | Phase         | Position | Event schema                            | Notes                            |
| ---------------------------------------- | ------------- | -------- | --------------------------------------- | -------------------------------- |
| `trigger.integration-progress-policy`    | before_create | 100      | `progress` (all media entity schemas)   | Global builtin                   |
| `trigger.auto-complete-on-full-progress` | after_create  | 1000     | `progress` (all media entity schemas)   | Existing, updated to new columns |
| `trigger.radarr-push`                    | after_create  | 1000     | `add-entity-to-collection` (collection) | Global builtin                   |
| `trigger.sonarr-push`                    | after_create  | 1000     | `add-entity-to-collection` (collection) | Global builtin                   |
| `trigger.jellyfin-push`                  | after_create  | 1000     | `complete` (all media entity schemas)   | Global builtin                   |

---

### Integration Module File Structure

```
src/modules/integrations/
  index.ts
  schemas.ts
  repository.ts
  service.ts
  routes.ts
  jobs.ts
  worker.ts
  scheduler.ts
  providers/
    yank/
      audiobookshelf.ts
      komga.ts
      plex-yank.ts
      youtube-music.ts
    sink/
      kodi.ts
      emby.ts
      generic-json.ts
      plex-sink.ts
      jellyfin-sink.ts
      ryot-browser-extension.ts
    shared/
      ownership.ts
```

Push behavior lives in sandbox scripts only, not in this directory.

---

### YoutubeMusic Cache Strategy

First encounter per song per day:

- Cache key: `{userId}:{integrationId}:{songIdentifier}:{localDate}` (localDate in user's configured timezone).
- Use `claimCachedValue` to atomically claim the key with TTL = end of local day in seconds.
- If claimed: emit `progressPercent = 35`.

Second encounter same day:

- `claimCachedValue` returns `claimed: false` with existing value.
- Emit `progressPercent = 100`.

`consumedOn = "youtube_music"`.

---

### Webhook Content Type Handling

Sink webhook route reads the raw request body as text and passes both body text and `Content-Type` header to provider parsers. Parsers handle JSON vs multipart form-data internally. This avoids a single parse attempt that would fail for Plex's form-data format.

---

### Import Run `inputSummary` for Integration Runs

```ts
{
  integrationId: string,
  provider: string,
  lot: string,
  name?: string
}
```

No secrets.

---

### Integration Run `totalItems`

Set to number of normalized entity groups produced by the adapter after source fetch/normalization, consistent with manual import behavior.

## Testing Decisions

**What makes a good test:** Tests verify observable external behavior and business rules, not internal implementation details. They avoid testing library behavior (Zod parsing, BullMQ internals), trivial pass-through, or pure type assertions. Integration-specific tests focus on normalization correctness, deduplication logic, and correct failure handling.

### Provider Sink/Yank Adapter Tests

Each provider adapter should have a unit test beside it. Input: sample raw payloads (JSON strings, multipart bodies). Expected output: `MediaImportAdapterResult` with correct entity groups, resolved/unresolved refs, and failure items where applicable. Test coverage: one happy path per adapter, malformed payload failure, username filter behavior (Plex/Jellyfin). Prior art: `apps/app-backend/src/modules/imports/sources/goodreads/adapter.test.ts`.

### Integration Service Tests

Test CRUD business rules: default value application, `minimumProgress <= maximumProgress` validation, `provider === providerSpecifics.kind` validation, PATCH secret preservation, auto-disable logic (query last 5 runs, check all failed). Prior art: `apps/app-backend/src/modules/imports/service.test.ts`.

### Scheduler Tests

Test repeat job reconciliation: adds missing jobs for enabled integrations, removes stale jobs for disabled/deleted integrations, removes and recreates when cron expression changes, handles empty integration list correctly.

### Before-Trigger Processing Tests

Test the event service before-trigger flow: allow passes through and allows insert, skip prevents insert and returns skip result, replace merges properties correctly, before-trigger failure results in fail-closed error (no insert), replaced properties that fail schema validation also fail closed. Prior art: `apps/app-backend/src/modules/events/trigger-processing.test.ts` and `apps/app-backend/src/modules/events/service.test.ts`.

### `claimCachedValue` Host Function Tests

Test atomic claim behavior: first call claims and returns `claimed: true`; second call returns `claimed: false` with stored value; invalid key/scriptId inputs return failure. Prior art: `apps/app-backend/src/lib/sandbox/host-functions/set-cached-value.test.ts`.

### Collection Event Tests

Test that `addToCollection` emits `add-entity-to-collection` on new insert and not on upsert update. Test that `removeFromCollection` emits `remove-entity-from-collection` only when a row was actually deleted. Test transaction rollback if event creation fails. Prior art: `apps/app-backend/src/modules/entities/service.test.ts`.

### Ownership Helper Tests

Test `writeOwnershipToLibrary`: merges sources correctly, does not duplicate provider in `ownershipSources`, updates `ownershipSyncedAt`, sets `owned = true`. Prior art: `apps/app-backend/src/modules/entities/service.test.ts`.

## Out of Scope

- **GenericJson runtime implementation**: The integration row and config are migrated. Webhook calls return a failed import_run with `source_fetch` failure. Runtime execution will be a separate PRD.
- **Push integration execution history**: Push sandbox after-trigger jobs do not create `import_run` records. Failure visibility is limited to sandbox job logs.
- **Notification system for auto-disable**: V2 has no notification system. Auto-disable happens silently (integration is disabled, no user notification).
- **V1 Monitoring, Reminders, Watchlist, In Progress, Completed collection migration from Owned migration work**: Only the Owned collection's ownership state is handled here. Other default collection migrations remain as decided in `docs/decisions.md`.
- **Per-integration schedule**: All Yank integrations share the global `SCHEDULER_FREQUENT_CRON_JOBS_SCHEDULE`.
- **`SCHEDULER_INFREQUENT_CRON_JOBS_SCHEDULE`**: Ported to config for V1 compatibility but not actively used by any integrations job in this PRD.
- **SERVER_DISABLE_BACKGROUND_JOBS**: Not ported to V2.
- **Pro/server-key gating**: No providers are gated behind a pro key in V2.
- **Manual "run now" endpoint for Yank integrations**.
- **`update-entity-in-collection` event schema**: Deferred to a future PRD.
- **Radarr/Sonarr push for non-TMDB movies or non-TVDB shows**: No-op if entity is not from the expected provider.
- **JellyfinPush episodic completion**: V2 complete events are whole-entity only; episode-level push is not possible in this PRD.
- **Relationship schema trigger system**: A generic system to emit events from relationship changes is not added. Collection event emission is explicit service code.

## Further Notes

- Integration IDs from V1 are preserved exactly to keep existing webhook URLs valid. New V2 integrations use the app-backend standard ID generator.
- The `/_i/:id` route is mounted at root level (not under `/api`) to avoid Caddy dependency and preserve the V1-compatible short URL format.
- The `disableIntegrations` user preference is migrated from V1 `preferences.general.disable_integrations`.
- The `english-to-cron` npm package is used to parse cron phrases; it must be added as an exact-version dependency in `apps/app-backend`.
- Before triggers are synchronous relative to event creation but still queued through BullMQ — the event creation response waits for before-trigger job completion. This means progress event creation for integrations may be slower than direct API writes. Accepted trade-off for keeping behavior DB-backed.
- The integration progress policy before trigger runs for all `progress` events globally (not just integrations), but immediately no-ops when `origin !== "integration"`. This adds one BullMQ round-trip to every progress event creation. Acceptable because the before-trigger is generic and behavior is fully DB-driven.
- Push trigger scripts query `GET /api/integrations?provider=...&isDisabled=false` at execution time. For users with no push integrations, these jobs fire and return an empty list, then no-op. Acceptable cost to keep behavior DB-backed without per-integration trigger lifecycle management.
- `sonarr.tagIds` is kept as `number?` (single integer) to match V1's data shape exactly. This is a known V1 quirk preserved for migration fidelity.

---

## Tasks

**Overall Progress:** 10 of 10 tasks completed

**Current Task:** [Task 10 — Codebase Cleanup](./10-codebase-cleanup.md) (todo)

### Task List

| #   | Task                                                                                                       | Type | Status |
| --- | ---------------------------------------------------------------------------------------------------------- | ---- | ------ |
| 01  | [Foundation: Schema, Config, and Builtins](./01-foundation-schema-config-builtins.md)                      | AFK  | done   |
| 02  | [Before-Trigger Event System](./02-before-trigger-event-system.md)                                         | AFK  | done   |
| 03  | [Collection Events and Ownership Infrastructure](./03-collection-events-and-ownership.md)                  | AFK  | done   |
| 04  | [Integrations CRUD, Scheduling, and Webhook Infrastructure](./04-integrations-crud-scheduling-webhooks.md) | AFK  | done   |
| 05  | [Yank Integration Execution and Adapters](./05-yank-integration-adapters.md)                               | AFK  | done   |
| 06  | [Sink Integration Execution and Adapters](./06-sink-integration-adapters.md)                               | AFK  | done   |
| 07  | [Push and Progress-Policy Sandbox Scripts](./07-push-and-progress-policy-scripts.md)                       | AFK  | done   |
| 08  | [Legacy Bootstrap Migration](./08-legacy-bootstrap-migration.md)                                           | AFK  | done   |
| 09  | [E2E Tests](./09-e2e-tests.md)                                                                             | AFK  | done   |
| 10  | [Codebase Cleanup](./10-codebase-cleanup.md)                                                               | AFK  | todo   |
