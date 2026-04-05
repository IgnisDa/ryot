# Progress Events for Built-in Media

**Parent Plan:** [Built-in Media Lifecycle Actions](./README.md)

**Type:** AFK

**Status:** done

## What to build

Add the built-in `progress` lifecycle action for the currently supported built-in media schemas.
This slice should seed the `progress` event schema and make the generic event write path accept
fractional `progressPercent`, normalize it to 2 decimal places, and reject invalid ranges.

This task is complete when built-in media entities can record repeatable progress updates through
the shared events API without collapsing progress into completion.

The seeded built-in event schema display name for this slice should be `Progress`.

See the **Canonical built-in media actions**, **Action semantics**, and **Shared semantics with
per-schema payloads** sections of the parent PRD.

## Acceptance criteria

- [x] The currently supported built-in media schemas expose a seeded `progress` event schema.
- [x] `POST /events` accepts `progress` events for built-in media entities.
- [x] Built-in media entities can only write `progress` using the seeded event schema belonging to
      their own entity schema.
- [x] `progressPercent` is stored as a number and normalized to 2 decimal places on write.
- [x] Normalization uses the agreed stable half-up rounding rule.
- [x] `progressPercent` values less than or equal to `0` or greater than or equal to `100` are
      rejected.
- [x] Repeated `progress` events are allowed.
- [x] Writing `progress` does not auto-create a `complete` event.
- [x] Bulk `POST /events` requests can include built-in `progress` events successfully.
- [x] Tests cover accepted values, rounding behavior, rejected ranges, and repeatability.
- [x] `tests/src` includes an end-to-end test that posts built-in `progress` events, verifies
      stored rounding to 2 decimals, and verifies rejection of out-of-range values.
- [x] `bun run typecheck`, `bun test`, and `bun run lint` pass in `apps/app-backend`.

## Blocked by

- [Task 01](./01-clean-up-built-in-event-schema-foundation.md)

## User stories addressed

- User story 2
- User story 8
- User story 12
