# Aggregate Mode

**Parent Plan:** [Query Engine Modes](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Introduce the mode-discriminated union architecture and implement the aggregate mode end-to-end. This is the first new mode — it proves the discriminated union approach while immediately fixing the 10k-row library stats bug.

### Mode-discriminated request/response schema

Transform the query engine request schema from a flat object into a Zod discriminated union on `mode`:

- `entities` variant: identical to the current request shape (add `mode: "entities"` field)
- `aggregate` variant: new shape defined below

Transform the response schema into a discriminated union on `mode`:

- `entities` response: current shape plus `mode: "entities"` field
- `aggregate` response: new shape defined below

Update `SavedViewQueryDefinition` in the saved-views schemas to become a discriminated union on `mode`. Existing entity-mode definitions become the `entities` variant.

### Aggregate mode request shape

```
{
  mode: "aggregate"
  scope: string[]                    // entity schema slugs (required, min 1)
  filter: ViewPredicate | null
  eventJoins: EventJoinDefinition[]
  relationships: RelationshipFilter[]
  computedFields: ViewComputedField[]
  aggregations: AggregationField[]   // required, min 1
}
```

### Aggregation types

Define `AggregateExpression` as a Zod discriminated union:

- `{ type: "count" }` — count all rows
- `{ type: "countWhere", predicate: ViewPredicate }` — conditional count (composes with top-level filter via `FILTER(WHERE ...)`)
- `{ type: "sum", expression: ViewExpression }` — sum a per-entity expression (must be numeric, validated at request time)
- `{ type: "avg", expression: ViewExpression }` — average (must be numeric)
- `{ type: "min", expression: ViewExpression }` — minimum (must be numeric)
- `{ type: "max", expression: ViewExpression }` — maximum (must be numeric)
- `{ type: "countBy", groupBy: ViewExpression }` — returns JSON map `{ groupValue: count }`. Null group keys excluded.

`AggregationField` = `{ key: string, aggregation: AggregateExpression }`. Keys must be unique.

### Aggregate mode response shape

```
{
  mode: "aggregate",
  data: {
    values: Array<{ key: string, kind: ResolvedDisplayValueKind, value: unknown }>
  }
}
```

### Empty set behavior

Follow SQL semantics: count/countWhere return 0 (kind: "number"), avg/sum/min/max return null (kind: "null"), countBy returns `{}` (kind: "json").

### Aggregate query builder

Build `aggregate-query-builder.ts`. Extract shared CTE builders (`buildBaseEntitiesCte`, `buildLatestEventJoinCte`, `buildJoinedEntitiesCte`) from the existing `query-builder.ts` into reusable helpers that both entity mode and aggregate mode import.

The aggregate SQL:
- Reuses entity-mode CTEs up through `filtered_entities`
- Compiles each aggregation into a SELECT column
- `countWhere` uses `count(*) FILTER (WHERE $predicate)`
- `sum`/`avg`/`min`/`max` compile the inner expression per entity row and wrap in the aggregate function
- `countBy` uses a scalar subquery: `(SELECT jsonb_object_agg(gk, gc) FROM (SELECT expr::text AS gk, count(*)::integer AS gc FROM filtered_entities WHERE expr IS NOT NULL GROUP BY gk) sub)`

### Preparer and route updates

- `preparer.ts` dispatches on `mode`: entity mode goes through existing `executePreparedQuery`, aggregate mode goes through a new `executeAggregateQuery`
- `routes.ts` handles the discriminated response (returns `mode` field)
- Validator confirms that `event` and `event-schema` references are rejected in aggregate mode (same as entity mode)

### Reference validity in aggregate mode

Valid: `entity`, `entity-schema`, `event-join`, `event-aggregate`, `computed-field`.
Invalid: `event`, `event-schema`.

### Numeric validation for sum/avg/min/max

The inner `expression` in sum/avg/min/max aggregations must resolve to a numeric type. Use `inferViewExpressionType` to check at request time. Reject non-numeric expressions with a `QueryEngineValidationError`.

## Acceptance criteria

- [ ] Request schema is a discriminated union on `mode` with `entities` and `aggregate` variants
- [ ] Response schema is a discriminated union on `mode`
- [ ] `SavedViewQueryDefinition` is a discriminated union on `mode`
- [ ] Existing entity mode continues to work unchanged (all existing tests pass)
- [ ] Aggregate mode `count` returns correct total count
- [ ] Aggregate mode `countWhere` returns correct conditional count (composes with top-level filter)
- [ ] Aggregate mode `sum`/`avg`/`min`/`max` return correct values for numeric expressions
- [ ] Aggregate mode `sum`/`avg`/`min`/`max` reject non-numeric expressions at request time
- [ ] Aggregate mode `countBy` returns correct JSON map with null keys excluded
- [ ] Empty set produces count=0, avg=null, countBy={}
- [ ] `event` and `event-schema` references are rejected in aggregate mode
- [ ] Shared CTE builders are extracted and reused by both entity and aggregate modes
- [ ] Unit tests cover each aggregation type, empty sets, numeric validation rejection
- [ ] E2E tests exercise aggregate mode through the HTTP endpoint
- [ ] `bun run typecheck`, `bun run test`, and `bun run lint` pass

## User stories addressed

- User story 2
- User story 5
- User story 7
- User story 8
- User story 14
- User story 15
- User story 16
- User story 20
- User story 21
