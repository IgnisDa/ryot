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

- `entitySchemaIds: string[]` — which schemas to query
- `filters: FilterExpression[]` — flat array of filters with implicit AND logic (compound OR/nested logic deferred to Phase 2)
- `sort: { field: string, direction: "asc" | "desc" }` — how to order results
- `page: { limit: number, offset: number }` — pagination parameters
- `fields: string[]` — which entity property keys to return in `propertyValues` (applies globally across all schemas)
- `include: { schemaMeta?: boolean }` — optional metadata flags (event-related fields deferred to Phase 2)

Each filter in the `filters` array has the shape:

- `field: string` — property name to filter on (or "name" for the top-level name column)
- `op: string` — operator: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `contains`, `in`, `isNull`
- `value: any` — the value to compare against (type depends on the property being filtered)

Suggested response shape:

- `items: []`
- `total: number`
- `limit: number`
- `offset: number`

Each item should include at least:

- core entity fields (id, name, image, createdAt, etc.) — note that `name` and `image` are top-level entity columns, not in `propertyValues` (see "Entity Structure: Top-Level vs PropertyValues" section)
- `propertyValues` — filtered to requested fields from the `fields` parameter
- `entitySchemaId`
- optional schema metadata when runtime spans multiple schemas (included when `include.schemaMeta: true`)

**Note**: Event-related fields (lastEventDate, eventCount, averageRating) are intentionally excluded from Phase 1. These will be added in Phase 2 alongside event-based filtering capabilities.

The runtime contract should stay generic enough that the frontend can compile both built-in curated views and user-authored saved views into the same payload.

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

**Filter handling**: The view-runtime query builder handles this hybrid structure by checking the filter field — filters on `name` query the top-level column, while all other filters query into `propertyValues`. This is a trivial special case that preserves significant performance benefits.

### Field Selection Design

Different views over the same schema may need to display different properties based on their purpose.

Example: A "Smartphones" schema with properties `[manufacturer, year, os, screen_size, storage_gb, ram_gb, price_usd]` might have:

- View 1 filtered to Samsung phones from recent years → display `manufacturer` and `year`
- View 2 filtered to older Android phones → display `os` and `year` (manufacturer irrelevant)

The saved view should store which properties matter for that view's purpose. The runtime request requires a `fields` parameter that specifies which property keys to return, avoiding waste when entities have large propertyValues objects.

This makes field selection explicit and forces callers to think about what data they actually need.

**Cross-schema field selection**: For saved views that query multiple schemas (e.g., both "Movie" and "TV Show"), the `fields` parameter applies globally across all schemas. If a requested field exists in one schema but not another, entities from the schema without that property simply return null/undefined for that field. This design choice is driven by frontend rendering — since cross-schema views render a unified list with consistent card/table structure, all items must have the same field shape. Per-schema field selection would break unified rendering.

## Saved View Data Model Changes

The current saved-view definition only stores:

- `entitySchemaIds: string[]`

That is too small for the saved-view renderer that was designed. A saved view needs to store both query semantics and presentation configuration.

The saved view schema should include:

- `name: string` — view name
- `icon?: string` — optional icon identifier
- `accentColor?: string` — optional accent color
- `trackerId?: string` — optional tracker FK for UI/sidebar placement hint (nullable, used for single-tracker views)
- `isBuiltIn: boolean` — whether this is a built-in protected view
- `queryDefinition: jsonb` — the data query (required)
- `displayConfiguration: jsonb` — the presentation config (required)

**Note on `trackerId`**: This field is purely for UI organization and determines which tracker's sidebar section should display the saved view. It is **not** the source of truth for query scope — the actual schemas/trackers being queried are stored within `queryDefinition.entitySchemaIds`. For cross-tracker views querying multiple schemas, `trackerId` may be null or point to the primary tracker for sidebar placement purposes. The frontend sidebar rendering logic may also examine `queryDefinition` directly to determine appropriate placement when `trackerId` is null.

