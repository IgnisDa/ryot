# View Runtime Plan

## Purpose

This document describes the backend plan for making saved views the universal browsing primitive in Ryot.

The core idea is to split responsibilities clearly:

- `saved-views` stores saved view metadata and definitions
- `view-runtime` executes a compiled view query against the database
- frontend routes fetch a saved view, compile it to a runtime request, and execute it through `view-runtime`

This keeps persistence and execution separate while allowing the runtime layer to evolve without coupling it to saved-view CRUD.

## Target Product Flow

The intended flow for `/views/$viewId` is:

1. Load the saved view by id.
2. Compile the saved view definition into a runtime query payload.
3. Send that payload to `POST /view-runtime/execute`.
4. Render the returned result set, metadata, and pagination state.

The frontend route should no longer depend on tracker-scoped routing like `/$trackerSlug/views/$viewId`.

## Module Responsibilities

### Saved Views Module

The `saved-views` module remains the source of truth for persisted view records.

It is responsible for:

- storing view name, icon, accent color, tracker association, and built-in status
- storing the saved query definition and presentation defaults
- enforcing built-in protection rules
- exposing CRUD and clone operations

It is not responsible for executing database queries.

### View Runtime Module

The `view-runtime` module should be execution-only.

It is responsible for:

- accepting a compiled runtime payload
- validating access to referenced entity schemas for the authenticated user
- translating runtime filters, sort, and pagination into database queries
- returning normalized result rows plus runtime metadata

It should not load saved views by id or own saved-view persistence rules.

## Runtime Contract

The current `view-runtime` route is only a placeholder. It accepts one `entitySchemaId` and returns every entity in that schema. That is not sufficient for the saved-view renderer.

The runtime request should grow into a compiled contract that can support both built-in and custom views.

Suggested request shape:

- `scope: string[]` — which schemas to query (using schema slugs, e.g., `["smartphones", "tablets"]`)
- `filters: FilterExpression[]` — flat array of filters (AND within each schema, OR across schema boundaries; compound nested logic in Phase 2)
- `sort: { fields: string[], direction: "asc" | "desc" }` — how to order results (fields is an array for COALESCE across schemas)
- `pagination: { page: number, limit: number }` — pagination parameters
- `displayConfiguration: object` — active layout configuration with property reference arrays; the backend derives which jsonb properties to extract from these arrays and performs COALESCE resolution

Each filter in the `filters` array has the shape:

- `field: string` — property path using the schema-qualified syntax (see "Schema-Qualified Property Syntax" section)
- `op: string` — operator: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in`, `isNull`
- `value: any` — the value to compare against (type depends on the property being filtered)

**Note**: The `contains` operator is deferred to Phase 2 due to complexity with JSONB array/object containment vs string substring matching. Phase 1 focuses on exact comparisons, range queries, and null checks.

The `sort.fields` is an array of schema-qualified property paths:

- Single-schema: `["smartphones.year"]`
- Cross-schema: `["smartphones.year", "tablets.release_year"]` — resolved via COALESCE
- Top-level columns: `["@name"]`

Suggested response shape:

- `items: []`
- `meta: { pagination: {}, table?: { columns: [] } }` — pagination metadata plus optional table column metadata

Pagination metadata includes:

- `page: number` — requested page number (1-indexed)
- `total: number` — total number of entities matching the query
- `limit: number` — page size
- `hasNextPage: boolean` — whether there are more pages
- `hasPreviousPage: boolean` — whether there are previous pages
- `totalPages: number` — total number of pages

Each item should include at least:

- `id` — entity primary key
- `name` — entity name (top-level column)
- `image` — entity image object (top-level column, uses ImageSchema discriminated union: `{ kind: "remote", url: "..." }` or `{ kind: "s3", key: "..." }` or `null`)
- `entitySchemaId` — the UUID foreign key to the entity schema
- `entitySchemaSlug` — the human-readable schema slug (e.g., "smartphones", "movies")
- `resolvedProperties` — for grid/list layouts, COALESCE-resolved semantic slots where each value is self-describing: `{ value, kind }`
- `cells` — for table layouts, ordered cells shaped as `{ key, value, kind }`
- `createdAt` — entity creation timestamp
- `updatedAt` — entity update timestamp

**Note**: Event-related fields (lastEventDate, eventCount, averageRating) are intentionally excluded from Phase 1. These will be added in Phase 2 alongside event-based filtering capabilities.

**Resolved properties structure:**

For grid/list layouts, the `resolvedProperties` object contains the resolved values for each displayConfiguration property reference, keyed by the property role. Each slot is self-describing so the frontend does not have to infer types.

```json
{
	"id": "entity-123",
	"name": "iPhone 15 Pro",
	"image": { "kind": "s3", "key": "uploads/abc123.jpg" },
	"entitySchemaId": "c3f8a9b2-...",
	"entitySchemaSlug": "smartphones",
	"createdAt": "2024-09-15T10:30:00Z",
	"updatedAt": "2024-12-01T14:22:00Z",
	"resolvedProperties": {
		"imageProperty": {
			"value": { "kind": "s3", "key": "uploads/abc123.jpg" },
			"kind": "image"
		},
		"titleProperty": { "value": "iPhone 15 Pro", "kind": "text" },
		"subtitleProperty": { "value": "Apple", "kind": "text" },
		"badgeProperty": { "value": 999, "kind": "number" }
	}
}
```

This eliminates the need for frontend COALESCE logic and makes rendering trivial — the frontend just renders semantic slots directly and uses `kind` to choose the right renderer.

The runtime contract should stay generic enough that the frontend can compile both built-in curated views and user-authored saved views into the same payload.

### Runtime Request Discriminated Union

The runtime request uses a discriminated union for display configuration with the layout as a separate top-level discriminant:

```typescript
{
  scope: string[]
  filters: FilterExpression[]
  sort: SortDefinition
  pagination: PaginationParams
  layout: "grid" | "list" | "table"
  displayConfiguration: GridDisplayConfig | ListDisplayConfig | TableDisplayConfig
}
```

Where:

```typescript
type GridDisplayConfig = {
	imageProperty?: string[];
	titleProperty?: string[];
	subtitleProperty?: string[];
	badgeProperty?: string[] | null;
};

