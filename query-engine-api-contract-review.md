# Query Engine API Contract Review

This document captures issues discovered during review of the
`apps/app-backend/src/modules/query-engine/` module and its E2E tests. Please note that
since this is a greenfield project, any migrations for user data are not needed. Any
backwards compatibility shims should not be implemented, and breaking changes should be made
freely to improve the API contract.

---

## Severity: Critical

### 1. `fields` response is an array-of-arrays instead of a keyed object

**Problem:**
Each result row is `Array<{ key, kind, value }>`. Clients must scan the array (O(n) per field)
to find a value by key. This is inefficient and unergonomic for UI consumption.

**Solution:**
Return a keyed object per row, with an optional `fieldOrder` metadata array to preserve layout:
```json
{
  "items": [
    {
      "title": { "kind": "text", "value": "Dune" },
      "rating": { "kind": "number", "value": 5 }
    }
  ],
  "meta": { "fieldOrder": ["title", "rating"] }
}
```

**Location:**
- `apps/app-backend/src/modules/query-engine/schemas.ts` (lines 167–186)
- `apps/app-backend/src/modules/query-engine/display-builder.ts`
- `tests/` and `apps/app-client`
