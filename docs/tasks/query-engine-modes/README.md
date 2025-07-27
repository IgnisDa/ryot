## Problem Statement

The query engine (`POST /query-engine/execute`) is entity-centric. It accepts a declarative query and returns entities as primary rows, optionally joined with their latest event per event schema. This powers saved view entity lists across the app.

However, the tracker overview page (e.g., the Media overview) requires sections that cannot be expressed as entity queries:

1. **Recent Activity** lists the last N events (not entities) across all media schemas, joined with their entity name/image/schema. The primary rows are events ordered by `createdAt DESC`. The query engine has no mode for this — it always returns entities.

2. **Library Stats** fetches ALL entities (up to a hardcoded 10,000 row limit) and aggregates in TypeScript: total count, count by entity schema, in-progress count, completed count, average rating. This is broken for users with large libraries — anyone with more than 10,000 tracked entities gets incorrect stats.

3. **Week Activity** counts events per day for the current ISO week. Returns a 7-element array with `{ date, count }`. This is time-bucketed aggregation over events — `GROUP BY date_trunc('day', created_at)` with a date range filter.

The composability goal is that any overview section should be expressible as a query definition stored in the database (inside a saved view or widget configuration record). If the query engine can only return "entities matching criteria," then event-centric and aggregate sections must remain as hardcoded endpoints with custom SQL — defeating composability.

## Solution

Extend the query engine with three new execution modes alongside the existing entity mode. The request becomes a discriminated union on a `mode` field. All modes share the same endpoint (`POST /query-engine/execute`) and reuse existing infrastructure (expression compiler, filter builder, sort builder, display builder, schema loading, access scoping).

The four modes are:

- **`entities`** — existing behavior, unchanged. Entity-centric, paginated rows, event joins for per-entity state.
- **`events`** — event-first queries. Returns events as primary rows with entity info joined. Supports pagination, filtering, sorting.
- **`aggregate`** — statistics queries. Returns a single set of computed aggregate values (counts, sums, averages, grouped counts) pushed to SQL. No pagination.
- **`timeSeries`** — time-bucketed aggregation. Returns event counts/sums bucketed by time interval. Returns an array of `{ date, value }`.

As a prerequisite, the existing `event` reference type is renamed to `event-join` (since it references a laterally joined event declared via `eventJoins`), and two new reference types (`event`, `event-schema`) are introduced for event-first modes.

After the engine extension is built, the media service's hardcoded custom queries (activity, week, stats) are migrated to use the new modes — proving the engine solves the problem.

## User Stories

1. As a tracker overview designer, I want to define a "recent activity" section as a stored query definition, so that activity feeds are composable and not hardcoded.
2. As a user with a large media library (>10,000 entities), I want library stats to be accurate, so that my overview page shows correct counts and averages regardless of library size.
3. As a tracker overview designer, I want to define a "week activity" chart as a stored query definition, so that time-bucketed visualizations are composable.
4. As a saved view author, I want to query events directly (not just entities), so that I can build event-centric views like "my recent reviews" or "all completions this month."
5. As a saved view author, I want to compute aggregates (count, avg, sum) in SQL without fetching all rows, so that stats scale to any library size.
6. As a saved view author, I want to count events bucketed by day/week/month, so that I can build activity charts without custom SQL.
7. As a frontend widget renderer, I want the query engine response to include a `mode` discriminant, so that I can deserialize responses unambiguously.
8. As a frontend widget renderer, I want aggregate results as a flat array of `{ key, kind, value }`, so that I render stat cards using the same display-value pipeline as entity fields.
9. As a frontend widget renderer, I want time-series results as `{ date, value }` buckets, so that I render bar/line charts directly from the response.
10. As a saved view author using event mode, I want to access the primary event's properties directly via `event` references, so that I don't need lateral joins to read the current row's data.
11. As a saved view author using event mode, I want to access the event's schema metadata (slug, name) via `event-schema` references, so that I can display event type labels.
12. As a saved view author using event mode, I want to access the event's associated entity via `entity` references (slug-qualified), so that I can display entity name/image alongside events.
13. As a saved view author using event mode, I want to declare event joins (for OTHER event schemas on the same entity), so that I can show related event data like "entity's latest rating" next to each activity event.
14. As a saved view author using aggregate mode, I want `countWhere` with a predicate, so that I can compute conditional counts (in-progress, completed) within the filtered set.
15. As a saved view author using aggregate mode, I want `countBy` with a group expression, so that I can compute counts per entity schema slug or any other groupable value.
16. As a saved view author using aggregate mode, I want `avg`/`sum`/`min`/`max` with a ViewExpression, so that I can compute averages over per-entity values like latest review rating.
17. As a saved view author using time-series mode, I want to filter events by entity and event properties, so that I can build charts like "horror movie completions per day."
18. As a saved view author using time-series mode, I want a sum metric with a full ViewExpression, so that I can chart total runtime/pages per day.
19. As a developer, I want the reference type rename (`event` to `event-join`) done as a prerequisite, so that the naming is clear before new modes are built.
20. As a developer, I want the `SavedViewQueryDefinition` type to be a discriminated union on mode, so that stored definitions are type-safe per mode.
21. As a developer, I want mode-specific reference validation, so that invalid references (e.g., `event` ref in entity mode) are rejected at request time with clear errors.
22. As a developer working on the media overview, I want to replace `getRecentActivityItems` with an events-mode query, so that the custom Drizzle query in the repository is eliminated.
23. As a developer working on the media overview, I want to replace `getLibraryStats` with an aggregate-mode query, so that the 10k-row-fetch workaround is eliminated.
24. As a developer working on the media overview, I want to replace `getWeekActivity` with a time-series-mode query, so that the custom Drizzle query in the repository is eliminated.

