## Problem Statement

Ryot V1 has a broad Rust importing system that accepts source exports and third-party API data,
normalizes them, commits provider-backed media, user progress, reviews, collections, workouts,
exercises, and measurements, and records item-level failures in import reports. V2 has a new
TypeScript backend, a generic entity/event model, temporary uploads, BullMQ workers, and sandbox
provider scripts, but it does not yet have a source-import pipeline equivalent to V1.

The V2 importer should not run full source importers inside the sandbox. Source importers need file
reads, ZIP extraction, external API calls, queue-backed progress, domain-service writes,
temporary-file cleanup, and item-level failure persistence. The sandbox should still be reused for
provider details and triggers because V2 already has provider scripts and seeded trigger behavior.

The import pipeline also depends on event occurrence time. Today V2 event chronology is based on
`createdAt`, which is row insertion time. Historical imports need a first-class event product time so
imported events can be ordered and used for state derivation by when they occurred, not when the
import ran.

## Solution

Build a V2 import module in `apps/app-backend/src/modules/imports` that runs source adapters as
normal TypeScript backend code, writes import runs and failures to new tables, reuses shared entity
population for provider-backed media, and commits normalized V2-native entities, events, collection
relationships, workouts, workout-set events, and measurements through the owning module services.

Add `event.occurredAt` as the canonical event chronology field. `createdAt` remains audit/row
creation time. Event listing, latest event joins, media state derivation, media overview chronology,
query-engine event references, sandbox trigger context, and app-client media overview queries must
use `occurredAt` where user-facing chronology is intended.

Keep the sandbox-backed trigger system. Rewrite the built-in auto-complete trigger to use the same
episodic completion logic as V1/V2 legacy bootstrap: walk `progress(100)` coverage chronologically,
emit a whole-entity `complete` event when all required coverage keys are covered, reset coverage,
and repeat for additional watch-through/read-through cycles.

The initial implementation should be sliced. The final PRD scope is all V1 sources except generic
JSON, but the first implementation slices should land infrastructure plus representative simple
sources before porting every adapter.

## User Stories

1. As a user, I want to start an import from a supported source, so that my exported history can be
   brought into V2.
2. As a user, I want imports to run in the background, so that large imports do not block API
   requests.
3. As a user, I want import runs to expose status, progress, and counters, so that I can tell whether
   the import is pending, running, completed, or failed.
4. As a user, I want item-level import failures to be visible, so that I can manually log the items
   that could not be imported.
5. As a user, I want failure details to include recognizable labels and source identifiers, so that I
   can identify the failed source item without raw files or secrets being stored.
6. As a user, I want imported media events to keep their historical occurrence time, so that my
   library state and activity ordering match when I actually watched, read, listened, or played.
7. As a user, I want completed movies, books, games, and other non-episodic media to import as
   complete lifecycle events, so that whole-item history is preserved.
8. As a user, I want watched episodes and read chapters to import as progress events with coverage
   keys, so that show/anime/manga/podcast completion is derived accurately.
9. As a user, I want repeated show/anime/manga/podcast completions to be represented, so that
   re-watches and re-reads are not collapsed into a single completion.
10. As a user, I want watchlist/current/dropped/on-hold source states to map to V2 lifecycle events,
    so that current state is derived from events rather than imported as collections.
11. As a user, I want reviews to import as review events, so that ratings and notes participate in
    the same event model as manually logged reviews.
12. As a user, I want source lists and shelves to become collections when they are not lifecycle
    aliases, so that source organization is preserved.
13. As a user, I want provider-backed media details populated before events are written, so that
    auto-complete and media overview logic have complete entity properties.
14. As a user, I want imports to link imported media into my library before writing events, so that
    the imported entities appear in my library views.
15. As a user, I want source API credentials and temporary file paths never stored in import
    summaries, so that sensitive data is not persisted unnecessarily.
16. As a user, I want temporary upload files cleaned up after import success or failure, so that raw
    import files are not retained.
17. As a user importing OpenScale data, I want every measurement statistic preserved uniformly, so
    that weight is not treated differently from body fat, waist, water, or other measurements.
