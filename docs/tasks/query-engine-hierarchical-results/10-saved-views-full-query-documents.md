# Saved Views Full Query Documents

**Parent Plan:** [Query Engine Hierarchical Results PRD](./README.md)

**Type:** AFK

**Status:** done

## What to build

Update saved-view persistence and validation so saved views can store full v2 query documents instead of a normalized subset of old query fields. Saved views may store rows, aggregate, or time-series returns, but UI rendering for every return type remains out of scope. Display configuration should remain a UI concern outside the core v2 query engine semantics.

This slice should integrate saved-view create/update/get validation with the v2 query document schema while preserving the side-by-side implementation strategy until canonical cutover.

## Acceptance criteria

- [x] Saved views can persist a full v2 query document without stripping fields, output definitions, includes, sources, or aggregation/time-series definitions.
- [x] Saved-view create and update paths validate v2 query documents using the same parse-time and semantic validation rules as v2 execution where applicable.
- [x] Saved views can store rows, aggregate, and time-series return documents.
- [x] Saved-view retrieval returns the stored v2 query document unchanged except for normal persistence serialization.
- [x] UI rendering support for non-row saved views is not added as part of this task.
- [x] Tests cover creating, updating, retrieving, and rejecting invalid saved views with full v2 query documents.

## Implementation notes

Saved views now have a new optional `queryDocument` field (`QueryDocumentV2`) alongside the
existing legacy `queryDefinition`. A saved view must specify exactly one of the two; the service
layer enforces this and routes to the matching validator (the existing old-engine
`validateSavedView` for `queryDefinition`, or the v2 `validateQueryDocumentV2` semantic validator
for `queryDocument`). `queryDocument` is stored and returned verbatim with no normalization,
satisfying the "unchanged" retrieval requirement. `displayConfiguration` was left untouched
(still required) since it is a UI concern orthogonal to the query document and changing its
nullability would have broken the app-client contract type (`Pick<...>` on it).

The `saved_view.query_definition` column became nullable and a new nullable
`saved_view.query_document` jsonb column was added. While regenerating the Drizzle migration, an
unrelated pre-existing issue was discovered and fixed: `drizzle.config.ts` pointed `schema` at
`schema/index.ts`, which no longer re-exports tables (removed per the "no barrel re-exports"
convention), so `drizzle-kit generate` silently produced 0 tables. Fixed by pointing `schema` at
the schema folder directly.

## User stories addressed

Reference by number from the parent PRD:

- User story 26
- User story 27
- User story 30
- User story 31
