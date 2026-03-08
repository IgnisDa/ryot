# Replace Relationship Filters With Required Relationship Joins

**Parent Plan:** [Query Engine Relationship Joins](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Replace the old filter-only relationship request field with `relationshipJoins` in entity and aggregate Query Engine requests and saved-view query definitions. This slice should deliver the new join declaration shape and required-join filtering behavior end to end, even before relationship-derived expressions are returned as fields.

## Acceptance criteria

- [ ] Entity-mode execute requests accept `relationshipJoins` and default it to an empty array.
- [ ] Aggregate-mode execute requests accept `relationshipJoins` and default it to an empty array.
- [ ] Saved-view query definitions accept `relationshipJoins` and no longer rely on the old relationship filter key.
- [ ] Event-mode and time-series-mode execute requests reject `relationshipJoins`.
- [ ] The old top-level relationship filter key is removed from request schemas and saved-view schemas rather than kept as a compatibility alias.
- [ ] Each relationship join requires `key`, `kind: "latestRelationship"`, `relationshipSchemaSlug`, and explicit `direction`.
- [ ] Relationship join keys are unique and use the same identifier rules as event join keys.
- [ ] `required` defaults to false.
- [ ] `required: true` filters every base entity unless the join produces a matching row.
- [ ] Optional joins do not filter base entities.
- [ ] Matching rows include relationship rows owned by the current user and global relationship rows with no user.
- [ ] `direction: "outgoing"` matches rows where the base entity is the relationship source entity.
- [ ] `direction: "incoming"` matches rows where the base entity is the relationship target entity.
- [ ] `latestRelationship` chooses one row by relationship creation timestamp descending and relationship id descending.
- [ ] Built-in saved views that previously used the old relationship filter key use required in-library relationship joins.
- [ ] All existing tests in `tests/src/tests/query-engine.test.ts` that used the old `relationships` key are rewritten to use `relationshipJoins` with `required: true`; no test still references the removed key.
- [ ] `tests/src/fixtures/query-engine.ts` is updated: `buildGridRequest`, `buildListRequest`, `buildTableRequest`, and `buildQueryEngineRequest` no longer include a `relationships` field in their defaults or type signatures.
- [ ] `tests/src/test-support/query-engine-suite.ts` is updated to use `relationshipJoins` wherever it previously used `relationships`.
- [ ] `tests/src/fixtures/saved-views.ts` is updated if any saved-view fixture helpers still reference the old `relationships` key.
- [ ] Generated OpenAPI types are updated and test imports compile without type errors after the schema change.

## User stories addressed

- User story 7
- User story 8
- User story 9
- User story 21
- User story 22
- User story 30
- User story 31
- User story 32
- User story 35
- User story 38
