# Save To Collection Orchestration And Notifications

**Parent Plan:** [Search Add To Collection](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Connect the inline collection panel submit action to the existing search-import flow and the
collection-membership write contract.

This slice should ensure that saving to a collection first guarantees the searched item exists as an
entity, then writes or updates the membership for the selected collection, and finally communicates
success or failure with clear row-local state and notifications. The UX should use save semantics
instead of one-time add semantics because the backend membership write is an upsert.

See the parent PRD sections **Save orchestration**, **Success, error, and partial-failure states**,
and **Relationship to lifecycle actions**.

## Acceptance criteria

- [ ] Submitting the collection panel first ensures the search result exists as an entity using the
      existing search-import flow.
- [ ] After entity creation or lookup succeeds, the frontend calls the collection-membership write
      contract for the selected collection with the validated membership payload.
- [ ] The submit affordance uses save-oriented copy rather than one-time add copy.
- [ ] A successful save closes the collection panel and shows a success notification that names the
      target collection.
- [ ] If entity creation succeeds but the membership write fails, the user receives a partial-
      failure message that clearly explains the item is in the library but not in the collection.
- [ ] Validation and write failures surface within the current row interaction without redirecting
      the user away.
- [ ] The action remains single-target: one submit writes to one selected collection.
- [ ] Component-level tests cover success, validation failure, write failure, and partial-failure
      behavior.
- [ ] `bun run typecheck` and the relevant frontend test command pass in `apps/app-frontend`.

## Blocked by

- [Task 02](./02-inline-collection-panel-in-search-result-rows.md)
- [Task 03](./03-membership-form-generation-and-validation.md)

## User stories addressed

- User story 4
- User story 15
- User story 16
- User story 17
- User story 18
- User story 19
- User story 21
- User story 27
