# Descendant Source Filters

**Parent Plan:** [Query Engine Hierarchical Results PRD](./README.md)

**Type:** AFK

**Status:** done

## What to build

Add source-consuming expressions in source `where` clauses so parent rows can be filtered by descendant sources. This slice should support nested `exists` and `aggregate` expressions over entity and event sources, shared aggregation specs, expression-source depth validation, matched-row safety limits, null comparison behavior, and `coalesce` for computed output fields. Multi-hop descendant questions must be represented by nesting source-consuming expressions, with one relationship edge per source traversal.

This slice should prove both required cross-schema filter capabilities: courses with more than N completed descendant lessons and courses with at least one descendant lesson matching a property predicate.

## Acceptance criteria

- [x] Parent entity source `where` clauses can contain `exists` over nested descendant entity sources.
- [x] Parent entity source `where` clauses can contain aggregate expressions over descendant sources using shared aggregation specs.
- [x] Multi-hop traversal is expressed by nested source-consuming expressions, not by a synthetic multi-edge `via`.
- [x] Comparisons involving null evaluate to false except explicit null checks.
- [x] `coalesce` works in output fields to display zero instead of null for empty aggregate results.
- [x] Count aggregations support `distinctBy` for unique-value counting and ignore null distinct values.
- [x] Expression-source depth and aggregate expression-source matched-row limits are enforced.
- [x] E2E tests filter courses by completed lesson count and by at least one lesson with `durationMinutes` greater than a threshold.

## User stories addressed

Reference by number from the parent PRD:

- User story 6
- User story 7
- User story 13
- User story 17
- User story 18
- User story 30
- User story 31
- User story 32

## Follow-up (post-review)

A post-implementation review found the `arithmetic` expression from the PRD expression
catalog was missing. It is now supported wherever an expression is valid: computed output
fields, source `where` clauses, and aggregation operands. Operators are `add`, `subtract`,
`multiply`, and `divide`. Both operands must resolve to numbers (otherwise the result is
null), and division by zero returns null rather than throwing.

- [x] `arithmetic` expressions (`add`, `subtract`, `multiply`, `divide`) work in computed
      output fields, `where` clauses, and aggregation operands, with non-numeric operands
      and division by zero resolving to null.
