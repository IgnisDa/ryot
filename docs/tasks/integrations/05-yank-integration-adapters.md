# Yank Integration Execution and Adapters

**Parent Plan:** [Integrations](./README.md)

**Type:** AFK

**Status:** done

## What to build

Complete the Yank integration execution path: fill in the worker logic scaffolded in task 04, and implement all four Yank provider adapters (Audiobookshelf, Komga, PlexYank, YoutubeMusic). Yank integrations pull data from external services on a schedule and feed it through the existing imports media pipeline.

Refer to the **Yank Integrations — Execution Flow**, **Yank Provider Adapters**, and **Yank job resumability** sections of the parent PRD for the complete contract.

**Prerequisites:** Task 01 (schema), Task 02 (EventWriteContext, before triggers), Task 03 (writeOwnershipToLibrary), Task 04 (integration CRUD, worker scaffold, import queue).

---

### 1. Yank worker execution flow

Fill in the Yank branch of the integration worker (scaffolded in task 04). When `integration.lot === "yank"`:

1. Check `user.preferences.disableIntegrations` — if true, no-op and return (no import_run created or updated).
2. Set `import_run.status = "running"`, `import_run.startedAt = now`.
3. Call the provider adapter (see adapters below) with credentials from `integration.providerSpecifics`.
4. The adapter returns `MediaImportAdapterResult { failures, entityGroups }`.
5. If `integration.syncOwnership === true` and the provider supports it: call the provider's `syncOwnedItems` function; merge returned owned entity IDs through `writeOwnershipToLibrary` (from task 03).
6. Feed `entityGroups` through the imports media pipeline (`processMediaImport` or equivalent) with `EventWriteContext { origin: "integration", integrationId: integration.id, importRunId: run.id }`.
7. Record adapter-level `failures` as `import_run_failure` rows with `stage = "input_transformation"`.
8. On completion: update `import_run.status`, counters (`totalItems`, `processedItems`, `importedItems`, `failedItems`), `finishedAt`.
9. If success: update `integration.lastFinishedAt = now`.
10. Call `checkAndAutoDisable` from the integration service.

The Yank job reuses the imports pipeline resumability (phase-based job data in BullMQ). If the job crashes after the adapter load phase, the next BullMQ retry picks up at the resolve/populate/write phase without re-fetching the source. The job data shape matches `ImportRunJobData` from the imports module, extended with `integrationId`.

### 2. Audiobookshelf adapter

File: `src/modules/integrations/providers/yank/audiobookshelf.ts`

**Progress sync:**
- HTTP client: `Authorization: Bearer {providerSpecifics.token}` against `providerSpecifics.baseUrl`.
- Fetch in-progress items: `GET /api/me/items-in-progress`.
- For each item, determine media type and identifier by priority:
  1. ASIN → `MediaLot::AudioBook` resolved via `audiobook.audible` script slug.
  2. iTunes ID + episode title → `MediaLot::Podcast` resolved via `podcast.itunes`. Match episode number by fetching item metadata and comparing episode title.
  3. ISBN → `MediaLot::Book` resolved via multi-provider chain: try `book.hardcover`, `book.openlibrary`, `book.google-book` in order using the unresolved-ref pattern.
  4. If none match: record as `input_transformation` failure.
- Fetch individual item progress: `GET /api/me/progress/{progressId}`. Use `max(progress, ebook_progress)` as progress value.
- Skip items where `is_finished === true` and progress is 100%.
- Set `consumedOn = "audiobookshelf"` on each seen history entry.
- Return `MediaImportAdapterResult`.

**Owned items sync** (only when `syncOwnership === true`):
- List libraries: `GET /api/libraries`.
- For each library, list items: `GET /api/libraries/{id}/items`.
- Identify items by ASIN (audiobook), iTunes ID (podcast), or ISBN (book).
- Return list of `{ entityRef, provider: "audiobookshelf" }` for `writeOwnershipToLibrary`.

### 3. Komga adapter

File: `src/modules/integrations/providers/yank/komga.ts`

**Progress sync:**
- HTTP client: `Authorization: Basic base64({providerSpecifics.apiKey}:{blank password})` against `providerSpecifics.baseUrl`. (Komga uses API key as username with a blank password in Basic auth, or as a Bearer token depending on version — implement both and fall back.)
- Fetch reading progress: use Komga's read progress API (consult V1 implementation for endpoints).
- For each item, resolve identifier by priority: Anilist ID, Hardcover ID, Openlibrary ID, MAL ID, MangaUpdates ID, Google Books ID. Use the unresolved-ref pattern with appropriate sandbox script slugs.
- Items with no resolvable identifier: record as `input_transformation` failure.
- Set `consumedOn = "komga"`.

