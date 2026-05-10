## Problem Statement

Query Engine entity queries can currently return entity fields, computed fields, latest-event joins, event aggregates, and event-row data in event modes. Relationships already exist in the product model, but the Query Engine only uses them as a filter-only visibility gate for non-user-owned entities. This makes relationship data unavailable to users who want to build views around relationship properties or related entities.

Users need to return relationship-derived values such as collection membership ratings, filter entities by relationship properties such as person roles, and sort entities by related entity fields such as the target library or collection name. The existing top-level relationship filter key is not a good long-term contract because it sounds like data access but only performs access filtering. Since backwards compatibility is not a concern, the feature should replace that ambiguous mechanism with one relationship join mechanism that can both filter and expose relationship data.

The implementation also needs to remove a source of ambiguity before adding slug-based relationship joins: user-defined schema slugs must not conflict with built-in schema slugs in any schema namespace where slugs are used as API identifiers. Query Engine relationship joins should resolve relationship schemas by slug, so visible slug conflicts must be prevented and rejected.

## Solution

Replace the existing relationship filter-only request field with a top-level `relationshipJoins` declaration for entity-backed query modes. A relationship join declares a named relationship data source, similar to event joins. Query expressions reference a declared relationship join by key using a new relationship join reference type.

Each relationship join selects at most one relationship row per base entity. The first supported kind is `latestRelationship`, which selects the matching relationship row with the newest creation timestamp and breaks ties by descending id. A relationship join is optional by default, so adding a display-only join does not remove entities from results. A join with `required: true` filters out any base entity that does not produce a matching relationship row after all join constraints and the join-local filter are applied.

The same relationship join declaration works for returning fields, filtering, sorting, computed fields, and aggregate-mode entity set filtering. Relationship joins are supported in entity and aggregate modes only. Event and time-series modes do not support relationship joins.

Relationship join references expose relationship row built-ins, schema-validated relationship properties, and related source/target entity values. Related entity built-ins use the same behavior as normal entity built-ins, including display-only image behavior. Related entity properties are only available when the relationship schema defines the relevant source or target entity schema, so property paths can be validated against a known schema.

## User Stories

