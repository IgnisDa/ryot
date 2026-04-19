# Query Engine Guide

This document describes the request language for `'/query-engine/execute'`.

For concrete executable examples, see:

- `tests/src/fixtures/query-engine.ts`
- `tests/src/test-support/query-engine-suite.ts`
- `tests/src/tests/query-engine.test.ts`

## Mental Model

`/query-engine/execute` runs a query and resolves a set of requested output fields.

- Every request declares a `mode`.
- You send query inputs plus ordered `fields`.
- Query definitions can also declare reusable `computedFields`.
- The same expression and predicate language is used by saved views under `queryDefinition`.
- Each field has a `key` and a single `expression`.
- The response returns an ordered array of keyed row objects, with each field key mapping to `{ kind, value }`.
- `meta.fieldOrder` preserves the request field order when consumers need a stable layout.

## Modes

- `entities`: the original entity-first query mode. Supports `sort`, `pagination`, and ordered `fields`.
- `aggregate`: computes SQL-side aggregate values for the filtered entity set. Supports `aggregations` instead of `sort`, `pagination`, and `fields`.
- `events`: event-first query mode. Each result row is an event (not an entity). Supports `sort`, `pagination`, and ordered `fields`. Requires `eventSchemas`.
- `timeSeries`: returns a bucketed time series of event counts or sums over a date range. No pagination or field selection — only `metric`, `bucket`, `dateRange`, `eventSchemas`, `scope`, `filter`, and `computedFields`.

## Top-Level Keys

- `mode`: `entities` | `aggregate` | `events` | `timeSeries`
- `sort.expression`: a single expression used for ordering (`entities` and `events` only)
- `sort.direction`: `asc` or `desc` (`entities` and `events` only)
- `pagination.page`: 1-based integer (`entities` and `events` only)
- `pagination.limit`: integer from 1 to 1000 (`entities` and `events` only)
- `scope`: one or more unique, trimmed, non-empty entity schema slugs included in the query
- `filter`: a predicate AST or `null`
- `eventJoins`: zero or more event join definitions (`entities`, `aggregate`, and `events` only)
- `relationshipJoins`: zero or more relationship join definitions (`entities` and `aggregate` only)
- `computedFields`: zero or more named reusable expressions (may be omitted)
- `fields`: ordered list of output fields (`entities` and `events` only)
- `eventSchemas`: one or more unique, trimmed, non-empty event schema slugs (`events` and `timeSeries` only, required)
- `aggregations`: one or more aggregation field definitions (`aggregate` only, required)
- `metric`: `{ type: "count" }` or `{ type: "sum", expression }` (`timeSeries` only)
- `bucket`: `"day"` | `"hour"` | `"week"` | `"month"` — time bucket size (`timeSeries` only)
- `dateRange`: `{ startAt, endAt }` — ISO 8601 datetime strings with an offset, no more than millisecond precision; `startAt` must be before `endAt` (`timeSeries` only)

In `aggregate` mode:

- `sort`, `pagination`, and `fields` are omitted.
- `aggregations` is required.
- Supported aggregation kinds: `count`, `sum`, `avg`, `min`, `max`, `countBy`, and `countWhere`.
- The filtered entity set is still defined by `scope`, `filter`, `eventJoins`, `relationshipJoins`, and `computedFields`.
- `countBy.groupBy` must resolve to a comparable scalar value. Response keys are always strings (values are cast to `::text` for JSONB map keys).

In `events` mode:

- Each result row is an event record, not an entity.
- `relationshipJoins` is not supported.
- `event`, `event-schema`, and `event-join` reference types are all available.
- Entity fields are accessible via prefixed column overrides (e.g. `entity.book.properties.title` resolves from the joined entity row).

In `timeSeries` mode:

- No `sort`, `pagination`, `fields`, `eventJoins`, or `relationshipJoins`.
- `generate_series` fills every bucket in the date range with 0 where no events exist.
- All bucketing is in UTC.
- `dateRange` is exact event inclusion `[startAt, endAt)`; bucket display expands to aligned bucket boundaries.
- `week` buckets use ISO/Monday-start weeks.
- `event` and `event-schema` references are supported; `event-join` references are not supported.

