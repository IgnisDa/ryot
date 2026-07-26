# Relationship Rows And Includes

**Parent Plan:** [RyotQL](./README.md)

**Status:** completed

## What to build

Add relationships to the catalog, complete generic inner and left joins, and add correlated row includes. Relationship roots and endpoint projections must use ordinary relationship-to-entity joins. Course, module, lesson, membership, and event-child scenarios must execute through the public RyotQL endpoint without `via`, directions, endpoint declarations, or source-specific include rules.

Includes are correlated rows queries with lexical access to valid ancestors, explicit limits, ordering, fields, and optional nested includes. They must fetch limit plus one to derive hasMore, preserve parents with no children, and apply visibility to every relation before joining. Normal SQL root join multiplicity remains visible; RyotQL must not silently deduplicate roots or add a distinct output.

## Acceptance criteria

- [x] The relationship catalog entry exposes the approved relationship fields and user visibility policy
- [x] Generic inner and left joins support any registered tables with validated lexical aliases and on predicates
- [x] Visibility filtering occurs before join evaluation, including left joins, without converting a left join into an inner join
- [x] Relationship roots can project relationship, source entity, and target entity fields through ordinary joins
- [x] Includes support correlated predicates, explicit limits, ordering, fields, empty child lists, limit-plus-one hasMore, and nesting to the retained depth
- [x] Any registered table can participate in an include without event- or relationship-specific restrictions
- [x] Root joins retain normal SQL multiplicity and aggregate semantics do not receive implicit deduplication
- [x] End-to-end course/module/lesson, relationship membership, filtered child, left join, and nested include scenarios pass
- [x] User isolation tests cover partial endpoint visibility, hidden relationship rows, relationship properties, and crafted join attempts
- [x] Existing RyotQL slices and the complete legacy query-engine suite remain green
- [x] The RyotQL guide documents joins, multiplicity, correlation, and includes

## User stories addressed

- User story 3
- User story 8
- User story 9
- User story 18
- User story 21
- User story 23
