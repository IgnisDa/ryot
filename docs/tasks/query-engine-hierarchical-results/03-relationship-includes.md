# Relationship Includes

**Parent Plan:** [Query Engine Hierarchical Results PRD](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Add one-hop entity includes to v2 rows returns. A nested entity source should use the same `type: "entities"` source shape as root entities plus a `via` object with `entityRef`, edge `alias`, traversal `direction`, and singular relationship `schema`. The include should return `{ items, pageInfo }`, enforce its own limit and orderBy, preserve typed field values, and expose the relationship edge alias for sorting, filtering, and field projection.

This slice should prove `course -> modules` through a relationship schema, ordered by a module property or relationship edge property, while keeping root pagination scoped to courses only.

## Acceptance criteria

- [ ] Rows returns can include a nested entity source traversed through one relationship edge.
- [ ] `via.entityRef` anchors traversal to an in-scope entity alias, and `direction` correctly maps outgoing and incoming relationship rows.
- [ ] Included rows are nested under the include key with `items` and limited result `pageInfo` containing `limit` and `hasMore`.
- [ ] Include orderBy supports child entity fields and relationship edge fields through their aliases.
- [ ] Include fields support child entity system/property/schema fields and relationship edge system/property fields.
- [ ] Root pagination returns the requested number of root rows regardless of included row counts.
- [ ] The 5000 serialized-row cap is enforced for root rows plus included rows.
- [ ] E2E tests fetch courses with nested modules ordered by module number and verify include `hasMore` behavior with a low include limit.

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