18. As a user importing Hevy or StrongApp data, I want custom exercises reused where possible, so
    that duplicate custom exercises are not created for the same exercise name and kind.
19. As a user importing Hevy or StrongApp data, I want workouts to become workout entities and sets
    to become workout-set events, so that imported workouts use the V2 fitness model.
20. As a user importing workouts, I want derived set fields such as one-rep max, pace, and volume
    preserved, so that imported workout analytics match V1 behavior.
21. As a backend maintainer, I want one shared entity population path used by `/entities/import` and
    source imports, so that provider execution, property validation, related entities, and library
    linking do not diverge.
22. As a backend maintainer, I want source adapters to return V2-native normalized items, so that
    source parsing is separated from persistence.
23. As a backend maintainer, I want source adapters to collect item-level failures without throwing
    when possible, so that one bad row does not fail an entire import.
24. As a backend maintainer, I want source fetch/auth failures to fail the whole run, so that broken
    credentials or unavailable servers are surfaced clearly.
25. As a backend maintainer, I want imports to use the existing event service and trigger system, so
    that imported and manually logged events share semantics.
26. As a backend maintainer, I want auto-complete to refuse completion when episodic provider
    coverage is missing, so that incomplete metadata does not imply completion.
27. As a backend maintainer, I want V2 legacy bootstrap to set `occurredAt` on migrated events, so
    that restored V1 data follows the new event contract.
28. As an app-client maintainer, I want existing media overview queries to use `occurredAt`, so that
    client-side state and activity display match backend event semantics.
29. As a test maintainer, I want E2E measurement tests updated for the uniform statistics schema, so
    that seeded schemas and query-engine defaults remain verified.
30. As a future implementation agent, I want the PRD to define all import, event, report, provider,
    measurement, workout, file-safety, and testing decisions, so that implementation does not depend
    on prior conversation context.

## Implementation Decisions

### Source Scope

- Final V2 scope covers all V1 importers except generic JSON.
- Generic JSON remains deferred until V2 export infrastructure exists.
- Supported sources to port are: `igdb`, `imdb`, `plex`, `hevy`, `trakt`, `movary`, `anilist`,
  `grouvee`, `netflix`, `watcharr`, `jellyfin`, `open_scale`, `strong_app`, `goodreads`,
  `hardcover`, `storygraph`, `myanimelist`, `mediatracker`, and `audiobookshelf`.
- Use normalized source slugs in V2, for example `open_scale` and `strong_app`.
- Implement in vertical slices. Infrastructure should land before every source adapter is ported.
- First useful source slice should include OpenScale plus one simple media file importer. Hevy and
  StrongApp should be a separate fitness-workout slice. API and ZIP sources should follow after
  CSV/JSON sources.

### Event Occurrence Time

- Add `event.occurredAt` as a non-null timestamp with timezone.
- API event creation accepts optional `occurredAt` as an ISO datetime.
- `occurredAt` is the canonical product time for user-facing chronology, state derivation, latest
  event joins, media overview ordering, and event listing.
- `createdAt` remains audit/row insertion time.
- Event listing sorts by `occurredAt desc`, then `createdAt desc`, then `id desc`.
- Latest event joins sort by `occurredAt desc`, then `createdAt desc`, then `id desc`.
- Query-engine event and event-join references expose both `createdAt` and `occurredAt`.
- Sandbox trigger context includes `occurredAt`, `createdAt`, and `updatedAt` as ISO strings.
- `occurredAt` is optional on event creation; if omitted, the event service defaults it to now.
  Historical or backdated callers must pass `occurredAt` explicitly.
- Existing events only need backfill if required by the generated migration for the new non-null
  column. Since the project is greenfield, no compatibility migration for seeded schemas or
  existing measurement rows is required.

### Events And Triggers

- Split event creation into reusable domain functions that can create events synchronously and return
  created events.
- `/events` may still enqueue jobs as today, but imports call an events-module API that creates
  events and enqueues event-schema triggers as one module-owned operation.