The `queryDefinition` column stores:

- `entitySchemaIds: string[]` — which schemas to query
- `filters: FilterExpression[]` — flat array of attribute filters (implicit AND logic)
- `sort: { field: string, direction: "asc" | "desc" }` — how to order results

Event-based filtering (e.g., "movies I rated >8", "shows watched in 2024") is deferred to Phase 2 and will be added as an `eventConditions` field once event integration is implemented in the runtime.

The `displayConfiguration` column stores:

- `layout: "grid" | "list" | "table"` — currently active layout
- `grid: {}` — grid layout configuration
- `list: {}` — list layout configuration
- `table: {}` — table layout configuration

All three layout configurations are stored simultaneously so users can switch between layouts in the frontend without losing their configuration. Each layout specifies which entity properties to display and how.

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
  "isBuiltIn": false,
  "queryDefinition": {
    "entitySchemaIds": ["smartphones-schema-id"],
    "filters": [
      { "field": "manufacturer", "op": "eq", "value": "Samsung" },
      { "field": "year", "op": "lt", "value": 2025 }
    ],
    "sort": { "field": "year", "direction": "desc" }
  },
  "displayConfiguration": {
    "layout": "grid",
    "grid": {
      "imageProperty": "product_image",
      "titleProperty": "name",
      "subtitleProperties": ["manufacturer", "year"],
      "badgeProperty": "price_usd"
    },
    "list": {
      "imageProperty": "product_image",
      "titleProperty": "name",
      "subtitleProperties": ["manufacturer", "year", "price_usd"],
      "badgeProperty": null
    },
    "table": {
      "columns": [
        { "property": "name" },
        { "property": "manufacturer" },
        { "property": "year" },
        { "property": "price_usd" }
      ]
    }
  }
}
```

### View 2: Older Android Phones

```json
{
  "name": "Older Android Phones",
  "trackerId": "smartphones-tracker-id",
  "isBuiltIn": false,
  "queryDefinition": {
    "entitySchemaIds": ["smartphones-schema-id"],
    "filters": [
      { "field": "year", "op": "lt", "value": 2020 },
      { "field": "year", "op": "gt", "value": 2001 },
      { "field": "os", "op": "eq", "value": "Android" }
    ],
    "sort": { "field": "year", "direction": "asc" }
  },
  "displayConfiguration": {
    "layout": "list",
    "grid": {
      "imageProperty": "product_image",
      "titleProperty": "name",
      "subtitleProperties": ["os", "year"],
      "badgeProperty": "screen_size"
    },
    "list": {
      "imageProperty": "product_image",
      "titleProperty": "name",
      "subtitleProperties": ["os", "year", "screen_size"],
      "badgeProperty": null
    },
    "table": {
      "columns": [
        { "property": "name" },
        { "property": "os" },
        { "property": "year" },
        { "property": "screen_size" }
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
    "entitySchemaIds": ["smartphones-schema-id"],
    "filters": [
      { "field": "manufacturer", "op": "eq", "value": "Samsung" },
      { "field": "year", "op": "lt", "value": 2025 }
    ],
    "sort": { "field": "year", "direction": "desc" },
    "page": { "limit": 6, "offset": 0 },
    "fields": ["manufacturer", "year", "price_usd", "product_image"]
  }
  ```

  The `fields` parameter is derived from the active layout's config (grid in this case): `imageProperty`, `subtitleProperties`, and `badgeProperty`. Note that `titleProperty` references `name`, which is a top-level entity column (see "Entity Structure: Top-Level vs PropertyValues" section) and doesn't need to be included in `fields`. Similarly, `imageProperty` could reference the top-level `image` column or a schema-defined property in `propertyValues`.

4. `POST /view-runtime/execute` → returns only requested properties in `propertyValues`
5. Frontend renders using `layout` and the appropriate layout config from `displayConfiguration`

This design gives users full control over which properties matter for each layout view, without requiring backend inference or returning wasteful full property sets.

When the user switches from grid to list view in the UI, the frontend simply changes `displayConfiguration.layout` and reruns the query with different `fields` derived from `displayConfiguration.list` instead of `displayConfiguration.grid`.

**Key constraint**: The saved view explicitly stores all three layout configurations. The backend makes no assumptions - clients must be explicit about what data they need and how to present it.

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

`POST /saved-views/{viewId}/clone` is preferred over implementing clone purely in the frontend because clone is now a first-class action in the product. The clone operation is a pure copy with no request body — it duplicates the entire saved view record with a new ID, sets `isBuiltIn: false` (so cloned views are deletable), and appends " (Copy)" to the name. If users want to customize the cloned view, they immediately edit it via `PATCH /saved-views/{viewId}` after cloning. This keeps the clone operation simple and predictable.

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

This is needed to support cloning built-in and custom views cleanly. The operation takes no request body and performs a pure copy (new ID, `isBuiltIn: false`, name appended with " (Copy)").

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
- add `queryDefinition` jsonb column to store query semantics (entitySchemaIds, filters, sort)
- add `displayConfiguration` jsonb column to store presentation config (layout, grid config, list config, table config)
- make both columns required with validation
- update bootstrap paths that create built-in views with all required fields

### Phase 2: Build Real Runtime Execution

- replace the placeholder `entitySchemaId` request with a compiled runtime request
- add support for `fields` parameter to filter which entity properties are returned (global field selection across schemas)
- validate access for all referenced schemas
- implement filter execution (flat array with implicit AND logic, operators: eq, ne, gt, gte, lt, lte, contains, in, isNull)
- support sort and pagination
- return `items + total + page metadata`
- handle special case for `name` filter (top-level column vs propertyValues jsonb)

### Phase 3: Move Frontend View Route To Runtime

- change frontend route to `/views/$viewId`
- fetch saved view by id
- extract active layout from `displayConfiguration.layout`
- compile runtime payload from `queryDefinition` + active layout config (derive `fields` from layout properties)
- execute via `POST /view-runtime/execute`
- render returned entities using the active layout config from `displayConfiguration`
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

- Adding `eventConditions` field to `queryDefinition` structure
- Joining to the events table in view-runtime queries
- Supporting event aggregation filters (count, avg, min, max, latest/earliest date)
- Query builder UI for constructing event-based filter expressions

**Event summary fields**: Including event-derived data in runtime responses (lastEventDate, eventCount, averageRating). Once event filtering is implemented, returning event summaries becomes trivial since the runtime will already be joining to the events table. These fields will be controlled by the `include` parameter (e.g., `include: { eventSummary: true }`).

### Advanced Filter Logic

**Compound filters**: Support for OR logic and nested filter groups. The Phase 1 flat array with implicit AND covers the majority of use cases. More complex boolean logic can be added when the query builder UI actually needs it.

Filter structure for Phase 2 might look like:

```json
{
  "and": [
    { "field": "year", "op": "gte", "value": 2020 },
    {
      "or": [
        { "field": "genre", "op": "contains", "value": "Sci-Fi" },
        { "field": "genre", "op": "contains", "value": "Fantasy" }
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
  "entitySchemaIds": ["movie-schema-id"],
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
        { "field": "bought_where", "op": "eq", "value": "Amazon" }
      ]
    }
  ],
  "sort": {
    "source": "relationship",
    "relationshipIndex": 1,
    "field": "bought_when",
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
- Optional `propertyFilters` on relationships (same filter grammar as entity filters)
- Ability to sort by relationship properties
- Ability to include relationship data in responses
- OR logic for relationships (aligned with compound filter OR logic)

**SQL translation example** ("Nolan movies in 'To Watch'"):

```sql
SELECT e.*
FROM entities e
JOIN relationships r1 ON r1.target_entity_id = e.id  -- incoming
JOIN relationships r2 ON r2.source_entity_id = e.id  -- outgoing
WHERE e.entity_schema_id = 'movie-schema-id'
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