**Owned items sync:**
- List all books via Komga API.
- For each book, resolve by same identifier priority.
- Return list for `writeOwnershipToLibrary`.

### 4. PlexYank adapter

File: `src/modules/integrations/providers/yank/plex-yank.ts`

PlexYank is owned-items sync only — it does not emit progress events.

**No progress sync** (return empty `entityGroups` from the progress adapter function).

**Owned items sync** (called when `syncOwnership === true`):
- List Plex libraries: `GET {baseUrl}/library/sections?X-Plex-Token={token}`.
- For each library, list items: `GET {baseUrl}/library/sections/{id}/all`.
- Resolve by TMDB ID (movie → `movie.tmdb`, show → `show.tmdb`) or IMDB ID (unresolved ref for TMDB resolution) from Plex GUIDs.
- Items without a resolvable TMDB/IMDB ID: record as failure.
- Set `consumedOn = "plex_yank"`.

### 5. YoutubeMusic adapter

File: `src/modules/integrations/providers/yank/youtube-music.ts`

**Progress sync:**
- Fetch songs listened today from YouTube Music API using `providerSpecifics.authCookie`.
- For each song, compute local date in `providerSpecifics.timezone`.
- Cache key: `{userId}:{integrationId}:{songIdentifier}:{localDate}`.
- Use `claimCachedValue(key, true, ttlUntilEndOfDay)` where TTL is seconds until midnight in the user's configured timezone.
  - If `claimed = true` (first sighting today): emit `progressPercent = 35`.
  - If `claimed = false` (already seen today): emit `progressPercent = 100`.
- Resolve by YouTube Music internal song ID → `music.youtube-music` sandbox script slug if it exists, otherwise `music.musicbrainz` or `music.spotify` with identifier cross-matching.
- Set `consumedOn = "youtube_music"`.

**No owned items sync** (YoutubeMusic does not support `syncOwnership`; the field is ignored for this provider).

### 6. Shared adapter output contract

All Yank adapters implement:

```ts
type YankAdapter = {
  fetchProgress(credentials: ProviderSpecifics): Promise<MediaImportAdapterResult>;
  syncOwnedItems?(credentials: ProviderSpecifics): Promise<Array<{
    entityRef: ImportEntityRef;
    provider: string;
  }>>;
}
```

The worker calls `fetchProgress` for all Yank integrations. It calls `syncOwnedItems` only when `integration.syncOwnership === true` and the adapter implements it.

### 7. EventWriteContext threading

When feeding `entityGroups` into the imports media pipeline write phase, pass:

```ts
EventWriteContext {
  origin: "integration",
  integrationId: integration.id,
  importRunId: run.id
}
```

The imports `processMediaImport` function must accept an optional `EventWriteContext` parameter and thread it into `createEventsBestEffortWithTriggers` calls. This is the minimal extension to the imports pipeline needed for integration support.

## Acceptance criteria

- [x] Audiobookshelf Yank integration creates `import_run` records and persists progress events for in-progress audiobooks, podcasts, and books.
- [x] Audiobookshelf items with no resolvable identifier produce `import_run_failure` rows with `stage = "input_transformation"`.
- [x] Audiobookshelf owned items sync writes `owned = true` on `in-library` relationships when `syncOwnership = true`.
- [x] Komga Yank integration resolves manga/comics via unresolved-ref identifier chain.
- [x] PlexYank emits no progress events; only writes owned items when `syncOwnership = true`.
- [x] YoutubeMusic first-sighting emits `progressPercent = 35`; second-sighting emits `progressPercent = 100`.
- [x] YoutubeMusic uses `claimCachedValue` keyed by userId + integrationId + songId + localDate.
- [x] All adapters set correct `consumedOn` provider ID string.
- [x] `integration.lastFinishedAt` is updated only on successful run completion.
- [x] Auto-disable check runs after each Yank execution.
- [x] Yank jobs no-op without creating an import_run when `user.preferences.disableIntegrations = true`.
- [x] `EventWriteContext { origin: "integration" }` is passed through to event creation.
- [x] Unit tests for each adapter: happy-path parse, unresolvable item failure, empty response. Prior art: `imports/sources/goodreads/adapter.test.ts`.

## User stories addressed

- User story 1 (Audiobookshelf in-progress sync)
- User story 2 (Komga reading progress sync)
- User story 3 (PlexYank owned items)
- User story 4 (YoutubeMusic sync)
- User story 22 (minimum progress threshold)
- User story 23 (maximum progress threshold)
- User story 30 (owned item sync for Yank integrations)
- User story 33 (progress deduplication — EventWriteContext enables before trigger)
- User story 34 (completion deduplication — EventWriteContext enables before trigger)
- User story 42 (SERVER_PROGRESS_UPDATE_THRESHOLD used by before trigger via EventWriteContext)
