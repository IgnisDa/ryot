# Definition Registry

- Own immutable snapshots of schema, source-canonical saved-view, signal, and binding definitions. Definitions carry stable plugin identity plus a local slug; user state and persisted domain data do not belong here.
- Fully validate and freeze replacements before swapping the snapshot reference; synchronous readers must see one complete version.
- `kernelDefinitionSource` is source zero, not a synthetic plugin. `pluginId: null` identifies kernel ownership.
- The process snapshot contains trusted builtins. Private definitions are composed on demand from the user's installations and are never cached process-wide.
- Signal definitions own formatter selection; kernel formatters remain kernel-owned.
