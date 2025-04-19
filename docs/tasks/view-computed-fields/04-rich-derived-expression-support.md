# Rich Derived Expression Support

**Parent Plan:** [View Computed Fields](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Expand the initial language so it fully covers the derivations needed by rich UI data: arithmetic, numeric normalization, string composition, conditional logic, and image-specific display restrictions. This slice should make the language materially useful for derived badges, labels, scores, and normalized numeric values.

The end-to-end behavior: saved views and raw runtime requests can use arithmetic, rounding/flooring/integer conversion, string composition, and conditional expressions in computed fields and output expressions, while image-valued expressions remain restricted to display-only usage.

See the parent PRD sections "Solution" and "Implementation Decisions" for the required expression set, numeric normalization operations, conditional/type-unification rules, and image restrictions.

Backward compatibility is not needed in this slice. Extend only the new expression system rather than preserving legacy derivation behavior.

## Acceptance criteria

- [ ] Arithmetic expressions execute end-to-end in computed fields and output expressions
- [ ] Numeric normalization operations such as rounding, flooring, and integer conversion execute end-to-end
- [ ] String composition expressions execute end-to-end for display and raw output fields
- [ ] Conditional expressions execute end-to-end with validated branch compatibility and null-aware behavior
- [ ] Image-valued expressions are accepted only in display-oriented output paths and rejected from sorting, filtering, arithmetic, string composition, and other non-display operations

## Blocked by

- [Task 03](./03-expression-filtering-and-sorting.md)

## User stories addressed

- User story 3
- User story 9
- User story 10
- User story 11
- User story 12
- User story 13
- User story 14
- User story 15
- User story 20
- User story 21
- User story 23
- User story 27
- User story 30
- User story 41
- User story 42
