# Core Validation Guardrails

**Parent Plan:** [Query Engine Hierarchical Results PRD](./README.md)

**Type:** AFK

**Status:** done

## What to build

Extend the v2 validator and API error path so invalid query documents fail before execution. This slice should cover the PRD's parse-time and semantic validation rules for aliases, source scope, schema arrays, field selectors, rows-return requirements, include-only-on-rows constraints, expression shape, operator operand keys, aggregate key uniqueness, and exact safety limits. Validation should return typed API errors through the temporary v2 endpoint.

This is still an end-to-end slice: each validation rule should be exercised through the v2 API where practical, with unit tests reserved for deep validator behavior that is cumbersome to reach through HTTP.

## Acceptance criteria

- [x] Duplicate aliases across root, included, expression, relationship-edge, endpoint, and attached-entity aliases are rejected for the currently supported source surface.
- [x] References to aliases outside lexical scope are rejected for the currently supported source surface.
- [x] Empty or duplicate `schemas` arrays are rejected.
- [x] Property field selectors without `schema`, invalid schema qualifiers, and invalid system fields for a source type are rejected.
- [x] Rows returns reject missing `fields`, missing pagination, empty orderBy, and unsupported include/aggregate/time-series shapes at parse time.
- [x] Included sources reject missing `fields`, missing limit, over-limit values, and empty orderBy by rejecting unsupported include shapes until includes are introduced.
- [x] Boolean unary operators consistently use `expr`, `and`/`or` use non-empty `values`, and old predicate/filter shapes are rejected.
- [x] Aggregate groupBy keys and measure keys are rejected with unsupported aggregate shapes until aggregate returns are introduced.
- [x] Exact currently applicable limits are enforced: root page size 100. Include, expression-source, grouped aggregate, time-series, and aggregate matched-row limits remain tied to the tasks that introduce those constructs.
- [x] Tests cover both API-level validation failures and focused validator unit cases for scope and safety-limit behavior.

## Implementation note

This task was completed against the currently implemented v2 DSL surface, which supports entity row documents only. Future constructs such as includes, source-consuming expressions, aggregate returns, and time-series returns are still rejected by the strict parse schema instead of partially accepted. Their exact semantic limits should be implemented in the later tasks that introduce those constructs.

## User stories addressed

Reference by number from the parent PRD:

- User story 17
- User story 18
- User story 19
- User story 31
- User story 33

## Follow-up (post-review)

A review found the engine did no parse-time type-compatibility validation: the PRD's
"Expression Semantics" rules ("Comparisons must be type-compatible", "Ordering comparisons
are valid only for comparable scalar values", "Arithmetic operands must be numeric",
contains "Other operand combinations fail validation") were unenforced, and the runtime
silently returned false/null for mismatched operands.

This is now implemented in a new DB-aware phase, `validator/type-check.ts`
(`validateQueryDocumentTypeCompatibility`), invoked from `validator/references.ts` via
`validateQueryDocumentReferencesAndTypes`. It infers a coarse type for every operand
(`number | string | boolean | date | unknown`) from the system-field maps, schema-metadata
maps, and entity property schemas (loaded with the same visibility query that
`saved-views` uses, exposed as `loadVisibleEntityPropertySchemas`), then rejects only
known-incompatible combinations as `BadRequest`.

The guiding principle is zero false positives: any operand whose type cannot be confidently
determined is `unknown`, and `unknown` always passes. Concrete boundaries:

- Ordering (`gt`/`gte`/`lt`/`lte`) is rejected only when both operand types are known and
  not both numeric and not both comparable string/date (string and date are treated as
  mutually comparable because the runtime compares ISO strings).
- `eq`/`neq` are never rejected (cross-type equality is false, not invalid).
- Arithmetic rejects a known non-numeric operand.
- `contains` rejects known scalar pairs that are not string/string (array/object literals
  infer to `unknown`, so only scalar mismatches are caught).
- Event and relationship **property** operands are always treated as `unknown` because
  their property schemas are not loaded in this phase; only entity property types are
  checked. Aggregate `sum`/`average`/`minimum`/`maximum` and `measureRef` are also
  `unknown`.

Wiring: the saved-view create/update `validate` path runs the full references + type-check
phase. `QueryEngineService.execute` additionally runs the type-check phase before
execution (pure validation, then `validateQueryDocumentTypeCompatibility`, then the
executor), so direct `/query-engine/execute` calls also reject type errors up front.
`execute` intentionally does not run the visibility/reference phase (the executor already
enforces visibility and surfaces `NotFound`); the type-check loads only visible schemas, so
queries against invisible schemas still reach the executor and return `NotFound` rather
than being masked as `BadRequest`.
