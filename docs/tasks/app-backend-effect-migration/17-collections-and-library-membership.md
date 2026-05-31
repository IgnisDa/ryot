# Collections And Library Membership

**Parent Plan:** [App Backend Effect Migration](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Migrate collection creation, collection membership add/remove, library entity creation, and ensure-in-library behavior. This slice depends on entities, events, property schemas, and relationship schemas. It should finish the user bootstrap behavior that needs library membership and collection-like relationships.

Collection membership writes should use canonical entity and relationship write paths and validate membership properties against the collection's schema.

## Acceptance criteria

- [ ] Authenticated users can create collections
- [ ] Authenticated users can add entities to collections with validated membership properties
- [ ] Authenticated users can remove entities from collections
- [ ] Library entity creation and ensure-in-library behavior work for bootstrap and entity/import flows
- [ ] Collection operations use canonical relationship and event write paths where applicable
- [ ] Collections E2E tests pass through the Effect client

## User stories addressed

Reference by number from the parent PRD:

- User story 14
- User story 34
- User story 61
