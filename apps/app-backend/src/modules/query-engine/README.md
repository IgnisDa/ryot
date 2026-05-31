# Query Engine Guide

This document describes the v2 query language accepted by `POST /query-engine/execute`.

For concrete executable examples, see:

- `tests/src/fixtures/query-engine.ts` (helpers and fixtures)
- `tests/src/tests/query-engine.test.ts` (entity rows, includes, filters, aggregates, time series, validation)
- `tests/src/tests/query-engine-events-mode.test.ts` (event root rows, first expressions)
- `tests/src/tests/query-engine-time-series.test.ts` (time series over events/entities/relationships)
- `tests/src/tests/query-engine-field-resolution.test.ts` (field selector resolution)
- `tests/src/tests/query-engine-entity-schema-fields.test.ts` (schema metadata fields)

The authoritative model for the query language is the PRD at
`docs/tasks/query-engine-hierarchical-results/README.md`. This guide documents the
currently implemented subset.

## Mental Model

`/query-engine/execute` accepts a `QueryDocument` and returns a typed response whose
shape is discriminated by `output.type`.

- Every document declares `version: 2`, a root `source`, and an `output` definition.
- A `source` produces a row set. The root source is the top-level row set; included
  sources and expression sources produce nested/correlated row sets.
- Every source has a required `type`, required `alias`, non-empty unique `schemas`, and
  optional/null `where`.
- Output fields are computed by expressions. Each field has a `key` and an `expr`.
- The response returns keyed row objects. Each field value is `{ kind, value }`.
- User isolation is enforced by the engine for every source and traversal. The caller
  cannot expand visibility by crafting query JSON.

## Source Types

### Entity sources

Root entity source:

```json
{
	"type": "entities",
	"alias": "course",
	"schemas": ["course"],
	"where": null
}
```

Nested entity source reached through one relationship edge (`via`):

```json
{
	"type": "entities",
	"alias": "module",
	"schemas": ["module"],
	"where": null,
	"via": {
		"entityRef": "course",
		"alias": "courseModule",
		"direction": "outgoing",
		"schema": "course-module"
	}
}
```

- `schemas` are entity schema slugs. A source may span multiple schemas.
- `via.entityRef` names an existing entity alias used as the traversal anchor.
- `via.alias` is the relationship edge alias (globally unique).
- `via.direction` is `outgoing` (anchor is the relationship source) or `incoming`
  (anchor is the relationship target).
- Root entity sources cannot specify `via`.

### Event sources

Root event source with an explicit attached entity declaration:

```json
{
	"type": "events",
	"alias": "completion",
	"schemas": ["complete"],
	"where": null,
	"entity": {
		"alias": "lesson",
		"schemas": ["lesson"]
	}
}
```

Nested event source attached to an existing entity alias:

```json
{
	"type": "events",
	"alias": "completion",
	"schemas": ["complete"],
	"where": null,
	"entityRef": "lesson"
}
```

- `schemas` are event schema slugs.
- Root event sources declare both the event alias and the attached `entity` alias plus
  entity schemas.
- Nested event sources reference an existing entity alias via `entityRef`.

### Relationship sources

Root relationship source with explicit endpoint entity declarations:

```json
{
	"type": "relationships",
	"alias": "membership",
	"schemas": ["member-of"],
	"where": null,
	"sourceEntity": {
		"alias": "member",
		"schemas": ["book", "movie"]
	},
	"targetEntity": {
		"alias": "collectionEntity",
		"schemas": ["collection"]
	}
}
```

- `schemas` are relationship schema slugs.
- Both endpoint entities must be declared explicitly with their own aliases and schemas.
- Relationship root rows do not support `include` yet.
- Root relationship sources do not support `where` yet.

## Field Selectors

References use a structured `field` selector rather than raw property paths.

System field selector — reads built-in columns from the referenced alias:

```json
{ "type": "system", "name": "name" }
```

Property field selector — reads schema-defined properties, always schema-qualified:

```json
{ "type": "property", "schema": "course", "path": ["difficulty"] }
```

Schema metadata field selector — reads metadata about the row's schema:

```json
{ "type": "schema", "name": "slug" }
```

### System fields by source type

Entity: `id`, `name`, `image`, `createdAt`, `updatedAt`, `externalId`, `sandboxScriptId`.

- `image` is display-only.
- `externalId` and `sandboxScriptId` resolve to `null` when not set.

Event: `id`, `occurredAt`, `createdAt`, `updatedAt`.

Relationship: `id`, `sourceEntityId`, `targetEntityId`, `createdAt`.

Invalid system fields for a source type fail semantic validation.

### Schema metadata fields

`slug`, `name`, `isBuiltin`.

### Property fields

