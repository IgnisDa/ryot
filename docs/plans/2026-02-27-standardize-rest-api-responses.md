# REST API Response Standardization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Standardize all REST API responses to use consistent envelope structure with `{data}` for success and `{error: {code, message}}` for errors.

**Architecture:** Add helper functions to lib/openapi.ts for response wrapping, update all route handlers to use new helpers, modify OpenAPI schemas to reflect new structure, clean up redundant field nesting.

**Tech Stack:** TypeScript, Hono, Zod, OpenAPI

---

## Task 1: Add Core Helper Functions and Types

**Files:**
- Modify: `apps/app-backend/src/lib/openapi.ts`

**Step 1: Add standardized error codes constant**

Add after the existing imports:

```typescript
export const ERROR_CODES = {
	UNAUTHENTICATED: "unauthenticated",
	VALIDATION_FAILED: "validation_failed",
	NOT_FOUND: "not_found",
	INTERNAL_ERROR: "internal_error",
	TIMEOUT: "timeout",
	HEALTH_CHECK_FAILED: "health_check_failed",
} as const;
```

**Step 2: Add success response helper functions**

Add after ERROR_CODES:

```typescript
export const successResponse = <T>(data: T) => ({ data });

export const paginatedResponse = <T>(
	data: T[],
	meta: { total: number; page: number; hasMore: boolean },
) => ({ data, meta });
```

**Step 3: Add error response helper function**

Add after success helpers:

```typescript
export const errorResponse = (code: string, message: string) => ({
	error: { code, message },
});
```

**Step 4: Add schema helper functions**

Add after response helpers:

```typescript
export const dataSchema = <T extends z.ZodType>(schema: T) =>
	z.object({ data: schema });

export const paginatedSchema = <T extends z.ZodType>(itemSchema: T) =>
	z.object({
		data: z.array(itemSchema),
		meta: z.object({
			total: z.number().int().nonnegative(),
			page: z.number().int().positive(),
			hasMore: z.boolean(),
		}),
	});

export const errorSchema = z.object({
	error: z.object({
		code: z.string(),
		message: z.string(),
	}),
});
```

**Step 5: Update errorJsonResponse helper**

Replace the existing `errorJsonResponse` function with:

```typescript
export const errorJsonResponse = (description: string, code: string) =>
	jsonResponse(description, errorSchema);
```

**Step 6: Run type check**

Run: `bun run turbo typecheck --filter=@ryot/app-backend`
Expected: PASS

**Step 7: Commit**

```bash
git add 'apps/app-backend/src/lib/openapi.ts'
git commit -m 'feat(backend): add standardized response helpers and error codes

Add helper functions for consistent API response structure:
- successResponse() and paginatedResponse() for success responses
- errorResponse() for error responses with code and message
- dataSchema(), paginatedSchema(), errorSchema() for OpenAPI schemas
- ERROR_CODES constant for standardized error codes'
```

---

## Task 2: Update Health Route

**Files:**
- Modify: `apps/app-backend/src/modules/health/routes.ts`

**Step 1: Update imports**

Update the import from ~/lib/openapi to include new helpers:

```typescript
import { dataSchema, errorJsonResponse, ERROR_CODES, errorResponse, jsonResponse, successResponse } from "~/lib/openapi";
```

**Step 2: Update healthResponseSchema**

Replace the healthResponseSchema definition:

```typescript
const healthResponseSchema = dataSchema(z.object({
	status: z.literal("healthy"),
}));
```

**Step 3: Update route responses**

Update the responses in healthRoute:

```typescript
responses: {
	503: errorJsonResponse("Database or Redis checks failed", ERROR_CODES.HEALTH_CHECK_FAILED),
	200: jsonResponse("Database and Redis checks passed", healthResponseSchema),
},
```

**Step 4: Update error responses in handler**

Update the first error response (database check):

