# Query Engine Guide

This document describes the request language for `'/query-engine/execute'`.

For concrete executable examples, also see:

- `tests/src/fixtures/query-engine.ts`
- `tests/src/test-support/query-engine-suite.ts`
- `tests/src/tests/query-engine.test.ts`

## Mental Model

`/query-engine/execute` runs a query and resolves a set of requested output fields.

- You send query inputs plus ordered `fields`.
- Query definitions can also declare reusable `computedFields`.
- The same expression and predicate language is used by saved views under `queryDefinition`.
- Each field has a `key` and a single `expression`.
- The response returns entities plus resolved `fields` as `{ key, kind, value }`.

## Saved View Shape

Saved views persist the same query AST and then point display slots directly at expressions:

```json
{
  "name": "Recent Favorites",
  "queryDefinition": {
    "sort": {
      "direction": "desc",
      "expression": {
        "type": "reference",
        "reference": { "type": "computed-field", "key": "nextYear" }
      }
    },
    "computedFields": [
      {
        "key": "nextYear",
        "expression": {
          "type": "arithmetic",
          "operator": "add",
          "left": {
            "type": "reference",
            "reference": { "type": "entity", "slug": "book", "path": ["properties", "publishYear"] }
          },
          "right": { "type": "literal", "value": 1 }
        }
      },
      {
        "key": "label",
        "expression": {
          "type": "concat",
          "values": [
            { "type": "literal", "value": "Book: " },
            {
              "type": "reference",
              "reference": { "type": "entity", "slug": "book", "path": ["name"] }
            }
          ]
        }
      }
    ],
    "eventJoins": [],
    "filter": {
      "type": "comparison",
      "operator": "gte",
      "left": {
        "type": "reference",
        "reference": { "type": "computed-field", "key": "nextYear" }
      },
      "right": { "type": "literal", "value": 2020 }
    },
    "entitySchemaSlugs": ["book"]
  },
  "displayConfiguration": {
    "grid": {
      "imageProperty": {
        "type": "reference",
        "reference": { "type": "entity", "slug": "book", "path": ["image"] }
      },
      "titleProperty": {
        "type": "reference",
        "reference": { "type": "computed-field", "key": "label" }
      },
      "primarySubtitleProperty": null,
      "secondarySubtitleProperty": null,
      "calloutProperty": {
        "type": "reference",
        "reference": { "type": "computed-field", "key": "nextYear" }
      }
    },
    "list": {
      "imageProperty": {
        "type": "reference",
        "reference": { "type": "entity", "slug": "book", "path": ["image"] }
      },
      "titleProperty": {
        "type": "reference",
        "reference": { "type": "computed-field", "key": "label" }
      },
      "primarySubtitleProperty": null,
      "secondarySubtitleProperty": null,
      "calloutProperty": {
        "type": "reference",
        "reference": { "type": "computed-field", "key": "nextYear" }
      }
    },
    "table": {
      "columns": [
        {
          "label": "Next Year",
          "expression": {
            "type": "reference",
            "reference": { "type": "computed-field", "key": "nextYear" }
          }
        }
      ]
    }
  }
}
```

## Request Shape

```json
{
  "sort": {
    "direction": "asc",
    "expression": {
      "type": "reference",
      "reference": { "type": "entity", "slug": "book", "path": ["name"] }
    }
  },
  "pagination": {
    "page": 1,
    "limit": 20
  },
  "eventJoins": [],
  "computedFields": [
    {
      "key": "displayName",
      "expression": {
        "type": "reference",
        "reference": { "type": "entity", "slug": "book", "path": ["name"] }
      }
    }
  ],
  "filter": {
    "type": "comparison",
    "operator": "eq",
    "left": {
      "type": "reference",
      "reference": { "type": "computed-field", "key": "displayName" }
    },
    "right": { "type": "literal", "value": "Dune" }
  },
  "entitySchemaSlugs": ["book"],
  "fields": [
    {
      "key": "title",
      "expression": {
        "type": "reference",
        "reference": { "type": "computed-field", "key": "displayName" }
      }
    },
    {
      "key": "image",
      "expression": {
        "type": "reference",
        "reference": { "type": "entity", "slug": "book", "path": ["image"] }
      }
    }
  ]
}
```

## Top-Level Keys

- `sort.expression`: a single expression used for ordering
- `sort.direction`: `asc` or `desc`
- `pagination.page`: 1-based integer
- `pagination.limit`: positive integer
- `entitySchemaSlugs`: one or more schema slugs included in the query
- `filter`: a predicate AST or `null`
- `eventJoins`: zero or more event join definitions
- `computedFields`: zero or more named reusable expressions (may be omitted)
- `fields`: ordered list of output fields

