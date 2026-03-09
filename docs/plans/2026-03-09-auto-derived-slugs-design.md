# Auto-Derived Slugs Design

## Goal

Automatically derive slugs from the user-entered name in the frontend wherever slug is requested, while still allowing the user to override the slug manually.

## Context

- The backend already centralizes slug normalization and required-string validation in `apps/app-backend/src/lib/slug.ts`.
- The frontend currently asks for `name` and `slug` separately in facet, entity schema, and event schema creation flows.
- TanStack Form recommends using field listeners for side effects such as updating one field in response to another field changing.

## Decision

Use TanStack Form field `listeners.onChange` on the `name` field to update `slug` as a side effect.

The slug should keep auto-updating while either of these conditions is true:

1. The slug field is still empty.
2. The slug field still equals the previously auto-derived slug for the prior name.

Once the user edits slug so it no longer matches the currently derived value, the form should treat slug as customized and stop overwriting it on subsequent name changes.

## Shared Utility Move

Move the slug helpers from `apps/app-backend/src/lib/slug.ts` to `libs/ts-utils/src/slug.ts` and export them through `libs/ts-utils/src/index.ts`.

Shared exports:

- `normalizeSlug`
- `resolveRequiredSlug`
- `resolveRequiredString`

This keeps frontend and backend slug normalization aligned and avoids duplicate behavior.

## Frontend Integration

### Facets

Add the auto-derivation behavior in `apps/app-frontend/src/features/facets/components/facet-form.tsx` because this form is not built on the shared property-schema form hook.

### Entity Schemas and Event Schemas

Add the behavior in `apps/app-frontend/src/features/property-schemas/use-form.ts` so both schema-creation flows inherit the same behavior through:

- `apps/app-frontend/src/features/entity-schemas/use-form.ts`
- `apps/app-frontend/src/features/event-schemas/use-form.ts`

## Behavior Details

- Create forms start with an empty slug field.
- Typing a name derives a normalized slug in real time.
- Clearing the name clears the derived slug.
- Manually editing slug stops future automatic updates from name changes.
- Existing edit/update forms with a prefilled slug should not be treated as untouched; they should preserve the saved slug unless the user edits it directly.

## Testing

Add test coverage for:

- shared slug utility exports and normalization behavior
- property-schema form value derivation helpers used by entity/event schema creation
- facet form value derivation helpers
- payload behavior remaining unchanged after the move

UI integration will be kept lightweight by testing the derivation logic in shared helpers rather than introducing broad component-level form interaction tests.

## Risks and Mitigations

- Risk: overwriting a user-customized slug after further name edits.
  - Mitigation: only auto-update when current slug is empty or still matches the previous derived slug.
- Risk: divergence between frontend and backend normalization rules.
  - Mitigation: move normalization into `@ryot/ts-utils` and import it from both apps.
