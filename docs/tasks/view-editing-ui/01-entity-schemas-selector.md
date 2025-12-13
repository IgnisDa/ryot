# Entity Schemas Selector

**Parent Plan:** [View Editing UI](./README.md)

**Type:** AFK

**Status:** todo

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

- [ ] User can open drawer and see entity schemas multi-select
- [ ] Multi-select shows all available entity schemas (built-in + custom)
- [ ] User can add schemas to the selection
- [ ] User can remove schemas from the selection
- [ ] At least one schema must be selected (validation)
- [ ] Save button triggers mutation with complete queryDefinition
- [ ] View results update immediately after save
- [ ] Drawer closes on successful save
- [ ] Error messages display if save fails
- [ ] No TypeScript errors

## Blocked by

None - can start immediately

## User stories addressed

- User story 1: As a user, I want to change which entity schemas my saved view queries, so that I can include or exclude different entity types.
