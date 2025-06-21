# Documentation Update

**Parent Plan:** [Query Engine Reference Syntax Refactor](./README.md)

**Type:** AFK

**Status:** done

## What to build

Update `apps/app-backend/src/modules/query-engine/README.md` to reflect the new
reference syntax and to eliminate the ambiguity between string path notation and
the actual API wire format:

1. **Clarify that string paths are not part of the API** — Add a short note at the
   top of the "Reference Syntax" section stating that paths like
   `entity.book.properties.author` are human-readable shorthand used in
   documentation and test helpers only. The actual API request body always uses
   structured `RuntimeRef` JSON objects (e.g.
   `{ "type": "schema-property", "slug": "book", "property": ["author"] }`).
   The section should show both forms side by side so there is no confusion.

2. **Update string-path examples** — Replace every `@`-prefixed built-in path
   (`entity.book.@id`, `entity.book.@sandboxScriptId`, `event.review.@createdAt`,
   etc.) with the new 3-segment column syntax (`entity.book.id`,
   `entity.book.sandboxScriptId`, `event.review.createdAt`).
   Replace every bare schema property path (`entity.book.author`,
   `event.review.rating`) with the `properties.`-prefixed form
   (`entity.book.properties.author`, `event.review.properties.rating`).

3. **Update `RuntimeRef` JSON examples** — In the "Saved View Shape", "Request
   Shape", "Field Selection", "Computed Fields", "Filters", and "Query Examples"
   sections, update all `RuntimeRef` objects so `property: "string"` becomes
   `property: ["string"]` (array). These are the real wire-format objects that
   callers must send.

4. **"Gotchas" section** — Add two notes:
   - `properties` is a reserved keyword in segment position 3 of entity and event
     paths and must never be added as a built-in column name.
   - String path notation is documentation shorthand; sending a raw string path
     in a request body is invalid.

5. **"Copy-Paste Starters" section** — Ensure all starters use the correct
   `RuntimeRef` JSON objects (not string paths) so they are immediately usable
   as request bodies.

## Acceptance criteria

- [ ] The "Reference Syntax" section explicitly states that string paths are
  documentation shorthand, not API wire format.
- [ ] Every example in the section shows the `RuntimeRef` JSON object that
  corresponds to each string path.
- [ ] No `@`-prefixed reference paths remain anywhere in the README.
- [ ] All `RuntimeRef` JSON examples use `property: [...]` (array) for
  `schema-property` and `event-join-property` variants.
- [ ] Both new "Gotchas" notes are present.
- [ ] All copy-paste starters use valid `RuntimeRef` JSON objects, not string paths.

## Blocked by

- [Task 01](./01-core-type-parser-and-sql.md)

## User stories addressed

- User story 1
- User story 2
- User story 3
- User story 4
- User story 6
- User story 7
