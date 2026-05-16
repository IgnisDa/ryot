# Aggregate Returns

**Parent Plan:** [Query Engine Hierarchical Results PRD](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Implement v2 aggregate returns over any supported source. Aggregate returns should use row-shaped responses with `items`, shared aggregation specs under `aggregation`, optional `groupBy`, required grouped limit/orderBy, grouped limited result pageInfo, ungrouped single-item output, `measureRef` orderBy expressions, and shared key uniqueness across groupBy keys and measure keys.

This slice should absorb the old aggregate mode into the v2 source model while preserving the PRD's new response shape and validation rules.

## Acceptance criteria

- [ ] Ungrouped aggregate returns produce exactly one item and no pageInfo.
- [ ] Grouped aggregate returns produce one item per group plus `pageInfo` with `limit` and `hasMore`.
- [ ] Grouped aggregate returns require non-empty orderBy and a limit no greater than 1000.
- [ ] Aggregate-return measures use `{ key, aggregation }` with the shared aggregation spec.
- [ ] `measureRef` is valid only inside aggregate-return orderBy and resolves to a sibling measure key.
- [ ] GroupBy keys and measure keys must be unique in the aggregate output namespace.
- [ ] Count, sum, average, minimum, maximum, and count distinct behave according to the shared aggregation spec semantics.
- [ ] E2E tests cover ungrouped count, grouped count by a property, ordering by `measureRef`, grouped pagination hasMore, and validation for duplicate aggregate output keys.

## User stories addressed

Reference by number from the parent PRD:

- User story 20
- User story 21
- User story 30
- User story 31
- User story 33
