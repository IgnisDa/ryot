# Entity Schema Properties Builder Design

## Goal

Replace the raw `propertiesSchema` textarea in the entity schema create modal with a dynamic form builder for custom facet schemas.

This first version supports only four field types:

- `string`
- `number`
- `boolean`
- `date`

Each property row includes only:

- `key`
- `type`
- `required`

## Constraints

- Do not change the backend API contract.
- The frontend must still submit `propertiesSchema` as a string in the existing `POST /entity-schemas` payload.
- Do not use git worktrees.
- Keep tests logic-only; do not add DB-connected tests or heavy route integration tests for this slice.
- Follow existing Ryot frontend patterns and keep React components on a single `props` parameter.

## Recommended Approach

Use an array-backed builder in TanStack Form and serialize the rows into JSON Schema only at submit time.

The form state should model authoring intent, not the final wire format. That means the form keeps a list of property rows, and the submit layer converts those rows into the backend's required JSON string.

This approach is preferred over storing the form state directly as a JSON object because renaming a property key is much simpler when keys are values inside rows instead of field-path segments.

## Form Model

Replace the current form shape:

- `name: string`
- `slug: string`
- `propertiesSchema: string`

with:

- `name: string`
- `slug: string`
- `properties: EntitySchemaPropertyRow[]`

Where each row is:

- `key: string`
- `type: "string" | "number" | "boolean" | "date"`
- `required: boolean`

The create modal should start with one empty property row by default.

## UI Design

The entity schema create modal keeps the existing name and slug fields.

The properties section becomes a small builder with:

- a list of property rows
- one text input for the property key
- one select for the type
- one checkbox or switch for required
- a remove action on each row
- an "Add property" action below the list

This version should stay intentionally minimal. There is no label, description, enum editor, nested object support, or advanced JSON Schema editing.

## Serialization

On submit, the frontend converts rows into JSON Schema text.

Base shape:

```json
{
  "type": "object",
  "properties": {}
}
```

Mapping rules:

- `string` -> `{ "type": "string" }`
- `number` -> `{ "type": "number" }`
- `boolean` -> `{ "type": "boolean" }`
- `date` -> `{ "type": "string", "format": "date" }`

If one or more rows are required, add:

```json
{
  "required": ["..."]
}
```

to the top-level object.

Because the backend currently validates a narrow JSON Schema subset, the frontend serializer must stay aligned with that contract.

## Validation

Validation should happen in two layers.

### Builder validation

Validate the authoring rows before serialization:

- at least one property row must exist
- each key must be non-empty after trimming
- keys must be unique after trimming
- type must be one of the supported values

### Final payload validation

After serialization, keep the existing final payload safety check so the frontend still verifies that the generated string is valid JSON Schema text for the current backend expectations.

This keeps the builder easy to reason about while preserving the current defensive boundary.

## TanStack Form Notes

The best fit from the docs is an array field with indexed child fields.

Useful patterns:

- array-backed field state for rows
- reusable field components for row controls
- linked validation for duplicate-key style checks if needed
- submit-time serialization instead of continuous JSON text editing

This slice does not need listeners or advanced linked-field side effects beyond simple row interactions.

## File Shape

Keep most logic outside the route file.

Recommended responsibilities:

- `apps/app-frontend/src/features/entity-schemas/form.ts`
  - builder row types
  - default row creation
  - builder validation helpers
  - JSON Schema serialization
  - form schema
  - payload mapping
- `apps/app-frontend/src/features/entity-schemas/form.test.ts`
  - logic-only tests for row defaults, validation, and serialization
- `apps/app-frontend/src/routes/_protected/tracking/$facetSlug.tsx`
  - modal UI and field wiring

If the route file starts getting too large, extract a small builder component into `apps/app-frontend/src/features/entity-schemas/`.

## Testing Strategy

Keep this change logic-tested only.

Cover:

- default form values include one empty row
- duplicate keys are rejected
- blank keys are rejected
- zero rows are rejected
- supported type serialization is correct
- `date` serializes to `type: string` with `format: date`
- payload mapping still trims name and slug and sends serialized schema text

Do not add DB tests. Do not add new browser-heavy tests unless absolutely necessary.

## Non-Goals

- enum support
- labels or descriptions
- nested builders
- arbitrary JSON Schema editing
- backend contract changes
- edit existing schema flow

## Expected Outcome

Users creating an entity schema for a custom facet will no longer paste JSON manually. Instead, they will add property rows in a structured builder, and the frontend will generate the existing `propertiesSchema` payload for them.
