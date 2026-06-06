# Imports One Time Runs

**Parent Plan:** [App Backend Effect Migration](./README.md)

**Type:** AFK

**Status:** done

## What to build

Migrate one-time import runs after entities, events, collections, uploads, sandbox, and query-relevant domain paths exist. Replace old queue state machines with Effect Workflow orchestration. Import runs should support creation, listing, retrieval, deletion, progress/failure persistence, uploaded file consumption, provider resolution, entity population, event writes, and collection membership writes according to existing product behavior.

This slice should not migrate scheduled integrations yet except where shared import pipeline primitives are needed by the next slice.

## Acceptance criteria

- [x] Authenticated users can create one-time import runs
- [x] Authenticated users can list, get, and delete their import runs
- [x] Import processing uses Effect Workflow or equivalent durable Effect primitives instead of BullMQ
- [x] Import failures and progress are persisted in typed domain records
- [x] Import writes use canonical entity, event, relationship, and collection paths
- [x] Import E2E tests pass through the Effect client

## User stories addressed

Reference by number from the parent PRD:

- User story 27
- User story 28
- User story 42
- User story 60

## Implementation notes (Effect port)

All V1 import sources except generic JSON are now ported to the Effect backend
(`apps/app-backend/src/modules/imports`).

### Source coverage

- **Measurement:** `open_scale`.
- **Workout (CSV):** `hevy`, `strong_app`.
- **Media file adapters** (`processMediaTextFileImport`, single CSV/JSON): `imdb`, `igdb`,
  `grouvee`, `watcharr`, `goodreads`, `hardcover`, `storygraph`, `anilist`.
- **Media multi-file processors:** `movary` (3 CSVs via inline payload paths), `myanimelist`
  (anime/manga `gz`/`xml`, `node:zlib` gunzip), `netflix` (ZIP extract + TMDB title search).
- **API connectors** (`source_payload` input kind): `trakt`, `plex`, `jellyfin`, `media_tracker`,
  `audiobookshelf`.

### Architecture

- Single-pass `ImportRunQueue` worker (resolve → populate → write) over in-memory
  `ImportMediaEntityGroup[]`; no BullMQ re-entrancy. Sandbox drivers run as nested workflow
  executions via `engine.execute(RunSandboxWorkflow, …)`: `resolve` (ISBN/IMDb → provider id),
  `details` (populate), and `search` (Netflix title → TMDB candidates, `searchGlobalEntities`).
- `ImportRunJobData` carries either an inline `sourcePayload` (file sources: igdb collection,
  netflix profile, movary/myanimelist file paths) or a `sourcePayloadKey`. API-source credentials
  are stored in Redis (`runtime/source-payload-store.ts`, 24h TTL) and only the key is persisted in
  the durable workflow payload — never API keys/passwords.
- API source fetches go through `runtime/source-api.ts` (`requestSourceJson` over `@effect/platform`
  `HttpClient`; `allowInsecureConnections` maps to `FetchHttpClient.RequestInit` `tls`).
- Dates use Effect `DateTime` only (no dayjs); timezone-aware parsing via `DateTime.makeZoned`
  (`media/dates.ts`). Source validation uses Effect `Schema` (no zod).
- `getImportSourceStartError` gates env-configured sources (igdb/imdb/netflix/movary/watcharr →
  TMDB, grouvee → Giant Bomb, hardcover → Hardcover, myanimelist → MAL, trakt → Trakt client id).

### Testing

Per the parent PRD ("do not add unit/E2E tests for individual source adapters"), file-source
adapters keep their ported normalization unit tests; API connectors are validated by `tsc` + the
project `check` only (their HTTP orchestration is verified manually). Full media E2E is not runnable
here without provider API keys and live sandbox/external services.
