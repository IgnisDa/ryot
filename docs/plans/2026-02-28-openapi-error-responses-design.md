# OpenAPI Error Response Design

**Date:** 2026-02-28  
**Status:** Approved  
**Author:** AI Assistant

## Problem Statement

The current OpenAPI documentation for error responses in `@apps/app-backend` is cryptic and does not clearly show all the ways an API endpoint can fail. The error responses use a generic `errorSchema` with `code: string` and `message: string`, which doesn't communicate which specific error codes are possible for each endpoint.

### Current Issues

1. **Generic Error Schema:** All error responses use the same generic schema with `code: string`, providing no information about which error codes actually occur
2. **Poor Documentation:** OpenAPI docs don't show discriminated unions or specific error types per endpoint
3. **Lack of Type Safety:** No way to enforce or document which errors are valid for specific endpoints
4. **Code Duplication:** Common errors are redefined across multiple routes

### Example of Current Problem

```yaml
# Current OpenAPI output - not helpful
404:
  description: Entity does not exist for this user
  content:
    application/json:
      schema:
        type: object
        properties:
          error:
            type: object
            properties:
              code:
                type: string  # Could be anything!
              message:
                type: string
```

## Solution Overview

Implement a discriminated union-based error response system using Zod's type safety features and OpenAPI's discriminator support. This will:

- Define common errors as reusable Zod schemas with literal code values
- Use discriminated unions to specify exact error types per endpoint
- Provide factory functions to compose common and endpoint-specific errors
- Generate clear OpenAPI documentation with discriminators

## Architecture

### File Structure

All changes will be in a single file:
```
apps/app-backend/src/lib/
  openapi.ts (extended with new error system)
```

### Key Components

1. **Common Error Schemas:** Reusable Zod objects for common errors (not_found, unauthenticated, etc.)
2. **Error Union Factory:** Function to create discriminated unions from multiple error schemas
3. **Response Helpers:** Convenience functions for common error response patterns
4. **Backward Compatibility:** Keep existing functions for gradual migration

## Detailed Design

### 1. Error Schema Definitions

Common errors will be defined using a factory function and registered as OpenAPI components:

```typescript
// Base error creator function
const createErrorSchema = (code: string, name: string) => 
  z.object({
    code: z.literal(code),
    message: z.string()
  }).openapi(name);

// Common error definitions
export const commonErrors = {
  notFound: createErrorSchema(ERROR_CODES.NOT_FOUND, 'NotFoundError'),
  unauthenticated: createErrorSchema(ERROR_CODES.UNAUTHENTICATED, 'UnauthenticatedError'),
  validationFailed: createErrorSchema(ERROR_CODES.VALIDATION_FAILED, 'ValidationFailedError'),
  timeout: createErrorSchema(ERROR_CODES.TIMEOUT, 'TimeoutError'),
  internalError: createErrorSchema(ERROR_CODES.INTERNAL_ERROR, 'InternalServerError'),
  healthCheckFailed: createErrorSchema(ERROR_CODES.HEALTH_CHECK_FAILED, 'HealthCheckFailedError'),
} as const;
```

**Benefits:**
- Each error is a registered OpenAPI component (DRY principle)
- Type-safe with literal codes using `z.literal()`
- Can be referenced across multiple endpoints
- Easy to extend with additional fields per error type

**Generated OpenAPI:**
```yaml
components:
  schemas:
    NotFoundError:
      type: object
      properties:
        code:
          type: string
          enum: [not_found]
        message:
          type: string
      required: [code, message]
```

### 2. Error Composition & Factory Functions

#### Core Factory Function

```typescript
// Creates a discriminated union from error schemas
export const createErrorUnion = <T extends z.ZodTypeAny[]>(...errors: T) => {
  if (errors.length === 1) {
    return errors[0];
  }
  return z.discriminatedUnion('code', errors as any);
};
```

#### Response Helper

```typescript
// Creates an error response with discriminated union
export const createErrorResponse = (
  description: string,
  ...errors: z.ZodObject<any>[]
) => {
  const errorUnion = createErrorUnion(...errors);
  const schema = z.object({ error: errorUnion });
  return jsonResponse(description, schema);
};
```

#### Common Response Helpers

Pre-built helpers for frequently used error combinations:

```typescript
// 401 Unauthenticated
export const unauthenticatedResponse = () =>
  createErrorResponse('Request is unauthenticated', commonErrors.unauthenticated);

// 404 Not Found  
export const notFoundResponse = (description = 'Resource not found') =>
  createErrorResponse(description, commonErrors.notFound);

// 400 Validation Failed
export const validationErrorResponse = (description = 'Validation failed') =>
  createErrorResponse(description, commonErrors.validationFailed);

// 400 Path Param Validation
export const pathParamErrorResponse = () =>
  validationErrorResponse('Path parameter validation failed');

// 400 Payload Validation
export const payloadErrorResponse = () =>
  validationErrorResponse('Request payload validation failed');
```

### 3. Usage Examples

#### Simple Case - Single Error

```typescript
responses: {
  401: unauthenticatedResponse(),
  404: notFoundResponse('Entity does not exist for this user')
}
```

#### Complex Case - Multiple Errors for One Status Code

```typescript
// Define endpoint-specific error
const entityLocked = z.object({
  code: z.literal('entity_locked'),
  message: z.string(),
  lockedUntil: z.string().optional()
});

responses: {
  400: createErrorResponse(
    'Bad request',
    commonErrors.validationFailed,
    entityLocked
  )
}
```

#### Generated OpenAPI Output

