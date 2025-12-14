## Problem Statement

When editing a saved view's query definition and display configuration, users must type property paths (e.g. `anime.year`, `@name`) as raw free-text strings with no guidance. There is no indication of which properties exist on the selected entity schemas, no prevention of typos, and no contextual help for choosing the right operator or entering a value in the correct format. The backend will silently reject invalid paths or produce incorrect results if a value is the wrong type — but the user only finds this out after saving and observing broken results.

## Solution

Replace every free-text property path input in the saved view editor with a smart `PropertyPathAutocomplete` component that derives suggestions from the entity schemas currently selected in the view. When a filter field path is resolved to a known property type, the operator dropdown is filtered to only show compatible operators, and the value input changes to a type-appropriate control (number input, boolean select, date picker, etc.). This removes the need for the user to memorise path syntax or property names.

## User Stories

1. As a view editor, I want the filter field input to suggest property paths from the schemas in my view, so that I don't have to memorise exact property names.
2. As a view editor, I want suggestions grouped by schema slug, so that I can quickly find the right property when my view spans multiple schemas.
3. As a view editor, I want built-in paths (`@name`, `@createdAt`, `@updatedAt`) always offered as suggestions, so that I can filter on common entity attributes without guessing the syntax.
4. As a view editor, I want to still be able to type a path manually that isn't in the suggestion list, so that I retain flexibility for advanced use cases.
5. As a view editor, I want the operator dropdown to only show operators compatible with the selected field's type, so that I don't accidentally create a semantically invalid filter.
6. As a view editor, I want a boolean property's value input to be a select with "true" and "false" options, so that I can't accidentally type an invalid boolean string.
7. As a view editor, I want a number or integer property's value input to be a number input, so that I can't accidentally enter non-numeric text.
8. As a view editor, I want a date property's value input to be a date picker, so that I get a formatted date string in the correct format without needing to know ISO syntax.
9. As a view editor, I want the `in` operator to only be available for string and array properties, so that I don't attempt comma-split filtering on booleans or dates.
10. As a view editor, I want the value input to clear and the operator to reset when I change the field path, so that stale values from a previous property type don't carry over.
11. As a view editor, I want the field autocomplete to be disabled with a descriptive placeholder when no entity schemas are selected, so that I understand why I can't type a path yet.
12. As a view editor, I want sort field inputs to also offer property path autocomplete (including `@image`), so that I can discover sortable properties the same way I discover filterable ones.
13. As a view editor, I want display configuration property path inputs (grid/list image, title, badge, subtitle; table column property) to also offer autocomplete, so that the discovery experience is consistent across all path inputs in the form.
14. As a view editor, I want `@image` excluded from filter field suggestions, since the backend explicitly does not support filtering on it, so that I am not offered a path that will always fail.
15. As a view editor, I want `@image` included in sort and display config path suggestions, since it is valid in those contexts, so that I can set it as an image property or sort target.
16. As a view editor, I want the autocomplete options to update live as I add or remove entity schemas from the view, so that the suggestions always reflect the current configuration.
17. As a view editor, I want the form to store filter values as their native type (number, boolean, or string) rather than always as strings, so that the API payload is accurate and predictable.
18. As a view editor, I want the full comparison operator set (eq, ne, gt, gte, lt, lte, isNull) to be available for number, integer, and date properties, so that I can write range-style filters.
19. As a view editor, I want `eq`, `ne`, and `isNull` for boolean properties, so that I can filter on true/false/missing values without nonsensical operators like "greater than".
20. As a view editor, I want `eq`, `ne`, `in`, and `isNull` for string properties, so that I can match exact values or test membership in a set.
21. As a view editor, I want `in` and `isNull` for array properties, so that I can test membership across the array's values.

## Implementation Decisions

### New shared utility: `resolvePropertyType`
A pure function that accepts a field path string and an array of entity schemas, and returns the resolved primitive type (`"string" | "number" | "integer" | "boolean" | "date" | "array" | "object" | null`). Handles the three path forms:
- `@name` → `"string"`, `@createdAt` / `@updatedAt` → `"date"`, `@image` → `null` (not filterable)
- `schema.property` → looks up the schema by slug in the schemas array, then returns `propertiesSchema[property].type`
- Unqualified `property` (single-schema views) → looks in the first (and only) schema
Returns `null` when the path is unknown, empty, or references a schema that is not in the schemas array.

### New shared component: `PropertyPathAutocomplete`
Wraps Mantine `Autocomplete` (free-text input with dropdown suggestions). Accepts:
- `schemas` — the array of entity schemas to derive options from
- `excludeImage` — boolean flag to omit `@image` from the suggestions (true for filter context)
- Standard Mantine field props forwarded to the underlying `Autocomplete`

Option generation:
- One Mantine group per schema slug, listing `slug.propertyName` for each top-level property in that schema's `propertiesSchema` (top-level only — the backend path parser rejects paths with more than two dot-separated segments)
- Array-type properties are included as valid options
- A "Built-in" group with `@name`, `@createdAt`, `@updatedAt` (and `@image` when `excludeImage` is false)
- When `schemas` is empty or loading: the input is disabled with placeholder "Add entity schemas first"
- When `schemas` is non-empty but a group would be empty: that group is omitted

### Filter form value type change
`FilterRow.value` changes from `string` to `string | number | boolean`. The `filterRowSchema` in `form-extended.ts` is updated accordingly. `buildApiFilter` simplifies: for comparison operators, the value is passed through as-is; for `in`, the value is expected to be a string that gets split by comma (only available on string/array fields); for `isNull`, value is `null`.

