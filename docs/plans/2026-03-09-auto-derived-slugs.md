# Auto-Derived Slugs Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make slug fields auto-derive from the name field in the frontend while still allowing manual overrides, using the same slug normalization logic in frontend and backend.

**Architecture:** Move slug normalization and required-string helpers into `@ryot/ts-utils`, then add TanStack Form listener-based syncing from `name` to `slug` in the relevant frontend forms. Keep payload generation and backend validation behavior intact, but source them from the shared utility.

**Tech Stack:** TypeScript, Bun tests, TanStack Form, Zod, shared workspace package `@ryot/ts-utils`

---

### Task 1: Move slug utilities into the shared library

**Files:**
- Create: `libs/ts-utils/src/slug.ts`
- Modify: `libs/ts-utils/src/index.ts`
- Modify: `apps/app-backend/src/modules/facets/service.ts`
- Modify: `apps/app-backend/src/modules/entity-schemas/service.ts`
- Modify: `apps/app-backend/src/modules/event-schemas/service.ts`
- Modify: `apps/app-backend/src/modules/entities/service.ts`
- Modify: `apps/app-backend/src/modules/events/service.ts`
- Delete: `apps/app-backend/src/lib/slug.ts`

**Step 1: Write the failing test**

Add shared-library tests covering `normalizeSlug`, `resolveRequiredSlug`, and `resolveRequiredString` in `libs/ts-utils/src/slug.test.ts`.

**Step 2: Run test to verify it fails**

Run: `bun test 'libs/ts-utils/src/slug.test.ts'`
Expected: FAIL because the shared slug module does not exist yet.

**Step 3: Write minimal implementation**

Create `libs/ts-utils/src/slug.ts`, export the helpers from `libs/ts-utils/src/index.ts`, and update backend imports to `@ryot/ts-utils`.

**Step 4: Run test to verify it passes**

Run: `bun test 'libs/ts-utils/src/slug.test.ts'`
Expected: PASS.

**Step 5: Commit**

Do not commit unless the user explicitly requests it.

### Task 2: Add shared frontend slug-sync helpers for property schema forms

**Files:**
- Modify: `apps/app-frontend/src/features/property-schemas/form.ts`
- Modify: `apps/app-frontend/src/features/entity-schemas/form.test.ts`
- Modify: `apps/app-frontend/src/features/event-schemas/form.test.ts`

**Step 1: Write the failing test**

Add tests for a helper that decides the next slug based on current name, current slug, and the previous auto-derived slug. Cover empty slug, untouched derived slug, customized slug, and cleared name cases.

**Step 2: Run test to verify it fails**

Run: `bun test 'apps/app-frontend/src/features/entity-schemas/form.test.ts' 'apps/app-frontend/src/features/event-schemas/form.test.ts'`
Expected: FAIL because the helper is not implemented/exported yet.

**Step 3: Write minimal implementation**

Implement the helper in `apps/app-frontend/src/features/property-schemas/form.ts` using `normalizeSlug` from `@ryot/ts-utils`.

**Step 4: Run test to verify it passes**

Run: `bun test 'apps/app-frontend/src/features/entity-schemas/form.test.ts' 'apps/app-frontend/src/features/event-schemas/form.test.ts'`
Expected: PASS.

**Step 5: Commit**

Do not commit unless the user explicitly requests it.

### Task 3: Wire slug auto-derivation into entity and event schema create forms

**Files:**
- Modify: `apps/app-frontend/src/features/property-schemas/use-form.ts`
- Modify: `apps/app-frontend/src/features/event-schemas/section.tsx`
- Modify: `apps/app-frontend/src/routes/_protected/tracking/$facetSlug/index.tsx`

**Step 1: Write the failing test**

Prefer a focused form-hook test if practical; otherwise extend existing tests around the shared helper and verify the hook composes it correctly.

**Step 2: Run test to verify it fails**

Run the smallest relevant test target for the new hook behavior.
Expected: FAIL because the hook does not yet update slug from name.

**Step 3: Write minimal implementation**

Use TanStack Form `listeners.onChange` on the `name` field inside the shared property-schema form hook. Update `slug` only when the current slug is empty or still matches the last derived slug.

**Step 4: Run test to verify it passes**

Run the same focused test target.
Expected: PASS.

**Step 5: Commit**

Do not commit unless the user explicitly requests it.

### Task 4: Wire slug auto-derivation into the facet form

**Files:**
- Modify: `apps/app-frontend/src/features/facets/form.ts`
- Modify: `apps/app-frontend/src/features/facets/form.test.ts`
- Modify: `apps/app-frontend/src/features/facets/components/facet-form.tsx`

**Step 1: Write the failing test**

Add tests covering the same untouched-vs-customized slug behavior for facet-specific helpers.

**Step 2: Run test to verify it fails**

Run: `bun test 'apps/app-frontend/src/features/facets/form.test.ts'`
Expected: FAIL because the derivation helper is missing.

**Step 3: Write minimal implementation**

Add the helper in `apps/app-frontend/src/features/facets/form.ts` and use a `name` field listener in `apps/app-frontend/src/features/facets/components/facet-form.tsx` to keep slug synced until customized.

**Step 4: Run test to verify it passes**

Run: `bun test 'apps/app-frontend/src/features/facets/form.test.ts'`
Expected: PASS.

**Step 5: Commit**

Do not commit unless the user explicitly requests it.

### Task 5: Verify the end-to-end change set

**Files:**
- Modify: any files touched above if verification exposes issues

**Step 1: Run focused frontend tests**

Run: `bun test 'apps/app-frontend/src/features/facets/form.test.ts' 'apps/app-frontend/src/features/entity-schemas/form.test.ts' 'apps/app-frontend/src/features/event-schemas/form.test.ts' 'libs/ts-utils/src/slug.test.ts'`
Expected: PASS.

**Step 2: Run frontend typecheck through turbo**

Run: `bun run turbo typecheck --filter='@ryot/app-frontend' --filter='@ryot/ts-utils' --filter='@ryot/app-backend'`
Expected: PASS.

**Step 3: Run frontend lint if needed**

Run: `bun run turbo lint --filter='@ryot/app-frontend' --filter='@ryot/ts-utils' --filter='@ryot/app-backend'`
Expected: PASS or fix any reported issues.

**Step 4: Review touched files for unintended behavior changes**

Confirm that payload generation still trims correctly and backend callers still resolve required slugs via the shared utility.

**Step 5: Commit**

Do not commit unless the user explicitly requests it.
