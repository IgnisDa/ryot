# Relationship Root Sources

**Parent Plan:** [Query Engine Hierarchical Results PRD](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Add relationship sources as root row sources. Relationship root sources must declare their own alias, relationship schema slugs, and both endpoint entity declarations through `sourceEntity` and `targetEntity`. Rows should be able to project relationship system fields, relationship properties, endpoint entity fields, and endpoint schema metadata. Relationship root sources should use the same rows-return pagination, orderBy, fields, validation, and visibility rules as other sources.

This slice proves relationship-centric querying directly, separate from nested relationship traversal through includes.

## Acceptance criteria

- [ ] A root relationship source can return relationship rows for one or more relationship schemas.
- [ ] Relationship root sources require both `sourceEntity` and `targetEntity` endpoint declarations.
- [ ] Relationship row fields can reference the relationship alias and endpoint entity aliases.
- [ ] Relationship properties require schema-qualified property field selectors.
- [ ] Relationship system fields such as ID, source entity ID, target entity ID, and created timestamp are supported.
- [ ] Relationship sources enforce visibility on relationship rows and both endpoint entities.
- [ ] E2E tests query relationship rows, project endpoint names, sort by relationship created timestamp, and verify user isolation.

## User stories addressed

Reference by number from the parent PRD:

- User story 15
- User story 16
- User story 19
- User story 30
- User story 32
