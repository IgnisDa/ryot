# Expression Contract Foundation

**Parent Plan:** [View Computed Fields](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Deliver the first thin end-to-end slice of the new view language by replacing the legacy reference-array contract with the new expression-based saved-view and runtime shapes for direct references, literals, and explicit fallback/coalesce behavior. This slice establishes the new request and persistence model and proves that saved views and raw runtime requests can execute against it.

The end-to-end behavior: a saved view or raw runtime request can use expression-shaped output fields and expression-shaped display configuration, built-in saved views bootstrap successfully with the new structure, and the runtime returns results correctly without relying on the legacy `references` arrays.

See the parent PRD sections "Solution" and "Implementation Decisions" for the shared expression AST, structured references, expression-shaped display configuration, and breaking contract reset.

Backward compatibility is not needed in this slice. Remove legacy request/display parsing rather than supporting both formats.

## Acceptance criteria

- [ ] Saved-view and view-runtime request schemas accept the new expression AST for output fields and display configuration instead of legacy reference arrays
- [ ] Structured references resolve entity fields and latest-event join fields through the shared validation path
- [ ] Literal and coalesce expressions execute end-to-end for saved views and raw runtime requests
- [ ] Saved-view persistence and bootstrap data use the new expression-based JSON shape
- [ ] Legacy request/display parsing paths are removed rather than preserved behind compatibility shims

## Blocked by

None - can start immediately

## User stories addressed

- User story 1
- User story 2
- User story 3
- User story 4
- User story 5
- User story 7
- User story 8
- User story 13
- User story 14
- User story 15
- User story 21
- User story 24
- User story 25
- User story 36
- User story 37
- User story 38
