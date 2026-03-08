# Event Schema Slice Design

## Goal

Implement the next custom-tracker platform slice so a user can add `event_schema` records to one of their own custom `entity_schema` records, see existing event schemas inline on the custom facet schema-management page, and stay fully inside the unified entity-schema-event model.

## Product boundaries

- Scope is limited to `event_schema` list/create behavior plus minimal inline UI on the existing custom facet page.
- A facet can own many entity schemas, and an entity schema can own many event schemas.
- Built-in facets and built-in entity schemas are read-only in this custom schema-management flow.
- No surface may assume Media or Fitness exists.
- The unified model remains sacred: no facet-specific tables, shortcuts, or special storage paths.
- Schema evolution in UI remains additive and non-breaking.
- Explicitly out of scope: entity CRUD, event instance logging, editing/deleting event schemas, saved views, query builder, dashboard work, navigation restructuring, and built-in facet management UI changes.

## Existing integration points

### Backend

- `apps/app-backend/src/db/schema/tables.ts` already defines `event_schema` with `entitySchemaId`, `userId`, `name`, `slug`, and `propertiesSchema`.
- `apps/app-backend/src/db/schema/relations.ts` already wires `entity_schema -> event_schema`.
- `apps/app-backend/src/db/seed/helpers.ts` already seeds built-in event schemas for built-in entity schemas.
- `apps/app-backend/src/modules/entity-schemas/*` is the canonical module shape to mirror.
- `apps/app-backend/src/modules/facets/access.ts` already demonstrates the small access-helper pattern used in rewrite modules.

### Frontend

- `apps/app-frontend/src/routes/_protected/tracking/$facetSlug.tsx` is the existing custom facet schema-management page and already renders entity schema cards plus an inline create flow.
- `apps/app-frontend/src/features/entity-schemas/*` already provides the form, property-builder, hooks, and model pattern to mirror.
- The current property-builder UI is row-based and flat; this slice should reuse that structure for event schemas rather than inventing nested editing.

## Database/schema audit

The existing `event_schema` table is sufficient for this slice:

- `entitySchemaId` foreign key already anchors ownership to an entity schema.
- `userId` supports per-user ownership for custom event schemas.
- `unique("event_schema_user_entity_schema_slug_unique").on(table.userId, table.entitySchemaId, table.slug)` already defines the slug uniqueness model.
- `propertiesSchema jsonb not null` already stores the schema payload.

No migration is required.

The remaining safety rules are application-level:

- the target entity schema must exist
- it must belong to the requesting user
- it must not be built-in
- list/create behavior must stay scoped to that entity schema only

## Backend design

Add a new top-level `event-schemas` backend module:

- `GET /event-schemas?entitySchemaId=...`
- `POST /event-schemas`

### Data flow

1. Resolve the authenticated user.
2. Resolve the target entity schema from `entitySchemaId`.
3. Reject when the entity schema is missing, belongs to another user, or is built-in.
4. For create:
   - normalize/derive slug from `name` or `slug`
   - validate a non-empty flat `propertiesSchema`
   - reject when another event schema already uses the same slug for that user + entity schema
   - insert the new `event_schema`
5. Return the created event schema or entity-schema-scoped event schema list.

### Module shape

Create `apps/app-backend/src/modules/event-schemas/` with:

- `service.ts` for pure parsing/normalization helpers
- `schemas.ts` for OpenAPI/Zod route contracts
- `repository.ts` for list/create/lookup access
- `routes.ts` for Hono routes and error mapping
- pure tests only

Mount the module in `apps/app-backend/src/app/api.ts` as `/event-schemas`.

### Access rules

Introduce a small entity-schema access helper consistent with the current rewrite style. It should distinguish:

- `not_found` when the entity schema does not exist for the current user
- `builtin` when the entity schema exists but is built-in

This keeps list/create route logic small and avoids duplicating ownership checks.

### Validation rules

- `entitySchemaId`: non-empty trimmed string
- `name`: required trimmed string
- `slug`: optional input, normalized from `name` when omitted
- `propertiesSchema`: JSON object representing the same flat app-schema property map already used by entity schemas

The backend validator should stay compatible with the existing app-schema conventions:

- accept already-parsed object input
- require an object root
- require at least one property
- require each property definition to have a valid `type`
- support the same primitive/array/object recursive validation already used by entity schemas

To keep the rewrite slices consistent, the property-schema parsing and route-contract helpers should be shared between `entity-schemas` and `event-schemas` rather than duplicated.

### Error handling

Backend responses should distinguish:

- `404` when the entity schema does not exist for the current user
- `400` when the entity schema is built-in
- `400` when the payload is invalid
- `400` when the event schema slug already exists for that user + entity schema

## Frontend design

Keep all UI inside `apps/app-frontend/src/routes/_protected/tracking/$facetSlug.tsx`.

### Built-in facet behavior

- Keep the current read-only custom-schema-management message.
- Do not expose event-schema controls anywhere for built-in facets.

### Custom facet behavior

- Keep the current entity schema section as the top-level management surface.
- Under each entity schema card, add a compact `Event schemas` section.
- Show an inline empty state when an entity schema has no event schemas.
- Show existing event schemas under the correct entity schema card.
- Add an `Add event schema` action scoped to that entity schema.
- Open a modal create form that captures:
  - `name`
  - `slug`
  - `propertiesSchema`

### Form shape

Reuse the current flat row-based property builder approach from `entity-schemas`:

- same key/type/required row structure
- same client-side uniqueness checks for property keys
- same payload serialization pattern to the app-schema flat map as an object payload

Create a separate frontend `event-schemas` feature module mirroring the entity-schema feature shape, rather than overloading the existing feature files.

### Frontend data flow

- The route already fetches entity schemas for the custom facet.
- For event schemas, query by `entitySchemaId` per card using a dedicated hook.
- On successful creation, invalidate only the affected entity schema's event-schema query so the new item appears in place.
- Keep the generated UI practical and compact; no new route, drawer, or wizard.

## Test strategy

No DB-backed tests.

### Backend tests

Add pure tests following the `entity-schemas` pattern:

- service tests for name/entitySchemaId/slug normalization
- service tests for event-schema `propertiesSchema` parsing and validation
- access helper tests for `not_found` vs `builtin` vs allowed cases if the helper is extracted into pure logic

### Frontend tests

Add Bun unit tests following the `entity-schemas` pattern:

- form default values
- property-row validation
- payload serialization for create requests
- any extracted model/view-state helper for event-schema empty/list rendering

No route-level tests requiring a browser and no server/integration tests.

## Verification plan

- `bun test 'src/modules/event-schemas/service.test.ts'` in `apps/app-backend`
- `bun test 'src/features/event-schemas/form.test.ts' 'src/features/event-schemas/model.test.ts'` in `apps/app-frontend`
- `bun run turbo test --filter='@ryot/app-backend' --filter='@ryot/app-frontend'`
- `bun run turbo typecheck --filter='@ryot/app-backend' --filter='@ryot/app-frontend'`

## Notes

- No database migration is expected.
- No DB-connected or server-backed tests will be added.
- The slice intentionally stops at `event_schema` list/create plus minimal inline schema-management UI.
