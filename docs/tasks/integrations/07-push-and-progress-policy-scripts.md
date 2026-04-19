# Push and Progress-Policy Sandbox Scripts

**Parent Plan:** [Integrations](./README.md)

**Type:** AFK

**Status:** done

## What to build

All integration behavior that lives in sandbox scripts rather than app code:

1. `trigger.integration-progress-policy` — a `before_create` trigger on `progress` event schemas that enforces min/max thresholds and deduplication for integration-origin writes.
2. `trigger.radarr-push` — an `after_create` trigger on `add-entity-to-collection` that pushes movies to Radarr.
3. `trigger.sonarr-push` — an `after_create` trigger on `add-entity-to-collection` that pushes shows to Sonarr.
4. `trigger.jellyfin-push` — an `after_create` trigger on `complete` events that marks media as played in Jellyfin.

All scripts are global builtins (`userId = null`, `isBuiltin = true`). No integration-service lifecycle management is needed for these triggers — they are seeded at startup and always active.

Refer to the **Integration Progress Policy — Before Trigger**, **Push Integrations — Event Trigger System**, and **Builtin Trigger Positions and Slugs** sections of the parent PRD.

**Prerequisites:** Task 01 (schema — phase/position columns), Task 02 (before-trigger system, claimCachedValue), Task 03 (add-entity-to-collection event schema).

---

### 1. Script storage

Scripts live as `.txt` files in `src/lib/sandbox/scripts/` following the existing pattern. Existing scripts like `auto-complete-on-full-progress.txt` are the reference for structure, host function declarations, and the `driver("trigger", ...)` entry point pattern.

Script metadata declares which host functions are allowed. Push scripts need `httpCall`, `listIntegrations`, `getEntity`, `getEntitySchema`, and `getUserPreferences`. The progress-policy script needs `listEvents`, `getIntegration`, `getSystemConfig`, and `claimCachedValue`.

### 2. `trigger.integration-progress-policy` script

**Attached to:** all builtin `progress` event schemas (one trigger link per media entity schema that has a `progress` event schema), `phase = "before_create"`, `position = 100`.

**Script logic (in order):**

1. Early exit: if `trigger.origin !== "integration"` → return `{ action: "allow" }`.
2. Defensive parse of `trigger.properties.progressPercent`. If missing, not a number, or NaN → return `{ action: "skip", reason: "invalid_progress" }`.
3. Fetch the integration config: `getIntegration(trigger.integrationId)`. Extract `minimumProgress` and `maximumProgress`.
4. If `progressPercent < minimumProgress` → return `{ action: "skip", reason: "below_minimum_progress" }`.
5. If `progressPercent > maximumProgress` → return `{ action: "replace", body: { properties: { ...trigger.properties, progressPercent: 100 } } }`. Assign `progressPercent = 100` for subsequent steps.
6. Build dedupe fingerprint from: `trigger.entityId + trigger.eventSchemaSlug + (trigger.properties.consumedOn ?? "") + known subitem key values` (showSeason, showEpisode, animeEpisode, mangaVolume, mangaChapter, podcastEpisode — concatenate only those present as `key=value` pairs).
7. Fetch recent progress events: `listEvents({ entityId: trigger.entityId, eventSchemaSlug: "progress" })`. Returns array of events ordered by `occurredAt desc, createdAt desc`.
8. Filter events by fingerprint identity (same `consumedOn` + same subitem keys).
9. If latest matching event has same `progressPercent` as current → return `{ action: "skip", reason: "duplicate_progress" }`.
10. If `progressPercent >= 100`:
    a. Use `claimCachedValue(fingerprint, true, thresholdSeconds)` as atomic guard.
    b. If `claimed = true`: this is the first 100% for this item within the threshold — proceed (allow/replace).
    c. If `claimed = false`: check the most recent matching event from step 7/8 with `progressPercent = 100`. If its `occurredAt` is within `thresholdSeconds` of now → return `{ action: "skip", reason: "completed_recently" }`.
11. Return `{ action: "allow" }` (or `{ action: "replace" }` if step 5 modified the properties).

Read the threshold via `getSystemConfig()` and extract `system.scheduler.progressUpdateThresholdHours`. Convert hours to seconds. If config is unavailable, default to 7200 (2 hours).

The script receives `trigger.origin`, `trigger.integrationId`, `trigger.importRunId`, and raw unvalidated `trigger.properties`.

### 3. `trigger.radarr-push` script

**Attached to:** builtin `add-entity-to-collection` event schema on the `collection` entity schema, `phase = "after_create"`, `position = 1000`.

**Script logic:**

1. Early exit: if `trigger.properties.entitySchemaSlug !== "movie"` → return.
2. Check `getUserPreferences()`. If `preferences.disableIntegrations === true` → return.
3. Fetch active Radarr integrations: `listIntegrations({ provider: "radarr", isDisabled: false })`.
4. If empty → return.
5. For each Radarr integration:
   a. If `trigger.entityId` (collectionId) is not in `integration.providerSpecifics.syncCollectionIds` → skip this integration.
   b. Fetch entity: `getEntity(trigger.properties.entityId)`.
   c. If entity `sandboxScriptId` does not correspond to `movie.tmdb` (check script slug or externalId format) → skip (no-op, entity is not from TMDB).
   d. Extract TMDB ID from `entity.externalId`.
   e. Call Radarr API via `httpCall`: `POST {baseUrl}/api/v3/movie` with `{ tmdbId, qualityProfileId: profileId, rootFolderPath, tags: tagIds ?? [] }` and header `X-Api-Key: {apiKey}`.
   f. Log result; do not throw on 409 (movie already in Radarr).