A property field's `schema` must be one of the source's declared `schemas`, otherwise
validation fails. `path` is a non-empty array navigating into the JSONB `properties`
column (deep nesting is allowed). A schema-qualified property evaluated against a row of
another schema resolves to `null`.

## Expressions

One expression AST is used everywhere — output fields, `where` clauses, `orderBy`, and
aggregation operands.

- `literal`: `{ "type": "literal", "value": <json> }`. Use `valueType: "date"` for date
  literals so dates are not confused with strings:
  `{ "type": "literal", "valueType": "date", "value": "2026-01-01T00:00:00.000Z" }`.
- `ref`: `{ "type": "ref", "sourceAlias": "...", "field": <FieldSelector> }`.
- `measureRef`: `{ "type": "measureRef", "key": "..." }`. Valid only inside
  aggregate-return `orderBy`.
- `comparison`: `{ "type": "comparison", "operator", "left", "right" }`. Operators:
  `eq`, `neq`, `gt`, `gte`, `lt`, `lte`. Comparisons involving null evaluate to false
  except explicit null checks.
- `and` / `or`: `{ "type": "and"|"or", "values": [...] }` with at least one value.
- `not`: `{ "type": "not", "expr": ... }`.
- `isNull` / `isNotNull`: `{ "type": "isNull"|"isNotNull", "expr": ... }`. The only
  boolean conditions that treat null as the tested value rather than an unknown operand.
- `contains`: `{ "type": "contains", "left", "right" }`. Strings: case-insensitive
  substring. Arrays: left contains the right item. Objects: left contains the right
  key/value shape.
- `coalesce`: `{ "type": "coalesce", "values": [...] }`. Returns the first non-null
  value, or `null` if every value is null. Useful when `sum`/`average`/`min`/`max`
  return null over an empty source.
- `exists`: `{ "type": "exists", "source": <Source> }`. Returns true when the source has
  at least one row. Source-level `where` covers CountWhere-style filtering.
- `aggregate`: `{ "type": "aggregate", "source": <Source>, "aggregation": <AggregationSpec> }`.
- `first`: `{ "type": "first", "source": <Source>, "orderBy": [...], "select": <Expr> }`.
  Returns the selected scalar from the first row of an ordered source, or `null` when the
  source has no rows. This is how latest-event patterns are represented. Currently
  supports event sources only and is valid only as an output field expression.

References may only point at aliases in lexical scope: a source's own alias, its
relationship edge alias, ancestor aliases, declared relationship endpoint aliases, and
declared event attached-entity aliases. A source cannot reference sibling include
aliases. Source-level `where` may reference ancestor aliases (correlated child filters).

### Aggregation spec

Shared by aggregate expressions, aggregate-return measures, and time-series measures:

- `{ "function": "count", "distinctBy": <Expr>? }` — counts rows; `distinctBy`
  deduplicates non-null values before counting. `count` over an empty source returns `0`.
- `{ "function": "sum"|"average"|"minimum"|"maximum", "expr": <Expr> }` — require `expr`.
  Over an empty source they return `null`.

## Output Types

### Rows return

```json
{
  "type": "rows",
  "pagination": { "page": 1, "limit": 20 },
  "orderBy": [{ "order": "asc", "expr": <Expr> }],
  "fields": [{ "key": "name", "expr": <Expr> }],
  "include": [ <IncludeEntry> ]
}
```

- `pagination` applies only to root rows (max page size 100).
- `orderBy` is non-empty and currently supports `ref` expressions only.
- `fields` may be empty. Field keys and include keys must be unique among siblings.
- `include` is valid only on rows returns.

### Included sources

```json
{
  "key": "modules",
  "limit": 20,
  "source": <EntitySource with via>,
  "orderBy": [{ "order": "asc", "expr": <Expr> }],
  "fields": [{ "key": "name", "expr": <Expr> }],
  "include": [ <IncludeEntry> ]
}
```

- Includes are projections, not parent filters. A parent row remains even if an include
  returns zero child rows.
- Every include requires an explicit `limit` (max 100), non-empty `orderBy`, and `fields`.
- Max include depth is 3 (root is depth 0).
- Included sources return `{ "items": [...], "pageInfo": { "limit", "hasMore" } }` and do
  not include total counts.
- Included entity sources must specify `via` and do not support `where` yet.

### Aggregate return

Ungrouped:

```json
{
	"type": "aggregate",
	"groupBy": [],
	"measures": [{ "key": "courseCount", "aggregation": { "function": "count" } }]
}
```

Grouped:

```json
{
  "type": "aggregate",
  "limit": 100,
  "groupBy": [{ "key": "difficulty", "expr": <Expr> }],
  "measures": [{ "key": "count", "aggregation": { "function": "count" } }],
  "orderBy": [{ "order": "desc", "expr": { "type": "measureRef", "key": "count" } }]
}
```

