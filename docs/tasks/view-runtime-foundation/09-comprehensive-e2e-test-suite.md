# Comprehensive E2E Test Suite

**Parent Plan:** [View Runtime Foundation](./README.md)

**Type:** AFK

**Status:** done

## What to build

Create a comprehensive E2E test suite that tests the full HTTP request/response cycle for both saved-views and view-runtime endpoints. These tests run against a real database via the OpenAPI client, testing the complete stack from HTTP request to database query to HTTP response.

The end-to-end behavior: all E2E tests pass in the `tests/` directory, covering the full range of saved-views CRUD operations and view-runtime query capabilities. Tests use the existing testcontainers setup (PostgreSQL + Redis) and OpenAPI fetch client.

### Test Setup

Follow the existing pattern in `tests/src/tests/health.test.ts`:
- Use `getBackendClient()` for type-safe API requests
- Tests run against bootstrapped database (built-in schemas and views exist)
- Create test data (custom schemas, entities, views) as needed for each test

### Saved Views E2E Tests

File: `tests/src/tests/saved-views.test.ts`

Note: individual endpoint tasks (02, 03, 04) include their own E2E tests. This task ensures comprehensive coverage across all endpoints working together.

- Full lifecycle: create → get → update → clone → delete
- Clone a built-in view, verify cloned view is deletable
- Update a cloned view's queryDefinition and displayConfiguration, verify changes persist
- List views includes both built-in and user-created views
- Delete built-in view fails (protection rule)
- Delete user-created view succeeds

### View Runtime E2E Tests

File: `tests/src/tests/view-runtime.test.ts`

**Basic execution:**
- Simple single-schema query returns entities with correct response shape
- Response includes all required fields: id, name, image, entitySchemaId, entitySchemaSlug, createdAt, updatedAt, resolvedProperties
- Pagination metadata is correct (page, total, limit, hasNextPage, hasPreviousPage, totalPages)

**Filter tests:**
- `eq` filter returns only matching entities
- `ne` filter excludes matching entities
- `gt`/`gte`/`lt`/`lte` range filters work with integer properties
- `in` filter with array of values
- `isNull` filter finds entities with null properties
- Multiple filters on same schema (AND behavior)
- Filters across different schemas (OR across schemas)
- Top-level `@name` filter applies to all entities
- Non-existent property returns 400 error

**Sort tests:**
- Sort by `@name` ascending
- Sort by `@name` descending
- Sort by schema property
- Cross-schema sort with COALESCE
- NULLS LAST ordering

**Pagination tests:**
- First page
- Middle page
- Last page (hasNextPage: false)
- Out-of-range page returns empty items
- Zero results (totalPages: 0)

**Display configuration tests:**
- Grid layout returns semantic keys (imageProperty, titleProperty, etc.)
- List layout returns semantic keys
- Table layout returns index-based keys (column_0, column_1, etc.)
- Cross-schema display config COALESCE resolves per-schema properties
- Empty property reference array resolves to null

**Error tests:**
- Non-existent schema slug returns 404
- Empty sort field returns 400
- Non-existent filter property returns 400

### Test Data Strategy

Create test fixtures:
- Custom entity schema with known properties (e.g., "smartphones" with manufacturer, year, os)
- Multiple entities in that schema with varying property values
- Optionally a second custom schema for cross-schema tests (e.g., "tablets" with maker, release_year)
- Use the existing bootstrap for built-in schema tests

## Acceptance criteria

- [x] `tests/src/tests/saved-views.test.ts` exists with full lifecycle tests
- [x] `tests/src/tests/view-runtime.test.ts` exists with comprehensive runtime tests
- [x] Filter tests cover all 8 operators (eq, ne, gt, gte, lt, lte, in, isNull)
- [x] Sort tests cover ascending, descending, cross-schema COALESCE, NULLS LAST
- [x] Pagination tests cover first page, middle page, last page, out-of-range page, zero results
- [x] Display configuration tests cover grid, list, table layouts
- [x] Cross-schema tests cover filters, sort, and display COALESCE
- [x] Error tests cover 404 and 400 cases
- [x] All tests pass with `bun test` in the `tests/` directory
- [x] Tests use existing testcontainers setup (no new infrastructure needed)
- [x] Tests follow existing patterns from `health.test.ts`

## Blocked by

- [Task 02](./02-get-saved-view-by-id.md)
- [Task 03](./03-put-saved-view.md)
- [Task 04](./04-clone-saved-view.md)
- [Task 07](./07-view-runtime-filter-execution.md)
- [Task 08](./08-view-runtime-cross-schema-coalesce.md)

## User stories addressed

- User story 43 (unit tests for query builder SQL generation)
- User story 44 (integration tests for full execution flow)
- User story 45 (E2E tests in tests/ directory)
