# Filters Builder

**Parent Plan:** [View Editing UI](./README.md)

**Type:** AFK

**Status:** done

## What to build

Add filters editing to the drawer form. This is the most complex query component due to the discriminated union of filter operators and conditional value inputs.

This vertical slice delivers:
- Extended form schema with `filters` array (discriminated union by operator)
- `FiltersBuilder` component following `properties-builder.tsx` pattern
- Array manipulation (add/remove filters)
- Conditional value input based on operator type
- Complete integration with existing drawer form

## Implementation Details

**Update `form-extended.ts`:**
```typescript
const filterExpressionSchema = z.discriminatedUnion("op", [
  z.object({ field: z.string(), op: z.literal("isNull"), value: z.null().optional() }),
  z.object({ field: z.string(), op: z.literal("in"), value: z.array(z.any()) }),
  z.object({ 
    field: z.string(), 
    op: z.enum(["eq", "ne", "gt", "gte", "lt", "lte"]), 
    value: z.any() 
  })
]);

// Update savedViewExtendedFormSchema to include filters array
```

**Create `FiltersBuilder` component:**
- Array field pattern: `form.AppField name="filters" mode="array"`
- Each filter row in a Paper component with:
  - Field path (TextInput)
  - Operator (Select) with all supported operators
  - Value input (conditional on operator):
    - `isNull`: No value field shown
    - `in`: Comma-separated text input (split to array)
    - Others: Single text input
- Add/Remove filter buttons
- Help text for operators

**Update drawer form:**
- Add FiltersBuilder section below sort
- Initialize with existing filters from view
- Include in save payload

## Acceptance criteria

- [x] User can see existing filters
- [x] User can add new filters
- [x] User can edit filter field path
- [x] User can change filter operator
- [x] Value input shows/hides based on operator (isNull has no value)
- [x] User can edit filter value
- [x] User can remove filters
- [x] Empty filters array is allowed
- [x] Save updates filters in queryDefinition
- [x] View results filter correctly after save (backend handles filtering)
- [x] Operator select shows all options: eq, ne, gt, gte, lt, lte, in, isNull
- [x] Help text explains each operator
- [x] No TypeScript errors

## Blocked by

- [Task 02](./02-sort-configuration-builder.md) - Completes simpler query editing first

## User stories addressed

- User story 2: As a user, I want to add filters to my saved view, so that I can narrow down which entities are shown.
- User story 3: As a user, I want to edit existing filters (change field, operator, or value), so that I can refine my search criteria.
- User story 4: As a user, I want to remove filters from my saved view, so that I can broaden my results.

## Implementation Notes

**Completed:** 2026-03-22

**Test-Driven Development Approach:**

This task was implemented using strict TDD with vertical slicing (tracer bullets), not horizontal slicing:

1. **Tracer Bullet (RED→GREEN):**
   - Test: Schema validates filter operators
   - Implementation: `FilterRow` schema with 8 operators

2. **Incremental Tests (RED→GREEN cycles):**
   - Test: `buildDefaultFilterRow()` generates UUIDs
   - Test: Schema accepts valid filters
   - Test: Schema rejects invalid operators
   - Test: Payload transformation unwraps filter rows
   - Test: `isNull` operator converts value to null
   - Test: `in` operator splits comma-separated values to array

3. **Component Implementation:**
   - Created `FiltersBuilder` component following `SortBuilder` pattern
   - Conditional value input based on operator type
   - Integrated into `SavedViewExtendedForm`

**Key Implementation Details:**

- **Form Schema** (form-extended.ts:16-35)
  - `FilterRow` type with UUID-based keys for React reconciliation
  - Operator enum: eq, ne, gt, gte, lt, lte, in, isNull
  - Value stored as string in form (converted in payload)

- **Payload Transformation** (form-extended.ts:77-110)
  - `buildApiFilter()` constructs proper discriminated union
  - Type-safe narrowing based on operator
  - Auto-parses numbers and booleans

- **Component** (filters-builder.tsx)
  - Conditional value field (hidden for isNull)
  - Help text for "in" operator (comma-separated hint)
  - Empty state when no filters configured
  - Operator labels include abbreviations

**Test Results:**
- 15 tests total in form-extended.test.ts
- 31 tests total across saved-views feature
- All tests passing
- Zero TypeScript errors
- Frontend build successful (858ms)

**Files Modified:**
- `apps/app-frontend/src/features/saved-views/form-extended.ts`
- `apps/app-frontend/src/features/saved-views/form-extended.test.ts`
- `apps/app-frontend/src/features/saved-views/components/filters-builder.tsx` (new)
- `apps/app-frontend/src/features/saved-views/components/saved-view-extended-form.tsx`

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

All steps must pass with no errors.
