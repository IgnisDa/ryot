# View Runtime Foundation

## Problem Statement

Users need a universal browsing primitive for entities in Ryot. Currently, entity browsing is scattered across different tracker-specific routes, making it difficult to create flexible, cross-schema views. The existing saved-views module only stores basic metadata (`entitySchemaSlugs`), and the view-runtime module is a placeholder that returns all entities from a single schema without filtering, sorting, or pagination. This makes it impossible to build advanced features like filtered views, cross-tracker views, or customizable entity displays.

## Solution

Build a complete view-runtime execution engine that accepts compiled query requests (filters, sorts, pagination, display configuration) and returns normalized results with COALESCE-resolved properties. Expand the saved-views module to store both query semantics and presentation configuration, enabling users to save complex views and switch between grid/list/table layouts without losing their configuration. This creates a single, universal API for entity browsing that works across all entity schemas (built-in and custom) and supports future query-builder UI development.

## User Stories

1. As a user, I want to save a view with multiple layout configurations (grid, list, table), so that I can switch between layouts without losing my configuration.

2. As a user, I want to create a saved view that queries multiple entity schemas simultaneously, so that I can browse related entities (like smartphones and tablets) in a unified list.

3. As a user, I want to filter entities by their schema-defined properties (e.g., "year >= 2020"), so that I can find specific entities that match my criteria.

4. As a user, I want to sort entities by properties that have different names across schemas, so that the system automatically uses the correct property for each schema type.

5. As a user, I want to clone an existing saved view, so that I can create variations without starting from scratch.

6. As a user, I want to update a saved view's filters, sort order, or display configuration, so that I can refine my views over time.

7. As a user, I want paginated results when browsing large entity collections, so that the interface remains responsive and I can navigate through pages.

8. As a user, I want the backend to resolve property values for display (using COALESCE for cross-schema views), so that the frontend can render entities without complex property resolution logic.

9. As a developer, I want entity schema slugs to be immutable after creation, so that saved views referencing those slugs remain valid over time.

10. As a developer, I want built-in entity schema slugs to be reserved, so that custom schemas cannot conflict with system schemas.

11. As a user, I want to filter entities using exact comparisons (eq, ne), so that I can find entities with specific property values.

12. As a user, I want to filter entities using range queries (gt, gte, lt, lte), so that I can find entities within numeric or date ranges.

13. As a user, I want to filter entities by null values (isNull), so that I can find entities with missing properties.

14. As a user, I want to filter entities using array membership (in), so that I can find entities matching any value in a list.

15. As a user, I want filters on schema-specific properties to only apply to entities from that schema, so that cross-schema views work correctly without requiring all schemas to have the same properties.

16. As a user, I want top-level filters (on name, createdAt, updatedAt) to apply to all entities regardless of schema, so that I can filter cross-schema views by universal fields.

17. As a user, I want sort operations to handle null values consistently (nulls last), so that entities with missing sort properties appear at the end of the list.

18. As a user, I want sort operations across different schemas to use COALESCE, so that smartphones sorted by "year" and tablets sorted by "release_year" appear in the same unified ordering.

19. As a user, I want pagination metadata (total count, current page, has next/previous), so that I can navigate through large result sets and understand how much data exists.

20. As a user, I want pagination offsets to be clamped to valid ranges, so that requesting page 1000 of 3 total pages returns an empty result instead of an error.

21. As a user, I want empty property reference arrays in display configurations to resolve to null, so that optional display fields (like subtitleProperty) can be omitted without breaking the query.

22. As a user, I want image fields returned as raw discriminated unions, so that the frontend can use existing utilities to convert S3 keys to URLs or display remote URLs directly.

23. As a user, I want table column properties resolved using index-based keys (column_0, column_1), so that the frontend can render table cells in the correct column order.

24. As a user, I want grid and list properties resolved using semantic keys (imageProperty, titleProperty, subtitleProperty, badgeProperty), so that the frontend can render cards with appropriate styling.

25. As a developer, I want property type introspection from entity schemas, so that filters can apply correct type casting (integer, text, boolean, etc.) in SQL queries.

26. As a developer, I want filter operators to use discriminated unions by operator type, so that the `in` operator requires an array value and `isNull` accepts no value.

27. As a developer, I want the query builder to pre-fetch all entity schemas at the start, so that type introspection doesn't cause N+1 queries during filter building.

