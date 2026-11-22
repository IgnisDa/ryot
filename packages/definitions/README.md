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
- `/definition-set` exports `validateDefinitionSet(baseline, plugins, change?)`. It binds owner
  references against the plugin set, validates declared queries and saved views with their controls,
  and builds the snapshot. Invalid definitions throw. Without a change, every definition is
  validated. A change names the plugins being added or replaced: only their definitions and the
  stored documents that reference them are validated, while set-wide rules still cover everything.
  Unchanged definitions were validated when their plugin was ingested; owner references are
  namespaced, so added plugins cannot alter how they resolve. A user-scope change skips
  system-owned documents, which cannot reference user plugins; a system-scope change still binds
  every document so dangling owners fail.

- `/definition-set-protocol` is the line protocol for validating a definition set in another
  process. `encodeDefinitionSetValidationRequest` writes the parent's already-decoded inputs as JSON,
  since every field encodes as itself and re-encoding large manifests through the schema would block
  the parent; `serveDefinitionSetValidation` decodes the request with the full schema, validates it,
  and answers `{ valid: true }` or `{ valid: false, issue }` with the error's string, which
  `decodeDefinitionSetValidationResponse` decodes. A request that does not decode is a defect. The
  package owns no process: the kernel hosts the worker.

Deployment rules, such as active system package uniqueness and configuration environment keys, stay
in the kernel. The kernel validates every archive at ingestion regardless of build-time checks.