- Route-level event validation remains before enqueueing `/events` jobs.
- `processEventSchemaTriggers` receives created events with `occurredAt`.
- Imports wait for event-service writes but do not wait for sandbox trigger jobs.
- Multiple `complete` events for the same entity are valid. Do not add generic duplicate prevention.
- The built-in auto-complete trigger remains sandbox-backed.
- Auto-complete uses V1/V2 legacy coverage-cycle semantics for episodic media: build required keys,
  walk qualifying `progress(100)` events in chronological order, collect unique keys until all
  required keys are covered, create a `complete` event at the cycle-completing event time, reset
  coverage, and continue for repeated cycles.
- Auto-complete creates `complete` with `completionMode: "custom_timestamps"`, `completedOn` equal
  to the cycle-completing progress event `occurredAt`, `occurredAt` equal to the same value, and
  inherited properties such as `consumedOn`.
- Missing or empty episodic required coverage data means no auto-complete event.
- Show special seasons named `Specials` or `Extras` remain excluded.
- Non-episodic `progress(100)` may auto-create a complete event every time.
- Auto-complete should not query existing complete events to calculate coverage cycles. Coverage is
  derived from progress events.
- If the sandbox trigger uses a multiset/data-structure package, add it to the sandbox vendored
  packages and root Dockerfile Deno cache list. `mnemonist` is an acceptable choice.

### Import Module And Queue

- Add `apps/app-backend/src/modules/imports`.
- Suggested files: `schemas.ts`, `jobs.ts`, `routes.ts`, `service.ts`, `repository.ts`,
  `worker.ts`, `processor.ts`, `file-helpers.ts`, and `sources/*.ts`.
- Add a dedicated BullMQ queue named `import` and initialize its worker during runtime startup.
- Import queue concurrency starts at `1`.
- Import job attempts stay at `1` because automatic retry can duplicate events.
- Parsing and external API fetching happen inside the import worker job.
- Import processors orchestrate import concerns but must not write other modules' tables directly;
  entity, event, collection, workout, exercise, and measurement mutations go through the owning
  module service APIs.
- Source adapters may use modest bounded internal concurrency for source API work.
- The import processor should use bounded per-run concurrency across entity groups. `p-limit` may be
  added to `apps/app-backend/package.json` if it simplifies this.
- Progress updates are throttled by item count and/or time, plus a final update.
- Import jobs should be restart-tolerant at item boundaries where practical, but resume/retry is out
  of scope.

### Import Run Tables

- Use `import_run`, not `import_report`, because the row represents an execution attempt.
- Use `import_run_failure` for item-level failures.
- Store enum-like values as text in the DB, typed to Zod/app enums in code.
- `import_run` columns:
  - `id`
  - `userId`
  - `source`
  - `status`: `pending`, `running`, `completed`, `failed`
  - `progress`: integer `0..100`
  - `createdAt`
  - `updatedAt`
  - `startedAt`
  - `finishedAt`
  - `totalItems`
  - `processedItems`
  - `importedItems`
  - `failedItems`
  - `inputSummary`
  - `errorSummary`
- `import_run_failure` columns:
  - `id`
  - `runId`
  - `itemIndex`
  - `sourceIdentifier`
  - `sourceLabel`
  - `stage`: `source_fetch`, `input_transformation`, `provider_details`, `database_commit`
  - `entitySchemaSlug`
  - `eventSchemaSlug`
  - `message`
  - `context`
  - `createdAt`
- `progress` starts at `0` for import-run progress. This is unrelated to media
  `progressPercent`, where `0` is invalid and `1` is the active-tracking floor.
- `totalItems` may be null until source parsing finishes.
- A run with item failures but no catastrophic failure has status `completed`.
- `failed` means the job could not continue.
- Do not add `hasFailures`; derive it from `failedItems > 0`.
- Index runs by `(userId, createdAt desc)`.
- Index failures by `(runId, createdAt asc)`.
- Deleting an import run cascades failures.
- Never store API keys, passwords, raw temporary paths, full raw files, or raw API responses.
- Failure `context` is JSONB. It should preserve enough user-facing information for manual
  recovery, but it should be structured and whitelisted rather than raw rows or raw responses.

### Import API

- Add routes:
  - `POST /imports/runs`
  - `GET /imports/runs`
  - `GET /imports/runs/:id`
  - `GET /imports/runs/:id/failures`
  - `DELETE /imports/runs/:id`
