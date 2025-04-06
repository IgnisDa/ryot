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

- `entitySchemaIds: string[]`
- `filters: []` or another validated filter structure
- `sort: { key: string, direction: "asc" | "desc" }`
- `page: { limit: number, offset: number }`
- `fields: string[]` — which entity property keys to return in `propertyValues`
- `include: { latestEvent?: boolean, eventCount?: boolean, schemaMeta?: boolean }`

Suggested response shape:

- `items: []`
- `total: number`
- `limit: number`
- `offset: number`

Each item should include at least:

- core entity fields (id, name, createdAt, etc.)
- `propertyValues` — filtered to requested fields from the `fields` parameter
- `entitySchemaId`
- optional schema metadata when runtime spans multiple schemas
- optional event summary fields needed by the saved-view UI

The runtime contract should stay generic enough that the frontend can compile both built-in curated views and user-authored saved views into the same payload.

### Field Selection Design

Different views over the same schema may need to display different properties based on their purpose.

Example: A "Smartphones" schema with properties `[manufacturer, year, os, screen_size, storage_gb, ram_gb, price_usd]` might have:

- View 1 filtered to Samsung phones from recent years → display `manufacturer` and `year`
- View 2 filtered to older Android phones → display `os` and `year` (manufacturer irrelevant)

The saved view should store which properties matter for that view's purpose. The runtime request requires a `fields` parameter that specifies which property keys to return, avoiding waste when entities have large propertyValues objects.

This makes field selection explicit and forces callers to think about what data they actually need.

## Saved View Data Model Changes

The current saved-view definition only stores:

- `entitySchemaIds: string[]`

That is too small for the saved-view renderer that was designed. A saved view needs to store both query semantics and presentation configuration.

The saved view schema should include:

- `name: string` — view name
- `icon?: string` — optional icon identifier
- `accentColor?: string` — optional accent color
- `trackerId?: string` — optional tracker FK for sidebar grouping (purely display-related)
- `isBuiltIn: boolean` — whether this is a built-in protected view
- `queryDefinition: jsonb` — the data query (required)
- `displayConfiguration: jsonb` — the presentation config (required)

The `queryDefinition` column stores:

- `entitySchemaIds: string[]` — which schemas to query
- `filters: FilterExpression[]` — attribute filters to apply
- `sort: { key: string, direction: "asc" | "desc" }` — how to order results
- `eventConditions: []` — event-based conditions (future)

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
    "sort": { "field": "year", "direction": "desc" },
    "eventConditions": []
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
    "sort": { "field": "year", "direction": "asc" },
    "eventConditions": []
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
    "fields": ["name", "manufacturer", "year", "price_usd", "product_image"]
  }
  ```

  The `fields` parameter is derived from the active layout's config (grid in this case): `imageProperty`, `titleProperty`, `subtitleProperties`, and `badgeProperty`.

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

`POST /saved-views/{viewId}/clone` is preferred over implementing clone purely in the frontend because clone is now a first-class action in the product.

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

This is needed to support cloning built-in and custom views cleanly.

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
- add `POST /saved-views/{viewId}/clone`
- add `queryDefinition` jsonb column to store query semantics (entitySchemaIds, filters, sort, eventConditions)
- add `displayConfiguration` jsonb column to store presentation config (layout, grid config, list config, table config)
- make both columns required with validation
- update bootstrap paths that create built-in views with all required fields

### Phase 2: Build Real Runtime Execution

- replace the placeholder `entitySchemaId` request with a compiled runtime request
- add support for `fields` parameter to filter which entity properties are returned
- validate access for all referenced schemas
- support sort and pagination first
- return `items + total + page metadata`
- add optional event-derived fields only when requested by the payload

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

## Open Questions

These should be resolved before implementation starts:

- what exact filter grammar should the compiled runtime payload use?
- should event-derived fields be in the initial runtime response, or added in a second pass?
- does clone need any request body fields, or can it always derive from the existing saved view?
- for cross-schema views, should field selection apply per-schema or globally? (probably globally, since frontend renders one unified list)

## Recommended First Step

Start by redesigning the saved-view schema and API surface before writing runtime SQL.

Reason: the runtime contract depends on what the frontend will compile from a saved view, and that only becomes stable once the persisted saved-view shape is defined clearly.
