# Aggregate Outputs

**Parent Plan:** [RyotQL](./README.md)

**Status:** completed

## What to build

Add root grouped and ungrouped aggregate outputs over the existing generic query set. Preserve the current useful analytical surface without adding speculative dimensions or pagination features. Verify execution through realistic lesson duration, difficulty grouping, relationship join, empty dataset, and null-value scenarios.

Aggregate outputs must reuse the same catalog, joins, predicates, field resolvers, casts, visibility, and transaction behavior as rows. Support count, count distinct, sum, average, minimum, and maximum. Group fields retain dynamic value kinds. Grouped outputs retain their limit and hasMore behavior and the existing maximum limit. Join multiplication follows ordinary SQL semantics, so tests must distinguish count from count distinct explicitly.

## Acceptance criteria

- [x] SDK and contract support grouped and ungrouped aggregate named queries over generic query sets
- [x] The executor compiles each aggregate named query into one SQL statement with all filtering and grouping in PostgreSQL
- [x] Count and count distinct behave correctly after joins and over null values
- [x] Count returns zero over empty input while sum, average, minimum, and maximum return null
- [x] Group keys reconstruct text, number, boolean, date, JSON, and null kinds correctly
- [x] Grouped results enforce the retained limit, ordering capability, maximum of 1000, and hasMore behavior
- [x] User and plugin-ready visibility hooks apply before aggregation so hidden rows never affect measures
- [x] End-to-end aggregate tests cover empty datasets, null operands, null group keys, multiple measures, discriminator filters, and multiplying joins
- [x] Existing rows, includes, correlated expressions, and the complete legacy query-engine suite remain green
- [x] The RyotQL guide documents aggregate output semantics and intentional limits

## User stories addressed

- User story 12
- User story 13
- User story 16
- User story 17
- User story 23