1. As a saved-view author, I want to include a relationship property in a Query Engine result field, so that I can display data stored on a relationship row.
2. As a collection user, I want to display a membership rating from a `member-of` relationship, so that collection views can show per-membership metadata.
3. As a collection user, I want to display who recommended an item from a membership relationship property, so that collection views can expose custom membership details.
4. As a media user, I want to sort entities by a related library or collection entity name, so that relationship-backed views can be ordered by related data.
5. As a media user, I want to filter movies by a person-to-movie role relationship property, so that I can find media where a person has a specific role.
6. As a media user, I want to filter by a specific related person or collection id, so that one-to-many relationships can be narrowed to the row I care about.
7. As a query author, I want a relationship join to be optional by default, so that adding relationship display fields does not unexpectedly remove result rows.
8. As a query author, I want a relationship join to be marked required, so that the same join declaration can constrain the entity set when needed.
9. As a query author, I want required relationship joins to filter all base entities consistently, so that required joins behave like normal joins rather than special access-control logic.
10. As a query author, I want missing optional relationship rows to return null values, so that optional relationships are predictable in display fields.
11. As a query author, I want relationship joins to have explicit direction, so that source and target semantics are clear.
12. As a query author, I want outgoing joins to match relationships whose source is the base entity, so that source-side relationship queries are straightforward.
13. As a query author, I want incoming joins to match relationships whose target is the base entity, so that target-side relationship queries are straightforward.
14. As a query author, I want `sourceEntityId` and `targetEntityId` filters to refer to the actual relationship row sides, so that direction does not change the meaning of those filters.
15. As a query author, I want relationship join keys to be explicit aliases, so that expressions can reference a relationship join without repeating the schema and constraints.
16. As a query author, I want relationship join keys to follow the same identifier rules as event join keys, so that generated SQL aliases remain safe and predictable.
17. As a query author, I want relationship joins to support a join-local filter, so that the selected latest relationship row is chosen from rows matching relationship-specific criteria.
18. As a media user, I want a join-local filter to run before latest-row selection, so that “latest director credit” selects from director rows rather than selecting the latest credit and then checking whether it is a director row.
19. As a query author, I want the join-local filter to be constrained to the current relationship join, so that relationship matching remains understandable and testable.
20. As a query author, I want relationship joins to match both user-owned and global relationship rows, so that user library data and global person-to-media data are both queryable.
21. As a saved-view author, I want built-in library views to express in-library visibility using required relationship joins, so that saved views use the same relationship mechanism as custom queries.
22. As an aggregate query author, I want relationship joins to constrain aggregate entity sets, so that counts and grouped aggregates can operate on relationship-scoped entities.
23. As a query author, I want relationship-derived scalar values to participate in sorting when their type supports sorting, so that relationship data works like entity and event data.
24. As a query author, I want relationship-derived scalar values to participate in filters when their type supports the selected operator, so that relationship data works with existing predicates.
25. As a query author, I want relationship-derived values to work in top-level computed fields, so that reusable expressions can include relationship data.
26. As a query author, I want relationship properties to be validated against relationship schema definitions, so that invalid property paths fail early instead of returning confusing nulls.
27. As a query author, I want related entity properties to be rejected when the relationship schema does not define that entity side’s schema, so that property typing remains reliable.
28. As a query author, I want related entity built-ins to be available without extra schema declarations, so that common related fields like id and name are easy to use.
29. As a query author, I want related entity image fields to remain display-only, so that relationship references obey the same safety rules as entity references.
30. As an API consumer, I want the old ambiguous relationship filter key removed, so that the request contract has one clear way to work with relationships.
31. As an API consumer, I want event and time-series modes to reject relationship joins, so that mode capabilities remain explicit.
32. As an API consumer, I want generated OpenAPI types to reflect relationship joins and relationship references, so that typed clients can construct valid requests.
33. As a backend maintainer, I want relationship schema slugs to resolve to exactly one visible schema, so that relationship joins are deterministic.
34. As a backend maintainer, I want user-created schema slugs to be prevented from conflicting with built-in schema slugs, so that slug-based APIs remain unambiguous.
35. As a backend maintainer, I want the SQL join strategy to avoid row multiplication, so that pagination, sorting, and aggregate counts remain correct.
36. As a backend maintainer, I want relationship join SQL to be shared by fields, filters, sorts, and aggregates, so that relationship semantics are implemented once.
37. As a backend maintainer, I want relationship join validation to reject joins incompatible with the query scope and direction, so that impossible joins fail with useful errors.
38. As a backend maintainer, I want relationship joins to preserve existing event join and computed field behavior, so that the new feature does not regress current query capabilities.
39. As a test maintainer, I want relationship join behavior covered by focused backend unit tests and end-to-end query tests, so that future query language changes are safe.
40. As a future implementation agent, I want the PRD and task files to define exact behavior and acceptance criteria, so that implementation does not require re-deciding the API contract.

## Implementation Decisions

