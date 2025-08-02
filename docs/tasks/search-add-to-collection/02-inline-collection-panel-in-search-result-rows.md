# Inline Collection Panel In Search Result Rows

**Parent Plan:** [Search Add To Collection](./README.md)

**Type:** AFK

**Status:** done

## What to build

Enable the existing `Collection` quick action in expanded search-result rows and turn it into an
inline sibling panel within the row.

This slice should wire the row UI to the collection-discovery layer, render loading and empty
states, and preserve the current interaction hierarchy where `Add` or `Queue` remains the primary
action. The panel should feel like the existing log and review affordances, not like a second modal
or a dense management surface.

See the parent PRD sections **Entry point and interaction model**, **Collection discovery**, and
**No-collections guidance**.

## Acceptance criteria

- [x] The `Collection` quick action is enabled in the expanded search-result row.
- [x] Clicking the action opens and closes an inline panel in the same row rather than launching a
      separate modal.
- [x] The panel consumes the shared collection-discovery helper and renders a loading state while
      collections are being fetched.
- [x] If no collections exist, the panel renders a calm empty state instead of a broken form.
- [x] The empty state includes a CTA that uses the shared Collections-view resolver to guide the
      user to the built-in Collections view.
- [x] The row preserves the existing add-or-queue action hierarchy and does not promote Collection
      to the primary action.
- [x] The row does not imply authoritative existing membership state for the result beyond what the
      current interaction knows.
- [x] Component-level tests cover panel toggling, loading rendering, and the no-collections empty
      state.
- [x] `bun run typecheck` and the relevant frontend test command pass in `apps/app-frontend`.

## Blocked by

- [Task 01](./01-collection-discovery-and-navigation-helpers.md)

## User stories addressed

- User story 1
- User story 2
- User story 3
- User story 5
- User story 20
- User story 22
- User story 23
- User story 24
