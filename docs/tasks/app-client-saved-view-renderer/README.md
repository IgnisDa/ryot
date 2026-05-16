## Problem Statement

Saved views are intended to be the universal entity browsing primitive in Ryot. A saved view stores both the query definition that selects entities and the display configuration that describes how those entities should appear in grid, list, and table layouts. The backend query engine and saved-view modules already provide most of the runtime foundation for this model, and the web frontend has a working saved-view renderer.

The Expo app-client route for saved views does not yet use that system. It currently renders placeholder skeleton cards instead of loading a saved view, executing the saved view query, or rendering the configured layouts. As a result, sidebar saved-view links in the app-client do not provide the expected browsing experience for built-in views, custom tracker views, or user-authored saved views.

This gap blocks the product model where entity list pages are saved views. It also prevents mobile users from seeing saved views in the three supported display modes: grid, list, and true table.

## Solution

Build a read-only saved-view renderer in the Expo app-client. The renderer will fetch a saved view by slug, compile its saved query definition plus selected display configuration into a query-engine entity request, execute the query through React Query, and render the returned rows in grid, list, or table mode.

The app-client will compile saved views directly into query-engine requests, mirroring the proven web frontend approach. No new backend execution route will be introduced.

The backend saved-view display contract will be tightened so every value the app-client visibly renders comes from the saved view's display configuration. To support navigation without adding hidden client-only fields, the display configuration will also include a required, system-owned `entityIdProperty`. This property is requested at runtime but is not rendered. It exists so every saved-view row/card/table row can navigate to the correct entity while still keeping the runtime field list declared by the saved-view configuration.

The display contract will also add an `eyebrowProperty` slot for grid and list layouts. This is a generic placement slot, not a schema-specific field. Defaults will point it to the entity schema name so multi-schema saved views can identify the type of each row without the client injecting visible schema badges on its own.

## User Stories

1. As an app-client user, I want saved-view links to show real data, so that the navigation items in the app are useful instead of placeholders.
2. As an app-client user, I want a saved view to render in grid mode, so that image-heavy entity types can be browsed visually.
3. As an app-client user, I want a saved view to render in list mode, so that I can scan entities in a denser vertical layout.
4. As an app-client user, I want a saved view to render in table mode, so that I can compare configured columns across many entities.
5. As an app-client user, I want table mode to be a real table, so that configured columns and cells preserve their tabular meaning.
6. As an app-client user, I want the table to scroll horizontally when needed, so that wide saved views remain usable on small screens.
7. As an app-client user, I want to switch between grid, list, and table, so that I can choose the best presentation for the same saved view.
8. As an app-client user, I want my selected layout to persist per saved view, so that reopening a view returns to my preferred layout.
9. As an app-client user, I want saved-view rows and cards to navigate to entity detail pages, so that browsing naturally leads to entity inspection.
10. As an app-client user, I want table rows to navigate to entity detail pages, so that table mode is not a dead-end read-only surface.
11. As an app-client user, I want saved views to load more results, so that I can browse beyond the first page without page-number controls.
12. As an app-client user, I want result loading to use clear loading states, so that I understand when more rows are being fetched.
13. As an app-client user, I want query failures to show an error and retry path, so that temporary backend or network issues are recoverable.
14. As an app-client user, I want disabled saved views to still render when opened directly, so that direct routes remain inspectable even if hidden from navigation.
15. As an app-client user, I want unsupported future saved-view modes to show a clear unsupported state, so that the app does not crash if a non-entity saved view appears later.
16. As an app-client user, I want configured titles to appear in grid and list cards, so that each entity is identifiable.
17. As an app-client user, I want a neutral title placeholder when a configured title resolves to null, so that cards and rows do not look broken.
18. As an app-client user, I want optional empty slots to disappear in grid/list layouts, so that null metadata does not create visual noise.
19. As an app-client user, I want null table cells to show a muted placeholder, so that the table structure remains aligned and scannable.
20. As an app-client user, I want image fields to render as thumbnails where appropriate, so that visual fields are recognizable.
21. As an app-client user, I want JSON, array, and object values to render compactly in tables, so that complex values do not overwhelm the table.
22. As an app-client user, I want date values to render in a readable local format, so that saved-view data feels user-facing rather than raw API output.
23. As an app-client user, I want boolean and numeric values to render generically, so that saved views work for arbitrary trackers and not only media ratings.
24. As a custom tracker user, I want saved-view rendering to be schema-driven, so that my tracker gets useful browsing screens without custom UI code.
25. As a user browsing a multi-schema saved view, I want an eyebrow/badge-like slot to identify row type when configured, so that mixed results remain understandable.
26. As a saved-view author, I want all visible values rendered by the app-client to be declared in display configuration, so that presentation remains data-driven and predictable.
27. As a saved-view author, I want the navigation target to be declared by the saved-view configuration, so that the client does not depend on undeclared hidden presentation fields.
28. As a backend developer, I want invalid display configurations rejected at saved-view validation time, so that app-client rendering does not fail because of malformed saved-view contracts.
29. As a backend developer, I want table display configuration to require at least one visible column, so that table mode always has meaningful content.
30. As a backend developer, I want grid and list title properties to be required, so that browsing layouts always have a primary visible label.
31. As an app-client developer, I want saved-view request-building logic isolated in a testable feature module, so that the route component stays small and runtime field logic is easy to verify.
32. As an app-client developer, I want value formatting centralized, so that grid, list, and table do not drift in how they render query-engine values.
33. As an app-client developer, I want result loading implemented with React Query, so that the app follows existing data-loading conventions and avoids manual request state.
34. As an app-client developer, I want layout persistence implemented through the existing app-client storage pattern, so that state management remains consistent with the rest of the app.
35. As an app-client developer, I want virtualized result rendering, so that saved views remain usable as result counts grow.
36. As a product owner, I want this work to be browse-only, so that the first implementation delivers the core rendering experience without expanding into saved-view editing.