## Field Selection

Each field has a non-empty, unique `key` and a single `expression` AST node. The `fields` array is never `null`. Use `coalesce` for ordered fallback behavior.

## Computed Fields

Named expressions declared once and reused anywhere expressions are accepted.

- `computedFields[].key` must be unique.
- Can reference entity fields, latest-event fields, and other computed fields.
- Missing latest-event rows resolve as `null` — `coalesce` works the same way through them.
- Dependency cycles are rejected.

## Expression Kinds

Supported expression nodes: `literal`, `reference`, `coalesce`, `arithmetic`, `round`, `floor`, `integer`, `concat`, `conditional`, `transform`.

Literal expressions support simple JSON literals (`{ "type": "literal", "value": "text" }`) and explicit typed literals. Use typed date literals for date comparisons; dates are not inferred from arbitrary strings:

```json
{ "type": "literal", "literalType": "date", "value": "2026-01-01T00:00:00.000Z" }
```

**`conditional`** — takes `condition`, `whenTrue`, and `whenFalse`:

```json
{
	"type": "conditional",
	"condition": {
		"type": "comparison",
		"operator": "gte",
		"left": {
			"type": "reference",
			"reference": { "type": "entity", "slug": "book", "path": ["properties", "rating"] }
		},
		"right": { "type": "literal", "value": 4 }
	},
	"whenTrue": { "type": "literal", "value": "recommended" },
	"whenFalse": { "type": "literal", "value": "standard" }
}
```

**`arithmetic`** — operators: `add`, `subtract`, `multiply`, `divide`. Nest inside `round`, `floor`, or `integer` for normalization.

**`concat`** — composes string values in order (scalars only — images, arrays, and objects are rejected).

**`transform`** — applies a named string transformation to the inner expression (must be concat-compatible):

- `titleCase`: normalizes underscores/hyphens to spaces, capitalizes each word (`reps_and_weight` → `Reps And Weight`)
- `kebabCase`: normalizes underscores/spaces to hyphens, lowercases (`Reps And Weight` → `reps-and-weight`)

**Image rules**: image references are display-only. Rejected from sort, filter, arithmetic, and string composition. Conditional/coalesce branches cannot mix image and non-image values.

## Reference Syntax

> String path notation (e.g. `entity.book.properties.author`) is documentation shorthand used in test helpers only. The API always requires structured `RuntimeRef` JSON objects.

Reference types:

- `{ "type": "entity", "slug": "...", "path": [...] }` — entity field
- `{ "type": "entity-schema", "path": [...] }` — field on the entity's associated schema (no slug needed)
- `{ "type": "event-join", "joinKey": "...", "path": [...] }` — event join field (requires a declared `eventJoins` entry)
- `{ "type": "event", "path": [...], "eventSchemaSlug": "..." }` — primary event row field (`events` and `timeSeries` modes). `eventSchemaSlug` is optional for property paths; when provided, enables schema-aware type inference.
- `{ "type": "event-schema", "path": [...] }` — the event's own schema metadata (`events` and `timeSeries` modes only)
- `{ "type": "event-aggregate", "eventSchemaSlug": "...", "path": [...], "aggregation": "..." }` — aggregate across a user's events per entity (`entities` and `aggregate` modes)
- `{ "type": "computed-field", "key": "..." }` — declared computed field

The `path` array: a leading `"properties"` segment navigates into the JSONB `properties` column; any other first segment is a built-in system column (e.g. `"name"`, `"createdAt"`). Deep nested paths are valid only under `properties` (e.g. `["properties", "metadata", "source"]`). Built-in paths must be exactly one segment. Relationship related entity property paths like `["sourceEntity", "properties", "name"]` and `["targetEntity", "properties", "name"]` may nest under `properties`; related entity built-ins like `["sourceEntity", "name"]` are not nestable.

### Entity Built-Ins

Available built-in columns: `id`, `name`, `createdAt`, `updatedAt`, `externalId`, `sandboxScriptId`, `image`.

- `id`, `name`, `createdAt`, `updatedAt`, `externalId`, `sandboxScriptId` work in sort, filters, and fields.
- `image` is display-only (not filterable or sortable).
- `externalId` and `sandboxScriptId` resolve to `null` when not set.