```typescript
return c.json(
	errorResponse(
		ERROR_CODES.HEALTH_CHECK_FAILED,
		`Database check failed: ${error instanceof Error ? error.message : "Unknown error"}`,
	),
	503,
);
```

Update the second error response (redis check):

```typescript
return c.json(
	errorResponse(
		ERROR_CODES.HEALTH_CHECK_FAILED,
		`Redis check failed: ${error instanceof Error ? error.message : "Unknown error"}`,
	),
	503,
);
```

**Step 5: Update success response**

Replace the success return statement:

```typescript
return c.json(successResponse({ status: "healthy" as const }), 200);
```

**Step 6: Run type check**

Run: `bun run turbo typecheck --filter=@ryot/app-backend`
Expected: PASS

**Step 7: Commit**

```bash
git add 'apps/app-backend/src/modules/health/routes.ts'
git commit -m 'feat(backend): standardize health endpoint responses

Update health check endpoint to use new response format:
- Success: {data: {status: "healthy"}}
- Error: {error: {code: "health_check_failed", message: "..."}}'
```

---

## Task 3: Update /me Route

**Files:**
- Modify: `apps/app-backend/src/app/api.ts`

**Step 1: Update imports**

Update the import from ~/lib/openapi:

```typescript
import {
	createAuthRoute,
	dataSchema,
	errorJsonResponse,
	ERROR_CODES,
	jsonResponse,
	successResponse,
} from "~/lib/openapi";
```

**Step 2: Update meResponseSchema**

Replace meResponseSchema:

```typescript
const meResponseSchema = dataSchema(z.object({
	user: z.unknown(),
	session: z.unknown().nullable(),
}));
```

**Step 3: Update route responses**

Update the responses in meRoute:

```typescript
responses: {
	401: errorJsonResponse("Request is unauthenticated", ERROR_CODES.UNAUTHENTICATED),
	200: jsonResponse("Authenticated session details", meResponseSchema),
},
```

**Step 4: Update handler success response**

Replace the handler's return statement:

```typescript
return c.json(successResponse({ user, session }), 200);
```

**Step 5: Run type check**

Run: `bun run turbo typecheck --filter=@ryot/app-backend`
Expected: PASS

**Step 6: Commit**

```bash
git add 'apps/app-backend/src/app/api.ts'
git commit -m 'feat(backend): standardize /me endpoint response

Update /me endpoint to use new response format:
- Success: {data: {user: ..., session: ...}}
- Error: {error: {code: "unauthenticated", message: "..."}}'
```

---

## Task 4: Update App Config Route

**Files:**
- Modify: `apps/app-backend/src/modules/app-config/routes.ts`

**Step 1: Update imports**

Update the import from ~/lib/openapi:

```typescript
import {
	createAuthRoute,
	dataSchema,
	errorJsonResponse,
	ERROR_CODES,
	jsonResponse,
	payloadValidationErrorResponse,
	successResponse,
} from "~/lib/openapi";
```

**Step 2: Update setAppConfigResponseSchema**

Replace setAppConfigResponseSchema (removing the config_value wrapper):

```typescript
const setAppConfigResponseSchema = dataSchema(z.object({
	key: z.string(),
	updatedAt: z.string(),
	value: z.string().nullable(),
	updatedByUserId: z.string().nullable(),
}));
```

**Step 3: Update route responses**

Update the responses in setAppConfigRoute:

```typescript
responses: {
	400: payloadValidationErrorResponse,
	401: errorJsonResponse("Request is unauthenticated", ERROR_CODES.UNAUTHENTICATED),
	200: jsonResponse("Config value was saved", setAppConfigResponseSchema),
},
```

**Step 4: Update handler success response**

Replace the handler's return statement (removing config_value wrapper):

```typescript
return c.json(
	successResponse({
		...configValue,
		updatedAt: configValue.updatedAt.toISOString(),
	}),
	200,
);
```

**Step 5: Run type check**