## Field Selection

Each field looks like this:

```json
{
  "key": "primarySubtitle",
  "expression": {
    "type": "coalesce",
    "values": [
      {
        "type": "reference",
        "reference": { "type": "entity", "slug": "smartphone", "path": ["properties", "manufacturer"] }
      },
      {
        "type": "reference",
        "reference": { "type": "entity", "slug": "tablet", "path": ["properties", "manufacturer"] }
      }
    ]
  }
}
```

Rules:

- `key` must be non-empty and unique within the request.
- `expression` is a single AST node.
- Use `coalesce` for ordered fallback behavior.
- The `fields` array itself is an array, never `null`.

## Computed Fields

Computed fields are named expressions declared once and reused anywhere expressions are accepted.

```json
{
  "key": "reviewOrTitle",
  "expression": {
    "type": "coalesce",
    "values": [
      {
        "type": "reference",
        "reference": { "type": "event", "joinKey": "review", "path": ["properties", "rating"] }
      },
      {
        "type": "reference",
        "reference": { "type": "computed-field", "key": "displayName" }
      }
    ]
  }
}
```

Rules:

- `computedFields[].key` must be unique.
- Computed fields can reference entity fields, latest-event fields, and other computed fields.
- Missing latest-event rows still resolve as `null`, so `coalesce` works the same way through computed fields.
- Computed-field dependency cycles are rejected.

## Expression Kinds

Supported expression nodes:

- `literal`
- `reference`
- `coalesce`
- `arithmetic`
- `round`
- `floor`
- `integer`
- `concat`
- `conditional`

Conditional expressions use `whenTrue` and `whenFalse`:

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

Arithmetic and normalization example:

```json
{
  "key": "roundedScore",
  "expression": {
    "type": "round",
    "expression": {
      "type": "arithmetic",
      "operator": "divide",
      "left": {
        "type": "reference",
        "reference": { "type": "entity", "slug": "book", "path": ["properties", "pages"] }
      },
      "right": { "type": "literal", "value": 100 }
    }
  }
}
```

String composition example:

```json
{
  "type": "concat",
  "values": [
    { "type": "literal", "value": "Book: " },
    {
      "type": "reference",
      "reference": { "type": "entity", "slug": "book", "path": ["name"] }
    }
  ]
}
```

Image rules:

- Image references remain display-only.
- Image expressions are rejected from sort, filter, arithmetic, and string composition.
- Conditional and coalesce branches cannot mix image and non-image values.

## Reference Syntax

> **Note:** The path strings below (e.g. `entity.book.properties.author`) are
> human-readable shorthand used in documentation and test helpers only. The actual
> API request body always uses structured `RuntimeRef` JSON objects. Each example
> below shows both forms.

All references must be explicit. There are two reference types plus computed fields:

- `{ "type": "entity", "slug": "...", "path": [...] }` — references an entity field
- `{ "type": "event", "joinKey": "...", "path": [...] }` — references an event join field
- `{ "type": "event-aggregate", "eventSchemaSlug": "...", "path": [...], "aggregation": "..." }` — aggregates across a user's events for each entity
- `{ "type": "computed-field", "key": "..." }` — references a declared computed field

The `path` array encodes which DB location to access:

- A path starting with `"properties"` navigates into the entity's or event's JSONB `properties` column. The remaining segments are the nested field path.
- Any other first segment is a built-in system column accessed directly (e.g. `"name"`, `"createdAt"`).

### Entity Built-Ins

String shorthand → `RuntimeRef` JSON:

- `entity.book.id` → `{ "type": "entity", "slug": "book", "path": ["id"] }`
- `entity.book.name` → `{ "type": "entity", "slug": "book", "path": ["name"] }`
- `entity.book.image` → `{ "type": "entity", "slug": "book", "path": ["image"] }`
- `entity.book.createdAt` → `{ "type": "entity", "slug": "book", "path": ["createdAt"] }`
- `entity.book.updatedAt` → `{ "type": "entity", "slug": "book", "path": ["updatedAt"] }`
- `entity.book.externalId` → `{ "type": "entity", "slug": "book", "path": ["externalId"] }`
- `entity.book.sandboxScriptId` → `{ "type": "entity", "slug": "book", "path": ["sandboxScriptId"] }`

Notes:

- `id`, `name`, `createdAt`, `updatedAt`, `externalId`, `sandboxScriptId` work in sort, filters, and fields.
- `image` works in fields, not filters.
- `externalId` and `sandboxScriptId` resolve to `null` when not set on the entity.

### Entity Properties

Schema properties use `"properties"` as the first path segment.

String shorthand → `RuntimeRef` JSON:

- `entity.book.properties.author` → `{ "type": "entity", "slug": "book", "path": ["properties", "author"] }`
- `entity.book.properties.publishYear` → `{ "type": "entity", "slug": "book", "path": ["properties", "publishYear"] }`
- `entity.place.properties.country` → `{ "type": "entity", "slug": "place", "path": ["properties", "country"] }`

Deep nested paths extend the array:

- `entity.book.properties.metadata.source` → `{ "type": "entity", "slug": "book", "path": ["properties", "metadata", "source"] }`

### Event Join Built-Ins

String shorthand → `RuntimeRef` JSON:

- `event.review.id` → `{ "type": "event", "joinKey": "review", "path": ["id"] }`
- `event.review.createdAt` → `{ "type": "event", "joinKey": "review", "path": ["createdAt"] }`
- `event.review.updatedAt` → `{ "type": "event", "joinKey": "review", "path": ["updatedAt"] }`

### Event Join Properties

String shorthand → `RuntimeRef` JSON:

- `event.review.properties.rating` → `{ "type": "event", "joinKey": "review", "path": ["properties", "rating"] }`
- `event.review.properties.note` → `{ "type": "event", "joinKey": "review", "path": ["properties", "note"] }`
- `event.purchase.properties.price` → `{ "type": "event", "joinKey": "purchase", "path": ["properties", "price"] }`

### Event Aggregates

Event aggregate references compute an aggregation (e.g. average, count) across all of the
current user's events for a given event schema, per entity. Unlike event joins, they do not
require an `eventJoins` entry — they run a correlated subquery scoped to the authenticated user.

Supported aggregations: `avg`, `count`, `max`, `min`, `sum`.

```json
{
  "type": "event-aggregate",
  "eventSchemaSlug": "review",
  "path": ["rating"],
  "aggregation": "avg"
}
```

This computes the average `rating` property across all of the current user's `review` events
for each entity. Type inference returns `integer` for `count` and `number` for all other
aggregations.

Notes:

- Event aggregates are always scoped to the authenticated user — user A sees only their own averages.
- The `eventSchemaSlug` must be a valid event schema available for the entity schemas in the query.
- For `count`, the `path` field is required by the schema but not used in the SQL — it counts all matching events regardless of the property.
- For non-`count` aggregations, the `path` must reference a numeric property. Non-numeric values are treated as NULL and excluded from the aggregation.
- Event aggregates can be used anywhere expressions are accepted: fields, sort, filter, computed fields, and display configuration slots.

Examples:

Average user rating callout:

```json
{
  "key": "callout",
  "expression": {
    "type": "reference",
    "reference": {
      "type": "event-aggregate",
      "eventSchemaSlug": "review",
      "path": ["rating"],
      "aggregation": "avg"
    }
  }
}
```

Count of user reviews:

```json
{
  "key": "reviewCount",
  "expression": {
    "type": "reference",
    "reference": {
      "type": "event-aggregate",
      "eventSchemaSlug": "review",
      "path": ["rating"],
      "aggregation": "count"
    }
  }
}
```

## Event Joins

Currently supported join kind:

```json
[
  {
    "key": "review",
    "kind": "latestEvent",
    "eventSchemaSlug": "review"
  }
]
```

Use the `key` in references (string shorthand) like `event.review.properties.rating` — in a real request use `{ "type": "event", "joinKey": "review", "path": ["properties", "rating"] }`.

Important:

- The join key is your local alias.
- `latestEvent` means the backend uses the latest matching event per entity.
- Event references only work if the join is declared in `eventJoins`.
- The joined event schema must be available for the entity schemas in `entitySchemaSlugs`.

## Filters

Supported ops:

- `eq`
- `neq`
- `gt`
- `gte`
- `lt`
- `lte`
- `in`
- `isNull`
- `isNotNull`
- `contains`

Examples:

```json
{
  "type": "comparison",
  "operator": "gte",
  "left": {
    "type": "reference",
    "reference": { "type": "entity", "slug": "book", "path": ["properties", "rating"] }
  },
  "right": { "type": "literal", "value": 4 }
}

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
      {
        "id": "ent_123",
        "name": "Dune",
        "createdAt": "2026-03-28T10:00:00.000Z",
        "updatedAt": "2026-03-28T10:00:00.000Z",
        "externalId": null,
        "entitySchemaId": "schema_book",
        "entitySchemaSlug": "book",
        "sandboxScriptId": null,
        "image": {
          "kind": "remote",
          "url": "https://example.com/dune.jpg"
        },
        "fields": [
          {
            "key": "title",
            "kind": "text",
            "value": "Dune"
          },
          {
            "key": "rating",
            "kind": "number",
            "value": 5
          }
        ]
      }
    ]
  }
}
```

## Field Result Kinds

- `text`
- `number`
- `boolean`
- `date`
- `image`
- `json`
- `null`

Note:

- `fields` is always an array.
- A field can resolve to `{"kind": "null", "value": null}`.
- That means the field exists, but its expression resolved to `null`.

## Common UI Mappings

Typical field keys still look like UI slots such as `image`, `title`, `primarySubtitle`, `secondarySubtitle`, `callout`, or `column_0`, but each one now carries a single `expression` instead of a `references` array.

## Query Examples

### 1. Simple Single-Schema Query

```json
{
  "sort": {
    "direction": "asc",
    "expression": {
      "type": "reference",
      "reference": { "type": "entity", "slug": "book", "path": ["name"] }
    }
  },
  "pagination": {
    "page": 1,
    "limit": 20
  },
  "eventJoins": [],
  "filter": {
    "type": "comparison",
    "operator": "eq",
    "left": {
      "type": "reference",
      "reference": { "type": "entity", "slug": "book", "path": ["properties", "status"] }
    },
    "right": { "type": "literal", "value": "owned" }
  },
  "entitySchemaSlugs": ["book"],
  "fields": [
    {
      "key": "image",
      "expression": {
        "type": "reference",
        "reference": { "type": "entity", "slug": "book", "path": ["image"] }
      }
    },
    {
      "key": "title",
      "expression": {
        "type": "reference",
        "reference": { "type": "entity", "slug": "book", "path": ["name"] }
      }
    },
    {
      "key": "primarySubtitle",
      "expression": {
        "type": "reference",
        "reference": { "type": "entity", "slug": "book", "path": ["properties", "author"] }
      }
    }
  ]
}
```

### 2. Cross-Schema Coalescing Query

```json
{
  "sort": {
    "direction": "desc",
    "expression": {
      "type": "coalesce",
      "values": [
        {
          "type": "reference",
          "reference": { "type": "entity", "slug": "smartphone", "path": ["properties", "year"] }
        },
        {
          "type": "reference",
          "reference": { "type": "entity", "slug": "tablet", "path": ["properties", "releaseYear"] }
        }
      ]
    }
  },
  "pagination": {
    "page": 1,
    "limit": 20
  },
  "eventJoins": [],
  "filter": null,
  "entitySchemaSlugs": ["smartphone", "tablet"],
  "fields": [
    {
      "key": "title",
      "expression": {
        "type": "coalesce",
        "values": [
          {
            "type": "reference",
            "reference": { "type": "entity", "slug": "smartphone", "path": ["name"] }
          },
          {
            "type": "reference",
            "reference": { "type": "entity", "slug": "tablet", "path": ["name"] }
          }
        ]
      }
    }
  ]
}
```

### 3. Latest Review Rating Query

Show entities with their latest review rating and note.

```json
{
  "sort": {
    "direction": "desc",
    "expression": {
      "type": "reference",
      "reference": { "type": "event", "joinKey": "review", "path": ["properties", "rating"] }
    }
  },
  "pagination": {
    "page": 1,
    "limit": 20
  },
  "eventJoins": [
    {
      "key": "review",
      "kind": "latestEvent",
      "eventSchemaSlug": "review"
    }
  ],
  "filter": {
    "type": "comparison",
    "operator": "gte",
    "left": {
      "type": "reference",
      "reference": { "type": "event", "joinKey": "review", "path": ["properties", "rating"] }
    },
    "right": { "type": "literal", "value": 4 }
  },
  "entitySchemaSlugs": ["book"],
  "fields": [
    {
      "key": "title",
      "expression": {
        "type": "reference",
        "reference": { "type": "entity", "slug": "book", "path": ["name"] }
      }
    },
    {
      "key": "rating",
      "expression": {
        "type": "reference",
        "reference": { "type": "event", "joinKey": "review", "path": ["properties", "rating"] }
      }
    }
  ]
}
```

### 4. Event-Based Callout With Entity Fallback

