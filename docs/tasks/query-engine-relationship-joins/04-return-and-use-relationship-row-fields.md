# Return And Use Relationship Row Fields

**Parent Plan:** [Query Engine Relationship Joins](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Add the `relationship-join` runtime reference for relationship row built-ins and relationship properties. Relationship-derived row values should work in entity-mode output fields, top-level filters, top-level sorting, and top-level computed fields using the relationship joins introduced by the previous task.

## Acceptance criteria

- [ ] The runtime reference discriminator `relationship-join` is accepted in the expression schema.
- [ ] `relationship-join` references require `joinKey` and `path`.
- [ ] Relationship references validate that `joinKey` points to a declared relationship join in the current request context.
- [ ] Relationship row built-in paths support `id`, `createdAt`, `sourceEntityId`, and `targetEntityId`.
- [ ] Relationship property paths use a leading `properties` segment.
- [ ] Relationship property paths are validated against the resolved relationship schema properties schema.
- [ ] Unknown relationship property paths are rejected with a validation error.
- [ ] Relationship property type inference comes from the relationship schema properties schema.
- [ ] Relationship row and property references compile to SQL against the joined relationship payload.
- [ ] Optional joins with no matching row return null display values for relationship references.
- [ ] Relationship scalar values can be used in sorting when their inferred type is sortable.
- [ ] Relationship scalar values can be used in filtering when their inferred type supports the selected predicate operator.
- [ ] Relationship values can be referenced from top-level computed fields in entity and aggregate modes.
- [ ] Relationship join references are rejected in event and time-series modes.
- [ ] `tests/src/tests/query-engine.test.ts` contains new end-to-end tests covering: returning a relationship property as a field, sorting by a relationship scalar, filtering by a relationship scalar, filtering by an array-compatible relationship property using `contains`, and referencing a relationship value through a computed field.
- [ ] `tests/src/fixtures/view-language.ts` — `parseFieldPath` is extended with a `relationship-join` namespace case so string shorthand like `relationship-join.myKey.properties.rating` can be used in tests.
- [ ] `tests/src/fixtures/query-engine.ts` has any new builder helpers needed for relationship join requests so tests do not duplicate boilerplate.

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
