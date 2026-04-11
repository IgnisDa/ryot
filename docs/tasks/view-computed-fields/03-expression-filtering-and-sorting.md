# Expression Filtering And Sorting

**Parent Plan:** [View Computed Fields](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Replace the legacy flat filter model with the new predicate AST and make computed fields and other expressions usable in filtering and sorting. This slice should prove that derived values drive query semantics, not just display output.

The end-to-end behavior: a saved view or raw runtime request can sort by a computed field, filter by a computed field, and use expression operands inside the new predicate model while preserving latest-event null behavior and schema-aware type validation.

See the parent PRD sections "Solution" and "Implementation Decisions" for the predicate AST, sortable/filterable expression rules, and centralized validation/compilation goals.

## Acceptance criteria

- [ ] Runtime and saved-view contracts use the predicate AST instead of the legacy `{ field, op, value }` filter objects
- [ ] Sort definitions accept expression-based operands and allow computed-field references
- [ ] Filter predicates accept expression operands and allow computed-field references
- [ ] Validation rejects unsupported sort and filter usages based on inferred expression result type
- [ ] Saved views and raw runtime requests produce matching sort/filter behavior for the same derived logic

## Blocked by

- [Task 02](./02-computed-fields-and-raw-output.md)

## User stories addressed

- User story 17
- User story 18
- User story 19
- User story 20
- User story 21
- User story 23
- User story 26
- User story 27
- User story 28
- User story 29
- User story 34
- User story 35
