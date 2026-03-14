# Combined People List

**Parent Plan:** [Entity Detail Real Data](./README.md)

**Type:** AFK

**Status:** done

## What to build

Implement the combined people section with live backend data. Use `POST /query-engine/execute` in entity mode to fetch related people rows for the current media item, using the media-type-specific person relationship schema seeded by the backend. The loader should page through the query-engine result set until all rows have been collected, with no visible pagination UI.

Render the related people as a single combined list. Do not split the UI into separate cast and crew buckets. The section should normalize the backend rows into the existing display model so role labels and any other available metadata can be shown consistently.

Where the entity payload already contains direct creator metadata, keep that data compatible with the same combined display model so the section can render live backend data consistently across media types.

## Acceptance criteria

- [x] The people section is backed by `POST /query-engine/execute`, not fake client data.
- [x] The correct person-to-media relationship schema is used for the current entity type.
- [x] The loader fetches all related people rows, not just the first page.
- [x] The UI shows one combined people list and does not expose separate cast and crew sections.
- [x] The section renders the backend role metadata for each person and preserves a stable order.

## User stories addressed

Reference by number from the parent PRD:

- User story 3
- User story 5
- User story 6
- User story 8
