# Provider-Backed Media Import Tracer

**Parent Plan:** [V2 Importing Infrastructure](./README.md)

**Type:** AFK

**Status:** done

## What to build

Add the first complete provider-backed media source adapter and processor path using the Trakt API as the tracer source. This slice should prove that source adapters can emit V2-native media entity groups, the import processor can dedupe by `{ entitySchemaSlug, scriptSlug, externalId }`, provider details are populated through the shared entity population path, library linking occurs before event writes, collections are written through the collection service, review/lifecycle events are created through the shared event service, and triggers are enqueued without being awaited.

Trakt is an API-based source (no file upload). Users provide a Trakt username; the Trakt client ID is configured on the server with `SERVER_IMPORTER_TRAKT_CLIENT_ID`. The adapter fetches history (movies and episodes), ratings, watchlist, custom lists, and collection. Movies in history become `complete` events; episodes in history become `progress(100)` events with season/episode coverage keys; watchlist items become `backlog` events; ratings become `review` events; custom lists and "Owned" collection become collection memberships.

The adapter preserves source data semantics. Lifecycle states map to V2 events; source lists/shelves become collections only when they are not lifecycle aliases. Item-level failures are persisted with user-facing labels and identifiers. API credentials are server configuration only; the client ID is not stored in import job data or persisted database rows. The input summary stores only the username.

## Acceptance criteria

- [x] A media source input schema is added to the imports module using the discriminated source input shape from the parent PRD.
- [x] The source adapter returns normalized media groups plus adapter item failures without writing DB rows directly.
- [x] Media groups dedupe by `{ entitySchemaSlug, scriptSlug, externalId }` and merge events, reviews, and collections before provider population.
- [x] Provider-backed media population uses the shared entity population function and links the populated global entity into the importing user's library.
- [x] Provider failure records one `provider_details` failure row per entity ref with affected counts and skips events/reviews/collections for that entity group.
- [x] Collection memberships are unique by collection name; conflicting non-empty membership properties use first-write-wins and record/log a warning.
- [x] Lifecycle events and review events are created through the shared event creation path with explicit `occurredAt` values where the source provides historical dates.
- [x] The import worker waits for provider details and event-service writes, but does not wait for sandbox trigger jobs.
- [x] Run progress/counters include successful media groups and adapter failures according to the parent PRD.
- [x] Processor-boundary tests cover normalized-data checkpointing, fake provider outcomes, final counters, and adapter failure-row persistence. Individual source adapters and media-processor helpers are manually verified per the parent PRD.

## User stories addressed

Reference by number from the parent PRD:

- User story 1
- User story 2
- User story 3
- User story 4
- User story 5
- User story 7
- User story 10
- User story 11
- User story 12
- User story 13
- User story 14
- User story 22
- User story 23
- User story 24
- User story 25
