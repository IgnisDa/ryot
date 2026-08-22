# Saved Views

- Saved-view routes host the selected renderer through `ClientPageHost`; do not add a parallel kernel-DOM rendering path.
- Persist entity-browser layout selection locally. Explicit URL state remains authoritative in the renderer.
- Route provider search through the saved view's explicit `addAction` owner and schema, and refresh the page after a successful import.
