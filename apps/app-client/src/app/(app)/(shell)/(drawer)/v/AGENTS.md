# Saved View Renderer

- Treat `displayConfiguration` as a mapping from projected RyotQL fields to presentation slots. It does not define layout mechanics or view interactions.
- Apply these card slot semantics consistently in grid and list layouts:
  - `titleField` is the primary identifying text.
  - `imageField` is the layout's independently configured image source.
  - `overlineField` is short contextual text shown with less emphasis than the title.
  - `primaryMetadataField` and `secondaryMetadataField` are ordered supporting values.
  - `calloutField` is a supporting value that the layout may emphasize.
- `table.imageField` is independent from the grid and list image fields. Render it as an unlabeled leading visual in the first configured column's cell; it is not a data column. Render `table.columns` in their configured order.
- A null field mapping means that the layout has no such slot. A null card value omits that card content; a null table value preserves an empty cell. When a configured image field has a null or unusable row value, preserve the image region's dimensions and show the shared missing-image placeholder.
- The renderer owns slot placement, typography, truncation, and layout-specific image size and crop. Do not infer these choices from projected field names or entity schemas.
- Format scalar values by `FieldValue.kind`. Keep general date and number localization in the client; use a projected RyotQL expression when a saved-view definition requires composed text or domain-specific units.
- Keep the selected grid, list, or table layout outside the saved-view definition. Search, filters, sort controls, create flows, empty states, and responsive behavior are also outside `displayConfiguration`.
