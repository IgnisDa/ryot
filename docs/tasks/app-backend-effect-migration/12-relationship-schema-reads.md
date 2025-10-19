# Relationship Schema Reads

**Parent Plan:** [App Backend Effect Migration](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Migrate the relationship-schema read side needed by entity, collection, import, query-engine, and bootstrap flows. This slice should expose Effect services for finding builtin relationship schemas by slug and resolving relationship schema scopes needed for relationship writes.

There is no public route surface for this module in the current API; verification should be through focused unit tests and the consumers that use it.

## Acceptance criteria

- [ ] Builtin relationship schemas seeded earlier can be loaded by slug
- [ ] Relationship schema scopes expose source, target, and property schema data needed by writers
- [ ] Missing schemas fail as typed not-found/domain errors at service boundaries
- [ ] Relationship schema code uses the migrated property schema representation
- [ ] Focused unit tests cover found and missing relationship schema reads
- [ ] No new backend code imports relationship helpers from legacy utility packages

## User stories addressed

Reference by number from the parent PRD:

- User story 17
- User story 34
- User story 37
- User story 60
