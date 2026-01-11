# V2 Entity Rows API

**Parent Plan:** [Query Engine Hierarchical Results PRD](./README.md)

**Type:** AFK

**Status:** done

## What to build

Build the first end-to-end vertical slice of the side-by-side v2 query engine: a temporary v2 query document schema, temporary v2 execute API, service path, validator, execution path, and E2E coverage for root entity row queries. This slice should support the PRD's entity source shape, field selector model, root rows return shape, root pagination contract, root orderBy using `order`, typed field values, and authenticated visibility. Keep the old query engine untouched except for app wiring needed to expose the v2 route.

This slice does not need relationship includes, event sources, aggregate returns, time-series returns, saved views, or canonical cutover. It should establish the module boundaries and contract that later v2 slices extend.

## Acceptance criteria

- [x] A temporary v2 query engine endpoint exists alongside the current query engine and accepts `version: 2` query documents.
- [x] A root entity source with one or more schema slugs can return row items with requested fields using system, property, and schema metadata field selectors.
- [x] Root rows require pagination, non-empty orderBy, and `fields`, with empty `fields` allowed.
- [x] Root pagination applies to root rows only and returns root page metadata including total count.
- [x] Property field selectors require explicit `schema` and return null on rows from other schemas in a multi-schema source.
- [x] V2 entity row queries enforce authenticated visibility, including user-owned rows and allowed global rows only.
- [x] E2E tests cover a successful single-schema entity rows query, a successful multi-schema property query, pagination metadata, and a visibility boundary.

## User stories addressed

Reference by number from the parent PRD:

- User story 17
- User story 18
- User story 19
- User story 27
- User story 28
- User story 30
- User story 31
- User story 32
- User story 34

## Follow-up (post-review)

A post-implementation review found that date literals (`valueType: "date"`) were parsed but
ignored at evaluation, so they serialized as `text`. Date literals now resolve to the `date`
field-value kind (the value remains the string); plain string literals still resolve to
`text`.
