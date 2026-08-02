# Time-Series Outputs

**Parent Plan:** [RyotQL](./README.md)

**Status:** todo

## What to build

Add time-series named-query output over generic query sets. Preserve the existing hour, day, week, and month behavior, UTC semantics, Monday-start weeks, calendar months, half-open ranges, SQL-side aggregation, and contiguous zero-filled buckets. Exercise the full endpoint with event occurrence times, entity JSON date fields, relationship creation times, filtered measures, empty ranges, and multi-day gaps.

The time expression must resolve to a physical date field or an explicit safe date cast. Time series reuse generic joins, predicates, visibility, safe numeric measure expressions, and statement limits. Keep one measure per time-series query and the current 1000-bucket maximum. Do not add multiple series, custom buckets, or pagination.

## Acceptance criteria

- [ ] SDK and contract support time-series named queries over generic query sets with the retained buckets, range, time expression, and measure forms
- [ ] Time ranges are validated as half-open intervals with start before end and no more than 1000 aligned buckets
- [ ] Time expressions accept physical date fields and safe date casts while rejecting known non-date fields without a cast
- [ ] PostgreSQL performs filtering, bucketing, aggregation, grid generation, and zero filling in one statement
- [ ] Hour, day, Monday-start week, and calendar month boundaries are aligned in UTC
- [ ] Empty and interior buckets return zero and adjacent bucket boundaries remain contiguous
- [ ] Count and numeric measure behavior matches aggregate semantics over null and empty values
- [ ] End-to-end tests cover occurredAt versus createdAt, JSON dates, relationship dates, filters, half-open endpoints, gaps, empty windows, and bucket limits
- [ ] Existing RyotQL output modes and the complete legacy query-engine suite remain green
- [ ] The RyotQL guide documents time-series behavior and exclusions

## User stories addressed

- User story 14
- User story 16
- User story 17