Run: `bun run turbo typecheck --filter=@ryot/app-backend`
Expected: PASS

**Step 6: Commit**

```bash
git add 'apps/app-backend/src/modules/app-config/routes.ts'
git commit -m 'feat(backend): standardize app-config endpoint response

Update app-config/set endpoint to use new response format:
- Success: {data: {...}} (removed config_value wrapper)
- Error: {error: {code: "...", message: "..."}}'
```

---

## Task 5: Update Sandbox Route

**Files:**
- Modify: `apps/app-backend/src/modules/sandbox/routes.ts`

**Step 1: Update imports**

Update the import from ~/lib/openapi:

```typescript
import {
	createAuthRoute,
	dataSchema,
	errorJsonResponse,
	ERROR_CODES,
	jsonResponse,
	payloadValidationErrorResponse,
	successResponse,
} from "~/lib/openapi";
```

**Step 2: Update runSandboxResponseSchema**

Replace runSandboxResponseSchema (remove success field):

```typescript
const runSandboxResponseSchema = dataSchema(z.object({
	logs: z.string().optional(),
	error: z.string().optional(),
	value: z.unknown().optional(),
	durationMs: z.number().int().nonnegative(),
}));
```

**Step 3: Update route responses**

Update the responses in runSandboxRoute:

```typescript
responses: {
	400: payloadValidationErrorResponse,
	401: errorJsonResponse("Request is unauthenticated", ERROR_CODES.UNAUTHENTICATED),
	200: jsonResponse("Sandbox run completed", runSandboxResponseSchema),
},
```

**Step 4: Update handler success response**

Replace the handler's return statement (extract success field, wrap in successResponse):

```typescript
const { success, ...resultData } = result;
return c.json(
	successResponse({ ...resultData, durationMs: Date.now() - startedAt }),
	200,
);
```

**Step 5: Run type check**

Run: `bun run turbo typecheck --filter=@ryot/app-backend`
Expected: PASS

**Step 6: Commit**

```bash
git add 'apps/app-backend/src/modules/sandbox/routes.ts'
git commit -m 'feat(backend): standardize sandbox endpoint response

Update sandbox/run endpoint to use new response format:
- Success: {data: {logs, error, value, durationMs}} (removed success field)
- Error: {error: {code: "...", message: "..."}}'
```

---

## Task 6: Update Entities Route

**Files:**
- Modify: `apps/app-backend/src/modules/entities/routes.ts`

**Step 1: Update imports**

Update the import from ~/lib/openapi:

```typescript
import {
	createAuthRoute,
	dataSchema,
	errorJsonResponse,
	ERROR_CODES,
	errorResponse,
	jsonResponse,
	pathParamValidationErrorResponse,
	successResponse,
} from "~/lib/openapi";
```

**Step 2: Update foundEntityResponseSchema**

Replace foundEntityResponseSchema:

```typescript
const foundEntityResponseSchema = dataSchema(z.object({
	id: z.string(),
	name: z.string(),
	properties: z.unknown(),
	created_at: z.string(),
	updated_at: z.string(),
	schema_slug: z.string(),
	external_id: z.string(),
	details_script_id: z.string(),
}));
```

**Step 3: Update route responses**

Update the responses in entityRoute:

```typescript
responses: {
	400: pathParamValidationErrorResponse,
	401: errorJsonResponse("Request is unauthenticated", ERROR_CODES.UNAUTHENTICATED),
	404: errorJsonResponse("Entity does not exist for this user", ERROR_CODES.NOT_FOUND),
	200: jsonResponse("Entity was found", foundEntityResponseSchema),
},
```

**Step 4: Update handler error response**

Replace the 404 error response:

```typescript
if (!foundEntity)
	return c.json(errorResponse(ERROR_CODES.NOT_FOUND, "Entity not found"), 404);
```

**Step 5: Update handler success response**

Replace the success return statement:

```typescript
return c.json(
	successResponse({
		...foundEntity,
		created_at: foundEntity.created_at.toISOString(),
		updated_at: foundEntity.updated_at.toISOString(),
	}),
	200,
);
```

**Step 6: Run type check**

Run: `bun run turbo typecheck --filter=@ryot/app-backend`
Expected: PASS

**Step 7: Commit**

```bash
git add 'apps/app-backend/src/modules/entities/routes.ts'
git commit -m 'feat(backend): standardize entities endpoint response

Update entities/{entityId} endpoint to use new response format:
- Success: {data: {id, name, ...}}
- Error: {error: {code: "not_found", message: "..."}}'
```

---

## Task 7: Update Entity Schemas - List Route

**Files:**
- Modify: `apps/app-backend/src/modules/entity-schemas/routes.ts`

**Step 1: Update imports**

Update the import from ~/lib/openapi:

```typescript
import {
	createAuthRoute,
	dataSchema,
	errorJsonResponse,
	ERROR_CODES,
	errorResponse,
	jsonResponse,
	payloadValidationErrorResponse,
	successResponse,
} from "~/lib/openapi";
```

**Step 2: Update listEntitySchemasResponseSchema**

Replace listEntitySchemasResponseSchema (remove schemas wrapper):

```typescript
const listEntitySchemasResponseSchema = dataSchema(z.array(listedEntitySchema));
```

**Step 3: Update route responses**

Update the responses in listEntitySchemasRoute:

```typescript
responses: {
	401: errorJsonResponse("Request is unauthenticated", ERROR_CODES.UNAUTHENTICATED),
	200: jsonResponse(
		"Schemas available for the user",
		listEntitySchemasResponseSchema,
	),
},
```

**Step 4: Update handler success response**

Replace the handler's return statement (line 103):

```typescript
return c.json(successResponse(schemas), 200);
```

**Step 5: Run type check**

Run: `bun run turbo typecheck --filter=@ryot/app-backend`
Expected: PASS

**Step 6: Commit**

```bash
git add 'apps/app-backend/src/modules/entity-schemas/routes.ts'
git commit -m 'feat(backend): standardize entity-schemas/list endpoint response

Update entity-schemas/list endpoint to use new response format:
- Success: {data: [...]} (removed schemas wrapper, array directly in data)'
```

---

## Task 8: Update Entity Schemas Search Response Schema

**Files:**
- Modify: `apps/app-backend/src/modules/entity-schemas/schemas.ts`

**Step 1: Update imports**

Add to the existing imports:

```typescript
import {
	createImportEnvelopeSchema,
	nonEmptyTrimmedStringSchema,
	nullableIntSchema,
	nullableStringSchema,
	positiveIntSchema,
} from "~/lib/zod/base";
```

**Step 2: Update schemaSearchResponse**

Replace schemaSearchResponse (change to paginated format):

```typescript
export const schemaSearchItemSchema = z.object({
	title: z.string(),
	identifier: z.string(),
	image: nullableStringSchema.optional(),
	publish_year: nullableIntSchema.optional(),
});

export const schemaSearchResponse = z.object({
	data: z.array(schemaSearchItemSchema),
	meta: z.object({
		total: z.number().int().nonnegative(),
		page: z.number().int().positive(),
		hasMore: z.boolean(),
	}),
});
```

**Step 3: Run type check**

Run: `bun run turbo typecheck --filter=@ryot/app-backend`
Expected: PASS

**Step 4: Commit**

```bash
git add 'apps/app-backend/src/modules/entity-schemas/schemas.ts'
git commit -m 'feat(backend): update entity-schemas search response schema

Update search response schema to use paginated format:
- Changed from {details: {...}, items: [...]} to {data: [...], meta: {...}}'
```

---

## Task 9: Update Entity Schemas Search and Import Routes

**Files:**
- Modify: `apps/app-backend/src/modules/entity-schemas/routes.ts`

