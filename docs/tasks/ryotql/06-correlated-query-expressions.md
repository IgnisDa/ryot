# Correlated Query Expressions

**Parent Plan:** [RyotQL](./README.md)

**Status:** completed

## What to build

Complete scalar expression power over generic query sets by adding correlated `exists`, `first`, and aggregate expressions together with arithmetic and full coalesce behavior. Exercise the complete path through course completion, latest event, first ordered child, descendant filtering, and computed progress scenarios.

Correlated query sets use the same tables, joins, visibility, predicates, field resolvers, JSON paths, casts, and alias rules as root queries. They may reference valid ancestors but not siblings or forward aliases. `first` supports its own predicate, ordered scalar selection, and null on no match. Arithmetic uses safe numeric values and returns null for invalid operands or division by zero. Preserve the retained correlated-depth limit.

## Acceptance criteria

- [x] SDK and contract support correlated existence, first-value, and aggregate expressions over generic query sets
- [x] Correlated query validation permits valid ancestor references and rejects sibling, unknown, duplicate, and forward aliases
- [x] Every correlated table occurrence receives the same execution-scope visibility as a root or join
- [x] `exists` returns a boolean based on the authorized correlated relation
- [x] `first` supports predicates, deterministic ordering, scalar selection, and null for empty results
- [x] Correlated count, count distinct, sum, average, minimum, and maximum expressions follow the agreed empty-set and null behavior
- [x] Arithmetic and coalesce preserve safe casts, division-by-zero nulls, and runtime field kinds
- [x] Course completion, descendant count, latest completion, first module, fallback, and ratio scenarios pass end to end
- [x] Correlated-depth validation and statement timeout behavior remain enforced
- [x] Existing RyotQL slices and the complete legacy query-engine suite remain green
- [x] The RyotQL guide documents correlated query sets and scalar semantics

## User stories addressed

- User story 10
- User story 11
- User story 12
- User story 20
- User story 21
- User story 22
- User story 23