### 4. `trigger.sonarr-push` script

**Attached to:** builtin `add-entity-to-collection` event schema on the `collection` entity schema, `phase = "after_create"`, `position = 1000`.

**Script logic:** Identical pattern to Radarr but:

- `trigger.properties.entitySchemaSlug !== "show"` → return.
- Fetch `provider=sonarr` integrations.
- Entity must have `show.tvdb` script slug.
- Call Sonarr API: `POST {baseUrl}/api/v3/series` with `{ tvdbId: entity.externalId, qualityProfileId: profileId, rootFolderPath, tags: tagIds ?? undefined }`.

### 5. `trigger.jellyfin-push` script

**Attached to:** all builtin `complete` event schemas (one trigger link per media entity schema with a `complete` schema), `phase = "after_create"`, `position = 1000`.

**Script logic:**

1. Early exit: if `trigger.entitySchemaSlug` is not `"movie"` or `"show"` → return.
2. Check `getUserPreferences()`. If `preferences.disableIntegrations === true` → return.
3. Fetch active JellyfinPush integrations: `listIntegrations({ provider: "jellyfin_push", isDisabled: false })`.
4. If empty → return.
5. Fetch entity: `getEntity(trigger.entityId)`.
6. For each JellyfinPush integration:
   a. Authenticate to Jellyfin: `POST {baseUrl}/Users/AuthenticateByName` with `{ Username, Pw: password }`.
   b. Search Jellyfin for the item by entity name or TMDB ID (if entity has `movie.tmdb` or `show.tmdb` script).
   c. If not found → skip (no-op, item is not in Jellyfin).
   d. Mark as played: `POST {baseUrl}/Users/{userId}/PlayedItems/{itemId}` with Jellyfin auth header.

### 6. Seeding builtin trigger links

In `src/modules/builtins/manifests.ts` (or wherever `builtinEventSchemaTriggerLinks` returns its array), add new entries for all four new scripts:

```ts
{
  scriptSlug: "trigger.integration-progress-policy",
  triggerName: "Integration Progress Policy",
  eventSchemaSlug: "progress",
  phase: "before_create",
  position: 100,
  metadata: {},
}
// One entry per push script:
{
  scriptSlug: "trigger.radarr-push",
  triggerName: "Radarr Push",
  eventSchemaSlug: "add-entity-to-collection",
  phase: "after_create",
  position: 1000,
  metadata: {},
}
// similarly for sonarr-push and jellyfin-push
```

The seeding `ensureBuiltinEventSchemaTrigger` upsert must write `phase` and `position` correctly. If `phase` and `position` are not yet part of the upsert logic, extend it now.

Also update the existing `auto-complete-on-full-progress` link entry to explicitly include `phase: "after_create"` and `position: 1000` so the upsert writes those values.

Sandbox script DB records for the new scripts must be seeded at startup alongside existing scripts.

## Acceptance criteria

- [x] `trigger.integration-progress-policy` is a builtin before-create trigger on all `progress` event schemas at position 100.
- [x] Integration progress writes with `progressPercent < minimumProgress` are skipped without error.
- [x] Integration progress writes with `progressPercent > maximumProgress` are replaced with 100.
- [x] Duplicate progress events (same percentage, same entity, same provider) are skipped.
- [x] Completion events within `SERVER_PROGRESS_UPDATE_THRESHOLD` hours are skipped using `claimCachedValue` as race guard.
- [x] Non-integration progress events (`origin !== "integration"`) bypass the policy immediately.
- [x] `trigger.radarr-push` fires on collection add events and calls Radarr API for TMDB-sourced movies in configured sync collections.
- [x] `trigger.radarr-push` no-ops for non-movie entity schema slugs.
- [x] `trigger.radarr-push` no-ops when the entity is not from `movie.tmdb`.
- [x] `trigger.radarr-push` no-ops when the collection is not in the integration's `syncCollectionIds`.
- [x] `trigger.sonarr-push` same criteria but for shows with `show.tvdb`.
- [x] `trigger.jellyfin-push` fires on complete events for movies and shows, authenticates to Jellyfin, and marks item as played.
- [x] `trigger.jellyfin-push` no-ops when the item is not found in Jellyfin.
- [x] All push scripts no-op when `user.preferences.disableIntegrations = true`.
- [x] All four trigger links are seeded at startup with correct phase and position.
- [x] The existing `auto-complete-on-full-progress` trigger continues to function correctly with the updated seeding.

## User stories addressed

- User story 13 (Radarr push to download movies from synced collection)
- User story 14 (Sonarr push to download shows from synced collection)
- User story 15 (JellyfinPush marks completed media as played)
- User story 33 (integration progress deduplication)
- User story 34 (completion deduplication within threshold window)
- User story 44 (push behavior in sandbox scripts, not app modules)
- User story 45 (push behavior fully DB-backed)
