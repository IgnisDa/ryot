# Event Infrastructure Prerequisites

**Parent Plan:** [Episodic Media Progress Tracking](./README.md)

**Type:** AFK

**Status:** done

## What to build

Two small, self-contained backend additions that every subsequent slice depends on.

**Event list filter by schema slug.** Add an optional `eventSchemaSlug` query parameter to the list-events endpoint. When supplied, the repository filters the returned events so only those whose event schema slug matches the parameter are included. An unrecognized slug should return an empty list, not an error. This is the primitive the rewritten trigger script will use to fetch only progress events for an entity without pulling every event.

**Entity schema slug in trigger context.** Extend the trigger execution context object (built in `processEventSchemaTriggers`) with `entitySchemaSlug` alongside the existing `entitySchemaId`. Trigger scripts currently have the schema ID but not the human-readable slug, forcing them to perform an extra API lookup to branch on media type. Surfacing the slug directly eliminates that round-trip.

No UI changes and no changes to the trigger script itself belong in this slice.

## Acceptance criteria

- [x] `GET /events?entityId=X&eventSchemaSlug=progress` returns only events whose schema slug is `progress`.
- [x] `GET /events?entityId=X&eventSchemaSlug=complete` returns only events whose schema slug is `complete`.
- [x] `GET /events?entityId=X&eventSchemaSlug=nonexistent` returns an empty list with a 200 status.
- [x] `GET /events?entityId=X` (no slug filter) continues to return all events as before.
- [x] The trigger context object passed to sandbox jobs includes `entitySchemaSlug` as a string.
- [x] A unit test verifies that `processEventSchemaTriggers` includes `entitySchemaSlug` in the emitted context.
- [x] An integration test verifies the `eventSchemaSlug` filter through the full API stack.

## User stories addressed

- User story 17 — entity schema slug in trigger context
- User story 18 — event list filter by schema slug
