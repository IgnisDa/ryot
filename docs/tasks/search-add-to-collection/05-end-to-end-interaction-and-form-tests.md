# End To End Interaction And Form Tests

**Parent Plan:** [Search Add To Collection](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Add the focused test coverage that protects the new add-to-collection search flow at the helper and
component-interaction levels.

This slice should verify the user-observable states introduced by the feature: collection loading,
no-collections guidance, membership validation, successful saves, and partial failures after entity
import. The intent is to lock in the workflow promised by the parent PRD without coupling tests to
incidental React implementation details.

See the parent PRD section **Testing Decisions**.

## Acceptance criteria

- [ ] Tests cover loading and empty states for the inline collection panel.
- [ ] Tests cover membership-form required-field validation and payload shaping.
- [ ] Tests cover successful save-to-collection behavior.
- [ ] Tests cover the partial-failure case where the entity exists in the library but the membership
      write fails.
- [ ] Tests cover the no-collections CTA path to the Collections view.
- [ ] Added tests assert user-observable behavior rather than internal implementation details.
- [ ] `bun run typecheck` and the relevant frontend test command pass in `apps/app-frontend`.

## Blocked by

- [Task 02](./02-inline-collection-panel-in-search-result-rows.md)
- [Task 03](./03-membership-form-generation-and-validation.md)
- [Task 04](./04-save-to-collection-orchestration-and-notifications.md)

## User stories addressed

- User story 7
- User story 8
- User story 13
- User story 14
- User story 17
- User story 18
- User story 30