28. As a developer, I want the query builder to use Drizzle's SQL template tag, so that queries are parameterized and safe from SQL injection.

29. As a developer, I want filter clauses grouped by schema (AND within schema, OR across schemas), so that cross-schema filters work as expected.

30. As a developer, I want the view-runtime module to be execution-only and never load saved views by ID, so that responsibilities remain clearly separated.

31. As a developer, I want saved-views repository to handle JSONB type casting in one place, so that all callers receive properly typed objects.

32. As a developer, I want clone operations to always append " (Copy)" to the name without smart numbering, so that the behavior is predictable and simple.

33. As a developer, I want clone operations to set `isBuiltin: false` on the cloned view, so that cloned views are always deletable.

34. As a developer, I want PUT semantics (full replacement) instead of PATCH, so that clients must provide complete saved view definitions and there's no merge complexity.

35. As a developer, I want immutable fields (id, isBuiltin, userId, createdAt, updatedAt) to be excluded from the request schema, so that clients cannot modify them.

36. As a developer, I want `GET /saved-views/{viewId}` to return both built-in and user-owned views, so that the frontend can load any view the user has access to.

37. As a developer, I want errors to follow the existing Hono pattern (createNotFoundErrorResult, createValidationErrorResult, successResponse), so that error responses are consistent across the API.

38. As a developer, I want the filter value to throw an error if a referenced property doesn't exist in the schema, so that typos or invalid property references fail fast rather than silently skipping filters.

39. As a developer, I want the sort field to be required in runtime requests, so that there's no ambiguity about result ordering.

40. As a developer, I want zero-result queries to return `totalPages: 0` and `currentPage: 1`, so that pagination metadata remains consistent (pages are always 1-indexed).

41. As a developer, I want the total count query to use a separate CTE instead of a correlated subquery, so that PostgreSQL can optimize the count separately from the paginated results.

42. As a developer, I want reserved slug validation to derive the list from bootstrap manifests, so that there's a single source of truth for built-in schema names.

43. As a developer, I want unit tests for the query builder SQL generation, so that filter, sort, and COALESCE logic can be verified without a database.

44. As a developer, I want integration tests for the full execution flow, so that the complete request/response cycle is tested against a real database.

45. As a developer, I want E2E tests in the `tests/` directory, so that saved-views and view-runtime endpoints can be tested as the user would use them.

46. As a developer, I want schema introspection to be a separate service with pure functions, so that property type lookup can be tested in isolation.

47. As a developer, I want the filter builder to be a distinct module, so that each operator's SQL generation can be unit tested separately.

48. As a developer, I want bootstrap manifests to use hardcoded display configurations in Phase 1, so that implementation can proceed without blocking on schema-aware defaults (even if the configs are broken).

49. As a developer, I want Phase 1 to trust the frontend for validation, so that implementation focuses on core execution rather than comprehensive validation (which is deferred to Phase 2).

50. As a developer, I want the `contains` operator deferred to Phase 2, so that Phase 1 can focus on exact comparisons without the complexity of ILIKE vs JSONB containment.

## Implementation Decisions

### Database Schema Changes

**Add `display_configuration` column to `saved_view` table:**
- Type: `jsonb NOT NULL`
- Structure: `{ layout: "grid" | "list" | "table", grid: {}, list: {}, table: {} }`
- All three layout configurations stored simultaneously
- Migration includes default value for existing rows

**Expand `query_definition` jsonb structure:**
- Current: `{ entitySchemaIds: string[] }` (uses UUIDs)
- New: `{ entitySchemaSlugs: string[], filters: FilterExpression[], sort: SortDefinition }`
- Uses slugs instead of IDs for portability and readability
- Breaking change acceptable (application not in production, wipe and re-bootstrap)

### Saved Views Module Changes

**New endpoints:**
- `GET /saved-views/{viewId}` - Returns built-in and user-owned views
- `PUT /saved-views/{viewId}` - Full replacement (all fields required except immutable ones)
- `POST /saved-views/{viewId}/clone` - Pure copy, no request body, appends " (Copy)" to name

**Repository additions:**
- `getSavedViewByIdForUser(viewId, userId)` - Already exists, no changes needed
- `updateSavedViewByIdForUser(viewId, userId, input)` - New function for PUT
- `cloneSavedViewByIdForUser(viewId, userId)` - New function for clone operation

