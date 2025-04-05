# View Editing UI

## Problem Statement

Users currently cannot edit the `queryDefinition` (entitySchemaSlugs, filters, sort) or `displayConfiguration` (grid, list, table layouts) of their saved views through the UI. The drawer on the view page (`/views/$viewId`) shows only a placeholder "Under Construction" message. While the backend APIs (`PUT /saved-views/{viewId}`) support full editing, there is no frontend interface to modify these complex nested structures.

This prevents users from:
- Changing which entity schemas a view queries
- Adding or modifying filters on entity properties
- Adjusting sort order
- Customizing how entities display in grid, list, and table layouts

## Solution

Build a comprehensive custom form UI in the drawer that allows editing of all saved view fields including complex nested structures (queryDefinition and displayConfiguration). The form will follow the existing patterns from `properties-builder.tsx` for array manipulation and nested object editing, using TanStack Form's array field capabilities for dynamic add/remove operations.

The solution includes:
- Extended form schema with Zod validation for all saved view fields
- Reusable form builder components for complex structures (filters, sort, display configs)
- Integration with the existing drawer on the view page
- Built-in view protection (read-only for system views)
- Server-side validation with clear error feedback

## User Stories

1. As a user, I want to change which entity schemas my saved view queries, so that I can include or exclude different entity types.

2. As a user, I want to add filters to my saved view, so that I can narrow down which entities are shown.

3. As a user, I want to edit existing filters (change field, operator, or value), so that I can refine my search criteria.

4. As a user, I want to remove filters from my saved view, so that I can broaden my results.

5. As a user, I want to change the sort order of my saved view, so that entities appear in my preferred sequence.

6. As a user, I want to configure multiple sort fields with COALESCE fallback, so that cross-schema views sort correctly.

7. As a user, I want to customize which properties display in grid view (image, title, subtitle, badge), so that I see the most relevant information.

8. As a user, I want to customize which properties display in list view, so that I can optimize for different viewing patterns.

9. As a user, I want to configure table columns (labels and properties), so that I can create custom tabular views of my data.

10. As a user, I want all three layout configurations (grid, list, table) to be editable independently, so that I don't lose settings when switching layouts.

11. As a user, I want built-in views to be protected from editing, so that I don't accidentally break system views.

12. As a user, I want to see a clone option for built-in views, so that I can create my own customizable version.

13. As a user, I want clear error messages when my edits fail validation, so that I can fix issues and save successfully.

14. As a user, I want helpful hints about property path syntax, so that I can correctly reference entity fields.

15. As a user, I want to save my changes and immediately see them reflected in the view results, so that I get instant feedback on my configuration.

## Implementation Design

### Architecture Overview

The implementation follows the existing form patterns in the codebase:

**Form Layer:**
- Extended Zod schema in `form-extended.ts` for full saved view structure
- Helper functions for building default values and converting to API payload
- Type-safe form values derived from schema using `z.infer`

**Component Layer:**
- Reusable builder components following `properties-builder.tsx` pattern
- Array field manipulation using `pushValue` / `removeValue`
- Nested field paths using template literals: `filters[${index}].field`

**Integration Layer:**
- Extended mutation hook in `hooks.ts` for full payload updates
- Drawer integration in view page route
- Refetch and UI update on successful save

### Data Structures

#### QueryDefinition
```typescript
{
  entitySchemaSlugs: string[],        // e.g., ["smartphones", "tablets"]
  filters: FilterExpression[],        // Array of filter objects
  sort: {
    fields: string[],                 // e.g., ["@name"] or ["smartphones.year"]
    direction: "asc" | "desc"
  }
}
```

#### FilterExpression (Discriminated Union)
```typescript
type FilterExpression =
  | { field: string, op: "isNull", value?: null }
  | { field: string, op: "in", value: any[] }
  | { field: string, op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte", value: any }
```

#### DisplayConfiguration
```typescript
{
  grid: {
    imageProperty?: string[],
    titleProperty?: string[],
    subtitleProperty?: string[],
    badgeProperty?: string[] | null
  },
  list: { /* same structure as grid */ },
  table: {
    columns: Array<{
      label: string,
      property: string[]
    }>
  }
}
```

### Form Patterns

