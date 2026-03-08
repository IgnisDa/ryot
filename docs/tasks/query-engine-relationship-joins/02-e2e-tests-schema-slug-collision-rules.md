# E2E Tests For Schema Slug Collision Rules

**Parent Plan:** [Query Engine Relationship Joins](./README.md)

**Type:** AFK

**Status:** completed

## What to build

Add end-to-end tests in `tests/` that verify the schema slug collision rules enforced in task 01 through public API behavior. The backend unit tests from task 01 cover service-level behavior; this task covers the API surface that a client actually hits.

## Acceptance criteria

- [x] `tests/src/tests/entity-schemas.test.ts` contains a test that calls `POST /entity-schemas` with a slug matching a built-in entity schema slug and asserts a 400 validation error is returned.
- [x] `tests/src/tests/event-schemas.test.ts` contains a test that calls `POST /event-schemas` with a slug that conflicts with an existing event schema for the same entity schema and asserts a 400 validation error is returned.
- [x] Tests use existing auth and fixture helpers from `tests/src/fixtures/` rather than duplicating setup logic.
- [x] No new fixtures are introduced unless the test genuinely needs data that no existing helper provides.
- [x] Tests do not test implementation details; they assert only HTTP status codes and error message shapes returned by the API.

## User stories addressed

- User story 33
- User story 34
- User story 40
