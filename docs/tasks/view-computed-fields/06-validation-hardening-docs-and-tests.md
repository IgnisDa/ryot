# Validation Hardening, Docs, And Tests

**Parent Plan:** [View Computed Fields](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Finish the feature by hardening validation, error reporting, documentation, and automated coverage around the full expression language. This slice closes the loop so the new contract is reliable for direct payload authors and future maintainers.

The end-to-end behavior: invalid references, computed-field cycles, invalid type/operator combinations, and unsupported image usage fail with clear messages; runtime docs show the final language; and automated tests cover the full saved-view and runtime surface.

See the parent PRD sections "Implementation Decisions" and "Testing Decisions" for cycle detection, type inference, validation clarity, and required test coverage.

Backward compatibility is not needed in this slice. Validation, docs, and tests should target only the final contract.

## Acceptance criteria

- [ ] Validation reports clear errors for invalid references, invalid operator/type combinations, unsupported non-display image usage, and computed-field cycles
- [ ] Shared analysis and compilation modules are covered with isolated tests for dependency resolution, type inference, and expression compilation behavior
- [ ] Saved-view API tests and raw runtime tests cover the final expression contract end-to-end
- [ ] Runtime documentation is updated to describe the final expression and predicate language with concrete examples
- [ ] The full automated test suite relevant to saved views, view runtime, and the minimal frontend contract passes

## Blocked by

- [Task 04](./04-rich-derived-expression-support.md)
- [Task 05](./05-frontend-read-only-view-management.md)

## User stories addressed

- User story 24
- User story 25
- User story 26
- User story 27
- User story 28
- User story 29
- User story 30
- User story 31
- User story 32
- User story 33
- User story 34
- User story 35
- User story 39
- User story 40