**Array Field Pattern:**
```typescript
<form.AppField name="filters" mode="array">
  {(filtersField) => {
    const arrayField = filtersField as ArrayField;
    return (
      <>
        {arrayField.state.value.map((filter, index) => (
          <Paper key={index}>
            <form.AppField name={`filters[${index}].field`}>
              {/* Field editor */}
            </form.AppField>
            <Button onClick={() => arrayField.removeValue(index)}>Remove</Button>
          </Paper>
        ))}
        <Button onClick={() => arrayField.pushValue(buildDefaultFilter())}>
          Add Filter
        </Button>
      </>
    );
  }}
</form.AppField>
```

**Nested Property Paths:**
```typescript
// Access deeply nested config
<form.AppField name="displayConfiguration.grid.imageProperty" mode="array">
  {(imagePropertyField) => {
    // Edit array of property path strings
  }}
</form.AppField>
```

### Component Structure

**Main Form:** `SavedViewExtendedForm`
- Orchestrates all sub-components
- Handles form submission and validation
- Shows basic metadata + query definition + display configuration sections

**Sub-Components:**
- `EntitySchemasSelector` - Multi-select for entity schemas
- `FiltersBuilder` - Array of filter rows with field/operator/value
- `SortBuilder` - Sort fields array + direction selector
- `DisplayConfigBuilder` - Tabs for grid/list/table with property arrays

### Validation Strategy

**Client-side (Zod):**
- Schema structure validation (correct types, required fields)
- Array uniqueness where needed
- Field path format (basic regex checks)

**Server-side (trusted):**
- Property existence in entity schemas
- Operator-type compatibility
- Value type correctness
- Schema access permissions

Frontend focuses on structure; backend validates business rules.

### Built-in View Protection

Views where `isBuiltin: true` cannot be edited:
- Drawer shows read-only message
- Form is replaced with clone suggestion
- Clone button creates editable copy
- Follows existing built-in protection pattern from delete operation

## Technical Decisions

### Why Custom Form UI Over JSON Editor?

**Pros of custom form:**
- More user-friendly for non-technical users
- Guided experience with field labels and help text
- Type-appropriate inputs (select for operators, multi-select for schemas)
- Validation happens per-field, not on entire JSON blob
- Consistent with rest of Ryot UI (uses existing form patterns)

**Cons:**
- More complex to build
- More components to maintain
- Takes up more screen space

**Decision:** Custom form UI provides better UX and follows existing patterns in the codebase (property schemas builder).

### Why Server-Side Validation?

**Rationale:**
- Property names and types are schema-dependent
- Validating property existence requires fetching entity schemas
- Type compatibility checking is complex (requires schema introspection)
- Backend already validates these rules for security
- Reduces frontend complexity

**Trade-off:** Users see validation errors after save attempt, not during typing. Acceptable because server errors are clear and actionable.

### Why Separate Components for Each Builder?

**Rationale:**
- Separation of concerns (each component owns one structure)
- Testability (can test each builder in isolation)
- Reusability (sort builder could be used elsewhere)
- Maintainability (easier to understand smaller components)
- Follows existing `properties-builder.tsx` pattern

**Alternative considered:** Single mega-form component. Rejected due to complexity and poor maintainability.

### Why Tabs for Display Configuration?

**Rationale:**
- Three layout configs are independent
- Users edit one layout at a time
- Reduces visual clutter
- Clear separation of grid vs list vs table settings
- Follows common UI pattern for related but separate configurations

**Alternative considered:** Accordion sections. Rejected because tabs better indicate "choose one to edit" vs "expand all to see all".

## Out of Scope

The following features are intentionally excluded to keep scope focused:

**Advanced Features:**
- Property path autocomplete (requires fetching all entity schemas and introspecting properties)
- Type-aware value inputs (number picker for numeric fields, date picker for dates)
- Filter operator validation based on property type (requires schema introspection)
- Live preview of results as user edits (would require executing queries on every change)

**UX Enhancements:**
- Drag-and-drop reordering of filters or sort fields
- Filter templates or presets
- Bulk operations (duplicate filter, clear all filters)
- Export/import view configuration as JSON

**Validation Improvements:**
- Real-time property existence checking
- Suggested property paths based on selected schemas
- Warning for potentially slow queries (many filters, complex sorts)

These can be added in future iterations once the core editing functionality is proven.

## Acceptance Criteria

### Functional Requirements

