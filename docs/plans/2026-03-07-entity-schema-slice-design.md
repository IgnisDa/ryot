# Entity Schema Slice Design

## Goal

Implement the first custom-tracker schema slice so a user can add an `entity_schema` to one of their own custom facets, see an empty state before any schemas exist, and see created schemas listed on the custom facet page.

## Product boundaries

- Scope is limited to `entity_schema` create/list behavior plus minimal facet-page UI.
- A newly created custom facet must remain empty.
- Built-in facets are not editable through this flow.
- No surface may assume Media or Fitness exists.
- The unified model remains sacred: no facet-specific parallel tables.
- Explicitly out of scope: `event_schema`, entities, events, saved views, query builder, dashboards, schema editing/deletion, navigation sub-items per schema, and curated built-in facet experiences.

## Existing integration points

### Backend

- `apps/app-backend/src/db/schema/tables.ts` already defines `entity_schema` with `facetId`, `userId`, `name`, `slug`, and `propertiesSchema`.
- `apps/app-backend/src/modules/facets/repository.ts` already contains facet visibility and ownership query patterns.
- `apps/app-backend/src/app/api.ts` already composes top-level backend modules into the OpenAPI app.

### Frontend

- `apps/app-frontend/src/routes/_protected/tracking/$facetSlug.tsx` is the current custom facet landing page and still contains placeholder copy.
- `apps/app-frontend/src/features/facets/hooks.ts` already provides the shared facets query used to resolve a facet from the route.
- `apps/app-frontend/src/features/facets/*` already follows the lightweight utility + form-helper test pattern that this slice should extend.

## Database/schema audit

The existing `entity_schema` table is sufficient for this slice:

- `facetId` foreign key supports facet ownership.
- `userId` supports user-scoped ownership and uniqueness.
- `unique("entity_schema_user_slug_unique").on(table.userId, table.slug)` already enforces slug uniqueness per user.
- `propertiesSchema jsonb not null` supports storing the raw JSON Schema document.

No schema migration is required.

The remaining required safety rules are application-level, not database-level:

- the facet must belong to the current user
- the facet must not be built-in
- list/create behavior must stay scoped to the selected facet

## Backend design

Add a small top-level `entity-schemas` backend module:

- `GET /entity-schemas?facetId=...`
- `POST /entity-schemas`

### Data flow

1. Resolve the authenticated user.
2. Resolve the target facet from `facetId`.
3. Reject when the facet is missing, not user-owned, or built-in.
4. For create:
   - normalize/derive slug from `name` or `slug`
   - validate `propertiesSchema`
   - reject when another schema already uses the same slug for that user
   - insert the new `entity_schema`
5. Return the created schema or facet-scoped schema list.

### Validation rules

- `name`: non-empty trimmed string
- `slug`: optional input, normalized from `name` when omitted
- `propertiesSchema`: JSON object representing a minimal JSON Schema object

For this first slice, the backend will validate only the minimum practical constraints:

- parsed value must be an object
- `type` must be `"object"`
- `properties` must exist and be an object

This is intentionally narrow and keeps the slice practical without pretending to ship a full schema builder.

### Test strategy

No DB-connected tests.

Add service tests for:

- slug normalization/resolution
- create payload resolution
- JSON parsing and `propertiesSchema` validation helpers

Repository behavior will be verified through code inspection against the existing schema and query patterns, not database tests.

## Frontend design

Enhance `/_protected/tracking/$facetSlug` for custom facets only.

### Built-in facet behavior

- Do not show schema-management controls.
- Keep a simple non-editable message explaining that built-in facet management is not handled through this custom flow.

### Custom facet behavior

- Query facet-scoped entity schemas.
- Show an empty state when none exist.
- Show a list when schemas exist.
- Show an `Add schema` action.
- Open a minimal create form capturing:
  - `name`
  - `slug`
  - `propertiesSchema`

The `propertiesSchema` input will be a raw JSON textarea prefilled with:

```json
{"type":"object","properties":{}}
```

This keeps the facet empty on creation while giving the user a minimal working schema authoring surface.

### Frontend module shape

Add a small `entity-schemas` frontend feature module for:

- list/create hooks wrapping the new OpenAPI routes
- form helpers for default values and payload parsing
- pure utilities for JSON textarea parsing/validation

This keeps the facet route thin and avoids overloading the existing facets form helpers.

### Frontend tests

Add Bun unit tests for:

- form default values
- textarea JSON parsing behavior
- payload shaping for create requests
- any extracted route helper that decides whether to show built-in vs custom management content

## Error handling

Backend responses should distinguish:

- `404` when the facet does not exist for the current user
- `400` when the facet is built-in or the payload is invalid
- `400` when the schema slug already exists for the user

Frontend should surface create-form validation errors inline and keep list rendering simple.

## Verification plan

- Backend unit tests for new `entity-schemas` service helpers
- Frontend unit tests for new entity-schema form helpers
- `bun run turbo test --filter='@ryot/app-backend' --filter='@ryot/app-frontend'`
- `bun run turbo typecheck --filter='@ryot/app-backend' --filter='@ryot/app-frontend'`
- `bun run turbo lint --filter='@ryot/app-backend' --filter='@ryot/app-frontend'`

## Notes

- No DB migration is expected.
- No DB-connected test coverage will be added.
- The design intentionally stops at `entity_schema` creation/listing and custom facet page integration.
