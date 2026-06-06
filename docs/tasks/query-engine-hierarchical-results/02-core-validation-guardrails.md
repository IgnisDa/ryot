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