**Step 1: Update imports**

Update import from schemas to include new item schema:

```typescript
import {
	schemaImportBody,
	schemaSearchBody,
	schemaSearchItemSchema,
	schemaSearchResponse,
} from "./schemas";
```

Add paginatedResponse to openapi imports:

```typescript
import {
	createAuthRoute,
	dataSchema,
	errorJsonResponse,
	ERROR_CODES,
	errorResponse,
	jsonResponse,
	paginatedResponse,
	payloadValidationErrorResponse,
	successResponse,
} from "~/lib/openapi";
```

**Step 2: Update schemaImportResponseSchema**

Replace schemaImportResponseSchema:

```typescript
const schemaImportResponseSchema = dataSchema(z.object({
	created: z.boolean(),
	entityId: z.string(),
}));
```

**Step 3: Update search route responses**

Update the responses in searchEntitySchemasRoute:

```typescript
responses: {
	400: payloadValidationErrorResponse,
	404: errorJsonResponse("Search script is missing", ERROR_CODES.NOT_FOUND),
	401: errorJsonResponse("Request is unauthenticated", ERROR_CODES.UNAUTHENTICATED),
	504: errorJsonResponse("Search sandbox job timed out", ERROR_CODES.TIMEOUT),
	500: errorJsonResponse("Search execution or payload parsing failed", ERROR_CODES.INTERNAL_ERROR),
	200: jsonResponse(
		"Search results for the schema query",
		schemaSearchResponse,
	),
},
```

**Step 4: Update import route responses**

Update the responses in importEntitySchemasRoute:

```typescript
responses: {
	400: payloadValidationErrorResponse,
	401: errorJsonResponse("Request is unauthenticated", ERROR_CODES.UNAUTHENTICATED),
	404: errorJsonResponse("Details script is missing", ERROR_CODES.NOT_FOUND),
	504: errorJsonResponse("Import sandbox job timed out", ERROR_CODES.TIMEOUT),
	500: errorJsonResponse("Import execution or persistence failed", ERROR_CODES.INTERNAL_ERROR),
	200: jsonResponse("Entity import persisted", schemaImportResponseSchema),
},
```

**Step 5: Update search handler error responses**

Replace the search handler error responses (lines 111-113):

```typescript
if (!result.success) {
	if (result.status === 404)
		return c.json(errorResponse(ERROR_CODES.NOT_FOUND, result.error), 404);
	if (result.status === 504)
		return c.json(errorResponse(ERROR_CODES.TIMEOUT, result.error), 504);
	return c.json(errorResponse(ERROR_CODES.INTERNAL_ERROR, result.error), 500);
}
```

**Step 6: Update search handler success response**

Replace the search handler success response (line 116) - transform to paginated format:

```typescript
const { details, items } = result.data;
return c.json(
	paginatedResponse(items, {
		total: details.total_items,
		page: body.page,
		hasMore: details.next_page !== null,
	}),
	200,
);
```

**Step 7: Update import handler error responses**

Replace the import handler error responses (lines 124-126):

```typescript
if (!result.success) {
	if (result.status === 404)
		return c.json(errorResponse(ERROR_CODES.NOT_FOUND, result.error), 404);
	if (result.status === 504)
		return c.json(errorResponse(ERROR_CODES.TIMEOUT, result.error), 504);
	return c.json(errorResponse(ERROR_CODES.INTERNAL_ERROR, result.error), 500);
}
```

**Step 8: Update import handler success response**

Replace the import handler success response (line 129):

```typescript
return c.json(successResponse(result.data), 200);
```

**Step 9: Run type check**

Run: `bun run turbo typecheck --filter=@ryot/app-backend`
Expected: PASS

**Step 10: Commit**

```bash
git add 'apps/app-backend/src/modules/entity-schemas/routes.ts'
git commit -m 'feat(backend): standardize entity-schemas search and import responses

Update entity-schemas endpoints to use new response format:
- search: {data: [...], meta: {total, page, hasMore}}
- import: {data: {created, entityId}}
- errors: {error: {code: "...", message: "..."}}'
```

