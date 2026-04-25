# Query Engine Array Response Plan

## Goal

Change the query-engine response so `items` is an array of arrays, where each inner array contains only the resolved fields that were explicitly requested, in request order.

This removes the current behavior where top-level entity attributes are always returned for every result item.

Backwards compatibility is intentionally out of scope. No shims or compatibility layers should be added.

## Target Contract

Current shape:

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
        "sandboxScriptId": null,
        "image": { "kind": "remote", "url": "https://example.com/dune.jpg" },
        "fields": [
          { "key": "title", "kind": "text", "value": "Dune" },
          { "key": "rating", "kind": "number", "value": 5 }
        ]
      }
    ]
  }
}
```

Target shape:

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

## Key Decisions

- The inner response entries stay as `{ key, kind, value }` objects.
- Only the outer entity object is removed.
- Consumers that need entity identity data must request it explicitly as normal fields.
- Frontend identity fields should use readable keys, not prefixed magic keys.
- The identity-field naming strategy will use: `entityId`, `entityName`, `entityCreatedAt`, `entityUpdatedAt`, `entityImage`, `entityExternalId`, `entitySandboxScriptId`.
- Saved-view display fields keep their current semantic names such as `title`, `image`, `callout`, `primarySubtitle`, and `secondarySubtitle`.
- No compatibility layer should translate between old and new response shapes.
- Consumers should not do manual field plumbing at every call site. The extra work should stay centralized in request builders and a small number of shared adapters.

## Examples

### Explicit identity fields

Request:

```json
{
  "scope": ["book"],
  "eventJoins": [],
  "computedFields": [],
  "filter": null,
  "pagination": { "page": 1, "limit": 20 },
  "sort": {
    "direction": "asc",
    "expression": {
      "type": "reference",
      "reference": { "type": "entity", "slug": "book", "path": ["name"] }
    }
  },
  "fields": [
    {
      "key": "entityId",
      "expression": {
        "type": "reference",
        "reference": { "type": "entity", "slug": "book", "path": ["id"] }
      }
    },
    {
      "key": "entityName",
      "expression": {
        "type": "reference",
        "reference": { "type": "entity", "slug": "book", "path": ["name"] }
      }
    },
    {
      "key": "rating",
      "expression": {
        "type": "reference",
        "reference": { "type": "entity", "slug": "book", "path": ["properties", "rating"] }
      }
    }
  ]
}
```

Response:

```json
{
  "data": {
    "meta": {
      "pagination": {
        "page": 1,
        "total": 1,
        "limit": 20,
        "totalPages": 1,
        "hasNextPage": false,
        "hasPreviousPage": false
      }
    },
    "items": [
      [
        { "key": "entityId", "kind": "text", "value": "ent_123" },
        { "key": "entityName", "kind": "text", "value": "Dune" },
        { "key": "rating", "kind": "number", "value": 5 }
      ]
    ]
  }
}
```

### Empty requested fields

Request:

```json
{
  "scope": ["book"],
  "eventJoins": [],
  "computedFields": [],
  "filter": null,
  "pagination": { "page": 1, "limit": 2 },
  "sort": {
    "direction": "asc",
    "expression": {
      "type": "reference",
      "reference": { "type": "entity", "slug": "book", "path": ["name"] }
    }
  },
  "fields": []
}
```

Response:

```json
{
  "data": {
    "meta": {
      "pagination": {
        "page": 1,
        "total": 2,
        "limit": 2,
        "totalPages": 1,
        "hasNextPage": false,
        "hasPreviousPage": false
      }
    },
    "items": [[], []]
  }
}
```

### Saved-view frontend internal request

For saved views, the frontend still needs identity information to build `AppEntity`, route to the entity page, and resolve images. That identity data should be requested explicitly alongside the visible display fields.

Example internal field list for a grid view:

```json
[
  { "key": "entityId", "expression": "...coalesced id expression..." },
  { "key": "entityName", "expression": "...coalesced name expression..." },
  { "key": "entityCreatedAt", "expression": "...coalesced createdAt expression..." },
  { "key": "entityUpdatedAt", "expression": "...coalesced updatedAt expression..." },
  { "key": "entityImage", "expression": "...coalesced image expression..." },
  { "key": "entityExternalId", "expression": "...coalesced externalId expression..." },
  { "key": "entitySandboxScriptId", "expression": "...coalesced sandboxScriptId expression..." },
  { "key": "image", "expression": "...display image expression..." },
  { "key": "title", "expression": "...display title expression..." },
  { "key": "callout", "expression": "...display callout expression..." }
]
```

## Scope

The change spans these packages:

- `apps/app-backend/`
- `apps/app-frontend/`
- `libs/ts-utils/`
- `tests/`

## Detailed Plan

### 1. Backend query-engine contract

Update `apps/app-backend/src/modules/query-engine/schemas.ts` so:

- `items` becomes `z.array(z.array(resolvedQueryEngineFieldSchema))`
- the current top-level query-engine item schema is removed
- `QueryEngineItem` is redefined as the inner field-array type or removed if the simpler type aliases are clearer
- exports are updated to match the new shape

Update `apps/app-backend/src/modules/query-engine/README.md` so the response-shape section reflects the new contract and explicitly states that built-in entity attributes are no longer implicitly returned.

### 2. Backend query execution

Update `apps/app-backend/src/modules/query-engine/query-builder.ts` so:

- `QueryRow` only contains `total` and `fields`
- the final SQL projection no longer selects top-level entity columns just to return them
- row mapping returns `row.fields ?? []`
- the zero-result sentinel row is still filtered out correctly

The current left-join sentinel behavior must remain safe. An empty result set should stay `items: []`, not `items: [[]]`.

Update `apps/app-backend/src/modules/query-engine/index.ts` and the dedicated query-builder tests to match the new mapping behavior.

### 3. Backend internal consumers

Audit and update backend modules that consume query-engine results directly.

The main known internal consumer is `apps/app-backend/src/modules/media/service.ts`. It currently expects top-level `id`, `name`, and `image` on query-engine items. That module should:

- request those values explicitly as fields
- read them via keyed field lookup
- keep using normal domain objects after the lookup step

Update `apps/app-backend/src/modules/media/service.test.ts` to use the new field-array shape.

### 4. Frontend request builders

Update `apps/app-frontend/src/features/entities/model.ts` so `createEntityRuntimeRequest` always includes these identity fields:

- `entityId`
- `entityName`
- `entityCreatedAt`
- `entityUpdatedAt`
- `entityImage`
- `entityExternalId`
- `entitySandboxScriptId`

These should be requested explicitly for every entity list query because `toAppEntity` depends on them.

Update saved-view request builders so they also add those same identity fields, but do so with expressions that work in both single-schema and multi-schema views.

For multi-schema views, these identity fields must be built with coalesced entity-column expressions across all requested schema slugs.

### 5. Frontend response parsing

Update `apps/app-frontend/src/features/entities/model.ts` so:

- query-engine items are treated as field arrays
- `toAppEntity` reads `entityId`, `entityName`, `entityCreatedAt`, `entityUpdatedAt`, `entityImage`, `entityExternalId`, and `entitySandboxScriptId` from the returned field array
- `AppEntity.fields` can continue to hold the raw requested field array because the identity fields use distinct readable keys such as `entityId` and `entityImage`

This keeps the parsing work centralized without forcing downstream consumers to strip or reshape fields again.

### 6. Frontend direct consumers

Update the raw query-engine consumers that do not go entirely through `toAppEntity`:

- `apps/app-frontend/src/features/collections/model.ts`
- `apps/app-frontend/src/features/collections/discovery.ts`
- `apps/app-frontend/src/features/saved-views/view-page-utils.ts`
- `apps/app-frontend/src/features/saved-views/view-page.tsx`
- `apps/app-frontend/src/features/saved-views/view-page-sections.tsx`
- `apps/app-frontend/src/features/entities/use-search.ts`
- `apps/app-frontend/src/features/test-fixtures/collections.ts`

Important details:

- `use-search.ts` currently sends `fields: []` for tracked-entity detection. After this contract change, that would return empty arrays and break tracked-entity detection unless `entityExternalId` is explicitly requested.
- saved-view table rendering currently reads `item.fields`. That logic can stay intact because table columns still use `column_*` keys and the added identity fields use distinct `entity*` keys.

### 7. Shared utility in `libs/ts-utils`

Add a small shared helper in `libs/ts-utils/` for keyed lookup on resolved field arrays.

Expected shape:

```ts
export function getQueryEngineField<T extends { key: string }>(
  item: T[],
  key: string,
): T | undefined {
  return item.find((field) => field.key === key);
}
```

This keeps frontend, backend, and test code from repeating raw `.find((field) => field.key === key)` lookups everywhere.

### 8. Tests

Update tests across `tests/src/` to the new response shape.

Key files:

- `tests/src/fixtures/query-engine.ts`
- `tests/src/test-support/query-engine-suite.ts`
- `tests/src/tests/query-engine.test.ts`
- `tests/src/tests/saved-views.test.ts`
- `tests/src/tests/exercises.test.ts`

Required changes:

- item helpers should search the item array directly
- direct accesses like `item.name`, `item.image`, `item.id`, and `item.fields` must be removed
- grid/list tests that currently assert `item.name` should use the existing `title` field when appropriate
- tests that need identity fields should request them explicitly

Update `apps/app-backend/src/modules/query-engine/query-builder.test.ts` and `apps/app-backend/src/modules/media/service.test.ts` as part of the same migration.

### 9. Seed and bootstrap audit

Audit seed and bootstrap related code in `apps/app-backend/` while implementing:

- `src/lib/db/seed/`
- `src/modules/authentication/bootstrap/`
- `src/modules/fitness/startup.ts`
- any built-in saved-view or startup helper that indirectly depends on query-engine results

Based on the current read, these areas do not appear to parse query-engine response items directly, so direct response-shape changes are not expected there.

Even so, they should be rechecked during implementation so that any request-builder assumptions exposed by the migration are fixed in the same change.

### 10. Verification

After implementation, run the relevant verification for each touched package.

Backend:

- `bun run typecheck`
- `bun run test`
- `bun run lint`

Frontend:

- `bun turbo --filter=@ryot/app-frontend typecheck`
- `bun turbo --filter=@ryot/app-frontend lint -- --write`

Tests package:

- `bun run typecheck`
- `bun run test`
- `bun run lint`

If OpenAPI-derived types need regeneration for the new response schema, that regeneration should be included before final verification.

## Main Risks

- The zero-result sentinel row in the backend query must still be filtered out after removing the top-level item envelope.
- The media overview service in `apps/app-backend` is a real internal consumer and must migrate alongside the query-engine contract.
- Multi-schema saved views need coalesced identity-field expressions, not single-schema expressions.
- Frontend tracked-entity detection will silently fail if `entityExternalId` is not explicitly requested.
- The identity-field lookup and parsing should stay centralized so feature consumers do not each implement their own field extraction logic.

## Implementation Summary

The intended architecture is simple:

- query-engine becomes fully field-driven
- consumers explicitly request every value they need
- field arrays are the only item shape returned by the runtime
- identity lookup happens at the edges where domain objects are reconstructed
- no bridge layer preserves the previous object-based response shape
