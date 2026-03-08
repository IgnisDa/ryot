# Refresh Query Engine Docs And Generated Examples

**Parent Plan:** [Query Engine Relationship Joins](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Update public Query Engine documentation, typed generated API definitions, and test fixtures/examples so a future developer can understand and use the new relationship join contract without knowing the implementation history.

## Acceptance criteria

- [ ] Query Engine documentation describes `relationshipJoins` and no longer documents the old relationship filter key as a supported request field.
- [ ] Query Engine documentation states which modes support relationship joins and which modes reject them.
- [ ] Query Engine documentation states all relationship join fields and defaults.
- [ ] Query Engine documentation states required versus optional join behavior.
- [ ] Query Engine documentation states direction semantics for incoming and outgoing joins.
- [ ] Query Engine documentation states source/target id filter semantics.
- [ ] Query Engine documentation states join-local filter limitations and ordering before latest-row selection.
- [ ] Query Engine documentation states all supported relationship join reference paths.
- [ ] Query Engine documentation includes examples for returning a relationship property, filtering by a relationship property, and sorting by a related target entity name.
- [ ] Generated OpenAPI types reflect the final request and reference contract.
- [ ] `tests/src/fixtures/query-engine.ts` has consistent, reusable helpers for constructing relationship join request shapes so tests do not inline the full join object repeatedly.
- [ ] `tests/src/fixtures/view-language.ts` — `parseFieldPath` fully supports the `relationship-join` namespace including nested `sourceEntity`, `targetEntity`, and `properties` paths.
- [ ] `tests/src/test-support/query-engine-suite.ts` is updated to reflect the final relationship join contract where relevant shared suites exist.
- [ ] No file in `tests/src/` still references the removed `relationships` key in any request body, fixture helper, or type assertion.
- [ ] Existing Query Engine documentation for event joins, computed fields, filters, sorting, and aggregates remains accurate.

## User stories addressed

- User story 30
- User story 32
- User story 40