- The old top-level relationship filter key is removed from Query Engine request contracts and saved-view query definitions.
- The replacement top-level key is `relationshipJoins`.
- `relationshipJoins` is supported in entity and aggregate modes only.
- Event and time-series modes do not accept `relationshipJoins` and do not allow relationship join references.
- Entity and aggregate requests default `relationshipJoins` to an empty array.
- Saved-view query definitions use the same `relationshipJoins` contract as direct Query Engine execute requests.
- Built-in saved views that previously used relationship filters must use required relationship joins instead.
- A relationship join definition has a unique `key` using the same identifier rules as event join keys.
- The only relationship join kind in this PRD is `latestRelationship`.
- A relationship join definition includes `relationshipSchemaSlug`, `direction`, optional `required`, optional `sourceEntityId`, optional `targetEntityId`, and optional `filter`.
- `direction` is required and is either `outgoing` or `incoming`.
- `outgoing` means the base entity id must equal the relationship source entity id.
- `incoming` means the base entity id must equal the relationship target entity id.
- `sourceEntityId` and `targetEntityId` are literal string filters against the actual relationship row source and target columns, independent of direction.
- `required` defaults to false.
- `required: false` means a missing relationship row does not remove the base entity and relationship-derived expressions resolve to null.
- `required: true` means the base entity is excluded unless the join produces a relationship row after schema, direction, user/global visibility, source/target id, scope compatibility, and join-local filter constraints.
- Relationship joins match relationship rows where the row user is the authenticated user or the row has no user.
- `latestRelationship` selects one row per base entity ordered by relationship creation timestamp descending and then relationship id descending.
- The join-local `filter` is a normal predicate shape, defaulting to null.
- The join-local `filter` is applied before latest-row selection.
- The join-local `filter` may reference only literals and the current relationship join by its own key.
- The join-local `filter` must not reference computed fields, event joins, primary event rows, entity rows, other relationship joins, or relationship joins with a different key.
- Top-level fields, top-level filters, top-level sorts, aggregate filters, aggregate grouping where supported, and top-level computed fields may reference relationship joins when the query mode supports relationship joins.
- The relationship runtime reference discriminator is `relationship-join`.
- A relationship runtime reference contains `joinKey` and `path`.
- Relationship join reference paths support relationship row built-ins `id`, `createdAt`, `sourceEntityId`, and `targetEntityId`.
- Relationship join reference paths support relationship properties under a leading `properties` segment.
- Relationship property references must exist in the resolved relationship schema properties schema.
- Relationship property types are inferred from the relationship schema properties schema.
- Relationship property sort and filter behavior uses the existing expression type policy.
- Relationship join reference paths support nested `sourceEntity` and `targetEntity` roots.
- Related entity built-ins under `sourceEntity` and `targetEntity` support the same built-ins as normal entity references: id, name, image, createdAt, updatedAt, externalId, and sandboxScriptId.
- Related entity image fields are display-only and are rejected from filters, sorts, arithmetic, and scalar string composition.
- Related entity properties under `sourceEntity.properties` and `targetEntity.properties` are supported only when the relationship schema defines the source or target entity schema for that side.
- Related entity property references are validated against the known entity schema for that side.
- Related entity property references are rejected when the relationship schema side is not defined or the property path does not exist.
- Relationship schema slugs are the public API identifier for relationship joins.
- Relationship schema slug resolution must find exactly one visible relationship schema for the authenticated user.
- User-created schema slug conflicts with built-in schema slugs must be rejected across schema namespaces where user creation exists.
- Schema slug collision prevention is a prerequisite implementation step before relationship joins.
- The feature should not require database table changes for relationship joins.
- Slug collision prevention should be enforced as external service behavior for schema creation and should be tested through public service or API behavior.
- Query builders should avoid row multiplication by materializing each relationship join as a scalar per base entity before filtering, sorting, pagination, and field resolution.
- The preferred SQL shape is a lateral relationship lookup or equivalent CTE enrichment that produces one JSON-like relationship payload column per join key.
- The relationship join payload should be available by the joined entity CTE stage so top-level filtering, sorting, pagination, aggregate filtering, and field resolution all share the same semantics.
- Relationship join implementation should follow the event join mental model, but relationship joins are not event joins and should have separate validation, loading, CTE construction, and reference compilation where that keeps the module clear.
- Existing entity, event, computed field, event join, event aggregate, aggregate, pagination, and display semantics must continue to work.

## Testing Decisions

