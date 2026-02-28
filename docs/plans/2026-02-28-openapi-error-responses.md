# OpenAPI Error Response System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement discriminated union-based error responses for improved OpenAPI documentation that shows exact error codes per endpoint.

**Architecture:** Extend `openapi.ts` with reusable common error schemas using Zod literals, factory functions to create discriminated unions, and helper functions for common error patterns. Maintain backward compatibility while enabling incremental migration.

**Tech Stack:** TypeScript, Zod, @hono/zod-openapi, Hono

---

## Task 1: Add Common Error Schemas

**Files:**
- Modify: `apps/app-backend/src/lib/openapi.ts:1-82`

**Step 1: Add error schema factory and common errors after ERROR_CODES**

Add after line 12 (after `ERROR_CODES` definition):

```typescript
const createErrorSchema = (code: string, name: string) =>
	z
		.object({
			code: z.literal(code),
			message: z.string(),
		})
		.openapi(name);

export const commonErrors = {
	notFound: createErrorSchema(ERROR_CODES.NOT_FOUND, "NotFoundError"),
	unauthenticated: createErrorSchema(
		ERROR_CODES.UNAUTHENTICATED,
		"UnauthenticatedError",
	),
	validationFailed: createErrorSchema(
		ERROR_CODES.VALIDATION_FAILED,
		"ValidationFailedError",
	),
	timeout: createErrorSchema(ERROR_CODES.TIMEOUT, "TimeoutError"),
	internalError: createErrorSchema(
		ERROR_CODES.INTERNAL_ERROR,
		"InternalServerError",
	),
	healthCheckFailed: createErrorSchema(
		ERROR_CODES.HEALTH_CHECK_FAILED,
		"HealthCheckFailedError",
	),
} as const;
```

**Step 2: Verify types are correct**

Run: `bun run turbo typecheck --filter=@ryot/app-backend`
Expected: No type errors

**Step 3: Commit**

```bash
git add 'apps/app-backend/src/lib/openapi.ts'
git commit -m 'feat(openapi): add common error schemas with discriminated unions'
```

---

## Task 2: Add Error Union Factory Function

**Files:**
- Modify: `apps/app-backend/src/lib/openapi.ts`

**Step 1: Add createErrorUnion factory function**

Add after the `commonErrors` definition:

```typescript
export const createErrorUnion = <T extends z.ZodTypeAny[]>(...errors: T) => {
	if (errors.length === 1) {
		return errors[0];
	}
	return z.discriminatedUnion("code", errors as any);
};
```

**Step 2: Verify types are correct**

Run: `bun run turbo typecheck --filter=@ryot/app-backend`
Expected: No type errors

**Step 3: Commit**

```bash
git add 'apps/app-backend/src/lib/openapi.ts'
git commit -m 'feat(openapi): add error union factory function'
```

---

## Task 3: Add Error Response Helper

**Files:**
- Modify: `apps/app-backend/src/lib/openapi.ts`

**Step 1: Add createErrorResponse helper function**

Add after the `createErrorUnion` function:

```typescript
export const createErrorResponse = (
	description: string,
	...errors: z.ZodObject<any>[]
) => {
	const errorUnion = createErrorUnion(...errors);
	const schema = z.object({ error: errorUnion });
	return jsonResponse(description, schema);
};
```

**Step 2: Verify types are correct**

Run: `bun run turbo typecheck --filter=@ryot/app-backend`
Expected: No type errors

**Step 3: Commit**

```bash
git add 'apps/app-backend/src/lib/openapi.ts'
git commit -m 'feat(openapi): add createErrorResponse helper'
```

---

## Task 4: Add Common Response Helper Functions

**Files:**
- Modify: `apps/app-backend/src/lib/openapi.ts`

**Step 1: Add helper functions for common error responses**

Add after the `createErrorResponse` function:

```typescript
export const unauthenticatedResponse = () =>
	createErrorResponse(
		"Request is unauthenticated",
		commonErrors.unauthenticated,
	);

export const notFoundResponse = (description = "Resource not found") =>
	createErrorResponse(description, commonErrors.notFound);

export const validationErrorResponse = (description = "Validation failed") =>
	createErrorResponse(description, commonErrors.validationFailed);

export const pathParamErrorResponse = () =>
	validationErrorResponse("Path parameter validation failed");

export const payloadErrorResponse = () =>
	validationErrorResponse("Request payload validation failed");
```

**Step 2: Verify types are correct**

Run: `bun run turbo typecheck --filter=@ryot/app-backend`
Expected: No type errors

**Step 3: Commit**

```bash
git add 'apps/app-backend/src/lib/openapi.ts'
git commit -m 'feat(openapi): add common error response helpers'
```

---

## Task 5: Add Deprecation Comments to Old Functions

**Files:**
- Modify: `apps/app-backend/src/lib/openapi.ts`

**Step 1: Add deprecation comments to existing error functions**

Update the `errorJsonResponse`, `payloadValidationErrorResponse`, and `pathParamValidationErrorResponse` functions with deprecation comments:

