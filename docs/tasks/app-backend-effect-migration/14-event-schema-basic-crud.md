# Event Schema Basic CRUD

**Parent Plan:** [App Backend Effect Migration](./README.md)

**Type:** AFK

**Status:** done

## What to build

Migrate event-schema listing and creation through the Effect contract, service, repository, and tests. Event schemas should validate properties using the migrated property schema DSL and enforce access to the target entity schema.

Trigger execution is not part of this slice; trigger links seeded for builtins can remain inert until event trigger workflows are migrated.

## Acceptance criteria

- [x] Authenticated users can list event schemas available to them
- [x] Authenticated users can create custom event schemas for accessible entity schemas
- [x] Invalid property schemas fail with typed validation errors
- [x] Reserved or duplicate slugs fail with typed validation errors
- [x] Cross-user entity-schema access fails without leaking resource existence
- [x] Basic event-schema E2E tests use the Effect client and pass

## User stories addressed

Reference by number from the parent PRD:

- User story 31
- User story 33
- User story 38
- User story 59