- `POST /imports/runs` validates source-specific input synchronously, creates the `import_run` row,
  enqueues the job, and returns `{ id }` immediately.
- Initial run status is `pending`. The worker sets `running` and `startedAt` when processing starts.
- `GET /imports/runs/:id` returns run metadata only, not failures inline.
- Failures endpoint is paginated with page/limit semantics.
- Deleting an in-progress run is rejected.
- There is no separate polling endpoint.
- `DELETE` deletes terminal DB records only; temp-file cleanup is worker-owned.

### Normalized Adapter Contract

- Source adapters return `{ items, failures }`.
- Adapters throw only for source-level failures that prevent continuing, such as auth failure,
  unreachable source server, or unreadable source file.
- Item parse/transform failures become adapter failures and count toward `totalItems`.
- Normalized items are V2-native and event-centric.
- Media items are grouped by target entity reference and contain events, review events, and
  collection memberships.
- Media entity references identify `entitySchemaSlug`, `scriptSlug`, and `externalId`.
- Source labels/titles are for failures and display context, not canonical entity names.
- Lifecycle states map to events: `backlog`, `progress`, `complete`, `dropped`, `on_hold`, and
  `review`.
- Watchlist/planned/want-to-read states map to `backlog`, not collections.
- Currently watching/reading/playing maps to `progress` with `progressPercent: 1` when no better
  progress exists.
- Dropped maps to `dropped`.
- On hold/paused maps to `on_hold`.
- Custom source shelves/lists become collections unless they are known lifecycle aliases.
- Source adapters may emit custom collection names.
- Generic JSON importer remains excluded.

### Aggregation And Processing

- Deduplicate media by `{ entitySchemaSlug, scriptSlug, externalId }`.
- Merge normalized events, reviews, and collections before provider population.
- Sort events for a deduped entity by `occurredAt`, then source order.
- Preserve duplicate lifecycle events and duplicate review events.
- Collection memberships are unique by collection name.
- If duplicate collection memberships have conflicting non-empty properties, first write wins and a
  warning should be recorded/logged.
- Processing order is entity/library link first, then collection entities and memberships, then
  events.
- Process one entity group at a time with bounded concurrency across groups.
- Import progress totals count source-backed entity groups plus adapter failures.
- `importedItems` counts successfully committed groups.
- Failure rows count adapter item failures and processor failures.

### Provider Detail Reuse

- Extract reusable entity population from `modules/entities/worker.ts` before imports depend on it.
- `/entities/import` and source imports use the same shared function.
- The shared function still executes provider scripts through sandbox child jobs from worker context.
- No direct non-job sandbox execution path is needed initially.
- Library linking is parameterized.
- Imports link populated media entities into the user's library before events are written.
- Existing global entities with `populatedAt != null` skip provider work.
- Provider failure is item-level, not run-level.
- Provider failures skip events, reviews, and collection writes for that entity group.
- Related entities returned by provider scripts are processed as part of shared population.
- Provider failures are recorded once per entity reference with affected counts, not once per
  affected event.
- Distinguish provider script failure from incomplete details when possible. Incomplete details means
  `populatedAt === null` after population.
- Leave `modules/media/worker.ts` alone unless type errors or checks require touching it.

### File Handling And Security

- Continue accepting existing temporary upload paths for now, but validate them strictly.
- Import start validates every temp path is inside the configured temp upload directory.
- Validate expected file extensions.
- Source adapters receive resolved safe file paths or file handles, not raw request body paths.
- Centralize import file access in helper functions for safe path resolution, read limits, CSV/JSON
  parsing, ZIP extraction, and cleanup.
- Add per-file size limits.
- ZIP extraction must guard against zip-slip path traversal, too many files, and decompressed size
  bombs.
- Source adapters must not delete temp files directly.
- Worker owns cleanup in a `finally` path after attempting terminal status update.
- Cleanup is best-effort. Cleanup failures are logged but do not fail the import run.
- User-provided API URLs are allowed, including LAN/self-hosted servers. Input summaries store host
  only and never store keys/passwords.

