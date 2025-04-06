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

- `entitySchemaSlugs: string[]` — which schemas to query (using schema slugs, e.g., `["smartphones", "tablets"]`)
- `filters: FilterExpression[]` — flat array of filters (AND within each schema, OR across schema boundaries; compound nested logic in Phase 2)
- `sort: { field: string[], direction: "asc" | "desc" }` — how to order results (field is an array for COALESCE across schemas)
- `page: { limit: number, offset: number }` — pagination parameters
- `fields: string[]` — schema-qualified property paths to return (e.g., `["smartphones.manufacturer", "tablets.maker"]`)
- `displayConfiguration: object` — active layout configuration with property reference arrays for COALESCE resolution
- `include: { schemaMeta?: boolean }` — optional metadata flags (event-related fields deferred to Phase 2)

Each filter in the `filters` array has the shape:

- `field: string` — property path using the schema-qualified syntax (see "Schema-Qualified Property Syntax" section)
- `op: string` — operator: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `contains`, `in`, `isNull`
- `value: any` — the value to compare against (type depends on the property being filtered)

The `sort.field` is an array of schema-qualified property paths:

- Single-schema: `["smartphones.year"]`
- Cross-schema: `["smartphones.year", "tablets.release_year"]` — resolved via COALESCE
- Top-level columns: `["@name"]`

Suggested response shape:

- `items: []`
- `total: number`
- `limit: number`
- `offset: number`
- `hasNextPage: boolean`
- `hasPreviousPage: boolean`
- `totalPages: number`
- `currentPage: number`

Each item should include at least:

- `id` — entity primary key
- `name` — entity name (top-level column)
- `image` — entity image URL (top-level column)
- `entitySchemaId` — the UUID foreign key to the entity schema
- `entitySchemaSlug` — the human-readable schema slug (e.g., "smartphones", "movies")
- `propertyValues` — filtered to requested fields from the `fields` parameter
- `resolvedProperties` — COALESCE-resolved values for each property reference in displayConfiguration (frontend uses these for rendering)
- `createdAt` — entity creation timestamp
- `updatedAt` — entity update timestamp
- optional schema metadata when runtime spans multiple schemas (included when `include.schemaMeta: true`)

**Note**: Event-related fields (lastEventDate, eventCount, averageRating) are intentionally excluded from Phase 1. These will be added in Phase 2 alongside event-based filtering capabilities.

**Resolved properties structure:**

The `resolvedProperties` object contains the resolved values for each displayConfiguration property reference, keyed by the property role:

```json
{
  "id": "entity-123",
  "name": "iPhone 15 Pro",
  "entitySchemaId": "c3f8a9b2-...",
  "entitySchemaSlug": "smartphones",
  "propertyValues": {
    "manufacturer": "Apple",
    "year": 2023,
    "price_usd": 999,
    "product_image": "https://..."
  },
  "resolvedProperties": {
    "imageProperty": "https://...",
    "titleProperty": "iPhone 15 Pro",
    "subtitleProperty": "Apple",
    "badgeProperty": "999"
  }
}
```

This eliminates the need for frontend COALESCE logic and makes rendering trivial — the frontend just renders `resolvedProperties.imageProperty`, `resolvedProperties.titleProperty`, etc.

The runtime contract should stay generic enough that the frontend can compile both built-in curated views and user-authored saved views into the same payload.

### Schema-Qualified Property Syntax

To support cross-schema views where different entity schemas have different property names, the runtime contract uses a **unified schema-qualified property path syntax** across all features.

**Two path formats:**

1. **Top-level columns**: `@name`, `@image`, `@createdAt`
   - Prefix: `@`
   - References database columns that exist on all entities
   - Used in filters, sorts, and displayConfiguration

