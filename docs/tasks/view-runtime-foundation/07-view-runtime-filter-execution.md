# View Runtime: Filter Execution

**Parent Plan:** [View Runtime Foundation](./README.md)

**Type:** AFK

**Status:** done

## What to build

Add filter execution to the view-runtime query builder. This implements all Phase 1 filter operators with type casting, supports both top-level and schema-qualified filters, and groups filters correctly for cross-schema queries.

The end-to-end behavior: a client sends `POST /view-runtime/execute` with a `filters` array containing filter expressions. The runtime applies these filters to the SQL query, returning only matching entities. Schema-qualified filters only apply to entities from that schema. Top-level filters apply to all entities.

### Filter Builder Module

Add filter building logic to `apps/app-backend/src/modules/view-runtime/query-builder.ts` (or a separate filter-builder file if it improves testability):

**Operators (all Phase 1 operators):**
- `eq` - exact equality
- `ne` - not equal
- `gt` - greater than
- `gte` - greater than or equal
- `lt` - less than
- `lte` - less than or equal
- `in` - array membership (value must be array)
- `isNull` - null check (no value)

See PRD section "Filter operator discriminated union."

**Type casting:**
- Introspect property type from entity schema's propertiesSchema
- Cast extracted jsonb values: `(properties->>'year')::integer` for integer properties
- Supported type casts: string (text), integer, number (numeric), boolean, date
- See PRD section "Query Builder Architecture > Filter clause generation"

**Field path handling:**
- Top-level filters (`@name`, `@createdAt`, `@updatedAt`): use column names directly, apply to ALL entities
- Schema-qualified filters (`smartphones.year`): use `properties->>'year'` with type cast, apply only to matching schema
- `@image` not supported for filtering (complex discriminated union)
- See PRD section "Schema-Qualified Property Syntax"

**Schema grouping:**
- Filters grouped by schema slug
- AND within each schema group
- OR across schema groups
- Schemas with no filters include all their entities unconditionally
- See PRD section "Query Builder Architecture > Filter clause generation" and the SQL example

**Property existence validation:**
- If a filter references a property that doesn't exist in the target schema, throw a 400 error
- Error message: "Property '{property}' not found in schema '{slug}'"
- See PRD section "Error Handling > Error scenarios"

### Unit Tests

Test each operator with type casting:
- `eq` with string property → `properties->>'manufacturer' = 'Apple'`
- `eq` with integer property → `(properties->>'year')::integer = 2023`
- `ne`, `gt`, `gte`, `lt`, `lte` generate correct comparison operators
- `in` with array value → `properties->>'os' IN ('Android', 'iOS')`
- `isNull` → `properties->>'field' IS NULL`
- Top-level `@name` filter uses column name directly
- Top-level `@createdAt` filter uses column name directly
- Schema-qualified filter uses jsonb extraction with type cast
- Schema grouping: AND within schema, OR across schemas
- Property not found throws validation error

### Integration Tests

- Single filter (eq) returns correct subset
- Multiple filters on same schema (AND behavior)
- Filters on different schemas (OR across schemas, AND within)
- Top-level filter `@name` applies to all entities
- Integer property filter with type casting
- `in` operator with array of values
- `isNull` finds entities with null properties
- Non-existent property returns 400 error
- Empty filters array returns all entities (no filtering)

## Acceptance criteria

- [ ] All 8 filter operators implemented: eq, ne, gt, gte, lt, lte, in, isNull
- [ ] Type casting based on property type introspection (string, integer, number, boolean, date)
- [ ] Top-level filters (`@name`, `@createdAt`, `@updatedAt`) apply to all entities
- [ ] Schema-qualified filters apply only to matching schema's entities
- [ ] Schema grouping: AND within schema, OR across schemas
- [ ] Schemas with no filters include all entities unconditionally
- [ ] Non-existent property in filter throws 400 error with descriptive message
- [ ] `in` operator requires array value
- [ ] `isNull` operator accepts no value
- [ ] All SQL is parameterized via Drizzle `sql` template tag (no SQL injection)
- [ ] Unit tests cover all operators and type casting combinations
- [ ] Integration tests cover single-schema and multi-schema filter scenarios
- [ ] `turbo check` passes

## Blocked by

- [Task 06](./06-view-runtime-single-schema-execution.md)

## User stories addressed

- User story 3 (filter by schema-defined properties)
- User story 11 (exact comparisons: eq, ne)
- User story 12 (range queries: gt, gte, lt, lte)
- User story 13 (null value filtering: isNull)
- User story 14 (array membership: in)
- User story 15 (schema-specific filters only apply to that schema)
- User story 16 (top-level filters apply to all entities)
- User story 26 (discriminated union for filter operators)
- User story 29 (filter grouping: AND within schema, OR across schemas)
- User story 38 (throw error for non-existent property)
- User story 47 (filter builder as distinct module)
