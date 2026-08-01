# Saved View Renderer

- Treat each layout as an independent query document and field-to-slot mapping. Execute and decode only the persisted active layout.
- Keep card slot meanings stable: title is identity; image is an independent `AssetLocator`; overline is context; primary and secondary metadata are ordered support; callout is optional emphasis.
- Keep `table.imageField` independent from card images. Render it as an unlabeled visual in the first configured cell, not as a data column, and preserve column order.
- A null mapping removes a slot. A null card value omits content; a null table value preserves an empty cell.
- Resolve missing mapped values through `fieldSyncState`. Pending slots reserve required layout space; absent and unmapped slots do not.
- Render image regions through `ManagedImage` and `EntityArtWell`. Managed-asset loading or failure remains a placeholder and does not fail the screen.
- A row with complete values renders as ready even while population continues. `savedViewSyncSummary` counts only rows missing a mapped value.
- Keep one status region for result count, transition text, and sync count. Per-row marks remain `aria-hidden`.
- Keep placement, typography, truncation, image geometry, and scalar formatting renderer-owned. Domain text and units belong in projected RyotQL expressions.
- Persist the selected grid, list, or table layout locally and default to grid. Do not infer presentation from entity schemas or projected field names.
- Key online-search affordances by `entitySchemaSlug`, not handler presence.
- Route every add affordance through one handler and the URL-owned `add` state. Keep the flow outside record-keyed content and refresh once after successful imports close.
