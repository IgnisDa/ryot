# Saved View Renderer

- Treat each entry in `layouts` as an independent query document and flattened mapping from projected RyotQL fields to presentation slots. Execute and decode only the persisted active layout.
- Apply these card slot semantics consistently in grid and list layouts:
  - `titleField` is the primary identifying text.
  - `imageField` is the layout's independently configured `AssetLocator` source.
  - `overline` is short contextual text shown with less emphasis than the title.
  - `primaryMetadata` and `secondaryMetadata` are ordered supporting values.
  - `callout` is a supporting value that the layout may emphasize.
- `table.imageField` is independent from the grid and list image fields. Render it as an unlabeled leading visual in the first configured column's cell; it is not a data column. Render `table.columns` in their configured order.
- A null field mapping means that the layout has no such slot. A null card value omits that card content; a null table value preserves an empty cell. When a configured image field has a null or unusable row value, preserve the image region's dimensions and show the shared missing-image placeholder.
- Image fields carry `AssetLocator` values: use remote URLs directly and resolve local and S3 locators through `ManagedAssetsService`. Managed resolution loading or failure shows placeholders and must not fail the saved-view screen.
- The renderer owns slot placement, typography, truncation, and layout-specific image size and crop. Do not infer these choices from projected field names or entity schemas.
- Format scalar values by `displayKind` through `formatSavedViewValue`. Keep general date and number localization here; a definition that needs composed text or domain-specific units uses a projected RyotQL expression instead.
- Keep the selected grid, list, or table layout in client storage and default it to grid. Search, filters, sort controls, empty states, and responsive behavior are outside the saved-view definition.
- The online-search affordances key off the record's `entitySchemaSlug`, never off whether a handler happens to exist.
- Every add affordance — the header button, the mobile FAB, the empty and no-match calls to action, and the `A` shortcut — opens the provider add flow, and all of them go through one handler so they can never drift apart. The flow's open state lives in the route's `add` search param so browser and Android back dismiss it, and it mounts outside the record-keyed content subtree so a refetch cannot unmount it mid-import. Refresh the view once when the flow closes having imported something, never once per import.
- The filters control remains deliberately inert: it renders the shape the screen keeps and logs a TODO until saved-view filters exist. Do not delete it as dead code, and do not give it a stand-in implementation.