- [ ] User can edit entity schemas list (add/remove schemas)
- [ ] User can add new filters with field, operator, and value
- [ ] User can edit existing filters (change any field)
- [ ] User can remove filters
- [ ] User can edit sort configuration (fields array and direction)
- [ ] User can edit grid display configuration (image, title, subtitle, badge properties)
- [ ] User can edit list display configuration
- [ ] User can edit table display configuration (columns with labels)
- [ ] User can switch between grid/list/table config tabs
- [ ] Changes save successfully to backend
- [ ] View results update immediately after save
- [ ] Built-in views show read-only message
- [ ] Built-in views offer clone option
- [ ] Server validation errors display clearly
- [ ] Form shows loading state during save

### Technical Requirements

- [ ] Form schema uses Zod with proper type inference
- [ ] Components follow existing array field patterns
- [ ] Mutation hook sends complete payload to PUT endpoint
- [ ] Drawer integrates cleanly with existing view page
- [ ] No TypeScript errors
- [ ] No console warnings or errors
- [ ] Code follows Ryot frontend guidelines (Mantine props, typography, spacing)

### UX Requirements

- [ ] Filter operator dropdown shows all supported operators
- [ ] Help text explains property path syntax (@name, schema.property)
- [ ] Add/remove buttons clearly labeled
- [ ] Form sections logically organized
- [ ] Loading states indicate save in progress
- [ ] Success feedback confirms save completed
- [ ] Error messages are actionable
- [ ] Drawer size accommodates complex form without scrolling issues

## Testing Strategy

### Manual Testing Checklist

**Basic Operations:**
- [ ] Edit custom view, save, verify changes reflected
- [ ] Add filter, save, verify filtering works
- [ ] Remove filter, save, verify results update
- [ ] Change sort order, save, verify sort applied
- [ ] Edit grid config, switch to grid view, verify display
- [ ] Edit table config, switch to table view, verify columns

**Edge Cases:**
- [ ] Empty filters array saves correctly
- [ ] Single sort field vs multiple sort fields
- [ ] Null badge property vs empty array
- [ ] Very long property path arrays
- [ ] Special characters in field paths

**Error Handling:**
- [ ] Invalid property path shows error message
- [ ] Missing required fields prevent save
- [ ] Server validation errors display clearly
- [ ] Cancel without saving discards changes

**Built-in Protection:**
- [ ] Built-in view shows read-only message
- [ ] Clone button appears for built-in views
- [ ] Cloned view is editable

### Integration Points to Verify

- [ ] SavedViewExtendedForm receives correct view data
- [ ] Mutation hook sends complete payload structure
- [ ] API returns success and updated view
- [ ] Query refetch pulls new data
- [ ] View page re-renders with updated config
- [ ] Layout switcher works with new display configs

## Dependencies

**Existing Code:**
- Backend API: `PUT /saved-views/{viewId}` (already implemented)
- Backend API: `GET /entity-schemas` (for schema selector)
- Form patterns: `properties-builder.tsx` (reference implementation)
- Hooks: `useSavedViewMutations` (will be extended)
- Components: Existing drawer in view page (will be populated)
- Sidebar: Basic metadata editing (name, icon, accentColor, trackerId) already works via SavedViewModal

**External Libraries:**
- TanStack Form (already in use)
- Zod (already in use)
- Mantine UI (already in use)

**No Breaking Changes:**
- Extends existing functionality
- Does not modify backend contracts
- Backward compatible with existing views

**Note on Scope:**
Basic metadata fields (name, icon, accentColor, trackerId) are already editable through the sidebar's SavedViewModal. This plan focuses exclusively on adding queryDefinition and displayConfiguration editing to the view page drawer.

---

## Tasks

**Overall Progress:** 0 of 6 tasks completed

**Current Task:** [Task 01](./01-entity-schemas-selector.md) (todo)

### Task List

| # | Task | Type | Status | Blocked By |
|---|------|------|--------|------------|
| 01 | [Entity Schemas Selector](./01-entity-schemas-selector.md) | AFK | todo | None |
| 02 | [Sort Configuration Builder](./02-sort-configuration-builder.md) | AFK | todo | Task 01 |
| 03 | [Filters Builder](./03-filters-builder.md) | AFK | todo | Task 02 |
| 04 | [Grid Display Configuration](./04-grid-display-configuration.md) | AFK | todo | Task 03 |
| 05 | [List and Table Display Configurations](./05-list-table-display-configurations.md) | AFK | todo | Task 04 |
| 06 | [Built-in Protection and UX Polish](./06-builtin-protection-ux-polish.md) | AFK | todo | Task 05 |