**Schema updates:**
- `SavedViewQueryDefinition` expands to include `entitySchemaSlugs`, `filters`, `sort`
- `DisplayConfiguration` new schema with discriminated union for layouts
- Request schemas use discriminated unions for filter operators

**Type casting pattern:**
- Maintain existing pattern: `type SavedViewRow = Omit<ListedSavedView, "queryDefinition" | "displayConfiguration"> & { queryDefinition: unknown, displayConfiguration: unknown }`
- Trust database for type correctness (no runtime Zod validation)

### View Runtime Module Changes

**Replace placeholder endpoint with full contract:**
- Current: Accepts `entitySchemaId` (UUID), returns all entities
- New: Accepts `{ entitySchemaSlugs, filters, sort, page, layout, displayConfiguration }`
- Remove built-in schema access restriction (allow both built-in and custom)

**Request schema structure:**
```typescript
{
  entitySchemaSlugs: string[]
  filters: FilterExpression[]
  sort: { field: string[], direction: "asc" | "desc" }
  page: { limit: number, offset: number }
  layout: "grid" | "list" | "table"
  displayConfiguration: GridConfig | ListConfig | TableConfig
}
```

**Filter operator discriminated union:**
- `{ field, op: "isNull", value?: null }` - Null check
- `{ field, op: "in", value: any[] }` - Array membership
- `{ field, op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte", value: any }` - Comparisons

**Response schema structure:**
```typescript
{
  items: Array<{
    id: string
    name: string
    image: ImageSchema | null
    entitySchemaId: string
    entitySchemaSlug: string
    createdAt: Date
    updatedAt: Date
    resolvedProperties: Record<string, any>
  }>
  meta: {
    pagination: {
      total: number
      limit: number
      offset: number
      hasNextPage: boolean
      hasPreviousPage: boolean
      totalPages: number
      currentPage: number
    }
  }
}
```

**Resolved properties format:**
- Grid/list: `{ imageProperty, titleProperty, subtitleProperty, badgeProperty }`
- Table: `{ column_0, column_1, column_2, ... }` (index-based keys)

### Query Builder Architecture

**Module location:** `app-backend/src/modules/view-runtime/query-builder.ts`

**Main function signature:**
```typescript
async function executeViewRuntimeQuery(
  request: ViewRuntimeRequest,
  userId: string
): Promise<ViewRuntimeResponse>
```

**Execution flow:**
1. Pre-fetch all entity schemas by slugs
2. Build schema map for type introspection
3. Validate schema access (both built-in and user-owned)
4. Build filter clauses with type casting
5. Build sort clause with COALESCE
6. Build display config COALESCE resolution
7. Execute query with Drizzle SQL template tag
8. Return results with pagination metadata

**SQL generation approach:**
- Use Drizzle `sql` template tag for parameterized queries
- Generate CTEs: `filtered_entities`, `entity_count`, `sorted_entities`, `paginated_entities`
- COALESCE for cross-schema property resolution
- Explicit `NULLS LAST` for sort clauses
- Type casting based on property introspection

**Filter clause generation:**
- Parse field path: `@name` (top-level) vs `smartphones.year` (schema property)
- Introspect property type: `string`, `integer`, `number`, `boolean`, `date`
- Generate cast: `(properties->>'year')::integer` for integer properties
- Group by schema: AND within schema, OR across schemas

**Sort clause generation:**
- COALESCE across multiple property paths: `COALESCE((properties->>'year')::integer, (properties->>'release_year')::integer)`
- Cast all paths to same type (use text as common denominator if types differ)
- Explicit `NULLS LAST` ordering

**Display config resolution:**
- Empty arrays converted to `[null]` (COALESCE requires at least one argument)
- COALESCE each property reference array
- Return as jsonb object: `jsonb_build_object('imageProperty', COALESCE(...), 'titleProperty', COALESCE(...))`

### Schema Introspection Service

**Module location:** `app-backend/src/modules/view-runtime/schema-introspection.ts`

**Functions:**
```typescript
function getPropertyType(schema: EntitySchema, propertyName: string): PropertyType | null
function buildSchemaMap(schemas: EntitySchema[]): Map<string, EntitySchema>
function parseFieldPath(field: string): { type: "top-level", column: string } | { type: "schema-property", slug: string, property: string }
```

**Property type lookup:**
- Access `schema.propertiesSchema[propertyName]`
- Return `type` field: `"string" | "integer" | "number" | "boolean" | "date" | "array" | "object"`
- Return `null` if property doesn't exist (caller throws validation error)

