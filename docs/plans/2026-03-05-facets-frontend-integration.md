# Facets Frontend Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Integrate facets as a first-class frontend primitive by making authenticated navigation facet-driven and shipping a dedicated facet manager with full CRUD + reorder.

**Architecture:** Build a nav-first protected app shell that reads facets from one shared React Query source, then layer dedicated routes for facet landing and facet management. Keep mutation logic centralized in a facets feature module with optimistic updates for toggle/reorder and query invalidation for create/update. Use utility-first tests (Bun) for deterministic behavior in selectors, reorder logic, and cache patch helpers.

**Tech Stack:** React 19, TanStack Router, TanStack Query, Mantine v9, openapi-react-query, Bun test

---

### Task 1: Add frontend facet model utilities with Bun tests

**Files:**
- Create: `apps/app-frontend/src/features/facets/model.ts`
- Create: `apps/app-frontend/src/features/facets/model.test.ts`
- Modify: `apps/app-frontend/package.json`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "bun:test";
import {
  findFacetBySlug,
  sortFacetsByOrder,
  selectEnabledFacets,
} from "./model";

describe("facet model", () => {
  const fixtures = [
    { id: "2", slug: "fitness", enabled: true, sortOrder: 2 },
    { id: "1", slug: "media", enabled: true, sortOrder: 1 },
    { id: "3", slug: "books", enabled: false, sortOrder: 3 },
  ];

  it("sorts facets by sortOrder", () => {
    expect(sortFacetsByOrder(fixtures).map((facet) => facet.slug)).toEqual([
      "media",
      "fitness",
      "books",
    ]);
  });

  it("selects only enabled facets", () => {
    expect(selectEnabledFacets(fixtures).map((facet) => facet.slug)).toEqual([
      "fitness",
      "media",
    ]);
  });

  it("finds a facet by slug", () => {
    expect(findFacetBySlug(fixtures, "media")?.id).toBe("1");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test 'src/features/facets/model.test.ts'`  
Expected: FAIL with module or symbol not found for `./model`

**Step 3: Write minimal implementation**

```ts
export type AppFacet = {
  id: string;
  slug: string;
  name?: string;
  enabled: boolean;
  sortOrder: number;
};

export const sortFacetsByOrder = (facets: AppFacet[]) => {
  return [...facets].sort((a, b) => a.sortOrder - b.sortOrder);
};

export const selectEnabledFacets = (facets: AppFacet[]) => {
  return facets.filter((facet) => facet.enabled);
};

export const findFacetBySlug = (facets: AppFacet[], slug: string) => {
  return facets.find((facet) => facet.slug === slug);
};
```

**Step 4: Run test to verify it passes**

Run: `bun test 'src/features/facets/model.test.ts'`  
Expected: PASS

**Step 5: Commit**

```bash
git add 'apps/app-frontend/src/features/facets/model.ts' 'apps/app-frontend/src/features/facets/model.test.ts' 'apps/app-frontend/package.json' 'bun.lock'
git commit -m "feat: add facet model selectors for nav-first frontend integration"
```

### Task 2: Add reorder helpers and tests for button-based ordering

**Files:**
- Create: `apps/app-frontend/src/features/facets/reorder.ts`
- Create: `apps/app-frontend/src/features/facets/reorder.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "bun:test";
import { buildReorderPayload, moveFacet } from "./reorder";

describe("facet reorder", () => {
  const ids = ["a", "b", "c"];

  it("moves an item up", () => {
    expect(moveFacet(ids, "b", "up")).toEqual(["b", "a", "c"]);
  });

  it("keeps order when moving top item up", () => {
    expect(moveFacet(ids, "a", "up")).toEqual(ids);
  });

  it("builds payload with facetIds", () => {
    expect(buildReorderPayload(["b", "a", "c"]))
      .toEqual({ facetIds: ["b", "a", "c"] });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test 'src/features/facets/reorder.test.ts'`  
Expected: FAIL with module not found for `./reorder`

**Step 3: Write minimal implementation**

```ts
export const moveFacet = (
  facetIds: string[],
  facetId: string,
  direction: "up" | "down",
) => {
  const index = facetIds.indexOf(facetId);
  if (index < 0) return facetIds;

  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= facetIds.length) return facetIds;

  const next = [...facetIds];
  const current = next[index];
  const target = next[targetIndex];
  if (!current || !target) return facetIds;

  next[index] = target;
  next[targetIndex] = current;
  return next;
};

export const buildReorderPayload = (facetIds: string[]) => ({ facetIds });
```

**Step 4: Run test to verify it passes**

Run: `bun test 'src/features/facets/reorder.test.ts'`  
Expected: PASS

**Step 5: Commit**

```bash
git add 'apps/app-frontend/src/features/facets/reorder.ts' 'apps/app-frontend/src/features/facets/reorder.test.ts'
git commit -m "feat: add facet reorder helpers for manager controls"
```

### Task 3: Add shared query/mutation cache helpers with tests

**Files:**
- Create: `apps/app-frontend/src/features/facets/cache.ts`
- Create: `apps/app-frontend/src/features/facets/cache.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "bun:test";
import {
  applyFacetEnabledPatch,
  applyFacetReorderPatch,
} from "./cache";

describe("facet cache patches", () => {
  const facets = [
    { id: "1", enabled: true, sortOrder: 1 },
    { id: "2", enabled: false, sortOrder: 2 },
  ];

  it("patches enabled state for a facet", () => {
    const next = applyFacetEnabledPatch(facets, "2", true);
    expect(next[1]?.enabled).toBe(true);
  });

  it("patches order by requested ids", () => {
    const next = applyFacetReorderPatch(facets, ["2", "1"]);
    expect(next.map((facet) => facet.id)).toEqual(["2", "1"]);
    expect(next.map((facet) => facet.sortOrder)).toEqual([1, 2]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test 'src/features/facets/cache.test.ts'`  
Expected: FAIL with module not found for `./cache`

**Step 3: Write minimal implementation**

```ts
export const applyFacetEnabledPatch = (
  facets: Array<{ id: string; enabled: boolean }> ,
  facetId: string,
  enabled: boolean,
) => {
  return facets.map((facet) => {
    if (facet.id !== facetId) return facet;
    return { ...facet, enabled };
  });
};

export const applyFacetReorderPatch = (
  facets: Array<{ id: string; sortOrder: number }>,
  facetIds: string[],
) => {
  const byId = new Map(facets.map((facet) => [facet.id, facet]));
  return facetIds
    .map((id, index) => {
      const facet = byId.get(id);
      if (!facet) return null;
      return { ...facet, sortOrder: index + 1 };
    })
    .filter((facet): facet is NonNullable<typeof facet> => facet !== null);
};
```

**Step 4: Run test to verify it passes**

Run: `bun test 'src/features/facets/cache.test.ts'`  
Expected: PASS

**Step 5: Commit**

```bash
git add 'apps/app-frontend/src/features/facets/cache.ts' 'apps/app-frontend/src/features/facets/cache.test.ts'
git commit -m "feat: add facet cache patch helpers for optimistic UI updates"
```

### Task 4: Build shared facets hooks for query and mutations

**Files:**
- Create: `apps/app-frontend/src/features/facets/hooks.ts`
- Modify: `apps/app-frontend/src/hooks/api.tsx`
- Reference: `apps/app-frontend/src/lib/api/openapi.d.ts`

**Step 1: Write the failing usage test in a temporary route snippet**

```ts
const facetsQuery = useFacetsQuery();
const mutations = useFacetMutations();
void facetsQuery;
void mutations;
```

Expected compiler failure before hooks exist.

**Step 2: Run typecheck to verify failure**

Run: `bun run turbo typecheck --filter=@ryot/app-frontend`  
Expected: FAIL with missing `useFacetsQuery` or `useFacetMutations`

**Step 3: Implement hooks**

Implement:

- `useFacetsQuery()` wrapping `apiClient.useQuery("get", "/facets/list")`
- `useFacetMutations()` exposing create/update/enable/disable/reorder mutations
- Shared query key access via `apiClient.queryOptions("get", "/facets/list").queryKey`
- Optimistic patches using helpers from Task 3

**Step 4: Run typecheck to verify pass**

Run: `bun run turbo typecheck --filter=@ryot/app-frontend`  
Expected: PASS

**Step 5: Commit**

```bash
git add 'apps/app-frontend/src/features/facets/hooks.ts' 'apps/app-frontend/src/hooks/api.tsx'
git commit -m "feat: add shared facet query and mutation hooks"
```

### Task 5: Convert protected route into a facet-aware shell

**Files:**
- Modify: `apps/app-frontend/src/routes/_protected/route.tsx`
- Create: `apps/app-frontend/src/features/facets/nav.ts`

**Step 1: Write failing test for nav mapping helper**

```ts
import { describe, expect, it } from "bun:test";
import { toTrackingNavItems } from "./nav";

describe("toTrackingNavItems", () => {
  it("maps enabled facets to tracking links", () => {
    const items = toTrackingNavItems([
      { slug: "media", enabled: true, sortOrder: 1, name: "Media" },
      { slug: "fitness", enabled: false, sortOrder: 2, name: "Fitness" },
    ]);

    expect(items).toEqual([
      { label: "Media", to: "/tracking/$facetSlug", params: { facetSlug: "media" } },
    ]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test 'src/features/facets/nav.test.ts'`  
Expected: FAIL with missing module or symbol

**Step 3: Implement helper and shell layout**

- Add `toTrackingNavItems` helper in `nav.ts`.
- Update `/_protected/route.tsx` to:
  - fetch facets via `useFacetsQuery`
  - render TRACKING from enabled facets
  - show non-blocking nav error row + Retry
  - keep `<Outlet />` for page content

**Step 4: Run test and typecheck**

Run: `bun test 'src/features/facets/nav.test.ts' && bun run turbo typecheck --filter=@ryot/app-frontend`  
Expected: PASS for both commands

**Step 5: Commit**

```bash
git add 'apps/app-frontend/src/routes/_protected/route.tsx' 'apps/app-frontend/src/features/facets/nav.ts' 'apps/app-frontend/src/features/facets/nav.test.ts'
git commit -m "feat: render tracking navigation from active facets"
```

### Task 6: Add facet tracking route scaffold

**Files:**
- Create: `apps/app-frontend/src/routes/_protected/tracking.$facetSlug.tsx`
- Modify: `apps/app-frontend/src/routeTree.gen.ts` (generated)

**Step 1: Write failing route usage**

```tsx
<Link to="/tracking/$facetSlug" params={{ facetSlug: "media" }} />
```

Expected compiler failure before route exists.

**Step 2: Run typecheck to verify it fails**

Run: `bun run turbo typecheck --filter=@ryot/app-frontend`  
Expected: FAIL with route path/type missing

**Step 3: Implement route scaffold**

Create route that:

- reads `facetSlug` param
- resolves facet using shared query data
- renders placeholder heading and empty message
- handles unknown slug with inline not-found state

**Step 4: Regenerate route tree and verify**

Run: `bun run turbo build --filter=@ryot/app-frontend`  
Expected: route tree regenerated, build PASS

**Step 5: Commit**

```bash
git add 'apps/app-frontend/src/routes/_protected/tracking.$facetSlug.tsx' 'apps/app-frontend/src/routeTree.gen.ts'
git commit -m "feat: add facet tracking route scaffold"
```

### Task 7: Implement dedicated facet manager route with full CRUD and reorder

**Files:**
- Create: `apps/app-frontend/src/routes/_protected/facets.tsx`
- Create: `apps/app-frontend/src/features/facets/components/facet-manager.tsx`
- Create: `apps/app-frontend/src/features/facets/components/facet-form.tsx`
- Modify: `apps/app-frontend/src/routeTree.gen.ts` (generated)

**Step 1: Write failing test for manager payload helper**

```ts
import { describe, expect, it } from "bun:test";
import { toCreateFacetPayload, toUpdateFacetPayload } from "../form";

describe("facet form payloads", () => {
  it("trims create payload fields", () => {
    expect(toCreateFacetPayload({ name: "  Media  ", slug: "  media  " }))
      .toEqual({ name: "Media", slug: "media" });
  });

  it("allows nullable update fields", () => {
    expect(toUpdateFacetPayload({ description: "" })).toEqual({ description: null });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test 'src/features/facets/components/form.test.ts'`  
Expected: FAIL with missing mapper module

**Step 3: Implement manager and form components**

Implement:

- facets list table/card with status and mode
- create form
- update form for custom facets only (`isBuiltin === false`)
- enable/disable actions for each row
- up/down reorder buttons using Task 2 helpers
- optimistic UI behavior via Task 4 hooks

**Step 4: Run tests and typecheck**

Run: `bun test 'src/features/facets/components/form.test.ts' && bun run turbo typecheck --filter=@ryot/app-frontend`  
Expected: PASS

**Step 5: Commit**

```bash
git add 'apps/app-frontend/src/routes/_protected/facets.tsx' 'apps/app-frontend/src/features/facets/components/facet-manager.tsx' 'apps/app-frontend/src/features/facets/components/facet-form.tsx' 'apps/app-frontend/src/features/facets/components/form.ts' 'apps/app-frontend/src/features/facets/components/form.test.ts' 'apps/app-frontend/src/routeTree.gen.ts'
git commit -m "feat: add facet manager route with CRUD and reorder actions"
```

### Task 8: Wire home route CTAs and finalize verification

**Files:**
- Modify: `apps/app-frontend/src/routes/_protected/index.tsx`
- Modify: `apps/app-frontend/src/routes/_protected/route.tsx`

**Step 1: Add failing navigation expectation (manual checklist)**

Checklist before wiring:

- No CTA to manager route yet on home
- No zero-facets prompt path

**Step 2: Implement final wiring**

- Add link/button to `/_protected/facets` from home and shell
- Show "Add Tracker" CTA when no enabled facets exist
- Keep existing placeholder content functional

**Step 3: Ask user approval to run tests (per repo workflow)**

Prompt user for approval to run test command(s).

**Step 4: Run final verification**

Run:

- `bun test 'src/features/facets/**/*.test.ts'`
- `bun run turbo typecheck --filter=@ryot/app-frontend`
- `bun run turbo build --filter=@ryot/app-frontend`

Expected: all PASS

**Step 5: Commit**

```bash
git add 'apps/app-frontend/src/routes/_protected/index.tsx' 'apps/app-frontend/src/routes/_protected/route.tsx'
git commit -m "feat: complete nav-first facets integration in protected app shell"
```

## Notes and Constraints

- Follow `AGENTS.md` conventions:
  - React components must use single `props` argument, no destructured params.
  - Keep added files under 500 lines.
  - Keep object literal and sequential hook declarations ordered by ascending line length where practical.
- Do not hand-edit generated route file semantics; only accept generated updates from router tooling.
- Keep implementation DRY and avoid introducing a second source of facet truth outside shared hooks/query cache.
