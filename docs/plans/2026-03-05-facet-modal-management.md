# Facet Modal Management Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the dedicated facets management page with a sidebar-native modal workflow for create, edit, disable, and reorder.

**Architecture:** Keep `/_protected/route.tsx` as a shell that wires facet query and mutations, but move modal and row interactions into `features/facets/components`. Reuse existing form and mutation helpers, keep optimistic behavior for disable/reorder, and render all facets in sidebar with explicit disabled state.

**Tech Stack:** React 19, TanStack Router, TanStack Query, Mantine v9 (`Modal`, `ActionIcon`, `Tooltip`, `useDisclosure`), Bun test

---

### Task 1: Update facet navigation derivation for sidebar use

**Files:**
- Modify: `apps/app-frontend/src/features/facets/nav.ts`
- Modify: `apps/app-frontend/src/features/facets/nav.test.ts`

**Step 1: Write the failing test**

Add test that expects disabled facets to still be present in nav item output, with deterministic ordering.

**Step 2: Run test to verify it fails**

Run: `bun test 'apps/app-frontend/src/features/facets/nav.test.ts'`  
Expected: FAIL because current helper filters out disabled facets.

**Step 3: Write minimal implementation**

Update nav helper to return ordered items for all facets (enabled and disabled), include `enabled` and `isBuiltin` metadata needed by sidebar controls.

**Step 4: Run test to verify it passes**

Run: `bun test 'apps/app-frontend/src/features/facets/nav.test.ts'`  
Expected: PASS.

### Task 2: Add reusable sidebar modal and row action components

**Files:**
- Create: `apps/app-frontend/src/features/facets/components/facet-modal.tsx`
- Create: `apps/app-frontend/src/features/facets/components/facet-nav-item.tsx`
- Modify: `apps/app-frontend/src/features/facets/components/facet-form.tsx`

**Step 1: Write the failing usage check**

Create temporary usage in `/_protected/route.tsx` imports for the two components so typecheck fails before files exist.

**Step 2: Run typecheck to verify it fails**

Run: `bun run turbo typecheck --filter=@ryot/app-frontend`  
Expected: FAIL with missing module/component errors.

**Step 3: Write minimal implementation**

Implement:

- `FacetModal`: wraps Mantine `Modal`, handles create/edit labels, optional disable button in edit mode, delegates form body to existing `FacetForm`.
- `FacetNavItem`: renders one sidebar row with label + disabled marker and hover-revealed `ActionIcon` controls (edit/up/down).
- Extend `FacetForm` to allow optional footer actions so modal can inject disable action.

**Step 4: Run typecheck to verify it passes**

Run: `bun run turbo typecheck --filter=@ryot/app-frontend`  
Expected: PASS.

### Task 3: Move facet management into protected sidebar shell

**Files:**
- Modify: `apps/app-frontend/src/routes/_protected/route.tsx`
- Modify: `apps/app-frontend/src/features/facets/hooks.ts` (if helper metadata is required)

**Step 1: Write the failing behavior checklist**

Manual expectations before change:

- No `+` action next to Tracking heading on hover.
- No inline edit/reorder actions on facet row hover.
- Management requires dedicated `/facets` route.

**Step 2: Run local app check to confirm baseline**

Run: `bun run turbo dev --filter=@ryot/app-frontend`  
Expected: Existing sidebar without modal controls.

**Step 3: Write minimal implementation**

In `route.tsx`:

- Add Tracking header with hover-revealed create `ActionIcon`.
- Use `useDisclosure` + local selection state for one shared modal.
- Open modal in create mode from header `+`.
- Open modal in edit mode from row pencil, prefilled with selected facet.
- Add disable action inside modal edit mode.
- Add row-level reorder controls beside pencil.
- Keep disabled facets visible and dimmed.
- Remove bottom `Manage Facets` link.

**Step 4: Run typecheck/build to verify pass**

Run: `bun run turbo typecheck --filter=@ryot/app-frontend && bun run turbo build --filter=@ryot/app-frontend`  
Expected: PASS.

### Task 4: Remove dedicated facets management route

**Files:**
- Delete: `apps/app-frontend/src/routes/_protected/facets.tsx`
- Modify: `apps/app-frontend/src/routeTree.gen.ts` (generated)
- Modify: `apps/app-frontend/src/routes/_protected/index.tsx` (remove links to `/facets`)

**Step 1: Write the failing route expectation**

Ensure stale `/facets` references fail once route file is deleted and generated tree is refreshed.

**Step 2: Run build/typecheck to verify failure occurs**

Run: `bun run turbo build --filter=@ryot/app-frontend`  
Expected: FAIL due lingering `/facets` references.

**Step 3: Write minimal implementation**

- Remove `/facets` route file.
- Remove all `/facets` links/usages.
- Regenerate route tree through build flow.

**Step 4: Run build/typecheck to verify pass**

Run: `bun run turbo typecheck --filter=@ryot/app-frontend && bun run turbo build --filter=@ryot/app-frontend`  
Expected: PASS with no `/facets` route in tree.

### Task 5: Validate behavior and finalize

**Files:**
- Modify: `apps/app-frontend/src/features/facets/nav.test.ts` (if additional assertions needed)
- Optional: `docs/plans/2026-03-05-facet-modal-management-design.md` (if behavior adjustments discovered)

**Step 1: Run targeted tests**

Run: `bun test 'apps/app-frontend/src/features/facets/nav.test.ts'`  
Expected: PASS.

**Step 2: Ask user approval to run broader tests**

Prompt user before full test command per repo guidance.

**Step 3: Run final verification commands**

Run:

- `bun run turbo typecheck --filter=@ryot/app-frontend`
- `bun run turbo build --filter=@ryot/app-frontend`

Expected: PASS.

**Step 4: Manual UX verification**

Verify in UI:

- Tracking `+` appears on hover and opens create modal.
- Facet row hover shows pencil + reorder controls.
- Edit opens prefilled modal and includes disable action.
- Disabled facets remain visible and styled as disabled.
- No dedicated facets page remains.

## Notes and Constraints

- Follow `AGENTS.md` conventions for component signatures and ordering.
- Prefer Mantine components and hooks where possible.
- Keep route file readable; shift UI detail to feature components.
- Do not add comments unless needed for non-obvious logic.
