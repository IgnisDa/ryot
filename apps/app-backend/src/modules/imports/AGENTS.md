# Imports Module

## Purpose

This module owns one-time import runs. It normalizes third-party exports into Ryot's internal import shapes, persists run progress and failures, resolves provider-native ids when needed, populates entities, and writes library events and collection memberships.

## Directory layout

- `routes.ts`, `service.ts`, `repository.ts`, `schemas.ts`, `jobs.ts`, `import-run-workflow.ts`: HTTP, workflow entry, persistence, and shared import-run types.
- `runtime/`: file handling, source payload storage, shared failures, and workflow helpers.
- `sources/`: source-specific adapters and loader helpers.
- `media-workflow.ts`, `non-media-workflow.ts`, `non-media-operation-registry-workflow.ts`: import workflow orchestration and non-media source operation wiring.
- `media/`: shared media import stages, source loading, and workflow-owned sandbox composition.
- `measurement/`: OpenScale import pipeline.
- `workout/`: Hevy and Strong import pipeline.

## Media pipeline

Media imports run in four phases:

1. Adapter load: parse source input and emit `ImportMediaEntityGroup[]` plus row-level transformation failures.
2. `resolving-entities`: convert unresolved refs into resolved refs through sandbox `resolve` drivers.
3. `populating-entities`: populate or reuse global entities through sandbox `details` drivers.
4. `writing-events`: write collection memberships and events for resolved entity ids.

The workflow body owns these phases directly. Resolution and population call sandbox or entity-import work through durable workflow steps instead of a hidden pass-through processor.

After adapter load, later phases should operate only on normalized adapter results. Do not carry source credentials, API URLs, raw temp file paths, or source payloads beyond the loader step unless a specific source still needs them for bounded cleanup.

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
- `event_before_trigger`: failure before an import-triggered event fires.
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