### Entity-Schema Built-Ins

Available columns: `id`, `slug`, `name`, `icon`, `accentColor`, `isBuiltin`, `userId`, `createdAt`, `updatedAt`.

- `icon` and `accentColor` are display-only (not filterable or sortable).
- `isBuiltin` returns a boolean; `createdAt`/`updatedAt` return datetime values.
- No schema slug needed — always resolves against the entity's own schema, even in multi-schema queries.

### Event Built-Ins (`event` reference)

Available built-in columns: `id`, `createdAt`, `updatedAt`. Properties via `["properties", "fieldName"]`.

- `id` and `createdAt`/`updatedAt` work in sort, filters, and fields.
- `eventSchemaSlug` is optional for display-only property paths; without it the property type falls back to `string`.
- Sort, filter, aggregate `countBy`, and time-series `sum` contexts require `eventSchemaSlug` for primary event property paths.

### Event-Schema Built-Ins (`event-schema` reference)

Available columns: `id`, `name`, `slug`, `isBuiltin`, `createdAt`, `updatedAt`.

- All columns work in sort, filters, and fields.
- `isBuiltin` returns a boolean; `createdAt`/`updatedAt` return datetime values.

### Event Join Fields (`event-join` reference)

Built-ins per join: `id`, `createdAt`, `updatedAt`. Properties via `["properties", "fieldName"]`.

### Event Aggregates

Aggregations: `avg`, `count`, `max`, `min`, `sum`. Type inference returns `integer` for `count` and `number` for all others.

```json
{
	"type": "event-aggregate",
	"eventSchemaSlug": "review",
	"path": ["properties", "rating"],
	"aggregation": "avg"
}
```

- Scoped to the authenticated user — user A sees only their own aggregates.
- `eventSchemaSlug` must be valid for the entity schemas in the query.
- For `count`, `path` may be omitted — it counts all matching events.
- For non-`count`, `path` must reference a numeric property; non-numeric values are treated as NULL.
- Do not require an `eventJoins` entry — run via correlated subquery.
- Usable in `entities` and `aggregate` modes anywhere expressions are accepted.

## Event Joins

```json
[{ "key": "review", "kind": "latestEvent", "eventSchemaSlug": "review" }]
```

- `key` is your local alias used in `event` references (`joinKey`).
- `latestEvent`: uses the latest matching event per entity.
- Event-join references only work when the join is declared in `eventJoins`.
- The event schema must be available for the entity schemas in `scope`.

## Relationship Joins

```json
[
	{
		"key": "inLibrary",
		"kind": "latestRelationship",
		"relationshipSchemaSlug": "in-library",
		"direction": "outgoing",
		"required": true,
		"filter": null
	}
]
```

- `key` is your local alias used in relationship references.
- `kind`: only `latestRelationship` is supported.
- `relationshipSchemaSlug`: the slug of the relationship schema to join.
- `direction`: `outgoing` (base entity is the relationship source) or `incoming` (base entity is the relationship target).
- `required`: when `true`, entities without a matching relationship row are filtered out. Defaults to `false`.
- `sourceEntityId` and `targetEntityId`: optional literal constraints on the actual relationship row sides, independent of direction.
- `filter`: an optional predicate applied to candidate relationship rows before `latestRelationship` selection. Defaults to `null`.
- Relationship joins match both user-owned and global (no user) relationship rows.
- `latestRelationship` selects one row per base entity ordered by `createdAt` desc, then `id` desc.
- Only supported in `entities` and `aggregate` modes.

### Relationship Join Reference Paths

Relationship join references use the `relationship-join` type with `joinKey` matching the join declaration:

- `{ "type": "relationship-join", "joinKey": "...", "path": ["id"] }`
- `{ "type": "relationship-join", "joinKey": "...", "path": ["createdAt"] }`
- `{ "type": "relationship-join", "joinKey": "...", "path": ["sourceEntityId"] }`
- `{ "type": "relationship-join", "joinKey": "...", "path": ["targetEntityId"] }`
- `{ "type": "relationship-join", "joinKey": "...", "path": ["properties", "fieldName"] }`

