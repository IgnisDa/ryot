# Query Engine Guide

This document describes the request language for `'/query-engine/execute'`.

For concrete executable examples, see:

- `tests/src/fixtures/query-engine.ts`
- `tests/src/test-support/query-engine-suite.ts`
- `tests/src/tests/query-engine.test.ts`

## Mental Model

`/query-engine/execute` runs a query and resolves a set of requested output fields.

- You send query inputs plus ordered `fields`.
- Query definitions can also declare reusable `computedFields`.
- The same expression and predicate language is used by saved views under `queryDefinition`.
- Each field has a `key` and a single `expression`.
- The response returns an ordered array of resolved field arrays, where each inner array contains `{ key, kind, value }` entries for the requested fields only.

## Top-Level Keys

- `sort.expression`: a single expression used for ordering
- `sort.direction`: `asc` or `desc`
- `pagination.page`: 1-based integer
- `pagination.limit`: positive integer
- `entitySchemaSlugs`: one or more schema slugs included in the query
- `filter`: a predicate AST or `null`
- `eventJoins`: zero or more event join definitions
- `relationships`: zero or more relationship schema slugs; causes non-user-owned entities to be included when the user has a relationship of the given schema type pointing to them
- `computedFields`: zero or more named reusable expressions (may be omitted)
- `fields`: ordered list of output fields

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
- `{ "type": "event", "joinKey": "...", "path": [...] }` — event join field
- `{ "type": "event-aggregate", "eventSchemaSlug": "...", "path": [...], "aggregation": "..." }` — aggregate across a user's events per entity
- `{ "type": "computed-field", "key": "..." }` — declared computed field

The `path` array: a leading `"properties"` segment navigates into the JSONB `properties` column; any other first segment is a built-in system column (e.g. `"name"`, `"createdAt"`). Deep nested paths extend the array (e.g. `["properties", "metadata", "source"]`).

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

### Event Join Fields

Built-ins per join: `id`, `createdAt`, `updatedAt`. Properties via `["properties", "fieldName"]`.

### Event Aggregates

Aggregations: `avg`, `count`, `max`, `min`, `sum`. Type inference returns `integer` for `count` and `number` for all others.

```json
{ "type": "event-aggregate", "eventSchemaSlug": "review", "path": ["properties", "rating"], "aggregation": "avg" }
```

- Scoped to the authenticated user — user A sees only their own aggregates.
- `eventSchemaSlug` must be valid for the entity schemas in the query.
- For `count`, `path` is required by the schema but ignored in SQL — it counts all matching events.
- For non-`count`, `path` must reference a numeric property; non-numeric values are treated as NULL.
- Do not require an `eventJoins` entry — run via correlated subquery.
- Usable anywhere expressions are accepted.

## Event Joins

```json
[{ "key": "review", "kind": "latestEvent", "eventSchemaSlug": "review" }]
```

- `key` is your local alias used in `event` references (`joinKey`).
- `latestEvent`: uses the latest matching event per entity.
- Event references only work when the join is declared in `eventJoins`.
- The event schema must be available for the entity schemas in `entitySchemaSlugs`.

## Filters

Comparison operators: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `isNull`, `isNotNull`, `contains`.

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
        "reference": { "type": "event", "joinKey": "review", "path": ["properties", "rating"] }
      }
    }
  ]
}
```

## Response Shape

```json
{
  "data": {
    "meta": {
      "pagination": {
        "page": 1,
        "total": 42,
        "limit": 20,
        "totalPages": 3,
        "hasNextPage": true,
        "hasPreviousPage": false
      }
    },
    "items": [
      [
        { "key": "title", "kind": "text", "value": "Dune" },
        { "key": "rating", "kind": "number", "value": 5 }
      ]
    ]
  }
}
```

Field result kinds: `text`, `number`, `boolean`, `date`, `image`, `json`, `null`.

- `items` is always an array.
- Each `items[n]` entry is always an array.
- A field resolving to null returns `{ "kind": "null", "value": null }`.

## Event Query Notes

- `latestEvent` joins are per entity, not global.
- Sorting by an event field sorts by the latest joined event value.
- Missing join rows resolve references to `null`.
- `isNull` / `isNotNull` are useful for "missing event" / "has event" queries.
- `event.*.createdAt` is useful for "most recently reviewed/purchased" views.

## Gotchas

- All references must be explicit; shorthand like `book.title` is invalid in request bodies.
- `fields` may be empty, but then every `items[n]` will also be an empty array.
- `event.*` references require the join to be declared in `eventJoins`.
- `event-aggregate` references do not require an entry in `eventJoins`.
- Sort/filter references must point to schemas included in `entitySchemaSlugs`.
- `image` is display-only, not filterable.
- Duplicate field keys are rejected.
- `"properties"` is a reserved first path segment for the JSONB column; system columns must never be named `properties`.
- `icon` and `accentColor` entity-schema columns are display-only (not filterable or sortable).

## Validation Errors

- Missing computed field: `Computed field 'displayName' is not part of this runtime request`
- Dependency cycle: `Computed field dependency cycle detected: first -> second -> first`
- Type mismatch: `Filter operator 'eq' requires compatible expression types, received 'integer' and 'string'`
- Non-display image usage: `Image expressions are display-only and cannot be compiled for sort or filter usage`
- Invalid event-aggregate slug: `Event schema 'reviw' is not available for the requested entity schemas`
