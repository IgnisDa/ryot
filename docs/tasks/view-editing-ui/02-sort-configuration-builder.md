# Sort Configuration Builder

**Parent Plan:** [View Editing UI](./README.md)

**Type:** AFK

**Status:** todo

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

- [ ] User can see current sort configuration
- [ ] User can add new sort fields (property paths)
- [ ] User can remove sort fields
- [ ] At least one sort field must remain (validation)
- [ ] User can change sort direction (asc/desc)
- [ ] Multiple fields support COALESCE pattern (e.g., `["smartphones.year", "tablets.release_year"]`)
- [ ] Save updates sort configuration
- [ ] View results reorder after save
- [ ] Help text explains `@name` vs `schema.property` syntax
- [ ] No TypeScript errors

## Blocked by

- [Task 01](./01-entity-schemas-selector.md) - Establishes form infrastructure

## User stories addressed

- User story 5: As a user, I want to change the sort order of my saved view, so that entities appear in my preferred sequence.
- User story 6: As a user, I want to configure multiple sort fields with COALESCE fallback, so that cross-schema views sort correctly.
