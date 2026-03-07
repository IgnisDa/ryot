# REST API Response Standardization Design

**Date:** 2026-02-27  
**Status:** Approved  
**Scope:** apps/app-backend

## Overview

Standardize all REST API responses in the app-backend to follow a consistent envelope structure pattern, similar to industry leaders like Stripe, Twilio, and Shopify.

## Problem Statement

The current API has wildly varying response structures:
- `/health` returns `{status: "healthy"}`
- `/me` returns `{user: ..., session: ...}`
- `/app-config/set` returns `{config_value: {...}}`
- `/entities/{id}` returns entity fields at root level
- `/entity-schemas/list` returns `{schemas: [...]}`
- `/entity-schemas/search` returns `{details: {...}, items: [...]}`
- Error responses vary between `{error: "string"}` and generic objects

This inconsistency makes the API harder to consume, type, and maintain.

## Design Goals

1. Every response has consistent structure
2. Clear separation between success and error states
3. Type-safe response handling
4. Support for pagination metadata
5. Machine-readable error codes
6. Industry-standard patterns

## Response Structure Specification

### Success Responses

**Single Resource:**
```typescript
{
  data: T  // object or primitive
}
```

**Collection with Pagination:**
```typescript
{
  data: T[],
  meta: {
    total: number,      // total items available
    page: number,       // current page number
    hasMore: boolean    // whether more pages exist
  }
}
```

### Error Responses

```typescript
{
  error: {
    code: string,       // machine-readable (e.g., "entity_not_found")
    message: string     // human-readable message
  }
}
```

### TypeScript Types

```typescript
// Generic success response types
type SuccessResponse<T> = { data: T }
type PaginatedResponse<T> = { 
  data: T[], 
  meta: { total: number, page: number, hasMore: boolean } 
}

// Error response type
type ErrorResponse = { 
  error: { code: string, message: string } 
}

// Union type for any response
type ApiResponse<T> = SuccessResponse<T> | ErrorResponse
```

## Endpoint Transformations

### GET /health
```typescript
// Before
200: {status: "healthy"}
503: {error: "Database check failed..."}

// After
200: {data: {status: "healthy"}}
503: {error: {code: "health_check_failed", message: "Database check failed..."}}
```

### GET /me
```typescript
// Before
200: {user: {...}, session: {...}}
401: {error: "Request is unauthenticated"}

// After
200: {data: {user: {...}, session: {...}}}
401: {error: {code: "unauthenticated", message: "Request is unauthenticated"}}
```

### POST /app-config/set
```typescript
// Before
200: {config_value: {...}}

// After
200: {data: {...}}  // config value directly, no wrapper
```

### POST /sandbox/run
```typescript
// Before
200: {success: true, logs: "...", error: "...", value: {...}, durationMs: 100}

// After
200: {data: {logs: "...", value: {...}, durationMs: 100}}
// Note: 'success' field removed (redundant with HTTP status)
// Note: 'error' moved to error response format when applicable
```

### GET /entities/{entityId}
```typescript
// Before
200: {id: "...", name: "...", properties: {...}, ...}
404: {error: "Entity not found"}

// After
200: {data: {id: "...", name: "...", properties: {...}, ...}}
404: {error: {code: "not_found", message: "Entity not found"}}
```

### GET /entity-schemas/list
```typescript
// Before
200: {schemas: [{id: "...", slug: "...", name: "...", scriptPairs: [...]}]}

// After
200: {data: [{id: "...", slug: "...", name: "...", scriptPairs: [...]}]}
// Array directly in data, no wrapper object
```

### POST /entity-schemas/search
```typescript
// Before
200: {
  details: {total_items: 100, next_page: 2},
  items: [{title: "...", identifier: "...", ...}]
}

// After
200: {
  data: [{title: "...", identifier: "...", ...}],
  meta: {total: 100, page: 1, hasMore: true}
}
```