## Implementation Decisions

### Current Architecture

Saved views persist a query definition and display configuration. Query definitions currently support entity-mode saved views. The query engine accepts entity requests with scope, filter, sort, pagination, joins, computed fields, and ordered runtime fields. Query-engine entity responses return rows as keyed records where each requested field maps to a resolved display value shaped by `kind` and `value`, plus pagination metadata and field order.

The app-client already has an OpenAPI fetch client, React Query usage, navigation data that loads saved views, platform-backed Jotai storage, query-engine usage in other features, entity image normalization, and image URL resolution. The saved-view route itself is only a placeholder and must be replaced.

The web frontend has a saved-view renderer that proves the backend contract is usable, but the PRD target is the app-client. The app-frontend is not a product scope for this PRD.

### Display Configuration Contract

Display configuration will remain the source of truth for rendered saved-view UI.

The display configuration object will gain a required root `entityIdProperty` field. This field is a view expression. It is requested by the app-client for every layout and is used to navigate rows/cards to entity detail. It is not visibly rendered. It is system-owned and should not be treated as a normal user-editable visual slot in future editors. The default value is the entity built-in ID expression for the saved view scope, using coalesced expressions when needed for multi-schema scope.

Backend validation must enforce that `entityIdProperty` resolves to a string/text display value. Saved-view creation and update should reject configurations where this expression cannot provide a valid entity navigation ID.

Grid and list display configuration will gain an `eyebrowProperty` key. The key is required, but the value is nullable. The slot is generic: it describes a visual placement, not a specific entity-schema badge concept. Defaults should set it to the entity schema name expression. Custom configurations may set it to null to opt out.

Grid and list `titleProperty` must be required and non-null. The expression may still resolve to null for a particular row; in that case the renderer displays a neutral `Untitled` placeholder.

Grid and list `imageProperty`, `calloutProperty`, `primarySubtitleProperty`, and `secondarySubtitleProperty` remain nullable. Null optional slots are hidden in the app-client instead of rendered as dashes.

Table configuration must contain at least one visible column. Each table column keeps its existing label and expression. Table cells preserve configured order.

There is no production data migration requirement. This project does not currently need backward-compatible persisted saved-view data handling. Existing seed, bootstrap, fixture, and default saved-view creation paths should be updated to write the new required fields.

### Runtime Query Compilation