2. **Schema-qualified properties**: `smartphones.manufacturer`, `tablets.maker`
   - Format: `<schema-slug>.<property>` (uses entity schema slugs, not IDs)
   - References properties in the entity's `propertyValues` jsonb column
   - **Required for all entity schema properties** — no unqualified references allowed
   - Schema slugs are stable identifiers (e.g., "smartphones", "movies", "whiskeys")
   - Used in filters, sorts, fields, and displayConfiguration

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
- `sort.field` — array of paths for COALESCE ordering
- `fields[]` — which properties to return from propertyValues
- `displayConfiguration.*Property` — arrays of paths for COALESCE rendering
- `eventConditions[].field` (Phase 2) — filter by event properties
- `relationships[].propertyFilters[].field` (Phase 2) — filter by relationship properties

**Examples:**

Single-schema view:

```json
{
  "filters": [
    { "field": "@name", "op": "contains", "value": "Pro" },
    { "field": "smartphones.manufacturer", "op": "eq", "value": "Apple" },
    { "field": "smartphones.year", "op": "gte", "value": 2020 }
  ],
  "sort": {
    "field": ["smartphones.year"],
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
    { "field": "@name", "op": "contains", "value": "Pro" },
    { "field": "smartphones.year", "op": "gte", "value": 2020 },
    { "field": "tablets.release_year", "op": "gte", "value": 2020 }
  ],
  "sort": {
    "field": ["smartphones.year", "tablets.release_year"],
    "direction": "desc"
  },
  "displayConfiguration": {
    "imageProperty": ["smartphones.product_image", "tablets.device_image"],
    "titleProperty": ["@name"],
    "subtitleProperty": ["smartphones.manufacturer", "tablets.maker"]
  }
}
```

### Entity Structure: Top-Level vs PropertyValues

Entities have a hybrid structure with both top-level database columns and schema-defined properties stored in jsonb:

**Top-level columns (infrastructure + universal fields):**

- `id` — entity primary key
- `name` — required text column, universally present on all entities
- `image` — optional text column for image URLs
- `entitySchemaId` — foreign key to entity schema
- `createdAt`, `updatedAt` — timestamps
- `externalId` — optional external source identifier
- `searchVector` — tsvector for full-text search

**PropertyValues (schema-defined properties):**

- All other entity properties defined in the entity schema's AppSchema are stored in the `propertyValues` jsonb column

**Why keep name and image as top-level columns?**

1. **Performance**: Name is accessed on every entity display — search results, collection items, relationship references, activity logs, grid/list views. Querying and sorting by a top-level indexed column is significantly faster than jsonb extraction.

2. **Full-text search**: The `searchVector` generated column depends on `name` being a top-level field for efficient tsvector indexing. Extracting name from jsonb for search indexing would require triggers and complex generated column logic.

3. **Database integrity**: Top-level columns can enforce `NOT NULL` constraints at the database level. Name is fundamental to entity identity and should be guaranteed by database structure, not just application-level validation.

4. **API clarity**: Every entity always has a displayable name. This is a fundamental system guarantee. Keeping it top-level makes this contract explicit in the API response structure.

5. **Relationship display cost**: Displaying relationships (cast lists, collection memberships, related entities) requires fetching names constantly. Direct column access is substantially faster than jsonb extraction at scale.

**Filter and sort handling**: The view-runtime query builder handles this hybrid structure transparently using the schema-qualified property syntax (see "Schema-Qualified Property Syntax" section). The `@` prefix routes to top-level columns; schema-qualified paths route to `propertyValues` jsonb extraction.

### Display Configuration Property References

Display configurations use the schema-qualified property syntax with one key addition: each property reference is an **array** of paths. The backend resolves each array using COALESCE, returning the first non-null value. This enables cross-schema views where different schemas use different property names for conceptually similar data.

**Property reference format:**

```json
{
  "imageProperty": ["smartphones.product_image", "tablets.device_image"],
  "titleProperty": ["@name"],
  "subtitleProperty": ["smartphones.manufacturer", "tablets.maker", "smartphones.year", "tablets.release_year"],
  "badgeProperty": ["smartphones.price_usd", "tablets.retail_price"]
}
```

All property references are flat arrays of schema-qualified paths. The backend resolves each using COALESCE to return the first non-null value.

Even for single-schema views, the array format is required for consistency:

```json
{
  "imageProperty": ["smartphones.product_image"],
  "titleProperty": ["@name"],
  "subtitleProperty": ["smartphones.manufacturer", "smartphones.year"]
}
```

### Field Selection Design

Different views over the same schema may need to display different properties based on their purpose.

Example: A "Smartphones" schema with properties `[manufacturer, year, os, screen_size, storage_gb, ram_gb, price_usd]` might have:

- View 1 filtered to Samsung phones from recent years → display `manufacturer` and `year`
- View 2 filtered to older Android phones → display `os` and `year` (manufacturer irrelevant)

The saved view should store which properties matter for that view's purpose. The runtime request requires a `fields` parameter that specifies which property keys to return, avoiding waste when entities have large propertyValues objects.

The `fields` parameter sent to the runtime is derived from the active layout's displayConfiguration by extracting all schema-qualified property paths from the property reference arrays (excluding top-level column references like `@name`).

This makes field selection explicit and forces callers to think about what data they actually need.

## Saved View Data Model Changes

The current saved-view definition only stores:

- `entitySchemaSlugs: string[]`

That is too small for the saved-view renderer that was designed. A saved view needs to store both query semantics and presentation configuration.

The saved view schema should include:

- `name: string` — view name
- `icon?: string` — optional icon identifier
- `accentColor?: string` — optional accent color
- `trackerId?: string` — optional tracker FK for UI/sidebar placement hint (nullable, used for single-tracker views)
- `isBuiltin: boolean` — whether this is a built-in protected view
- `queryDefinition: jsonb` — the data query (required)
- `displayConfiguration: jsonb` — the presentation config (required)

**Note on `trackerId`**: This field is purely for UI organization and determines which tracker's sidebar section should display the saved view. It is **not** the source of truth for query scope — the actual schemas/trackers being queried are stored within `queryDefinition.entitySchemaSlugs`.

The `queryDefinition` column stores:

- `entitySchemaSlugs: string[]` — which schemas to query (using schema slugs, e.g., `["smartphones", "tablets"]`)
- `filters: FilterExpression[]` — flat array of filters using the schema-qualified property syntax (filters are implicitly AND'd within each schema group and OR'd across schema boundaries, since an entity belongs to exactly one schema and only its schema's filters apply)
- `sort: { field: string[], direction: "asc" | "desc" }` — ordering (field is an array for COALESCE across schemas)

Event-based filtering (e.g., "movies I rated >8", "shows watched in 2024") is deferred to Phase 2 and will be added as an `eventConditions` field once event integration is implemented in the runtime.

The `displayConfiguration` column stores:

- `layout: "grid" | "list" | "table"` — currently active layout
- `grid: {}` — grid layout configuration
- `list: {}` — list layout configuration
- `table: {}` — table layout configuration

All three layout configurations are stored simultaneously so users can switch between layouts in the frontend without losing their configuration. Each layout specifies which entity properties to display using schema-qualified property paths (see "Display Configuration Property References" section).

This separation keeps query logic distinct from presentation concerns while allowing the saved-view record to align with product behavior without making `view-runtime` own persistence concerns.

## Concrete Example

Consider a "Smartphones" entity schema with properties:

```json
{
  "manufacturer": { "type": "string", "required": true },
  "year": { "type": "integer" },
  "os": { "type": "string" },
  "screen_size": { "type": "number" },
  "storage_gb": { "type": "integer" },
  "ram_gb": { "type": "integer" },
  "price_usd": { "type": "number" }
}
```

### View 1: Recent Samsung Phones

```json
{
  "name": "Recent Samsung Phones",
  "trackerId": "smartphones-tracker-id",
  "isBuiltin": false,
  "queryDefinition": {
    "entitySchemaSlugs": ["smartphones"],
    "filters": [
      { "field": "smartphones.manufacturer", "op": "eq", "value": "Samsung" },
      { "field": "smartphones.year", "op": "lt", "value": 2025 }
    ],
    "sort": { "field": ["smartphones.year"], "direction": "desc" }
  },
  "displayConfiguration": {
    "layout": "grid",
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
        { "property": ["@name"] },
        { "property": ["smartphones.manufacturer"] },
        { "property": ["smartphones.year"] },
        { "property": ["smartphones.price_usd"] }
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
    "entitySchemaSlugs": ["smartphones", "tablets"],
    "filters": [
      { "field": "smartphones.year", "op": "gte", "value": 2020 },
      { "field": "tablets.release_year", "op": "gte", "value": 2020 }
    ],
    "sort": { "field": ["smartphones.year", "tablets.release_year"], "direction": "desc" }
  },
  "displayConfiguration": {
    "layout": "grid",
    "grid": {
      "imageProperty": ["smartphones.product_image", "tablets.device_image"],
      "titleProperty": ["@name"],
      "subtitleProperty": ["smartphones.manufacturer", "tablets.maker", "smartphones.year", "tablets.release_year"],
      "badgeProperty": ["smartphones.price_usd", "tablets.retail_price"]
    },
    "list": {
      "imageProperty": ["smartphones.product_image", "tablets.device_image"],
      "titleProperty": ["@name"],
      "subtitleProperty": ["smartphones.manufacturer", "tablets.maker", "smartphones.year", "tablets.release_year", "smartphones.price_usd", "tablets.retail_price"],
      "badgeProperty": null
    },
    "table": {
      "columns": [
        { "property": ["@name"] },
        { "property": ["smartphones.manufacturer", "tablets.maker"] },
        { "property": ["smartphones.year", "tablets.release_year"] },
        { "property": ["smartphones.price_usd", "tablets.retail_price"] }
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

Each filter is schema-qualified and only applies to entities from that specific schema. The backend groups schema-specific filters by schema slug, AND's them within each group, and OR's across schema boundaries (an entity belongs to exactly one schema, so only that schema's filters apply):

```json
"filters": [
  { "field": "smartphones.year", "op": "gte", "value": 2020 },
  { "field": "tablets.release_year", "op": "gte", "value": 2020 }
]
```

```sql
JOIN entity_schemas es ON es.id = e.entity_schema_id
WHERE es.slug IN ('smartphones', 'tablets')
  AND (
    (es.slug = 'smartphones' AND (e.property_values->>'year')::integer >= 2020)
    OR
    (es.slug = 'tablets' AND (e.property_values->>'release_year')::integer >= 2020)
  )
```

Top-level filters (`@name`, `@image`) apply to all entities regardless of schema and are AND'd at the outer level:

```json
"filters": [
  { "field": "@name", "op": "contains", "value": "Pro" },
  { "field": "smartphones.year", "op": "gte", "value": 2020 },
  { "field": "tablets.release_year", "op": "gte", "value": 2020 }
]
```

```sql
JOIN entity_schemas es ON es.id = e.entity_schema_id
WHERE es.slug IN ('smartphones', 'tablets')
  AND e.name ILIKE '%Pro%'  -- top-level filter applied to all entities
  AND (
    (es.slug = 'smartphones' AND (e.property_values->>'year')::integer >= 2020)
    OR
    (es.slug = 'tablets' AND (e.property_values->>'release_year')::integer >= 2020)
  )
```

Schemas listed in `entitySchemaSlugs` that have no schema-specific filters include all their entities unconditionally.

**Sort behavior:**

The sort field `["smartphones.year", "tablets.release_year"]` uses COALESCE to handle different property names:

```sql
ORDER BY COALESCE(
  (e.property_values->>'year')::integer,
  (e.property_values->>'release_year')::integer
) DESC
```

This allows unified sorting across schemas even when property names differ.

### View 3: Older Android Phones

```json
{
  "name": "Older Android Phones",
  "trackerId": "smartphones-tracker-id",
  "isBuiltin": false,
  "queryDefinition": {
    "entitySchemaSlugs": ["smartphones"],
    "filters": [
      { "field": "smartphones.year", "op": "lt", "value": 2020 },
      { "field": "smartphones.year", "op": "gt", "value": 2001 },
      { "field": "smartphones.os", "op": "eq", "value": "Android" }
    ],
    "sort": { "field": ["smartphones.year"], "direction": "asc" }
  },
  "displayConfiguration": {
    "layout": "list",
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
        { "property": ["@name"] },
        { "property": ["smartphones.os"] },
        { "property": ["smartphones.year"] },
        { "property": ["smartphones.screen_size"] }
      ]
    }
  }
}
```

### Runtime Execution Flow

When the frontend loads View 1:

1. `GET /saved-views/{view1Id}` → returns the saved view above
2. Frontend extracts the current layout from `displayConfiguration.layout` (e.g., "grid")
3. Frontend compiles runtime request from `queryDefinition` + active layout config:

  ```json
  {
    "entitySchemaSlugs": ["smartphones"],
    "filters": [
      { "field": "smartphones.manufacturer", "op": "eq", "value": "Samsung" },
      { "field": "smartphones.year", "op": "lt", "value": 2025 }
    ],
    "sort": { "field": ["smartphones.year"], "direction": "desc" },
    "page": { "limit": 6, "offset": 0 },
    "fields": [
      "smartphones.manufacturer",
      "smartphones.year",
      "smartphones.price_usd",
      "smartphones.product_image"
    ],
    "displayConfiguration": {
      "imageProperty": ["smartphones.product_image"],
      "titleProperty": ["@name"],
      "subtitleProperty": ["smartphones.manufacturer", "smartphones.year"],
      "badgeProperty": ["smartphones.price_usd"]
    }
  }
  ```

  The `fields` parameter is derived from the active layout config (see "Field Selection Design" section). The `displayConfiguration` is passed to the runtime for COALESCE resolution.

4. `POST /view-runtime/execute` → returns entities with requested properties in `propertyValues`
5. Frontend renders using `layout` and the resolved property values from the runtime response

**Backend COALESCE resolution:**

For each property reference array in displayConfiguration, the backend strips the schema slug prefix and extracts the property name for jsonb access:

```sql
-- displayConfiguration.imageProperty: ["smartphones.product_image", "tablets.device_image"]
-- "smartphones.product_image" → strip slug → propertyValues->>'product_image'
-- "tablets.device_image" → strip slug → propertyValues->>'device_image'
COALESCE(
  (propertyValues->>'product_image')::text,
  (propertyValues->>'device_image')::text
) as resolved_image_property
```

For top-level columns (prefixed with `@`):

```sql
entities.name as resolved_title_property  -- @name reference
```

The runtime response includes the resolved values, making frontend rendering simple.

**Layout switching:**

When the user switches from grid to list view in the UI, the frontend simply changes the active layout and reruns the query with different `fields` and `displayConfiguration` derived from `displayConfiguration.list` instead of `displayConfiguration.grid`.

**Key constraint**: The saved view explicitly stores all three layout configurations. The backend makes no assumptions - clients must be explicit about what data they need and how to present it.

### Complete SQL Query Example

Here is a complete SQL query demonstrating how the view-runtime translates a cross-schema request into PostgreSQL.

**Note**: This shows the **compiled runtime payload** sent to `POST /view-runtime/execute`, not the saved view definition. The frontend extracts the active layout's configuration from the saved view and compiles it into this request format.

**Runtime request:**

```json
{
  "entitySchemaSlugs": ["smartphones", "tablets"],
  "filters": [
    { "field": "@name", "op": "contains", "value": "Pro" },
    { "field": "smartphones.year", "op": "gte", "value": 2020 },
    { "field": "tablets.release_year", "op": "gte", "value": 2020 }
  ],
  "sort": { "field": ["smartphones.year", "tablets.release_year"], "direction": "desc" },
  "page": { "limit": 20, "offset": 0 },
  "fields": ["smartphones.product_image", "tablets.device_image", "smartphones.manufacturer", "tablets.maker", "smartphones.year", "tablets.release_year", "smartphones.price_usd", "tablets.retail_price"],
  "displayConfiguration": {
    "imageProperty": ["smartphones.product_image", "tablets.device_image"],
    "titleProperty": ["@name"],
    "subtitleProperty": ["smartphones.manufacturer", "tablets.maker", "smartphones.year", "tablets.release_year"],
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
    e.property_values,
    e.created_at,
    e.updated_at,
    es.slug as entity_schema_slug
  FROM entities e
  JOIN entity_schemas es ON es.id = e.entity_schema_id
  WHERE es.slug IN ('smartphones', 'tablets')
    AND e.name ILIKE '%Pro%'
    AND (
      (es.slug = 'smartphones' AND (e.property_values->>'year')::integer >= 2020)
      OR
      (es.slug = 'tablets' AND (e.property_values->>'release_year')::integer >= 2020)
    )
),
sorted_entities AS (
  SELECT *,
    COALESCE(
      (property_values->>'year')::integer,
      (property_values->>'release_year')::integer
    ) as sort_value
  FROM filtered_entities
  ORDER BY sort_value DESC
),
paginated_entities AS (
  SELECT * FROM sorted_entities
  ORDER BY sort_value DESC
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
    'product_image', pe.property_values->'product_image',
    'device_image', pe.property_values->'device_image',
    'manufacturer', pe.property_values->'manufacturer',
    'maker', pe.property_values->'maker',
    'year', pe.property_values->'year',
    'release_year', pe.property_values->'release_year',
    'price_usd', pe.property_values->'price_usd',
    'retail_price', pe.property_values->'retail_price'
  ) as property_values,
  jsonb_build_object(
    'imageProperty', COALESCE(pe.property_values->>'product_image', pe.property_values->>'device_image'),
    'titleProperty', pe.name,
    'subtitleProperty', COALESCE(pe.property_values->>'manufacturer', pe.property_values->>'maker', (pe.property_values->>'year')::text, (pe.property_values->>'release_year')::text),
    'badgeProperty', COALESCE((pe.property_values->>'price_usd')::text, (pe.property_values->>'retail_price')::text)
  ) as resolved_properties,
  (SELECT COUNT(*) FROM filtered_entities) as total_count
FROM paginated_entities pe;
```

**Key SQL patterns:**

1. **Schema validation**: `WHERE es.slug IN ('smartphones', 'tablets')` filters to requested schemas
2. **Top-level filters**: `AND e.name ILIKE '%Pro%'` applies to all entities regardless of schema
3. **Schema-specific filters**: Grouped by schema slug with OR between schemas, AND within each schema group
4. **COALESCE for sorting**: Handles different property names across schemas
5. **Field selection**: `jsonb_build_object` extracts only requested fields from `property_values`
6. **Resolved properties**: Backend performs COALESCE resolution for each display property reference
7. **Pagination**: LIMIT/OFFSET with total count for pagination metadata
8. **Response fields**: Returns both `entity_schema_id` (UUID FK) and `entity_schema_slug` (human-readable)

The response would include pagination metadata:

```json
{
  "items": [ /* entities with resolved_properties */ ],
  "total": 47,
  "limit": 20,
  "offset": 0,
  "hasNextPage": true,
  "hasPreviousPage": false,
  "totalPages": 3,
  "currentPage": 1
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
- `PATCH /saved-views/{viewId}`
- `DELETE /saved-views/{viewId}`
- `POST /saved-views/{viewId}/clone`

`POST /saved-views/{viewId}/clone` is preferred over implementing clone purely in the frontend because clone is now a first-class action in the product. The clone operation is a pure copy with no request body — it duplicates the entire saved view record with a new ID, sets `isBuiltin: false` (so cloned views are deletable), and appends " (Copy)" to the name (always the same suffix, no smart numbering). If users want to customize the cloned view or rename it, they immediately edit it via `PATCH /saved-views/{viewId}` after cloning. This keeps the clone operation simple and predictable.

## Existing Endpoints That Need Changes

### `POST /view-runtime/execute`

This route must change.

Current problems:

- accepts only one `entitySchemaId`
- returns a raw array instead of paginated runtime data
- uses custom-entity access logic, which is wrong for a universal saved-view renderer
- cannot represent sorting, filtering, or cross-schema execution

The route should be rebuilt around the compiled runtime contract.

### `GET /saved-views`

This route can stay, but its response schema likely needs to grow once the saved-view definition and presentation shape become richer.

### `POST /saved-views`

This route can stay, but its request body must expand to accept the richer saved-view structure.

### `DELETE /saved-views/{viewId}`

This route can stay largely as-is. The built-in protection rule still makes sense.

## Existing Endpoints That Should Be Added

### `GET /saved-views/{viewId}`

This is needed because the new frontend route is `/views/$viewId` and should fetch the view directly rather than loading all views and searching client-side.

### `PATCH /saved-views/{viewId}`

This is needed for editing non-built-in views.

### `POST /saved-views/{viewId}/clone`

New endpoint for cloning views. See "Proposed Endpoints" section for details.

## Existing Endpoints That Likely Do Not Need Changes

These modules can stay focused on their current responsibilities:

- `entities`
- `events`
- `trackers`
- `entity-schemas`
- `event-schemas`

The runtime module should query against the underlying tables and repositories it needs without forcing CRUD endpoints to change shape.

## Built-in Saved View Bootstrap Changes

Built-in saved views are currently created with minimal definitions during authentication/bootstrap and during custom entity-schema creation.

These areas will need updates:

- `apps/app-backend/src/modules/authentication/bootstrap/manifests.ts`
- `apps/app-backend/src/modules/authentication/service.ts`
- `apps/app-backend/src/modules/entity-schemas/repository.ts`

They should start producing the richer saved-view structure so built-in views and user-defined views follow the same contract.

## Backend Implementation Outline

### Phase 1: Fix Saved View Persistence Surface

- add `GET /saved-views/{viewId}`
- add `PATCH /saved-views/{viewId}`
- add `POST /saved-views/{viewId}/clone` (pure copy, no request body)
- add `queryDefinition` jsonb column to store query semantics (entitySchemaSlugs, filters, sort)
- add `displayConfiguration` jsonb column to store presentation config (layout, grid config, list config, table config)
- make both columns required with validation
- update bootstrap paths that create built-in views with all required fields

### Phase 2: Build Real Runtime Execution

- replace the placeholder `entitySchemaId` request with a compiled runtime request
- add support for `fields` parameter (schema-qualified property paths like `["smartphones.manufacturer", "tablets.maker"]`)
- add support for `displayConfiguration` parameter with property reference arrays
- implement COALESCE resolution for cross-schema property references in displayConfiguration
- validate that all referenced schema slugs exist and user has access to them
- implement filter execution using the schema-qualified property syntax (AND within each schema, OR across schema boundaries)
- implement sort execution with COALESCE for cross-schema property paths
- support pagination
- return `items + total + page metadata` with `resolvedProperties` for frontend rendering

### Phase 3: Move Frontend View Route To Runtime

- change frontend route to `/views/$viewId`
- fetch saved view by id
- extract active layout from `displayConfiguration.layout`
- compile runtime payload from `queryDefinition` + active layout config
  - derive `fields` from the active layout config and pass `displayConfiguration` for COALESCE resolution
- execute via `POST /view-runtime/execute`
- render returned entities using `resolvedProperties` from the runtime response
- remove assumptions that saved views live under a tracker route

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

- `notIn` (inverse of `in`)
- `notContains` (string negation)
- `between` (range queries, syntactic sugar for `gte` + `lte`)
- `regex` (pattern matching, use with caution for performance)
- `isEmpty` / `isNotEmpty` (for array/object properties)

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
  "entitySchemaSlugs": ["movies"],
  "filters": [ /* entity property filters */ ],
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
    "field": ["member_of.bought_when"],
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
      "propertyValues": { /* entity properties */ },
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

## Recommended First Step

Start by redesigning the saved-view schema and API surface before writing runtime SQL.

Reason: the runtime contract depends on what the frontend will compile from a saved view, and that only becomes stable once the persisted saved-view shape is defined clearly.
