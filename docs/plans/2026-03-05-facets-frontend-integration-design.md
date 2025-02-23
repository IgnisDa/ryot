# Facets Frontend Integration Design (Nav-First)

**Date:** 2026-03-05  
**Scope:** `apps/app-frontend`  
**Strategy:** Nav-first architecture (Approach 3)

## Overview

`apps/app-frontend` is still mostly scaffold-level. Instead of treating facets as a local page feature first, this design makes facets a top-level app primitive immediately.

The first milestone integrates facet state into authenticated app navigation and layout, then ships a dedicated facet manager route with full CRUD and reorder support.

## Goals

- Drive TRACKING navigation from `/facets/list` (no hardcoded facet assumptions)
- Support zero, one, or many active facets with sane UX states
- Ship a dedicated manager route with full facet CRUD + reorder
- Keep all facet consumers synced through one query cache source
- Preserve backend/OpenAPI contracts already implemented

## Non-Goals (M1)

- Curated facet landing experiences (Media/Fitness bespoke layouts)
- Generated entity list/detail rendering per schema
- Onboarding flow redesign beyond Add Tracker CTA placement
- Drag-and-drop reorder (button-based reorder only for now)

## Chosen Approach

### Approach 3: Nav-First Architecture

Facets are integrated at the app-shell level first, then the manager route is layered on top.

Why this is the right fit now:

- The current frontend is a placeholder, so there is little migration cost.
- SOUL requires "no facet is assumed" across sidebar/dashboard flows.
- Early shell integration avoids later rewrites when routing and navigation expand.

## Architecture

### 1. Protected App Shell owns facet-aware navigation

- Upgrade `apps/app-frontend/src/routes/_protected/route.tsx` from `Outlet` wrapper into the authenticated shell.
- The shell renders:
  - Top-level app navigation
  - Dynamic TRACKING section from enabled facets
  - Main outlet area for child routes
- If facet loading fails, shell remains usable and shows recoverable nav error state.

### 2. Feature module boundary for facets

Introduce `apps/app-frontend/src/features/facets/` for:

- Query/mutation hooks
- Selectors and sort/derive utilities
- Facet manager UI components
- Shared form parsing/mapping logic

This keeps route files thin while letting shell and manager share one source of truth.

### 3. Route structure

- `/_protected/` (home/dashboard placeholder, facet-aware empty states)
- `/_protected/facets` (dedicated facet manager route)
- `/_protected/tracking/$facetSlug` (generic facet landing scaffold)

This stabilizes URL contracts early while allowing page contents to evolve.

## Data Flow

### Canonical query

- Use `apiClient.useQuery("get", "/facets/list")` in a shared hook.
- Expose derived values:
  - `allFacets` (sorted by `sortOrder`)
  - `enabledFacets` (for TRACKING nav)
  - `facetBySlug` lookup
  - loading/error helpers

Both app shell and manager consume this same query key, so updates propagate immediately.

### Mutation hooks

Create typed hooks for:

- `POST /facets/create`
- `PATCH /facets/{facetId}`
- `POST /facets/{facetId}/enable`
- `POST /facets/{facetId}/disable`
- `POST /facets/reorder`

### Cache update policy

- `enable/disable`: optimistic toggle + rollback on failure.
- `reorder`: optimistic reorder + rollback on failure.
- `create/update`: merge server result when deterministic; otherwise invalidate list query.

### Ordering contract

- Server remains source of truth for `sortOrder`.
- Manager reorders all visible facets (enabled and disabled).
- TRACKING nav displays enabled facets only, preserving order.

## UI/UX Design (M1)

### Dynamic TRACKING nav

- Derived from `enabledFacets` only.
- Each item routes to `/_protected/tracking/$facetSlug`.
- Empty states:
  - No visible facets: show Add Tracker CTA.
  - Visible but disabled: show enable prompt.

### Facet manager route (`/_protected/facets`)

Capabilities in scope:

- List facets with mode, status, and metadata
- Create custom facet
- Edit custom facet (name, slug, icon, accent color, description)
- Enable/disable any visible facet
- Reorder visible facets with up/down controls

Rules:

- Built-in facets (`isBuiltin`) do not expose custom metadata edit form.
- Reorder is button-based (no drag-and-drop dependency).

## Error Handling

- `400` validation: render inline form errors and keep form state.
- `404` stale entity during mutation: toast + list refetch.
- Facet list fetch failures in shell: non-blocking error row with Retry.
- Optimistic mutation failures: rollback and notify user.

## Testing Strategy

Initial tests focus on deterministic behavior:

- Selector utilities (`enabledFacets`, ordered mapping, lookup by slug)
- Reorder utility logic (up/down to ordered `facetIds` payload)
- Mutation-side cache update utilities (optimistic patch and rollback)

Then expand to route/component coverage once shell structure stabilizes.

## Rollout Plan

### Phase A: Shell + dynamic nav

- Build facet query/selectors in feature module
- Upgrade protected route into shell
- Render TRACKING from active facets
- Add tracking slug route scaffold

### Phase B: Dedicated facet manager

- Add `/_protected/facets` route
- Wire create/update/enable/disable/reorder mutations
- Implement button-based reorder UX

### Phase C: Hardening

- Improve loading/error states and toasts
- Add utility/component tests
- Validate unknown slug and stale facet handling

## Verification

- `bun run turbo typecheck --filter=@ryot/app-frontend`
- `bun run turbo build --filter=@ryot/app-frontend`

## Success Criteria

- TRACKING sidebar is fully data-driven by active facets
- App remains functional with zero facets enabled
- Facet manager supports full CRUD + reorder for milestone scope
- Mutation results are reflected immediately across nav and manager
- Frontend builds and typechecks cleanly