### POST /entity-schemas/import
```typescript
// Before
200: {created: true, entityId: "..."}
404: {error: "Details script is missing"}

// After
200: {data: {created: true, entityId: "..."}}
404: {error: {code: "not_found", message: "Details script is missing"}}
```

## Implementation Strategy

### 1. Core Helper Functions (lib/openapi.ts)

Add new helper functions for standardized responses:

```typescript
// Success response helpers
export const successResponse = <T>(data: T) => ({ data })

export const paginatedResponse = <T>(
  data: T[],
  meta: { total: number, page: number, hasMore: boolean }
) => ({ data, meta })

// Error response helpers
export const errorResponse = (code: string, message: string) => ({
  error: { code, message }
})

// Schema helpers for OpenAPI
export const dataSchema = <T extends z.ZodType>(schema: T) =>
  z.object({ data: schema })

export const paginatedSchema = <T extends z.ZodType>(itemSchema: T) =>
  z.object({
    data: z.array(itemSchema),
    meta: z.object({
      total: z.number().int().nonnegative(),
      page: z.number().int().positive(),
      hasMore: z.boolean(),
    })
  })

export const errorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  })
})

// Update jsonResponse helper
export const errorJsonResponse = (description: string, code: string) =>
  jsonResponse(description, errorSchema)
```

### 2. Standardized Error Codes

```typescript
export const ERROR_CODES = {
  UNAUTHENTICATED: "unauthenticated",
  VALIDATION_FAILED: "validation_failed",
  NOT_FOUND: "not_found",
  INTERNAL_ERROR: "internal_error",
  TIMEOUT: "timeout",
  HEALTH_CHECK_FAILED: "health_check_failed",
} as const
```

### 3. Migration Pattern

For each route file:

1. **Update response schemas** - wrap in `dataSchema()` or `paginatedSchema()`
2. **Update route definitions** - use new error response format with error codes
3. **Update handlers** - return `successResponse()` or `errorResponse()`

### 4. Files to Modify

Backend:
- `apps/app-backend/src/lib/openapi.ts` - add helpers and error codes
- `apps/app-backend/src/modules/health/routes.ts`
- `apps/app-backend/src/app/api.ts` - /me route
- `apps/app-backend/src/modules/app-config/routes.ts`
- `apps/app-backend/src/modules/sandbox/routes.ts`
- `apps/app-backend/src/modules/entities/routes.ts`
- `apps/app-backend/src/modules/entity-schemas/routes.ts`
- `apps/app-backend/src/modules/entity-schemas/schemas.ts` - search response schema

Frontend:
- All API client code consuming these endpoints will need updates

## Migration Strategy

Since no external clients depend on this API:
1. Update all backend endpoints in one pass
2. Update frontend consumers to match
3. No versioning or backwards compatibility needed

## Benefits

1. **Consistency** - All responses follow same pattern
2. **Type Safety** - Easy to create discriminated unions in TypeScript
3. **Developer Experience** - Clients can always check `if (response.error)` or `if (response.data)`
4. **Industry Standard** - Pattern used by Stripe, Twilio, Shopify, SendGrid
5. **Future-Proof** - Easy to extend with additional metadata fields
6. **Better Error Handling** - Machine-readable error codes enable better UX

## Examples from Industry

- **Stripe**: `{data: {...}}` / `{error: {type: "...", message: "..."}}`
- **Twilio**: `{data: {...}}` / `{error: {code: 20003, message: "..."}}`
- **Shopify**: `{data: {...}}` / `{errors: {...}}`

## Success Criteria

- [ ] All endpoints return `{data: ...}` for success
- [ ] All endpoints return `{error: {code, message}}` for errors
- [ ] Pagination uses `{data: [...], meta: {...}}`
- [ ] OpenAPI spec validates correctly
- [ ] Frontend code updated and working
- [ ] No redundant field nesting (e.g., `config_value` wrapper removed)
