# Core Validation Guardrails

**Parent Plan:** [Query Engine Hierarchical Results PRD](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Extend the v2 validator and API error path so invalid query documents fail before execution. This slice should cover the PRD's parse-time and semantic validation rules for aliases, source scope, schema arrays, field selectors, rows-return requirements, include-only-on-rows constraints, expression shape, operator operand keys, aggregate key uniqueness, and exact safety limits. Validation should return typed API errors through the temporary v2 endpoint.

This is still an end-to-end slice: each validation rule should be exercised through the v2 API where practical, with unit tests reserved for deep validator behavior that is cumbersome to reach through HTTP.

## Acceptance criteria

- [ ] Duplicate aliases across root, included, expression, relationship-edge, endpoint, and attached-entity aliases are rejected.
- [ ] References to aliases outside lexical scope are rejected, including sibling include aliases.
- [ ] Empty or duplicate `schemas` arrays are rejected.
- [ ] Property field selectors without `schema`, invalid schema qualifiers, and invalid system fields for a source type are rejected.
- [ ] Rows returns reject missing `fields`, missing pagination, empty orderBy, and includes under aggregate or time-series returns.
- [ ] Included sources reject missing `fields`, missing limit, over-limit values, and empty orderBy.
- [ ] Boolean unary operators consistently use `expr`, `and`/`or` use non-empty `values`, and old predicate/filter shapes are rejected.
- [ ] Aggregate groupBy keys and measure keys are unique in the aggregate output namespace.
- [ ] Exact limits are enforced: root page size 100, include depth 3, expression source depth 3, source aliases 50, include limit 100, grouped aggregate limit 1000, time-series buckets 1000, and aggregate expression-source matched rows 10000.
- [ ] Tests cover both API-level validation failures and focused validator unit cases for scope and safety-limit behavior.

## User stories addressed

Reference by number from the parent PRD:

- User story 17
- User story 18
- User story 19
- User story 31
- User story 33
