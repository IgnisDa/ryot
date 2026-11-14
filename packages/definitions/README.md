# Definitions

`@ryot-app/definitions` owns the product-agnostic definition model and its validation. It has no
kernel, database, or runtime dependency, so the kernel and `ryot plugin build` run the same checks.

- `/kernel-definitions` exports `kernelDefinitionSource()`, the kernel baseline definitions (source
  zero) that plugins may reference with kernel owners.
- `/source` materializes manifest definitions for a plugin ID and merges them over a base source.
- `/snapshot` declares the definition schemas, validates a definition source, and builds the frozen
  snapshot and its lookups.
- `/saved-views` validates saved-view renderers, settings, and every data-source branch. Plugin
  built-ins and user-created views use the same checks; calendar and analytics views are kernel
  built-ins only.
- `/definition-set` exports `validateDefinitionSet(baseline, plugins)`. It binds owner references
  against the plugin set, validates declared queries and saved views with their controls, and builds
  the snapshot. Invalid definitions throw.

Deployment rules, such as active system package uniqueness and configuration environment keys, stay
in the kernel. The kernel validates every archive at ingestion regardless of build-time checks.
