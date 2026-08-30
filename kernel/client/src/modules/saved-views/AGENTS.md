# Saved Views

- Saved-view routes host the selected renderer through `ClientPageHost`; do not add a parallel kernel-DOM rendering path. Header chrome, including the view name and icon, belongs to the renderer inside the iframe.
- Persist entity-browser layout selection locally. Explicit URL state remains authoritative in the renderer.
- Route provider search through the saved view's explicit `addAction` owner and schema. Keep the provider modal open after an import and refresh the page when it closes.
