# Time-Series Mode

**Parent Plan:** [Query Engine Modes](./README.md)

**Type:** AFK

**Status:** done

## What to build

Implement the time-series mode end-to-end. Time-series mode returns event counts or sums bucketed by time interval, enabling activity charts and temporal visualizations.

### Time-series mode request shape

Add the `timeSeries` variant to the discriminated union:

```
{
  mode: "timeSeries"
  scope: string[]              // entity schema slugs (required, min 1)
  eventSchemas: string[]       // event schema slugs (required, min 1)
  dateRange: { startAt: string, endAt: string }  // absolute ISO 8601 UTC strings
  bucket: "hour" | "day" | "week" | "month"
  metric: TimeSeriesMetric
  filter: ViewPredicate | null
  computedFields: ViewComputedField[]
}
```

No `sort`, `pagination`, `relationships`, or `eventJoins`.

### Time-series metric types

```
TimeSeriesMetric =
  | { type: "count" }
  | { type: "sum", expression: ViewExpression }
```

The `sum` metric's expression is a full `ViewExpression` compiled per-event-row and wrapped in `sum()` per bucket. It must resolve to a numeric type (validated at request time using `inferViewExpressionType`).

### Time-series mode response shape

```
{
  mode: "timeSeries",
  data: {
    buckets: Array<{ date: string, value: number }>
  }
}
```

`date` is ISO 8601 UTC string (bucket start). `value` is integer for count, number for sum. Empty buckets appear with `value: 0`.

### Time-series query builder

Build `time-series-query-builder.ts`:

```sql
WITH
  bucket_series AS (
    SELECT generate_series(
      $startAt::timestamptz,
      $endAt::timestamptz - ($bucketInterval)::interval,
      ($bucketInterval)::interval
    ) AS bucket_start
  ),
  matching_events AS (
    SELECT e.created_at, e.properties,
           en.id AS entity_id, en.name AS entity_name, en.properties AS entity_properties,
           jsonb_build_object(...) AS entity_schema_data,
           jsonb_build_object(...) AS event_schema_data
    FROM event e
    INNER JOIN entity en ON e.entity_id = en.id
    INNER JOIN entity_schema es ON en.entity_schema_id = es.id
    INNER JOIN event_schema evs ON e.event_schema_id = evs.id
    WHERE e.user_id = $userId
      AND es.id IN ($entitySchemaIds)
      AND evs.slug IN ($eventSchemaSlugs)
      AND e.created_at >= $startAt
      AND e.created_at < $endAt
      AND $filterClause
  ),
  bucketed AS (
    SELECT
      date_trunc($bucket, created_at AT TIME ZONE 'UTC') AS bucket,
      count(*)::integer AS value  -- or sum($metricExpression) for sum metric
    FROM matching_events
    GROUP BY 1
  )
SELECT
  bucket_series.bucket_start AS date,
  coalesce(bucketed.value, 0)::integer AS value
FROM bucket_series
LEFT JOIN bucketed ON bucketed.bucket = bucket_series.bucket_start
ORDER BY bucket_series.bucket_start
```

The `generate_series` + `LEFT JOIN` ensures every bucket appears with 0 for empty buckets.

Bucket interval mapping: `hour` → `'1 hour'`, `day` → `'1 day'`, `week` → `'1 week'`, `month` → `'1 month'`.

### Timezone handling

All bucketing uses UTC (`AT TIME ZONE 'UTC'`). The engine is stateless — no user timezone context.

### Filter and metric expression context

Both the filter and the sum metric expression resolve against the `matching_events` CTE. They use the same expression compiler with the same alias. Valid reference types in time-series mode:

- `event` — primary event row (id, createdAt, updatedAt, properties with eventSchemaSlug)
- `event-schema` — event's schema metadata
- `entity` — slug-qualified entity properties
- `entity-schema` — entity's schema metadata
- `computed-field` — declared computed fields

Invalid: `event-join`, `event-aggregate`.

### Preparer extension

Time-series mode needs:

1. Entity schema loading (for scope validation and entity property access in filters)
2. Event schema loading (for `eventSchemas` validation and `event` property reference validation)
3. No event join loading, no relationship loading

### Date range validation

Validate that `startAt` < `endAt`. Both must be valid ISO 8601 timestamps. No hard limit on bucket count.

## Acceptance criteria

- [x] Time-series request schema validates correctly (scope, eventSchemas, dateRange, bucket, metric, filter, computedFields)
- [x] Response includes `mode: "timeSeries"` and `buckets` array
- [x] Count metric returns correct event counts per bucket
- [x] Sum metric with ViewExpression returns correct sums per bucket
- [x] Sum metric rejects non-numeric expressions at request time
- [x] Empty buckets appear with `value: 0` (no gaps in the series)
- [x] All four bucket types work: hour, day, week, month
- [x] Filter narrows events before bucketing (event properties, entity properties both work)
- [x] Computed fields work in time-series filters and metric expressions
- [x] `event-join` and `event-aggregate` references are rejected in time-series mode
- [x] `event` and `event-schema` references work correctly in time-series filters and metric
- [x] Date range validation rejects startAt >= endAt
- [x] UTC bucketing is consistent (no timezone-dependent bucket boundaries)
- [x] Unit tests cover the time-series query builder (all bucket types, both metrics, empty buckets, filters)
- [x] E2E tests exercise time-series mode through the HTTP endpoint
- [x] `bun run typecheck`, `bun run test`, and `bun run lint` pass

## User stories addressed

- User story 3
- User story 6
- User story 7
- User story 9
- User story 17
- User story 18
- User story 20
- User story 21
