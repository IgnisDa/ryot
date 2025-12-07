# View Runtime: Schema Introspection + Single-Schema Execution

**Parent Plan:** [View Runtime Foundation](./README.md)

**Type:** AFK

**Status:** done

## What to build

Build the schema introspection service and replace the view-runtime placeholder with a working single-schema execution engine. This delivers the core runtime pipeline: accept a compiled request, resolve entity schemas, execute a parameterized query, and return paginated results with COALESCE-resolved display properties.

The end-to-end behavior: a client sends `POST /view-runtime/execute` with a single entity schema slug, a sort definition, pagination parameters, and a layout-specific display configuration. Grid/list responses return paginated entity results with self-describing `resolvedProperties` slots (`{ value, kind }`). Table responses return `meta.table.columns` plus ordered row `cells`. Pagination metadata includes total count, page info, and navigation booleans.

### Schema Introspection Service

Create `apps/app-backend/src/modules/view-runtime/schema-introspection.ts`:

- `getPropertyType(schema, propertyName)` - returns property type from schema's propertiesSchema, or null if not found
- `buildSchemaMap(schemas)` - converts array of entity schemas to Map keyed by slug for O(1) lookup
- `parseFieldPath(field)` - parses `@name` as top-level column, `smartphones.year` as schema-qualified property
- See PRD section "Schema Introspection Service" for full function signatures

Unit tests for schema introspection (100% coverage):
- Property type lookup for string, integer, number, boolean, date types
- Property type lookup returns null for non-existent properties
- Schema map building from array of schemas
- Field path parsing: `@name` → top-level, `smartphones.year` → schema-property
- Follow pattern in `apps/app-backend/src/modules/saved-views/service.test.ts`

### View Runtime Request/Response Schemas

Update `apps/app-backend/src/modules/view-runtime/schemas.ts`:

Request schema (see PRD section "View Runtime Module Changes > Request schema structure"):
- `entitySchemaSlugs: string[]`
- `filters: FilterExpression[]` (empty array for this task)
- `sort: { field: string[], direction: "asc" | "desc" }`
- `pagination: { page: number, limit: number }`
- `layout: "grid" | "list" | "table"`
- `displayConfiguration: GridConfig | ListConfig | TableConfig`

Response schema (see PRD section "View Runtime Module Changes > Response schema structure"):
- `items: Array<{ id, name, image, entitySchemaId, entitySchemaSlug, createdAt, updatedAt, resolvedProperties?, cells? }>`
- `meta: { pagination: { page, total, limit, hasNextPage, hasPreviousPage, totalPages }, table?: { columns: Array<{ key, label }> } }`

### Query Builder

Create `apps/app-backend/src/modules/view-runtime/query-builder.ts`:

For this task, implement single-schema execution only:
1. Pre-fetch entity schema by slug (verify it exists and user has access)
2. Build basic query: SELECT from entities JOIN entity_schemas WHERE slug matches
3. Sort by top-level column (`@name`, `@createdAt`, `@updatedAt`) or single schema property
4. Use Drizzle `sql` template tag for parameterized queries
5. Generate CTEs: `filtered_entities`, `entity_count`, `sorted_entities`, `paginated_entities`
6. Resolve grid/list display configuration properties into semantic slots with `{ value, kind }` wrappers
7. For table layout, return ordered `cells` and `meta.table.columns` using the saved-view column labels
8. Execute query and return results with pagination metadata

See PRD sections "Query Builder Architecture" and "Execution flow."

### Pagination

Implement full pagination per PRD section "Pagination Behavior":
- Page-based contract: `pagination: { page, limit }`
- Out-of-range handling: return empty items without clamping to the last page
- Zero-result handling: `totalPages: 0`
- Full metadata: page, total, limit, hasNextPage, hasPreviousPage, totalPages
- Separate CTE for total count (not correlated subquery)

Unit tests for pagination math:
- Standard case (20 items, limit 5, page 1 → page 1 of 4)
- Out-of-range page (request page 100 with only 4 total pages → preserves page and returns empty items)
- Zero results (totalPages: 0, hasNextPage: false, hasPreviousPage: false)
- Last page (hasNextPage: false, hasPreviousPage: true)

### Route Handler

Replace the placeholder in `apps/app-backend/src/modules/view-runtime/routes.ts`:
- Accept the new request schema
- Validate entity schema slugs exist and user has access
- Call query builder
- Return response with items and pagination metadata
- Error handling: 404 for non-existent schema slug, 400 for missing sort field

### Integration Tests

- Simple single-schema query returns correct entities
- Pagination returns correct page with correct metadata
- Sort by `@name` orders alphabetically
- Sort by schema property orders correctly
- Grid layout resolvedProperties contain semantic keys with `{ value, kind }`
- List layout resolvedProperties contain semantic keys with `{ value, kind }`
- Table layout returns ordered `cells` and `meta.table.columns`
- Image fields returned as raw discriminated unions (not resolved to URLs)
- Non-existent schema slug returns 404
- Empty sort field returns 400

## Acceptance criteria

- [x] Schema introspection service exists with `getPropertyType`, `buildSchemaMap`, `parseFieldPath`
- [x] Unit tests for schema introspection achieve 100% coverage
- [x] View runtime request/response Zod schemas are defined
- [x] Query builder accepts single-schema request and generates parameterized SQL via Drizzle
- [x] Pre-fetches entity schemas and validates access
- [x] Sort works for top-level columns (`@name`, `@createdAt`, `@updatedAt`) and schema properties
- [x] Pagination metadata is correct (page, total, limit, hasNextPage, hasPreviousPage, totalPages)
- [x] Out-of-range pages return empty items without clamping
- [x] Zero-result queries return `totalPages: 0`
- [x] Grid/list display properties resolved with semantic keys (imageProperty, titleProperty, etc.)
- [x] Images returned as raw jsonb discriminated unions
- [x] Returns 404 for non-existent schema slugs
- [x] Returns 400 for missing/empty sort field
- [x] Runtime module does not load saved views by ID (execution-only)
- [x] Unit tests for pagination math pass
- [x] Integration tests pass
- [x] Workspace `bun run typecheck` passes

## Blocked by

- [Task 01](./01-saved-views-data-model-bootstrap.md)

## User stories addressed

- User story 7 (paginated results)
- User story 8 (backend resolves property values)
- User story 19 (pagination metadata)
- User story 20 (out-of-range pages return empty results)
- User story 22 (image fields as raw discriminated unions)
- User story 24 (grid/list semantic keys)
- User story 25 (property type introspection)
- User story 27 (pre-fetch entity schemas)
- User story 28 (Drizzle SQL template tag)
- User story 30 (execution-only, no saved view loading)
- User story 37 (error patterns)
- User story 39 (sort field required)
- User story 40 (zero-result pagination)
- User story 41 (separate CTE for count)
- User story 46 (schema introspection as separate service)
