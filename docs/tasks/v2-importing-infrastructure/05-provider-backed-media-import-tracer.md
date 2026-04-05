# Provider-Backed Media Import Tracer

**Parent Plan:** [V2 Importing Infrastructure](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Add the first complete provider-backed media source adapter and processor path, using a simple source such as Movary unless implementation context points to an equally small better fit. This slice should prove that source adapters can emit V2-native media entity groups, the import processor can dedupe by `{ entitySchemaSlug, scriptSlug, externalId }`, provider details are populated through the shared entity population path, library linking occurs before event writes, collections are written as relationships, review/lifecycle events are created through the shared event service, and triggers are enqueued without being awaited.

The adapter should preserve source data semantics rather than V1 implementation quirks. Lifecycle states map to V2 events; source lists/shelves become collections only when they are not lifecycle aliases. Item-level failures should be persisted with user-facing labels and identifiers.

## Acceptance criteria

- [ ] A media source input schema is added to the imports module using the discriminated source input shape from the parent PRD.
- [ ] The source adapter returns normalized media groups plus adapter item failures without writing DB rows directly.
- [ ] Media groups dedupe by `{ entitySchemaSlug, scriptSlug, externalId }` and merge events, reviews, and collections before provider population.
- [ ] Provider-backed media population uses the shared entity population function and links the populated global entity into the importing user's library.
- [ ] Provider failure records one `provider_details` failure row per entity ref with affected counts and skips events/reviews/collections for that entity group.
- [ ] Collection memberships are unique by collection name; conflicting non-empty membership properties use first-write-wins and record/log a warning.
- [ ] Lifecycle events and review events are created through the shared event creation path with explicit `occurredAt` values where the source provides historical dates.
- [ ] The import worker waits for provider details and direct event writes, but does not wait for sandbox trigger jobs.
- [ ] Run progress/counters include successful media groups and adapter failures according to the parent PRD.
- [ ] Tests cover source adapter parsing, provider-population failure handling with fakes, event creation, collection relationship creation, and failure-row persistence.
- [ ] An E2E test covers the tracer source import through public import routes without real external network calls.

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
