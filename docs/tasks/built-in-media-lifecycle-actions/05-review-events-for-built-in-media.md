# Review Events for Built-in Media

**Parent Plan:** [Built-in Media Lifecycle Actions](./README.md)

**Type:** AFK

**Status:** done

## What to build

Add the built-in `review` lifecycle action for the currently supported built-in media schemas.
This slice should seed the `review` event schema and make the generic event write path accept a
required integer rating with optional review text for built-in media entities.

This task is complete when built-in media entities can receive repeatable review events through
the shared events API, including before any completion event exists.

The seeded built-in event schema display name for this slice should be `Review`.

See the **Canonical built-in media actions**, **Action semantics**, and **Shared semantics with
per-schema payloads** sections of the parent PRD.

## Acceptance criteria

- [x] The currently supported built-in media schemas expose a seeded `review` event schema.
- [x] `POST /events` accepts `review` events for built-in media entities and persists them
      successfully.
- [x] Built-in media entities can only write `review` using the seeded event schema belonging to
      their own entity schema.
- [x] `rating` is required and validated as an integer in the range `1..5`.
- [x] `review` text is optional.
- [x] Review events are allowed even when no completion event exists.
- [x] Repeated review events are allowed.
- [x] Bulk `POST /events` requests can include built-in `review` events successfully.
- [x] Tests cover valid and invalid ratings, optional review text, review-before-complete, and
      repeatability.
- [x] `tests/src` includes an end-to-end test that posts a built-in `review` event before any
      completion event exists and verifies invalid ratings are rejected.
- [x] `bun run typecheck`, `bun test`, and `bun run lint` pass in `apps/app-backend`.

## Blocked by

- [Task 01](./01-clean-up-built-in-event-schema-foundation.md)

## User stories addressed

- User story 4
- User story 7
- User story 14