- Tests should verify observable Query Engine behavior and validation behavior, not private implementation details.
- Schema slug collision tests should verify that user-facing schema creation rejects conflicts with built-in schema slugs in applicable schema namespaces.
- Query Engine unit tests should cover schema parsing, request normalization, loaders, reference validation, type inference, expression compilation, sort/filter compatibility, and CTE SQL shape where existing tests already cover similar behavior.
- End-to-end Query Engine tests should cover relationship joins through the execute endpoint using real relationship rows.
- Entity-mode tests should verify returning relationship row properties and built-ins as fields.
- Entity-mode tests should verify sorting by a relationship-derived scalar.
- Entity-mode tests should verify filtering by a relationship-derived scalar or array-compatible property.
- Entity-mode tests should verify optional missing joins produce null values without removing rows.
- Entity-mode tests should verify required missing joins remove rows.
- Entity-mode tests should verify required joins filter all base entities consistently, not only global/non-user-owned entities.
- Entity-mode tests should verify join-local filters apply before latest-row selection.
- Entity-mode tests should verify `sourceEntityId` and `targetEntityId` constrain actual relationship row sides.
- Entity-mode tests should verify incoming and outgoing direction semantics.
- Entity-mode tests should verify related entity built-ins such as target entity name can be returned and used for sorting.
- Entity-mode tests should verify related entity properties are accepted when the relationship schema defines that side’s entity schema and rejected otherwise.
- Aggregate-mode tests should verify relationship joins can constrain aggregate counts.
- Validation tests should verify relationship join keys are unique and follow identifier rules.
- Validation tests should verify event and time-series modes reject relationship joins and relationship join references.
- Validation tests should verify join-local filters cannot reference computed fields, base entity fields, events, event joins, or other relationship joins.
- Validation tests should verify ambiguous or missing relationship schema slugs fail with clear errors.
- Tests should include migration of existing query-engine relationship filter scenarios to `relationshipJoins` so old behavior is covered under the new contract.
- Tests should update generated client fixture usage and examples so typed test requests compile against the new OpenAPI contract.

## Out of Scope

- Returning multiple relationship rows as arrays is out of scope.
- Row-expanding relationship joins that duplicate base entities are out of scope.
- Relationship joins in event mode are out of scope.
- Relationship joins in time-series mode are out of scope.
- Dynamic expression-based `sourceEntityId` or `targetEntityId` filters are out of scope.
- Multi-id `sourceEntityId` or `targetEntityId` filters are out of scope.
- Join-local filters that reference base entity fields, computed fields, event fields, event joins, or other relationship joins are out of scope.
- Relationship aggregate reference types are out of scope.
- Schema id based relationship join references are out of scope.
- Backwards compatibility for the old relationship filter key is out of scope.
- Database table changes for relationship join storage are out of scope.
- Frontend UI changes are out of scope unless needed to keep existing generated types or tests compiling.

## Further Notes

- The first implementation task must handle schema slug collision behavior before adding relationship joins.
- Existing relationship rows and relationship schemas are sufficient for this feature.
- The collection membership example depends on relationship properties being present on the relationship row and typed by the resolved relationship schema. If collection-specific membership schemas remain stored on collection entities rather than relationship schemas, relationship property references should be strict against the relationship schema and collection-specific typing should be handled in a separate future feature.
- The old relationship filter behavior was an access-control gate only for non-user-owned entities. The new `required` behavior intentionally filters all base entities. Any built-in flow that expects a library-scoped entity to appear in a required in-library view must ensure the relevant in-library relationship row exists.
- Keep the implementation minimal and aligned with existing Query Engine patterns. Prefer small additions that mirror event joins over broad query-language generalization.

---

## Tasks

**Overall Progress:** 1 of 8 tasks completed

**Current Task:** [Task 02](./02-e2e-tests-schema-slug-collision-rules.md) (todo)

### Task List

| #   | Task                                                                                                                                   | Type | Status |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------ |
| 01  | [Enforce Schema Slug Collision Rules](./01-enforce-schema-slug-collision-rules.md)                                                     | AFK  | done   |
| 02  | [E2E Tests For Schema Slug Collision Rules](./02-e2e-tests-schema-slug-collision-rules.md)                                             | AFK  | todo   |
| 03  | [Replace Relationship Filters With Required Relationship Joins](./03-replace-relationship-filters-with-required-relationship-joins.md) | AFK  | todo   |
| 04  | [Return And Use Relationship Row Fields](./04-return-and-use-relationship-row-fields.md)                                               | AFK  | todo   |
| 05  | [Add Join-Local Relationship Filtering](./05-add-join-local-relationship-filtering.md)                                                 | AFK  | todo   |
| 06  | [Expose Source And Target Entity Data](./06-expose-source-and-target-entity-data.md)                                                   | AFK  | todo   |
| 07  | [Refresh Query Engine Docs And Generated Examples](./07-refresh-query-engine-docs-and-generated-examples.md)                          | AFK  | todo   |
| 08  | [Codebase Cleanup](./08-codebase-cleanup.md)                                                                                          | AFK  | todo   |
