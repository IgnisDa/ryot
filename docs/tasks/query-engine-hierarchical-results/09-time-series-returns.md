# Time Series Returns

**Parent Plan:** [Query Engine Hierarchical Results PRD](./README.md)

**Type:** AFK

**Status:** done

## What to build

Implement v2 time-series returns over any source with a date expression. Time series should remain a public peer return type while reusing grouped aggregation planning internally. The response should include aligned bucket `startAt`, bucket `endAt`, and numeric `value`; zero fill is always on; date ranges are half-open; and the bucket count cap is 1000 after alignment. Time-series `measure` must wrap the shared aggregation spec under `aggregation`.

This slice should prove time series over event, entity, and relationship sources without adding multiple measures or a zeroFill DSL knob.

## Acceptance criteria

- [x] Time-series return supports one measure using `{ aggregation }` with the shared aggregation spec.
- [x] Time-series date range inclusion is `[startAt, endAt)`.
- [x] Buckets include `startAt`, `endAt`, and numeric `value`.
- [x] Empty buckets are zero-filled and cannot be disabled by query JSON.
- [x] Bucket count greater than 1000 after alignment fails validation.
- [x] Time series works over an event source using an event timestamp.
- [x] Time series works over an entity source using a date property or system date field.
- [x] Time series works over a relationship source using relationship created timestamp.
- [x] E2E tests cover event, entity, and relationship time series plus zero-fill and bucket-cap validation.

## User stories addressed

Reference by number from the parent PRD:

- User story 22
- User story 23
- User story 24
- User story 25
- User story 30
- User story 31
- User story 33
