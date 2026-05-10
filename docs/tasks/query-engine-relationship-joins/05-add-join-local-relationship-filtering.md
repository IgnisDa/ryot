# Add Join-Local Relationship Filtering

**Parent Plan:** [Query Engine Relationship Joins](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Add join-local filtering and literal source/target id constraints to `relationshipJoins`. This slice should make one-to-many relationships usable without row multiplication by filtering candidate relationship rows before `latestRelationship` selects the single row for each base entity.

## Acceptance criteria

- [ ] Relationship join definitions accept optional literal string `sourceEntityId` and `targetEntityId` filters.
- [ ] `sourceEntityId` always filters the actual relationship source entity id, independent of join direction.
- [ ] `targetEntityId` always filters the actual relationship target entity id, independent of join direction.
- [ ] Relationship join definitions accept optional `filter`, defaulting to null.
- [ ] The join-local `filter` uses the existing predicate shape.
- [ ] The join-local `filter` is applied before `latestRelationship` row selection.
- [ ] `required: true` excludes the base entity when no row remains after source/target id filters and the join-local filter.
- [ ] The join-local filter may reference only literals and the current relationship join by the same `joinKey`.
- [ ] The join-local filter rejects computed field references.
- [ ] The join-local filter rejects base entity references.
- [ ] The join-local filter rejects event, event-schema, event-join, and event-aggregate references.
- [ ] The join-local filter rejects relationship join references with any key other than the current join key.
- [ ] `tests/src/tests/query-engine.test.ts` contains a test proving that a join-local `contains` filter on a roles array selects the latest row among matching rows, not the latest row overall regardless of matching.
- [ ] `tests/src/tests/query-engine.test.ts` contains tests verifying `sourceEntityId` and `targetEntityId` constraints work correctly for both incoming and outgoing direction joins.
- [ ] `tests/src/fixtures/media.ts` or an appropriate fixture file provides any relationship row setup helpers needed by these tests that do not already exist.

## User stories addressed

- User story 5
- User story 6
- User story 14
- User story 17
- User story 18
- User story 19
- User story 24
- User story 39