type ListDisplayConfig = {
	imageProperty?: string[];
	titleProperty?: string[];
	subtitleProperty?: string[];
	badgeProperty?: string[] | null;
};

type TableDisplayConfig = {
	columns: Array<{ label: string; property: string[] }>;
};
```

The `layout` field determines which display config type is present in `displayConfiguration`.

### Filter Value Discriminated Union

Filter expressions use a discriminated union by operator to validate value types:

```typescript
type FilterExpression =
	| { field: string; op: "isNull"; value?: null }
	| { field: string; op: "in"; value: any[] }
	| { field: string; op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte"; value: any };
```

The `isNull` operator accepts no value or null. The `in` operator requires an array. Other operators accept single values.

### Table Column Resolution

For table layouts, saved views carry explicit column labels and the runtime response includes column metadata plus ordered cells:

```typescript
{
  "meta": {
    "table": {
      "columns": [
        { "key": "column_0", "label": "Name" },
        { "key": "column_1", "label": "Manufacturer" },
        { "key": "column_2", "label": "Year" }
      ]
    }
  },
  "items": [{
    "cells": [
      { "key": "column_0", "value": "iPhone 15 Pro", "kind": "text" },
      { "key": "column_1", "value": "Apple", "kind": "text" },
      { "key": "column_2", "value": 2023, "kind": "number" }
    ]
  }]
}
```

The key still corresponds to the column's position in the `columns` array, but the frontend can now render table headers and cells directly without reconstructing labels or lookup keys dynamically.

### Schema-Qualified Property Syntax

To support cross-schema views where different entity schemas have different property names, the runtime contract uses a **unified schema-qualified property path syntax** across all features.

**Two path formats:**

1. **Top-level columns**: `@name`, `@createdAt`, `@updatedAt`
   - Prefix: `@`
   - References database columns that exist on all entities
   - Used in filters, sorts, and displayConfiguration
   - **Note**: `@image` is not supported for filtering due to its complex discriminated union structure (ImageSchema)

2. **Schema-qualified properties**: `smartphones.manufacturer`, `tablets.maker`
   - Format: `<schema-slug>.<property>` (uses entity schema slugs, not IDs)
   - References properties in the entity's `properties` jsonb column
   - **Required for all entity schema properties** — no unqualified references allowed
   - Schema slugs are stable identifiers (e.g., "smartphones", "movies", "whiskeys")
   - Used in filters, sorts, and displayConfiguration

**No unqualified properties:**

All entity schema properties MUST be schema-qualified. This eliminates ambiguity and forces clients to be explicit about which schema's property they are referencing. For cross-schema views, clients must explicitly specify which schemas to filter/sort by.

**Why slugs instead of IDs?**

Schema references use slugs rather than database IDs for several critical reasons:

- **Readability**: `smartphones.manufacturer` is self-documenting vs `c3f8a9b2.manufacturer`
- **Portability**: Saved views can be exported/imported between environments (slugs are stable, IDs differ)
- **Debuggability**: Inspecting saved views doesn't require constant ID lookups
- **Built-in schemas**: System schemas like "movies" have consistent slugs across all installations
- **Query builder UX**: UI can work directly with human-readable slugs
- **SQL simplicity**: Queries can filter directly on `entity_schemas.slug` without ID resolution

Schema slugs are treated as stable identifiers. Changing a schema's slug is a breaking change that would invalidate all saved views referencing it. The `entity_schemas` table has a unique constraint on `slug` for efficient querying.

**Why this syntax?**

Cross-schema views query multiple entity schemas simultaneously (e.g., "smartphones" and "tablets"). Different schemas often use different property names for conceptually similar data:

- Smartphones have `product_image`, tablets have `device_image`
- Movies have `director`, TV shows have `showrunner`
- Books have `author`, podcasts have `host`

Schema-qualified paths enable:

- **Filters**: Target specific schemas or apply broadly across schemas
- **Sorts**: COALESCE across different property names for unified ordering
- **Display**: COALESCE to gracefully handle schema differences in UI rendering
- **Clarity**: Explicit about which schema's property is being referenced

**Consistency across features:**

This syntax is used uniformly in:

- `filters[].field` — filter by entity properties
- `sort.fields` — array of paths for COALESCE ordering
- `displayConfiguration.*Property` — arrays of paths for COALESCE rendering
- `eventConditions[].field` (Phase 2) — filter by event properties
- `relationships[].propertyFilters[].field` (Phase 2) — filter by relationship properties

**Examples:**

Single-schema view:

```json
{
	"filters": [
		{ "field": "smartphones.manufacturer", "op": "eq", "value": "Apple" },
		{ "field": "smartphones.year", "op": "gte", "value": 2020 }
	],
	"sort": {
		"fields": ["smartphones.year"],
		"direction": "desc"
	},
	"displayConfiguration": {
		"imageProperty": ["smartphones.product_image"],
		"titleProperty": ["@name"],
		"subtitleProperty": ["smartphones.manufacturer", "smartphones.year"]
	}
}
```

Cross-schema view:

```json
{
	"filters": [
		{ "field": "smartphones.year", "op": "gte", "value": 2020 },
		{ "field": "tablets.release_year", "op": "gte", "value": 2020 }
	],
	"sort": {
		"fields": ["smartphones.year", "tablets.release_year"],
		"direction": "desc"
	},
	"displayConfiguration": {
		"imageProperty": ["smartphones.product_image", "tablets.device_image"],
		"titleProperty": ["@name"],
		"subtitleProperty": ["smartphones.manufacturer", "tablets.maker"]
	}
}
```

### Entity Structure: Top-Level vs Properties

Entities have a hybrid structure with both top-level database columns and schema-defined properties stored in jsonb:

**Top-level columns (infrastructure + universal fields):**

- `id` — entity primary key
- `name` — required text column, universally present on all entities
- `image` — optional jsonb column storing ImageSchema discriminated union (`{ kind: "remote", url: "..." }` or `{ kind: "s3", key: "..." }`)
- `entitySchemaId` — foreign key to entity schema
- `createdAt`, `updatedAt` — timestamps
- `externalId` — optional external source identifier
- `searchVector` — tsvector for full-text search

**Properties (schema-defined properties):**

- All other entity properties defined in the entity schema's AppSchema are stored in the `properties` jsonb column

**Why keep name and image as top-level columns?**

1. **Performance**: Name is accessed on every entity display — search results, collection items, relationship references, activity logs, grid/list views. Querying and sorting by a top-level indexed column is significantly faster than jsonb extraction.

2. **Full-text search**: The `searchVector` generated column depends on `name` being a top-level field for efficient tsvector indexing. Extracting name from jsonb for search indexing would require triggers and complex generated column logic.

3. **Database integrity**: Top-level columns can enforce `NOT NULL` constraints at the database level. Name is fundamental to entity identity and should be guaranteed by database structure, not just application-level validation.

4. **API clarity**: Every entity always has a displayable name. This is a fundamental system guarantee. Keeping it top-level makes this contract explicit in the API response structure.

5. **Relationship display cost**: Displaying relationships (cast lists, collection memberships, related entities) requires fetching names constantly. Direct column access is substantially faster than jsonb extraction at scale.

**Filter and sort handling**: The view-runtime query builder handles this hybrid structure transparently using the schema-qualified property syntax (see "Schema-Qualified Property Syntax" section). The `@` prefix routes to top-level columns; schema-qualified paths route to `properties` jsonb extraction.

### Display Configuration Property References

Display configurations use the schema-qualified property syntax with one key addition: each property reference is an **array** of paths. The backend resolves each array using COALESCE, returning the first non-null value. This enables cross-schema views where different schemas use different property names for conceptually similar data.

**Property reference format:**

```json
{
	"imageProperty": ["smartphones.product_image", "tablets.device_image"],
	"titleProperty": ["@name"],
	"subtitleProperty": [
		"smartphones.manufacturer",
		"tablets.maker",
		"smartphones.year",
		"tablets.release_year"
	],
	"badgeProperty": ["smartphones.price_usd", "tablets.retail_price"]
}
```

All property references are flat arrays of schema-qualified paths. The backend resolves each using COALESCE to return the first non-null value. Each resolved property is a single value, not a concatenation — for example, `subtitleProperty: ["smartphones.manufacturer", "smartphones.year"]` returns the manufacturer if present, falling back to year only if manufacturer is null.

Even for single-schema views, the array format is required for consistency:

```json
{
	"imageProperty": ["smartphones.product_image"],
	"titleProperty": ["@name"],
	"subtitleProperty": ["smartphones.manufacturer", "smartphones.year"]
}
```

## Saved View Data Model Changes

The current saved-view definition only stores:

- `scope: string[]`

That is too small for the saved-view renderer that was designed. A saved view needs to store both query semantics and presentation configuration.

The saved view schema should include:

- `name: string` — view name
- `icon?: string` — optional icon identifier
- `accentColor?: string` — optional accent color
- `trackerId?: string` — optional tracker FK for UI/sidebar placement hint (nullable, used for single-tracker views)
- `isBuiltin: boolean` — whether this is a built-in protected view
- `queryDefinition: jsonb` — the data query (required)
- `displayConfiguration: jsonb` — the presentation config (required)

**Note on `trackerId`**: This field is purely for UI organization and determines which tracker's sidebar section should display the saved view. It is **not** the source of truth for query scope — the actual schemas/trackers being queried are stored within `queryDefinition.scope`. For cross-tracker views querying multiple schemas, `trackerId` may be null or point to the primary tracker for sidebar placement purposes. The frontend sidebar rendering logic may also examine `queryDefinition` directly to determine appropriate placement when `trackerId` is null.

The `queryDefinition` column stores:

- `scope: string[]` — which schemas to query
- `filters: FilterExpression[]` — flat array of filters using the schema-qualified property syntax (see "Runtime Contract" for AND/OR semantics)
- `sort: { fields: string[], direction: "asc" | "desc" }` — ordering

Event-based filtering (e.g., "movies I rated >8", "shows watched in 2024") is deferred to Phase 2 and will be added as an `eventConditions` field once event integration is implemented in the runtime.

The `displayConfiguration` column stores:

- `grid: {}` — grid layout configuration
- `list: {}` — list layout configuration
- `table: {}` — table layout configuration

All three layout configurations are stored simultaneously so users can switch between layouts in the frontend without losing their configuration. Each layout specifies which entity properties to display using schema-qualified property paths (see "Display Configuration Property References" section).

The active layout for a given view is stored in the browser's `localStorage`, keyed per user per view (e.g., `view-layout:<viewId>`). On first load, the frontend defaults to `"grid"` if no entry exists.

This separation keeps query logic distinct from presentation concerns while allowing the saved-view record to align with product behavior without making `view-runtime` own persistence concerns.

## Concrete Example

Consider a "Smartphones" entity schema with properties:

```json
{
	"manufacturer": { "type": "string", "label": "Manufacturer", "required": true },
	"year": { "type": "integer", "label": "Year" },
	"os": { "type": "string", "label": "OS" },
	"screen_size": { "type": "number", "label": "Screen Size" },
	"storage_gb": { "type": "integer", "label": "Storage (GB)" },
	"ram_gb": { "type": "integer", "label": "RAM (GB)" },
	"price_usd": { "type": "number", "label": "Price (USD)" }
}
```

### View 1: Recent Samsung Phones

```json
{
	"name": "Recent Samsung Phones",
	"trackerId": "smartphones-tracker-id",
	"isBuiltin": false,
	"queryDefinition": {
		"scope": ["smartphones"],
		"filters": [
			{ "field": "smartphones.manufacturer", "op": "eq", "value": "Samsung" },
			{ "field": "smartphones.year", "op": "lt", "value": 2025 }
		],
		"sort": { "fields": ["smartphones.year"], "direction": "desc" }
	},
	"displayConfiguration": {
		"grid": {
			"imageProperty": ["smartphones.product_image"],
			"titleProperty": ["@name"],
			"subtitleProperty": ["smartphones.manufacturer", "smartphones.year"],
			"badgeProperty": ["smartphones.price_usd"]
		},
		"list": {
			"imageProperty": ["smartphones.product_image"],
			"titleProperty": ["@name"],
			"subtitleProperty": ["smartphones.manufacturer", "smartphones.year", "smartphones.price_usd"],
			"badgeProperty": null
		},
		"table": {
			"columns": [
				{ "label": "Name", "property": ["@name"] },
				{ "label": "Manufacturer", "property": ["smartphones.manufacturer"] },
				{ "label": "Year", "property": ["smartphones.year"] },
				{ "label": "Price", "property": ["smartphones.price_usd"] }
			]
		}
	}
}
```

### View 2: Cross-Schema View (Smartphones + Tablets)

This example demonstrates the COALESCE behavior for cross-schema views where different schemas have different property names:

```json
{
	"name": "Mobile Devices",
	"trackerId": null,
	"isBuiltin": false,
	"queryDefinition": {
		"scope": ["smartphones", "tablets"],
		"filters": [
			{ "field": "smartphones.year", "op": "gte", "value": 2020 },
			{ "field": "tablets.release_year", "op": "gte", "value": 2020 }
		],
		"sort": { "fields": ["smartphones.year", "tablets.release_year"], "direction": "desc" }
	},
	"displayConfiguration": {
		"grid": {
			"imageProperty": ["smartphones.product_image", "tablets.device_image"],
			"titleProperty": ["@name"],
			"subtitleProperty": [
				"smartphones.manufacturer",
				"tablets.maker",
				"smartphones.year",
				"tablets.release_year"
			],
			"badgeProperty": ["smartphones.price_usd", "tablets.retail_price"]
		},
		"list": {
			"imageProperty": ["smartphones.product_image", "tablets.device_image"],
			"titleProperty": ["@name"],
			"subtitleProperty": [
				"smartphones.manufacturer",
				"tablets.maker",
				"smartphones.year",
				"tablets.release_year",
				"smartphones.price_usd",
				"tablets.retail_price"
			],
			"badgeProperty": null
		},
		"table": {
			"columns": [
				{ "label": "Name", "property": ["@name"] },
				{ "label": "Maker", "property": ["smartphones.manufacturer", "tablets.maker"] },
				{ "label": "Year", "property": ["smartphones.year", "tablets.release_year"] },
				{ "label": "Price", "property": ["smartphones.price_usd", "tablets.retail_price"] }
			]
		}
	}
}
```

**Backend resolution:**

For each property reference array, the backend uses COALESCE to return the first non-null value.

For a smartphone entity, the backend resolves:

- `imageProperty`: `smartphones.product_image` (non-null) → returns this value
- `subtitleProperty`: COALESCE → `"Apple"` (first non-null: smartphones.manufacturer)
- `badgeProperty`: COALESCE → `"999"` (first non-null: smartphones.price_usd)

For a tablet entity, the backend resolves:

- `imageProperty`: COALESCE → tablets.device_image (non-null, smartphone property is null)
- `subtitleProperty`: COALESCE → `"Samsung"` (first non-null: tablets.maker)
- `badgeProperty`: COALESCE → `"599"` (first non-null: tablets.retail_price)

This allows both entity types to render properly in the same unified list despite having different schema-defined properties.

**Filter behavior:**

Each filter is schema-qualified and only applies to entities from that schema. Top-level filters (`@name`, `@createdAt`, `@updatedAt`) apply to all entities regardless of schema. Note that `@image` filtering is not supported due to its complex ImageSchema structure. Schemas listed in `scope` that have no schema-specific filters include all their entities unconditionally. See "Complete SQL Query Example" for the full SQL translation.

**Sort behavior:**

The sort fields `["smartphones.year", "tablets.release_year"]` uses COALESCE to handle different property names across schemas. See "Complete SQL Query Example" for the full SQL translation.

### View 3: Older Android Phones

```json
{
	"name": "Older Android Phones",
	"trackerId": "smartphones-tracker-id",
	"isBuiltin": false,
	"queryDefinition": {
		"scope": ["smartphones"],
		"filters": [
			{ "field": "smartphones.year", "op": "lt", "value": 2020 },
			{ "field": "smartphones.year", "op": "gt", "value": 2001 },
			{ "field": "smartphones.os", "op": "eq", "value": "Android" }
		],
		"sort": { "fields": ["smartphones.year"], "direction": "asc" }
	},
	"displayConfiguration": {
		"grid": {
			"imageProperty": ["smartphones.product_image"],
			"titleProperty": ["@name"],
			"subtitleProperty": ["smartphones.os", "smartphones.year"],
			"badgeProperty": ["smartphones.screen_size"]
		},
		"list": {
			"imageProperty": ["smartphones.product_image"],
			"titleProperty": ["@name"],
			"subtitleProperty": ["smartphones.os", "smartphones.year", "smartphones.screen_size"],
			"badgeProperty": null
		},
		"table": {
			"columns": [
				{ "label": "Name", "property": ["@name"] },
				{ "label": "OS", "property": ["smartphones.os"] },
				{ "label": "Year", "property": ["smartphones.year"] },
				{ "label": "Screen Size", "property": ["smartphones.screen_size"] }
			]
		}
	}
}
```

### Runtime Execution Flow

When the frontend loads View 1:

1. `GET /saved-views/{view1Id}` → returns the saved view above
2. Frontend reads the current layout from `localStorage` (key: `view-layout:<viewId>`), defaulting to `"grid"` if absent
3. Frontend compiles runtime request from `queryDefinition` + active layout config:

```json
{
	"scope": ["smartphones"],
	"filters": [
		{ "field": "smartphones.manufacturer", "op": "eq", "value": "Samsung" },
		{ "field": "smartphones.year", "op": "lt", "value": 2025 }
	],
	"sort": { "fields": ["smartphones.year"], "direction": "desc" },
	"pagination": { "page": 1, "limit": 6 },
	"displayConfiguration": {
		"imageProperty": ["smartphones.product_image"],
		"titleProperty": ["@name"],
		"subtitleProperty": ["smartphones.manufacturer", "smartphones.year"],
		"badgeProperty": ["smartphones.price_usd"]
	}
}
```

The active layout's `displayConfiguration` is passed through unchanged so the runtime can resolve its property reference arrays using the rules described in "Display Configuration Property References".

4. `POST /view-runtime/execute` → returns entities with layout-specific display data (`resolvedProperties` for grid/list, `meta.table.columns` + `cells` for table)
5. Frontend renders using the active layout and the runtime response directly, without inferring value types or rebuilding table headers

When the user switches from grid to list view in the UI, the frontend writes the new layout to `localStorage`, then reruns the query with `displayConfiguration.list` instead of `displayConfiguration.grid`. The saved view stores all three layout configurations, and the backend makes no layout assumptions - clients must be explicit about what data they need and how to present it.

### Complete SQL Query Example

Here is a complete SQL query demonstrating how the view-runtime translates a cross-schema request into PostgreSQL:

**Runtime request:**

```json
{
	"scope": ["smartphones", "tablets"],
	"filters": [
		{ "field": "smartphones.year", "op": "gte", "value": 2020 },
		{ "field": "tablets.release_year", "op": "gte", "value": 2020 }
	],
	"sort": { "fields": ["smartphones.year", "tablets.release_year"], "direction": "desc" },
	"pagination": { "page": 1, "limit": 20 },
	"displayConfiguration": {
		"imageProperty": ["smartphones.product_image", "tablets.device_image"],
		"titleProperty": ["@name"],
		"subtitleProperty": [
			"smartphones.manufacturer",
			"tablets.maker",
			"smartphones.year",
			"tablets.release_year"
		],
		"badgeProperty": ["smartphones.price_usd", "tablets.retail_price"]
	}
}
```

**Generated SQL:**

```sql
WITH filtered_entities AS (
  SELECT
    e.id,
    e.name,
    e.image,
    e.entity_schema_id,
    e.properties,
    e.created_at,
    e.updated_at,
    es.slug as entity_schema_slug
  FROM entities e
  JOIN entity_schemas es ON es.id = e.entity_schema_id
  WHERE es.slug IN ('smartphones', 'tablets')
    AND (
      (es.slug = 'smartphones' AND (e.properties->>'year')::integer >= 2020)
      OR
      (es.slug = 'tablets' AND (e.properties->>'release_year')::integer >= 2020)
    )
),
entity_count AS (
  SELECT COUNT(*) as total FROM filtered_entities
),
sorted_entities AS (
  SELECT *,
    COALESCE(
      (properties->>'year')::integer,
      (properties->>'release_year')::integer
    ) as sort_value
  FROM filtered_entities
  ORDER BY sort_value DESC NULLS LAST
),
paginated_entities AS (
  SELECT * FROM sorted_entities
  ORDER BY sort_value DESC NULLS LAST
  LIMIT 20 OFFSET 0
)
SELECT
  pe.id,
  pe.name,
  pe.image,
  pe.entity_schema_id,
  pe.entity_schema_slug,
  pe.created_at,
  pe.updated_at,
  jsonb_build_object(
    'imageProperty', COALESCE(pe.properties->>'product_image', pe.properties->>'device_image'),
    'titleProperty', pe.name,
    'subtitleProperty', COALESCE(pe.properties->>'manufacturer', pe.properties->>'maker', (pe.properties->>'year')::text, (pe.properties->>'release_year')::text),
    'badgeProperty', COALESCE((pe.properties->>'price_usd')::text, (pe.properties->>'retail_price')::text)
  ) as resolved_properties,
  ec.total as total_count
FROM paginated_entities pe
CROSS JOIN entity_count ec;
```

**Key SQL patterns:**

1. **Schema validation**: `WHERE es.slug IN ('smartphones', 'tablets')` filters to requested schemas
2. **Schema-specific filters**: Grouped by schema slug with OR between schemas, AND within each schema group
3. **COALESCE for sorting**: Handles different property names across schemas with explicit `NULLS LAST` ordering
4. **Optimized count**: Separate CTE for total count to avoid repeated count subqueries
5. **Resolved properties**: Backend computes each requested display slot from the supplied displayConfiguration property reference arrays
6. **Type casting**: Properties extracted from jsonb are cast to appropriate types (integer, text, etc.)
7. **Pagination**: LIMIT/OFFSET with total count for pagination metadata
8. **Response fields**: Returns both `entity_schema_id` (UUID FK) and `entity_schema_slug` (human-readable)

The response would include pagination metadata grouped under `meta`:

```json
{
	"items": [
		/* entities with resolved_properties */
	],
	"meta": {
		"pagination": {
			"page": 1,
			"total": 47,
			"limit": 20,
			"hasNextPage": true,
			"hasPreviousPage": false,
			"totalPages": 3
		}
	}
}
```

## Proposed Endpoints

### View Runtime

Keep the module minimal and execution-focused.

- `POST /view-runtime/execute`

No additional endpoints are required in the first pass.

### Saved Views

The existing module needs a fuller API surface so the frontend can support real CRUD and clone behavior.

- `GET /saved-views`
- `POST /saved-views`
- `GET /saved-views/{viewId}`
- `PUT /saved-views/{viewId}`
- `DELETE /saved-views/{viewId}`
- `POST /saved-views/{viewId}/clone`

`POST /saved-views/{viewId}/clone` is preferred over implementing clone purely in the frontend because clone is now a first-class action in the product. The clone operation is a pure copy with no request body — it duplicates the entire saved view record with a new ID, sets `isBuiltin: false` (so cloned views are deletable), and appends " (Copy)" to the name (always the same suffix, no smart numbering). If users want to customize the cloned view or rename it, they immediately edit it via `PUT /saved-views/{viewId}` after cloning. This keeps the clone operation simple and predictable.

Route behavior notes:

- `POST /view-runtime/execute` must be rebuilt around the compiled runtime contract; the current `entitySchemaId` placeholder is insufficient.
- `GET /saved-views` can keep its route name, but its response schema needs to grow with the richer saved-view definition.
- `GET /saved-views/{viewId}` returns any saved view the user can access (both built-in and user-owned views).
- `POST /saved-views` can keep its route name, but its request body must accept the richer saved-view structure.
- `PUT /saved-views/{viewId}` performs full replacement of a saved view (all fields required except immutable ones: `id`, `isBuiltin`, `userId`, `createdAt`, `updatedAt`).
- `DELETE /saved-views/{viewId}` can stay largely as-is. The built-in protection rule still makes sense.

## Existing Endpoints That Likely Do Not Need Changes

These modules can stay focused on their current responsibilities:

- `entities`
- `events`
- `trackers`
- `entity-schemas`
- `event-schemas`

The runtime module should query against the underlying tables and repositories it needs without forcing CRUD endpoints to change shape.

## Backend Implementation Outline

### Phase 1: Fix Saved View Persistence Surface

- add `GET /saved-views/{viewId}` (returns built-in and user-owned views)
- add `PUT /saved-views/{viewId}` (full replacement with required fields)
- add `POST /saved-views/{viewId}/clone` (pure copy, no request body, appends " (Copy)" to name)
- add `queryDefinition` jsonb column to store query semantics (scope, filters, sort)
- add `displayConfiguration` jsonb column to store presentation config (grid config, list config, table config)
- make both columns required with validation
- apply minimal bootstrap fixes to ensure typechecking passes (full bootstrap implementation deferred to Phase 2)
- enforce reserved slug validation for built-in entity schema names (derived from manifests)
- create hardcoded default display configurations for bootstrap (broken configs acceptable in Phase 1)

### Phase 2: Build Real Runtime Execution

- replace the placeholder `entitySchemaId` request with a compiled runtime request
- add support for `displayConfiguration` parameter with property reference arrays
- implement COALESCE resolution for cross-schema property references in displayConfiguration
- validate that all referenced schema slugs exist and user has access to them
- implement filter execution using the schema-qualified property syntax (AND within each schema, OR across schema boundaries)
- implement sort execution with COALESCE for cross-schema property paths
- support pagination with `meta.pagination` response structure
- return layout-specific rendering data (`resolvedProperties` for grid/list, `meta.table.columns` + `cells` for table)
- update built-in saved view bootstrap to produce richer saved-view structure:
  - `apps/app-backend/src/modules/authentication/bootstrap/manifests.ts`
  - `apps/app-backend/src/modules/authentication/service.ts`
  - `apps/app-backend/src/modules/entity-schemas/repository.ts`

### Phase 3: Move Frontend View Route To Runtime

- change frontend route to `/views/$viewId`
- fetch saved view by id
- read the active layout from `localStorage` (key: `view-layout:<viewId>`), defaulting to `"grid"`
- compile runtime payload from `queryDefinition` + active layout config
  - pass the active layout's `displayConfiguration` for COALESCE resolution
- execute via `POST /view-runtime/execute`
- render returned entities directly from the runtime response without type inference or table-key reconstruction
- remove assumptions that saved views live under a tracker route

## Phase 1 Implementation Details

### Migration Strategy

**No data migration is required.** The application is still under development and not deployed to production. Existing saved views will be wiped and rebuilt from scratch during bootstrap. This eliminates migration complexity and allows for a clean implementation of the new structure.

### Schema Immutability

**Entity schema slugs are immutable after creation.** Once an entity schema is created, its slug cannot be changed. This guarantees that saved views referencing schema slugs remain valid. Attempting to change a slug would be a breaking change that invalidates all saved views.

### Reserved Slug Enforcement

**Built-in entity schema slugs are reserved and cannot be used for custom schemas.** The list of reserved slugs is derived from the bootstrap manifests (`authentication/bootstrap/manifests.ts`). When a user attempts to create a custom entity schema, the slug is validated against the list of built-in schema slugs. This prevents conflicts between built-in and custom schemas.

### Display Configuration Structure

**Display configurations use a discriminated union with a separate layout discriminant.** The runtime request includes both a top-level `layout` field and a `displayConfiguration` object that contains the active layout's config. The `layout` value is read from `localStorage` (key: `view-layout:<viewId>`):

```typescript
{
  layout: "grid" | "list" | "table",
  displayConfiguration: {
    // Grid-specific fields
    imageProperty?: string[]
    titleProperty?: string[]
    subtitleProperty?: string[]
    badgeProperty?: string[] | null
  } | {
    // Table-specific fields
    columns: Array<{ property: string[] }>
  }
}
```

When a user clones a saved view, all three layout configurations are copied from the source. List and table configurations may be sparse in built-in views (hardcoded defaults) but become fully editable after cloning.

### Empty Property Arrays

**Empty property arrays in display configurations are replaced with `[null]` for COALESCE.** Since PostgreSQL COALESCE requires at least one argument, empty arrays like `subtitleProperty: []` are converted to `COALESCE(NULL)` in the SQL generation, which returns NULL.

### Sort Requirement

**The `sort` field is required in runtime requests.** There is no default sort behavior. Clients must explicitly specify sort order. This eliminates ambiguity about result ordering.

### Pagination Behavior

**Pagination uses page-based semantics.** Clients send `pagination: { page, limit }`, the backend derives SQL offsets internally, and out-of-range pages return an empty `items` array without clamping to the last page. The requested page is preserved in the response metadata so clients can reconcile their own navigation state cleanly.

For zero results:

- `totalPages: 0`
- `hasNextPage: false`
- `hasPreviousPage: false`

### Error Handling

**Phase 1 error responses follow the existing Hono/OpenAPI error pattern:**

```typescript
// 404 Not Found
return c.json(createNotFoundErrorResult("Schema not found").body, 404);

// 400 Validation Error
return c.json(createValidationErrorResult("Invalid filter operator").body, 400);

// 200 Success
return c.json(successResponse(data), 200);
```

### Validation Strategy

**Phase 1 trusts the frontend to send valid requests.** Filter paths, property references, and display configurations are assumed to be well-formed. Backend validation of property existence, type compatibility, and operator validity is deferred to Phase 2.

**However, the following validations are enforced in Phase 1:**

- Entity schema slugs exist and user has access to them
- Properties referenced in filters exist in the target schemas (throws error if missing)
- Filter operator discriminated union (validates value type based on operator)
- Sort field is non-empty
- Required fields in request bodies

### Query Builder Structure

The view-runtime query builder lives in `app-backend/src/modules/view-runtime/query-builder.ts`. The query builder:

1. Pre-fetches all entity schemas referenced in the request
2. Builds a schema map for type introspection
3. Generates Drizzle SQL using the `sql` template tag for type safety
4. Returns results with COALESCE-resolved properties

### Image Handling

**Images are returned as raw jsonb discriminated unions.** The view-runtime does not resolve S3 keys to URLs or perform any image transformation. The frontend already has utilities for converting ImageSchema objects (`{ kind: "s3", key: "..." }`) to fully qualified URLs. When `@image` appears inside a display fallback array, a missing top-level image must remain SQL NULL so later references in the COALESCE chain can still win.

### Testing Approach

Phase 1 includes both unit tests and integration tests:

- **Unit tests**: Test SQL generation, filter building, COALESCE resolution, and pagination math
- **Integration tests**: Test full execution flow with real database queries

A testing harness for live database tests will be added to `app-backend` separately before starting Phase 1 implementation.

### Bootstrap Updates

Bootstrap manifests are updated with minimal changes to satisfy type requirements. The hardcoded display configuration for all built-in views is:

```typescript
{
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
    columns: [{ label: "Name", property: ["@name"] }]
  }
}
```

**This configuration returns raw image objects**, not resolved URLs. That is acceptable for Phase 1 because the frontend already knows how to render image unions. If a view uses `@image` in a longer fallback chain, missing top-level images must fall through to later references instead of resolving early to JSON null.

## Design Constraints

The runtime layer should preserve these constraints:

- built-in and custom schemas must both work
- the saved-view renderer must be usable as the universal entity-browsing primitive
- runtime execution should be generic and schema-aware, not hardcoded to one tracker
- the contract should support future query-builder output without redesigning the module again

## Deferred to Phase 2

The following features are intentionally excluded from the initial implementation to keep scope tight and deliver a working foundation quickly:

### Event Integration

**Event-based filtering**: The ability to filter entities based on their events (e.g., "movies I rated >8", "shows watched in 2024", "entities with no events", "entities with event count > 5"). This requires:

- Adding `eventConditions` field to `queryDefinition` structure with schema-qualified syntax:

  ```json
  "eventConditions": [
    { "field": "movies.rating", "op": "gte", "value": 8 },
    { "field": "@lastEventDate", "op": "gte", "value": "2024-01-01" },
    { "field": "@eventCount", "op": "gt", "value": 0 }
  ]
  ```

- Joining to the events table in view-runtime queries
- Supporting event aggregation filters (count, avg, min, max, latest/earliest date)
- Query builder UI for constructing event-based filter expressions
- Schema-qualified event property references for cross-schema views

**Event summary fields**: Including event-derived data in runtime responses (lastEventDate, eventCount, averageRating). Once event filtering is implemented, returning event summaries becomes trivial since the runtime will already be joining to the events table. These fields will be controlled by the `include` parameter (e.g., `include: { eventSummary: true }`).

### Advanced Filter Logic

**Compound filters**: Support for explicit OR logic within a schema and nested boolean filter groups. Phase 1 uses a flat array with AND within each schema and OR across schema boundaries, which covers the majority of use cases. More complex boolean logic can be added when the query builder UI actually needs it.

Filter structure for Phase 2 might look like:

```json
{
	"and": [
		{ "field": "movies.year", "op": "gte", "value": 2020 },
		{
			"or": [
				{ "field": "movies.genre", "op": "contains", "value": "Sci-Fi" },
				{ "field": "movies.genre", "op": "contains", "value": "Fantasy" }
			]
		}
	]
}
```

For cross-schema views with OR logic:

```json
{
	"and": [
		{ "field": "@name", "op": "contains", "value": "Pro" },
		{
			"or": [
				{ "field": "smartphones.manufacturer", "op": "eq", "value": "Apple" },
				{ "field": "tablets.maker", "op": "eq", "value": "Samsung" }
			]
		}
	]
}
```

### Additional Filter Operators

Type-specific operators that add convenience but aren't essential for v1:

- `contains` (string substring matching with ILIKE, or JSONB containment with `@>` operator depending on property type)
- `notIn` (inverse of `in`)
- `notContains` (string negation)
- `between` (range queries, syntactic sugar for `gte` + `lte`)
- `regex` (pattern matching, use with caution for performance)
- `isEmpty` / `isNotEmpty` (for array/object properties)

The `contains` operator is complex because it has different semantics depending on property type:

- For strings: `ILIKE '%value%'` for substring matching
- For JSONB arrays: `@> '[value]'` for array containment
- For JSONB objects: `@> '{"key": "value"}'` for object containment

Phase 1 focuses on exact comparisons, range queries, and null checks. The `contains` operator requires property type introspection to choose the correct SQL operator, which adds complexity to the query builder.

### Schema-Aware Filter Validation

Runtime validation that ensures:

- Filter fields exist in the target schemas
- Filter operators are valid for the property type (e.g., `contains` only for strings, `gt`/`lt` only for numbers/dates)
- Filter values match the property type

Phase 1 assumes the frontend (query builder) sends valid filters. Phase 2 adds backend validation for robustness and security (protecting against direct API access with malformed filters).

### Relationship Querying

The ability to query entities based on their relationships to other entities. This is critical for collections and people-to-media connections but adds significant complexity to the runtime contract.

**Core use cases:**

1. **Collection browsing**: "Show me all books in my 'Favorites' collection" (entities with a relationship to a specific collection)
2. **Multiple collections**: "Show me books in BOTH 'Favorites' AND 'To Re-read'" (entities with relationships to multiple collections)
3. **People + collections**: "Show me movies in 'Favorites' that star Tom Hanks" (entities with relationships in different directions)
4. **Multiple people**: "Show me movies where BOTH Tom Hanks AND Meg Ryan appear"
5. **Relationship properties**: "Show me books I bought from Amazon" (filter by properties stored on the relationship itself)

**Why this is complex:**

Per soul.md, collections are entities, and collection membership is modeled as relationships. A book in the "Owned" collection has a relationship: `Book (source) --member_of--> Collection (target)`. The relationship can have properties like `{ bought_where: "Amazon", bought_when: "2024-03-15" }`.

Similarly, "Tom Hanks acted in Forrest Gump as Forrest" is a relationship: `Tom Hanks (source) --acted_in--> Forrest Gump (target)` with properties `{ role: "Forrest" }`.

**Relationship directionality matters:**

- From the **book's perspective**: outgoing relationship to collection (book is source)
- From the **movie's perspective**: incoming relationship from Tom Hanks (movie is target)
- Queries need to specify direction to construct correct SQL joins

**Phase 2 runtime contract should add:**

```json
{
	"scope": ["movies"],
	"filters": [
		/* entity property filters */
	],
	"relationships": [
		{
			"direction": "incoming",
			"from": "tom-hanks-id",
			"type": "acted_in"
		},
		{
			"direction": "outgoing",
			"to": "favorites-collection-id",
			"type": "member_of",
			"propertyFilters": [
				{ "field": "member_of.bought_where", "op": "eq", "value": "Amazon" },
				{ "field": "@createdAt", "op": "gte", "value": "2024-01-01" }
			]
		}
	],
	"sort": {
		"source": "relationship",
		"relationshipIndex": 1,
		"fields": ["member_of.bought_when"],
		"direction": "desc"
	},
	"include": {
		"relationships": true
	}
}
```

**Response shape additions:**

```json
{
	"items": [
		{
			"id": "...",
			"name": "Forrest Gump",
			"resolvedProperties": {
				/* grid/list display slots, each shaped as { value, kind } */
			},
			"relationships": [
				{
					"id": "rel-123",
					"direction": "incoming",
					"sourceEntityId": "tom-hanks-id",
					"targetEntityId": "movie-id",
					"type": "acted_in",
					"properties": { "role": "Forrest" }
				},
				{
					"id": "rel-456",
					"direction": "outgoing",
					"sourceEntityId": "movie-id",
					"targetEntityId": "favorites-collection-id",
					"type": "member_of",
					"properties": {}
				}
			]
		}
	]
}
```

**Implementation requirements:**

- Support for multiple relationships (array) with implicit AND logic
- Direction awareness: `incoming` (entity is target) vs `outgoing` (entity is source)
- Optional `from` (for incoming) and `to` (for outgoing) to specify the related entity
- Optional `propertyFilters` on relationships with schema-qualified syntax:
  - Relationship properties: `member_of.bought_where` (qualified by relationship type)
  - Top-level relationship columns: `@createdAt` (relationship creation timestamp)
  - Same filter operators as entity filters
- Ability to sort by relationship properties using array format: `["member_of.bought_when"]`
- Ability to include relationship data in responses
- OR logic for relationships (aligned with compound filter OR logic)

**SQL translation example** ("Nolan movies in 'To Watch'"):

```sql
SELECT e.*
FROM entities e
JOIN entity_schemas es ON es.id = e.entity_schema_id
JOIN relationships r1 ON r1.target_entity_id = e.id  -- incoming
JOIN relationships r2 ON r2.source_entity_id = e.id  -- outgoing
WHERE es.slug = 'movies'
  AND r1.source_entity_id = 'christopher-nolan-id'
  AND r1.relationship_type = 'directed'
  AND r2.target_entity_id = 'to-watch-collection-id'
  AND r2.relationship_type = 'member_of'
