# Deep Includes And Event Existence

**Parent Plan:** [Query Engine Hierarchical Results PRD](./README.md)

**Type:** AFK

**Status:** done

## What to build

Extend v2 rows returns from one-hop includes to deep hierarchical includes and event-backed computed output fields. This slice should support `course -> modules -> lessons`, include depth validation, nested event sources attached through `entityRef`, and the `exists` expression over an event source. The lesson row should be able to expose a boolean `isComplete` field that is true when a visible completion event exists for that lesson and false otherwise.

The implementation must use the shared source validation, source visibility, expression-source depth limits, and alias-scope rules from the parent PRD. It should not introduce old-style event joins.

## Acceptance criteria

- [x] Rows returns can include nested entity sources through depth 2, using one relationship edge per include level.
- [x] Nested lessons can be ordered by a schema-qualified lesson property.
- [x] Lesson output fields can include `exists` over an event source attached to the lesson alias with `entityRef`.
- [x] `exists` returns false for zero matching visible events and true for at least one matching visible event.
- [x] Nested event sources enforce the same user/global visibility rules as root sources.
- [x] Include depth greater than 3 fails validation.
- [x] E2E tests fetch courses with modules and lessons, verify lesson ordering, and verify per-lesson completion booleans.

## User stories addressed

Reference by number from the parent PRD:

- User story 2
- User story 4
- User story 5
- User story 10
- User story 12
- User story 13
- User story 30
- User story 32

## Follow-up (post-review)

Event sources can now be INCLUDED as nested row lists, not only consumed through `exists`
and `first`. An included event source attaches to an in-scope entity alias via `entityRef`
and returns `{ items, pageInfo: { limit, hasMore } }` of event rows, projecting event
system/property/schema-metadata fields plus the attached entity's fields. This closes the
US12 "inspect event details" gap (the prior slice only exposed event existence booleans).
Included sources (entity and event) also support `where` for child-row filtering; the parent
is still returned when no child matches. Nested includes remain supported under entity
includes only — an event include cannot nest further includes (rejected at validation).
