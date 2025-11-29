# Relationship Root Sources

**Parent Plan:** [Query Engine Hierarchical Results PRD](./README.md)

**Type:** AFK

**Status:** done

## What to build

Add relationship sources as root row sources. Relationship root sources must declare their own alias, relationship schema slugs, and both endpoint entity declarations through `sourceEntity` and `targetEntity`. Rows should be able to project relationship system fields, relationship properties, endpoint entity fields, and endpoint schema metadata. Relationship root sources should use the same rows-return pagination, orderBy, fields, validation, and visibility rules as other sources.

This slice proves relationship-centric querying directly, separate from nested relationship traversal through includes.

## Acceptance criteria

- [x] A root relationship source can return relationship rows for one or more relationship schemas.
- [x] Relationship root sources require both `sourceEntity` and `targetEntity` endpoint declarations.
- [x] Relationship row fields can reference the relationship alias and endpoint entity aliases.
- [x] Relationship properties require schema-qualified property field selectors.
- [x] Relationship system fields such as ID, source entity ID, target entity ID, and created timestamp are supported.
- [x] Relationship sources enforce visibility on relationship rows and both endpoint entities.
- [x] E2E tests query relationship rows, project endpoint names, sort by relationship created timestamp, and verify user isolation.

## User stories addressed

Reference by number from the parent PRD:

- User story 15
- User story 16
- User story 19
- User story 30
- User story 32

## Follow-up (post-review)

A review found two relationship-root gaps that are now closed:

1. Root relationship sources support `where`. The pure validator validates the `where`
   expression in scope (relationship alias and both endpoint entity aliases are
   referenceable), and the rows execution path applies the filter in-app, mirroring the
   entity and event root paths (ordered candidate scan bounded by the root filter scan cap,
   `total` reflects matched rows, pagination slices the filtered set).
2. Relationship rows can be ordered by source or target endpoint entity fields, not just the
   relationship's own fields. The relationship SELECT already joins both endpoint entities,
   so endpoint ordering is SQL-expressible and is now emitted instead of being silently
   dropped to an unordered constant.

Arbitrary non-`ref` `orderBy` expressions (e.g. `exists`, `aggregate`, `arithmetic`) remain
out of scope for relationship rows. `orderBy` stays `ref`-based because in-app sorting would
conflict with SQL pagination; this follow-up only makes in-scope endpoint refs actually
order results.
