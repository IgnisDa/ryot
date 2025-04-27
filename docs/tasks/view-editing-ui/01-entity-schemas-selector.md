# Entity Schemas Selector

**Parent Plan:** [View Editing UI](./README.md)

**Type:** AFK

**Status:** completed

## What to build

Build the first piece of queryDefinition editing: an entity schemas selector that allows users to change which entity schemas their saved view queries. This establishes the foundation for the drawer editing infrastructure.

This vertical slice delivers:
- Extended form schema (`form-extended.ts`) with `entitySchemaSlugs` array field
- `EntitySchemasSelector` component using Mantine's MultiSelect
- Integration with the view page drawer
- Mutation hook update to send complete `queryDefinition` payload
- End-to-end flow: user opens drawer → changes schemas → saves → sees results update

## Implementation Details

**Create `form-extended.ts`:**
```typescript
const savedViewExtendedFormSchema = z.object({
  entitySchemaSlugs: z.array(z.string()).min(1, "At least one schema required"),
  // Placeholders for future fields (filters, sort, displayConfiguration)
  filters: z.array(z.any()).default([]),
  sort: z.object({
    fields: z.array(z.string()).min(1),
    direction: z.enum(["asc", "desc"])
  }),
  displayConfiguration: z.any()
});
```

**Create `EntitySchemasSelector` component:**
- Uses Mantine's `MultiSelect` with `form.AppField`
- Fetches available schemas from `GET /entity-schemas`
- Shows schema name as label, stores slug as value
- Supports adding/removing multiple schemas

**Update drawer in `$viewId.tsx`:**
- Replace "Under Construction" placeholder with initial form
- Fetch entity schemas data
- Wire up save mutation
- Refetch view data on success

**Update `hooks.ts`:**
- Extend `updateViewById` to accept entitySchemaSlugs
- Pass through existing filters, sort, displayConfiguration from original view

## Acceptance criteria

- [x] User can open drawer and see entity schemas multi-select
- [x] Multi-select shows all available entity schemas (built-in + custom)
- [x] User can add schemas to the selection
- [x] User can remove schemas from the selection
- [x] At least one schema must be selected (validation)
- [x] Save button triggers mutation with complete queryDefinition
- [x] View results update immediately after save
- [x] Drawer closes on successful save
- [x] Error messages display if save fails
- [x] No TypeScript errors

## Blocked by

None - can start immediately

## User stories addressed

- User story 1: As a user, I want to change which entity schemas my saved view queries, so that I can include or exclude different entity types.

---

## Implementation Summary

**Completed:** 2026-03-22

### Files Created

1. **`form-extended.ts`** - Extended form schema with Zod validation
   - `savedViewExtendedFormSchema` - Schema for queryDefinition and displayConfiguration
   - `buildSavedViewExtendedFormValues()` - Converts AppSavedView to form values
   - `buildSavedViewExtendedUpdatePayload()` - Builds complete API request payload

2. **`form-extended.test.ts`** - Comprehensive test suite (5 tests)
   - Schema validation tests (rejects empty array, accepts valid values)
   - Form builder function tests
   - Payload builder function tests

3. **`components/saved-view-extended-form.tsx`** - React form component
   - MultiSelect for entity schemas selection
   - Form validation and error handling
   - Integration with TanStack Form

### Files Modified

1. **`hooks.ts`**
   - Added `updateViewExtendedById()` mutation function
   - Exports new mutation through `useSavedViewMutations` hook

2. **`view-page.tsx`**
   - Replaced "Under Construction" placeholder with `SavedViewExtendedForm`
   - Wired up save mutation and refetch logic

### Test-Driven Development

Implementation followed strict TDD workflow:
- **RED phase**: Write failing test
- **GREEN phase**: Write minimal code to pass
- **REFACTOR phase**: Clean up and improve

**Test Results:**
- 5 new tests added, all passing
- 22 expect() calls
- All 197 saved-views tests passing

### Verification Steps

To verify this implementation:

1. **Run tests:**
   ```bash
   cd apps/app-frontend/src/features/saved-views
   bun test form-extended.test.ts
   ```

2. **Run typecheck:**
   ```bash
   cd apps/app-frontend
   bun run typecheck
   ```

3. **Build frontend:**
   ```bash
   cd apps/app-frontend
   bun run build
   ```

All verification steps should pass with no errors.

### Next Steps

This task establishes the foundation for:
- Task 02: Sort Configuration Builder
- Task 03: Filters Builder
- Task 04: Grid Display Configuration
- Task 05: List and Table Display Configurations
- Task 06: Built-in Protection and UX Polish
