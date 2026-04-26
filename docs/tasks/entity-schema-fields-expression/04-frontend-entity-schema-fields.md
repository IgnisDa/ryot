# Frontend: Read Entity Schema Info from Fields

**Parent Plan:** [Entity Schema Fields Expression](./README.md)

**Type:** AFK

**Status:** done

## What to build

Update the frontend saved view page to read entity schema information from the query engine response's `fields` array instead of the now-removed top-level `entitySchemaSlug` attribute.

### Scope

- In `view-page-sections.tsx`, replace all `item.entitySchemaSlug` references with the equivalent value from `item.fields`. The field key will depend on how the saved view's display configuration or query engine request's `fields` array is structured — the entity schema slug must be included as a requested field.
- Update any other frontend components that read `entitySchemaSlug` from query engine response items (check hooks, model transforms, and utility functions that reference this field).
- Ensure entity schema type badges and labels render correctly in grid, list, and table layouts.

### Files

- `apps/app-frontend/src/features/saved-views/view-page-sections.tsx` — primary consumer, lines 148 (grid) and 272 (list)
- Any other frontend files surfaced during exploration that reference `entitySchemaSlug` from query engine results

## Acceptance criteria

- [x] Grid layout displays entity schema slug/name using the fields array
- [x] List layout displays entity schema slug/name using the fields array
- [x] Table layout handles entity schema columns correctly
- [x] No remaining frontend code reads `entitySchemaSlug` as a top-level attribute from query engine items
- [x] The UI renders entity type information without visual regressions

## User stories addressed

- 1: Display entity schema name as table column
- 9: Entity schema fields appear in expression field picker
- 10: API consumer uniform field access
