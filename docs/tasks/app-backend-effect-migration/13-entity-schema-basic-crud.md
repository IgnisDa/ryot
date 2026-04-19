# Entity Schema Basic CRUD

**Parent Plan:** [App Backend Effect Migration](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Migrate basic entity-schema behavior: authenticated listing, creation, lookup by id, and tracker/entity-schema linking. Provider-backed search and import may remain stubbed until the sandbox/runtime slices. Creation should also create default saved-view data needed by the product behavior.

This slice should replace `NotImplemented` for non-provider entity-schema routes and enable E2E tests that depend on custom schemas.

## Acceptance criteria

- [ ] Authenticated users can list entity schemas linked to their trackers
- [ ] Authenticated users can create custom entity schemas under their trackers
- [ ] Authenticated users can fetch an entity schema by id when accessible
- [ ] Duplicate or reserved slug cases fail with typed validation errors
- [ ] Created schemas use migrated property schema validation and create expected default saved-view data
- [ ] Basic entity-schema E2E tests use the Effect client and pass

## User stories addressed

Reference by number from the parent PRD:

- User story 30
- User story 39
- User story 58
- User story 59
