# True Table Rendering

**Parent Plan:** [App Client Saved View Renderer](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Add true table layout rendering to the app-client saved-view screen. Table mode must preserve configured table column labels, column order, row order, and cell order. It should render as a horizontal table with a header row and body rows, not as responsive cards.

The table uses the same saved-view metadata, runtime query builder, React Query infinite loading, shared value formatter, and configured `entityIdProperty` navigation model as grid/list. Columns use deterministic client defaults for widths and horizontal scrolling for overflow. Sticky headers, interactive sorting, column width metadata, and new dependencies are out of scope.

Image table cells render thumbnails. JSON, array, and object values render compact truncated text. Null table cells render a muted dash. Rows navigate to entity detail using the configured entity ID field.

## Acceptance criteria

- [ ] The layout switcher includes table mode
- [ ] Table mode executes a query-engine request with configured `entityIdProperty` and ordered `column_N` fields
- [ ] Table header labels come from saved-view table column labels
- [ ] Table cells preserve configured column order and row order
- [ ] The table is horizontally scrollable when columns overflow
- [ ] Table rows navigate to entity detail using the configured entity ID field
- [ ] Null table cells render as muted dashes
- [ ] Image table cells render thumbnails with existing image URL resolution
- [ ] JSON, array, and object cells render compact truncated text
- [ ] Date, boolean, number, text, image, null, and JSON values use the shared value rendering system
- [ ] Load-more behavior works in table mode
- [ ] No interactive table sorting, sticky-header requirement, table metadata extension, or new dependency is introduced

## User stories addressed

Reference by number from the parent PRD:

- User story 4
- User story 5
- User story 6
- User story 10
- User story 11
- User story 19
- User story 21
- User story 22
- User story 23
- User story 32
- User story 35
