# Facet Modal Management Design

**Date:** 2026-03-05  
**Scope:** `apps/app-frontend`  
**Strategy:** Sidebar-native modal workflow (Approach 2)

## Overview

The current facets integration ships a dedicated `/facets` management page. This design moves facet management into the protected sidebar so users can create, edit, disable, and reorder facets directly in context.

The interaction model is hover-driven:

- Hover the `Tracking` section to reveal a `+` create action.
- Hover any facet row to reveal edit and reorder actions.
- Open one shared modal for both create and edit.

This keeps tracking setup close to navigation and removes route/context switching.

## Goals

- Replace dedicated facet manager page with in-sidebar controls.
- Use a shared Mantine modal for create and edit flows.
- Support disable action from edit flow without leaving modal context.
- Support up/down reorder controls beside edit action.
- Keep disabled facets visible in the sidebar (dimmed state).

## Non-Goals

- Drag-and-drop ordering.
- Separate disabled-facets screen.
- New facet detail page behavior beyond existing placeholder route.

## Chosen Approach

### Approach 2: Extracted feature components (recommended)

Keep route shell focused on layout and data wiring, and move UI behaviors into feature components:

- `FacetModal` handles create/edit/disable form interactions.
- `FacetNavItem` handles hover actions for each facet row.
- Route shell owns list data, active state, and mutations.

Why this approach:

- Avoids growing `/_protected/route.tsx` into a monolith.
- Reuses existing facet form and mutation helpers.
- Keeps behavior testable in small focused modules.

## Architecture

### 1. Sidebar control surface

In `/_protected/route.tsx`:

- Replace TRACKING nav mapping from enabled-only to all ordered facets.
- Render disabled facets with muted styling and explicit disabled indication.
- Add a header-level create action icon (`+`) shown on TRACKING hover.
- Remove `Manage Facets` link and `/facets` route dependency.

### 2. Shared create/edit modal

Create a dedicated modal component that:

- Opens in create mode from TRACKING `+` icon.
- Opens in edit mode from facet row pencil action.
- Prefills fields from selected facet in edit mode.
- Shows submit actions (`Create`/`Update`) based on mode.
- Shows `Disable facet` button in edit mode.

Mantine primitives:

- `Modal` for shell and accessibility.
- `useDisclosure` for open/close state.
- Existing form controls from `FacetForm`.

### 3. Facet row actions

Per facet row, reveal on hover:

- Pencil (edit modal).
- Up/down controls (reorder mutation).

Action presentation uses Mantine `ActionIcon` and `Tooltip` with accessible labels.

## Data Flow

- Continue using `useFacetsQuery` as canonical source.
- Continue using `useFacetMutations` for create/update/disable/reorder.
- Keep existing optimistic behavior for disable/reorder.
- Update navigation derivation utility to support all facets for sidebar rendering.

## UX Rules

- Disabled facets remain visible in Tracking, not hidden.
- Disabled facets are visually muted and non-primary.
- Edit and reorder controls are discoverable on hover and keyboard focus.
- Modal close returns user to sidebar context without route change.

## Error Handling

- Mutation failures preserve modal open state and current form values.
- Sidebar list failures continue to show non-blocking error and retry.
- Reorder errors rollback automatically via existing mutation handlers.

## Testing Strategy

Add/adjust utility tests first:

- Navigation derivation for all facets ordering/state labels.
- Existing reorder tests remain source of truth for movement logic.

Then validate route shell behavior with typecheck/build and targeted manual checks:

- Create from TRACKING `+`.
- Edit from row pencil with prefilled values.
- Disable from modal and keep row visible as disabled.
- Reorder from row controls.
- No `/facets` route access from sidebar.

## Verification

- `bun run turbo typecheck --filter=@ryot/app-frontend`
- `bun run turbo build --filter=@ryot/app-frontend`

## Success Criteria

- Facet management is fully modal-based from sidebar.
- Dedicated `/facets` management page is removed.
- Disabled facets remain visible and manageable.
- Hover actions provide edit and reorder without navigation detours.