**Schema map building:**
- Convert array of schemas to Map keyed by slug
- Enables O(1) lookup during filter/sort building

### Reserved Slug Validation

**Module location:** `app-backend/src/modules/entity-schemas/service.ts`

**Function:**
```typescript
function validateSlugNotReserved(slug: string): void
```

**Implementation:**
- Import built-in entity schemas from `authentication/bootstrap/manifests.ts`
- Derive reserved slugs: `builtinEntitySchemas.map(s => s.slug)`
- Throw error if slug matches any reserved slug
- Called during entity schema creation validation

### Bootstrap Updates

**Manifests location:** `app-backend/src/modules/authentication/bootstrap/manifests.ts`

**Hardcoded display configuration:**
```typescript
{
  layout: "grid",
  grid: {
    imageProperty: ["@image"],
    titleProperty: ["@name"],
    subtitleProperty: null,
    badgeProperty: null
  },
  list: {
    imageProperty: ["@image"],
    titleProperty: ["@name"],
    subtitleProperty: null,
    badgeProperty: null
  },
  table: {
    columns: [{ property: ["@name"] }]
  }
}
```

**Applied to all built-in views:**
- "All Books"
- "All Animes"
- "All Mangas"
- "Collections"

**Known issue:** `@image` returns full jsonb object, not URL. This is acceptable for Phase 1. Full bootstrap implementation deferred to Phase 2.

### Validation Strategy

**Phase 1 validation (enforced):**
- Entity schema slugs exist and user has access
- Properties referenced in filters exist in target schemas (throw error if missing)
- Filter operator discriminated union (value type based on operator)
- Sort field is required (non-empty)
- Required fields in request bodies

**Phase 1 validation (trusted):**
- Filter field paths are well-formed (frontend responsibility)
- Property types match operator expectations (frontend responsibility)
- Display configuration property paths are valid (frontend responsibility)

**Phase 2 validation (deferred):**
- Comprehensive property type validation
- Operator-property type compatibility checking
- Property path format validation
- Display configuration property existence checking

### Error Handling

**Use existing Hono patterns:**
- `createNotFoundErrorResult(message)` for 404 errors
- `createValidationErrorResult(message)` for 400 errors
- `successResponse(data)` for 200 responses

**Error scenarios:**
- Schema slug not found: 404 with "Schema '{slug}' not found"
- Property doesn't exist: 400 with "Property '{property}' not found in schema '{slug}'"
- Missing sort field: 400 with "Sort field is required"
- Clone non-existent view: 404 with "Saved view not found"

### Pagination Behavior

**Offset clamping:**
- Calculate `maxOffset = max(0, total - limit)`
- Clamp requested offset: `clampedOffset = min(offset, maxOffset)`
- Use clamped offset for LIMIT/OFFSET query

**Zero results:**
- `totalPages: 0`
- `currentPage: 1` (pages always 1-indexed)
- `hasNextPage: false`
- `hasPreviousPage: false`

**Pagination metadata calculation:**
```typescript
{
  total: entityCount,
  limit: request.page.limit,
  offset: clampedOffset,
  hasNextPage: clampedOffset + limit < total,
  hasPreviousPage: clampedOffset > 0,
  totalPages: total === 0 ? 0 : Math.ceil(total / limit),
  currentPage: Math.floor(clampedOffset / limit) + 1
}
```

### Schema Immutability

**Enforcement:**
- Entity schema slugs are immutable after creation
- No slug update endpoint provided
- Database migration would be required to rename slugs
- Breaking change for all saved views referencing the old slug

**Rationale:**
- Saved views store schema slugs in `queryDefinition.entitySchemaSlugs`
- Changing a slug would invalidate all saved views
- Immutability guarantees saved view stability

### Clone Behavior

**Name transformation:**
- Always append " (Copy)" to the original name
- No smart numbering or duplicate detection
- Example: "My View" → "My View (Copy)" → "My View (Copy) (Copy)"

**Field transformations:**
- `id`: New UUID generated
- `isBuiltin`: Always set to `false` (makes cloned views deletable)
- `userId`: Copied from authenticated user
- `createdAt`, `updatedAt`: Set to current timestamp
- All other fields copied as-is

**No unique constraint on names:**
- Multiple saved views with same name allowed
- User responsible for renaming if desired (via PUT endpoint)