The app-client will fetch the saved view by slug and compile the selected layout into a query-engine entity request.

The request base comes from the saved view query definition: scope, filter, sort, event joins, relationship joins, and computed fields. Pagination uses a uniform page size of 20 for all layouts.

For grid layout, requested runtime fields include the non-rendered entity ID field plus grid display slots: eyebrow, image, title, primary subtitle, secondary subtitle, and callout.

For list layout, requested runtime fields include the non-rendered entity ID field plus list display slots: eyebrow, image, title, primary subtitle, secondary subtitle, and callout.

For table layout, requested runtime fields include the non-rendered entity ID field plus one `column_N` field for each configured table column expression.

The app-client must not request visible fields that are not declared in display configuration. There are no hidden entity name or entity image fallbacks. The only non-rendered runtime field is the required display-configuration-declared `entityIdProperty`.

### Data Loading

Saved-view metadata loading and query-engine execution are separate React Query queries. The saved-view query fetches the saved view detail by slug. The runtime query is enabled only after a supported entity saved view is available.

Runtime execution uses an infinite query. The next page is derived from query-engine pagination metadata. Switching layout resets accumulated results and starts from page 1 because each layout requests a different field set.

The saved-view screen must not use ad hoc fetches, manual request state, or effect-driven API calls for normal data loading. It should use the shared API client and React Query conventions used by the app-client.

### Layout Persistence

The selected layout is persisted per saved view. The storage implementation should use the app-client's existing Jotai/platform storage pattern so it works across native and web targets. The default layout is grid.

### Rendering

The route component should stay thin. Saved-view runtime logic, request builders, result flattening, layout persistence, value formatting, image extraction, and result sections should live in a saved-view feature module.

The app-client renderer should use the native app-client visual language: warm, compact, journal-like UI consistent with existing app-client screens. It should not port the app-frontend Mantine design.

The screen header should show the saved-view name, a compact result/loading summary, and layout switcher controls for grid/list/table.

Grid mode renders visual cards using the configured slots. List mode renders compact vertical rows using the configured slots. Table mode renders a true table with a header row and configured columns. The table scrolls horizontally when columns overflow. Sticky table headers are not required for the first implementation. Table columns use deterministic client defaults for width based on label/value needs; width metadata is not added to display configuration in this PRD.

Rows/cards/table rows navigate to entity detail using the resolved `entityIdProperty` value. If a row lacks a valid entity ID despite validation, the renderer should avoid crashing and should not navigate for that row.

Result rendering should use virtualized primitives where practical. Load-more behavior should be compatible with the virtualized result surface.

### Value Rendering

Grid, list, and table should share one kind-based value rendering and formatting system.

Text and number values render generically. Numeric values must not assume ratings, stars, or any media-specific semantics. Boolean values render as readable yes/no-style text. Date values render in readable local date/time format. Null title values render as `Untitled` in grid/list. Optional null grid/list slots are hidden. Null table cells render as a muted dash. Image values render as thumbnails where image rendering is appropriate. JSON, array, and object values render as compact truncated text in table cells; expandable JSON is out of scope.

Image URL resolution should use the app-client's existing image normalization and resolved URL flow. Table image cells should participate in the same image URL resolution approach as grid/list image fields.

### Unsupported And Error States

This PRD remains entity-mode only. If a saved view with a non-entity query definition appears in the future, the app-client should show a clear unsupported-view state instead of crashing.

Disabled saved views should render when opened directly by slug. Navigation may hide disabled views, but direct route access should still attempt to render the saved view.

Saved-view fetch failures and query-engine execution failures should show React Query-driven error states with retry affordances. The renderer should not silently fall back to stale or synthetic data.

### Backend Routes And Query Engine

No new backend saved-view execution route is added. The app-client uses the existing saved-view detail route and query-engine execute route.

The unused backend saved-view preparation helper is not part of the product scope. It should only be updated if shared type changes require mechanical updates to keep the backend compiling.

### Repository Impact

The app-frontend is not a product target for this PRD. However, shared backend schema and generated OpenAPI type changes may require mechanical updates outside the app-client to keep the repository compiling. Those changes should be treated as implementation dependencies, not as app-frontend feature work.

