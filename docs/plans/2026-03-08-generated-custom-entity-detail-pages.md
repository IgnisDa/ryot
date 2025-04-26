# Generated Custom Entity Detail Pages Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add the first generated custom-entity detail page so users can open a custom entity from a facet page and see schema-rendered properties plus event history.

**Architecture:** Keep the slice narrow and aligned with the rewrite: add a single custom-entity detail fetch on the backend, expose it through the existing OpenAPI-first entities module, and render it in a dedicated TanStack route under tracking. Reuse existing schema, event, and generated-field patterns; move display-only logic into pure helpers so coverage stays in Bun tests without any database-backed tests.

**Tech Stack:** Hono, Zod OpenAPI, Drizzle repositories, TanStack Router, TanStack Query, Mantine, Bun test, TypeScript

---

### Task 1: Backend entity detail access and contract

**Files:**
- Modify: `apps/app-backend/src/modules/entities/service.ts`
- Modify: `apps/app-backend/src/modules/entities/schemas.ts`
- Modify: `apps/app-backend/src/modules/entities/routes.ts`
- Modify: `apps/app-backend/src/modules/entities/repository.ts`
- Test: `apps/app-backend/src/modules/entities/service.test.ts`
- Create: `apps/app-backend/src/modules/entities/access.test.ts`

**Step 1: Write the failing tests**

Add pure tests for:
- resolving a trimmed entity id string
- resolving detail access for `undefined` scope -> `not_found`
- resolving detail access for built-in schema scope -> `builtin`
- resolving detail access for a custom schema scope -> success payload

**Step 2: Run test to verify it fails**

Run: `bun test 'src/modules/entities/service.test.ts' 'src/modules/entities/access.test.ts'`
Expected: FAIL because the new helpers and access logic do not exist yet.

**Step 3: Write minimal implementation**

Add:
- `resolveEntityId` in `apps/app-backend/src/modules/entities/service.ts`
- pure detail access resolver that reuses `resolveCustomEntitySchemaAccess`
- `GET /entities/{entityId}` schema in `apps/app-backend/src/modules/entities/schemas.ts`
- thin repository lookup joining `entity` to `entity_schema` so access rules mirror events
- route wiring in `apps/app-backend/src/modules/entities/routes.ts`

**Step 4: Run test to verify it passes**

Run: `bun test 'src/modules/entities/service.test.ts' 'src/modules/entities/access.test.ts'`
Expected: PASS

**Step 5: Do not commit**

User explicitly requested no commits for this branch.

### Task 2: Frontend detail models and reusable display helpers

**Files:**
- Modify: `apps/app-frontend/src/features/entities/model.ts`
- Modify: `apps/app-frontend/src/features/events/model.ts`
- Create: `apps/app-frontend/src/features/entities/detail.ts`
- Test: `apps/app-frontend/src/features/entities/model.test.ts`
- Create: `apps/app-frontend/src/features/entities/detail.test.ts`

**Step 1: Write the failing tests**

Add pure tests for:
- entity normalization helpers that convert API dates for detail responses
- property detail rows derived from an entity schema and entity properties
- omission of unsupported or missing generated properties from detail rendering
- event timeline selection helpers if any new pure helper is introduced

**Step 2: Run test to verify it fails**

Run: `bun test 'src/features/entities/model.test.ts' 'src/features/entities/detail.test.ts'`
Expected: FAIL because the new pure helpers do not exist yet.

**Step 3: Write minimal implementation**

Add pure helpers that:
- normalize a single entity payload the same way list entities are normalized
- produce schema-driven property rows for the detail page
- reuse existing event sorting helpers instead of duplicating timeline logic

**Step 4: Run test to verify it passes**

Run: `bun test 'src/features/entities/model.test.ts' 'src/features/entities/detail.test.ts'`
Expected: PASS

**Step 5: Do not commit**

User explicitly requested no commits for this branch.

### Task 3: Frontend hooks, navigation, and detail route

**Files:**
- Modify: `apps/app-frontend/src/features/entities/hooks.ts`
- Modify: `apps/app-frontend/src/features/entities/section.tsx`
- Modify: `apps/app-frontend/src/features/events/section.tsx`
- Create: `apps/app-frontend/src/routes/_protected/tracking/$facetSlug/entities/$entityId.tsx`
- Modify: `apps/app-frontend/src/routeTree.gen.ts` (only if generator does not refresh it during build)

**Step 1: Write the failing tests**

Prefer extending existing pure model tests instead of adding component tests. If a new pure formatter/helper is needed for the route, add its test before route code.

**Step 2: Run test to verify it fails**

Run: `bun test 'src/features/entities/model.test.ts' 'src/features/entities/detail.test.ts'`
Expected: FAIL if any new route-facing helper was added first.

**Step 3: Write minimal implementation**

Add:
- `useEntityQuery(entityId)` plus cache invalidation for detail fetches where needed
- link affordance from entity cards to `/tracking/$facetSlug/entities/$entityId`
- dedicated detail route that loads the facet, entity, entity schema, event schemas, and events
- schema-rendered property section and event history section
- clear empty/error states
- explicit note that generic relationships are deferred for now

**Step 4: Run test to verify it passes**

Run: `bun test 'src/features/entities/model.test.ts' 'src/features/entities/detail.test.ts'`
Expected: PASS

**Step 5: Do not commit**

User explicitly requested no commits for this branch.

### Task 4: Docs and verification

**Files:**
- Modify: `docs/roadmap.md`

**Step 1: Update docs after implementation is complete**

Mark generated custom entity detail pages done in `docs/roadmap.md` only if the route, backend fetch, and event history are all working.

**Step 2: Run focused package tests**

Run: `bun run turbo test --filter='@ryot/app-backend' --filter='@ryot/app-frontend'`
Expected: PASS

**Step 3: Run focused typechecking**

Run: `bun run turbo typecheck --filter='@ryot/app-backend' --filter='@ryot/app-frontend'`
Expected: PASS

**Step 4: Run extra verification warranted by route generation**

Run: `bun run turbo build --filter='@ryot/app-frontend'`
Expected: PASS and route generation stays consistent.

**Step 5: Do not commit**

User explicitly requested no commits for this branch.
