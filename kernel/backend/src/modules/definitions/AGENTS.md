# Definitions

- Resolve precedence and effectiveness per read in `DefinitionCatalog`; cache only immutable revision rows and kernel definitions. Mutate kernel definitions only under the plugin ingestion lock.
- Kernel ownership uses `pluginId: null`; `kernelDefinitionSource` is source zero, not a synthetic plugin.
- Add a definition reader only when it owns policy; otherwise use `DefinitionRepository` or its ownership-scoped projections.