### Measurements

- Measurement rows are user-owned `measurement` entities. Do not create dedicated global measurement
  definitions.
- Replace special `weight` behavior with a uniform statistics array.
- Measurement properties shape:

```ts
{
  recordedAt: string;
  comment?: string | null;
  statistics: Array<{
    key: string;
    label: string;
    value: number;
    unit?: string | null;
  }>;
}
```

- `statistics` is required and may be empty.
- Statistic keys are normalized `snake_case`.
- Labels are stored to preserve source/user-facing terminology.
- `unit` is optional freeform text.
- OpenScale maps every non-empty source stat into `statistics`, including weight.
- OpenScale should not guess units initially.
- Measurement entity names derive from `recordedAt`, for example `Measurement - 2026-04-27 08:00`.
- The built-in All Measurements saved view sorts by `recordedAt desc`.
- The All Measurements saved view should not use `statistics` as a subtitle unless the display layer
  later gains an array formatter. Use `recordedAt` and `comment` for default subtitles.

### Fitness Workouts And Exercises

- Hevy and StrongApp create user-owned custom exercise entities with no provider script when no
  matching global/user exercise exists.
- Imported exercise identity is based on case-insensitive normalized name plus `kind` for the user.
- Reuse existing user-owned custom exercises by normalized name and kind.
- Reuse global/built-in exercises by normalized name and kind using exact normalized matching only.
- Do not fuzzy match exercises.
- Imported custom exercises use `images: []`, `muscles: []`, `instructions: []`, `kind` inferred
  from set fields, and optional fields omitted.
- Relax `exercise.level` to optional; do not default imported exercises to `beginner`.
- Keep `muscles` and `instructions` as arrays that allow empty arrays.
- Workout imports create a user-owned `workout` entity first.
- Workout sets become `workout-set` events on exercise entities with `sessionEntityId` pointing to
  the workout entity.
- Workout-set `occurredAt` equals workout `startedAt` unless a future source provides set-level
  timestamps.
- Workout entity `createdAt` remains row audit time; workout timing lives in properties.
- Set events include `exerciseOrder` and `setOrder`.
- Import processing computes derived set fields when possible:
  - `volume = weight * reps`
  - `pace = distance / duration`
  - `oneRm`: Brzycki for reps `< 10`, Epley for reps `>= 10`
- No V2 workout revision scheduler is needed. This decision is also documented in
  `apps/app-backend/src/modules/legacy-bootstrap/AGENTS.md`.

### App Client Impact

- No new import UI is in scope.
- Existing app-client code must be updated where event chronology semantics change.
- `apps/app-client/src/features/media/use-overview-data.ts` currently uses event `createdAt` refs
  for media overview state and derives activity `occurredAt` from `complete.completedOn ?? createdAt`.
- Update existing media overview query-engine requests to use `occurredAt` event and event-join
  references wherever state comparison, sort, or activity chronology is intended.
- This is contract alignment, not new UI functionality.

### Legacy Bootstrap Impact

- Update legacy bootstrap event inserts to include `occurred_at`.
- Files expected to change include:
  - `apps/app-backend/src/modules/legacy-bootstrap/seen-mapping.ts`
  - `apps/app-backend/src/modules/legacy-bootstrap/seen-completion-mapping.ts`
  - `apps/app-backend/src/modules/legacy-bootstrap/review-mapping.ts`
  - `apps/app-backend/src/modules/legacy-bootstrap/workout-mapping.ts`
- For legacy bootstrap, preserve historical `created_at` and set matching `occurred_at` to the same
  historical event time.
- Future app-created/import-created events use audit `createdAt` and product `occurredAt` separately.

### Migrations And Generated Types

- Required database migrations are only for `event.occurredAt`, `import_run`, and
  `import_run_failure`.
- Built-in seed schema updates do not need backward-compatible migrations because this is a
  greenfield project and the dev database can be reset.
- Migration history may be reset between tasks. Squashing or replacing earlier migration files is
  acceptable; the dev database is expected to be recreated from scratch.
- If the generated migration needs manual SQL to satisfy a non-null `event.occurredAt` addition, it
  is acceptable to edit that generated migration directly.
