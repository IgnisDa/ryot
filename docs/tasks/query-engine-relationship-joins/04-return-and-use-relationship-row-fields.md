# Return And Use Relationship Row Fields

**Parent Plan:** [Query Engine Relationship Joins](./README.md)

**Type:** AFK

**Status:** done

## What to build

Add the `relationship-join` runtime reference for relationship row built-ins and relationship properties. Relationship-derived row values should work in entity-mode output fields, top-level filters, top-level sorting, and top-level computed fields using the relationship joins introduced by the previous task.

## Acceptance criteria

- [x] The runtime reference discriminator `relationship-join` is accepted in the expression schema.
- [x] `relationship-join` references require `joinKey` and `path`.
- [x] Relationship references validate that `joinKey` points to a declared relationship join in the current request context.
- [x] Relationship row built-in paths support `id`, `createdAt`, `sourceEntityId`, and `targetEntityId`.
- [x] Relationship property paths use a leading `properties` segment.
- [x] Relationship property paths are validated against the resolved relationship schema properties schema.
- [x] Unknown relationship property paths are rejected with a validation error.
- [x] Relationship property type inference comes from the relationship schema properties schema.
- [x] Relationship row and property references compile to SQL against the joined relationship payload.
- [x] Optional joins with no matching row return null display values for relationship references.
- [x] Relationship scalar values can be used in sorting when their inferred type is sortable.
- [x] Relationship scalar values can be used in filtering when their inferred type supports the selected predicate operator.
- [x] Relationship values can be referenced from top-level computed fields in entity and aggregate modes.
- [x] Relationship join references are rejected in event and time-series modes.
- [x] `tests/src/tests/query-engine.test.ts` contains new end-to-end tests covering: returning a relationship property as a field, sorting by a relationship scalar, filtering by a relationship scalar, filtering by an array-compatible relationship property using `contains`, and referencing a relationship value through a computed field.
- [x] `tests/src/fixtures/view-language.ts` — `parseFieldPath` is extended with a `relationship-join` namespace case so string shorthand like `relationship.link.properties.rating` can be used in tests.
- [x] `tests/src/fixtures/relationships.ts` provides test helpers for creating relationship schemas and rows so tests do not duplicate boilerplate.

## User stories addressed

- User story 1
- User story 2
- User story 3
- User story 10
- User story 23
- User story 24
- User story 25
- User story 26
- User story 32
- User story 36
- User story 39
