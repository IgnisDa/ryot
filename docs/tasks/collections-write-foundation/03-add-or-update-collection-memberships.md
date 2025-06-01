# Add Or Update Collection Memberships

**Parent Plan:** [Collections Write Foundation](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Add the authenticated write path for adding entities to a collection and updating an existing
membership when the same entity is added again. This slice should validate the submitted
membership payload against the target collection's stored `membershipPropertiesSchema`, persist the
membership as a `member_of` relationship, and enforce one membership per
`(user, source entity, target collection, relType)`.

The end-to-end result should be that users can add entities to collections with structured,
validated metadata, and repeated writes replace the existing membership properties instead of
creating duplicates. See the parent PRD sections **Canonical persistence model**, **Validation
model**, and **Membership write semantics**.

## Acceptance criteria

- [ ] The backend exposes an authenticated add-to-collection write contract that identifies the
      target collection by `collectionId`.
- [ ] Adding an entity to a collection persists a `member_of` relationship from the member entity
      to the collection entity.
- [ ] Membership payloads are validated against the target collection's stored
      `membershipPropertiesSchema` before persistence.
- [ ] Missing or invalid required membership fields are rejected with a stable validation error.
- [ ] Re-adding the same entity to the same collection updates the existing membership instead of
      creating a duplicate relationship row.
- [ ] Backend tests cover membership validation and upsert behavior.
- [ ] `tests/src` includes end-to-end coverage for successful membership creation, validation
      failure, and duplicate-write upsert behavior.
- [ ] `bun run typecheck`, `bun test`, and `bun run lint` pass in `apps/app-backend`.

## Blocked by

- [Task 02](./02-create-collection-with-membership-template-validation.md)

## User stories addressed

- User story 4
- User story 5
- User story 6
- User story 7
- User story 8
- User story 9
- User story 17
- User story 18
- User story 21
- User story 22
- User story 23
