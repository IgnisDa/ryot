# Create Collection With Membership Template Validation

**Parent Plan:** [Collections Write Foundation](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Add the dedicated backend write path for creating a collection entity with a stored membership
template. This slice should accept collection creation input, validate `membershipPropertiesSchema`
as an `AppSchema`, and persist the resulting collection entity under the built-in `collection`
schema using the agreed `properties.membershipPropertiesSchema` contract.

The end-to-end result should be that a user can create a collection such as `Recommended to me`
with a valid membership template, and invalid nested schemas are rejected before persistence. The
feature should not depend on the generic entity creation contract. See the parent PRD sections
**Dedicated collection write API**, **Collection template storage**, and **Validation model**.

## Acceptance criteria

- [x] The backend exposes a dedicated authenticated collection-creation contract keyed to the
      built-in `collection` schema model.
- [x] Creating a collection persists a user-owned collection entity with
      `properties.membershipPropertiesSchema` stored as provided.
- [ ] `membershipPropertiesSchema` is validated as a real `AppSchema` before the collection is
      persisted.
- [ ] Invalid nested collection templates fail with a stable validation error and do not create an
      entity.
- [ ] The create-collection contract does not require callers to use the generic entity creation
      route.
- [ ] Backend tests cover template parsing and create-collection validation behavior.
- [ ] `tests/src` includes end-to-end coverage for successful collection creation and invalid
      template rejection.
- [ ] `bun run typecheck`, `bun test`, and `bun run lint` pass in `apps/app-backend`.

## Blocked by

- [Task 01](./01-collection-schema-and-bootstrap-foundation.md)

## User stories addressed

- User story 1
- User story 2
- User story 3
- User story 14
- User story 16
- User story 20
- User story 24
- User story 28
