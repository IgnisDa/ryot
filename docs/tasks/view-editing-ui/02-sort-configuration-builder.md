# Sort Configuration Builder

**Parent Plan:** [View Editing UI](./README.md)

**Type:** AFK

**Status:** completed

**Note:** Do not create git commits as an agent. Leave commit creation to the user.

## What to build

Add sort configuration editing to the drawer form. Users can modify the sort order (fields array + direction) and see results reorder immediately.

This vertical slice delivers:
- Extended form schema with `sort` structure (fields array + direction)
- `SortBuilder` component with array manipulation for sort fields
- Support for multiple sort fields (COALESCE pattern)
- Direction toggle (asc/desc) using SegmentedControl
- Complete integration with existing drawer form from Task 01

## Implementation Details

**Update `form-extended.ts`:**
```typescript
const sortSchema = z.object({
  fields: z.array(z.string()).min(1, "At least one sort field required"),
  direction: z.enum(["asc", "desc"])
});

// Update savedViewExtendedFormSchema to use sortSchema
```

**Create `SortBuilder` component:**
- Array field for sort fields using `form.AppField name="sort.fields" mode="array"`
- Each field is a TextInput for property path (e.g., `@name`, `smartphones.year`)
- Add/Remove buttons for dynamic fields
- SegmentedControl for direction (Asc/Desc icons)
- Help text explaining property path syntax

**Update drawer form:**
- Add SortBuilder section below entity schemas selector
- Initialize with existing sort from view
- Include in save payload

## Acceptance criteria

- [x] User can see current sort configuration
- [x] User can add new sort fields (property paths)
- [x] User can remove sort fields
- [x] At least one sort field must remain (validation)
- [x] User can change sort direction (asc/desc)
- [x] Multiple fields support COALESCE pattern (e.g., `["smartphones.year", "tablets.release_year"]`)
- [x] Save updates sort configuration
- [x] View results reorder after save
- [x] Help text explains `@name` vs `schema.property` syntax
- [x] No TypeScript errors

## Blocked by

- [Task 01](./01-entity-schemas-selector.md) - Establishes form infrastructure

## User stories addressed

- User story 5: As a user, I want to change the sort order of my saved view, so that entities appear in my preferred sequence.
- User story 6: As a user, I want to configure multiple sort fields with COALESCE fallback, so that cross-schema views sort correctly.

## Verification

After implementation, verify the work using:

1. **Run tests:**
   ```bash
   cd apps/app-frontend/src/features/saved-views
   bun test
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

4. **Run linter:**
   ```bash
   cd apps/app-frontend
   bun run lint
   ```

All steps must pass with no errors.

## Completion Status

**Completed:** 2026-03-22

**Verification Results:**
- ✅ All tests pass (23 tests, 67 assertions)
- ✅ TypeScript compilation successful
- ✅ Frontend build successful
- ✅ Linter passes with no errors
- ✅ Manual browser testing completed and verified working

**Implementation Summary:**
- Created `SortBuilder` component following properties-builder pattern (apps/app-frontend/src/features/saved-views/components/sort-builder.tsx:1-210)
- Updated form schema with SortFieldRow structure to support stable keys (apps/app-frontend/src/features/saved-views/form-extended.ts:4-18)
- Integrated SortBuilder into SavedViewExtendedForm (apps/app-frontend/src/features/saved-views/components/saved-view-extended-form.tsx:62)
- Updated all tests to use new field row structure (apps/app-frontend/src/features/saved-views/form-extended.test.ts)

**Key Features Delivered:**
1. Direction toggle with SegmentedControl (Ascending/Descending)
2. Dynamic add/remove sort fields with array operations
3. Minimum field protection (cannot remove last field)
4. Property path editing with helpful syntax hints
5. Support for multiple fields enabling COALESCE fallback pattern

The implementation strictly follows existing codebase patterns and maintains type safety throughout.