- Ungrouped aggregate returns exactly one item and no `pageInfo`.
- Grouped aggregate requires a `limit` (max 1000), non-empty `orderBy` (measureRef only),
  and includes `pageInfo: { "limit", "hasMore" }`.
- `groupBy` keys and measure keys share one output namespace and must be unique among
  siblings. Responses use `items`, not the legacy `values` shape.

### Time-series return

```json
{
  "type": "timeSeries",
  "time": {
    "bucket": "week",
    "range": { "startAt": "2026-01-01T00:00:00.000Z", "endAt": "2026-02-01T00:00:00.000Z" },
    "expr": <Expr>
  },
  "measure": { "aggregation": { "function": "count" } }
}
```

- `bucket`: `hour`, `day`, `week`, `month`.
- `range` is a half-open window: `startAt` inclusive, `endAt` exclusive. `startAt` must be
  before `endAt`.
- Zero fill is always on — buckets with no rows return `0`, never `null`.
- Max 1000 buckets after alignment; exceeding this fails validation (no silent clamping).
- `week` buckets use ISO/Monday-start weeks. All bucketing uses UTC.

## Response Shapes

Rows:

```json
{
	"type": "rows",
	"data": {
		"items": [
			{
				"name": { "kind": "text", "value": "Course A" },
				"modules": {
					"items": [{ "name": { "kind": "text", "value": "Module 1" } }],
					"pageInfo": { "limit": 20, "hasMore": false }
				}
			}
		],
		"pageInfo": { "page": 1, "limit": 20, "total": 1, "hasMore": false }
	}
}
```

Aggregate (grouped):

```json
{
	"type": "aggregate",
	"data": {
		"items": [
			{
				"difficulty": { "kind": "text", "value": "beginner" },
				"count": { "kind": "number", "value": 12 }
			}
		],
		"pageInfo": { "limit": 100, "hasMore": false }
	}
}
```

Time series:

```json
{
	"type": "timeSeries",
	"data": {
		"buckets": [
			{ "startAt": "2026-01-01T00:00:00.000Z", "endAt": "2026-01-08T00:00:00.000Z", "value": 3 },
			{ "startAt": "2026-01-08T00:00:00.000Z", "endAt": "2026-01-15T00:00:00.000Z", "value": 0 }
		]
	}
}
```

Field value kinds: `text`, `number`, `boolean`, `date`, `image`, `json`, `null`.

- A field resolving to null returns `{ "kind": "null", "value": null }`.
- Included sources use `{ "items", "pageInfo" }` instead of a scalar field value.
- Responses stay lean: no field-order metadata or source/schema metadata is returned.
  Root row pagination includes total count; included sources do not.

## Safety Limits

| Limit                                               | Value                                      |
| --------------------------------------------------- | ------------------------------------------ |
| Max root page size                                  | 100                                        |
| Max include depth                                   | 3 (root is depth 0)                        |
| Max include limit                                   | 100                                        |
| Max expression source depth                         | 3 (root is depth 0, counted independently) |
| Max grouped aggregate limit                         | 1000                                       |
| Max time-series buckets                             | 1000                                       |
| Max serialized row objects per response             | 5000                                       |
| Max root filter scan rows                           | 5000                                       |
| Max aggregate-expression source rows per parent row | 10000                                      |

If the serialized row-object cap is exceeded, the engine fails the query rather than
silently truncating. A grouped aggregate limit greater than 1000 fails validation rather
than being clamped.

## Visibility

Visibility is enforced for every source and traversal: root entities, root events, root
relationships, nested entities, nested events, relationship edges, relationship endpoint
entities, event attached entities, `exists`/`aggregate`/`first` expression sources, and
time-series sources. Visibility includes user-owned rows and allowed global rows (no
user). The caller cannot expand visibility by crafting valid query JSON.

## Validation Errors

Validation runs in two phases before execution:

1. Pure structural + semantic validation (`validateQueryDocument`): alias uniqueness,
   scope resolution, field selector validity, safety limits.
2. DB-aware reference validation (`validateQueryDocumentReferences`): resolves visible
   schemas for every source and expression, enforcing user isolation.

Example errors:

- `Duplicate alias 'course'`
- `Unknown source alias 'module'`
- `Invalid system field 'occurredAt' for entity source. Valid fields: id, name, image, ...`
- `Property field references schema 'movie' which is not in source schemas [book]`
- `Root entity source cannot specify via`
- `Included entity source 'module' must specify via`
- `Include limit 200 exceeds maximum of 100`
- `Grouped aggregate returns require a limit`
- `Time-series bucket count 1200 exceeds maximum of 1000`
- `Entity schema 'reviw' not found`
