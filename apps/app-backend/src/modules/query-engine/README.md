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
            "reference": { "type": "schema-property", "slug": "book", "property": "publishYear" }
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
              "reference": { "type": "entity-column", "slug": "book", "column": "name" }
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
        "reference": { "type": "entity-column", "slug": "book", "column": "image" }
      },
      "titleProperty": {
        "type": "reference",
        "reference": { "type": "computed-field", "key": "label" }
      },
      "subtitleProperty": null,
      "badgeProperty": {
        "type": "reference",
        "reference": { "type": "computed-field", "key": "nextYear" }
      }
    },
    "list": {
      "imageProperty": {
        "type": "reference",
        "reference": { "type": "entity-column", "slug": "book", "column": "image" }
      },
      "titleProperty": {
        "type": "reference",
        "reference": { "type": "computed-field", "key": "label" }
      },
      "subtitleProperty": null,
      "badgeProperty": {
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
      "reference": { "type": "computed-field", "key": "displayName" }
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
        "reference": { "type": "entity-column", "slug": "book", "column": "name" }
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
        "reference": { "type": "entity-column", "slug": "book", "column": "image" }
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
- `computedFields`: zero or more named reusable expressions
- `fields`: ordered list of output fields

## Field Selection

Each field looks like this:

```json
{
  "key": "subtitle",
  "expression": {
    "type": "coalesce",
    "values": [
      {
        "type": "reference",
        "reference": { "type": "schema-property", "slug": "smartphone", "property": "manufacturer" }
      },
      {
        "type": "reference",
        "reference": { "type": "schema-property", "slug": "tablet", "property": "manufacturer" }
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
        "reference": { "type": "event-join-property", "joinKey": "review", "property": "rating" }
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
      "reference": { "type": "schema-property", "slug": "book", "property": "rating" }
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
        "reference": { "type": "schema-property", "slug": "book", "property": "pages" }
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
      "reference": { "type": "entity-column", "slug": "book", "column": "name" }
    }
  ]
}
```

Image rules:

- Image references remain display-only.
- Image expressions are rejected from sort, filter, arithmetic, and string composition.
- Conditional and coalesce branches cannot mix image and non-image values.

## Reference Syntax

All references must be explicit.

### Entity Built-Ins

- `entity.book.@id`
- `entity.book.@name`
- `entity.book.@image`
- `entity.book.@createdAt`
- `entity.book.@updatedAt`
- `entity.book.@externalId`
- `entity.book.@sandboxScriptId`

Notes:

- `@id`, `@name`, `@createdAt`, `@updatedAt`, `@externalId`, `@sandboxScriptId` work in sort, filters, and fields.
- `@image` works in fields, not filters.
- `@externalId` and `@sandboxScriptId` resolve to `null` when not set on the entity.

### Entity Properties

- `entity.book.author`
- `entity.book.publishYear`
- `entity.place.country`

### Event Join Built-Ins

- `event.review.@id`
- `event.review.@createdAt`
- `event.review.@updatedAt`

### Event Join Properties

- `event.review.rating`
- `event.review.note`
- `event.purchase.price`

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

Use the `key` in references like `event.review.rating`.

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
    "reference": { "type": "schema-property", "slug": "book", "property": "rating" }
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
        "reference": { "type": "schema-property", "slug": "book", "property": "tags" }
      },
      "value": { "type": "literal", "value": "classic" }
    },
    {
      "type": "isNotNull",
      "expression": {
        "type": "reference",
        "reference": { "type": "event-join-property", "joinKey": "review", "property": "rating" }
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

Typical field keys still look like UI slots such as `image`, `title`, `subtitle`, `badge`, or `column_0`, but each one now carries a single `expression` instead of a `references` array.

## Query Examples

### 1. Simple Single-Schema Query

```json
{
  "sort": {
    "direction": "asc",
    "expression": {
      "type": "reference",
      "reference": { "type": "entity-column", "slug": "book", "column": "name" }
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
      "reference": { "type": "schema-property", "slug": "book", "property": "status" }
    },
    "right": { "type": "literal", "value": "owned" }
  },
  "entitySchemaSlugs": ["book"],
  "fields": [
    {
      "key": "image",
      "expression": {
        "type": "reference",
        "reference": { "type": "entity-column", "slug": "book", "column": "image" }
      }
    },
    {
      "key": "title",
      "expression": {
        "type": "reference",
        "reference": { "type": "entity-column", "slug": "book", "column": "name" }
      }
    },
    {
      "key": "subtitle",
      "expression": {
        "type": "reference",
        "reference": { "type": "schema-property", "slug": "book", "property": "author" }
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
          "reference": { "type": "schema-property", "slug": "smartphone", "property": "year" }
        },
        {
          "type": "reference",
          "reference": { "type": "schema-property", "slug": "tablet", "property": "releaseYear" }
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
            "reference": { "type": "entity-column", "slug": "smartphone", "column": "name" }
          },
          {
            "type": "reference",
            "reference": { "type": "entity-column", "slug": "tablet", "column": "name" }
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
      "reference": { "type": "event-join-property", "joinKey": "review", "property": "rating" }
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
      "reference": { "type": "event-join-property", "joinKey": "review", "property": "rating" }
    },
    "right": { "type": "literal", "value": 4 }
  },
  "entitySchemaSlugs": ["book"],
  "fields": [
    {
      "key": "title",
      "expression": {
        "type": "reference",
        "reference": { "type": "entity-column", "slug": "book", "column": "name" }
      }
    },
    {
      "key": "rating",
      "expression": {
        "type": "reference",
        "reference": { "type": "event-join-property", "joinKey": "review", "property": "rating" }
      }
    }
  ]
}
```

### 4. Event-Based Badge With Entity Fallback

Use latest review rating when present, otherwise show publish year.

```json
{
  "sort": {
    "direction": "asc",
    "expression": {
      "type": "reference",
      "reference": { "type": "entity-column", "slug": "book", "column": "name" }
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
        "reference": { "type": "entity-column", "slug": "book", "column": "name" }
      }
    },
    {
      "key": "badge",
      "expression": {
        "type": "coalesce",
        "values": [
          {
            "type": "reference",
            "reference": { "type": "event-join-property", "joinKey": "review", "property": "rating" }
          },
          {
            "type": "reference",
            "reference": { "type": "schema-property", "slug": "book", "property": "publishYear" }
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
- Event built-ins such as `event.review.@createdAt` are often useful for "most recently reviewed" or "most recently purchased" views.

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
- Sort/filter references must point to schemas included in `entitySchemaSlugs`.
- `@image` is display-only, not filterable.
- Duplicate field keys are rejected.

## Validation Errors

Common validation failures are reported with direct payload-oriented messages:

- Missing computed field: `Computed field 'displayName' is not part of this runtime request`
- Dependency cycle: `Computed field dependency cycle detected: first -> second -> first`
- Type mismatch: `Filter operator 'eq' requires compatible expression types, received 'integer' and 'string'`
- Non-display image usage: `Image expressions are display-only and cannot be used in sorting`

## Copy-Paste Starters

Use the request examples in this guide as starters. Every payload should use `sort.expression`, optional top-level `filter`, and per-field `expression` nodes.
