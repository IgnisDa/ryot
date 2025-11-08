# App Backend Cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove duplicated backend route and schema plumbing in `apps/app-backend` without changing API behavior.

**Architecture:** Extract small shared helpers where the codebase already has repeated access and validation-response patterns, then simplify the duplicated route modules to use them. Keep changes behavior-preserving, avoid new tests per user instruction, and verify with backend lint/typecheck after the refactor.

**Tech Stack:** TypeScript, Hono, Zod OpenAPI, Bun, Drizzle ORM

---

### Task 1: Shared access and route response helpers

**Files:**
- Modify: `apps/app-backend/src/lib/entity-schema-access.ts`
- Modify: `apps/app-backend/src/lib/openapi.ts`
- Modify: `apps/app-backend/src/modules/entities/routes.ts`
- Modify: `apps/app-backend/src/modules/events/routes.ts`
- Modify: `apps/app-backend/src/modules/event-schemas/routes.ts`
- Modify: `apps/app-backend/src/modules/entity-schemas/routes.ts`

**Step 1:** Extend `entity-schema-access.ts` with helpers that convert custom entity access failures into final API `{ status, body }` error results.

**Step 2:** Add a tiny OpenAPI helper for the repeated `resolveValidationResult(...)` early-return pattern.

**Step 3:** Replace duplicated per-route entity schema access wrappers and error mappers in `entities/routes.ts` and `event-schemas/routes.ts` with the new shared helpers.

**Step 4:** Use the same shared response helper in all touched routes so validation failures are returned consistently.

### Task 2: Consolidate schema-module property schema duplication

**Files:**
- Modify: `apps/app-backend/src/modules/property-schemas/schemas.ts`
- Modify: `apps/app-backend/src/modules/entity-schemas/schemas.ts`
- Modify: `apps/app-backend/src/modules/event-schemas/schemas.ts`
- Modify: `apps/app-backend/src/modules/entity-schemas/service.ts`
- Modify: `apps/app-backend/src/modules/event-schemas/service.ts`

**Step 1:** Reduce redundant property schema aliases/factories in `property-schemas/schemas.ts` to the minimum useful API surface.

**Step 2:** Give `entity-schemas` and `event-schemas` one shared pattern for labeled property-schema parsing and body schema construction.

**Step 3:** Update imports/usages so the two modules stay parallel without maintaining duplicate schema/service boilerplate.

### Task 3: Simplify facets route branching and repeated inline errors

**Files:**
- Modify: `apps/app-backend/src/modules/facets/routes.ts`

**Step 1:** Extract repeated facet error strings and repeated "refresh updated facet from visible list" behavior into local helpers.

**Step 2:** Simplify `updateFacetRoute` so enabled-only updates and config updates share the same smaller helpers instead of duplicating not-found and refresh logic.

**Step 3:** Remove unreachable/redundant validation branches that are already implied by earlier conditions.

### Task 4: Remove dead shared exports

**Files:**
- Modify: `apps/app-backend/src/lib/openapi.ts`

**Step 1:** Remove backend-unused exports that are not referenced anywhere in `apps/app-backend/src`.

**Step 2:** Verify that no touched backend files still import the removed symbols.

### Task 5: Verify the refactor

**Files:**
- Modify: none

**Step 1:** Run backend typecheck from `apps/app-backend`.

**Step 2:** Run backend lint from `apps/app-backend`.

**Step 3:** Review any failures, fix only issues caused by this refactor, and rerun verification.
