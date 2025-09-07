# Imports Module

## Purpose

This module owns one-time import runs. It normalizes third-party exports into Ryot's internal import shapes, persists run progress and failures, resolves provider-native ids when needed, populates entities, and writes library events and collection memberships.

## Directory layout

- `routes.ts`, `service.ts`, `repository.ts`, `schemas.ts`, `jobs.ts`, `worker.ts`: HTTP, queue, persistence, and shared import-run types.
- `runtime/`: queue dispatch, source registry, file handling, CSV helpers, and failure utilities.
- `sources/`: source-specific adapters and processors.
- `media/`: shared media import pipeline.
- `measurement/`: OpenScale import pipeline.
- `workout/`: Hevy and Strong import pipeline.

## Source vs provider boundary

- Source adapters and processors stay in app code.
- Provider API knowledge must live in sandbox scripts, not in import adapters.
- If a source only has a foreign identifier like an ISBN, emit an unresolved ref and let the media resolution phase call sandbox `resolve` drivers.
- If a source already has a provider-native identifier like a TMDB id or Hardcover id, emit a resolved ref directly.

## Media pipeline

Media imports run in four phases:

1. Adapter load: parse source input and emit `ImportMediaEntityGroup[]` plus row-level transformation failures.
2. `resolving_entities`: convert unresolved refs into resolved refs through sandbox `resolve` drivers.
3. `populating_entities`: populate or reuse global entities through sandbox `details` drivers.
4. `writing_events`: write collection memberships and events for resolved entity ids.

The pipeline is re-entrant. Resolution and population both enqueue sandbox child jobs and resume through BullMQ state stored in `ImportRunJobData`.

After adapter load, persisted media pipeline snapshots must contain only normalized resume state such as `mediaEntityGroups`, refs, ids, failed indices, and phase indexes. Do not persist source credentials, API URLs, raw temp file paths, or source payloads in `job.updateData` snapshots once normalized groups exist.

API source processors should validate credentials inside `loadAdapterResult`, not before calling `processMediaImport`, so resumed `resolving_entities`, `populating_entities`, and `writing_events` phases can continue without source credentials. File-backed media processors should require temp paths only for adapter loading; resumed media phases use normalized groups and must not require the upload file to still exist.

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
- `database_commit`: collections, events, or library membership writes failed.
- `source_fetch`: source payload or external source fetch failed before normalization.

## Adding a new importer

For a new source:

1. Add source metadata and validation in `runtime/source-definitions.ts` if needed.
2. Register the processor in `runtime/processor-registry.ts`.
3. Prefer a small source adapter in `sources/<source>/adapter.ts` that only parses and maps source data.
4. Reuse `processMediaImport`, `processWorkoutCsvImport`, or `processOpenScaleImport` unless the source truly needs a custom pipeline.
5. Keep provider fallback policy in app code and provider-specific HTTP inside sandbox scripts.
6. Add focused adapter or processor tests beside the new source.

## Existing source patterns

- Goodreads and StoryGraph: emit unresolved ISBN refs and rely on sandbox resolution.
- Hardcover CSV: emits resolved Hardcover book ids directly.
- Trakt: source connector stays in app code, emits resolved TMDB refs when present and unresolved IMDB refs when TMDB is missing.
- Hevy and Strong: adapters normalize workout payloads into workout-domain items.
- OpenScale: adapter normalizes measurement rows and writes them without provider resolution.

## Testing expectations

- Adapter tests should validate normalization behavior and row-level failures, not provider HTTP.
- Resolution tests belong in `media/resolve.test.ts` and sandbox script tests beside the provider scripts.
- End-to-end media pipeline tests should assert phase transitions and persisted job data only where needed.