## Implementation Decisions

### Discriminated Union on `mode`

The request body is a Zod discriminated union on the `mode` field. The response body is also discriminated on `mode`. This enables:
- Single endpoint (`POST /query-engine/execute`)
- Polymorphic storage in saved view `queryDefinition` JSONB
- Self-describing responses

### Reference Type Rename (Prerequisite)

The existing `{ type: "event", joinKey: string, path: string[] }` reference is renamed to `{ type: "event-join", joinKey: string, path: string[] }`. This frees `event` for the new primary-event-row reference. The rename affects:
- The `RuntimeRef` type in `@ryot/ts-utils`
- Zod schemas in the views expression library
- Expression compiler handlers
- All tests and fixtures
- Media service code

Two new reference types are introduced:
- `{ type: "event", eventSchemaSlug?: string, path: string[] }` — the primary event row in event-first modes. `eventSchemaSlug` is required when `path` starts with `"properties"` (for property validation and CASE WHEN generation). Built-in columns (`id`, `createdAt`, `updatedAt`) don't need it.
- `{ type: "event-schema", path: string[] }` — the primary event's schema metadata. Available columns: `id`, `slug`, `name`, `isBuiltin`, `createdAt`, `updatedAt`. All are filterable, sortable, and displayable.

### Reference Validity Per Mode

