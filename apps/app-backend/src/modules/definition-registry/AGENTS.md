# Definition Registry

- Own the immutable, slug-keyed snapshot of schema, source-canonical saved-view, signal, and binding definitions. User state and persisted domain data do not belong here.
- Fully validate and freeze replacements before swapping the snapshot reference; synchronous readers must see one complete version.
- `kernelDefinitionSource` is source zero, not a synthetic plugin. `pluginSlug: null` identifies kernel ownership.
- Registry definitions are trusted builtins. User-package provenance, installation, consent, and trust state belong elsewhere.
- Signal definitions own formatter selection; kernel formatters remain kernel-owned.