Related entity data:

- `{ "type": "relationship-join", "joinKey": "...", "path": ["sourceEntity", "name"] }` — built-ins: `id`, `name`, `image`, `createdAt`, `updatedAt`, `externalId`, `sandboxScriptId`
- `{ "type": "relationship-join", "joinKey": "...", "path": ["sourceEntity", "properties", "fieldName"] }` — when the relationship schema defines a source entity schema
- `{ "type": "relationship-join", "joinKey": "...", "path": ["targetEntity", "name"] }`
- `{ "type": "relationship-join", "joinKey": "...", "path": ["targetEntity", "properties", "fieldName"] }` — when the relationship schema defines a target entity schema

Related entity `image` is display-only, not filterable or sortable.

### Join-Local Filters

The optional `filter` on a relationship join is evaluated against candidate rows before `latestRelationship` picks the latest one. This means "latest director credit" selects from director rows rather than picking the latest credit and then checking whether it is a director row.

Join-local filters are limited:

- May reference only literals and the current relationship join by its own `joinKey`.
- Cannot reference computed fields, entity fields, event joins, primary events, event aggregates, other relationship joins, or related entity data (`sourceEntity` / `targetEntity`).

### Relationship Join Examples

Return a relationship property as a field:

```json
{
	"type": "reference",
	"reference": {
		"type": "relationship-join",
		"joinKey": "memberOf",
		"path": ["properties", "rating"]
	}
}
```

Filter by a relationship property:

```json
{
	"type": "comparison",
	"operator": "gte",
	"left": {
		"type": "reference",
		"reference": {
			"type": "relationship-join",
			"joinKey": "memberOf",
			"path": ["properties", "rating"]
		}
	},
	"right": { "type": "literal", "value": 4 }
}
```

Sort by a related target entity name:

```json
{
	"type": "reference",
	"reference": {
		"type": "relationship-join",
		"joinKey": "memberOf",
		"path": ["targetEntity", "name"]
	}
}
```

## Filters

Predicate types: `comparison`, `in`, `isNull`, `isNotNull`, `contains`, `and`, `or`, `not`.

