# Filters Builder

**Parent Plan:** [View Editing UI](./README.md)

**Type:** AFK

**Status:** todo

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

- [ ] User can see existing filters
- [ ] User can add new filters
- [ ] User can edit filter field path
- [ ] User can change filter operator
- [ ] Value input shows/hides based on operator (isNull has no value)
- [ ] User can edit filter value
- [ ] User can remove filters
- [ ] Empty filters array is allowed
- [ ] Save updates filters in queryDefinition
- [ ] View results filter correctly after save
- [ ] Operator select shows all options: eq, ne, gt, gte, lt, lte, in, isNull
- [ ] Help text explains each operator
- [ ] No TypeScript errors

## Blocked by

- [Task 02](./02-sort-configuration-builder.md) - Completes simpler query editing first

## User stories addressed

- User story 2: As a user, I want to add filters to my saved view, so that I can narrow down which entities are shown.
- User story 3: As a user, I want to edit existing filters (change field, operator, or value), so that I can refine my search criteria.
- User story 4: As a user, I want to remove filters from my saved view, so that I can broaden my results.
