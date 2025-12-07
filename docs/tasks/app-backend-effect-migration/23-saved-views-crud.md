# Saved Views CRUD

**Parent Plan:** [App Backend Effect Migration](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Migrate saved-view listing, creation, retrieval, update, delete, clone, and reorder behavior through the Effect contract. Saved-view validation should use the migrated query-language and query context validation primitives. This slice may share work with query-engine execution but should focus on persisted saved-view CRUD behavior.

Built-in saved-view mutation rules and user-owned saved-view access rules should be preserved with typed errors.

## Acceptance criteria

- [ ] Authenticated users can list saved views
- [ ] Authenticated users can create, get, update, delete, clone, and reorder saved views
- [ ] Built-in saved-view mutation restrictions are enforced
- [ ] Query definition and display configuration validation use migrated query-language primitives
- [ ] Cross-user saved-view access fails without leaking resource existence
- [ ] Saved-view E2E tests pass through the Effect client

## User stories addressed

Reference by number from the parent PRD:

- User story 39
- User story 46
- User story 47
- User story 59
