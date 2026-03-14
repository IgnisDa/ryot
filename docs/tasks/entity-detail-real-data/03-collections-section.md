# Collections Section

**Parent Plan:** [Entity Detail Real Data](./README.md)

**Type:** AFK

**Status:** done

## What to build

Implement the collections section with live backend data. Use `POST /query-engine/execute` in entity mode with the `member-of` relationship to fetch every collection related to the current entity. The query should be driven by the current `entityId`, fetch all rows through paging, and render every returned collection without a visible pagination control.

The collections section should remain a simple list of related collections and should hide itself cleanly when there are no memberships.

## Acceptance criteria

- [x] The collections section is backed by `POST /query-engine/execute`, not fake client data.
- [x] The query uses the `member-of` relationship with the correct direction and entity id constraint for the current entity.
- [x] All related collection rows are rendered.
- [x] No pagination UI is shown for collections.
- [x] The section hides cleanly when the entity has no related collections.

## User stories addressed

Reference by number from the parent PRD:

- User story 7
- User story 8