The `comparison` predicate takes `left`, `right`, and `operator`. Supported comparison operators: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`.

`isNull` / `isNotNull` take a single `expression`. `in` takes `expression` and `values` (array of expressions). `contains` takes `expression` and `value` (single expression).

Combine predicates with `and` / `or` (each takes a `predicates` array). Negate any predicate with `not` (takes a single `predicate`):

```json
{
	"type": "and",
	"predicates": [
		{
			"type": "contains",
			"expression": {
				"type": "reference",
				"reference": { "type": "entity", "slug": "book", "path": ["properties", "tags"] }
			},
			"value": { "type": "literal", "value": "classic" }
		},
		{
			"type": "isNotNull",
			"expression": {
				"type": "reference",
				"reference": { "type": "event-join", "joinKey": "review", "path": ["properties", "rating"] }
			}
		}
	]
}
```

## Response Shape

The HTTP response body is always a discriminated union on `mode`.

Entity mode:

```json
{
	"mode": "entities",
	"data": {
		"meta": {
			"pagination": {
				"page": 1,
				"total": 42,
				"limit": 20,
				"totalPages": 3,
				"hasNextPage": true,
				"hasPreviousPage": false
			},
			"fieldOrder": ["title", "rating"]
		},
		"items": [
			{
				"title": { "kind": "text", "value": "Dune" },
				"rating": { "kind": "number", "value": 5 }
			}
		]
	}
}
```

Aggregate mode:

```json
{
	"mode": "aggregate",
	"data": {
		"values": [
			{ "key": "total", "kind": "number", "value": 42 },
			{ "key": "bySchema", "kind": "json", "value": { "book": 18, "movie": 24 } }
		]
	}
}
```

Events mode (same shape as entity mode, each row is an event):

```json
{
	"mode": "events",
	"data": {
		"meta": {
			"pagination": {
				"page": 1,
				"total": 7,
				"limit": 20,
				"totalPages": 1,
				"hasNextPage": false,
				"hasPreviousPage": false
			},
			"fieldOrder": ["rating", "reviewedAt"]
		},
		"items": [
			{
				"rating": { "kind": "number", "value": 5 },
				"reviewedAt": { "kind": "date", "value": "2024-01-15T00:00:00.000Z" }
			}
		]
	}
}
```

Time-series mode:

```json
{
	"mode": "timeSeries",
	"data": {
		"meta": {
			"alignedDateRange": {
				"startAt": "2024-01-01T00:00:00.000Z",
				"endAt": "2024-01-04T00:00:00.000Z"
			}
		},
		"buckets": [
			{ "date": "2024-01-01T00:00:00.000Z", "value": 3 },
			{ "date": "2024-01-02T00:00:00.000Z", "value": 0 },
			{ "date": "2024-01-03T00:00:00.000Z", "value": 5 }
		]
	}
}
```

- `buckets` covers every aligned interval touched by `dateRange` — missing buckets are filled with `0`.
- `meta.alignedDateRange` expands the request range to bucket boundaries.
- `date` is an ISO 8601 UTC string truncated to the requested `bucket` granularity.

Field result kinds: `text`, `number`, `boolean`, `date`, `image`, `json`, `null`.

- `items` is always an array.
- Each `items[n]` entry is always an object keyed by field name.
- `meta.fieldOrder` preserves the request field order and is always returned in `entities` and `events` mode.
- A field resolving to null returns `{ "kind": "null", "value": null }`.
- This is a breaking wire change from array rows to keyed records; sandbox scripts and external callers must read fields by key.

## Event Query Notes

### Event joins (`entities` / `aggregate` mode)

- `latestEvent` joins are per entity, not global.
- Sorting by an event-join field sorts by the latest joined event value.
- Missing join rows resolve references to `null`.
- `isNull` / `isNotNull` are useful for "missing event" / "has event" queries.
- `event-join.*.createdAt` is useful for "most recently reviewed/purchased" views.

### Events mode

- Each result row is an event, so `event.*` and `event-schema.*` references resolve directly.
- Entity fields (e.g. `entity.book.properties.title`) resolve from the entity joined to the event.
- `event-join` references declare additional per-entity latest-event lookups, joined on `entity_id`.

### Time-series mode

- Filters apply before bucketing; only matching events are counted/summed.
- Empty buckets always return `0`, never `null`.
- The `endAt` bucket is exclusive — events at exactly `endAt` are not included.
- `dateRange.startAt` and `dateRange.endAt` reject fractional seconds beyond milliseconds.
- `event-schema.*` references are valid in filters, computed fields, and sum metrics.

## Gotchas

- All references must be explicit; shorthand like `book.title` is invalid in request bodies.
- `fields` may be empty, but then every `items[n]` will also be an empty object.
- `event-join.*` references require the join to be declared in `eventJoins`.
- `event-aggregate` references do not require an entry in `eventJoins`.
- `event` and `event-schema` references are only valid in `events` and `timeSeries` modes (where `eventSchemas` is required).
- Built-in reference paths must be exactly one segment; only `properties` paths support nesting.
- `event-join` references are not valid in `timeSeries` mode.
- `relationshipJoins` is not supported in `events` or `timeSeries` modes.
- Sort/filter references must point to schemas included in `scope`.
- `image` is display-only, not filterable.
- Duplicate field keys are rejected.
- `"properties"` is a reserved first path segment for the JSONB column; system columns must never be named `properties`.
- `icon` and `accentColor` entity-schema columns are display-only (not filterable or sortable).
- `timeSeries` `dateRange` must have `startAt` strictly before `endAt`; equal values are rejected.
- `timeSeries` bucketing always uses UTC regardless of the timezone offset in `startAt`/`endAt`.

## Validation Errors

- Missing computed field: `Computed field 'displayName' is not part of this runtime request`
- Dependency cycle: `Computed field dependency cycle detected: first -> second -> first`
- Type mismatch: `Filter operator 'eq' requires compatible expression types, received 'integer' and 'string'`
- Non-display image usage: `Image expressions are display-only and cannot be compiled for sort or filter usage`
- Invalid event-aggregate slug: `Event schema 'reviw' is not available for the requested entity schemas`
