# Grid Display Configuration

**Parent Plan:** [View Editing UI](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Add grid layout display configuration editing to the drawer. This establishes the pattern for display config editing before adding list and table in the next task.

This vertical slice delivers:
- Extended form schema with `displayConfiguration.grid` structure
- `GridConfigBuilder` component with property array editors
- Four property sections: imageProperty, titleProperty, subtitleProperty, badgeProperty
- Each property as an array of field paths with add/remove
- Complete integration with existing drawer form

## Implementation Details

**Update `form-extended.ts`:**
```typescript
const propertyArraySchema = z.array(z.string());

const gridDisplayConfigSchema = z.object({
  imageProperty: propertyArraySchema.optional(),
  titleProperty: propertyArraySchema.optional(),
  subtitleProperty: propertyArraySchema.optional(),
  badgeProperty: propertyArraySchema.nullable().optional()
});

const displayConfigurationSchema = z.object({
  grid: gridDisplayConfigSchema,
  // Placeholders for list and table (next task)
  list: z.any(),
  table: z.any()
});
```

**Create `GridConfigBuilder` component:**
- Four sections for image, title, subtitle, badge
- Each section uses array field pattern: `form.AppField name="displayConfiguration.grid.imageProperty" mode="array"`
- Each property path is a TextInput with add/remove buttons
- Badge property has special handling (null vs array)
- Help text explaining COALESCE resolution

**Update drawer form:**
- Add DisplayConfiguration section with GridConfigBuilder
- Initialize with existing grid config from view
- Include in save payload

## Acceptance criteria

- [ ] User can see current grid display configuration
- [ ] User can add property paths to imageProperty array
- [ ] User can remove property paths from imageProperty array
- [ ] Same add/remove functionality for titleProperty
- [ ] Same add/remove functionality for subtitleProperty
- [ ] badgeProperty can be set to null or array
- [ ] Empty arrays are allowed
- [ ] Save updates displayConfiguration.grid
- [ ] Switch to grid view shows updated display
- [ ] Help text explains property paths and COALESCE
- [ ] No TypeScript errors

## Blocked by

- [Task 03](./03-filters-builder.md) - Completes query editing before display config

## User stories addressed

- User story 7: As a user, I want to customize which properties display in grid view (image, title, subtitle, badge), so that I see the most relevant information.
- User story 10: As a user, I want all three layout configurations (grid, list, table) to be editable independently, so that I don't lose settings when switching layouts.
