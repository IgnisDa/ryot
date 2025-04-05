# Built-in Protection and UX Polish

**Parent Plan:** [View Editing UI](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Add protection for built-in views and polish the overall editing experience with helpful guidance, better error handling, and loading states.

This vertical slice delivers:
- Built-in view protection (read-only message + clone suggestion)
- Comprehensive help text for property path syntax
- Operator descriptions/tooltips
- Improved validation error display
- Loading states during save
- Success feedback
- Final UX polish

## Implementation Details

**Add built-in protection:**
```tsx
// In drawer content
{savedView.isBuiltin ? (
  <Stack gap="md">
    <Text size="sm" c="dimmed">
      Built-in views cannot be edited. Clone this view to create a customizable copy.
    </Text>
    <Button variant="light" onClick={handleClone} leftSection={<Copy size={14} />}>
      Clone View
    </Button>
  </Stack>
) : (
  <SavedViewExtendedForm {...props} />
)}
```

**Add help text sections:**
- Property path syntax explanation:
  - `@name`, `@createdAt`, `@updatedAt` for top-level fields
  - `schema_slug.property_name` for entity properties
  - Examples: `smartphones.manufacturer`, `tablets.maker`
- Filter operator descriptions:
  - eq: Equals, ne: Not equals
  - gt/gte: Greater than (or equal)
  - lt/lte: Less than (or equal)
  - in: In array, isNull: Is null
- COALESCE explanation for display properties

**Improve error handling:**
- Parse server validation errors and show field-specific messages
- Highlight which property path is invalid
- Suggest fixes for common errors
- Clear error messages for missing fields

**Add loading/success states:**
- Disable form during save
- Show loading spinner on save button
- Brief success notification after save
- Auto-refetch view data on success

**Polish sections:**
- Collapsible sections for long forms (Accordion or expandable Paper)
- Logical grouping: Query Definition | Display Configuration
- Visual separators (Divider components)
- Consistent spacing and typography

## Acceptance criteria

- [ ] Built-in views show read-only message
- [ ] Built-in views offer clone button
- [ ] Clone button creates editable copy
- [ ] Help text explains property path syntax clearly
- [ ] Examples provided for common patterns
- [ ] Operator descriptions visible (tooltips or inline)
- [ ] COALESCE explanation included
- [ ] Server errors display with actionable messages
- [ ] Form disables during save
- [ ] Save button shows loading state
- [ ] Success feedback appears after save
- [ ] Form sections logically organized
- [ ] Visual hierarchy clear (headings, spacing)
- [ ] No console warnings or errors
- [ ] All acceptance criteria from parent README satisfied

## Blocked by

- [Task 05](./05-list-table-display-configurations.md) - Completes all editing functionality

## User stories addressed

- User story 11: As a user, I want built-in views to be protected from editing, so that I don't accidentally break system views.
- User story 12: As a user, I want to see a clone option for built-in views, so that I can create my own customizable version.
- User story 13: As a user, I want clear error messages when my edits fail validation, so that I can fix issues and save successfully.
- User story 14: As a user, I want helpful hints about property path syntax, so that I can correctly reference entity fields.
- User story 15: As a user, I want to save my changes and immediately see them reflected in the view results, so that I get instant feedback on my configuration.