```yaml
responses:
  400:
    description: Bad request
    content:
      application/json:
        schema:
          type: object
          properties:
            error:
              discriminator:
                propertyName: code
              oneOf:
                - $ref: '#/components/schemas/ValidationFailedError'
                - type: object
                  properties:
                    code:
                      type: string
                      enum: [entity_locked]
                    message:
                      type: string
                    lockedUntil:
                      type: string
```

### 4. Migration Strategy

#### Backward Compatibility

Existing error response functions will be kept with deprecation comments:

```typescript
// DEPRECATED: Old error response helpers - kept for backward compatibility
// These will be removed in a future version
export const errorJsonResponse = (description: string, _code: string) =>
  jsonResponse(description, errorSchema);

export const payloadValidationErrorResponse = errorJsonResponse(
  "Request payload validation failed",
  ERROR_CODES.VALIDATION_FAILED,
);

export const pathParamValidationErrorResponse = errorJsonResponse(
  "Path parameter validation failed",
  ERROR_CODES.VALIDATION_FAILED,
);
```

#### Migration Path

Routes can be migrated incrementally without breaking changes:

**Before:**
```typescript
const entityRoute = createRoute({
  responses: {
    400: pathParamValidationErrorResponse,
    401: errorJsonResponse('Request is unauthenticated', ERROR_CODES.UNAUTHENTICATED),
    404: errorJsonResponse('Entity does not exist', ERROR_CODES.NOT_FOUND),
  }
});
```

**After:**
```typescript
const entityRoute = createRoute({
  responses: {
    400: pathParamErrorResponse(),
    401: unauthenticatedResponse(),
    404: notFoundResponse('Entity does not exist for this user'),
  }
});
```

#### Migration Checklist (per route)

1. Replace `errorJsonResponse()` with new helpers or `createErrorResponse()`
2. Update error handling code to use specific error codes from `ERROR_CODES`
3. Test that OpenAPI docs show discriminated union
4. Verify runtime behavior unchanged

#### No Breaking Changes

- Existing routes continue to work as-is
- Old error response format (with generic `code: string`) still generated
- Runtime behavior unchanged - only OpenAPI documentation improves
- Teams can migrate routes at their own pace

## Benefits

### For Developers

1. **Type Safety:** TypeScript knows exactly which error codes are possible per endpoint
2. **DRY Principle:** Common errors defined once and reused
3. **Clear API:** Simple, readable functions for defining error responses
4. **Flexibility:** Easy to add endpoint-specific errors alongside common ones

### For API Consumers

1. **Clear Documentation:** OpenAPI docs show exactly which error codes can occur
2. **Discriminators:** Proper OpenAPI discriminator support for better code generation
3. **Predictability:** Know all possible error states before calling the API
4. **Type Generation:** API clients can generate proper types from OpenAPI spec

### For Maintenance

1. **Single Source of Truth:** Error definitions in one place
2. **Easy Extension:** Adding new common errors is straightforward
3. **Gradual Migration:** No need to update all routes at once
4. **Future Proof:** Architecture supports complex error scenarios

## Trade-offs & Considerations

### Pros

- Significantly better OpenAPI documentation
- Type-safe error handling
- No code duplication
- Backward compatible
- Flexible for endpoint-specific errors

### Cons

- Slightly more verbose than previous approach
- Requires defining errors upfront (but this is actually a benefit)
- Migration effort for existing routes (mitigated by backward compatibility)

### Decision Rationale

We chose this approach because:

1. **Best OpenAPI Output:** Generates proper discriminators and clear documentation
2. **Most Flexible:** Easy to add common OR endpoint-specific errors
3. **Type-Safe:** TypeScript will know exactly which error codes are possible
4. **Maintainable:** Common errors defined once, reused everywhere
5. **Future-Proof:** Easy to extend with new error types

Alternative approaches were considered:
- Status-code-grouped errors (too rigid, can't handle endpoint-specific errors)
- Composition with helpers (more complex API, less clear)

## Implementation Notes

### Adding New Common Errors

To add a new common error:

```typescript
export const commonErrors = {
  // ... existing errors
  newError: createErrorSchema(ERROR_CODES.NEW_ERROR, 'NewErrorName'),
};
```

### Adding Endpoint-Specific Errors

For endpoint-specific errors, define them inline:

```typescript
const mySpecificError = z.object({
  code: z.literal('my_specific_error'),
  message: z.string(),
  additionalField: z.string().optional()
});

responses: {
  400: createErrorResponse(
    'Description',
    commonErrors.validationFailed,
    mySpecificError
  )
}
```

### Error Response Runtime Format

The actual error response format remains unchanged:

```json
{
  "error": {
    "code": "not_found",
    "message": "Entity not found"
  }
}
```

This ensures backward compatibility with existing API consumers.

## Success Criteria

1. **Documentation Clarity:** OpenAPI docs show specific error codes per endpoint
2. **Type Safety:** TypeScript infers correct error types
3. **No Breaking Changes:** Existing routes work without modification
4. **Migration Ease:** New system is easy to adopt
5. **Maintainability:** Adding new errors is straightforward

## Future Enhancements

Potential future improvements:

1. **Error Code Registry:** Auto-generate error code constants from schema definitions
2. **Error Response Validation:** Runtime validation of error responses in development
3. **Error Documentation:** Auto-generate error code documentation from schemas
4. **Error Tracking:** Integration with error monitoring tools using discriminated codes

## References

- [Hono Zod OpenAPI Documentation](https://github.com/honojs/middleware/tree/main/packages/zod-openapi)
- [Zod to OpenAPI](https://github.com/asteasolutions/zod-to-openapi)
- [OpenAPI 3.x Specification](https://swagger.io/specification/)
- [Discriminated Unions in TypeScript](https://www.typescriptlang.org/docs/handbook/unions-and-intersections.html#discriminating-unions)
