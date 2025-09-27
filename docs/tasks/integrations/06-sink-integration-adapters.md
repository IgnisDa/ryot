# Sink Integration Execution and Adapters

**Parent Plan:** [Integrations](./README.md)

**Type:** AFK

**Status:** done

## What to build

Complete the Sink integration execution path: fill in the Sink branch of the worker scaffolded in task 04, and implement all six Sink provider parsers. Sink integrations receive live webhook payloads from external services and feed parsed data through the imports media pipeline.

Refer to the **Sink Integrations — Execution Flow** and **Sink Provider Parsers** sections of the parent PRD for the complete contract.

**Prerequisites:** Task 01 (schema), Task 02 (EventWriteContext), Task 04 (webhook route, worker scaffold, import queue). Task 05 is not a prerequisite — Sink and Yank can be built in parallel.

---

### 1. Sink worker execution flow

Fill in the Sink branch of the integration worker when `integration.lot === "sink"`:

1. Load integration from DB.
2. Call the provider sink parser (see parsers below) with `{ integration, rawBody, contentType }`.
3. The parser returns `MediaImportAdapterResult { failures, entityGroups }`.
4. Feed `entityGroups` through the imports media pipeline with `EventWriteContext { origin: "integration", integrationId: integration.id, importRunId: run.id }`.
5. Record parser-level `failures` as `import_run_failure` rows with `stage = "source_fetch"` or `"input_transformation"` as appropriate.
6. On completion: update `import_run.status`, counters, `finishedAt`.
7. If success: update `integration.lastFinishedAt = now`.
8. Call `checkAndAutoDisable`.

Note: `disableIntegrations` preference and `isDisabled` integration checks are handled at the webhook route level in task 04 before the job is even enqueued. The worker does not re-check those flags.

### 2. Shared parser contract

All Sink parsers implement:

```ts
type SinkParser = {
  parse(input: {
    integration: Integration;
    rawBody: string;
    contentType: string;
  }): Promise<MediaImportAdapterResult>;
}
```

Parsers return entity groups with resolved refs where a native provider ID is available. Use `buildMovieOrShowImportRef` (shared helper from imports `sources/shared/provider-refs.ts`) for TMDB/IMDB/TVDB ID resolution.

### 3. Kodi parser

File: `src/modules/integrations/providers/sink/kodi.ts`

- Parse `rawBody` as JSON: `{ identifier: string, lot: MediaLot, progress: number, show_season_number?: number, show_episode_number?: number }`.
- `identifier` is a TMDB ID. Emit resolved ref with TMDB script slug (`movie.tmdb` or `show.tmdb` based on `lot`).
- Set `consumedOn = "kodi"`.
- On parse failure: return `input_transformation` failure.

### 4. Emby parser

File: `src/modules/integrations/providers/sink/emby.ts`

- Parse `rawBody` as PascalCase JSON (Emby webhook payload format).
- Extract TMDB ID from `Provider_tmdb` or equivalent field.
- Calculate progress as `PositionTicks / RunTimeTicks * 100`.
- Emit resolved ref based on media type (movie or episode).
- Set `consumedOn = "emby"`.
- On missing TMDB ID or parse failure: return `input_transformation` failure.

### 5. PlexSink parser

File: `src/modules/integrations/providers/sink/plex-sink.ts`

- `contentType` will be `multipart/form-data`. Parse the form-data to extract the JSON `payload` field.
- From the Plex payload JSON: extract TMDB ID from `Metadata.Guid` array (look for `tmdb://` prefix) or `Provider_tmdb`.
- Calculate progress from `viewOffset / duration * 100` (both in milliseconds).
- If `providerSpecifics.username` is set, check the payload's `Account.title` field — skip (return empty adapter result) if it does not match.
- Only process events of type `scrobble`, `play`, `pause`, `resume`, `stop` (skip others silently).
- Emit resolved ref using `buildMovieOrShowImportRef`.
- Set `consumedOn = "plex_sink"`.

### 6. JellyfinSink parser

File: `src/modules/integrations/providers/sink/jellyfin-sink.ts`

- Parse `rawBody` as PascalCase JSON (Jellyfin notification payload).
- If `providerSpecifics.username` is set, check payload `NotificationUsername` — skip if mismatch.
- `providerSpecifics.metadataProvider` determines which ID field to use: `"tmdb"` (default) uses `Provider_tmdb`, `"tvdb"` uses `Provider_tvdb`.
- Calculate progress from `PlaybackPositionTicks / RunTimeTicks * 100`.
- Emit resolved ref:
  - tmdb → `buildMovieOrShowImportRef` with TMDB ID
  - tvdb → resolved ref with `show.tvdb` script slug
- Set `consumedOn = "jellyfin_sink"`.

### 7. RyotBrowserExtension parser

File: `src/modules/integrations/providers/sink/ryot-browser-extension.ts`

- Parse `rawBody` as JSON: `{ identifier: string, lot: MediaLot, progress: number, url?: string }`.
- If `providerSpecifics.disabledSites` is set, check if the URL's hostname matches any disabled site — skip (return empty) if so.
- Derive provider name from the URL's hostname (e.g., `netflix.com` → `"netflix"`, `hbo.com` → `"hbo"`). Use a simple hostname-to-name mapping.
- Emit resolved ref using TMDB ID.
- Set `consumedOn = derivedProviderName`.

### 8. GenericJson parser

File: `src/modules/integrations/providers/sink/generic-json.ts`

- Do not parse the payload.
- Return `MediaImportAdapterResult` with a single `source_fetch` failure: `message = "Generic JSON integration is not implemented in V2 yet"`.
- The worker will record this failure in `import_run_failure` and mark the run as failed.

### 9. EventWriteContext threading

Identical to task 05: pass `EventWriteContext { origin: "integration", integrationId, importRunId }` through to `processMediaImport`. No additional changes to the imports pipeline beyond what task 05 already adds.

## Acceptance criteria

- [x] Kodi webhook creates a progress event for the correct entity (movie or show) using TMDB ID.
- [x] Emby webhook calculates progress from tick ratio and resolves via TMDB ID.
- [x] PlexSink webhook parses multipart form-data, extracts TMDB ID from Plex GUIDs, and filters by username when configured.
- [x] PlexSink webhook ignores events with unsupported Plex event types.
- [x] JellyfinSink webhook filters by username when configured and uses the configured metadata provider (TMDB or TVDB).
- [x] RyotBrowserExtension parser skips payloads from disabled sites.
- [x] GenericJson creates a failed import_run with `stage = "source_fetch"` failure message.
- [x] All parsers set the correct `consumedOn` provider ID string.
- [x] `integration.lastFinishedAt` is updated only on successful run completion.
- [x] Auto-disable check runs after each Sink execution.
- [x] Unit tests cover each parser's happy path, malformed payload failure, and provider-specific skip behavior where applicable. Prior art: `imports/sources/goodreads/adapter.test.ts`.

## User stories addressed

- User story 5 (Kodi webhook integration)
- User story 6 (Emby webhook integration)
- User story 7 (PlexSink webhook integration)
- User story 8 (PlexSink username filter)
- User story 9 (JellyfinSink webhook integration)
- User story 10 (JellyfinSink metadata provider selection)
- User story 11 (RyotBrowserExtension webhook integration)
- User story 12 (RyotBrowserExtension disabled sites)
- User story 16 (GenericJson integration — runtime deferred but config migrated)
