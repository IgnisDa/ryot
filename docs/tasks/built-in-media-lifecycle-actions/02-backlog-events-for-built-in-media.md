# Backlog Events for Built-in Media

**Parent Plan:** [Built-in Media Lifecycle Actions](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Add the built-in `backlog` lifecycle action for the currently supported built-in media schemas.
This slice should seed the `backlog` event schema where appropriate and make the generic event
write path accept and persist backlog events for built-in media entities.

This task is complete when a user can create a built-in media entity through the existing flow and
then record backlog intent through the shared event contract with tests proving the behavior.

The seeded built-in event schema display name for this slice should be `Backlog`.

See the **Canonical built-in media actions**, **Action semantics**, and **API contract shape**
sections of the parent PRD.

## Acceptance criteria

- [ ] The currently supported built-in media schemas expose a seeded `backlog` event schema.
- [ ] `POST /events` accepts `backlog` events for built-in media entities and persists them
      successfully.
- [ ] Built-in media entities can only write `backlog` using the seeded event schema belonging to
      their own entity schema.
- [ ] Repeated `backlog` events are allowed.
- [ ] The event payload for `backlog` is an empty object.
- [ ] Bulk `POST /events` requests can include built-in `backlog` events successfully.
- [ ] Tests cover successful built-in backlog writes and expected access failures.
- [ ] `tests/src` includes an end-to-end test that creates a built-in media entity, posts a
      `backlog` event through the public API, and verifies it appears in the event list.
- [ ] `bun run typecheck`, `bun test`, and `bun run lint` pass in `apps/app-backend`.

## Blocked by

- [Task 01](./01-clean-up-built-in-event-schema-foundation.md)

## User stories addressed

- User story 1
- User story 10
- User story 11
