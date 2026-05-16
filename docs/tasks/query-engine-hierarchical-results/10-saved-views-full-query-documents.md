# Saved Views Full Query Documents

**Parent Plan:** [Query Engine Hierarchical Results PRD](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Update saved-view persistence and validation so saved views can store full v2 query documents instead of a normalized subset of old query fields. Saved views may store rows, aggregate, or time-series returns, but UI rendering for every return type remains out of scope. Display configuration should remain a UI concern outside the core v2 query engine semantics.

This slice should integrate saved-view create/update/get validation with the v2 query document schema while preserving the side-by-side implementation strategy until canonical cutover.

## Acceptance criteria

- [ ] Saved views can persist a full v2 query document without stripping fields, output definitions, includes, sources, or aggregation/time-series definitions.
- [ ] Saved-view create and update paths validate v2 query documents using the same parse-time and semantic validation rules as v2 execution where applicable.
- [ ] Saved views can store rows, aggregate, and time-series return documents.
- [ ] Saved-view retrieval returns the stored v2 query document unchanged except for normal persistence serialization.
- [ ] UI rendering support for non-row saved views is not added as part of this task.
- [ ] Tests cover creating, updating, retrieving, and rejecting invalid saved views with full v2 query documents.

## User stories addressed

Reference by number from the parent PRD:

- User story 26
- User story 27
- User story 30
- User story 31