---

## Task 10: Update Auth Middleware Error Response

**Files:**
- Modify: `apps/app-backend/src/auth/middleware.ts`

**Step 1: Check current middleware implementation**

Read: `apps/app-backend/src/auth/middleware.ts`

**Step 2: Update imports**

Add to imports:

```typescript
import { errorResponse, ERROR_CODES } from "~/lib/openapi";
```

**Step 3: Update 401 error response**

Find any 401 error responses in the middleware and update to use errorResponse:

```typescript
return c.json(errorResponse(ERROR_CODES.UNAUTHENTICATED, "Authentication required"), 401);
```

**Step 4: Run type check**

Run: `bun run turbo typecheck --filter=@ryot/app-backend`
Expected: PASS

**Step 5: Commit**

```bash
git add 'apps/app-backend/src/auth/middleware.ts'
git commit -m 'feat(backend): standardize auth middleware error responses

Update authentication middleware to use new error response format:
- Error: {error: {code: "unauthenticated", message: "..."}}'
```

---

## Task 11: Test OpenAPI Spec Generation

**Files:**
- None (verification step)

**Step 1: Start backend server**

Run: `bun run --cwd apps/app-backend dev`
Expected: Server starts successfully on port 8000

**Step 2: Fetch OpenAPI spec**

Run: `curl -s http://localhost:8000/api/openapi.json | bun run -e 'const json = await Bun.stdin.json(); console.log(JSON.stringify(json, null, 2))' > /tmp/openapi-spec.json`
Expected: JSON file created

**Step 3: Verify response schemas**

Run: `cat /tmp/openapi-spec.json | grep -A 5 '"200"'`
Expected: All 200 responses have "data" field in schema

**Step 4: Verify error schemas**

Run: `cat /tmp/openapi-spec.json | grep -A 5 '"error"'`
Expected: All error responses have "error" object with "code" and "message" fields

**Step 5: Stop backend server**

Press Ctrl+C

**Step 6: Commit verification notes**

No commit needed (verification only)

---

## Task 12: Final Type Check and Build

**Files:**
- None (verification step)

**Step 1: Run full type check**

Run: `bun run turbo typecheck`
Expected: PASS with no errors

**Step 2: Run backend build**

Run: `bun run turbo build --filter=@ryot/app-backend`
Expected: Build succeeds

**Step 3: Run docs build**

Run: `bun run turbo build --filter=@ryot/docs`
Expected: Build succeeds

**Step 4: Create final commit if needed**

If any fixes were needed, commit them:

```bash
git add .
git commit -m 'fix(backend): address type check and build issues'
```

---

## Summary

This plan transforms all REST API responses to use a standardized envelope structure:

**Success Responses:**
- Single resource: `{data: T}`
- Collection: `{data: T[], meta: {total, page, hasMore}}`

**Error Responses:**
- All errors: `{error: {code: string, message: string}}`

**Modified Files:**
1. `lib/openapi.ts` - Core helpers and error codes
2. `modules/health/routes.ts` - Health endpoint
3. `app/api.ts` - /me endpoint
4. `modules/app-config/routes.ts` - App config endpoint
5. `modules/sandbox/routes.ts` - Sandbox endpoint
6. `modules/entities/routes.ts` - Entities endpoint
7. `modules/entity-schemas/routes.ts` - Entity schemas endpoints
8. `modules/entity-schemas/schemas.ts` - Search response schema
9. `auth/middleware.ts` - Auth error responses

**Key Changes:**
- Removed redundant field wrappers (config_value, schemas)
- Normalized pagination format (details/items → data/meta)
- Removed redundant success field from sandbox response
- Added machine-readable error codes to all error responses
- HTTP status codes indicate success/failure state
