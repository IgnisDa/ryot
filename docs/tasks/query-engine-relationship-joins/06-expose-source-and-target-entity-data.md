# Expose Source And Target Entity Data

**Parent Plan:** [Query Engine Relationship Joins](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Extend relationship join references to expose related source and target entity data. This slice should allow queries to return, sort by, and filter by related entity built-ins, and to access related entity properties when the relationship schema defines that side's entity schema.

## Acceptance criteria

- [ ] Relationship join reference paths support `sourceEntity` and `targetEntity` roots.
- [ ] Related entity built-ins under `sourceEntity` and `targetEntity` support `id`, `name`, `image`, `createdAt`, `updatedAt`, `externalId`, and `sandboxScriptId`.
- [ ] Related entity built-ins follow the same display, sorting, and filtering rules as normal entity built-ins.
- [ ] Related entity image values are display-only and are rejected from sorting, filtering, arithmetic, and scalar string composition.
- [ ] Related entity property paths use `sourceEntity.properties` or `targetEntity.properties`.
- [ ] Related entity property paths are allowed only when the resolved relationship schema defines the entity schema for that side.
- [ ] Related entity property paths are validated against the known entity schema for that side.
- [ ] Related entity property paths are rejected when the relationship schema side is null or when the property path does not exist.
- [ ] Relationship join loading validates source/target schema compatibility against the query scope and join direction when relationship schema sides are defined.
- [ ] Queries can return a related source or target entity name as a field.
- [ ] Queries can sort by a related source or target entity name.
- [ ] `tests/src/tests/query-engine.test.ts` contains end-to-end tests covering: returning a related target entity name as a field, sorting by a related source entity name, and both incoming and outgoing join directions.
- [ ] `tests/src/tests/query-engine.test.ts` contains a test verifying that related entity properties are accepted when the relationship schema defines that side's entity schema.
- [ ] `tests/src/tests/query-engine.test.ts` contains a test verifying that related entity properties are rejected when the relationship schema side has no entity schema defined.
- [ ] `tests/src/fixtures/view-language.ts` — `parseFieldPath` handles `sourceEntity` and `targetEntity` nested paths within the `relationship-join` namespace if that helper is used to construct related entity expressions in tests.

## User stories addressed

- User story 4
- User story 11
- User story 12
- User story 13
- User story 27
- User story 28
- User story 29
- User story 37
- User story 39