- The dev server regenerates OpenAPI/client types; the PRD does not require a manual generated-types
  task beyond ensuring checks/tests use the current generated output.

## Testing Decisions

- Test app-owned behavior and branches, not library behavior.
- Add event `occurredAt` tests for create/list/repository/trigger context/query-engine references.
- Update backend media overview tests from `createdAt` to `occurredAt` semantics.
- Update app-client media overview query refs and cover with existing tests/typecheck where possible.
- Add auto-complete sandbox tests for repeated episodic cycles.
- Add auto-complete tests for missing or empty required coverage data causing no completion.
- Add import run service/repository tests for status transitions, counters, and failure rows.
- Add file helper tests for temp path traversal, extension validation, read limits, and cleanup.
- Add ZIP helper tests for zip-slip, file count limits, and decompressed size limits.
- Do not add unit or E2E tests for individual source adapters or media-processor helpers. Source adapter correctness is verified manually.
- E2E tests should cover the full import flow for the first implemented source slice only, not every
  source.
- Update `tests/src/tests/measurements.test.ts` and `tests/src/fixtures/measurements.ts` for the new
  uniform measurement statistics schema and saved view defaults.
- Workout import slice tests must assert computed `oneRm`, `pace`, and `volume`.
- Do not add source-import tests that exercise provider internals directly. Import tests should cover
  importer-owned behavior at the processor boundary with fake provider outcomes, while shared entity
  population tests own provider mechanics.
- Do not add automated legacy-bootstrap tests. Validate legacy bootstrap manually with restored dumps
  per the module notes.

## Out Of Scope

- Generic JSON importer.
- New app-client import UI.
- Import cancellation.
- Automatic import retry/resume.
- Selective retry from failure rows.
- Deterministic imported media event IDs.
- Generic duplicate prevention for complete events.
- Broad SSRF-style restriction of user-provided source URLs.
- Persisting raw source files, raw source rows, raw API responses, secrets, or temp paths.
- Operational metrics beyond persisted run status and counters.
- Backward-compatible migrations for built-in seed schema changes or existing measurement rows.

## Further Notes

- The original architecture discussion remains in `../v2-importing-infrastructure-notes.md`.
- The final cleanup task generated from this PRD must run the `codebase-cleanup` skill and cover all
  touched files and directly affected modules.

---

## Tasks

**Overall Progress:** 5 of 12 tasks completed

**Current Task:** [Task 06](./06-canonical-runtime-write-paths-cleanup.md) (todo)

### Task List

| #   | Task                                                                                   | Type | Status |
| --- | -------------------------------------------------------------------------------------- | ---- | ------ |
| 01  | [Event Occurrence Semantics](./01-event-occurrence-semantics.md)                       | AFK  | done   |
| 02  | [Auto-Complete Coverage Cycles](./02-auto-complete-coverage-cycles.md)                 | AFK  | done   |
| 03  | [OpenScale Import Tracer Bullet](./03-openscale-import-tracer-bullet.md)               | AFK  | done   |
| 04  | [Shared Entity Population Refactor](./04-shared-entity-population-refactor.md)         | AFK  | done   |
| 05  | [Provider-Backed Media Import Tracer](./05-provider-backed-media-import-tracer.md)     | AFK  | done   |
| 06  | [Canonical Runtime Write Paths Cleanup](./06-canonical-runtime-write-paths-cleanup.md) | AFK  | todo   |
| 07  | [Workout Import Tracer Bullet](./07-workout-import-tracer-bullet.md)                   | AFK  | todo   |
| 08  | [Book CSV Source Adapters](./08-book-csv-source-adapters.md)                           | AFK  | todo   |
| 09  | [File-Based Media Source Adapters](./09-file-based-media-source-adapters.md)           | AFK  | todo   |
| 10  | [API Media Source Adapters](./10-api-media-source-adapters.md)                         | AFK  | todo   |
| 11  | [Netflix ZIP Import Adapter](./11-netflix-zip-import-adapter.md)                       | AFK  | todo   |
| 12  | [Codebase Cleanup](./12-codebase-cleanup.md)                                           | AFK  | todo   |
