# Imports Module

## Purpose

This module owns one-time import runs. It normalizes third-party exports into Ryot's internal import shapes, persists run progress and failures, resolves provider-native ids when needed, populates entities, and writes library events and collection memberships.

## Directory layout

- `routes.ts`, `service.ts`, `repository.ts`, `jobs.ts`, `import-run-workflow.ts`: HTTP, workflow entry, persistence, and shared import-run types. (`schemas.ts` lives in `@ryot/contract`.)
- `runtime/`: file handling, source payload storage, shared failures, and workflow helpers.
- `sources/`: source-specific adapters and loader helpers.
- `media-workflow.ts`, `non-media-workflow.ts`, `non-media-operation-registry-workflow.ts`: import workflow orchestration and non-media source operation wiring.
- `media/`: shared media import stages, source loading, and workflow-owned sandbox composition.
- `measurement/`: OpenScale import pipeline.
- `workout/`: Hevy and Strong import pipeline.

## Media pipeline

Media imports run in four phases, split across a parent workflow and one canonical child:

1. Adapter load (parent-owned): parse source input into `ImportMediaEntityGroup[]` plus row-level transformation failures. The load activity persists the normalized `MediaImportAdapterResult` to the Redis artifact store (`runtime/source-payload-store.ts`, keyed by `runId`, 24h TTL) and returns only a compact `MediaImportAdapterSummary` (group count + failures), never the full result.
2. `resolving-entities`: convert unresolved refs into resolved refs through sandbox `resolve` drivers.
3. `populating-entities`: populate or reuse global entities and ensure library membership by awaiting `LibraryEntityImportWorkflow` per item (it composes provider population then the durable membership queue). Its `LibraryEntityImportError` stage maps to the `provider_details` (population) and `database_commit` (membership) failure stages.
4. `writing-events`: write collection memberships and events for resolved entity ids.

Resolution and population inputs are encoded first, then packed into ordered workflow chunks before
sandbox dispatch, so packing measures the same bytes the workflow-context ceiling is enforced against.
Every chunk must fit both the 64 KiB workflow-context ceiling and the 1,000-call durable-step ceiling
(resolution budgets the worst-case candidate count; population budgets one child per item). A phase
resolves its workflow script once, then executes exact-script chunks with deterministic chunk ids and
bounded concurrency. That concurrency bound is deliberately the sandbox worker bound: chunk children
are a different resource, but each chunk occupies one worker for its whole run, and sandbox limits
stay fixed in this phase rather than gaining a separate setting. Suspension is per workflow instance,
so the first chunk to suspend interrupts its siblings and ends the body pass; already-dispatched
chunk children keep running durably and each completion resumes the parent. An item whose encoded
form cannot be produced, or that cannot fit an empty chunk, is recorded as an item-level failure;
expected library-import child failures remain item-level results, while sandbox shell, engine, and
other infrastructure failures remain fatal to the run.

Phases 2–4 (plus recording adapter failures and finalizing the run) are single-owned by `ProcessNormalizedMediaImportWorkflow` (`media/normalized-import-workflow.ts` definition, `media/normalized-import-workflow-live.ts` body). Both parents — `runOneTimeMediaImportWorkflow` (one-time imports) and the integration workflow — persist the adapter result, then await the child with a deterministic `${parentExecutionId}-normalized` execution id so the pipeline activities journal under one workflow regardless of caller. The child rehydrates the adapter result from Redis as its first activity (typed `ImportRunError` if the artifact is missing or expired). Resolution and population call sandbox or entity-import work through durable workflow steps instead of a hidden pass-through processor.

Parents own everything outside the shared pipeline: file/source loading and mark-started, the Redis artifact write, and — after the child returns or fails — cleanup (one-time: `cleanupMediaImportRun` / `failRunAndCleanup`, which also deletes the adapter artifact via the `ImportRunArtifacts` cleanup lifecycle) or finalization (integration: `finalizeIntegrationRun`).

After adapter load, later phases should operate only on the normalized adapter artifact. Do not carry source credentials, API URLs, raw temp file paths, or source payloads beyond the loader step unless a specific source still needs them for bounded cleanup.

API source loaders should validate credentials inside `loadAdapterResult`, not in later workflow phases. File-backed media loaders should require temp paths only for adapter loading; later phases should work from normalized groups and durable workflow state.

## Provider And Source I/O Boundary

Source-ingestion I/O is allowed only in adapter loading. App-side source connectors may fetch a user's source data from services such as Plex, Jellyfin, Trakt, Audiobookshelf, or MediaTracker, and then must emit normalized adapter results.

Provider catalog I/O for enrichment stays in sandbox drivers. App adapters may emit resolved provider-native refs or unresolved foreign refs, but must not call metadata providers directly to search, resolve, or populate entities.

Unresolved refs must go through sandbox `resolve` drivers. Resolved refs must go through sandbox `details` drivers during population.

YouTube Music history is the deliberate exception for source-ingestion I/O: it stays in the sandbox because it reuses the `music.youtube-music` sandbox script and its vendored `youtubei.js` driver.

## Import refs

`ImportEntityRef` is a discriminated union.

- `kind: "resolved"`: has `scriptSlug` and `externalId` and is ready for entity population.
- `kind: "unresolved"`: has `identifierType` and `identifierValue` and must go through the resolution phase first.

Grouping keys intentionally deduplicate unresolved refs by identifier value before provider resolution.

## Failure stages

Use the existing import failure stages consistently:

- `input_transformation`: parsing or normalization failures.
- `provider_resolution`: unresolved ref could not be mapped to a supported provider id.
- `provider_details`: sandbox `details` fetch or entity population failure.
- `event_policy`: failure while evaluating a policy before an imported event is written.
- `database_commit`: collections, events, or library membership writes failed.
- `source_fetch`: source payload or external source fetch failed before normalization.

## Adding a new importer

For a new source:

1. Add source metadata and validation in `runtime/source-definitions.ts` if needed.
2. Register media loaders in `media/source-loaders.ts` and non-media operation wiring in `non-media-operation-registry-workflow.ts`.
3. Prefer a small source adapter in `sources/<source>/adapter.ts` that only fetches, parses, and maps source data.
4. Reuse `runOneTimeMediaImportWorkflow` or `runOneTimeNonMediaImportWorkflow` and keep source-specific code bounded to loading, parsing, or write preparation.
5. Follow the source-ingestion versus provider catalog boundary rules.
6. Add focused adapter, helper, or workflow tests beside the new source or workflow.

## Existing source patterns

- Goodreads and StoryGraph: emit unresolved ISBN refs and rely on sandbox resolution.
- Hardcover CSV: emits resolved Hardcover book ids directly.
- Trakt: source connector stays in app code, emits resolved TMDB refs when present and unresolved IMDB refs when TMDB is missing.
- Plex, Jellyfin, Audiobookshelf, and MediaTracker: source connectors stay in app code, fetch user source data, and emit normalized refs.
- YouTube Music history: source fetch stays in the sandbox `history` driver, then app code normalizes the returned songs.
- Hevy and Strong: adapters normalize workout payloads into workout-domain items.
- OpenScale: adapter normalizes measurement rows and writes them without provider resolution.

## Testing expectations

- Adapter tests should validate normalization behavior and row-level failures, not provider HTTP.
- Workflow orchestration tests belong in `media-workflow.test.ts` or `non-media-workflow.test.ts`, and pure helper tests should stay beside the helper they cover.
- End-to-end media pipeline tests should assert phase transitions and persisted job data only where needed.
