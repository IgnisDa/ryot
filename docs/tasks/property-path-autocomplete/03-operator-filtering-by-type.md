# Operator Filtering by Property Type

**Parent Plan:** [Property Path Autocomplete](./README.md)

**Type:** AFK

**Status:** done

## What to build

Using `resolvePropertyType` (Task 01) and the `schemas` prop now available on `FiltersBuilder` (Task 02), filter the operator `Select` options in each filter row to only show operators that make semantic sense for the resolved property type.

Define an operator compatibility map (a plain constant) that maps each resolved type to the set of allowed operator values:
- `"boolean"` → `eq`, `ne`, `isNull`
- `"string"` → `eq`, `ne`, `in`, `isNull`
- `"number"` / `"integer"` / `"date"` → `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `isNull`
- `"array"` → `in`, `isNull`
- `"object"` / `null` (unknown or unresolved) → all operators (no restriction)

When the filter field path changes to a type where the current `op` is no longer in the allowed set, reset `op` to `"eq"` automatically. This reset should be reactive: it fires whenever the field path changes, not just on initial render.

The operator `Select` should derive its `data` prop by filtering `OPERATOR_OPTIONS` through the compatibility map on each render.

## Acceptance criteria

- [ ] Selecting a `boolean` property field shows only `eq`, `ne`, `isNull` in the operator dropdown
- [ ] Selecting a `string` property field shows `eq`, `ne`, `in`, `isNull`
- [ ] Selecting a `number` or `integer` property shows `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `isNull`
- [ ] Selecting a `date` property shows `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `isNull`
- [ ] Selecting an `array` property shows `in`, `isNull`
- [ ] When field is empty or unresolvable, all operators are shown
- [ ] If the current `op` becomes invalid after a field change (e.g. `in` was set, then field changed to `boolean`), `op` resets to `"eq"` automatically
- [ ] `@name` resolves to `string` operator set
- [ ] `@createdAt` and `@updatedAt` resolve to the date operator set

## Blocked by

- [Task 01](./01-resolve-property-type-utility.md)
- [Task 02](./02-property-path-autocomplete-component.md)

## User stories addressed

- User story 5 (operator dropdown filtered by type)
- User story 9 (`in` blocked for non-string/array types)
- User story 18 (full comparison set for number/integer/date)
- User story 19 (eq, ne, isNull for boolean)
- User story 20 (eq, ne, in, isNull for string)
- User story 21 (in, isNull for array)
