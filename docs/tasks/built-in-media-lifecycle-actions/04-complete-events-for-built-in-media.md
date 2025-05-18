# Complete Events for Built-in Media

**Parent Plan:** [Built-in Media Lifecycle Actions](./README.md)

**Type:** AFK

**Status:** done

## What to build

Add the built-in `complete` lifecycle action for the currently supported built-in media schemas.
This slice should seed the `complete` event schema and make the generic event write path persist
explicit completion for built-in media entities.

This task should preserve the explicit distinction between progress and completion. A user or
client must create `complete` intentionally; completion must not be inferred from progress writes.

The seeded built-in event schema display name for this slice should be `Complete`.

See the **Canonical built-in media actions**, **Action semantics**, and **API contract shape**
sections of the parent PRD.

## Acceptance criteria

- [x] The currently supported built-in media schemas expose a seeded `complete` event schema.
- [x] `POST /events` accepts `complete` events for built-in media entities and persists them
      successfully.
- [x] Built-in media entities can only write `complete` using the seeded event schema belonging to
      their own entity schema.
- [x] Repeated `complete` events are allowed.
- [x] The event payload for `complete` is an empty object.
- [x] Progress writes remain distinct from completion and do not implicitly create `complete`.
- [x] Bulk `POST /events` requests can include built-in `complete` events successfully.
- [x] Tests cover successful explicit completion writes, repeatability, and the separation from
      progress semantics.
- [x] `tests/src` includes an end-to-end test that posts an explicit built-in `complete` event and
      verifies it persists without relying on `progress` to create it.
- [x] `bun run typecheck`, `bun test`, and `bun run lint` pass in `apps/app-backend`.

## Blocked by

- [Task 01](./01-clean-up-built-in-event-schema-foundation.md)

## User stories addressed

- User story 3
- User story 9
- User story 13
- User story 22
