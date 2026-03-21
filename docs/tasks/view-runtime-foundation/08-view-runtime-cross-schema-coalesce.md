# View Runtime: Cross-Schema COALESCE (Sort + Display + Table)

**Parent Plan:** [View Runtime Foundation](./README.md)

**Type:** AFK

**Status:** done

## What to build

Add cross-schema support to the view-runtime query builder. This implements COALESCE for sort clauses that span multiple schemas, COALESCE for display configuration property references, self-describing grid/list values, table metadata plus ordered cells, and empty array handling.

The end-to-end behavior: a client sends `POST /view-runtime/execute` with multiple `entitySchemaSlugs`, sort fields spanning different schemas (e.g., `["smartphones.year", "tablets.release_year"]`), and display configuration property references that map different property names across schemas. The runtime uses COALESCE to unify sorting and display resolution, returning entities from multiple schemas in a single, correctly ordered result set.

### Sort COALESCE

Extend the query builder sort logic:
- Sort field is an array of schema-qualified property paths
- Single-schema sort: `["smartphones.year"]` → `(properties->>'year')::integer`
- Cross-schema sort: `["smartphones.year", "tablets.release_year"]` → `COALESCE((properties->>'year')::integer, (properties->>'release_year')::integer)`
- Cast all paths to same type (use text as common denominator if types differ across schemas)
- Explicit `NULLS LAST` ordering
- See PRD section "Query Builder Architecture > Sort clause generation"

### Display Config COALESCE

Extend display configuration resolution:
- Each property reference is an array of schema-qualified paths
- Resolve using COALESCE: first non-null value wins
- Grid/list: semantic keys (imageProperty, titleProperty, subtitleProperty, badgeProperty), each returning `{ value, kind }`
- Table: `meta.table.columns` provides `{ key, label }`, and each item returns ordered `cells`
- `@name` resolves to top-level `name` column, `@image` resolves to top-level `image` column
- If `@image` is null, it must behave like SQL NULL so later fallback references can win
- Return as `jsonb_build_object(...)` in SQL
- See PRD sections "Display Config Resolution" and "Display Configuration Property References"

### Empty Array Handling

- Empty property reference arrays (e.g., `subtitleProperty: []`) are converted to `COALESCE(NULL)` → returns NULL
- This ensures valid SQL generation since PostgreSQL COALESCE requires at least one argument
- See PRD section "Why Empty Arrays Convert to [null]"

### Table Layout Metadata + Cells

- Saved-view table columns require labels
- Runtime metadata returns ordered columns as `{ key, label }`
- Runtime items return ordered `cells: Array<{ key, value, kind }>`
- Keys can still be derived from column position (`column_0`, `column_1`, ...) but the renderer no longer has to reconstruct them
- See PRD section "Table Column Resolution"

### Integration Tests

- Cross-schema query returns entities from both schemas
- Sort COALESCE orders entities correctly across schemas (e.g., smartphones by `year` and tablets by `release_year` in unified ordering)
- NULLS LAST: entities with null sort properties appear at end
- Display config COALESCE resolves different property names per schema (smartphone gets `manufacturer`, tablet gets `maker`)
- Table layout returns metadata plus ordered cells
- Empty property reference array resolves to `{ value: null, kind: "null" }` for grid/list and `cells[*]` for table
- Single-schema query with table layout works correctly
- Cross-schema query with grid layout works correctly
- Verify the SQL pattern matches the "Complete SQL Query Example" from the PRD

## Acceptance criteria

- [ ] Sort field accepts array of schema-qualified paths
- [ ] Cross-schema sort uses COALESCE across different property names
- [ ] Sort uses `NULLS LAST` ordering
- [ ] Type casting in sort: paths cast to same type (text as common denominator if types differ)
- [ ] Display config COALESCE resolves each property reference array to first non-null value
- [ ] Grid/list resolvedProperties use semantic keys with `{ value, kind }`
- [ ] Table responses expose `meta.table.columns` and ordered `cells`
- [ ] `@name` and `@image` in display config resolve to top-level columns
- [ ] Null top-level images do not short-circuit later display fallbacks
- [ ] Empty property reference arrays resolve to null
- [ ] Cross-schema queries return entities from all requested schemas
- [ ] Integration tests cover cross-schema sort, display, table, and empty array cases
- [ ] `turbo check` passes

## Blocked by

- [Task 06](./06-view-runtime-single-schema-execution.md)

## User stories addressed

- User story 2 (query multiple entity schemas simultaneously)
- User story 4 (sort across schemas with different property names)
- User story 17 (null values handled consistently, nulls last)
- User story 18 (COALESCE for cross-schema sorting)
- User story 21 (empty property arrays resolve to null)
- User story 23 (table metadata and ordered cells)
