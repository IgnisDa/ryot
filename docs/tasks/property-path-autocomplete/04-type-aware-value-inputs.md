# Type-Aware Value Inputs + FilterRow.value Type Change + Field Reset

**Parent Plan:** [Property Path Autocomplete](./README.md)

**Type:** AFK

**Status:** done

## What to build

Replace the one-size-fits-all value `TextField` in each filter row with a type-appropriate input control, and align the form state type with what the backend expects.

**Form state change:** Change `FilterRow.value` from `string` to `string | number | boolean`. Update the `filterRowSchema` in `form-extended` accordingly. Update `buildApiFilter` so that for comparison operators (`eq`, `ne`, `gt`, `gte`, `lt`, `lte`), the value is passed through as-is to the API payload (no more manual string-to-number/boolean coercion). The `in` operator continues to split by comma (only reachable for `string`/`array` types after Task 03). The `isNull` operator sets value to null.

**Type-aware input rendering:** Resolve the property type from the filter row's current field path (using `resolvePropertyType` and the `schemas` prop). Render the value input based on the resolved type:
- `"string"` or unknown → `TextInput`
- `"number"` / `"integer"` → `NumberInput` (writes a number to `FilterRow.value`)
- `"boolean"` → `Select` with options `True` / `False` (writes `true` / `false` boolean to `FilterRow.value`)
- `"date"` → Mantine `DateInput` (writes an ISO date string `YYYY-MM-DD` to `FilterRow.value`, kept as string)
- `"array"` → `TextInput` (comma-separated, same as string; only `in`/`isNull` available from Task 03)
- When `op` is `"isNull"`, the value field is hidden entirely (already implemented)

**Field-change reset:** When the field path changes, clear `FilterRow.value` to `""` and reset `FilterRow.op` to `"eq"`. This extends the op-reset logic from Task 03 to also wipe the value, ensuring no stale typed value carries over to the new property type.

See the PRD's Further Notes for the `DateInput` serialisation detail.

## Acceptance criteria

- [ ] `FilterRow.value` is typed as `string | number | boolean` in the form schema
- [ ] `buildApiFilter` passes comparison values through as-is (no coercion logic)
- [ ] Selecting a `number`/`integer` field renders a `NumberInput`; submitting the form sends a number (not a string) in the API payload
- [ ] Selecting a `boolean` field renders a `Select` with True/False; submitting sends `true` or `false` (not `"true"`/`"false"`)
- [ ] Selecting a `date` field renders a `DateInput`; the submitted value is an ISO date string (`YYYY-MM-DD`)
- [ ] Selecting a `string` or unknown field renders a `TextInput`
- [ ] Changing the field path clears the current value and resets op to `eq`
- [ ] The `isNull` op continues to hide the value input

## Blocked by

- [Task 03](./03-operator-filtering-by-type.md)

## User stories addressed

- User story 6 (boolean select for boolean fields)
- User story 7 (number input for number/integer fields)
- User story 8 (date picker for date fields)
- User story 10 (value and op reset when field changes)
- User story 17 (form stores native-typed values)
