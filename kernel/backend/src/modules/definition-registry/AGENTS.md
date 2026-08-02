# Definition Registry

- Own schema, source-canonical saved-view, signal, and hook definitions. Definitions carry stable plugin identity plus a local slug; user state and persisted domain data do not belong here.
- The persisted `definition_*` tables and the `global_*`/`user_*` views are the only definition of precedence and effectiveness. Revision rows are immutable; kernel rows change only under the plugin ingestion lock. No definition state lives in process memory.
- `kernelDefinitionSource` is source zero, not a synthetic plugin. `pluginId: null` identifies kernel ownership.
- Signal definitions own formatter selection; kernel formatters remain kernel-owned.
