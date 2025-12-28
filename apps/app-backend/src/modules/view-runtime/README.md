# View Runtime Guide

This document describes the request language for `'/view-runtime/execute'`.

For concrete executable examples, also see:

- `tests/src/fixtures/view-runtime.ts`
- `tests/src/test-support/view-runtime-suite.ts`
- `tests/src/tests/view-runtime.test.ts`

## Mental Model

`/view-runtime/execute` runs a query and resolves a set of requested output fields.

- You send query inputs plus ordered `fields`.
- Each field has a `key` and one or more `references`.
- The backend resolves the first non-null reference for each field.
- The response returns entities plus resolved `fields` as `{ key, kind, value }`.

## Request Shape

```json
{
  "sort": {
    "direction": "asc",
    "fields": ["entity.book.@name"]
  },
  "pagination": {
    "page": 1,
    "limit": 20
  },
  "eventJoins": [],
  "filters": [],
  "entitySchemaSlugs": ["book"],
  "fields": [
    {
      "key": "title",
      "references": ["entity.book.@name"]
    },
    {
      "key": "image",
      "references": ["entity.book.@image"]
    }
  ]
}
```

## Top-Level Keys

- `sort.fields`: one or more explicit references
- `sort.direction`: `asc` or `desc`
- `pagination.page`: 1-based integer
- `pagination.limit`: positive integer
- `entitySchemaSlugs`: one or more schema slugs included in the query
- `filters`: zero or more filter expressions
- `eventJoins`: zero or more event join definitions
- `fields`: ordered list of output fields

## Field Selection

Each field looks like this:

```json
{
  "key": "subtitle",
  "references": [
    "entity.smartphone.manufacturer",
    "entity.tablet.manufacturer"
  ]
}
```

Rules:

- `key` must be non-empty and unique within the request.
- `references` is an ordered fallback list.
- The backend resolves the first non-null reference.
- Use multiple references for cross-schema coalescing.
- The `fields` array itself is an array, never `null`.

## Reference Syntax

All references must be explicit.

### Entity Built-Ins

- `entity.book.@id`
- `entity.book.@name`
- `entity.book.@image`
- `entity.book.@createdAt`
- `entity.book.@updatedAt`

Notes:

- `@id`, `@name`, `@createdAt`, `@updatedAt` work in sort, filters, and fields.
- `@image` works in fields, not filters.

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
- `contains`

Examples:

```json
{ "op": "eq", "field": "entity.book.status", "value": "owned" }
{ "op": "gte", "field": "entity.book.rating", "value": 4 }
{ "op": "in", "field": "entity.book.genre", "value": ["sci-fi", "fantasy"] }
{ "op": "isNull", "field": "event.review.rating" }
{ "op": "contains", "field": "entity.book.tags", "value": "classic" }
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
        "entitySchemaId": "schema_book",
        "entitySchemaSlug": "book",
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
- That means the field exists, but none of its references produced a value.

## Common UI Mappings

### Grid / List

Typical keys:

- `image`
- `title`
- `subtitle`
- `badge`

Example:

```json
"fields": [
  { "key": "image", "references": ["entity.book.@image"] },
  { "key": "title", "references": ["entity.book.@name"] },
  { "key": "subtitle", "references": ["entity.book.author"] },
  { "key": "badge", "references": ["entity.book.publishYear"] }
]
```

### Table

Typical keys:

- `column_0`
- `column_1`
- `column_2`

Example:

```json
"fields": [
  { "key": "column_0", "references": ["entity.book.@name"] },
  { "key": "column_1", "references": ["entity.book.author"] },
  { "key": "column_2", "references": ["entity.book.publishYear"] }
]
```

## Query Examples

### 1. Simple Single-Schema Query

```json
{
  "sort": {
    "direction": "asc",
    "fields": ["entity.book.@name"]
  },
  "pagination": {
    "page": 1,
    "limit": 20
  },
  "eventJoins": [],
  "filters": [
    { "op": "eq", "field": "entity.book.status", "value": "owned" }
  ],
  "entitySchemaSlugs": ["book"],
  "fields": [
    { "key": "image", "references": ["entity.book.@image"] },
    { "key": "title", "references": ["entity.book.@name"] },
    { "key": "subtitle", "references": ["entity.book.author"] },
    { "key": "badge", "references": ["entity.book.publishYear"] }
  ]
}
```

### 2. Cross-Schema Coalescing Query

```json
{
  "sort": {
    "direction": "desc",
    "fields": [
      "entity.smartphone.year",
      "entity.tablet.releaseYear"
    ]
  },
  "pagination": {
    "page": 1,
    "limit": 20
  },
  "eventJoins": [],
  "filters": [],
  "entitySchemaSlugs": ["smartphone", "tablet"],
  "fields": [
    {
      "key": "title",
      "references": [
        "entity.smartphone.@name",
        "entity.tablet.@name"
      ]
    },
    {
      "key": "subtitle",
      "references": [
        "entity.smartphone.manufacturer",
        "entity.tablet.maker"
      ]
    },
    {
      "key": "badge",
      "references": [
        "entity.smartphone.year",
        "entity.tablet.releaseYear"
      ]
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
    "fields": ["event.review.rating"]
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
  "filters": [
    { "op": "gte", "field": "event.review.rating", "value": 4 }
  ],
  "entitySchemaSlugs": ["book"],
  "fields": [
    { "key": "title", "references": ["entity.book.@name"] },
    { "key": "rating", "references": ["event.review.rating"] },
    { "key": "note", "references": ["event.review.note"] },
    { "key": "reviewedAt", "references": ["event.review.@createdAt"] }
  ]
}
```

### 4. Latest Purchase Info Query

Show the most recent purchase price and purchase timestamp for each whiskey.

```json
{
  "sort": {
    "direction": "desc",
    "fields": ["event.purchase.@createdAt"]
  },
  "pagination": {
    "page": 1,
    "limit": 20
  },
  "eventJoins": [
    {
      "key": "purchase",
      "kind": "latestEvent",
      "eventSchemaSlug": "purchase"
    }
  ],
  "filters": [
    { "op": "gte", "field": "event.purchase.price", "value": 100 }
  ],
  "entitySchemaSlugs": ["whiskey"],
  "fields": [
    { "key": "title", "references": ["entity.whiskey.@name"] },
    { "key": "distillery", "references": ["entity.whiskey.distillery"] },
    { "key": "price", "references": ["event.purchase.price"] },
    { "key": "purchasedAt", "references": ["event.purchase.@createdAt"] }
  ]
}
```

### 5. Entities Missing a Joined Event

Find books with no latest review rating.

```json
{
  "sort": {
    "direction": "asc",
    "fields": ["entity.book.@name"]
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
  "filters": [
    { "op": "isNull", "field": "event.review.rating" }
  ],
  "entitySchemaSlugs": ["book"],
  "fields": [
    { "key": "title", "references": ["entity.book.@name"] },
    { "key": "reviewRating", "references": ["event.review.rating"] }
  ]
}
```

### 6. Mixed Entity + Event Table Query

```json
{
  "sort": {
    "direction": "desc",
    "fields": ["event.review.rating", "entity.book.@name"]
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
  "filters": [],
  "entitySchemaSlugs": ["book"],
  "fields": [
    { "key": "column_0", "references": ["entity.book.@name"] },
    { "key": "column_1", "references": ["entity.book.author"] },
    { "key": "column_2", "references": ["event.review.rating"] },
    { "key": "column_3", "references": ["event.review.@createdAt"] }
  ]
}
```

### 7. Event-Based Badge With Entity Fallback

Use latest review rating when present, otherwise show publish year.

```json
{
  "sort": {
    "direction": "asc",
    "fields": ["entity.book.@name"]
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
  "filters": [],
  "entitySchemaSlugs": ["book"],
  "fields": [
    { "key": "title", "references": ["entity.book.@name"] },
    {
      "key": "badge",
      "references": [
        "event.review.rating",
        "entity.book.publishYear"
      ]
    }
  ]
}
```

## Event Query Notes

- `latestEvent` joins are per entity, not global.
- Sorting by an event field sorts by the latest joined event value.
- If the join is missing for an entity, joined references resolve to `null`.
- `isNull` is useful for “missing event” queries.
- Event built-ins such as `event.review.@createdAt` are often useful for “most recently reviewed” or “most recently purchased” views.

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
        "entitySchemaId": "schema_book",
        "entitySchemaSlug": "book",
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
        "entitySchemaId": "schema_book",
        "entitySchemaSlug": "book",
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

## Copy-Paste Starters

### Grid-Like Starter

```json
{
  "sort": {
    "direction": "asc",
    "fields": ["entity.book.@name"]
  },
  "pagination": {
    "page": 1,
    "limit": 20
  },
  "eventJoins": [],
  "filters": [],
  "entitySchemaSlugs": ["book"],
  "fields": [
    { "key": "image", "references": ["entity.book.@image"] },
    { "key": "title", "references": ["entity.book.@name"] },
    { "key": "subtitle", "references": ["entity.book.author"] },
    { "key": "badge", "references": ["entity.book.publishYear"] }
  ]
}
```

### Event-Driven Starter

```json
{
  "sort": {
    "direction": "desc",
    "fields": ["event.review.@createdAt"]
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
  "filters": [],
  "entitySchemaSlugs": ["book"],
  "fields": [
    { "key": "title", "references": ["entity.book.@name"] },
    { "key": "rating", "references": ["event.review.rating"] },
    { "key": "reviewedAt", "references": ["event.review.@createdAt"] },
    { "key": "note", "references": ["event.review.note"] }
  ]
}
```
