# Generated Custom Event Logging Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add rewrite custom event logging so users can create and list schema-driven events for custom entities directly from the tracking page.

**Architecture:** Add a minimal backend `events` module that validates entity ownership, custom-schema access, event-schema compatibility, and event property payloads against stored app schemas. Add a matching frontend `events` feature that renders inline event lists per entity and a generated logging modal that reuses existing form primitives and event-schema queries.

**Tech Stack:** Hono, Drizzle ORM, Zod, `@ryot/ts-utils`, TanStack Query, TanStack Form, Mantine, Bun, Turbo

---

### Task 1: Add backend event service tests and implementation

**Files:**
- Create: `apps/app-backend/src/modules/events/service.test.ts`
- Create: `apps/app-backend/src/modules/events/service.ts`

**Step 1: Write the failing test**

Add pure Bun tests for:
- trimming `entityId` and `eventSchemaId`
- rejecting blank ids
- parsing `occurredAt` into a valid `Date`
- rejecting invalid `occurredAt`
- validating event `properties` from `propertiesSchema` with `fromAppSchema`
- building normalized create input

**Step 2: Run test to verify it fails**

Run: `bun test 'apps/app-backend/src/modules/events/service.test.ts'`
Expected: FAIL because `service.ts` does not exist yet.

**Step 3: Write minimal implementation**

Implement:
- `EventPropertiesShape`
- `resolveEventEntityId`
- `resolveEventSchemaId`
- `resolveOccurredAt`
- `parseEventProperties`
- `resolveEventCreateInput`

**Step 4: Run test to verify it passes**

Run: `bun test 'apps/app-backend/src/modules/events/service.test.ts'`
Expected: PASS.

**Step 5: Commit**

Skip because the user explicitly requested no git commits.

### Task 2: Add backend access tests and repository/routes wiring

**Files:**
- Create: `apps/app-backend/src/modules/events/access.test.ts`
- Create: `apps/app-backend/src/modules/events/repository.ts`
- Create: `apps/app-backend/src/modules/events/schemas.ts`
- Create: `apps/app-backend/src/modules/events/routes.ts`
- Modify: `apps/app-backend/src/app/api.ts`

**Step 1: Write the failing test**

Add pure Bun tests for an access resolver that returns:
- `not_found` when no entity scope row exists
- `builtin` when the target entity schema is built in
- `event_schema_mismatch` when the event schema belongs to another entity schema
- success when the scope row is custom and aligned

**Step 2: Run test to verify it fails**

Run: `bun test 'apps/app-backend/src/modules/events/access.test.ts'`
Expected: FAIL because the resolver does not exist yet.

**Step 3: Write minimal implementation**

Implement:
- repository list/create helpers against the existing `event` table
- joined scope lookup for entity + entity schema + event schema
- route schemas for list/create responses
- list/create handlers using `resolveValidationResult`
- register `/events` in `apps/app-backend/src/app/api.ts`

**Step 4: Run tests to verify they pass**

Run: `bun test 'apps/app-backend/src/modules/events/access.test.ts' 'apps/app-backend/src/modules/events/service.test.ts'`
Expected: PASS.

**Step 5: Commit**

Skip because the user explicitly requested no git commits.

### Task 3: Add frontend event model and form tests with minimal implementation

**Files:**
- Create: `apps/app-frontend/src/features/events/model.test.ts`
- Create: `apps/app-frontend/src/features/events/form.test.ts`
- Create: `apps/app-frontend/src/features/events/model.ts`
- Create: `apps/app-frontend/src/features/events/form.ts`
- Create: `apps/app-frontend/src/features/events/use-form.ts`

**Step 1: Write the failing test**

Add pure Bun tests for:
- sorting events by `occurredAt` descending and `createdAt` descending as a tiebreaker
- empty vs list view state
- default form values with current timestamp and first schema selection
- validation requiring schema selection and matching generated properties
- payload conversion trimming ids and preserving validated properties

**Step 2: Run test to verify it fails**

Run: `bun test 'apps/app-frontend/src/features/events/model.test.ts' 'apps/app-frontend/src/features/events/form.test.ts'`
Expected: FAIL because the feature files do not exist yet.

**Step 3: Write minimal implementation**

Implement:
- `AppEvent` and sort/view-state helpers
- generated event form schema from selected event schema
- default values and `toCreateEventPayload`
- form hook that rebuilds validators from the active event schema

**Step 4: Run tests to verify they pass**

Run: `bun test 'apps/app-frontend/src/features/events/model.test.ts' 'apps/app-frontend/src/features/events/form.test.ts'`
Expected: PASS.

**Step 5: Commit**

Skip because the user explicitly requested no git commits.

### Task 4: Add frontend hooks and inline tracking-page event UI

**Files:**
- Create: `apps/app-frontend/src/features/events/hooks.ts`
- Create: `apps/app-frontend/src/features/events/section.tsx`
- Modify: `apps/app-frontend/src/features/entities/section.tsx`
- Modify: `apps/app-frontend/src/routes/_protected/tracking/$facetSlug.tsx`
- Modify: generated or tracked frontend API typing files if required by the repo

**Step 1: Write the failing test**

Extend the form/model tests first if any missing state shape is discovered while wiring UI.

**Step 2: Run test to verify it fails**

Run the affected frontend Bun tests.
Expected: FAIL for the missing behavior you just added coverage for.

**Step 3: Write minimal implementation**

Implement:
- events query and create mutation hooks
- inline event list rendering per entity
- logging modal with event schema selector and generated fields
- `occurredAt` input with sensible default
- entity card integration without adding detail pages

**Step 4: Run tests to verify they pass**

Run the affected frontend Bun tests again.
Expected: PASS.

**Step 5: Commit**

Skip because the user explicitly requested no git commits.

### Task 5: Finish roadmap and full verification

**Files:**
- Modify: `docs/roadmap.md`

**Step 1: Update roadmap only if slice is complete**

Mark `Generated custom event logging` complete only after backend, frontend, and API wiring all work.

**Step 2: Run requested verification commands**

Run:
- `bun run turbo test --filter='@ryot/app-backend' --filter='@ryot/app-frontend'`
- `bun run turbo typecheck --filter='@ryot/app-backend' --filter='@ryot/app-frontend'`
- `bun run turbo build --filter='@ryot/app-backend' --filter='@ryot/app-frontend'`
- `bun run turbo lint --filter='@ryot/app-backend' --filter='@ryot/app-frontend'`

Expected: all commands pass.

**Step 3: Prepare completion summary**

Report:
- implemented backend and frontend slice
- files added and modified
- event logging UX
- tests added
- verification results
- intentionally deferred follow-up work

**Step 4: Commit**

Skip because the user explicitly requested no git commits.
