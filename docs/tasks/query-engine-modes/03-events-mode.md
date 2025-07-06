# Events Mode

**Parent Plan:** [Query Engine Modes](./README.md)

**Type:** AFK

**Status:** done

## What to build

Implement the events mode end-to-end — the most architecturally novel mode. Events mode returns events as primary rows with entity info joined, enabling activity feeds and event-centric views.

### Events mode request shape

Add the `events` variant to the discriminated union:

```
{
  mode: "events"
  scope: string[]              // entity schema slugs (required, min 1)
  eventSchemas: string[]       // event schema slugs (required, min 1)
  fields: QueryEngineField[]
  sort: SortDefinition         // required, no default
  pagination: Pagination
  filter: ViewPredicate | null
  computedFields: ViewComputedField[]
  eventJoins: EventJoinDefinition[]  // for OTHER events on the same entity
}
```

No `relationships` parameter. Events are user-owned.

### Events mode response shape

Identical structure to entity mode:

```
{
  mode: "events",
  data: {
    meta: { pagination: PaginationResult },
    items: Array<Array<{ key: string, kind: string, value: unknown }>>
  }
}
```

### Event mode query builder

Build `event-query-builder.ts` with the CTE structure:

1. `base_events` — events joined with entity, entity_schema, event_schema. Filtered by userId, entity schema IDs, event schema slugs. Includes:
   - Event columns: `id`, `created_at`, `updated_at`, `properties`, `entity_id`
   - Entity columns: `entity_name`, `entity_image`, `entity_properties`, `external_id`, `sandbox_script_id`
   - `entity_schema_data` JSONB (same format as entity mode)
   - `event_schema_data` JSONB: `jsonb_build_object('id', evs.id, 'slug', evs.slug, 'name', evs.name, 'isBuiltin', evs.is_builtin, 'createdAt', evs.created_at, 'updatedAt', evs.updated_at)`

2. Optional `latest_event_join_{key}` CTEs — same lateral join pattern as entity mode, keyed on `entity_id`. Multiple events for the same entity all receive the same join values.

3. `joined_events` — base_events LEFT JOINed with event join CTEs.

4. `filtered_events` — WHERE clause from filter builder.

5. `sorted_events` — window functions for total count and sort_index.

6. `paginated_events` — OFFSET/LIMIT.

7. Final SELECT with resolved fields from display builder.

### Expression compiler: `event` reference handler

Add handler for `{ type: "event", eventSchemaSlug?: string, path: string[] }`:

- Built-in columns (`id`, `createdAt`, `updatedAt`): resolve to `alias.id`, `alias.created_at`, `alias.updated_at`. No CASE WHEN needed (all events have these).
- Property paths (`["properties", "fieldName", ...]`): resolve to JSONB access on `alias.properties`. When `eventSchemaSlug` is provided, wrap in `CASE WHEN alias.event_schema_data ->> 'slug' = $slug THEN ... ELSE null END`.

Property validation: when `eventSchemaSlug` is provided, validate that the referenced property exists in that event schema's `propertiesSchema` (loaded during preparation). Same validation pattern as entity property references.

### Expression compiler: `event-schema` reference handler

Add handler for `{ type: "event-schema", path: string[] }`:

- Resolve to `alias.event_schema_data ->> $column` with type casting.
- Available columns: `id` (string), `slug` (string), `name` (string), `isBuiltin` (boolean), `createdAt` (datetime), `updatedAt` (datetime).
- All are filterable, sortable, and displayable.
- Same pattern as existing `entity-schema` handler but reading from `event_schema_data`.

### Validator: mode-aware reference validity

Extend the validator to enforce the reference validity matrix per mode:

- Events mode valid: `entity`, `entity-schema`, `event-join`, `event`, `event-schema`, `computed-field`
- Events mode invalid: `event-aggregate`

The validator needs to know the current mode to enforce this. Pass mode context through the validation functions.

### Preparer: event schema loading

Events mode needs to load event schemas for:
1. Validating `eventSchemas` slugs exist for the scoped entity schemas
2. Loading event schema `propertiesSchema` for `event` property reference validation
3. Building the `event_schema_data` JSONB

Add event schema loading to the preparer for events mode. Build an event schema map keyed by slug for property validation.

### No deduplication

Events mode returns all matching events. The same entity can appear multiple times (once per event). No distinct-per-entity option.

## Acceptance criteria

- [ ] Events mode request schema validates correctly (scope, eventSchemas, fields, sort, pagination, filter, computedFields, eventJoins all work)
- [ ] Events mode response includes `mode: "events"` and standard pagination metadata
- [ ] Event query builder generates correct CTEs (base_events with all joins, event join CTEs, filtering, sorting, pagination)
- [ ] `event` references resolve correctly for built-in columns (id, createdAt, updatedAt)
- [ ] `event` references resolve correctly for property paths with eventSchemaSlug (CASE WHEN generated)
- [ ] `event` references without eventSchemaSlug work for built-in columns
- [ ] `event-schema` references resolve all 6 columns correctly with proper type casting
- [ ] Entity references work in event mode (slug-qualified, CASE WHEN for multi-schema)
- [ ] Event joins work in event mode (lateral join on entity_id, all events for same entity get same values)
- [ ] `event-aggregate` references are rejected in events mode
- [ ] `event` and `event-schema` references are rejected in entity mode and aggregate mode
- [ ] Filtering by event properties, entity properties, and event-schema columns works
- [ ] Sorting by event createdAt and other expressions works
- [ ] Pagination returns correct totals and page metadata
- [ ] Property validation works for event references with eventSchemaSlug
- [ ] Unit tests cover the event query builder, expression compiler handlers, and validator
- [ ] E2E tests exercise events mode through the HTTP endpoint
- [ ] `bun run typecheck`, `bun run test`, and `bun run lint` pass

## User stories addressed

- User story 1
- User story 4
- User story 7
- User story 10
- User story 11
- User story 12
- User story 13
- User story 20
- User story 21
