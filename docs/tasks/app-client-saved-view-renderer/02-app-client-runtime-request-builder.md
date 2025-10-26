# App Client Runtime Request Builder

**Parent Plan:** [App Client Saved View Renderer](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Create the app-client saved-view runtime module that turns a saved view plus selected layout into a query-engine entity request. This slice should not build the full screen UI yet; it should create the deep, testable logic that later rendering slices consume.

The request builder must use the saved view query definition as the request base and request only fields declared by display configuration. Every layout request includes the configured non-rendered `entityIdProperty`. Grid/list requests include their configured `eyebrow`, `image`, `title`, primary subtitle, secondary subtitle, and callout slots. Table requests include the configured entity ID field plus `column_N` fields in table column order.

Add app-client utilities for layout persistence using the existing Jotai/platform storage pattern, field-key constants, value formatting, image-entry extraction, infinite-query page flattening, and supported entity saved-view narrowing. Use a uniform page size of 20 for all layouts.

## Acceptance criteria

- [ ] A saved-view feature module exists in app-client for request building and runtime utilities
- [ ] Grid query-engine requests include saved query definition fields, pagination, `entityIdProperty`, and grid display slots
- [ ] List query-engine requests include saved query definition fields, pagination, `entityIdProperty`, and list display slots
- [ ] Table query-engine requests include saved query definition fields, pagination, `entityIdProperty`, and ordered `column_N` fields
- [ ] Runtime requests do not add hidden visible fallbacks such as entity name or entity image outside display configuration
- [ ] Layout preference is represented through app-client's existing platform-backed storage pattern
- [ ] Page size is 20 for grid, list, and table
- [ ] Pure utility tests cover request construction, field-key mapping, value formatting, image extraction, and infinite page flattening

## User stories addressed

Reference by number from the parent PRD:

- User story 31
- User story 33
- User story 34
