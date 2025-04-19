# Computed Fields And Raw Output

**Parent Plan:** [View Computed Fields](./README.md)

**Type:** AFK

**Status:** done

## What to build

Add first-class computed fields to the shared query definition and make them usable as named raw runtime output fields as well as reusable inputs to display expressions. This slice should prove that a derived value can be defined once, referenced by name, and returned directly in the runtime `fields` array.

The end-to-end behavior: saved views and raw runtime requests can define `computedFields`, runtime output fields can reference computed fields by key, grid/list/table display expressions can reuse those same computed fields, and missing joined event values continue to flow through as `null`.

See the parent PRD sections "Solution" and "Implementation Decisions" for first-class computed fields, computed-field references, named raw runtime output fields, and null semantics.

Backward compatibility is not needed in this slice. The new computed-field contract can replace the old output model directly.

## Acceptance criteria

- [ ] Query definitions support named `computedFields` for saved views and raw runtime requests
- [ ] Computed fields can reference entity values, latest-event join values, and other computed fields
- [ ] Runtime `fields` can reference computed fields and return them as named raw output entries
- [ ] Display configuration expressions can reuse computed fields without redefining the same logic
- [ ] Computed-field evaluation order is deterministic and missing joined values propagate as null

## Blocked by

- [Task 01](./01-expression-contract-foundation.md)

## User stories addressed

- User story 1
- User story 2
- User story 5
- User story 6
- User story 15
- User story 16
- User story 22
- User story 23
- User story 31
- User story 32
- User story 33
