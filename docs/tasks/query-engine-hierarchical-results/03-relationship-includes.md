# Relationship Includes

**Parent Plan:** [Query Engine Hierarchical Results PRD](./README.md)

**Type:** AFK

**Status:** done

## What to build

Add one-hop entity includes to v2 rows returns. A nested entity source should use the same `type: "entities"` source shape as root entities plus a `via` object with `entityRef`, edge `alias`, traversal `direction`, and singular relationship `schema`. The include should return `{ items, pageInfo }`, enforce its own limit and orderBy, preserve typed field values, and expose the relationship edge alias for sorting, filtering, and field projection.

This slice should prove `course -> modules` through a relationship schema, ordered by a module property or relationship edge property, while keeping root pagination scoped to courses only.

## Acceptance criteria

- [x] Rows returns can include a nested entity source traversed through one relationship edge.
- [x] `via.entityRef` anchors traversal to an in-scope entity alias, and `direction` correctly maps outgoing and incoming relationship rows.
- [x] Included rows are nested under the include key with `items` and limited result `pageInfo` containing `limit` and `hasMore`.
- [x] Include orderBy supports child entity fields and relationship edge fields through their aliases.
- [x] Include fields support child entity system/property/schema fields and relationship edge system/property fields.
- [x] Root pagination returns the requested number of root rows regardless of included row counts.
- [x] The 5000 serialized-row cap is enforced for root rows plus included rows.
- [x] E2E tests fetch courses with nested modules ordered by module number and verify include `hasMore` behavior with a low include limit.

## User stories addressed

Reference by number from the parent PRD:

- User story 1
- User story 3
- User story 8
- User story 9
- User story 10
- User story 15
- User story 30
- User story 32
- User story 33

## Follow-up (post-review)

Included entity sources now support `where`. The `where` filters which child rows are
returned (child-row projection filtering); the parent row is still returned even when no
child matches, because includes are projections rather than parent filters. Include `where`
may reference the include's own alias, its relationship edge alias, and ancestor aliases.
When an include has no `where`, execution keeps the efficient `ORDER BY ... LIMIT limit+1`
path; when a `where` is present, it scans ordered candidates (bounded by an explicit cap),
filters in-app, then applies the limit and computes `hasMore` from the filtered remainder.
