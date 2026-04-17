# Query Engine Reference Syntax Refactor

## Problem Statement

The query engine's field reference string syntax uses two separate conventions that
create unnecessary conceptual overhead:

1. A `@` prefix to distinguish entity/event built-in columns (e.g. `entity.book.@sandboxScriptId`,
   `event.review.@createdAt`) from schema properties (e.g. `entity.book.author`,
   `event.review.rating`).
2. Both entity built-in columns and schema properties live at the same dot-depth
   (`entity.book.@foo` and `entity.book.foo`) even though they resolve against
   fundamentally different storage locations (direct table columns vs. a JSONB
   `properties` column).

The artificial 2-dot depth limit enforced by the parser also prevents any future
support for nested JSONB property access (e.g. `entity.book.properties.metadata.source`).

Additionally, the internal `RuntimeRef` schema stores schema property and event
property references with a single `property: string` field, which cannot represent
a multi-segment path without introducing ambiguity.

## Solution

Unify the reference syntax under two simple, unambiguous rules:

- **Built-in columns** (entity or event) are accessed directly at the third segment:
  `entity.book.sandboxScriptId`, `event.review.createdAt`.
- **Schema properties** (entity or event) always live under a `properties` keyword:
  `entity.book.properties.author`, `event.review.properties.rating`.
- **Deep nesting** is expressed by continuing the path after `properties`:
  `entity.book.properties.metadata.source` → traverses `metadata` then `source`
  inside the JSONB `properties` column.

The `RuntimeRef` internal type changes the `property` field from `string` to
`string[]`, representing the full path of segments after the `properties` keyword.
No backwards compatibility or database migration is required.

## User Stories

1. As an API consumer, I want to reference an entity built-in column without a
   special `@` sigil, so that the syntax is consistent with regular properties.
2. As an API consumer, I want to reference an entity schema property using a
   `properties.` prefix, so that it is visually clear the value comes from the
   JSONB column rather than a top-level table column.
3. As an API consumer, I want to reference a nested object property like
   `entity.book.properties.metadata.source`, so that I can filter and display
   deeply nested data without workarounds.
4. As an API consumer, I want the same nesting rules to apply to event join
   references (`event.review.createdAt`, `event.review.properties.rating`), so
   that entity and event syntax are parallel and predictable.
5. As an API consumer, I want `computed.myField` references to remain unchanged,
   so that I do not have to relearn computed field syntax.
6. As a developer building a saved view, I want `entity.book.name` to resolve to
   the entity's built-in `name` column (not a schema property), so that I can
   sort and filter by name without any ambiguity.
7. As a developer building a saved view, I want `entity.book.properties.name` to
   resolve to the schema property named `name` (if it exists), so that a user-
   defined property with the same name as a built-in is still reachable.
8. As a developer, I want the parser to reject `entity.book.@sandboxScriptId` and
   `entity.book.author` (old syntax) with a clear error, so that I know
   immediately that I need to migrate.
9. As a developer, I want the error messages from validation to reflect the new
   path syntax, so that debugging is straightforward.