```typescript
/**
 * @deprecated Use createErrorResponse() with commonErrors instead.
 * This function will be removed in a future version.
 * Example: createErrorResponse('Description', commonErrors.notFound)
 */
export const errorJsonResponse = (description: string, _code: string) =>
	jsonResponse(description, errorSchema);

/**
 * @deprecated Use payloadErrorResponse() instead.
 * This function will be removed in a future version.
 */
export const payloadValidationErrorResponse = errorJsonResponse(
	"Request payload validation failed",
	ERROR_CODES.VALIDATION_FAILED,
);

/**
 * @deprecated Use pathParamErrorResponse() instead.
 * This function will be removed in a future version.
 */
export const pathParamValidationErrorResponse = errorJsonResponse(
	"Path parameter validation failed",
	ERROR_CODES.VALIDATION_FAILED,
);
```

**Step 2: Verify types are correct**

Run: `bun run turbo typecheck --filter=@ryot/app-backend`
Expected: No type errors

**Step 3: Commit**

```bash
git add 'apps/app-backend/src/lib/openapi.ts'
git commit -m 'docs(openapi): deprecate old error response functions'
```

---

## Task 6: Migrate entities/routes.ts to New Error System

**Files:**
- Modify: `apps/app-backend/src/modules/entities/routes.ts:1-96`

**Step 1: Update imports**

Replace the imports on lines 6-15 with:

```typescript
import {
	createAuthRoute,
	dataSchema,
	jsonResponse,
	notFoundResponse,
	pathParamErrorResponse,
	successResponse,
	unauthenticatedResponse,
} from "~/lib/openapi";
```

**Step 2: Update error responses in the route definition**

Replace lines 54-63 with:

```typescript
		400: pathParamErrorResponse(),
		401: unauthenticatedResponse(),
		404: notFoundResponse("Entity does not exist for this user"),
```

**Step 3: Verify types are correct**

Run: `bun run turbo typecheck --filter=@ryot/app-backend`
Expected: No type errors

**Step 4: Start backend to verify OpenAPI generation**

Run: `bun run turbo dev --filter=@ryot/app-backend`
Expected: Server starts without errors

**Step 5: Check OpenAPI documentation**

Visit the OpenAPI docs endpoint (usually `/doc` or similar) and verify that the error responses now show discriminated unions with specific error codes.

Expected: The 404 response should show a discriminator with `code` property having enum value `["not_found"]`

**Step 6: Stop the backend server**

Stop the running dev server.

**Step 7: Commit**

```bash
git add 'apps/app-backend/src/modules/entities/routes.ts'
git commit -m 'refactor(entities): migrate to new error response system'
```

---

## Task 7: Migrate sandbox/routes.ts to New Error System

**Files:**
- Modify: `apps/app-backend/src/modules/sandbox/routes.ts:1-72`

**Step 1: Update imports**

Replace the imports on lines 3-11 with:

```typescript
import {
	createAuthRoute,
	dataSchema,
	jsonResponse,
	payloadErrorResponse,
	successResponse,
	unauthenticatedResponse,
} from "~/lib/openapi";
```

**Step 2: Update error responses in the route definition**

Replace lines 42-46 with:

```typescript
		400: payloadErrorResponse(),
		401: unauthenticatedResponse(),
```

**Step 3: Verify types are correct**

Run: `bun run turbo typecheck --filter=@ryot/app-backend`
Expected: No type errors

**Step 4: Commit**

```bash
git add 'apps/app-backend/src/modules/sandbox/routes.ts'
git commit -m 'refactor(sandbox): migrate to new error response system'
```

---

## Task 8: Find and Migrate Remaining Routes

**Files:**
- Check: `apps/app-backend/src/modules/entity-schemas/routes.ts`
- Check: `apps/app-backend/src/modules/app-config/routes.ts`
- Check: `apps/app-backend/src/modules/health/routes.ts`

**Step 1: Search for remaining usages of old error functions**

Run: `grep -r "errorJsonResponse\|pathParamValidationErrorResponse\|payloadValidationErrorResponse" apps/app-backend/src/modules --include="*.ts"`

Expected: List of files still using old error response functions

**Step 2: For each file found, repeat the migration pattern**

For each file:
1. Update imports to use new helper functions
2. Replace old error responses with new ones
3. Run typecheck
4. Commit with message: `refactor(<module>): migrate to new error response system`

**Step 3: Verify no old usages remain**

Run: `grep -r "errorJsonResponse\|pathParamValidationErrorResponse\|payloadValidationErrorResponse" apps/app-backend/src/modules --include="*.ts"`

Expected: No results (or only results from comments/deprecation notices)

**Step 4: Commit if any changes**

```bash
git add 'apps/app-backend/src/modules/'
git commit -m 'refactor(modules): complete migration to new error response system'
```

---

## Task 9: Test OpenAPI Documentation Output

**Files:**
- Test: OpenAPI documentation endpoint

**Step 1: Start the backend server**

Run: `bun run turbo dev --filter=@ryot/app-backend`

Expected: Server starts successfully

**Step 2: Access the OpenAPI documentation**