The backend development environment is expected to regenerate OpenAPI-derived types automatically when needed, but implementation should still verify that app-client types reflect the new saved-view contract.

### Dependencies

No new runtime or UI dependencies should be added for this feature. The grid, list, table, layout switcher, loading states, and value rendering should be built from existing app-client, React Native, Expo, and project primitives.

## Testing Decisions

Good tests should verify externally observable behavior and contract boundaries, not implementation details. Tests should avoid proving that libraries work. Backend tests should prove saved-view schemas, defaults, and validation behavior. App-client tests should prove request-building and value-formatting behavior without depending on fragile UI internals.

Backend tests should cover the display configuration contract changes:

- Default display configurations include root `entityIdProperty`.
- Default grid/list configurations include `eyebrowProperty` set to entity schema name.
- Grid/list title properties are required and non-null.
- Table configuration requires at least one visible column.
- `entityIdProperty` validation rejects non-string/non-text expressions.
- Saved-view creation and update reject invalid display configuration according to the new rules.

App-client utility tests should cover:

- Building grid query-engine requests from a saved view.
- Building list query-engine requests from a saved view.
- Building table query-engine requests from a saved view.
- Including the configured non-rendered entity ID field in every layout request.
- Not adding hidden visible fallbacks outside display configuration.
- Mapping table columns to stable `column_N` runtime field keys.
- Formatting text, number, boolean, date, null, image, and JSON values.
- Extracting image entries for URL resolution from grid/list/table runtime rows.
- Flattening infinite-query pages into result rows.
- Reset-sensitive behavior for layout-specific request keys where practical.

End-to-end tests in the shared tests package should be added if needed to prove the backend display contract works through the HTTP API. Good E2E coverage would create or fetch a saved view, assert that the new display configuration fields are persisted and returned, and assert that invalid display configurations fail through API validation.

Existing saved-view service/schema/default tests, query-engine display tests, app-client utility tests, and shared HTTP tests are the closest prior art.

## Out of Scope

- Saved-view editing UI.
- Query builder UI.
- Display configuration editing UI.
- Clone, delete, disable, or reorder saved-view actions in the app-client saved-view screen.
- Interactive table sorting.
- Server-side saved-view execution route.
- Aggregate, events, or time-series saved-view rendering.
- Dashboard/widget rendering from saved views.
- Adding table width, alignment, formatter, or conditional styling metadata to display configuration.
- Expandable JSON cell inspectors.
- New UI/runtime dependencies.
- App-frontend product changes beyond mechanical compile/type fixes caused by shared contract changes.
- Production data migration or backward compatibility for old saved-view JSON.

## Further Notes

The key architectural principle for this work is that saved views own presentation. The app-client renderer should be generic and slot-driven. It may choose how to visually render a slot, but it should not invent visible data that the saved view did not declare.

The only non-rendered runtime field is the required `entityIdProperty`, and it still lives inside display configuration. This preserves the field-driven query-engine model while giving the app-client a reliable navigation target.

The table should be treated as a first-class layout, not a fallback presentation. It must preserve visible column labels, column order, cell order, and row navigation.

---

## Tasks

**Overall Progress:** 0 of 6 tasks completed

**Current Task:** [Task 01](./01-saved-view-display-contract.md) (todo)

### Task List

| #   | Task                                                                                           | Type | Status |
| --- | ---------------------------------------------------------------------------------------------- | ---- | ------ |
| 01  | [Saved View Display Contract](./01-saved-view-display-contract.md)                             | AFK  | todo   |
| 02  | [App Client Runtime Request Builder](./02-app-client-runtime-request-builder.md)               | AFK  | todo   |
| 03  | [Grid And List Rendering](./03-grid-and-list-rendering.md)                                     | AFK  | todo   |
| 04  | [True Table Rendering](./04-true-table-rendering.md)                                           | AFK  | todo   |
| 05  | [End-To-End Saved View Rendering Coverage](./05-end-to-end-saved-view-rendering-coverage.md)   | AFK  | todo   |
| 06  | [Codebase Cleanup](./06-codebase-cleanup.md)                                                   | AFK  | todo   |