## Testing Decisions

### What Makes a Good Test

**Test external behavior, not implementation details:**
- Test the inputs and outputs of modules
- Test that the SQL query returns correct results, not that it generates specific SQL strings
- Test that filters apply correctly, not that filter builder internal state is correct
- Test that pagination metadata is calculated correctly, not that specific math functions are called

**Test at appropriate boundaries:**
- Unit tests: Pure functions, SQL generation, type introspection
- Integration tests: Database operations, full query execution
- E2E tests: HTTP endpoints, request/response contracts

### Modules to Test

**1. Query Builder (`view-runtime/query-builder.ts`)**

**Unit tests:**
- Filter clause generation for each operator (eq, ne, gt, gte, lt, lte, in, isNull)
- Type casting based on property types (integer, string, boolean, date)
- Schema grouping (AND within schema, OR across schemas)
- Sort clause COALESCE generation
- Display config COALESCE generation
- Empty array handling (convert to `[null]`)

**Integration tests:**
- Full query execution with real database
- Cross-schema queries return correct entities
- Filters apply to correct schemas
- Sort order is correct across schemas
- Pagination returns correct page
- Resolved properties contain correct values

**Prior art:** None (new module), but similar to how entities module tests database queries

**2. Schema Introspection (`view-runtime/schema-introspection.ts`)**

**Unit tests:**
- Property type lookup for various property types
- Property type lookup returns null for non-existent properties
- Schema map building from array of schemas
- Field path parsing (@ prefix vs schema.property format)

**Prior art:** `/apps/app-backend/src/modules/saved-views/service.test.ts` (pure function tests)

**3. Filter Builder (part of query builder)**

**Unit tests:**
- Each operator generates correct SQL clause
- Type casting for integer properties
- Type casting for date properties
- Array operator requires array value
- isNull operator accepts no value
- Top-level filters use column names
- Schema-qualified filters use jsonb extraction

**Prior art:** None (new module)

**4. Saved Views Repository (`saved-views/repository.ts`)**

**Integration tests:**
- `getSavedViewByIdForUser` returns saved view for owner
- `getSavedViewByIdForUser` returns built-in view for any user
- `getSavedViewByIdForUser` returns undefined for non-existent view
- `updateSavedViewByIdForUser` updates all fields
- `updateSavedViewByIdForUser` preserves immutable fields
- `cloneSavedViewByIdForUser` creates new view with " (Copy)" appended
- `cloneSavedViewByIdForUser` sets isBuiltin to false
- JSONB type casting works correctly

**Prior art:** Existing trackers module tests for CRUD operations

**5. Reserved Slug Validator (`entity-schemas/service.ts`)**

**Unit tests:**
- Throws error for built-in schema slugs (book, anime, manga)
- Does not throw for non-reserved slugs
- Derives reserved list from manifests

**Prior art:** `/apps/app-backend/src/modules/saved-views/service.test.ts` (validation tests)

**6. Saved Views Routes (`saved-views/routes.ts`)**

**E2E tests (in `tests/` directory):**
- `GET /saved-views/{viewId}` returns 200 for existing view
- `GET /saved-views/{viewId}` returns 404 for non-existent view
- `PUT /saved-views/{viewId}` updates view successfully
- `PUT /saved-views/{viewId}` returns 404 for non-existent view
- `PUT /saved-views/{viewId}` preserves immutable fields (id, isBuiltin)
- `POST /saved-views/{viewId}/clone` creates copy with " (Copy)" appended
- `POST /saved-views/{viewId}/clone` sets isBuiltin to false

**Prior art:** `/tests/src/tests/health.test.ts` (E2E pattern with OpenAPI client)

**7. View Runtime Routes (`view-runtime/routes.ts`)**

**E2E tests (in `tests/` directory):**
- `POST /view-runtime/execute` returns entities for simple query
- `POST /view-runtime/execute` applies filters correctly
- `POST /view-runtime/execute` sorts entities correctly
- `POST /view-runtime/execute` paginates results
- `POST /view-runtime/execute` resolves properties for grid layout
- `POST /view-runtime/execute` resolves properties for table layout
- `POST /view-runtime/execute` returns 404 for non-existent schema
- `POST /view-runtime/execute` returns 400 for missing sort field
- Cross-schema query returns entities from multiple schemas

