# Custom Entity Image And Uploads Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add nullable image support to custom entities and expose a placeholder generic uploads endpoint for presigned image upload URLs.

**Architecture:** Store entity images as a nullable source-aware JSON object on the `entity` row so both remote URLs and S3 object keys can share one field. Extend entity REST schemas, validation, repository selection, and create flow to read and write that object. Add a new authenticated `uploads` module with an OpenAPI-defined generic image upload endpoint that is intentionally not implemented yet.

**Tech Stack:** Bun, TypeScript, Hono, Zod OpenAPI, Drizzle ORM, PostgreSQL

---

## Task 1: Add service-level image validation tests

**Files:**
- Modify: `apps/app-backend/src/modules/entities/service.test.ts`

**Step 1: Write failing tests**

Add tests for:
- accepting `null` image input
- accepting `{ kind: "remote", url: "https://..." }`
- accepting `{ kind: "s3", key: "uploads/entities/..." }`
- rejecting unsupported image kinds
- rejecting invalid remote URLs
- returning normalized `image` from `resolveEntityCreateInput`

**Step 2: Run test to verify it fails**

Run: `bun test 'src/modules/entities/service.test.ts'`

**Step 3: Implement minimal validation code**

Update `apps/app-backend/src/modules/entities/service.ts` to parse and normalize the new image payload.

**Step 4: Run test to verify it passes**

Run: `bun test 'src/modules/entities/service.test.ts'`

---

## Task 2: Add entity API schema and persistence support

**Files:**
- Modify: `apps/app-backend/src/modules/entities/schemas.ts`
- Modify: `apps/app-backend/src/modules/entities/service.ts`
- Modify: `apps/app-backend/src/modules/entities/repository.ts`
- Modify: `apps/app-backend/src/modules/entities/routes.ts`
- Modify: `apps/app-backend/src/lib/db/schema/tables.ts`
- Create/Update generated migration files under `apps/app-backend/drizzle/`

**Step 1: Extend OpenAPI and route inputs**

Add a reusable entity image schema and include it on list/get/create entity payloads.

**Step 2: Extend repository selection and insert values**

Select and persist the nullable `image` field in repository helpers.

**Step 3: Add database column and migration**

Add nullable `jsonb` `image` column to `entity` and generate the matching Drizzle migration.

**Step 4: Run targeted checks**

Run: `bun test 'src/modules/entities/service.test.ts'`

---

## Task 3: Add uploads module with placeholder endpoint

**Files:**
- Create: `apps/app-backend/src/modules/uploads/routes.ts`
- Create: `apps/app-backend/src/modules/uploads/schemas.ts`
- Modify: `apps/app-backend/src/app/api.ts`

**Step 1: Add failing route/schema test if practical, otherwise rely on typecheck**

Define the response schema for an authenticated generic presigned image upload endpoint.

**Step 2: Implement route shell**

Add `POST /uploads/images/presigned` with correct OpenAPI metadata and a placeholder `501 Not implemented` handler.

**Step 3: Wire module into the API tree**

Register the new `uploadsApi` in `apps/app-backend/src/app/api.ts`.

---

## Task 4: Verify integration

**Files:**
- Verify only

**Step 1: Run targeted tests**

Run: `bun test 'src/modules/entities/service.test.ts'`

**Step 2: Run backend typecheck**

Run: `bun run typecheck`

**Step 3: Review API surface**

Confirm:
- entity list/get/create include nullable `image`
- uploads route appears in OpenAPI
- migration adds nullable `image` column
