# PropertyPathAutocomplete Component + Schema Fetching + Filter Field Wiring

**Parent Plan:** [Property Path Autocomplete](./README.md)

**Type:** AFK

**Status:** done

## What to build

Three things delivered as one vertical slice that is immediately demoable: a new schema-by-slugs hook, the `PropertyPathAutocomplete` UI component, and the wiring that connects it to the filter field input.

**Schema fetching hook:** Add a `useEntitySchemasBySlugQuery(slugs)` hook that calls `GET /entity-schemas?slugs[]=...`. The regenerated OpenAPI types already include the `slugs` parameter. The `SavedViewExtendedForm` should subscribe to the current `entitySchemaSlugs` form value, use this hook to fetch the corresponding schema objects, and pass the resulting `schemas` array as a new prop to `FiltersBuilder` (and later to `SortBuilder` and `DisplayConfigBuilder` in Task 05).

**`PropertyPathAutocomplete` component:** A component wrapping Mantine `Autocomplete` that:
- Accepts `schemas: AppEntitySchema[]`, `excludeImage: boolean`, and standard text field props
- Derives grouped option data: one group per schema slug listing `slug.propertyName` for every top-level property in that schema; a "Built-in" group with `@name`, `@createdAt`, `@updatedAt` (and `@image` when `excludeImage` is false)
- Array-type properties are included as options
- When `schemas` is empty or the hook is loading: renders disabled with placeholder "Add entity schemas first"
- User can freely type any value not in the list (Autocomplete, not Select)

**Filter field wiring:** In `FiltersBuilder`, replace the filter row field `TextField` with `PropertyPathAutocomplete` using `excludeImage: true`. The `schemas` prop flows from `SavedViewExtendedForm` → `FiltersBuilder` → each filter row.

The built-in path help text in `FiltersBuilder` can be removed once autocomplete is in place, since the options make the path syntax self-evident.

## Acceptance criteria

- [ ] `GET /entity-schemas?slugs[]=...` is called with the current form's `entitySchemaSlugs` value
- [ ] The query re-fires reactively when `entitySchemaSlugs` changes in the form
- [ ] `PropertyPathAutocomplete` renders disabled with "Add entity schemas first" when `schemas` is empty
- [ ] Suggestions are grouped by schema slug (e.g. group "anime" contains "anime.year", "anime.status")
- [ ] Built-in paths `@name`, `@createdAt`, `@updatedAt` appear in a "Built-in" group
- [ ] `@image` does not appear in the filter field autocomplete suggestions
- [ ] User can type a path not present in the suggestion list and it is accepted
- [ ] Filter field in each filter row uses `PropertyPathAutocomplete` instead of `TextField`
- [ ] Component tests cover: disabled state, built-in group, @image exclusion, schema-grouped options, free-text acceptance

## Blocked by

None — can start immediately (in parallel with Task 01).

## User stories addressed

- User story 1 (filter field suggests paths)
- User story 2 (grouped by schema slug)
- User story 3 (built-in paths in suggestions)
- User story 4 (free-text still works)
- User story 11 (disabled with placeholder when no schemas)
- User story 14 (@image excluded from filter)
- User story 16 (suggestions update when schemas change)