```

**Why defer to Phase 2:**

- Collections can be listed without relationship queries (just query collection schema entities)
- Individual collection detail pages can use separate endpoints initially
- Phase 1 focuses on entity property filtering, which covers the majority of simple saved views
- Relationship querying adds significant contract complexity and requires careful query builder UI design

However, relationship querying is essential for the saved view to become the true universal browsing primitive. Without it, collection browsing, people-to-media connections, and cross-entity queries remain special-cased outside the unified view-runtime system.

## Phase 1 Complete Scope Summary

Phase 1 delivers a working foundation for saved views and view-runtime execution with the following scope:

**Saved Views Module:**

- Add `GET /saved-views/{viewId}` (returns built-in and user-owned views)
- Add `PUT /saved-views/{viewId}` (full replacement)
- Add `POST /saved-views/{viewId}/clone` (pure copy, appends " (Copy)")
- Add `displayConfiguration` jsonb column to database
- Expand `queryDefinition` structure (slugs, filters, sort)
- Update schemas to use discriminated unions
- Add reserved slug enforcement

**View Runtime Module:**

- Replace placeholder with full runtime contract
- Pre-fetch entity schemas for type introspection
- Implement filter execution (eq, ne, gt, gte, lt, lte, in, isNull)
- Implement sort with COALESCE and NULLS LAST
- Implement page-based pagination with empty out-of-range pages
- Implement display configuration COALESCE resolution
- Return resolved properties for grid/list/table layouts
- Use Drizzle query builder for type-safe SQL generation

**Bootstrap:**

- Update manifests with hardcoded display configurations
- Minimal changes to satisfy type requirements
- Accept that built-in views will be broken (fixed in Phase 2)

**Testing:**

- Add testing harness for live database tests (separate task)
- Write unit tests for query builder SQL generation
- Write integration tests for full execution flow

**Validation Strategy:**

- Trust frontend in Phase 1
- Validate schema existence and property existence
- Validate filter operator discriminated union
- Require sort field
- Defer comprehensive validation to Phase 2

**Deferred to Phase 2:**

- `contains` operator (complex type-dependent behavior)
- Event-based filtering
- Relationship querying
- Compound filter logic (explicit OR)
- Schema-aware default display configurations
- Performance optimization (indexes)
- Full validation of property types and operators

## Recommended First Step

Start by redesigning the saved-view schema and API surface before writing runtime SQL.

Reason: the runtime contract depends on what the frontend will compile from a saved view, and that only becomes stable once the persisted saved-view shape is defined clearly.

**Specific implementation order:**

1. Add database migration for `display_configuration` column
2. Update saved-views schemas (Zod definitions)
3. Implement saved-views endpoints (GET /{id}, PUT /{id}, POST /{id}/clone)
4. Update bootstrap manifests with hardcoded configs
5. Implement view-runtime schemas (request/response)
6. Implement query-builder (filter, sort, COALESCE logic)
7. Implement view-runtime execution endpoint
8. Write unit tests for query builder
9. Write integration tests for full flow