Use latest review rating when present, otherwise show publish year.

```json
{
  "sort": {
    "direction": "asc",
    "expression": {
      "type": "reference",
      "reference": { "type": "entity", "slug": "book", "path": ["name"] }
    }
  },
  "pagination": {
    "page": 1,
    "limit": 20
  },
  "eventJoins": [
    {
      "key": "review",
      "kind": "latestEvent",
      "eventSchemaSlug": "review"
    }
  ],
  "filter": null,
  "entitySchemaSlugs": ["book"],
  "fields": [
    {
      "key": "title",
      "expression": {
        "type": "reference",
        "reference": { "type": "entity", "slug": "book", "path": ["name"] }
      }
    },
    {
      "key": "callout",
      "expression": {
        "type": "coalesce",
        "values": [
          {
            "type": "reference",
            "reference": { "type": "event", "joinKey": "review", "path": ["properties", "rating"] }
          },
          {
            "type": "reference",
            "reference": { "type": "entity", "slug": "book", "path": ["properties", "publishYear"] }
          }
        ]
      }
    }
  ]
}
```

## Event Query Notes

- `latestEvent` joins are per entity, not global.
- Sorting by an event field sorts by the latest joined event value.
- If the join is missing for an entity, joined references resolve to `null`.
- `isNull` is useful for "missing event" queries.
- `isNotNull` is useful for "has event" queries (e.g. entities that have been reviewed).
- Event built-ins such as `event.review.createdAt` (shorthand for `{ "type": "event", "joinKey": "review", "path": ["createdAt"] }`) are often useful for "most recently reviewed" or "most recently purchased" views.

## Example Response With Event Fields

```json
{
  "data": {
    "meta": {
      "pagination": {
        "page": 1,
        "total": 2,
        "limit": 20,
        "totalPages": 1,
        "hasNextPage": false,
        "hasPreviousPage": false
      }
    },
    "items": [
      {
        "id": "ent_book_1",
        "name": "Dune",
        "createdAt": "2026-03-28T10:00:00.000Z",
        "updatedAt": "2026-03-28T10:00:00.000Z",
        "externalId": null,
        "entitySchemaId": "schema_book",
        "entitySchemaSlug": "book",
        "sandboxScriptId": null,
        "image": null,
        "fields": [
          { "key": "title", "kind": "text", "value": "Dune" },
          { "key": "rating", "kind": "number", "value": 5 },
          { "key": "reviewedAt", "kind": "date", "value": "2026-03-27T08:15:00.000Z" },
          { "key": "note", "kind": "text", "value": "Excellent" }
        ]
      },
      {
        "id": "ent_book_2",
        "name": "Foundation",
        "createdAt": "2026-03-28T10:00:00.000Z",
        "updatedAt": "2026-03-28T10:00:00.000Z",
        "externalId": null,
        "entitySchemaId": "schema_book",
        "entitySchemaSlug": "book",
        "sandboxScriptId": null,
        "image": null,
        "fields": [
          { "key": "title", "kind": "text", "value": "Foundation" },
          { "key": "rating", "kind": "null", "value": null },
          { "key": "reviewedAt", "kind": "null", "value": null },
          { "key": "note", "kind": "null", "value": null }
        ]
      }
    ]
  }
}
```

## Gotchas

- All references must be explicit; shorthand like `book.title` is invalid.
- `fields` may be empty, but then `items[].fields` will also be empty.
- `event.*` references require the join to be declared in `eventJoins`.
- `event-aggregate` references do not require an entry in `eventJoins` — they operate independently via correlated subqueries.
- Sort/filter references must point to schemas included in `entitySchemaSlugs`.
- `image` is display-only, not filterable.
- Duplicate field keys are rejected.
- `"properties"` is a reserved first path segment meaning "navigate into the JSONB properties column". The system column set must never include a column named `properties`.
- String path notation (e.g. `entity.book.properties.author`) is documentation shorthand only. Sending a raw string path in a request body is invalid; the API requires structured `RuntimeRef` JSON objects.

## Validation Errors

Common validation failures are reported with direct payload-oriented messages:

- Missing computed field: `Computed field 'displayName' is not part of this runtime request`
- Dependency cycle: `Computed field dependency cycle detected: first -> second -> first`
- Type mismatch: `Filter operator 'eq' requires compatible expression types, received 'integer' and 'string'`
- Non-display image usage: `Image expressions are display-only and cannot be used in sorting`
- Invalid event-aggregate slug: `Event schema 'reviw' is not available for the requested entity schemas`
