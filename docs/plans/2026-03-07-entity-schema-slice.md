# Entity Schema Slice Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add the first custom-tracker `entity_schema` slice so users can list and create schemas inside their own custom facets without touching event, entity, saved-view, or dashboard work.

**Architecture:** Add a small backend `entity-schemas` module on a top-level route with service-level validation for slug handling and minimal JSON Schema checks. On the frontend, add a small entity-schema feature module for form parsing and API hooks, then integrate it into the existing custom facet route while keeping built-in facets out of this flow.

**Tech Stack:** Hono, Zod, Drizzle ORM, React 19, TanStack Query, TanStack Router, Mantine, Bun test, Turbo

---

### Task 1: Backend entity-schema service helpers

**Files:**
- Create: `apps/app-backend/src/modules/entity-schemas/service.ts`
- Create: `apps/app-backend/src/modules/entity-schemas/service.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "bun:test";
import {
  parseEntitySchemaPropertiesSchema,
  resolveEntitySchemaCreateInput,
} from "./service";

describe("parseEntitySchemaPropertiesSchema", () => {
  it("accepts a minimal object schema", () => {
    expect(
      parseEntitySchemaPropertiesSchema('{"type":"object","properties":{}}'),
    ).toEqual({ type: "object", properties: {} });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test 'src/modules/entity-schemas/service.test.ts'`
Expected: FAIL with module not found or missing symbol errors.

**Step 3: Write minimal implementation**

Implement:

- `normalizeEntitySchemaSlug(slug: string)`
- `resolveEntitySchemaSlug({ name, slug })`
- `parseEntitySchemaPropertiesSchema(input: string | unknown)`
- `resolveEntitySchemaCreateInput({ name, slug, propertiesSchema })`

The parser must:

- accept JSON text or already-parsed values
- require an object root
- require `type === "object"`
- require `properties` to be an object

**Step 4: Run test to verify it passes**

Run: `bun test 'src/modules/entity-schemas/service.test.ts'`
Expected: PASS

**Step 5: Commit**

```bash
git add 'apps/app-backend/src/modules/entity-schemas/service.ts' 'apps/app-backend/src/modules/entity-schemas/service.test.ts'
git commit -m "feat: add entity schema validation helpers\n\nAttribution: OpenCode | Model: gpt-5.4"
```

### Task 2: Backend entity-schema repository and API routes

**Files:**
- Create: `apps/app-backend/src/modules/entity-schemas/repository.ts`
- Create: `apps/app-backend/src/modules/entity-schemas/schemas.ts`
- Create: `apps/app-backend/src/modules/entity-schemas/routes.ts`
- Modify: `apps/app-backend/src/app/api.ts`

**Step 1: Write the failing route contract first via type-safe route code**

Add route declarations for:

- `GET /entity-schemas?facetId=...`
- `POST /entity-schemas`

Use these response shapes:

```ts
z.object({
  id: z.string(),
  facetId: z.string(),
  slug: z.string(),
  name: z.string(),
  isBuiltin: z.boolean(),
  propertiesSchema: z.object({
    type: z.literal("object"),
    properties: z.record(z.string(), z.unknown()),
  }),
})
```

Expected compile errors until the repository and handler functions exist.

**Step 2: Run typecheck to verify it fails**

Run: `bun run tsc --noEmit`
Workdir: `apps/app-backend`
Expected: FAIL with missing imports or unresolved handlers.

**Step 3: Write minimal implementation**

Implement repository helpers:

- `getFacetScopeForEntitySchemas({ userId, facetId })`
- `listEntitySchemasByFacetForUser({ userId, facetId })`
- `getEntitySchemaBySlugForUser({ userId, slug })`
- `createEntitySchemaForUser({ userId, facetId, slug, name, propertiesSchema })`

Implement route behavior:

- `GET` returns `404` when the facet is missing or not user-owned
- `GET` returns `400` when the facet is built-in
- `POST` returns `404` when the facet is missing or not user-owned
- `POST` returns `400` when the facet is built-in
- `POST` returns `400` when slug already exists for the user
- `POST` returns created schema on success

Mount the new routes on the top-level `/entity-schemas` surface only.

**Step 4: Run backend tests and typecheck**

Run: `bun test 'src/modules/entity-schemas/service.test.ts' 'src/modules/facets/service.test.ts' && bun run tsc --noEmit`
Workdir: `apps/app-backend`
Expected: PASS

**Step 5: Commit**

```bash
git add 'apps/app-backend/src/modules/entity-schemas/repository.ts' 'apps/app-backend/src/modules/entity-schemas/schemas.ts' 'apps/app-backend/src/modules/entity-schemas/routes.ts' 'apps/app-backend/src/app/api.ts'
git commit -m "feat: add entity schema api routes\n\nAttribution: OpenCode | Model: gpt-5.4"
```

### Task 3: Frontend entity-schema form helpers

**Files:**
- Create: `apps/app-frontend/src/features/entity-schemas/form.ts`
- Create: `apps/app-frontend/src/features/entity-schemas/form.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "bun:test";
import {
  buildEntitySchemaFormValues,
  defaultEntitySchemaPropertiesSchema,
  toCreateEntitySchemaPayload,
} from "./form";

describe("entity schema form helpers", () => {
  it("builds default values with the schema stub", () => {
    expect(buildEntitySchemaFormValues().propertiesSchema)
      .toBe(defaultEntitySchemaPropertiesSchema);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test 'src/features/entity-schemas/form.test.ts'`
Expected: FAIL with module not found.

**Step 3: Write minimal implementation**

Implement:

- `defaultEntitySchemaPropertiesSchema = '{"type":"object","properties":{}}'`
- `createEntitySchemaFormSchema`
- `buildEntitySchemaFormValues()`
- `toCreateEntitySchemaPayload(input, facetId)`

Keep validation minimal and aligned with backend expectations.

**Step 4: Run test to verify it passes**

Run: `bun test 'src/features/entity-schemas/form.test.ts'`
Expected: PASS

**Step 5: Commit**

```bash
git add 'apps/app-frontend/src/features/entity-schemas/form.ts' 'apps/app-frontend/src/features/entity-schemas/form.test.ts'
git commit -m "feat: add entity schema form helpers for custom facets\n\nAttribution: OpenCode | Model: gpt-5.4"
```
