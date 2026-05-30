# Entity Create Get Clear State

**Parent Plan:** [App Backend Effect Migration](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Migrate entity creation, entity detail retrieval, relationship write primitives needed by other modules, and user-state clearing. Provider-backed population and import-specific behavior can remain stubbed until the sandbox and entity provider import slices.

Entity writes must validate properties against the associated entity schema, preserve ownership and builtin/global access rules, and use typed errors.

## Acceptance criteria

- [ ] Authenticated users can create user-owned entities under accessible entity schemas
- [ ] Authenticated users can retrieve accessible entity details
- [ ] Entity property validation uses the migrated property schema DSL
- [ ] Relationship write primitives validate relationship properties and access rules
- [ ] Clearing user state removes user events and relationships for the entity while protecting library constraints
- [ ] Entity E2E tests for basic create/get/clear-state behavior pass through the Effect client

## User stories addressed

Reference by number from the parent PRD:

- User story 32
- User story 34
- User story 59
- User story 60
