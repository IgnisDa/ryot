# Collection Discovery And Navigation Helpers

**Parent Plan:** [Search Add To Collection](./README.md)

**Type:** AFK

**Status:** done

## What to build

Add the frontend helper layer needed for the search modal to discover visible collections and to
resolve the built-in Collections view route for the no-collections CTA.

This slice should reuse the existing query-engine and saved-view infrastructure rather than adding
new backend contracts or hardcoded route assumptions. The end-to-end result should be that the
search feature can load the current user's collection entities, detect loading and empty states, and
produce a correct destination for the built-in Collections view when the user needs to create a
collection first.

See the parent PRD sections **Collection discovery** and **No-collections guidance**.

## Acceptance criteria

- [x] The frontend exposes a collection-discovery helper that reads collection entities through the
      existing generic query path.
- [x] Collection discovery returns enough data for the later search-modal slices to render a
      selector and access each collection's `membershipPropertiesSchema`.
- [x] The helper exposes loading and empty-state-friendly behavior without forcing the search row to
      know query details directly.
- [x] The frontend exposes a helper that resolves the built-in Collections saved view dynamically
      from saved-view data rather than hardcoding an opaque identifier.
- [x] The resolved Collections destination can be used by the future empty-state CTA in the search
      row.
- [x] Unit tests cover built-in Collections view resolution and any small pure mapping logic added
      for collection discovery.
- [x] `bun run typecheck` and the relevant frontend test command pass in `apps/app-frontend`.

## Blocked by

None - can start immediately.

## User stories addressed

- User story 6
- User story 7
- User story 8
- User story 9
- User story 25
- User story 26
- User story 29