### Updated `FiltersBuilder` component
Each filter row subscribes to the resolved property type for its current field value. The operator `Select` is re-derived on each render by filtering `OPERATOR_OPTIONS` against the resolved type using the operator compatibility map. The value field renders the appropriate control:
- `"number"` / `"integer"` → `NumberInput`
- `"boolean"` → `Select` with options `[{ label: "True", value: true }, { label: "False", value: false }]`
- `"date"` → Mantine `DateInput` (serialised to `YYYY-MM-DD` ISO string, stored as string in `FilterRow.value`)
- everything else → `TextInput`

When the field path changes, `FilterRow.value` is reset to `""` and `FilterRow.op` is reset to `"eq"`.

### Updated sort builder
The sort field `TextField` is replaced with `PropertyPathAutocomplete` with `excludeImage: false`.

### Updated display config fields
Every property path `TextField` in the grid, list, and table config sections is replaced with `PropertyPathAutocomplete` with `excludeImage: false`.

### Operator compatibility map
A plain constant maps each resolved type to the set of allowed operator values. Used both to filter the `Select` options and to reset `op` when the field changes to a type where the current operator is no longer valid.

### Schema fetching in the view editor
The view editor fetches entity schemas using the `GET /entity-schemas?slugs[]=...` endpoint, passing the `entitySchemaSlugs` currently held in the form. The result is passed down to all path-autocomplete-aware components as a `schemas` prop. No `trackerId` dependency. The query re-runs when `entitySchemaSlugs` changes.

## Testing Decisions

Good tests verify external behaviour through the module's public interface — they do not assert on internal variable names, component structure, or implementation details.

### `resolvePropertyType` utility
Unit tests covering:
- `@name` returns `"string"`, `@createdAt` and `@updatedAt` return `"date"`, `@image` returns `null`
- Unknown `@something` returns `null`
- `schema.property` returns the correct type when the schema and property exist
- `schema.property` returns `null` when the schema is not in the array
- `schema.property` returns `null` when the property does not exist in the schema
- Empty/blank path returns `null`

### `buildApiFilter` (updated)
Unit tests covering the new native-typed value passthrough:
- Comparison filter with a number value passes the number through unchanged
- Comparison filter with a boolean value passes the boolean through unchanged
- `in` filter splits the string value by comma and trims whitespace
- `isNull` filter sets value to null regardless of input

Prior art: existing `form-extended.ts` tests if any exist; otherwise follows the pattern of unit tests in `features/saved-views`.

### `PropertyPathAutocomplete` (component)
Integration-style tests (React Testing Library):
- Renders disabled with placeholder text when `schemas` is empty
- Shows built-in options (`@name`, `@createdAt`, `@updatedAt`) in the "Built-in" group
- Does not show `@image` when `excludeImage` is true
- Shows `@image` when `excludeImage` is false
- Shows schema-qualified options grouped by slug
- User can type a custom value not in the list and it is accepted

## Out of Scope

- Nested object property path traversal (e.g. `schema.metadata.author`). The backend path parser only supports two-segment paths.
- Type-aware value inputs for the `in` operator on non-string/array fields. `in` is blocked for boolean and date types via operator filtering.
- Validation that the user-typed free-text path actually resolves against the schema before saving. Server-side validation already handles this.
- Autocomplete for the entity schema slug selector itself (handled separately).
- Per-property value enumeration (e.g. showing all distinct values for a string property). That would require a separate API.
- Datetime precision for date inputs. The `type: "date"` in `AppPropertyDefinition` is mapped to `DateInput` (date-only). Full datetime precision is not distinguishable at runtime.

## Further Notes

- The `GET /entity-schemas?slugs[]=...` query parameter is present in the backend but was not yet reflected in the generated OpenAPI types; those types have since been regenerated.
- `@image` is explicitly blocked in the backend filter builder (`ViewRuntimeValidationError: 'Unsupported filter column @image'`) but is valid in sort and display configuration contexts.
- `PropertyType` returned by `resolvePropertyType` will include `"array"` and `"object"` for non-primitive top-level properties. Only `"array"` has defined operator compatibility (`in`, `isNull`). `"object"` type properties should be treated the same as an unknown/unresolved type for operator filtering.
- The `DateInput` value serialisation: Mantine `DateInput` returns a `Date | null`. Serialise to `YYYY-MM-DD` string before storing in `FilterRow.value` (which is `string | number | boolean`).

---

## Tasks

**Overall Progress:** 0 of 5 tasks completed

**Current Task:** [Task 01](./01-resolve-property-type-utility.md) (todo)

### Task List

| # | Task | Type | Status | Blocked By |
|---|------|------|--------|------------|
| 01 | [resolvePropertyType Utility](./01-resolve-property-type-utility.md) | AFK | todo | None |
| 02 | [PropertyPathAutocomplete Component + Schema Fetching + Filter Field Wiring](./02-property-path-autocomplete-component.md) | AFK | todo | None |
| 03 | [Operator Filtering by Property Type](./03-operator-filtering-by-type.md) | AFK | todo | Task 01, Task 02 |
| 04 | [Type-Aware Value Inputs + FilterRow.value Type Change + Field Reset](./04-type-aware-value-inputs.md) | AFK | todo | Task 03 |
| 05 | [Sort Field + Display Config Property Path Autocomplete](./05-sort-and-display-config-autocomplete.md) | AFK | todo | Task 02 |