**Prior art:** `/tests/src/tests/health.test.ts` (E2E pattern with OpenAPI client)

### E2E Test Setup

**Location:** `/tests/src/tests/`

**Scaffolding already complete:**
- Testcontainers for PostgreSQL and Redis
- Backend process spawning with test environment
- OpenAPI fetch client for type-safe requests
- Health check example test

**Test pattern:**
```typescript
import { describe, expect, it } from "bun:test";
import { getBackendClient } from "../setup";

describe("View Runtime", () => {
  it("should execute simple query", async () => {
    const client = getBackendClient();
    const { data, response } = await client.POST("/view-runtime/execute", {
      body: { /* runtime request */ }
    });

    expect(response.status).toBe(200);
    expect(data?.items).toHaveLength(5);
  });
});
```

### Test Coverage Goals

**Unit tests:**
- 100% coverage for schema introspection service
- 100% coverage for reserved slug validator
- High coverage for filter builder (all operators)
- High coverage for query builder SQL generation

**Integration tests:**
- All query builder execution paths
- All saved views repository functions
- Correct behavior for both built-in and custom schemas

**E2E tests:**
- All new saved-views endpoints (GET /{id}, PUT /{id}, POST /{id}/clone)
- All view-runtime request variations (filters, sorts, layouts)
- Error cases (404, 400) for both modules

## Out of Scope

The following features are intentionally excluded from Phase 1 to keep scope tight and deliver a working foundation quickly:

**Event Integration:**
- Event-based filtering (e.g., "movies I rated >8", "shows watched in 2024")
- Event summary fields in responses (lastEventDate, eventCount, averageRating)
- Joining to events table in view-runtime queries
- Deferred to Phase 2

**Advanced Filter Logic:**
- Compound filters with explicit OR logic within a schema
- Nested boolean filter groups (and/or combinations)
- Phase 1 uses flat array (AND within schema, OR across schemas)
- Deferred to Phase 2

**Additional Filter Operators:**
- `contains` operator (string substring or JSONB containment)
- `notIn` operator (inverse of `in`)
- `notContains` operator (string negation)
- `between` operator (range query syntactic sugar)
- `regex` operator (pattern matching)
- `isEmpty` / `isNotEmpty` operators (for arrays/objects)
- Deferred to Phase 2

**Relationship Querying:**
- Query entities based on relationships to other entities
- Collection browsing ("show all books in my 'Favorites' collection")
- People-to-media connections ("movies starring Tom Hanks")
- Relationship property filtering
- Deferred to Phase 2

**Schema-Aware Validation:**
- Backend validation of filter property existence
- Backend validation of operator-property type compatibility
- Backend validation of filter values matching property types
- Phase 1 trusts frontend to send valid requests
- Deferred to Phase 2

**Performance Optimization:**
- Expression indexes for frequently filtered properties
- Query plan analysis and optimization
- Caching strategies for schema maps
- Deferred to Phase 2

**Schema-Aware Bootstrap:**
- Intelligent default display configurations based on entity schema properties
- Automatic property selection for grid/list/table layouts
- Phase 1 uses hardcoded configs (which may be broken)
- Deferred to Phase 2

**Frontend Implementation:**
- Query builder UI for constructing filters
- View editor UI for saved views
- Layout switcher UI
- Property selector UI
- Out of scope for backend PRD

**Migration Strategy:**
- Migrating existing saved views to new structure
- Not required (application not in production, wipe and re-bootstrap)

## Further Notes

### Why Phase 1 Bootstrap Configs Are Broken

The hardcoded display configuration uses `imageProperty: ["@image"]`. This returns the full ImageSchema discriminated union object `{ kind: "s3", key: "..." }` instead of a URL string. The frontend expects URLs for image rendering. This is acceptable because:

1. Phase 1 focuses on execution engine foundation
2. Built-in views will be completely rebuilt in Phase 2 with schema-aware defaults
3. Custom views created by users will have correct property references
4. Breaking built-in views temporarily is acceptable in a non-production app

### Why Sort Is Required

There is no default sort behavior because:

1. Natural database order is non-deterministic
2. Different use cases want different orderings (created_at, name, schema properties)
3. Requiring explicit sort eliminates ambiguity
4. Frontend can always default to `sort: { field: ["@name"], direction: "asc" }` if no preference

### Why Slugs Instead of IDs

Entity schema references use slugs instead of UUIDs in query definitions because:

1. **Portability**: Saved views can be exported/imported between environments
2. **Readability**: `smartphones.manufacturer` is self-documenting
3. **Debuggability**: Inspecting saved views doesn't require ID lookups
4. **Stability**: Built-in schemas (movies, books) have consistent slugs across installations

The tradeoff is a slug→ID resolution step at runtime, but this happens once per query (pre-fetched schemas) and the benefits outweigh the cost.

### Why PUT Instead of PATCH

PUT (full replacement) is used instead of PATCH (partial update) because:

1. Simpler implementation (no merge logic required)
2. Clearer semantics (client must provide complete view definition)
3. Avoids complex nested merge questions (how deep does merge go?)
4. Consistent with saved view creation (both require full definition)

Clients can implement PATCH-like behavior by fetching the view, modifying fields, and sending full definition to PUT.

### Why Empty Arrays Convert to [null]

PostgreSQL COALESCE requires at least one argument. Empty property reference arrays like `subtitleProperty: []` must be converted to `COALESCE(NULL)` to generate valid SQL. The alternative (omitting the property entirely from SQL) would require conditional SQL generation and complicate the resolved properties structure.

### Why Table Uses Index-Based Keys

Table columns use index-based keys (`column_0`, `column_1`) instead of semantic names because:

1. Tables have variable numbers of columns (no fixed schema)
2. Each column can have different property references
3. Frontend needs to preserve column order from request
4. Index-based keys enable simple iteration: `columns.map((col, i) => resolvedProperties[`column_${i}`])`

### Why Zero Pages Is Zero, Not One

Empty result sets return `totalPages: 0` instead of `1` because:

1. Mathematically correct: zero items / pageSize = 0 pages
2. Consistent with pagination math: `Math.ceil(0 / 20) = 0`
3. Distinguishes "no results" from "one empty page"
4. `currentPage: 1` is maintained for consistency (pages always 1-indexed)

### Next Steps After Phase 1

After Phase 1 implementation is complete, the following work can begin:

1. **Phase 2: Built-in View Bootstrap** - Replace hardcoded configs with schema-aware defaults
2. **Phase 2: Event Integration** - Add event-based filtering and event summary fields
3. **Phase 2: Relationship Querying** - Enable collection browsing and people-to-media connections
4. **Phase 2: Advanced Filters** - Add `contains`, compound logic, additional operators
5. **Phase 2: Validation** - Add comprehensive backend validation for robustness
6. **Frontend: Query Builder UI** - Build user interface for constructing filters and views
7. **Frontend: View Editor UI** - Build user interface for editing saved views
8. **Performance: Optimization** - Add expression indexes, query plan analysis, caching

---

## Tasks

**Overall Progress:** 1 of 9 tasks completed

**Current Task:** [Task 02](./02-get-saved-view-by-id.md) (todo)

### Task List

| #   | Task                                                                                                         | Type | Status | Blocked By               |
| --- | ------------------------------------------------------------------------------------------------------------ | ---- | ------ | ------------------------ |
| 01  | [Saved Views Data Model & Bootstrap Update](./01-saved-views-data-model-bootstrap.md)                        | AFK  | done   | None                     |
| 02  | [GET Saved View by ID](./02-get-saved-view-by-id.md)                                                         | AFK  | todo   | Task 01                  |
| 03  | [PUT Saved View (Full Replacement)](./03-put-saved-view.md)                                                  | AFK  | todo   | Task 01                  |
| 04  | [Clone Saved View](./04-clone-saved-view.md)                                                                 | AFK  | todo   | Task 01                  |
| 05  | [Reserved Slug Validation](./05-reserved-slug-validation.md)                                                 | AFK  | todo   | Task 01                  |
| 06  | [View Runtime: Schema Introspection + Single-Schema Execution](./06-view-runtime-single-schema-execution.md) | AFK  | todo   | Task 01                  |
| 07  | [View Runtime: Filter Execution](./07-view-runtime-filter-execution.md)                                      | AFK  | todo   | Task 06                  |
| 08  | [View Runtime: Cross-Schema COALESCE](./08-view-runtime-cross-schema-coalesce.md)                            | AFK  | todo   | Task 06                  |
| 09  | [Comprehensive E2E Test Suite](./09-comprehensive-e2e-test-suite.md)                                         | AFK  | todo   | Tasks 02, 03, 04, 07, 08 |