| Reference Type | entities | events | aggregate | timeSeries |
|---|---|---|---|---|
| `entity` (slug-qualified) | valid | valid | valid | valid |
| `entity-schema` | valid | valid | valid | valid |
| `event-join` (joinKey) | valid | valid | valid | invalid |
| `event-aggregate` | valid | invalid | valid | invalid |
| `computed-field` | valid | valid | valid | valid |
| `event` (primary event) | invalid | valid | invalid | valid |
| `event-schema` (primary event's schema) | invalid | valid | invalid | valid |

The validator enforces this matrix per mode at request time.

### Entity References Always Require Slug

In all modes (including event mode), entity references require a `slug` field. Multi-schema queries use `coalesce` across slugs. This maintains consistency with entity mode and requires no behavioral changes to the expression compiler's entity reference handler.

### Events Mode Request Shape

```
{
  mode: "events"
  scope: string[]              // entity schema slugs (required, at least one)
  eventSchemas: string[]       // event schema slugs (required, at least one)
  fields: QueryEngineField[]   // output fields per event row
  sort: SortDefinition         // required, no default
  pagination: Pagination
  filter: ViewPredicate | null
  computedFields: ViewComputedField[]
  eventJoins: EventJoinDefinition[]  // for accessing OTHER events on the same entity
}
```

Events mode returns paginated event rows. The response shape is identical to entity mode: `{ mode, data: { meta: { pagination }, items: [[{ key, kind, value }]] } }`.

Events mode does NOT support:
- `relationships` — events are user-owned, no access control gap
- `event-aggregate` references — per-entity aggregation doesn't apply to event-first results

Event joins ARE supported — they attach the latest event of another schema to the event's entity (same lateral join pattern, keyed by entity_id). All events for the same entity receive the same event-join values.

No deduplication: event mode always returns all matching events. If you want one event per entity, use entity mode with event joins.

### Events Mode CTE Structure

```sql
WITH
  base_events AS (
    SELECT
      e.id, e.created_at, e.updated_at, e.properties, e.entity_id,
      en.name AS entity_name, en.image AS entity_image,
      en.properties AS entity_properties,
      jsonb_build_object(...) AS entity_schema_data,
      jsonb_build_object(...) AS event_schema_data
    FROM event e
    INNER JOIN entity en ON e.entity_id = en.id
    INNER JOIN entity_schema es ON en.entity_schema_id = es.id
    INNER JOIN event_schema evs ON e.event_schema_id = evs.id
    WHERE e.user_id = $userId
      AND es.id IN ($entitySchemaIds)
      AND evs.slug IN ($eventSchemaSlugs)
  ),
  -- optional event join CTEs (lateral on entity_id)
  latest_event_join_{key} AS (...),
  joined_events AS (
    SELECT base_events.*, event_join_columns...
    FROM base_events LEFT JOIN latest_event_join_* ON entity_id
  ),
  filtered_events AS (
    SELECT * FROM joined_events WHERE $filterClause
  ),
  sorted_events AS (
    SELECT *, count(*) OVER()::integer AS total,
      row_number() OVER (ORDER BY $sort $direction NULLS LAST, id ASC) AS sort_index
    FROM filtered_events
  ),
  event_count AS (
    SELECT coalesce(max(total), 0)::integer AS total FROM sorted_events
  ),
  paginated_events AS (
    SELECT * FROM sorted_events ORDER BY sort_index OFFSET $offset LIMIT $limit
  )
SELECT
  paginated_events.id AS event_id,
  event_count.total,
  $resolvedFields AS fields
FROM event_count
LEFT JOIN paginated_events ON true
ORDER BY sort_index
```

### Events Mode Expression Resolution

In event mode:
- `event` references resolve against the primary event row columns: `id` = `alias.id`, `createdAt` = `alias.created_at`, `properties.X` = `alias.properties -> 'X'`. When `eventSchemaSlug` is provided, a CASE WHEN wraps property access: `CASE WHEN event_schema_data ->> 'slug' = $slug THEN ... ELSE null END`.
- `entity` references resolve against `alias.entity_name`, `alias.entity_image`, `alias.entity_properties` with slug-based CASE WHEN for multi-schema queries (same as entity mode).
- `entity-schema` references resolve against `alias.entity_schema_data ->> $column` (same as entity mode).
- `event-schema` references resolve against `alias.event_schema_data ->> $column` with appropriate type casting.
- `event-join` references resolve against the lateral join columns (same pattern as entity mode).

### Aggregate Mode Request Shape

```
{
  mode: "aggregate"
  scope: string[]
  filter: ViewPredicate | null
  eventJoins: EventJoinDefinition[]
  relationships: RelationshipFilter[]
  computedFields: ViewComputedField[]
  aggregations: AggregationField[]
}
```

No `sort`, no `pagination`, no `fields`. The `aggregations` array defines named aggregate computations.

### Aggregation Field Types

```
AggregationField = { key: string, aggregation: AggregateExpression }

AggregateExpression =
  | { type: "count" }
  | { type: "countWhere", predicate: ViewPredicate }
  | { type: "sum", expression: ViewExpression }
  | { type: "avg", expression: ViewExpression }
  | { type: "min", expression: ViewExpression }
  | { type: "max", expression: ViewExpression }
  | { type: "countBy", groupBy: ViewExpression }
```

- `count` — count all rows in the filtered set
- `countWhere` — count rows matching the predicate WITHIN the already-filtered set (composes with top-level filter via SQL `FILTER(WHERE ...)`)
- `sum`/`avg`/`min`/`max` — aggregate a per-entity ViewExpression. The expression is validated at request time to be numeric (using `inferViewExpressionType`). Non-numeric expressions are rejected with a validation error.
- `countBy` — returns a JSON object `{ groupValue: count }`. Null group keys are excluded from the result. The groupBy expression is compiled per-entity, then grouped.

### Aggregate Mode Response Shape

```
{
  mode: "aggregate",
  data: {
    values: Array<{ key: string, kind: ResolvedDisplayValueKind, value: unknown }>
  }
}
```

A single flat array of resolved values (same `{ key, kind, value }` shape as entity-mode fields). `count`/`countWhere` return `kind: "number"`. `avg`/`sum`/`min`/`max` return `kind: "number"` or `kind: "null"` (on empty set). `countBy` returns `kind: "json"` with a `Record<string, number>` value.

### Aggregate Mode SQL Shape

Reuses `buildBaseEntitiesCte`, `buildLatestEventJoinCte`, `buildJoinedEntitiesCte` from entity mode. Then:

```sql
WITH
  base_entities AS (...),
  latest_event_join_{key} AS (...),
  joined_entities AS (...),
  filtered_entities AS (
    SELECT * FROM joined_entities WHERE $filterClause
  )
SELECT
  count(*)::integer AS "total",
  count(*) FILTER (WHERE $predicate)::integer AS "inProgress",
  avg($ratingExpression) AS "avgRating",
  (
    SELECT jsonb_object_agg(gk, gc)
    FROM (
      SELECT ($groupByExpr)::text AS gk, count(*)::integer AS gc
      FROM filtered_entities
      WHERE ($groupByExpr) IS NOT NULL
      GROUP BY gk
    ) sub
  ) AS "bySchema"
FROM filtered_entities
```

### Aggregate Mode Empty Set Behavior

Follows SQL semantics: `count`/`countWhere` return 0, `avg`/`sum`/`min`/`max` return null, `countBy` returns empty object `{}`.

### Time-Series Mode Request Shape

```
{
  mode: "timeSeries"
  scope: string[]              // entity schema slugs (required)
  eventSchemas: string[]       // event schema slugs (required)
  dateRange: { startAt: string, endAt: string }  // absolute ISO 8601 UTC
  bucket: "hour" | "day" | "week" | "month"
  metric: TimeSeriesMetric
  filter: ViewPredicate | null
  computedFields: ViewComputedField[]
}
```

The caller always provides absolute dates. Relative range resolution (e.g., "current ISO week") happens at the call site, not in the engine.

### Time-Series Metric Types

```
TimeSeriesMetric =
  | { type: "count" }
  | { type: "sum", expression: ViewExpression }
```

Only `count` and `sum`. The `sum` expression is a full `ViewExpression` compiled per-event-row and aggregated per bucket.

### Time-Series Mode Response Shape

```
{
  mode: "timeSeries",
  data: {
    buckets: Array<{ date: string, value: number }>
  }
}
```

`date` is ISO 8601 UTC string (bucket start). `value` is integer (for count) or number (for sum). Empty buckets appear with `value: 0` (guaranteed by `generate_series` + `LEFT JOIN`).

### Time-Series Mode SQL Shape

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
    SELECT e.created_at, e.properties, en.properties AS entity_properties,
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

### Time-Series Filter and Metric References

Both the filter and the metric expression resolve against the `matching_events` CTE. Valid reference types: `event`, `event-schema`, `entity` (slug-qualified), `entity-schema`, `computed-field`. The same expression compiler is used for both.

### Time-Series Timezone

All bucketing uses UTC. The engine is stateless — no user timezone context.

### Time-Series Bucket Limits

No hard limit on the number of buckets. The caller is responsible for reasonable ranges.

### No Relationships in Event-First Modes

Events mode and time-series mode do not support the `relationships` parameter. Events are user-owned (`event.userId`), so access control is already satisfied by event ownership.

### No Event Deduplication in Events Mode

Events mode returns all matching events. No "distinct per entity" option. If you want one event per entity, use entity mode with event joins. Modes don't overlap.

### Sort Required in All Modes

Sort is required (no default) in entities mode and events mode. Aggregate mode and time-series mode have no sort (aggregate has one result; time-series is ordered by bucket).

### No Hard Pagination Limits

No engine-enforced maximum limit on pagination in any mode. Callers control their own limits.

### Stored Query Definition Type

`SavedViewQueryDefinition` becomes a Zod discriminated union on `mode`:

```
SavedViewQueryDefinition =
  | EntityQueryDefinition    (mode: "entities")
  | EventQueryDefinition     (mode: "events")
  | AggregateQueryDefinition (mode: "aggregate")
  | TimeSeriesQueryDefinition (mode: "timeSeries")
```

Each variant contains only the fields relevant to its mode. Existing saved views are treated as `EntityQueryDefinition` (the mode field is added).

### Infrastructure Sharing

| Component | entities | events | aggregate | timeSeries |
|---|---|---|---|---|
| Schema loading (preparer) | reused | reused | reused | reused |
| Access scoping (userId) | reused | reused | reused | reused |
| Expression compiler | reused | extended (new refs) | reused | extended (new refs) |
| Filter builder | reused | reused | reused | reused |
| Sort builder | reused | reused | n/a | n/a |
| Display builder | reused | reused | adapted (single row) | n/a (fixed shape) |
| Pagination utilities | reused | reused | n/a | n/a |
| Event join loading | reused | reused | reused | n/a |
| Relationship loading | reused | n/a | reused | n/a |
| Base entity CTEs | reused | n/a (different CTEs) | reused | n/a |

### Implementation Order

1. Reference rename (`event` to `event-join`, add new `event` + `event-schema`)
2. Aggregate mode (fixes the 10k-row bug, reuses existing entity CTEs, lowest risk)
3. Events mode (most architecturally novel — new CTE structure, new ref handlers)
4. Time-series mode (builds on event-mode patterns)
5. Media service migration (proves the engine solves the problem)

### CTE Reuse for Aggregate Mode

Aggregate mode reuses `buildBaseEntitiesCte`, `buildLatestEventJoinCte`, and `buildJoinedEntitiesCte` from the existing entity-mode query builder. These should be extracted into shared helpers so both entity mode and aggregate mode import them.

### Expression Compiler Extension

The expression compiler gains two new reference handlers:
- `event` → resolves event row columns/properties from the CTE alias. Built-in columns: `id`, `createdAt`, `updatedAt`. Property paths use JSONB access with CASE WHEN on `event_schema_data.slug` when `eventSchemaSlug` is provided.
- `event-schema` → resolves `alias.event_schema_data ->> $column` with type casting. Same pattern as existing `entity-schema` handler.

### Media Service Migration

After all modes are built:
- `getRecentActivityItems` becomes an events-mode query with `eventSchemas: ["review", "complete", "progress", "backlog"]`, sorted by `event.createdAt DESC`, limit 12.
- `getLibraryStats` becomes an aggregate-mode query with `countWhere` for in-progress/completed/backlog, `avg` for rating, `countBy` for schema slug distribution. No row limit.
- `getWeekActivity` becomes a time-series query with `bucket: "day"`, absolute date range (current ISO week computed at call site), `metric: { type: "count" }`.
- Custom Drizzle queries in the media repository (`listRecentActivityEventsForUser`, `listWeekActivityEventsForUser`) are removed.

## Testing Decisions

### What Makes a Good Test

Tests should verify external behavior through the module's public interface, not implementation details. A good query engine test sends a request and asserts the response shape and values. A bad test would assert internal CTE SQL strings or mock the expression compiler.

### Modules to Test

1. **Expression compiler (unit tests)** — new `event` and `event-schema` reference handlers. Test that they produce correct SQL fragments for built-in columns, property paths with eventSchemaSlug, and CASE WHEN generation. Follow existing patterns in `expression-compiler.test.ts`.

2. **Aggregate query builder (unit tests)** — test each aggregation type: count, countWhere, sum, avg, min, max, countBy. Test empty set behavior (count=0, avg=null, countBy={}). Test that countWhere composes with top-level filter. Follow existing patterns in `query-builder.test.ts`.

3. **Event query builder (unit tests)** — test CTE construction with and without event joins. Test pagination, sorting, filtering. Follow existing patterns in `query-builder.test.ts`.

4. **Time-series query builder (unit tests)** — test bucket generation, empty bucket filling, count metric, sum metric with expression. Test date range boundaries.

5. **E2E tests (integration)** — test all four modes through the HTTP endpoint with real database state. Follow existing patterns in `tests/src/tests/query-engine.test.ts`. Cover:
   - Events mode: recent events, filtering by event schema, sorting, event-join access
   - Aggregate mode: all aggregation types, empty sets, numeric validation rejection
   - Time-series mode: daily buckets, sum metric, filter application
   - Mode-specific reference validation (reject invalid refs per mode)

6. **Media service migration tests** — update existing media service tests to verify the new implementations produce equivalent results.

### Prior Art

- `apps/app-backend/src/modules/query-engine/expression-compiler.test.ts`
- `apps/app-backend/src/modules/query-engine/query-builder.test.ts`
- `apps/app-backend/src/modules/query-engine/filter-builder.test.ts`
- `apps/app-backend/src/modules/query-engine/display-builder.test.ts`
- `tests/src/tests/query-engine.test.ts`
- `tests/src/fixtures/query-engine.ts`
- `tests/src/test-support/query-engine-suite.ts`

## Out of Scope

- **Widget type rendering** — how overview sections associate query definitions with widget types (entityList, statCard, barChart) is a frontend/overview-page concern, not a query engine concern.
- **Dynamic/relative date ranges** — the engine receives absolute timestamps. Relative range resolution ("current ISO week", "last 30 days") happens at the call site.
- **User timezone support** — all bucketing uses UTC. Frontend adjusts display labels.
- **Additional time-series metrics** — only `count` and `sum` are implemented. `avg`/`min`/`max` per bucket can be added later.
- **Event deduplication** — no "distinct per entity" option in events mode. Use entity mode with event joins for that use case.
- **Overview page configuration storage** — how widget sections are stored, ordered, and rendered is a separate design concern.

## Further Notes

### Why One Endpoint

All modes share one endpoint because:
1. Stored query definitions are polymorphic JSONB — one column stores any mode's definition
2. The frontend calls one API regardless of widget type
3. The preparer already orchestrates mode dispatch — adding routes would fragment what is conceptually "execute a query"

### Why Not Application-Level Aggregation

The current library stats approach (fetch 10k rows, aggregate in TypeScript) is fundamentally broken:
- Users with >10k entities get incorrect stats
- Network transfer of 10k rows for 6 numbers is wasteful
- Aggregation logic duplicates what SQL does natively

Aggregate mode pushes all computation to PostgreSQL. The response contains only the computed values.

### Event Mode vs Entity Mode with Event Joins

These serve different purposes:
- Entity mode + event joins: "show me entities, with their latest event state" (one row per entity)
- Events mode: "show me events" (one row per event, same entity can appear multiple times)

A "what am I currently watching" view uses entity mode. A "what did I do recently" feed uses events mode.

### Backward Compatibility Note

This is a greenfield project. There are no external consumers or persisted saved view records to migrate. The reference rename and type changes can be done freely without migration scripts.

---

## Tasks

**Overall Progress:** 6 of 6 tasks completed

**Current Task:** All tasks complete

### Task List

| #   | Task                                                        | Type | Status |
| --- | ----------------------------------------------------------- | ---- | ------ |
| 01  | [Reference Type Rename](./01-reference-type-rename.md)      | AFK  | done   |
| 02  | [Aggregate Mode](./02-aggregate-mode.md)                    | AFK  | done   |
| 03  | [Events Mode](./03-events-mode.md)                          | AFK  | done   |
| 04  | [Time-Series Mode](./04-time-series-mode.md)                | AFK  | done   |
| 05  | [Media Service Migration](./05-media-service-migration.md)  | AFK  | done   |
| 06  | [Codebase Cleanup](./06-codebase-cleanup.md)                | AFK  | done   |
