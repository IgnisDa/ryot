# resolvePropertyType Utility

**Parent Plan:** [Property Path Autocomplete](./README.md)

**Type:** AFK

**Status:** todo

## What to build

A pure, well-tested utility function `resolvePropertyType(field, schemas)` that maps a property path string to the resolved primitive type of that property. This is the logic layer that operator filtering (Task 03) and type-aware value inputs (Task 04) both depend on.

The function must handle all three path forms described in the PRD's Implementation Decisions:
- Built-in paths (`@name`, `@createdAt`, `@updatedAt`) map to known types
- `@image` maps to null (not a filterable/typeable property)
- Unknown `@something` paths map to null
- `schema.property` paths look up the schema by slug in the provided array, then return the type of that top-level property
- Unresolvable paths (schema not found, property not found, empty string) return null

The return type should be the union of all valid `AppPropertyDefinition` types: `"string" | "number" | "integer" | "boolean" | "date" | "array" | "object" | null`.

## Acceptance criteria

- [ ] `resolvePropertyType("@name", anySchemas)` returns `"string"`
- [ ] `resolvePropertyType("@createdAt", anySchemas)` returns `"date"`
- [ ] `resolvePropertyType("@updatedAt", anySchemas)` returns `"date"`
- [ ] `resolvePropertyType("@image", anySchemas)` returns `null`
- [ ] `resolvePropertyType("@unknown", anySchemas)` returns `null`
- [ ] `resolvePropertyType("anime.year", schemasWithAnime)` returns the correct type for the `year` property
- [ ] `resolvePropertyType("anime.year", schemasWithoutAnime)` returns `null`
- [ ] `resolvePropertyType("anime.nonexistent", schemasWithAnime)` returns `null`
- [ ] `resolvePropertyType("", anySchemas)` returns `null`
- [ ] `resolvePropertyType("bareword", anySchemas)` returns `null` (ambiguous single-segment path with multiple schemas)
- [ ] The function is a pure utility with no React dependencies — importable in non-component contexts
- [ ] All cases above are covered by unit tests

## Blocked by

None — can start immediately.

## User stories addressed

Foundation for:
- User story 5 (operator filtered by type)
- User story 6 (boolean select)
- User story 7 (number input)
- User story 8 (date picker)
- User story 9 (in blocked for non-string)
- User stories 18–21 (operator sets per type)
