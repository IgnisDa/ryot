# List and Table Display Configurations

**Parent Plan:** [View Editing UI](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Complete display configuration editing by adding list and table layout editors. This reuses patterns from the grid builder (Task 04) and adds table-specific column editing.

This vertical slice delivers:
- Extended form schema with `displayConfiguration.list` and `.table` structures
- `ListConfigBuilder` component (same structure as grid)
- `TableConfigBuilder` component with column array (label + property)
- Tabs UI to switch between editing grid/list/table configurations
- Complete display configuration editing

## Implementation Details

**Update `form-extended.ts`:**
```typescript
const listDisplayConfigSchema = z.object({
  imageProperty: propertyArraySchema.optional(),
  titleProperty: propertyArraySchema.optional(),
  subtitleProperty: propertyArraySchema.optional(),
  badgeProperty: propertyArraySchema.nullable().optional()
});

const tableColumnSchema = z.object({
  label: z.string().min(1, "Column label required"),
  property: z.array(z.string()).min(1, "At least one property path required")
});

const tableDisplayConfigSchema = z.object({
  columns: z.array(tableColumnSchema)
});

// Update displayConfigurationSchema with all three
```

**Create `ListConfigBuilder` component:**
- Nearly identical to GridConfigBuilder
- Same four property sections
- Reuse component patterns

**Create `TableConfigBuilder` component:**
- Array of columns: `form.AppField name="displayConfiguration.table.columns" mode="array"`
- Each column has:
  - Label (TextInput)
  - Property array (array field with add/remove)
- Add/Remove column buttons

**Create `DisplayConfigBuilder` wrapper:**
- Mantine Tabs component
- Three tabs: Grid, List, Table
- Each tab shows its respective builder
- All configs saved simultaneously

**Update drawer form:**
- Replace GridConfigBuilder with DisplayConfigBuilder (tabbed)
- Initialize all three configs from view
- Include complete displayConfiguration in save

## Acceptance criteria

- [ ] User can switch between Grid/List/Table tabs
- [ ] Grid tab shows grid config editor (from Task 04)
- [ ] List tab shows list config editor (same as grid)
- [ ] Table tab shows table config editor with columns
- [ ] User can add/remove table columns
- [ ] Each column has label and property array
- [ ] Property arrays support multiple paths (COALESCE)
- [ ] All three configs save simultaneously
- [ ] Switch to each view layout shows correct display
- [ ] Tab state is managed in UI (not localStorage)
- [ ] No TypeScript errors

## Blocked by

- [Task 04](./04-grid-display-configuration.md) - Establishes grid config pattern

## User stories addressed

- User story 8: As a user, I want to customize which properties display in list view, so that I can optimize for different viewing patterns.
- User story 9: As a user, I want to configure table columns (labels and properties), so that I can create custom tabular views of my data.
- User story 10: As a user, I want all three layout configurations (grid, list, table) to be editable independently, so that I don't lose settings when switching layouts.