Open browser and navigate to the OpenAPI docs endpoint (check the code for the exact path, likely `/doc` or `/openapi`)

**Step 3: Verify discriminated unions in error responses**

Check multiple endpoints and verify:
1. Error responses show `discriminator` with `propertyName: code`
2. Error codes are shown as enums with specific values (e.g., `["not_found"]`)
3. Each endpoint shows only the relevant error codes
4. Common errors reference the component schemas (e.g., `$ref: '#/components/schemas/NotFoundError'`)

Expected: All error responses show proper discriminated unions

**Step 4: Check components/schemas section**

Verify that the following schemas are registered:
- `NotFoundError`
- `UnauthenticatedError`
- `ValidationFailedError`
- `TimeoutError`
- `InternalServerError`
- `HealthCheckFailedError`

Expected: All common error schemas are present in components/schemas

**Step 5: Stop the server**

Stop the running dev server.

---

## Task 10: Run Full Typecheck and Build

**Files:**
- Test: All backend TypeScript files

**Step 1: Run typecheck**

Run: `bun run turbo typecheck --filter=@ryot/app-backend`

Expected: No type errors

**Step 2: Run build**

Run: `bun run turbo build --filter=@ryot/app-backend`

Expected: Build succeeds with no errors

**Step 3: Commit if any fixes needed**

If any fixes were needed during typecheck/build:

```bash
git add .
git commit -m 'fix(openapi): resolve typecheck and build issues'
```

---

## Task 11: Update Documentation (Optional)

**Files:**
- Check: `apps/docs/src/contributing.md` or similar documentation

**Step 1: Check if there's API development documentation**

Look for documentation about how to define routes or error responses.

**Step 2: Update documentation if found**

Add a section about the new error response system:

```markdown
## Error Responses

When defining error responses for OpenAPI routes, use the new discriminated union system:

### Common Errors

Use the pre-built helper functions for common error scenarios:

- `unauthenticatedResponse()` - 401 Unauthenticated
- `notFoundResponse(description?)` - 404 Not Found
- `validationErrorResponse(description?)` - 400 Validation Failed
- `pathParamErrorResponse()` - 400 Path Parameter Validation
- `payloadErrorResponse()` - 400 Payload Validation

Example:
\`\`\`typescript
responses: {
  401: unauthenticatedResponse(),
  404: notFoundResponse('Entity not found'),
}
\`\`\`

### Endpoint-Specific Errors

For endpoint-specific errors, use `createErrorResponse`:

\`\`\`typescript
const entityLocked = z.object({
  code: z.literal('entity_locked'),
  message: z.string(),
  lockedUntil: z.string().optional()
});

responses: {
  409: createErrorResponse(
    'Entity is locked',
    commonErrors.notFound,
    entityLocked
  )
}
\`\`\`

This generates proper OpenAPI discriminators showing exactly which error codes can occur.
```

**Step 3: Commit documentation updates**

```bash
git add 'apps/docs/src/contributing.md'
git commit -m 'docs: add error response system documentation'
```

---

## Task 12: Final Verification and Cleanup

**Files:**
- Review: All modified files

**Step 1: Review all changes**

Run: `git diff origin/main --stat`

Expected: List of changed files

**Step 2: Verify test suite still passes (if tests exist)**

Run: `bun run turbo test --filter=@ryot/app-backend`

Expected: All tests pass (or skip if no backend tests exist)

**Step 3: Create summary of changes**

Review the implementation and verify:
- [ ] Common error schemas defined and registered
- [ ] Factory functions for error composition created
- [ ] Helper functions for common patterns implemented
- [ ] All routes migrated to new system
- [ ] Old functions marked as deprecated
- [ ] OpenAPI docs show discriminated unions
- [ ] No type errors
- [ ] Build succeeds

**Step 4: Final commit if needed**

If any final cleanup is needed:

```bash
git add .
git commit -m 'chore(openapi): final cleanup for error response system'
```

---

## Success Criteria

- [ ] OpenAPI documentation shows discriminated unions for error responses
- [ ] Each endpoint's errors show specific error codes (not generic `string`)
- [ ] Common error schemas are registered in components/schemas
- [ ] All routes use new error response system
- [ ] No type errors in typecheck
- [ ] Build succeeds
- [ ] Backward compatibility maintained (old functions still work)
- [ ] Code follows project conventions (line length, formatting)

## Testing Checklist

- [ ] Start backend server successfully
- [ ] Access OpenAPI docs endpoint
- [ ] Verify error responses show discriminators
- [ ] Verify error codes show as enums with specific values
- [ ] Verify common errors reference component schemas
- [ ] All existing API functionality works unchanged

## Rollback Plan

If issues arise, rollback is simple:
1. Routes can continue using old error functions (they're not removed)
2. Revert commits in reverse order
3. The old error response format remains valid

## Notes

- The implementation maintains full backward compatibility
- Routes can be migrated incrementally
- The runtime error response format is unchanged - only OpenAPI docs improve
- Additional common errors can be added by extending `commonErrors` object
- Endpoint-specific errors are defined inline using Zod schemas