10. As a frontend developer, I want `resolvePropertyType("entity.anime.name", ...)
    to return `"string"` and `resolvePropertyType("entity.anime.properties.year", ...)`
    to return `"integer"`, so that the UI can derive display types from the new paths.
11. As a developer writing tests, I want all test fixtures and seed data to use
    the new path syntax, so that the test suite reflects the production API.

## Implementation Decisions

### `RuntimeRef` schema change

`schema-property` and `event-join-property` variants of `RuntimeRef` change
`property: string` to `property: string[]` (minimum length 1). This is a clean
breaking change with no migration path for existing persisted data. All call sites
that construct or consume `property` on these two variants must be updated to use
arrays.

### `parseFieldPath` grammar

The new grammar for the three namespaces is:

- `computed.{key}` — exactly 2 segments
- `entity.{slug}.{column}` — exactly 3 segments, resolves to `entity-column`
- `entity.{slug}.properties.{p1}[.{p2}...]` — 4 or more segments (with `properties`
  as the literal 3rd segment), resolves to `schema-property` with
  `property: [p1, p2, ...]`
- `event.{joinKey}.{column}` — exactly 3 segments, resolves to `event-join-column`
- `event.{joinKey}.properties.{p1}[.{p2}...]` — 4 or more segments, resolves to
  `event-join-property` with `property: [p1, p2, ...]`

All other shapes throw `Invalid field path: {input}`.

The word `properties` is a reserved keyword in segment position 3 for entity and
event paths. A built-in column named `properties` must never be added to
`entityRuntimeColumns` or `eventJoinColumns`.

### Property path traversal

`getPropertyType` and `getEventJoinPropertyDefinition` in the reference module are
updated to accept `string[]` paths and traverse `AppPropertyDefinition.properties`
for object-type nodes. Traversal stops with `null` if any intermediate segment is
absent or is not an `object` type.

### SQL generation for deep paths

The expression compiler builds chained PostgreSQL JSON operators for multi-segment
property paths:

- JSON access: `properties -> 'p1' -> 'p2'`
- Text extraction (last segment): `properties -> 'p1' ->> 'p2'`

A shared helper encapsulates this chaining logic and is reused for both entity
schema properties and event join properties.

### Expression type analysis

`inferViewExpressionType` is updated to traverse the property path for
`schema-property` and `event-join-property` references. The inferred type is that
of the **leaf** `AppPropertyDefinition` at the end of the path.

### Error messages

All error messages that referenced the old `@`-prefixed syntax are updated to use
the new path format. Property paths in error messages are joined with `.` for
readability (e.g. `metadata.source`).

### Frontend `resolvePropertyType`

The frontend helper is updated to handle:

- 3-segment `entity.{slug}.{column}` paths → look up in a `BUILTIN_TYPES` map
  (keys no longer prefixed with `@`).
- 4-segment `entity.{slug}.properties.{property}` paths → look up in schema
  fields. Deep nesting (5+ segments) is out of scope on the frontend for now;
  the function returns `null` for those paths.
- Event paths continue to return `null` (unchanged).

### OpenAPI spec regeneration

The `RuntimeRef` schema change affects the generated OpenAPI spec. After
implementation the spec must be regenerated using the standard backend tooling.

### Test infrastructure

- The `entityField` and `parseReference` helpers in the E2E test fixture module
  are updated to emit the new syntax.
- The `schemaPropertyExpression` helper updates `property` to a single-element
  array.
- The backend `entityExpression` and `eventExpression` test-fixture helpers are
  updated to remove the `@` convention and use `property: [field]`.
- All seed-script and E2E test strings using `@createdAt`, `@name`, `@updatedAt`,
  and `event.X.@createdAt` are migrated to the new format.

## Testing Decisions

Good tests for this refactor verify **observable behavior** at the module boundary:
they pass a field reference string or expression AST in and assert the resulting
SQL fragment, error message, or resolved type — not internal intermediate steps.

### Modules to test

**`parseFieldPath` (unit)**
- Parses each of the five valid path shapes to the correct `RuntimeRef`
- For multi-segment property paths, the `property` array contains all segments
  after `properties`
- Rejects old `@`-prefixed syntax
- Rejects paths with `properties` as a column name (3-segment entity path where
  third segment is `properties`)
- Rejects all malformed inputs

**`getPropertyType` (unit)**
- Returns the correct leaf type for both single-segment and multi-segment paths
- Returns `null` when an intermediate segment is not an `object` type
- Returns `null` for unknown paths

**`buildSchemaPropertyExpression` / expression compiler (unit)**
- The generated SQL contains chained `->` for multi-segment paths
- The final operator is `->>`  for text extraction and `->` for JSON

**`resolvePropertyType` frontend (unit)**
- Returns the correct type for all three-segment built-in paths (no `@`)
- Returns the correct type for four-segment schema property paths
- Returns `null` for event paths, deep paths (5+), unknown slugs, and missing properties

**Integration / E2E**
- Existing query engine E2E tests continue to pass after all references are
  migrated (they exercise sort, filter, display, computed fields, and event joins
  end-to-end against the database)

Prior art for unit tests: `reference.test.ts`, `filter-builder.test.ts`,
`expression-compiler.test.ts`, `resolve-property-type.test.ts`.
Prior art for E2E: `tests/src/tests/query-engine.test.ts`.

## Out of Scope

- **Database migration**: existing persisted `RuntimeRef` payloads in saved views
  are intentionally abandoned; no migration script is required.
- **Backwards-compatible parsing**: the parser will not accept both old and new
  syntax simultaneously.
- **Frontend deep nesting**: `resolvePropertyType` will not traverse nested object
  definitions beyond the first `properties.{key}` level.
- **Array-type element access syntax**: no new syntax for indexing into array
  properties (e.g. `entity.book.properties.tags.0`).
- **Computed field syntax**: `computed.{key}` is unchanged.

## Further Notes

- The word `properties` is permanently reserved as segment 3 in entity and event
  paths. Documentation and tooling should make this clear to prevent confusion
  with a user-defined schema slug or property of the same name.
- The `resolveRuntimeReference` function in the reference module is exported but
  currently has no known production call sites outside tests. It is updated for
  consistency but may be a candidate for removal in a future cleanup.

---

## Tasks

**Overall Progress:** 0 of 6 tasks completed

**Current Task:** [Task 01](./01-core-type-parser-and-sql.md) (todo)

### Task List

| #   | Task                                                                          | Type | Status | Blocked By      |
| --- | ----------------------------------------------------------------------------- | ---- | ------ | --------------- |
| 01  | [Core Type, Parser, and SQL Changes](./01-core-type-parser-and-sql.md)        | AFK  | todo   | None            |
| 02  | [OpenAPI Spec Regeneration](./02-openapi-spec-regeneration.md)                | AFK  | todo   | Task 01         |
| 03  | [Frontend resolvePropertyType Update](./03-frontend-resolve-property-type.md) | AFK  | todo   | Task 02         |
| 04  | [E2E Test Infrastructure and Test Updates](./04-e2e-test-infrastructure.md)   | AFK  | todo   | Task 02         |
| 05  | [Cleanup Dead Code and Useless Tests](./05-cleanup-dead-code.md)              | AFK  | todo   | Task 01, 03, 04 |
| 06  | [Documentation Update](./06-documentation.md)                                 | AFK  | todo   | Task 01         |
