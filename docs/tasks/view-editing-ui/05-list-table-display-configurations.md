# List and Table Display Configurations

**Parent Plan:** [View Editing UI](./README.md)

**Type:** AFK

**Status:** done

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

- [x] User can switch between Grid/List/Table tabs
- [x] Grid tab shows grid config editor (from Task 04)
- [x] List tab shows list config editor (same as grid)
- [x] Table tab shows table config editor with columns
- [x] User can add/remove table columns
- [x] Each column has label and property array
- [x] Property arrays support multiple paths (COALESCE)
- [x] All three configs save simultaneously
- [x] Switch to each view layout shows correct display
- [x] Tab state is managed in UI (not localStorage)
- [x] No TypeScript errors

## Implementation notes

- The form layer now normalizes list, grid, and table configuration rows with generated IDs so React keys stay stable while API payloads remain unchanged.
- `DisplayConfigBuilder` now owns the tabbed grid/list/table editing UI, with shared property-path editing extracted into a reusable helper.
- Automated verification completed with `bun test 'apps/app-frontend/src/features/saved-views'`, `bun run typecheck`, `bun run lint`, and `bun run build`.

## Blocked by

- [Task 04](./04-grid-display-configuration.md) - Establishes grid config pattern

## User stories addressed

- User story 8: As a user, I want to customize which properties display in list view, so that I can optimize for different viewing patterns.
- User story 9: As a user, I want to configure table columns (labels and properties), so that I can create custom tabular views of my data.
- User story 10: As a user, I want all three layout configurations (grid, list, table) to be editable independently, so that I don't lose settings when switching layouts.

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

3. **Run lint:**
   ```bash
   cd apps/app-frontend
   bun run lint
   ```

4. **Build frontend:**
   ```bash
   cd apps/app-frontend
   bun run build
   ```

All steps must pass with no errors.
