# Expression Compiler, Query Builder, and Response Shape

**Parent Plan:** [Entity Schema Fields Expression](./README.md)

**Type:** AFK

**Status:** done

## What to build

The end-to-end backend integration: SQL compilation for entity schema references, JSONB CTE column replacing discrete entity schema columns, removal of top-level `entitySchemaSlug` and `entitySchemaId` from the query engine response, and comprehensive tests.

### Scope

#### Expression compiler

- Add `buildEntitySchemaExpression` function following the pattern of `buildEntityExpression` and `buildEventExpression`.
- For each of the 9 entity schema columns, produce `alias.entity_schema_data ->> 'columnName'`.
- Apply type casting: `::boolean` for `isBuiltin`, `::timestamptz` for `createdAt` and `updatedAt`.
- Do NOT apply the multi-schema CASE WHEN wrapping that entity references use — entity schema data is always correct per row.
- Wire into the `createScalarExpressionCompiler` compile dispatch before the event reference fallthrough.

#### Updating internal CASE WHEN

- Replace all existing references to `alias.entity_schema_slug` in the expression compiler with `alias.entity_schema_data ->> 'slug'`. This includes the multi-schema CASE WHEN guard in `buildEntityExpression`.

#### Query builder CTE changes

- In `buildBaseEntitiesCte`, replace `entitySchema.slug as entity_schema_slug` and `entity.entitySchemaId as entity_schema_id` with a single JSONB column using `jsonb_build_object` containing all 9 entity schema columns.
- Remove `entity_schema_slug` and `entity_schema_id` from the final SELECT projection in the main query.
- Update the `QueryRow` type to replace `entity_schema_slug` and `entity_schema_id` with `entity_schema_data`.
- Update `mapQueryRowToItem` to remove `entitySchemaSlug` and `entitySchemaId` from the mapped item.

#### Response schema

- Remove `entitySchemaId` and `entitySchemaSlug` from `queryEngineBaseItemSchema`.

#### Tests

- Unit tests for the expression compiler: verify SQL output for each entity schema column.
- Unit tests for the query builder: verify the CTE projects `entity_schema_data` JSONB and does not project discrete entity schema columns.
- Integration tests: execute a query with an entity schema field and verify it appears in the `fields` array with the correct resolved display value.

### Files

- `apps/app-backend/src/modules/query-engine/expression-compiler.ts` — new function, dispatch wiring, CASE WHEN update
- `apps/app-backend/src/modules/query-engine/expression-compiler.test.ts` — new unit tests
- `apps/app-backend/src/modules/query-engine/query-builder.ts` — CTE, QueryRow, toItem, final SELECT
- `apps/app-backend/src/modules/query-engine/schemas.ts` — remove top-level fields
- `tests/src/tests/query-engine.test.ts` — integration tests

## Acceptance criteria

- [x] `buildEntitySchemaExpression` for slug produces `alias.entity_schema_data ->> 'slug'`
- [x] `buildEntitySchemaExpression` for isBuiltin produces `(alias.entity_schema_data ->> 'isBuiltin')::boolean`
- [x] `buildEntitySchemaExpression` for createdAt produces `(alias.entity_schema_data ->> 'createdAt')::timestamptz`
- [x] Multi-schema entity references still work (CASE WHEN uses `alias.entity_schema_data ->> 'slug'`)
- [x] Base entities CTE includes `entity_schema_data` JSONB column
- [x] `entity_schema_slug` and `entity_schema_id` no longer appear in the CTE or final SELECT
- [x] `QueryEngineItem` no longer has `entitySchemaSlug` or `entitySchemaId` fields
- [x] Query engine integration test passes with an entity schema field in the `fields` array
- [x] All existing query engine tests still pass (tests that assert `entitySchemaSlug` are updated)
- [x] All existing saved view tests still pass

## User stories addressed

- 1: Display entity schema name as table column
- 2: Filter by entity schema slug
- 3: Sort by entity schema name
- 4: Display entity schema icon
- 5: Display entity schema accent color
- 6: Filter by isBuiltin
- 7: Use in computed fields
- 8: Sort by entity schema createdAt/updatedAt
- 10: API consumer uniform field access
