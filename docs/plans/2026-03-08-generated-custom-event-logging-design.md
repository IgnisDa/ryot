# Generated Custom Event Logging Design

## Goal

Add the minimum generated custom event logging slice to the rewrite stack so users can log events against custom entities from the current tracking page and view those logged events inline.

## Scope

- Add a rewrite backend `events` module with list and create routes only.
- Reuse the existing `event` table.
- Keep logging on the current tracking page; do not add entity detail pages.
- Add a generated frontend `events` feature for inline lists and schema-driven logging forms.
- Update API wiring and mark the roadmap item complete only if the full slice passes verification.

## Backend Design

- Create `apps/app-backend/src/modules/events/` with `repository.ts`, `service.ts`, `schemas.ts`, `routes.ts`, and pure Bun test files.
- Use one access lookup that joins `entity`, `entity_schema`, and `event_schema` visibility concerns so route handlers can validate:
  - the entity belongs to the authenticated user
  - the entity schema is custom, not built in
  - the event schema is owned by the same user
  - the event schema belongs to the same entity schema as the entity
- Validate event payloads in the same style as the entities module:
  - required string normalization helpers for ids
  - `occurredAt` parsing and normalization
  - object-shape guard for `properties`
  - `fromAppSchema`-driven Zod validation for `propertiesSchema`
- Return event list rows with the selected event schema name and slug so the inline timeline can render useful labels without extra joins on the frontend.

## Frontend Design

- Create `apps/app-frontend/src/features/events/` with `model.ts`, `form.ts`, `hooks.ts`, `use-form.ts`, `section.tsx`, and focused Bun tests.
- Keep the UX embedded inside each entity card in `apps/app-frontend/src/features/entities/section.tsx`.
- Each entity card shows:
  - entity name and created date
  - inline logged events list
  - `Log event` action
- The logging modal uses the already-loaded event schemas for that entity schema, lets the user choose one schema, captures `occurredAt`, and then renders generated property fields from that schema.
- Reuse `TextField`, `NumberField`, and `CheckboxField` from `apps/app-frontend/src/hooks/forms.tsx` and keep unsupported property types out of scope for this minimum slice.

## Testing Design

- Backend tests stay pure and avoid DB access.
- Frontend tests stay pure and cover form schema generation, default values, payload conversion, and view-state ordering.
- Verification uses the requested `turbo` test, typecheck, build, and lint commands for backend and frontend only.

## Deferred Work

- Entity detail pages
- Event editing and deletion
- Session-based event grouping
- Rich rendering for nested object or array event property inputs
